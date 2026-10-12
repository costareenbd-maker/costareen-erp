-- control-only (the installer never copies this file into a company's database)
-- Stage N1 (docs/NETWORK-BLUEPRINT.md section 5): the Printer Passport register and the customer-page links.
--
-- erp_passports: one record per sold serial number, written by the seller's ERP at the sale. What a public check
-- shows: product, version, the seller (name or "Supplier · city"), the sale month, the warranty, repairs on record,
-- returned / stolen. Never the buyer's name, phone, price or invoice.
create table if not exists public.erp_passports (
  id              uuid primary key default gen_random_uuid(),
  serial_norm     text not null,                -- letters and digits, upper case
  serial          text not null,
  source          text not null,                -- 'self' = the provider's own business, else the company's install id
  business_id     uuid not null,
  seller_name     text,
  seller_city     text,
  show_seller     boolean not null default true,
  product_name    text not null,
  brand           text,
  category        text,
  sku             text,
  version         text not null default '',     -- '' | 'global' | 'china'
  sold_at         date,
  invoice_no      text,
  customer_key    text,                         -- the seller's own customer key (for the customer page; never shown)
  warranty_months int,
  warranty_until  date,
  transferable    boolean not null default true,
  status          text not null default 'sold' check (status in ('sold', 'returned', 'stolen')),
  level           text not null default 'verified' check (level in ('verified', 'confirmed', 'declared')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists erp_passports_serial_idx on public.erp_passports(serial_norm);
create unique index if not exists erp_passports_one_idx on public.erp_passports(source, business_id, serial_norm);
alter table public.erp_passports enable row level security;
revoke all on public.erp_passports from anon, authenticated;

create table if not exists public.erp_passport_events (
  id           bigserial primary key,
  passport_id  uuid not null references public.erp_passports(id) on delete cascade,
  kind         text not null check (kind in ('sold', 'returned', 'repair', 'warranty', 'transfer', 'stolen', 'note')),
  at           timestamptz not null default now(),
  detail       jsonb
);
create index if not exists erp_passport_events_idx on public.erp_passport_events(passport_id, at desc);
alter table public.erp_passport_events enable row level security;
revoke all on public.erp_passport_events from anon, authenticated;

-- the customer page: a secret link per customer of a company (the token is derived, only its hash is kept)
create table if not exists public.erp_customer_links (
  token_hash   text primary key,
  source       text not null,
  business_id  uuid not null,
  customer_key text not null,
  created_at   timestamptz not null default now(),
  last_seen    timestamptz
);
alter table public.erp_customer_links enable row level security;
revoke all on public.erp_customer_links from anon, authenticated;

-- public calls are counted per address, so a scraper is slowed down
create table if not exists public.erp_pub_hits (
  ip   text not null,
  kind text not null,
  at   timestamptz not null default now()
);
create index if not exists erp_pub_hits_idx on public.erp_pub_hits(ip, kind, at);
alter table public.erp_pub_hits enable row level security;
revoke all on public.erp_pub_hits from anon, authenticated;
