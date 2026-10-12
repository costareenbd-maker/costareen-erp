-- control-only (the installer never copies this file into a company's database)
-- Stage 4: the wanted board. A business posts what it needs; suppliers answer with a price, which becomes a
-- normal market request (erp_market_requests, already "quoted") in both ERPs. The poster is shown as
-- "Buyer · <city>" until it gets an offer.
create table if not exists public.erp_market_wanted (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,
  business_id uuid not null,
  buyer_name  text not null,
  city        text,
  phone       text,
  item        text not null,
  qty         numeric(14,2) not null check (qty > 0),
  note        text,
  until       date not null,
  status      text not null default 'open' check (status in ('open', 'closed')),
  posted_by   text,
  created_at  timestamptz not null default now(),
  closed_at   timestamptz
);
create index if not exists erp_market_wanted_open_idx on public.erp_market_wanted(status, until);
create index if not exists erp_market_wanted_owner_idx on public.erp_market_wanted(source, business_id);
alter table public.erp_market_wanted enable row level security;
revoke all on public.erp_market_wanted from anon, authenticated;
alter table public.erp_market_requests add column if not exists wanted_id uuid references public.erp_market_wanted(id) on delete set null;
