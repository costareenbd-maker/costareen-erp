-- Any website: product links and the website's own product list.
--
-- web_product_links: "this website item IS that product here". The website's
-- SKU (or, with no SKU, its product name) is the key; it is set once by a
-- person and used for every order and every stock push after that.
-- web_catalog: the products a website has told us about (open door
-- POST ?shop=products), so they can be matched before the first order.

create table if not exists public.web_product_links (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  ext_key     text not null,              -- lower-case website SKU, or 'name:<normalised name>'
  ext_sku     text,                       -- the website's SKU as written (stock is pushed under it)
  ext_name    text,
  product_id  uuid not null references public.products(id) on delete cascade,
  made_by     text,
  made_at     timestamptz not null default now(),
  unique (business_id, ext_key)
);
create index if not exists web_product_links_product_idx on public.web_product_links(product_id);

create table if not exists public.web_catalog (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  ext_key     text not null,
  ext_sku     text,
  ext_name    text,
  barcode     text,
  price       numeric(14,2),
  seen_at     timestamptz not null default now(),
  unique (business_id, ext_key)
);

alter table public.web_product_links enable row level security;
alter table public.web_catalog enable row level security;

drop policy if exists web_product_links_read on public.web_product_links;
create policy web_product_links_read on public.web_product_links for select
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists web_product_links_write on public.web_product_links;
create policy web_product_links_write on public.web_product_links for all
  using (business_id in (select public.my_business_ids('manager')))
  with check (business_id in (select public.my_business_ids('manager')));

drop policy if exists web_catalog_read on public.web_catalog;
create policy web_catalog_read on public.web_catalog for select
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists web_catalog_write on public.web_catalog;
create policy web_catalog_write on public.web_catalog for all
  using (business_id in (select public.my_business_ids('manager')))
  with check (business_id in (select public.my_business_ids('manager')));

grant select, insert, update, delete on public.web_product_links, public.web_catalog to authenticated;
