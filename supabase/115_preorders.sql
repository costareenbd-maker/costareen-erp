-- 115: pre-orders with advances (FilaDash merge; spec D25 "pre-order advances are customer deposits applied at
-- fulfilment; a cancellation is refunded unless the owner forfeits it with a reason").
--
-- A customer orders what is not on the shelf (a printer still at sea, a colour out of stock) at an agreed price and pays a
-- deposit. The deposit is the customer's money held by the business (customer credit, as an advance always was - not
-- income): it is a payment row with [acct:<customer>] [preorder:<no>], so the customer's statement and "advances held"
-- show it. When the goods are on the shelf the pre-order is Ready (the oldest pre-orders get the stock first); handing
-- it over makes the invoice at the agreed prices and the deposit pays it. Cancelled: the deposit is paid back, or - the
-- owner, with a reason - kept (forfeited): then it becomes income of that month (Profitability: forfeited deposits).

create table if not exists public.preorders (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  no            text not null,
  customer      text not null,
  phone         text,
  customer_key  text not null,
  status        text not null default 'open' check (status in ('open', 'done', 'cancelled')),
  eta           date,
  note          text,
  invoice_no    text,
  cancel_reason text,
  refunded      numeric(14,2) not null default 0,
  forfeited     numeric(14,2) not null default 0,
  forfeit_month text,
  created_by    text,
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  unique (business_id, no)
);
create table if not exists public.preorder_lines (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  preorder_id  uuid not null references public.preorders(id) on delete cascade,
  sku          text,                      -- null: a model not in the product list yet (give it a product before handing over)
  name         text not null,
  qty          numeric(14,2) not null check (qty > 0),
  price        numeric(14,2) not null check (price >= 0),
  line_no      int not null
);
create index if not exists preorders_idx on public.preorders (business_id, status, created_at);
create index if not exists preorder_lines_idx on public.preorder_lines (preorder_id);
alter table public.preorders enable row level security;
alter table public.preorder_lines enable row level security;
drop policy if exists preorders_rw on public.preorders;
create policy preorders_rw on public.preorders for all to authenticated
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
drop policy if exists preorder_lines_rw on public.preorder_lines;
create policy preorder_lines_rw on public.preorder_lines for all to authenticated
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.preorders, public.preorder_lines to authenticated;
