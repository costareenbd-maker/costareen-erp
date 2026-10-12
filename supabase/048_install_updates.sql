-- installer-2: bringing a company's copy up to the newest release, and its own web address.
alter table public.erp_installs add column if not exists domain     text;
alter table public.erp_installs add column if not exists upd_to     text;      -- the release being put in
alter table public.erp_installs add column if not exists upd_step   text;      -- db | function | cron | null when not updating
alter table public.erp_installs add column if not exists upd_n      int not null default 0;
alter table public.erp_installs add column if not exists upd_error  text;
alter table public.erp_installs add column if not exists updated_to_at timestamptz;
create unique index if not exists erp_installs_domain_idx on public.erp_installs (lower(domain)) where domain is not null;
