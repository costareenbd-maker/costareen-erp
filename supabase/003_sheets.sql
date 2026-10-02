-- ============================================================================
-- COSTAREEN ERP - Google Sheets mirroring
-- ----------------------------------------------------------------------------
-- Run AFTER 002_functions.sql. Idempotent.
--
-- Model: the app is the system of record, the sheet is a live mirror.
-- Every business can have ONE connected spreadsheet, either
--   'created'  - the app made it (one-click), owner is the customer
--   'existing' - the customer pointed us at a sheet they already have
--
-- Nothing here writes to Google. Writing happens in the Edge Function
-- (sync-sheet), which reads these rows to know where to write and what has
-- already been sent. Keeping the cursor in Postgres means a crashed sync
-- resumes instead of duplicating rows.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Google credentials per business.
--
-- The refresh token is a real secret. RLS restricts it to the OWNER of the
-- business, and the sync function reads it with the service role. Never
-- expose this table to a staff role, and never select refresh_token into
-- anything the browser can see.
-- ---------------------------------------------------------------------------
create table if not exists public.google_connections (
  business_id    uuid primary key references public.businesses(id) on delete cascade,
  google_email   text,
  refresh_token  text,
  scopes         text,
  connected_by   uuid references auth.users(id),
  connected_at   timestamptz not null default now(),
  last_error     text
);

alter table public.google_connections enable row level security;

drop policy if exists google_conn_owner on public.google_connections;
create policy google_conn_owner on public.google_connections
  for all using (public.is_owner(business_id))
  with check (public.is_owner(business_id));

-- ---------------------------------------------------------------------------
-- The connected spreadsheet and how far the mirror has got.
-- ---------------------------------------------------------------------------
create type public.sheet_origin as enum ('created', 'existing');

create table if not exists public.sheet_connections (
  business_id      uuid primary key references public.businesses(id) on delete cascade,
  spreadsheet_id   text not null,
  spreadsheet_url  text,
  origin           public.sheet_origin not null default 'created',
  auto_sync        boolean not null default true,

  -- Append cursors: the last row already mirrored, so a sync appends only
  -- what is new instead of rewriting the whole log every time.
  last_invoice_at  timestamptz,
  last_movement_at timestamptz,

  -- Full refresh covers the small tabs (products, stock, customers, dashboard)
  last_full_sync   timestamptz,
  last_sync_status text,
  last_error       text,
  created_at       timestamptz not null default now()
);

alter table public.sheet_connections enable row level security;

drop policy if exists sheet_conn_read on public.sheet_connections;
create policy sheet_conn_read on public.sheet_connections
  for select using (public.is_member(business_id));

drop policy if exists sheet_conn_write on public.sheet_connections;
create policy sheet_conn_write on public.sheet_connections
  for all using (public.is_manager(business_id))
  with check (public.is_manager(business_id));

-- ---------------------------------------------------------------------------
-- A short history of syncs, so a customer can see why the mirror is stale.
-- ---------------------------------------------------------------------------
create table if not exists public.sync_log (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null,            -- 'append' | 'full' | 'create'
  ok          boolean not null,
  rows_sent   int default 0,
  message     text,
  created_at  timestamptz not null default now()
);

create index if not exists sync_log_business_idx on public.sync_log(business_id, created_at desc);

alter table public.sync_log enable row level security;

drop policy if exists sync_log_read on public.sync_log;
create policy sync_log_read on public.sync_log
  for select using (public.is_member(business_id));

-- ---------------------------------------------------------------------------
-- Mark a business as needing a mirror update.
--
-- Rather than calling Google inside the sale transaction - which would make
-- every sale as slow and as fragile as the network - a sale just flags the
-- business here. The sync worker drains the queue. A failed Google call can
-- then never roll back or slow down a sale that already succeeded.
-- ---------------------------------------------------------------------------
create table if not exists public.sync_queue (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  dirty_since timestamptz not null default now(),
  attempts    int not null default 0
);

alter table public.sync_queue enable row level security;

drop policy if exists sync_queue_read on public.sync_queue;
create policy sync_queue_read on public.sync_queue
  for select using (public.is_member(business_id));

create or replace function public.mark_dirty(p_business uuid)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.sync_queue (business_id, dirty_since, attempts)
  values (p_business, now(), 0)
  on conflict (business_id) do update
    set dirty_since = least(public.sync_queue.dirty_since, now()),
        attempts    = 0;
$$;

-- Flag the business whenever money or stock moves.
create or replace function public.trg_mark_dirty()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.mark_dirty(coalesce(new.business_id, old.business_id));
  return coalesce(new, old);
end $$;

drop trigger if exists invoices_dirty on public.invoices;
create trigger invoices_dirty
  after insert or update on public.invoices
  for each row execute function public.trg_mark_dirty();

