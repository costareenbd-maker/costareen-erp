-- alerts-1 (owner 6 Nov 2026): phone alerts when the ERP app is closed (Web Push, lib/webpush.js, handlers/phonealerts.js).
-- Both tables are server-only (like erp_access_keys): the page reaches them through erpPhoneAlerts* calls only.

-- One VAPID key pair for this server, made by the first erpPushKey call. The public half goes to browsers.
create table if not exists public.erp_push_vapid (
  id          int primary key default 1 check (id = 1),
  public_key  text not null,
  private_jwk jsonb not null,
  subject     text not null default 'mailto:alerts@costareen.com',
  created_at  timestamptz not null default now()
);
alter table public.erp_push_vapid enable row level security;
revoke all on public.erp_push_vapid from anon, authenticated;

-- One row per device (browser) per business that switched "Phone alerts" on.
create table if not exists public.erp_push_subs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null,
  user_id     uuid,
  endpoint    text not null,
  p256dh      text not null,
  auth        text not null,
  label       text,
  created_at  timestamptz not null default now(),
  last_ok_at  timestamptz,
  fails       int not null default 0,
  unique (business_id, endpoint)
);
create index if not exists erp_push_subs_biz_idx on public.erp_push_subs(business_id);
alter table public.erp_push_subs enable row level security;
revoke all on public.erp_push_subs from anon, authenticated;
