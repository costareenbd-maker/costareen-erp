-- control-only (the installer never copies this file into a company's database)
-- Stage 1b (docs/PLATFORM-BLUEPRINT.md): the permanent install link and the brand.
--   erp_brand      one row: the name, sponsor line, colour and logo every install page and company ERP shows
--   erp_installs   + which terms the owner agreed to and when, and the sign-up's internet address (for the
--                    sign-up limit: 3 an hour from one address, 30 a day in all)
create table if not exists public.erp_brand (
  id          int primary key default 1 check (id = 1),
  name        text not null default '3D Owala ERP',
  sponsor     text,                      -- e.g. "Sponsored by ..." (only with the sponsor's written permission)
  accent      text,                      -- a colour like #2756c9; empty = the page's own
  logo        text,                      -- a small image as a data: URL (at most ~250 KB)
  updated_at  timestamptz not null default now()
);
insert into public.erp_brand (id) values (1) on conflict do nothing;
alter table public.erp_brand enable row level security;
revoke all on public.erp_brand from anon, authenticated;

alter table public.erp_installs add column if not exists terms_version text;
alter table public.erp_installs add column if not exists terms_at timestamptz;
alter table public.erp_installs add column if not exists signup_ip text;
create index if not exists erp_installs_signup_idx on public.erp_installs (signup_ip, made_at);
