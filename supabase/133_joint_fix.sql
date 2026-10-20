-- joint-fix (20 Oct 2026): the joint stock's month end, made safe (owner: "fix all of them").
--  1. Stock at cost no longer counts sponsorship rolls lent to brands (they left at zero value): shown apart as
--     lent_to_brands. The money each partner is owed does not change (it already counted them, as stock).
--  2. "Agree" is tied to the figures: each agreement keeps a fingerprint of the month's sums; an agreement to
--     different sums no longer counts (the partner sees "agreed to earlier figures" and agrees again).
--  3. Months close in order: a month cannot be agreed or closed while an earlier month with activity is open.

alter table public.pool_month_agreed add column if not exists figures text;

-- the earliest finished month with any activity that is not closed yet
create or replace function public.pool_first_open_month(p_pool uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select min(a.m) from (
    select date_trunc('month', entry_date)::date as m from public.pool_ledger where pool_id = p_pool and voided_at is null
    union select date_trunc('month', public.dhaka_date(created_at))::date from public.invoices where business_id = p_pool
    union select date_trunc('month', public.dhaka_date(created_at))::date from public.stock_movements where business_id = p_pool
  ) a
  where a.m < date_trunc('month', public.dhaka_date(now()))::date
    and not exists (select 1 from public.pool_settlements s where s.pool_id = p_pool and s.month = a.m);
$$;
grant execute on function public.pool_first_open_month(uuid) to authenticated;

-- the sums of 075 stay as they are, under a new name; pool_settlement adds what is below
do $$ begin
  if not exists (select 1 from pg_proc where proname = 'pool_settlement_core' and pronamespace = 'public'::regnamespace) then
    alter function public.pool_settlement(uuid, date) rename to pool_settlement_core;
  end if;
end $$;

create or replace function public.pool_settlement(p_pool uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_month date := date_trunc('month', coalesce(p_month, public.dhaka_date(now())))::date;
  v_end   date := (date_trunc('month', coalesce(p_month, public.dhaka_date(now()))) + interval '1 month')::date;
  r       jsonb;
  v_lent  numeric;
  v_fig   text;
begin
  r := public.pool_settlement_core(p_pool, p_month);

  -- sponsorship rolls still with the brands (out minus replaced), at today's cost
  select coalesce(sum(x.n * coalesce(p.cost_price, 0)), 0) into v_lent
  from (select product_id, sum(case when direction = 'OUT' then qty else -qty end) as n
        from public.stock_movements
        where business_id = p_pool and note like 'Sponsorship rolls%' and public.dhaka_date(created_at) < v_end
        group by product_id) x
  join public.products p on p.id = x.product_id
  where x.n > 0;
  r := jsonb_set(r, '{to_date,stock_at_cost}', to_jsonb(round((r->'to_date'->>'stock_at_cost')::numeric - v_lent, 2)));
  r := jsonb_set(r, '{to_date,lent_to_brands}', to_jsonb(round(v_lent, 2)));

  -- the fingerprint of what is being agreed: the month's sums and every partner's share and balance
  v_fig := md5(coalesce(r->'this_month', 'null'::jsonb)::text ||
               coalesce((select jsonb_agg(jsonb_build_array(x->>'business_id', x->>'profit_share', x->>'balance') order by x->>'business_id')
                         from jsonb_array_elements(r->'partners') x), '[]'::jsonb)::text);
  return r || jsonb_build_object(
    'figures', v_fig,
    'agreed', coalesce((select jsonb_agg(a.partner_business_id) from public.pool_month_agreed a
                        where a.pool_id = p_pool and a.month = v_month and a.figures = v_fig), '[]'::jsonb),
    'agreed_stale', coalesce((select jsonb_agg(a.partner_business_id) from public.pool_month_agreed a
                              where a.pool_id = p_pool and a.month = v_month and a.figures is distinct from v_fig), '[]'::jsonb),
    'first_open', to_char(public.pool_first_open_month(p_pool), 'YYYY-MM'));
end $$;
grant execute on function public.pool_settlement(uuid, date) to authenticated;

create or replace function public.close_pool_month(p_pool uuid, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month  date := date_trunc('month', p_month)::date;
  v_lock   date;
  v_first  date;
  v_report jsonb;
begin
  if not public.is_pool(p_pool) or not (public.erp_system() or public.is_owner(p_pool)) then
    raise exception 'Only an owner of the pool can close a month.';
  end if;
  if v_month >= date_trunc('month', public.dhaka_date(now()))::date then
    raise exception 'A month can only be closed after it has ended.';
  end if;
  if exists (select 1 from public.pool_settlements where pool_id = p_pool and month = v_month) then
    raise exception 'That month is already closed.';
  end if;
  v_first := public.pool_first_open_month(p_pool);
  if v_first is not null and v_first < v_month then
    raise exception 'Close % first: months are closed in order.', to_char(v_first, 'FMMonth YYYY');
  end if;
  v_lock := public.pool_locked_until(p_pool);
  if v_lock is not null and v_month < v_lock then
    raise exception 'That month is already closed.';
  end if;

  v_report := public.pool_settlement(p_pool, v_month) || jsonb_build_object('closed', true);
  insert into public.pool_settlements (pool_id, month, report, closed_by)
  values (p_pool, v_month, v_report, auth.uid());
  return v_report;
end $$;
