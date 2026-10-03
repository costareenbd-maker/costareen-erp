-- Platform admin (Odoo's database manager): the people who run the system for
-- every business on it - list, create, suspend businesses, send an owner a
-- reset link, see health. A platform admin has NO role inside a customer's
-- business unless that owner adds them; every platform action is written to
-- the business's own activity log, where its owner can read it.
create table if not exists public.platform_admins (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now(),
  note     text
);
-- server-only: no policy, so no login can read or write it through the API
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from anon, authenticated;

alter table public.businesses add column if not exists suspended_at     timestamptz;
alter table public.businesses add column if not exists suspended_reason text;

-- the first platform admin: the owner of the business this system was built for
insert into public.platform_admins (user_id, note)
select id, 'first admin (043)' from auth.users where lower(email) = 'costareen.bd@gmail.com'
on conflict (user_id) do nothing;

-- a platform action, written into the business's own activity log inside the
-- same transaction as the action (so a business created in that transaction
-- can be logged too). Only a platform admin may call it.
create or replace function public.platform_log(p_business uuid, p_who text, p_action text, p_detail text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (select 1 from public.platform_admins where user_id = auth.uid()) then
    raise exception 'Your account does not have access to that.';
  end if;
  insert into public.erp_activity (business_id, user_id, who, role, action, detail)
  values (p_business, auth.uid(), p_who, 'platform', p_action, left(coalesce(p_detail, ''), 300));
end $$;
revoke all on function public.platform_log(uuid, text, text, text) from public, anon;
grant execute on function public.platform_log(uuid, text, text, text) to authenticated;
