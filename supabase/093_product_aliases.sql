-- Receive stock from a file (handlers/receivefile.js): what a supplier calls a product. When the owner confirms a
-- match once ("CA19029" or "PLA Basic / Jade White / Refill" is our bpbjw055), the next file matches it straight away.
create table if not exists public.product_aliases (
  id           bigserial primary key,
  business_id  uuid not null,
  alias        text not null,                 -- normalised: lower case, letters/digits/spaces
  product_id   uuid not null references public.products(id) on delete cascade,
  source       text,                          -- the supplier the file came from
  created_at   timestamptz not null default now(),
  unique (business_id, alias)
);
create index if not exists product_aliases_biz_idx on public.product_aliases(business_id);
alter table public.product_aliases enable row level security;
drop policy if exists product_aliases_rw on public.product_aliases;
create policy product_aliases_rw on public.product_aliases for all
  using (business_id in (select public.my_business_ids('manager')))
  with check (business_id in (select public.my_business_ids('manager')));
grant select, insert, update, delete on public.product_aliases to authenticated;
