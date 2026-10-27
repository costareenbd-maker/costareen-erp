-- 151 (27 Oct 2026, cost-fix-1): striking a shipment cost out re-costs the draws already made from its lots (and the
-- sale lines they fed). lot_draws had no update policy, so the correction silently changed nothing there.
drop policy if exists lot_draws_cost on public.lot_draws;
create policy lot_draws_cost on public.lot_draws for update to authenticated
  using (business_id in (select public.my_business_ids('manager')))
  with check (business_id in (select public.my_business_ids('manager')));
grant update (unit_cost) on public.lot_draws to authenticated;
