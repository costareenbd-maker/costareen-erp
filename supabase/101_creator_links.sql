-- control-only (the installer never copies this file into a company's database)
-- Creator portal links (handlers/creatorportal.js): the permanent link of a creator and of a sponsoring brand.
-- Like erp_customer_links: only the hash is kept; the token is derived from the provider's secret.
create table if not exists public.erp_creator_links (
  token_hash   text primary key,
  source       text not null,
  business_id  uuid not null,
  kind         text not null,              -- creator | sponsor
  ref          text not null,              -- the creator's id, or the brand's name (lower case)
  created_at   timestamptz not null default now(),
  last_seen    timestamptz
);
alter table public.erp_creator_links enable row level security;
revoke all on public.erp_creator_links from anon, authenticated;
