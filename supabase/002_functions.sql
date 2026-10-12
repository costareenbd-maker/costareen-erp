-- ============================================================================
-- COSTAREEN ERP - business logic
-- ----------------------------------------------------------------------------
-- Run AFTER 001_schema.sql. Idempotent.
--
-- These run inside a single transaction each, so a sale either records
-- completely (invoice + lines + stock movements + counter bump) or not at all.
-- That is the guarantee the spreadsheet version could never really give.
--
-- Every function re-checks membership itself. They are SECURITY INVOKER, so
-- RLS still applies underneath - the checks are for clear error messages.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Create a business and make the caller its owner.
-- ---------------------------------------------------------------------------
create or replace function public.create_business(
  p_name     text,
  p_currency text default 'BDT'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  b_id uuid;
begin
  if auth.uid() is null then
    raise exception 'You must be signed in.';
  end if;
  if coalesce(btrim(p_name), '') = '' then
    raise exception 'Business name is required.';
  end if;

  insert into public.businesses (name, currency)
  values (btrim(p_name), coalesce(nullif(btrim(p_currency), ''), 'BDT'))
  returning id into b_id;

  insert into public.memberships (business_id, user_id, role)
  values (b_id, auth.uid(), 'owner');

  insert into public.invoice_counters (business_id) values (b_id);

  -- starter reference lists so the forms are not empty on day one
  insert into public.lookups (business_id, kind, value, sort_order)
  select b_id, k.kind, v.value, v.ord
  from (values
      ('unit',           'Piece',        1),
      ('unit',           'Roll',         2),
      ('unit',           'Set',          3),
      ('unit',           'Box',          4),
      ('payment_method', 'Cash',         1),
      ('payment_method', 'bKash',        2),
      ('payment_method', 'Nagad',        3),
      ('payment_method', 'Bank Transfer',4),
      ('payment_method', 'Card',         5),
      ('payment_status', 'Pending',      1),
      ('payment_status', 'Paid',         2),
      ('payment_status', 'Partial',      3),
      ('source',         'Walk-in',      1),
      ('source',         'WhatsApp',     2),
      ('source',         'Facebook',     3),
      ('source',         'Website',      4),
      ('source',         'Phone',        5),
      ('source',         'Referral',     6)
    ) as v(kind, value, ord)
  join lateral (select v.kind as kind) k on true;

  return b_id;
end $$;

-- ---------------------------------------------------------------------------
-- Next invoice number, safe under concurrency.
-- The counter row is locked FOR UPDATE, so two simultaneous sales can never
-- be handed the same number.
-- ---------------------------------------------------------------------------
create or replace function public.next_invoice_no(p_business uuid)
returns text
language plpgsql
security invoker
set search_path = public
as $$
declare
  n   int;
  pfx text;
begin
  insert into public.invoice_counters (business_id)
  values (p_business)
  on conflict (business_id) do nothing;

  select next_number, prefix into n, pfx
  from public.invoice_counters
  where business_id = p_business
  for update;

  update public.invoice_counters
  set next_number = n + 1
  where business_id = p_business;

  return pfx || '-' || to_char(now() at time zone 'Asia/Dhaka', 'YYYYMMDD') || '-' || n::text;
end $$;

-- ---------------------------------------------------------------------------
-- Selling price for a product in a business. Plain sell_price here;
-- 005_partnership.sql replaces it so a joint pool can price per partner
-- (wholesale for one partner, retail for the other).
-- ---------------------------------------------------------------------------
create or replace function public.sale_price_for(p_business uuid, p_product uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
begin
  return (select sell_price from public.products
          where id = p_product and business_id = p_business);
end $$;

-- ---------------------------------------------------------------------------
-- Create an invoice.
--
-- p_items is JSON: [{"product_id":"...","qty":2,"discount":100}, ...]
-- Unit price always comes from sale_price_for(), never from the client, so
-- a tampered request cannot sell at a price the business did not set.
-- ---------------------------------------------------------------------------
create or replace function public.create_invoice(
  p_business        uuid,
  p_customer_name   text,
  p_customer_phone  text,
  p_customer_address text,
  p_source          text,
  p_items           jsonb,
  p_delivery_charge numeric default 0,
  p_advance_paid    numeric default 0,
  p_payment_method  text default 'Cash',
  p_payment_status  text default 'Pending',
  p_note            text default null
)
returns public.invoices
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv        public.invoices;
  v_no         text;
  v_cust       uuid;
  v_item       jsonb;
  v_product    public.products;
  v_stock      numeric;
  v_qty        numeric;
  v_disc       numeric;
  v_line_total numeric;
  v_subtotal   numeric := 0;
  v_discount   numeric := 0;
  v_grand      numeric;
  v_line_no    int := 0;
  v_phone_key  text;
  v_price      numeric;
begin
  if not public.is_member(p_business) then
    raise exception 'You do not have access to this business.';
  end if;
  if coalesce(btrim(p_customer_name), '') = '' then
    raise exception 'Customer name is required.';
  end if;
  if p_items is null or jsonb_array_length(p_items) = 0 then
    raise exception 'Add at least one product.';
  end if;

  -- ---- find or create the customer, matching on the last 10 phone digits --
  v_phone_key := right(regexp_replace(coalesce(p_customer_phone, ''), '\D', '', 'g'), 10);
  if length(v_phone_key) = 10 then
    select id into v_cust
    from public.customers
    where business_id = p_business
      and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_phone_key
    limit 1;
  end if;

  if v_cust is null then
    insert into public.customers (business_id, name, phone, address, source)
    values (p_business, btrim(p_customer_name), p_customer_phone, p_customer_address,
            coalesce(nullif(btrim(p_source), ''), 'Walk-in'))
    returning id into v_cust;
  else
    update public.customers
    set address    = coalesce(nullif(btrim(p_customer_address), ''), address),
        updated_at = now()
    where id = v_cust;
  end if;

  v_no := public.next_invoice_no(p_business);

  insert into public.invoices (
    business_id, invoice_no, customer_id, customer_name, customer_phone,
    customer_address, source, delivery_charge, advance_paid,
    payment_method, payment_status, note, created_by)
  values (
    p_business, v_no, v_cust, btrim(p_customer_name), p_customer_phone,
    p_customer_address, coalesce(nullif(btrim(p_source), ''), 'Walk-in'),
    coalesce(p_delivery_charge, 0), coalesce(p_advance_paid, 0),
    p_payment_method, p_payment_status, p_note, auth.uid())
  returning * into v_inv;

  -- ---- lines + stock ------------------------------------------------------
  for v_item in select * from jsonb_array_elements(p_items)
  loop
    select * into v_product
    from public.products
    where id = (v_item->>'product_id')::uuid
      and business_id = p_business;

    if not found then
      raise exception 'Product not found in this business.';
    end if;

    v_qty  := coalesce((v_item->>'qty')::numeric, 0);
    v_disc := coalesce((v_item->>'discount')::numeric, 0);

    if v_qty <= 0 then
      raise exception 'Quantity for % must be at least 1.', v_product.name;
    end if;

    select stock into v_stock from public.product_stock where product_id = v_product.id;

    if coalesce(v_stock, 0) < v_qty then
      raise exception 'Not enough stock for %: % in stock, % requested.',
        v_product.name, coalesce(v_stock, 0), v_qty;
    end if;

    v_price      := public.sale_price_for(p_business, v_product.id);
    v_line_total := greatest(0, (v_qty * v_price) - v_disc);
    v_line_no    := v_line_no + 1;
    v_subtotal   := v_subtotal + (v_qty * v_price);
    v_discount   := v_discount + v_disc;

    insert into public.invoice_lines (
      business_id, invoice_id, product_id, sku, name,
      qty, unit_price, discount, line_total, line_no)
    values (
      p_business, v_inv.id, v_product.id, v_product.sku, v_product.name,
      v_qty, v_price, v_disc, v_line_total, v_line_no);

    insert into public.stock_movements (
      business_id, product_id, kind, direction, qty,
      unit_price, total, reference, invoice_id, created_by)
    values (
      p_business, v_product.id, 'SALE', 'OUT', v_qty,
      v_price, v_line_total, v_no, v_inv.id, auth.uid());
  end loop;

  v_grand := v_subtotal - v_discount + coalesce(p_delivery_charge, 0);

  update public.invoices
  set subtotal    = v_subtotal,
      discount    = v_discount,
      grand_total = v_grand,
      due_amount  = v_grand - coalesce(p_advance_paid, 0)
  where id = v_inv.id
  returning * into v_inv;

  return v_inv;
end $$;

-- ---------------------------------------------------------------------------
-- Void an invoice: reverse the stock and mark it void.
--
-- Nothing is deleted. The invoice stays visible with voided_at set, and
-- compensating IN movements restore the stock, so the ledger still explains
-- every unit that ever moved. Manager or owner only.
-- ---------------------------------------------------------------------------
create or replace function public.void_invoice(p_invoice uuid, p_reason text default null)
returns public.invoices
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_inv  public.invoices;
  v_line public.invoice_lines;
begin
  select * into v_inv from public.invoices where id = p_invoice;
  if not found then
    raise exception 'Invoice not found.';
  end if;
  if not public.is_manager(v_inv.business_id) then
    raise exception 'Only a manager or owner can void an invoice.';
  end if;
  if v_inv.voided_at is not null then
    raise exception 'Invoice % is already voided.', v_inv.invoice_no;
  end if;

  for v_line in
    select * from public.invoice_lines where invoice_id = p_invoice
  loop
    if v_line.product_id is not null then
      insert into public.stock_movements (
        business_id, product_id, kind, direction, qty,
        unit_price, total, reference, note, invoice_id, created_by)
      values (
        v_inv.business_id, v_line.product_id, 'VOID', 'IN', v_line.qty,
        v_line.unit_price, v_line.line_total,
        'Void ' || v_inv.invoice_no, p_reason, v_inv.id, auth.uid());
    end if;
  end loop;

  update public.invoices
  set voided_at = now(), voided_by = auth.uid(),
      note = coalesce(note || ' | ', '') || 'VOIDED: ' || coalesce(p_reason, 'no reason given')
  where id = p_invoice
  returning * into v_inv;

  return v_inv;
end $$;

-- ---------------------------------------------------------------------------
-- Receive stock for several products at once.
-- p_lines: [{"product_id":"...","qty":10,"unit_cost":900}, ...]
-- ---------------------------------------------------------------------------
create or replace function public.receive_stock(
  p_business  uuid,
  p_lines     jsonb,
  p_supplier  text default null,
  p_reference text default null,
  p_note      text default null
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_line jsonb;
  v_prod public.products;
  v_qty  numeric;
  v_cost numeric;
  v_n    int := 0;
begin
  if not public.is_member(p_business) then
    raise exception 'You do not have access to this business.';
  end if;
  if p_lines is null or jsonb_array_length(p_lines) = 0 then
    raise exception 'Add at least one product.';
  end if;

  for v_line in select * from jsonb_array_elements(p_lines)
  loop
    select * into v_prod from public.products
    where id = (v_line->>'product_id')::uuid and business_id = p_business;
    if not found then
      raise exception 'Product not found in this business.';
    end if;

    v_qty  := coalesce((v_line->>'qty')::numeric, 0);
    v_cost := coalesce((v_line->>'unit_cost')::numeric, v_prod.cost_price);
    if v_qty <= 0 then
      raise exception 'Quantity for % must be at least 1.', v_prod.name;
    end if;

    insert into public.stock_movements (
      business_id, product_id, kind, direction, qty,
      unit_price, total, reference, supplier, note, created_by)
    values (
      p_business, v_prod.id, 'RECEIVE', 'IN', v_qty,
      v_cost, v_qty * v_cost, p_reference, p_supplier, p_note, auth.uid());

    -- keep cost price current when a real purchase cost is supplied
    if (v_line->>'unit_cost') is not null and v_cost > 0 then
      update public.products
      set cost_price = v_cost, updated_at = now()
      where id = v_prod.id;
    end if;

    v_n := v_n + 1;
  end loop;

  return v_n;
end $$;

-- ---------------------------------------------------------------------------
-- Stock adjustment: return / found (IN), or damage / loss / recount (OUT).
-- ---------------------------------------------------------------------------
create or replace function public.adjust_stock(
  p_business   uuid,
  p_product    uuid,
  p_qty        numeric,
  p_direction  text,
  p_reason     text,
  p_note       text default null
)
returns public.stock_movements
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_prod  public.products;
  v_stock numeric;
  v_mv    public.stock_movements;
begin
  if not public.is_member(p_business) then
    raise exception 'You do not have access to this business.';
  end if;
  if coalesce(btrim(p_reason), '') = '' then
    raise exception 'A reason is required for a stock adjustment.';
  end if;
  if p_qty is null or p_qty <= 0 then
    raise exception 'Quantity must be at least 1.';
  end if;
  if upper(p_direction) not in ('IN', 'OUT') then
    raise exception 'Direction must be IN or OUT.';
  end if;

  select * into v_prod from public.products
  where id = p_product and business_id = p_business;
  if not found then
    raise exception 'Product not found in this business.';
  end if;

  if upper(p_direction) = 'OUT' then
    select stock into v_stock from public.product_stock where product_id = p_product;
    if coalesce(v_stock, 0) < p_qty then
      raise exception 'Only % in stock for %.', coalesce(v_stock, 0), v_prod.name;
    end if;
  end if;

  insert into public.stock_movements (
    business_id, product_id, kind, direction, qty,
    unit_price, total, reference, note, created_by)
  values (
    p_business, p_product,
    case when upper(p_direction) = 'IN' then 'RETURN'::public.movement_kind
         else 'ADJUST'::public.movement_kind end,
    upper(p_direction), p_qty,
    v_prod.cost_price, p_qty * v_prod.cost_price, p_reason, p_note, auth.uid())
  returning * into v_mv;

  return v_mv;
end $$;

-- ---------------------------------------------------------------------------
-- Dashboard figures in one round trip.
-- ---------------------------------------------------------------------------
create or replace function public.dashboard(p_business uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_tz        text := 'Asia/Dhaka';
  v_month     date := date_trunc('month', now() at time zone v_tz)::date;
  v_prev      date := (date_trunc('month', now() at time zone v_tz) - interval '1 month')::date;
  v_result    jsonb;
begin
  if not public.is_member(p_business) then
    raise exception 'You do not have access to this business.';
  end if;

  select jsonb_build_object(
    'month_revenue', coalesce((select sum(grand_total) from public.invoices
        where business_id = p_business and voided_at is null
          and (created_at at time zone v_tz)::date >= v_month), 0),
    'prev_revenue', coalesce((select sum(grand_total) from public.invoices
        where business_id = p_business and voided_at is null
          and (created_at at time zone v_tz)::date >= v_prev
          and (created_at at time zone v_tz)::date <  v_month), 0),
    'month_orders', (select count(*) from public.invoices
        where business_id = p_business and voided_at is null
          and (created_at at time zone v_tz)::date >= v_month),
    'prev_orders', (select count(*) from public.invoices
        where business_id = p_business and voided_at is null
          and (created_at at time zone v_tz)::date >= v_prev
          and (created_at at time zone v_tz)::date <  v_month),
    'month_units', coalesce((select sum(l.qty) from public.invoice_lines l
        join public.invoices i on i.id = l.invoice_id
        where l.business_id = p_business and i.voided_at is null
          and (i.created_at at time zone v_tz)::date >= v_month), 0),
    'prev_units', coalesce((select sum(l.qty) from public.invoice_lines l
        join public.invoices i on i.id = l.invoice_id
        where l.business_id = p_business and i.voided_at is null
          and (i.created_at at time zone v_tz)::date >= v_prev
          and (i.created_at at time zone v_tz)::date <  v_month), 0),
    'customers', (select count(*) from public.customers where business_id = p_business),
    'stock_value', coalesce((select sum(stock * sell_price) from public.product_stock
        where business_id = p_business and stock > 0), 0),
    'stock_units', coalesce((select sum(stock) from public.product_stock
        where business_id = p_business and stock > 0), 0),
    'out_of_stock', (select count(*) from public.product_stock
        where business_id = p_business and state = 'out'),
    'low_stock', (select count(*) from public.product_stock
        where business_id = p_business and state = 'low'),
    'products', (select count(*) from public.products where business_id = p_business),
    'cost_missing', (select count(*) from public.products
        where business_id = p_business and coalesce(cost_price, 0) = 0),
    'web_pending', (select count(*) from public.web_orders
        where business_id = p_business and invoice_id is null),
    'months', coalesce((
        select jsonb_agg(row_to_json(t)) from (
          select to_char(d.m, 'YYYY-MM') as key,
                 to_char(d.m, 'Mon ''YY') as label,
                 coalesce(sum(i.grand_total), 0) as revenue,
                 coalesce(sum(l.units), 0)       as units,
                 count(distinct i.id)            as orders
          from generate_series(
                 date_trunc('month', now() at time zone v_tz) - interval '13 months',
                 date_trunc('month', now() at time zone v_tz),
                 interval '1 month') as d(m)
          left join public.invoices i
            on i.business_id = p_business
           and i.voided_at is null
           and date_trunc('month', i.created_at at time zone v_tz) = d.m
          left join lateral (
            select sum(qty) as units from public.invoice_lines
            where invoice_id = i.id) l on true
          group by d.m
          order by d.m
        ) t), '[]'::jsonb)
  ) into v_result;

  return v_result;
end $$;
