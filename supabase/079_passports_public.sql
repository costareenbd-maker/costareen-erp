-- control-only (the installer never copies this file into a company's database)
-- Stage N2 (docs/NETWORK-BLUEPRINT.md section 5): a buyer whose seller is outside the system registers the printer
-- himself (level "declared", grey), sends the seller a confirm link; the seller answers through a Lite record kept
-- here (level "confirmed", green). Proof photos live in the provider's storage under public/passports/<passport id>/.
alter table public.erp_passports
  add column if not exists claim        jsonb,                       -- what the owner typed: buyer, the seller as declared, month, warranty
  add column if not exists proof        jsonb,                       -- [{name, mime, kind}] files under public/passports/<id>/
  add column if not exists owner_hash   text,                        -- sha256 of the owner's link token
  add column if not exists confirm_hash text,                        -- sha256 of the confirm link token (sent to the seller by the buyer)
  add column if not exists lite_id      uuid,                        -- the Lite seller who answered
  add column if not exists answer       text not null default '',    -- '' | 'confirmed' | 'corrected' | 'rejected'
  add column if not exists declared_at  timestamptz,
  add column if not exists answered_at  timestamptz,
  add column if not exists consent      jsonb;                       -- {at, text, ip}: the plain-words consent the owner gave
create index if not exists erp_passports_owner_idx on public.erp_passports(owner_hash) where owner_hash is not null;
create index if not exists erp_passports_confirm_idx on public.erp_passports(confirm_hash) where confirm_hash is not null;

-- the record's history gains three public kinds
alter table public.erp_passport_events drop constraint if exists erp_passport_events_kind_check;
alter table public.erp_passport_events add constraint erp_passport_events_kind_check
  check (kind in ('sold', 'returned', 'repair', 'warranty', 'transfer', 'stolen', 'note', 'declared', 'confirmed', 'rejected'));

-- a seller who is not in the system: two minutes from a phone, kept on the provider's side
create table if not exists public.erp_lite_sellers (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  phone        text not null unique,                      -- 11-digit Bangladeshi mobile
  city         text,
  email        text,
  show_name    boolean not null default true,             -- the register shows the name, or only "Supplier · city"
  status       text not null default 'active' check (status in ('active', 'blocked')),
  confirms     int not null default 0,
  access_hash  text,                                      -- sha256 of the seller's own page link
  created_at   timestamptz not null default now(),
  last_seen    timestamptz
);
alter table public.erp_lite_sellers enable row level security;
revoke all on public.erp_lite_sellers from anon, authenticated;
