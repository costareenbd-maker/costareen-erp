-- ============================================================================
-- COSTAREEN ERP - Settings group (people, backups)
-- ----------------------------------------------------------------------------
-- Run AFTER 008. Idempotent.
--
-- 1. erp_add_member: a shareholder adds a person to THIS business.
--    memberships can only be written by an owner (001 memberships_write), but
--    the sheet ERP let a shareholder add managers and sales staff
--    (ERP.js:4514). This function does exactly that much and no more:
--      - caller must be shareholder+ of the business,
--      - owner / shareholder roles need the caller to be the owner,
--      - only a person this business itself added (erp_people.home_business)
--        can be given a role, and an existing membership is never changed.
-- 2. erp_backup_log: what ERP_BK_LAST (script property) held - when each
--    backup was made, why, and what failed.
-- ============================================================================

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
  if not exists (select 1 from public.erp_people
                 where user_id = p_user and home_business = p_business) then
    raise exception 'That person is not in the list.';
  end if;
  insert into public.memberships (business_id, user_id, role)
  values (p_business, p_user, p_role)
  on conflict (business_id, user_id) do nothing;
end $$;

revoke all on function public.erp_add_member(uuid, uuid, public.member_role) from public, anon;

create table if not exists public.erp_backup_log (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  at          timestamptz not null default now(),
  why         text,                      -- 'night' | 'by hand'
  made        int not null default 0,
  failed      jsonb not null default '[]'::jsonb,
  file_name   text
);
create index if not exists erp_backup_log_idx on public.erp_backup_log(business_id, at desc);

do $$
declare t text;
begin
  foreach t in array array['erp_backup_log']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %1$s_member_read on public.%1$s', t);
    execute format('create policy %1$s_member_read on public.%1$s for select using (public.is_member(business_id))', t);

    execute format('drop policy if exists %1$s_member_insert on public.%1$s', t);
    execute format('create policy %1$s_member_insert on public.%1$s for insert with check (public.is_member(business_id))', t);

    execute format('drop policy if exists %1$s_member_update on public.%1$s', t);
    execute format('create policy %1$s_member_update on public.%1$s for update using (public.is_member(business_id)) with check (public.is_member(business_id))', t);

    execute format('drop policy if exists %1$s_manager_delete on public.%1$s', t);
    execute format('create policy %1$s_manager_delete on public.%1$s for delete using (public.is_manager(business_id))', t);
  end loop;
end $$;

-- ============================================================================
-- GRANTS (same rule as 004/007) - then take the secrets back out
-- ============================================================================
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on public.business_secrets from anon, authenticated;
revoke all on public.erp_device_locks from anon, authenticated;
