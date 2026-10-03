-- Plan D1: serial numbers and warranty, for printers and any other serialised item.
--   products.serialised       every unit has its own serial number
--   products.warranty_months  the warranty given from now on (null = none); change it
--                             any time - units already sold keep what they were sold with
--   serials                   one row per unit: received, sold (to whom, on which invoice,
--                             warranty until), returned
alter table public.products add column if not exists serialised boolean not null default false;
alter table public.products add column if not exists warranty_months int;

create table if not exists public.serials (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  product_id      uuid not null references public.products(id) on delete cascade,
  sku             text not null,
  serial          text not null,
  status          text not null default 'in_stock' check (status in ('in_stock', 'sold', 'damaged')),
  received_at     timestamptz not null default now(),
  receive_ref     text,
  sold_at         timestamptz,
  invoice_no      text,
  customer        text,
  customer_key    text,
  warranty_months int,
  warranty_until  date,
  returned_at     timestamptz,
  note            text,
  created_by      text,
  unique (business_id, product_id, serial)
);
create index if not exists serials_lookup_idx on public.serials(business_id, lower(serial));
create index if not exists serials_invoice_idx on public.serials(business_id, invoice_no);

alter table public.serials enable row level security;
drop policy if exists serials_read on public.serials;
create policy serials_read on public.serials for select
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists serials_write on public.serials;
create policy serials_write on public.serials for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.serials to authenticated;
