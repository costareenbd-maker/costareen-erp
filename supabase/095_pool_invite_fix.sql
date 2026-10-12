-- Joint stock: "Start it" failed live with "function gen_random_bytes(integer) does not exist". 023 had moved the
-- invite code to gen_random_uuid (core) because gen_random_bytes lives in the "extensions" schema that a function
-- pinned to search_path = public cannot see; 075 rewrote the function and brought gen_random_bytes back. Same body
-- as 075, the code made from a uuid.
create or replace function public.create_pool_invite(p_pool uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_pool(p_pool) or not (public.erp_system() or public.is_owner(p_pool)) then
    raise exception 'Only an owner of the pool can invite a partner.';
  end if;
  v_code := upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 10));
  insert into public.pool_invites (code, pool_id, created_by)
  values (v_code, p_pool, auth.uid());
  return v_code;
end $$;
