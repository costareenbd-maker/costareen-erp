-- 147 (27 Oct 2026, fix-7): the "every action, like the owner" switch (058_user_powers.sql) now reaches the database.
-- A manager with that switch could name no money account - row security hid the accounts from anyone below
-- shareholder - so paying a supplier, an expense or a shipment from an account quietly came back with no accounts,
-- and the receive screen refused him with a sentence about advances. The rows open to an acting manager here;
-- the figures (cash balances, profit, capital) stay closed in allow.js (NOT_ACT), not by hiding rows.

create or replace function public.my_business_ids_act(p_level text)
returns setof uuid
language sql
stable
security definer
set search_path = public
as $$
  select * from public.my_business_ids(p_level)
  union
  select m.business_id
  from public.memberships m
  where m.user_id = auth.uid()
    and p_level in ('member', 'manager', 'shareholder')
    and coalesce(m.powers->>'act', '') = 'true'
    and public.is_manager(m.business_id)
$$;
grant execute on function public.my_business_ids_act(text) to authenticated;

drop policy if exists money_accounts_read on public.money_accounts;
create policy money_accounts_read on public.money_accounts
  for select using (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists money_moves_read on public.money_moves;
create policy money_moves_read on public.money_moves
  for select using (business_id in (select public.my_business_ids_act('shareholder')));
drop policy if exists money_moves_insert on public.money_moves;
create policy money_moves_insert on public.money_moves
  for insert with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists lot_funding_read on public.lot_funding;
create policy lot_funding_read on public.lot_funding for select to authenticated
  using (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists cash_ups_read on public.cash_ups;
create policy cash_ups_read on public.cash_ups for select to authenticated
  using (business_id in (select public.my_business_ids_act('shareholder')));
drop policy if exists cash_ups_write on public.cash_ups;
create policy cash_ups_write on public.cash_ups for insert to authenticated
  with check (business_id in (select public.my_business_ids_act('shareholder')));
