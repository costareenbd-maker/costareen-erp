-- control-only (the installer never copies this file into a company's database)
-- The master catalogue: one record per physical thing (brand + line + colour + size + variant), and a link from every
-- shop's listed product to it. Made by the server by itself (the matcher, then the AI reader for the unsure ones);
-- the provider can unlink or rename from Platform > Catalogue. Find stock and the Market group by item.
create table if not exists public.erp_catalog_items (
  id          bigserial primary key,
  key         text not null unique,                 -- brand|line|colour|size|variant, normalised
  name        text not null,                        -- how it is shown: "Bambu Lab PLA Basic Jade White 1 kg (refill)"
  brand       text, line text, colour text, size text, variant text,
  category    text,
  made_by     text not null default 'auto',         -- auto | ai | admin
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create table if not exists public.erp_catalog_links (
  source      text not null,
  business_id uuid not null,
  product_id  uuid not null,
  item_id     bigint references public.erp_catalog_items(id) on delete set null,
  how         text not null default 'key',          -- key | ai | admin (admin = the provider decided; never overwritten)
  confidence  numeric(4,3) not null default 1,
  name_seen   text,                                 -- the shop's name when the link was made; a changed name is looked at again
  updated_at  timestamptz not null default now(),
  primary key (source, product_id)
);
create index if not exists erp_catalog_links_item_idx on public.erp_catalog_links(item_id);
create table if not exists public.erp_catalog_log (
  id          bigserial primary key,
  at          timestamptz not null default now(),
  what        text not null,                        -- linked | created | ai | unlinked | renamed | run
  detail      text
);
alter table public.erp_catalog_items enable row level security;
alter table public.erp_catalog_links enable row level security;
alter table public.erp_catalog_log enable row level security;
revoke all on public.erp_catalog_items from anon, authenticated;
revoke all on public.erp_catalog_links from anon, authenticated;
revoke all on public.erp_catalog_log from anon, authenticated;
