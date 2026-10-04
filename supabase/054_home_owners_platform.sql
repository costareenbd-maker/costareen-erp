-- Every owner of the system's own ("home") business is a platform admin too, so a
-- second owner sees the Platform tab without a hand edit. Home business = one where
-- a founding platform admin (043 first admin, or "owner of this copy") is an owner.
-- Added rows carry the note 'home owner (054)'; only those are taken away again when
-- the person stops being an owner there. Founding admins are never touched.

create or replace function public.home_owner_platform_sync()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  b uuid := coalesce(new.business_id, old.business_id);
  u uuid := coalesce(new.user_id, old.user_id);
  home boolean;
begin
  select exists (
    select 1 from memberships m join platform_admins a on a.user_id = m.user_id
    where m.business_id = b and m.role = 'owner' and coalesce(a.note, '') <> 'home owner (054)'
  ) into home;
  if not home then return null; end if;
  if tg_op <> 'DELETE' and new.role = 'owner' then
    insert into platform_admins (user_id, note) values (u, 'home owner (054)') on conflict (user_id) do nothing;
  else
    -- no longer an owner of the home business (and not owner of another home business)
    if not exists (
      select 1 from memberships m
      where m.user_id = u and m.role = 'owner' and m.business_id <> b
        and exists (select 1 from memberships o join platform_admins a on a.user_id = o.user_id
                    where o.business_id = m.business_id and o.role = 'owner' and coalesce(a.note, '') <> 'home owner (054)')
    ) then
      delete from platform_admins where user_id = u and note = 'home owner (054)';
    end if;
  end if;
  return null;
end $$;

revoke all on function public.home_owner_platform_sync() from public, anon, authenticated;

drop trigger if exists memberships_home_owner_platform on public.memberships;
create trigger memberships_home_owner_platform
after insert or update of role or delete on public.memberships
for each row execute function public.home_owner_platform_sync();

-- owners already there today
insert into public.platform_admins (user_id, note)
select distinct m.user_id, 'home owner (054)'
from public.memberships m
where m.role = 'owner'
  and exists (select 1 from public.memberships o join public.platform_admins a on a.user_id = o.user_id
              where o.business_id = m.business_id and o.role = 'owner')
on conflict (user_id) do nothing;
