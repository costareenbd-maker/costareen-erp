-- ============================================================================
-- COSTAREEN ERP - redesign phase 4 (money screens)
-- ----------------------------------------------------------------------------
-- Run AFTER 022. Idempotent.
--   * an expense can carry a receipt (a photo or PDF kept in file storage)
--   * invite codes no longer need pgcrypto on the search path
-- ============================================================================

alter table public.expenses add column if not exists receipt text;

-- gen_random_bytes lives in the "extensions" schema on Supabase, which a
-- function pinned to search_path = public cannot see. gen_random_uuid is core.
create or replace function public.create_pool_invite(p_pool uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_pool(p_pool) or not public.is_owner(p_pool) then
    raise exception 'Only an owner of the pool can invite a partner.';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.pool_invites (code, pool_id, created_by)
  values (v_code, p_pool, auth.uid());
  return v_code;
end $$;

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
