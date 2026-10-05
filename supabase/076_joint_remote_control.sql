-- control-only (the installer never copies this file into a company's database)
-- Joint stock for a company copy on the bridge: off until the provider switches it on (Platform > Company copies).
alter table public.erp_tenants add column if not exists joint boolean not null default false;
