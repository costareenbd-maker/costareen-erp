-- ============================================================================
-- COSTAREEN ERP - access by private link
-- ----------------------------------------------------------------------------
-- Run AFTER 026. Idempotent.
--
-- The sign-in screen is gone for now. The app opens for a device that holds
-- an access key, which arrives once in a private link. Only a hash of the key
-- is stored: the database cannot give a key back, and neither can a backup.
-- Each key acts as the person it was made for (today: the owner).
-- Server-only: no browser reads or writes this table.
-- ============================================================================

create table if not exists public.erp_access_keys (
  id          uuid primary key default gen_random_uuid(),
  key_hash    text not null unique,
  user_id     uuid not null references auth.users(id) on delete cascade,
  label       text not null default 'Access link',
  created_at  timestamptz not null default now(),
  last_used   timestamptz,
  revoked_at  timestamptz
);
alter table public.erp_access_keys enable row level security;
revoke all on public.erp_access_keys from anon, authenticated;
