-- Plan A7: partnership corrections.
--
--  1. The settlement counts MONEY RECEIVED, not invoices raised. A sale on
--     credit is not cash in the seller's hands; what customers still owe is
--     the pool's, shared like the stock. Each payment remembers which partner
--     took it (payments.received_by, set by trigger inside a pool).
--  2. A line in the pool's book is struck out, never removed, and stays
--     visible to every partner with who did it and why.

alter table public.payments add column if not exists received_by uuid references public.businesses(id);

create or replace function public.trg_payment_received_by()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.is_pool(new.business_id) then
    new.received_by := coalesce(new.received_by, public.my_partner_in(new.business_id));
  else
    new.received_by := null;
  end if;
  return new;
end $$;

drop trigger if exists payment_received_by on public.payments;
create trigger payment_received_by
  before insert on public.payments
  for each row execute function public.trg_payment_received_by();

alter table public.pool_ledger add column if not exists voided_at   timestamptz;
alter table public.pool_ledger add column if not exists voided_by   text;
alter table public.pool_ledger add column if not exists void_reason text;

-- nothing is deleted from the book any more
drop policy if exists pool_ledger_delete on public.pool_ledger;

create or replace function public.pool_settlement(p_pool uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_month   date := date_trunc('month', coalesce(p_month, public.dhaka_date(now())))::date;
  v_end     date := (date_trunc('month', coalesce(p_month, public.dhaka_date(now()))) + interval '1 month')::date;
  v_first   date;
  v_result  jsonb;
begin
  if not public.is_pool(p_pool) then
    raise exception 'This business is not a joint pool.';
  end if;
  if not public.is_manager(p_pool) then
    raise exception 'Only a manager or owner of the pool can see the settlement.';
  end if;

  select date_trunc('month', public.dhaka_date(created_at))::date into v_first
  from public.businesses where id = p_pool;
  v_first := least(v_first, v_month,
    coalesce((select date_trunc('month', min(entry_date))::date
              from public.pool_ledger where pool_id = p_pool), v_month),
    coalesce((select date_trunc('month', min(public.dhaka_date(created_at)))::date
              from public.invoices where business_id = p_pool), v_month),
    coalesce((select date_trunc('month', min(public.dhaka_date(created_at)))::date
              from public.stock_movements where business_id = p_pool), v_month));

  with
  partners as (
    select partner_business_id as pid, display_name, price_tier
    from public.pool_partners where pool_id = p_pool
  ),
  n as (select count(*)::numeric as cnt from partners),
  months as (
    select m::date as m, (m + interval '1 month')::date as m_end
    from generate_series(v_first, v_month, interval '1 month') g(m)
  ),
  -- capital balance per partner at a month's start and end
  cap as (
    select mo.m, p.pid,
      coalesce(sum(case when l.entry_date < mo.m
                        then case l.kind when 'CAPITAL_IN' then l.amount else -l.amount end end), 0) as at_start,
      coalesce(sum(case when l.entry_date < mo.m_end
                        then case l.kind when 'CAPITAL_IN' then l.amount else -l.amount end end), 0) as at_end
    from months mo
    cross join partners p
    left join public.pool_ledger l
      on l.pool_id = p_pool and l.partner_business_id = p.pid
     and l.kind in ('CAPITAL_IN', 'CAPITAL_OUT')
     and l.voided_at is null
    group by mo.m, p.pid
  ),
  cap_tot as (
    select m, sum(at_start) as tot_start, sum(at_end) as tot_end from cap group by m
  ),
  ratio as (
    select c.m, c.pid,
      case when t.tot_start > 0 then c.at_start / t.tot_start
           when t.tot_end   > 0 then c.at_end   / t.tot_end
           else 1 / (select cnt from n) end as r,
      case when t.tot_start > 0 then 'month_start'
           when t.tot_end   > 0 then 'month_end'
           else 'equal' end as basis
    from cap c join cap_tot t using (m)
  ),
  inv as (
    select i.id, i.sold_by, i.grand_total,
           date_trunc('month', public.dhaka_date(i.created_at))::date as m
    from public.invoices i
    where i.business_id = p_pool and i.voided_at is null
      and public.dhaka_date(i.created_at) < v_end
  ),
  cogs as (
    select inv.m, sum(l.qty * coalesce(l.unit_cost, 0)) as amt
    from inv join public.invoice_lines l on l.invoice_id = inv.id
    group by inv.m
  ),
  mv as (
    select kind, direction, total, paid_by,
           date_trunc('month', public.dhaka_date(created_at))::date as m
    from public.stock_movements
    where business_id = p_pool and public.dhaka_date(created_at) < v_end
  ),
  led as (
    select kind, partner_business_id as pid, to_business_id as to_pid, amount,
           date_trunc('month', entry_date)::date as m
    from public.pool_ledger
    where pool_id = p_pool and entry_date < v_end and voided_at is null
  ),
  -- money actually received from customers, to whoever took it (plan A7).
  -- What is not money - goods returned, an adjustment, credit moved about - is left out.
  pay as (
    select coalesce(p.received_by,
                    (select i.sold_by from public.invoices i
                     where i.business_id = p.business_id and i.invoice_no = p.invoice_no limit 1)) as pid,
           p.amount
    from public.payments p
    where p.business_id = p_pool and public.dhaka_date(p.paid_at) < v_end
      and lower(coalesce(p.method, '')) not in ('adjusted', 'returned', 'advance')
  ),
  -- what customers still owe the pool: sold, not yet paid. It belongs to the
  -- partners in their shares, like the stock - nobody holds it as cash.
  recv as (
    select coalesce((select sum(grand_total) from inv), 0)
         - coalesce((select sum(amount) from pay), 0) as value
  ),
  -- profit per month, before splitting
  month_pl as (
    select mo.m,
      coalesce((select sum(grand_total) from inv where inv.m = mo.m), 0) as revenue,
      coalesce((select amt from cogs where cogs.m = mo.m), 0)            as cogs,
      coalesce((select sum(amount) from led where led.m = mo.m and kind = 'EXPENSE'), 0) as expenses,
      coalesce((select sum(case when kind = 'RETURN' then total
                                when kind = 'ADJUST' then -total else 0 end)
                from mv where mv.m = mo.m), 0) as stock_gain
    from months mo
  ),
  month_profit as (
    select m, revenue, cogs, expenses, stock_gain,
           revenue - cogs - expenses + stock_gain as profit
    from month_pl
  ),
  share as (
    select r.pid, sum(r.r * mp.profit) as profit_share
    from ratio r join month_profit mp using (m)
    group by r.pid
  ),
  stock_book as (
    select coalesce((select sum(total) from mv where kind in ('RECEIVE', 'OPENING')), 0)
         + coalesce((select sum(stock_gain) from month_profit), 0)
         - coalesce((select sum(cogs) from month_profit), 0) as value
  ),
  per as (
    select p.pid, p.display_name, p.price_tier,
      (select at_end from cap where cap.pid = p.pid and cap.m = v_month)          as capital,
      (select r from ratio where ratio.pid = p.pid and ratio.m = v_month)         as ratio,
      coalesce((select profit_share from share where share.pid = p.pid), 0)       as profit_share,
      coalesce((select sum(amount) from pay where pay.pid = p.pid), 0)            as collected,
      coalesce((select sum(grand_total) from inv where sold_by = p.pid), 0)       as invoiced,
      coalesce((select sum(grand_total) from inv where sold_by = p.pid and inv.m = v_month), 0) as month_sales,
      coalesce((select sum(total) from mv where paid_by = p.pid
                and kind in ('RECEIVE', 'OPENING')), 0)                           as purchases,
      coalesce((select sum(amount) from led where pid = p.pid and kind = 'EXPENSE'), 0)  as expenses_paid,
      coalesce((select sum(amount) from led where pid = p.pid and kind = 'TRANSFER'), 0) as transfers_out,
      coalesce((select sum(amount) from led where to_pid = p.pid and kind = 'TRANSFER'), 0) as transfers_in
    from partners p
  ),
  bal as (
    select per.*,
      capital + collected - purchases - expenses_paid - transfers_out + transfers_in as held,
      capital + profit_share - ratio * ((select value from stock_book) + (select value from recv)) as due
    from per
  )
  select jsonb_build_object(
    'pool_id', p_pool,
    'month', to_char(v_month, 'YYYY-MM'),
    'closed', exists (select 1 from public.pool_settlements
                      where pool_id = p_pool and month = v_month),
    'ratio_basis', (select basis from ratio where m = v_month limit 1),
    'this_month', (select jsonb_build_object(
        'revenue', round(revenue, 2), 'cogs', round(cogs, 2),
        'expenses', round(expenses, 2), 'stock_gain', round(stock_gain, 2),
        'profit', round(profit, 2))
      from month_profit where m = v_month),
    'to_date', jsonb_build_object(
        'revenue',  round((select sum(revenue)  from month_profit), 2),
        'cogs',     round((select sum(cogs)     from month_profit), 2),
        'expenses', round((select sum(expenses) from month_profit), 2),
        'profit',   round((select sum(profit)   from month_profit), 2),
        'capital',  round((select sum(capital)  from per), 2),
        'stock_at_cost', round((select value from stock_book), 2),
        'receivables', round((select value from recv), 2),
        'basis', 'cash'),
    'months', (select jsonb_agg(jsonb_build_object(
        'month', to_char(mp.m, 'YYYY-MM'), 'profit', round(mp.profit, 2),
        'ratios', (select jsonb_object_agg(r.pid, round(r.r, 6))
                   from ratio r where r.m = mp.m))
        order by mp.m) from month_profit mp),
    'partners', (select jsonb_agg(jsonb_build_object(
        'business_id',   b.pid,
        'name',          b.display_name,
        'tier',          b.price_tier,
        'capital',       round(b.capital, 2),
        'ratio',         round(b.ratio, 6),
        'month_sales',   round(b.month_sales, 2),
        'profit_share',  round(b.profit_share, 2),
        'collected',     round(b.collected, 2),
        'invoiced',      round(b.invoiced, 2),
        'purchases',     round(b.purchases, 2),
        'expenses_paid', round(b.expenses_paid, 2),
        'transfers_out', round(b.transfers_out, 2),
        'transfers_in',  round(b.transfers_in, 2),
        'held',          round(b.held, 2),
        'due',           round(b.due, 2),
        'balance',       round(b.held - b.due, 2),
        -- top-up needed to bring this partner's capital level with the largest
        'top_up_to_equal', round((select max(capital) from per) - b.capital, 2))
        order by b.display_name) from bal b),
    'balance_check', round((select sum(held - due) from bal), 2),
    'partner_deals_open', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'date', d.deal_date, 'description', d.description,
        'qty', d.qty, 'amount', d.amount,
        'owed_to', d.from_business_id, 'owed_by', d.to_business_id,
        'confirmed', d.confirmed_at is not null) order by d.deal_date)
      from public.partner_deals d
      where d.settled_at is null
        and d.from_business_id in (select pid from partners)
        and d.to_business_id   in (select pid from partners)), '[]'::jsonb)
  ) into v_result;

  -- Who pays whom: match the largest payer with the largest receiver.
  declare
    v_pay   jsonb := '[]'::jsonb;
    v_from  record;
    v_to    record;
    v_amt   numeric;
    v_bals  jsonb := '{}'::jsonb;
  begin
    select jsonb_object_agg(x->>'business_id', (x->>'balance')::numeric)
      into v_bals from jsonb_array_elements(v_result->'partners') x;
    loop
      select key, value::numeric as amt into v_from
        from jsonb_each_text(v_bals) order by value::numeric desc limit 1;
      select key, value::numeric as amt into v_to
        from jsonb_each_text(v_bals) order by value::numeric asc limit 1;
      exit when v_from.amt < 0.01 or v_to.amt > -0.01;
      v_amt := least(v_from.amt, -v_to.amt);
      v_pay := v_pay || jsonb_build_object(
        'from', v_from.key, 'to', v_to.key, 'amount', round(v_amt, 2));
      v_bals := v_bals || jsonb_build_object(v_from.key, v_from.amt - v_amt,
                                             v_to.key,   v_to.amt + v_amt);
    end loop;
    v_result := v_result || jsonb_build_object('transfers', v_pay);
  end;

  return v_result;
end $$;
