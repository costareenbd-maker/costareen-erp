-- 148 (27 Oct 2026, fix-7): the owner's rule - a shareholder opens every screen and action the owner has, except
-- who may do what (users, security), the keys and connections, backups and the platform. allow.js went from 'owner'
-- to 'shareholder' for those calls; the row security of the tables they write follows here (a manager with the
-- "every action" switch counts too, through my_business_ids_act). Kept at 'owner': businesses, memberships,
-- site/google connections, pool invites, AI keys, the activity log, investor links, customer erasures.

do $$
declare t text;
begin
  -- capital: holders, book, closed months (020), and the kept records (144)
  foreach t in array array['capital_holders', 'capital_book', 'capital_closed'] loop
    execute format('drop policy if exists %1$s_insert on public.%1$s', t);
    execute format('create policy %1$s_insert on public.%1$s for insert with check (business_id in (select public.my_business_ids_act(''shareholder'')))', t);
    execute format('drop policy if exists %1$s_update on public.%1$s', t);
    execute format('create policy %1$s_update on public.%1$s for update using (business_id in (select public.my_business_ids_act(''shareholder''))) with check (business_id in (select public.my_business_ids_act(''shareholder'')))', t);
  end loop;
  foreach t in array array['capital_reopens', 'voided_invoices', 'engine_brain', 'engine_brain_versions', 'engine_facts', 'engine_briefs', 'engine_actions'] loop
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids_act(''shareholder''))) with check (business_id in (select public.my_business_ids_act(''shareholder'')))', t || '_rw', t);
  end loop;
end $$;

drop policy if exists capital_closed_delete on public.capital_closed;
create policy capital_closed_delete on public.capital_closed for delete
  using (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists money_accounts_write on public.money_accounts;
create policy money_accounts_write on public.money_accounts
  for all using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));
drop policy if exists money_moves_update on public.money_moves;
create policy money_moves_update on public.money_moves
  for update using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists lot_funding_write on public.lot_funding;
create policy lot_funding_write on public.lot_funding for all to authenticated
  using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists commission_rules_write on public.commission_rules;
create policy commission_rules_write on public.commission_rules for all to authenticated
  using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists market_shares_owner on public.market_shares;
create policy market_shares_owner on public.market_shares for all
  using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists pool_month_agreed_write on public.pool_month_agreed;
create policy pool_month_agreed_write on public.pool_month_agreed for all
  using (pool_id in (select public.my_business_ids_act('shareholder')))
  with check (pool_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists erp_creator_clicks_rw on public.erp_creator_clicks;
create policy erp_creator_clicks_rw on public.erp_creator_clicks for all
  using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));
drop policy if exists erp_creator_catalog_rw on public.erp_creator_catalog;
create policy erp_creator_catalog_rw on public.erp_creator_catalog for all
  using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));
