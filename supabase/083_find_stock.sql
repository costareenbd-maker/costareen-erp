-- control-only (the installer never copies this file into a company's database)
-- Stage N5 (docs/NETWORK-BLUEPRINT.md section 4.1 "Find stock"): the market's listings become public for shops that
-- switch it on - anyone finds which shop has a product now, the shop's page, orders straight into the shop's web
-- orders, and "tell me when it is back" for the shop to answer. The listings stay as they are (no SKU, no cost, no
-- stock number): an order carries the product's name, which the shop's web-order matcher resolves.
create table if not exists public.erp_market_shops (
  source       text not null,
  business_id  uuid not null,
  slug         text not null unique,              -- the shop's public address: find?s=<slug>
  name         text not null,
  phone        text,
  address      text,
  city         text,
  note         text,                              -- delivery areas, charges, hours - in the shop's words
  public       boolean not null default false,    -- on Find stock for everyone
  orders       boolean not null default false,    -- takes orders from the public page
  updated_at   timestamptz not null default now(),
  primary key (source, business_id)
);
alter table public.erp_market_shops enable row level security;
revoke all on public.erp_market_shops from anon, authenticated;

-- "tell me when it is back": a buyer's number for the shops that list that product; a shop marks it told
create table if not exists public.erp_stock_alerts (
  id          uuid primary key default gen_random_uuid(),
  name_key    text not null,                      -- the product's words (market.js words()), so any shop's listing matches
  name        text not null,
  phone       text not null,
  consent     jsonb,
  created_at  timestamptz not null default now(),
  told_at     timestamptz,
  told_by     text                                -- "<source>:<business>" of the shop that answered
);
create index if not exists erp_stock_alerts_open_idx on public.erp_stock_alerts(name_key) where told_at is null;
alter table public.erp_stock_alerts enable row level security;
revoke all on public.erp_stock_alerts from anon, authenticated;
