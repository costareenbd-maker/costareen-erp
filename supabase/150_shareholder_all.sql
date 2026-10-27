-- 150 (27 Oct 2026): the owner's rule, said twice - a shareholder is the owner's equal: users, keys and connections
-- too. The row security that still said 'owner' opens to shareholders (and to a manager with the "every action"
-- switch). Kept the owner's: deleting the business (businesses_delete). A shareholder may not make or unmake an owner:
-- owner rows stay out of reach, and no row may be written with the owner role by anyone but an owner.

drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships
  for all using (public.is_owner(business_id) or (business_id in (select public.my_business_ids_act('shareholder')) and role <> 'owner'))
  with check (public.is_owner(business_id) or (business_id in (select public.my_business_ids_act('shareholder')) and role <> 'owner'));

drop policy if exists site_conn_owner on public.site_connections;
create policy site_conn_owner on public.site_connections
  for all using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists google_conn_owner on public.google_connections;
create policy google_conn_owner on public.google_connections
  for all using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists pool_invites_owner on public.pool_invites;
create policy pool_invites_owner on public.pool_invites
  for select using (pool_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists erp_ai_keys_owner on public.erp_ai_keys;
create policy erp_ai_keys_owner on public.erp_ai_keys
  for all using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists erp_activity_read on public.erp_activity;
create policy erp_activity_read on public.erp_activity
  for select using (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists investor_links_owner on public.investor_links;
create policy investor_links_owner on public.investor_links for all to authenticated
  using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

drop policy if exists customer_erasures_owner on public.customer_erasures;
create policy customer_erasures_owner on public.customer_erasures for all to authenticated
  using (business_id in (select public.my_business_ids_act('shareholder')))
  with check (business_id in (select public.my_business_ids_act('shareholder')));

-- erp_set_member (042): a shareholder (or a manager with the "every action" switch) sets the staff's roles and switches
-- them off; only an owner touches an owner, or makes one.
create or replace function public.erp_set_member(p_business uuid, p_user uuid, p_role public.member_role, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owners int;
  v_cur public.memberships;
  v_owner boolean;
begin
  v_owner := public.is_owner(p_business);
  if not v_owner and p_business not in (select public.my_business_ids_act('shareholder')) then
    raise exception 'Only the owner or a shareholder changes who may do what.';
  end if;
  select * into v_cur from public.memberships where business_id = p_business and user_id = p_user;
  if not found then
    raise exception 'That person is not in this business.';
  end if;
  if not v_owner and (v_cur.role = 'owner' or p_role = 'owner') then
    raise exception 'Only an owner changes an owner, or makes one.';
  end if;
  if p_user = auth.uid() and (not p_active or p_role <> v_cur.role) then
    raise exception 'You cannot switch yourself off or change your own role. Ask another owner.';
  end if;
  select count(*) into v_owners from public.memberships where business_id = p_business and role = 'owner' and active and user_id <> p_user;
  if v_cur.role = 'owner' and v_cur.active and (not p_active or p_role <> 'owner') and v_owners = 0 then
    raise exception 'That is the last owner. Make someone else an owner first.';
  end if;
  update public.memberships set role = p_role, active = p_active where business_id = p_business and user_id = p_user;
end $$;
