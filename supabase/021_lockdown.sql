-- ============================================================================
-- COSTAREEN ERP - lock-down
-- ----------------------------------------------------------------------------
-- Run AFTER 020. Idempotent.
--
-- Every screen reaches the data through the `erp` Edge Function, which runs
-- each call as the signed-in person (role `authenticated`) under row-level
-- security. Nothing in the app ever reads a table as `anon` (not signed in),
-- so `anon` gets nothing at all - RLS already returned it no rows; this takes
-- the door away as well as locking it.
--
-- Supabase's default privileges hand every NEW table and function to `anon`
-- too (that is how 183 grants appeared on tables created after 004), so the
-- defaults are changed as well as today's grants.
-- ============================================================================

revoke all on all tables    in schema public from anon;
revoke all on all sequences in schema public from anon;
revoke all on all functions in schema public from anon, public;

alter default privileges in schema public revoke all on tables    from anon;
alter default privileges in schema public revoke all on sequences from anon;
alter default privileges in schema public revoke all on functions from anon, public;

-- signed-in people keep what RLS then filters
grant usage on schema public to authenticated;
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- tables only the Edge Function's privileged connection may touch
revoke all on public.business_secrets from anon, authenticated;
revoke all on public.erp_device_locks from anon, authenticated;
revoke all on public.erp_dash_cache   from anon, authenticated;

-- the deploy log exists on the live project only; it was the one table without RLS
do $$
begin
  if to_regclass('public._erp_migrations') is not null then
    execute 'alter table public._erp_migrations enable row level security';
    execute 'revoke all on public._erp_migrations from anon, authenticated';
  end if;
end $$;

-- belt and braces: no table in public may ever be without RLS
do $$
declare t record;
begin
  for t in
    select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
  end loop;
end $$;

-- wrong-code counting now forgets after 15 quiet minutes, and is kept per
-- internet address as well as per device (a device id is chosen by the
-- browser, so on its own it limited nobody who changed it on every try)
alter table public.erp_device_locks add column if not exists updated_at timestamptz not null default now();
