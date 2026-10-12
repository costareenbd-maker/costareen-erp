-- control-only (the installer never copies this file into a company's database)
-- Stage 1c: announcements the provider writes; every company's ERP shows the live ones (public ?install=news).
create table if not exists public.erp_news (
  id        bigserial primary key,
  text      text not null,
  level     text not null default 'info' check (level in ('info', 'warn')),
  until     timestamptz,
  made_at   timestamptz not null default now(),
  ended_at  timestamptz
);
alter table public.erp_news enable row level security;
revoke all on public.erp_news from anon, authenticated;
