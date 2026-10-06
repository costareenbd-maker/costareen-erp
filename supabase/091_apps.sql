-- control-only (the installer never copies this file into a company's database)
-- The Apps page (docs/CHANGES.md "Apps page"): every screen that is not part of the core menu, and every public
-- network page, is an "app". The provider switches an app on or off for EVERY company here (off = invisible
-- everywhere, the public page answers "not open yet"). A company's owner hides or shows an app in its own menu
-- in business_config ('apps_hidden'), which lives in the company's own database.
create table if not exists public.erp_app_flags (
  key         text primary key,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  uuid
);
-- server-only, like every control table: the function reads and writes it on its own connection
alter table public.erp_app_flags enable row level security;
revoke all on public.erp_app_flags from anon, authenticated;
