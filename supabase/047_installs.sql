-- The installer (bring your own Supabase).
--
-- On the provider's system (Costareen's):
--   erp_releases  one row per release: every server file and database step, as made by deploy.py release
--   erp_installs  every company's own copy: where it is, how far the install got, its last check-in
--   erp_install_invites  single-use links the provider hands out (#/install/<code>)
-- On every copy (and harmlessly on the provider's own):
--   erp_control   what the provider last said about this copy: active or switched off
-- All server-only: no policy, nothing reaches the page directly.

create table if not exists public.erp_releases (
  version   text primary key,
  made_at   timestamptz not null default now(),
  files     jsonb not null            -- {"functions/erp/index.ts": "...", "sql/001_schema.sql": "...", ...}
);

create table if not exists public.erp_install_invites (
  code_hash   text primary key,
  note        text,
  made_by     uuid,
  made_at     timestamptz not null default now(),
  expires_at  timestamptz not null,
  used_at     timestamptz,
  install_id  uuid
);

create table if not exists public.erp_installs (
  id            uuid primary key default gen_random_uuid(),
  company       text not null,
  owner_name    text not null,
  owner_email   text not null,
  status        text not null default 'installing',   -- installing | active | suspended | failed
  step          text not null default 'project',
  step_n        int  not null default 0,
  detail        text,
  error         text,
  ref           text,
  org_id        text,
  api_url       text,
  anon_key      text,
  version       text,
  mgmt_token    text,                                  -- the company's Supabase access token (server-only)
  secret_hash   text,                                  -- the install page's polling secret
  key_hash      text,                                  -- the copy's check-in key
  install_key   text,                                  -- handed to the copy once, cleared after the finish step
  stats         jsonb,
  last_seen     timestamptz,
  reason        text,
  made_at       timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create table if not exists public.erp_control (
  id          int primary key default 1 check (id = 1),
  status      text not null default 'active',
  message     text,
  checked_at  timestamptz
);

alter table public.erp_releases enable row level security;
alter table public.erp_install_invites enable row level security;
alter table public.erp_installs enable row level security;
alter table public.erp_control enable row level security;
revoke all on public.erp_releases, public.erp_install_invites, public.erp_installs, public.erp_control from anon, authenticated;
