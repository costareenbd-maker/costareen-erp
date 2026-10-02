-- ============================================================================
-- COSTAREEN ERP - redesign phase 5 (settings and security)
-- ----------------------------------------------------------------------------
-- Run AFTER 023. Idempotent.
--
-- The activity log: who opened the app and who changed what. Written only by
-- the server function (its own privileged connection), never by a browser;
-- read by the owner of the business under Settings > Security.
-- ============================================================================

create table if not exists public.erp_activity (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid,
  who         text,
  role        text,
  action      text not null,
  detail      text,
  device      text,
  ip          text,
  at          timestamptz not null default now()
);
create index if not exists erp_activity_idx on public.erp_activity(business_id, at desc);

alter table public.erp_activity enable row level security;
drop policy if exists erp_activity_read on public.erp_activity;
create policy erp_activity_read on public.erp_activity
  for select using (public.is_owner(business_id));

revoke all on public.erp_activity from anon, authenticated;
grant select on public.erp_activity to authenticated;

revoke all on all functions in schema public from anon, public;
grant execute on all functions in schema public to authenticated;
