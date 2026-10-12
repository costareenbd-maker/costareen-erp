-- control-only (the installer never copies this file into a company's database)
-- Stage 2: the open market's central list. Filled from each sharing business (its own products marked
-- shared) every 15 minutes and at once when the owner saves; read by the Market tab of every ERP.
-- source = 'self' for the provider's own businesses, else the company's install id.
-- Seller names are never stored: a listing shows "Supplier · <city>" until a deal (Stage 3).
create table if not exists public.erp_market_listings (
  source      text not null,
  business_id uuid not null,
  product_id  uuid not null,
  name        text not null,
  category    text,
  brand       text,
  color       text,
  unit        text,
  band        text not null check (band in ('in', 'low')),
  price       numeric(14,2),
  city        text,
  updated_at  timestamptz not null default now(),
  primary key (source, product_id)
);
create index if not exists erp_market_listings_seller_idx on public.erp_market_listings(source, business_id);
create index if not exists erp_market_listings_name_idx on public.erp_market_listings(lower(name));
alter table public.erp_market_listings enable row level security;
revoke all on public.erp_market_listings from anon, authenticated;
