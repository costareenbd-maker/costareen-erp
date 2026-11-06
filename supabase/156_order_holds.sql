-- hold-1 (owner 6 Nov 2026): an order that waits for the customer's OK before it becomes an invoice.
-- "An invoice is made, it stays pre-accepted, it goes to the customer on WhatsApp; only after the confirm is it saved,
--  the stock goes down and the parcel goes to Steadfast."
--
-- One row per waiting order. `payload` is exactly what the New invoice screen would have sent to erpCreateInvoice
-- (it is checked by the same code when the order is made, and again when it is confirmed); `snap` is the bill the
-- customer saw (lines, totals) so the public page never re-prices. Nothing here touches stock, money or the invoice
-- counter: that happens only on Confirm, through erpCreateInvoice. Never deleted: cancelled / expired rows stay.
create table if not exists public.order_holds (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  hold_no         text not null,
  status          text not null default 'waiting',      -- waiting | confirmed | cancelled | expired
  payload         jsonb not null,
  snap            jsonb not null,
  customer_name   text,
  customer_phone  text,
  grand_total     numeric(16,2) not null default 0,
  token           text not null,                         -- the customer's page: 32 hex
  book_courier    boolean not null default false,        -- book Steadfast as soon as it is confirmed
  created_by      uuid,
  created_name    text,
  created_at      timestamptz not null default now(),
  expires_at      timestamptz,
  sent_at         timestamptz,
  sent_via        text,                                  -- WhatsApp number's name, or 'link'
  customer_ok_at  timestamptz,                           -- the customer said yes (page button or WhatsApp reply)
  customer_ok_how text,                                  -- page | whatsapp
  customer_no_at  timestamptz,                           -- the customer said no on the page
  confirmed_at    timestamptz,
  confirmed_name  text,
  invoice_no      text,
  closed_reason   text,
  unique (business_id, hold_no),
  unique (token)
);
create index if not exists order_holds_open_idx on public.order_holds(business_id, status, created_at desc);
create index if not exists order_holds_phone_idx on public.order_holds(business_id, customer_phone) where status = 'waiting';
alter table public.order_holds enable row level security;
drop policy if exists order_holds_read on public.order_holds;
create policy order_holds_read on public.order_holds for select to authenticated
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists order_holds_write on public.order_holds;
create policy order_holds_write on public.order_holds for insert to authenticated
  with check (business_id in (select public.my_business_ids('member')));
drop policy if exists order_holds_update on public.order_holds;
create policy order_holds_update on public.order_holds for update to authenticated
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.order_holds to authenticated;
