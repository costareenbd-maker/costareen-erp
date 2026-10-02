-- ============================================================================
-- COSTAREEN ERP - role grants
-- ----------------------------------------------------------------------------
-- Run AFTER 003_sheets.sql. Idempotent.
--
-- RLS decides WHICH ROWS a user may see. Grants decide whether the role may
-- touch the table at all. Both are required: without these grants every query
-- fails with "permission denied", and with grants but no RLS every tenant
-- would see everything. Tables created outside the Supabase SQL editor do not
-- pick up the default privileges, which is why this file exists.
--
-- `anon` (not signed in) is deliberately granted NOTHING on business tables.
-- Every screen in the app requires a login, so there is no reason for the
-- unauthenticated role to reach business data even with RLS in front of it.
-- ============================================================================

grant usage on schema public to anon, authenticated;

-- Signed-in users: full DML, with RLS doing the filtering.
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;

-- Anything created later gets the same treatment automatically.
alter default privileges in schema public
  grant select, insert, update, delete on tables to authenticated;
alter default privileges in schema public
  grant usage, select on sequences to authenticated;
alter default privileges in schema public
  grant execute on functions to authenticated;

-- Belt and braces: make sure RLS really is on everywhere, including any table
-- added later that someone forgot to protect.
do $$
declare t record;
begin
  for t in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity
  loop
    execute format('alter table public.%I enable row level security', t.relname);
    raise notice 'enabled RLS on %', t.relname;
  end loop;
end $$;

-- Views must run as the caller, or RLS on the tables underneath is evaluated
-- as the view's owner and tenant isolation is silently bypassed.
do $$
declare v record;
begin
  for v in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'v'
  loop
    execute format('alter view public.%I set (security_invoker = true)', v.relname);
  end loop;
end $$;
