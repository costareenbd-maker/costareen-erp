-- Stage 2 (docs/PLATFORM-BLUEPRINT.md section 8): which products a business shares on the open market.
-- Lives in the company's own database. The business switch and its city are in business_config
-- (market_share_on = '1', market_city). Only these rows (and their product's name, category, brand,
-- stock band and, if chosen, price) are ever copied to the market - never cost, customers or sales.
create table if not exists public.market_shares (
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id  uuid not null references public.products(id) on delete cascade,
  price_mode  text not null default 'price' check (price_mode in ('price', 'ask')),
  shared_at   timestamptz not null default now(),
  primary key (business_id, product_id)
);
alter table public.market_shares enable row level security;
drop policy if exists market_shares_read on public.market_shares;
create policy market_shares_read on public.market_shares for select
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists market_shares_owner on public.market_shares;
create policy market_shares_owner on public.market_shares for all
  using (business_id in (select public.my_business_ids('owner')))
  with check (business_id in (select public.my_business_ids('owner')));
grant select, insert, update, delete on public.market_shares to authenticated;