drop trigger if exists movements_dirty on public.stock_movements;
create trigger movements_dirty
  after insert on public.stock_movements
  for each row execute function public.trg_mark_dirty();

drop trigger if exists products_dirty on public.products;
create trigger products_dirty
  after insert or update on public.products
  for each row execute function public.trg_mark_dirty();

drop trigger if exists customers_dirty on public.customers;
create trigger customers_dirty
  after insert or update on public.customers
  for each row execute function public.trg_mark_dirty();

-- ---------------------------------------------------------------------------
-- Exactly the rows the mirror needs, shaped to match the sheet's own columns
-- so the Edge Function can write them straight across with no reshaping.
-- Column order here IS the sheet's column order - changing it changes the sheet.
-- ---------------------------------------------------------------------------

create or replace function public.sheet_products(p_business uuid)
returns table (
  sku text, product_name text, category text, brand text, type text,
  color text, unit text, supplier text, cost_price numeric, sell_price numeric,
  margin_pct numeric, reorder_level numeric, lead_time_days int,
  location_bin text, status text
)
language sql
security invoker
stable
set search_path = public
as $$
  select p.sku, p.name, p.category, p.brand, p.type, p.color, p.unit, p.supplier,
         p.cost_price, p.sell_price,
         case when p.sell_price > 0
              then round(((p.sell_price - p.cost_price) / p.sell_price) * 100, 2)
              else 0 end,
         p.reorder_level, p.lead_time_days, p.location_bin, p.status
  from public.products p
  where p.business_id = p_business and public.is_member(p_business)
  order by p.name;
$$;

create or replace function public.sheet_stock(p_business uuid)
returns table (
  sku text, product_name text, category text, brand text, color text,
  current_stock numeric, reorder_level numeric, stock_status text,
  sell_price numeric, stock_value numeric
)
language sql
security invoker
stable
set search_path = public
as $$
  select s.sku, s.name, s.category, s.brand, s.color,
         s.stock, s.reorder_level,
         case s.state when 'out' then 'OUT OF STOCK'
                      when 'low' then 'REORDER'
                      else 'IN STOCK' end,
         s.sell_price, round(s.stock * s.sell_price, 2)
  from public.product_stock s
  where s.business_id = p_business and public.is_member(p_business)
  order by s.name;
$$;

create or replace function public.sheet_sales(p_business uuid, p_since timestamptz)
returns table (
  order_id text, sold_at timestamptz, customer_name text, customer_contact text,
  customer_address text, sku text, product_name text, quantity numeric,
  unit_price numeric, line_total numeric, payment_method text,
  payment_status text, delivery_status text, discount numeric,
  delivery_charge numeric, grand_total numeric, advance_paid numeric,
  due_amount numeric, source text, voided boolean
)
language sql
security invoker
stable
set search_path = public
as $$
  select i.invoice_no, i.created_at, i.customer_name, i.customer_phone,
         i.customer_address, l.sku, l.name, l.qty, l.unit_price, l.line_total,
         i.payment_method, i.payment_status, i.delivery_status, i.discount,
         i.delivery_charge, i.grand_total, i.advance_paid, i.due_amount,
         i.source, (i.voided_at is not null)
  from public.invoices i
  join public.invoice_lines l on l.invoice_id = i.id
  where i.business_id = p_business
    and public.is_member(p_business)
    and (p_since is null or i.created_at > p_since)
  order by i.created_at, l.line_no;
$$;

create or replace function public.sheet_movements(p_business uuid, p_since timestamptz)
returns table (
  txn_id text, moved_at timestamptz, sku text, product_name text,
  txn_type text, direction text, quantity numeric, unit_price numeric,
  total_value numeric, reference text, supplier text, note text
)
language sql
security invoker
stable
set search_path = public
as $$
  select m.id::text, m.created_at, p.sku, p.name, m.kind::text, m.direction,
         m.qty, m.unit_price, m.total, m.reference, m.supplier, m.note
  from public.stock_movements m
  join public.products p on p.id = m.product_id
  where m.business_id = p_business
    and public.is_member(p_business)
    and (p_since is null or m.created_at > p_since)
  order by m.created_at;
$$;

create or replace function public.sheet_customers(p_business uuid)
returns table (
  customer_name text, contact_number text, email text, address text,
  customer_type text, total_orders bigint, total_spent numeric,
  last_order_date timestamptz, source text, status text
)
language sql
security invoker
stable
set search_path = public
as $$
  select c.name, c.phone, c.email, c.address, c.type,
         s.orders, s.spent, s.last_order_at, c.source, c.status
  from public.customers c
  join public.customer_stats s on s.customer_id = c.id
  where c.business_id = p_business and public.is_member(p_business)
  order by s.spent desc nulls last;
$$;
