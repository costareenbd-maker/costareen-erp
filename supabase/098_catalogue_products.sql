-- control-only (the installer never copies this file into a company's database)
-- The catalogue looks at EVERY active product of a company that shares on the market, in or out of stock - the
-- market listing (erp_market_listings) only carries what is on the shelf. Written by the same refresh.
create table if not exists public.erp_catalog_products (
  source      text not null,
  business_id uuid not null,
  product_id  uuid not null,
  name        text not null,
  category    text, brand text, color text, unit text,
  updated_at  timestamptz not null default now(),
  primary key (source, product_id)
);
create index if not exists erp_catalog_products_biz_idx on public.erp_catalog_products(source, business_id);
alter table public.erp_catalog_products enable row level security;
revoke all on public.erp_catalog_products from anon, authenticated;
