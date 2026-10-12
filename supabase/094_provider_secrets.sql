-- control-only (the installer never copies this file into a company's database)
-- The provider's own secrets that the platform admin sets from the ERP (Platform screen): today the AI reader's
-- Gemini key. Sealed with ERP_BRIDGE_KEY (lib/bridge.js sealJSON) when the server has one. Never shown back.
create table if not exists public.erp_provider_secrets (
  key         text primary key,
  value_enc   text not null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
alter table public.erp_provider_secrets enable row level security;
revoke all on public.erp_provider_secrets from anon, authenticated;
