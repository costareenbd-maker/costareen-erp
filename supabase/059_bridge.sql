-- control-only (the installer never copies this file into a company's database)
-- The bridge (docs/PLATFORM-BLUEPRINT.md): the provider's server runs each company's ERP against that company's
-- own Supabase. Per company: its project address, public key, and - sealed with ERP_BRIDGE_KEY - its database
-- URL and service key. status: active | disconnected (the provider can no longer reach it: the ERP locks) |
-- locked (switched off by the provider, with a reason the company sees).
create table if not exists public.erp_tenants (
  id          uuid primary key references public.erp_installs(id) on delete cascade,
  status      text not null default 'active' check (status in ('active', 'disconnected', 'locked')),
  url         text not null,
  anon_key    text not null,
  secret_enc  text not null,
  reason      text,
  checked_at  timestamptz,
  check_error text,
  made_at     timestamptz not null default now()
);
alter table public.erp_tenants enable row level security;
revoke all on public.erp_tenants from anon, authenticated;
-- no policies: only the server's own connection reads it
