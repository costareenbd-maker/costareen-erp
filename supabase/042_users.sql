-- Per-person sign-in, Odoo's way: every user is an e-mail login with a role in
-- the business (memberships). A user can be switched off (active = false): the
-- login stays, history keeps the name, nothing opens.
alter table public.memberships add column if not exists active boolean not null default true;
alter table public.memberships add column if not exists added_at timestamptz not null default now();

-- the role functions see only active memberships, so a switched-off user gets nothing from RLS either
create or replace function public.member_role(b uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.memberships m
  where m.business_id = b and m.user_id = auth.uid() and m.active;
$$;
create or replace function public.is_member(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.business_id = b and m.user_id = auth.uid() and m.active
  );
$$;

-- erp_add_member: a person invited by e-mail is not in erp_people (that list is the old code system);
-- any real login may be added by the owner, a shareholder may add managers and sales
create or replace function public.erp_add_member(p_business uuid, p_user uuid, p_role public.member_role)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.my_rank(p_business) < 3 then
    raise exception 'Your account does not have access to that.';
  end if;
  if public.role_rank(p_role) >= 3 and not public.is_owner(p_business) then
    raise exception 'Only the owner can add an owner or a shareholder.';
  end if;
  if not exists (select 1 from auth.users where id = p_user) then
    raise exception 'That login does not exist.';
  end if;
  insert into public.memberships (business_id, user_id, role, active)
  values (p_business, p_user, p_role, true)
  on conflict (business_id, user_id) do update set role = excluded.role, active = true;
end $$;

-- erp_set_member: change a role, switch a user off or on. Owner only. The last
-- active owner can neither be switched off nor demoted, and nobody does it to themselves.
create or replace function public.erp_set_member(p_business uuid, p_user uuid, p_role public.member_role, p_active boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owners int;
  v_cur public.memberships;
begin
  if not public.is_owner(p_business) then
    raise exception 'Only the owner changes who may do what.';
  end if;
  select * into v_cur from public.memberships where business_id = p_business and user_id = p_user;
  if not found then
    raise exception 'That person is not in this business.';
  end if;
  if p_user = auth.uid() and (not p_active or p_role <> 'owner') then
    raise exception 'You cannot switch yourself off or demote yourself. Ask another owner.';
  end if;
  select count(*) into v_owners from public.memberships where business_id = p_business and role = 'owner' and active and user_id <> p_user;
  if v_cur.role = 'owner' and v_cur.active and (not p_active or p_role <> 'owner') and v_owners = 0 then
    raise exception 'That is the last owner. Make someone else an owner first.';
  end if;
  update public.memberships set role = p_role, active = p_active where business_id = p_business and user_id = p_user;
end $$;
revoke all on function public.erp_set_member(uuid, uuid, public.member_role, boolean) from public, anon;
grant execute on function public.erp_set_member(uuid, uuid, public.member_role, boolean) to authenticated;
