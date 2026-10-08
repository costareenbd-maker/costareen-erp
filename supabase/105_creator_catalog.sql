-- What creators may request (handlers/creatorportal.js): only the programme brand's products - the shop's own stock of
-- that brand plus the brand's wider range the shop does not stock ("on request"). The owner can hide any of them.
create table if not exists public.erp_creator_catalog (
  id           bigserial primary key,
  business_id  uuid not null,
  brand        text not null,
  sku          text,
  name         text not null,
  line         text,                    -- product line, e.g. Panchroma PLA Matte
  colour       text,
  hidden       boolean not null default false,
  created_at   timestamptz not null default now()
);
create unique index if not exists erp_creator_catalog_sku_idx on public.erp_creator_catalog(business_id, lower(sku)) where sku is not null;
create index if not exists erp_creator_catalog_biz_idx on public.erp_creator_catalog(business_id, lower(brand));
alter table public.erp_creator_catalog enable row level security;
drop policy if exists erp_creator_catalog_rw on public.erp_creator_catalog;
create policy erp_creator_catalog_rw on public.erp_creator_catalog for all using (business_id in (select public.my_business_ids('owner'))) with check (business_id in (select public.my_business_ids('owner')));
grant select, insert, update, delete on public.erp_creator_catalog to authenticated;
alter table public.erp_creator_requests add column if not exists on_request boolean not null default false;   -- not in stock when he asked
