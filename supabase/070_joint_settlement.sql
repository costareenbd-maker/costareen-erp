-- Joint stock, the month-end sums (docs/JOINT-POOL-BLUEPRINT.md):
--  1. goods that came back reduce the pool's sales (a return note carries the value on its lines);
--  2. the slow-payer rule: a credit sale unpaid after N days (business_config joint_slow_days, 45)
--     counts as held by the partner who sold it;
--  3. sales an owner made under the floor price are listed for the partner;
--  4. a month is closed when EVERY partner has agreed (pool_month_agreed), not by one side alone.

create table if not exists public.pool_month_agreed (
  pool_id             uuid not null references public.businesses(id) on delete cascade,
  month               date not null check (month = date_trunc('month', month)::date),
  partner_business_id uuid not null references public.businesses(id) on delete cascade,
  agreed_by           uuid,
  agreed_name         text,
  agreed_at           timestamptz not null default now(),
  primary key (pool_id, month, partner_business_id)
);
alter table public.pool_month_agreed enable row level security;
drop policy if exists pool_month_agreed_read on public.pool_month_agreed;
create policy pool_month_agreed_read on public.pool_month_agreed for select
  using (pool_id in (select public.my_business_ids('member')));
drop policy if exists pool_month_agreed_write on public.pool_month_agreed;
create policy pool_month_agreed_write on public.pool_month_agreed for all
  using (pool_id in (select public.my_business_ids('owner')))
  with check (pool_id in (select public.my_business_ids('owner')));
grant select, insert, update, delete on public.pool_month_agreed to authenticated;

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
  v_slow    int := 45;
begin
  if not public.is_pool(p_pool) then
    raise exception 'This business is not a joint pool.';
  end if;
  if not public.is_manager(p_pool) then
    raise exception 'Only a manager or owner of the pool can see the settlement.';
  end if;

  -- the slow-payer days of this pool (Joint stock > Settings)
  begin
    select greatest(7, least(180, value::int)) into v_slow from public.business_config
    where business_id = p_pool and key = 'joint_slow_days' and value ~ '^[0-9]+$';
  exception when others then v_slow := 45; end;
  v_slow := coalesce(v_slow, 45);

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
    select i.id, i.sold_by, i.invoice_no, public.dhaka_date(i.created_at) as d,
           -- a return note (RTN-) carries what came back on its lines, as a minus
           case when i.invoice_no like 'RTN-%'
                then coalesce((select sum(l.line_total) from public.invoice_lines l where l.invoice_id = i.id), 0)
                else i.grand_total end as grand_total,
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
  -- the slow-payer rule: a sale on credit still unpaid after v_slow days is owed by the
  -- partner who made it (they chose the customer). Until then it is shared risk.
  slow as (
    select i.sold_by as pid,
           greatest(0, i.grand_total - coalesce((select sum(p.amount) from public.payments p
                                                  where p.business_id = p_pool and p.invoice_no = i.invoice_no
                                                    and public.dhaka_date(p.paid_at) < v_end), 0)) as amount
    from inv i
    where i.invoice_no not like 'RTN-%' and i.sold_by is not null
      and i.d + v_slow <= least(v_end - 1, public.dhaka_date(now()))
  ),
  -- what customers still owe the pool: sold, not yet paid, not yet overdue. It belongs to the
  -- partners in their shares, like the stock - nobody holds it as cash.
  recv as (
    select coalesce((select sum(grand_total) from inv), 0)
         - coalesce((select sum(amount) from pay), 0)
         - coalesce((select sum(amount) from slow), 0) as value
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
      coalesce((select sum(amount) from slow where slow.pid = p.pid), 0)          as overdue,
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
      capital + collected + overdue - purchases - expenses_paid - transfers_out + transfers_in as held,
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
        'overdue', round(coalesce((select sum(amount) from slow), 0), 2),
        'slow_days', v_slow,
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
        'overdue',       round(b.overdue, 2),
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
    -- sales an owner made under the floor price this month: the partner should know
    'below_floor', coalesce((select jsonb_agg(jsonb_build_object(
        'seller', j.seller_business_id, 'invoice', j.seller_invoice_no, 'amount', j.below_floor) order by j.created_at)
      from public.joint_sales j
      where j.pool_id = p_pool and j.below_floor > 0
        and date_trunc('month', public.dhaka_date(j.created_at))::date = v_month), '[]'::jsonb),
    -- which partners have said yes to this month's sums
    'agreed', coalesce((select jsonb_agg(a.partner_business_id) from public.pool_month_agreed a
                        where a.pool_id = p_pool and a.month = v_month), '[]'::jsonb),
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
