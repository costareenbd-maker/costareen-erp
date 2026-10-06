-- Waiting orders (restock from the market): a customer's order that is short of some goods waits here while the
-- missing goods are asked for on the market; when they are on the shelf it becomes a normal invoice.
-- The market requests themselves stay in the provider's list (erp_market_requests); this keeps only their ids.
create table if not exists public.restock_orders (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_name text not null,
  phone         text,
  address       text,
  source        text,
  items         jsonb not null default '[]'::jsonb,   -- the whole order: [{sku, qty, discEach}]
  short         jsonb not null default '[]'::jsonb,   -- what was missing: [{sku, name, need, request}]
  note          text,
  status        text not null default 'waiting' check (status in ('waiting', 'ready', 'invoiced', 'cancelled')),
  invoice_no    text,
  reason        text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists restock_orders_open_idx on public.restock_orders(business_id, status, created_at);
alter table public.restock_orders enable row level security;
drop policy if exists restock_orders_rw on public.restock_orders;
create policy restock_orders_rw on public.restock_orders for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.restock_orders to authenticated;
