-- control-only (the installer never copies this file into a company's database)
-- Stage 3 (docs/PLATFORM-BLUEPRINT.md section 8): a deal between two ERPs on the market.
--   asked -> quoted -> accepted -> invoiced -> received      (or declined / cancelled on the way)
-- The buyer's name and phone go to the seller with the request; the seller's name and phone go to the
-- buyer only with a quote. Each side's own books are made by its own ERP: the seller's quotation and
-- invoice, the buyer's stock entry and supplier bill. This row only links them.
create table if not exists public.erp_market_requests (
  id              uuid primary key default gen_random_uuid(),
  buyer_source    text not null,
  buyer_business  uuid not null,
  buyer_name      text not null,
  buyer_city      text,
  buyer_phone     text,
  buyer_by        text,
  seller_source   text not null,
  seller_business uuid not null,
  seller_name     text,
  seller_city     text,
  seller_phone    text,
  product_id      uuid not null,
  product_name    text not null,
  unit            text,
  qty             numeric(14,2) not null check (qty > 0),
  note            text,
  status          text not null default 'asked'
                  check (status in ('asked', 'quoted', 'accepted', 'invoiced', 'received', 'declined', 'cancelled')),
  price           numeric(14,2),
  delivery        numeric(14,2) not null default 0,
  quote_note      text,
  quote_ref       text,
  valid_until     date,
  invoice_no      text,
  stock_ref       text,
  closed_reason   text,
  rating          int check (rating between 1 and 5),
  rating_note     text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  quoted_at       timestamptz,
  accepted_at     timestamptz,
  invoiced_at     timestamptz,
  received_at     timestamptz,
  rated_at        timestamptz
);
create index if not exists erp_market_requests_seller_idx on public.erp_market_requests(seller_source, seller_business, status);
create index if not exists erp_market_requests_buyer_idx on public.erp_market_requests(buyer_source, buyer_business, status);
alter table public.erp_market_requests enable row level security;
revoke all on public.erp_market_requests from anon, authenticated;
