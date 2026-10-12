-- A deleted business: who deleted it, and the copy it can come back from (kept 90 days).
create table if not exists public.erp_deleted_businesses (
  id           uuid primary key,          -- the business's old id (its copy lives under it in file storage)
  name         text not null,
  deleted_by   uuid not null,
  deleted_at   timestamptz not null default now(),
  backup_name  text not null,
  drive        boolean not null default false,
  restored_at  timestamptz,
  restored_as  uuid
);
alter table public.erp_deleted_businesses enable row level security;
revoke all on public.erp_deleted_businesses from anon, authenticated;
