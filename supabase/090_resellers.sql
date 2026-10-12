-- control-only (the installer never copies this file into a company's database)
-- Stage N9 (docs/NETWORK-BLUEPRINT.md section 4.3 "Sell without stock for resellers"): a reseller with no stock sells a
-- supplier's goods at his own price to his own customer; the supplier invoices that customer at the reseller's price,
-- packs with a slip in the reseller's name, books the parcel (cash on delivery to the supplier's courier account); the
-- reseller's margin is a commission the supplier settles at month end. Commission-agent bookkeeping (IFRS 15): the owner
-- of the goods books the sale and the cost; the reseller books only his commission. The platform holds no money.
create table if not exists public.erp_reseller_programmes (
  source       text not null,
  business_id  uuid not null,
  name         text not null,                   -- the supplier as resellers see it
  city         text,
  phone        text,
  pct          numeric(5,2) not null default 10, -- resellers buy at the shelf price less this
  terms        text,
  enabled      boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (source, business_id)
);
alter table public.erp_reseller_programmes enable row level security;
revoke all on public.erp_reseller_programmes from anon, authenticated;

create table if not exists public.erp_reseller_links (
  id            uuid primary key default gen_random_uuid(),
  sup_source    text not null,
  sup_business  uuid not null,
  sup_name      text,
  res_source    text not null,
  res_business  uuid not null,
  res_name      text,                           -- the reseller as the slip shows him
  res_city      text,
  res_phone     text,
  res_address   text,
  status        text not null default 'asked' check (status in ('asked', 'active', 'paused', 'declined')),
  pct           numeric(5,2),                   -- this reseller's discount (the programme's when null)
  note          text,                           -- the reseller's words when asking
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (sup_source, sup_business, res_source, res_business)
);
alter table public.erp_reseller_links enable row level security;
revoke all on public.erp_reseller_links from anon, authenticated;

-- what approved resellers may sell: the supplier's shared products with the exact reseller price (refreshed with the market)
create table if not exists public.erp_reseller_catalog (
  source       text not null,
  business_id  uuid not null,
  product_id   uuid not null,
  sku          text not null,
  name         text not null,
  unit         text,
  retail       numeric(14,2),                   -- the supplier's shelf price: the suggested selling price
  price        numeric(14,2) not null,          -- what the reseller pays
  band         text not null default 'in',      -- in | low | out
  updated_at   timestamptz not null default now(),
  primary key (source, business_id, product_id)
);
alter table public.erp_reseller_catalog enable row level security;
revoke all on public.erp_reseller_catalog from anon, authenticated;

create table if not exists public.erp_reseller_orders (
  id             uuid primary key default gen_random_uuid(),
  order_no       text not null unique,          -- RS-yymmdd-xxxx
  link_id        uuid not null references public.erp_reseller_links(id),
  sup_source     text not null,
  sup_business   uuid not null,
  res_source     text not null,
  res_business   uuid not null,
  res_name       text,
  customer_name  text not null,
  customer_phone text not null,
  customer_address text not null,
  note           text,
  lines          jsonb not null,                -- [{productId, sku, name, unit, qty, price, retail}]
  goods          numeric(14,2) not null,        -- what the customer pays for the goods (the reseller's prices)
  cost           numeric(14,2) not null,        -- what the reseller pays the supplier
  delivery       numeric(14,2) not null default 0,  -- charged to the customer, kept by the supplier (it pays the courier)
  margin         numeric(14,2) not null,        -- goods - cost: the reseller's commission once delivered and paid
  status         text not null default 'placed' check (status in ('placed', 'accepted', 'booked', 'delivered', 'returned', 'cancelled', 'declined')),
  reason         text,
  invoice_no     text,                          -- the supplier's invoice to the customer
  consignment    text,
  delivered_at   timestamptz,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index if not exists erp_reseller_orders_sup_idx on public.erp_reseller_orders(sup_source, sup_business, created_at desc);
create index if not exists erp_reseller_orders_res_idx on public.erp_reseller_orders(res_source, res_business, created_at desc);
alter table public.erp_reseller_orders enable row level security;
revoke all on public.erp_reseller_orders from anon, authenticated;

create table if not exists public.erp_reseller_settlements (
  id             uuid primary key default gen_random_uuid(),
  link_id        uuid not null references public.erp_reseller_links(id),
  month          text not null,                 -- yyyy-MM of the delivery
  orders         int not null default 0,
  margin         numeric(14,2) not null default 0,
  paid           numeric(14,2) not null default 0,
  paid_at        timestamptz,
  paid_note      text,
  paid_by        text,
  received_at    timestamptz,
  received_note  text,
  status         text not null default 'open' check (status in ('open', 'paid', 'received')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (link_id, month)
);
alter table public.erp_reseller_settlements enable row level security;
revoke all on public.erp_reseller_settlements from anon, authenticated;
