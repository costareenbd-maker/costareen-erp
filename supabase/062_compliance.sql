-- control-only (the installer never copies this file into a company's database)
-- Stage 1d: the provider's own list of compliance checks (each one is also written to the company's activity log).
create table if not exists public.erp_compliance_log (
  id           bigserial primary key,
  install_id   uuid references public.erp_installs(id) on delete set null,
  what         text not null,
  reason       text not null,
  viewer       uuid,
  viewer_name  text,
  rows         int,
  period_from  timestamptz,
  period_to    timestamptz,
  at           timestamptz not null default now()
);
alter table public.erp_compliance_log enable row level security;
revoke all on public.erp_compliance_log from anon, authenticated;
