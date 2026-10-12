-- 109: investors per shipment (FilaDash merge P3, owner decision F2 - kept beside the monthly / percent returns).
--
-- An investor whose return is 'lot' (capital_holders.return_kind) earns return_value % of the PROFIT made on the
-- part of a shipment they funded: lot_funding says which shipment (the receiving reference of its lots) and what
-- share of it (pct). Each month, for every unit of that shipment sold (FIFO lot draws, returns taken off):
--     due = (sold price - landed unit cost) x units x pct / 100 x return_value / 100
-- That is the investor's return for the month: it is a cost of that month (P&L "Investor returns") and shows on the
-- Capital screen as due, exactly like the other investors. The money they put in stays a Capital line (invest).

create table if not exists public.lot_funding (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  holder_no    text not null,
  reference    text not null,
  pct          numeric(7,3) not null check (pct > 0 and pct <= 100),
  note         text,
  by           text,
  at           timestamptz not null default now(),
  voided_at    timestamptz,
  voided_why   text
);
create index if not exists lot_funding_idx on public.lot_funding (business_id, reference) where voided_at is null;
alter table public.lot_funding enable row level security;
drop policy if exists lot_funding_read on public.lot_funding;
create policy lot_funding_read on public.lot_funding for select to authenticated
  using (business_id in (select public.my_business_ids('shareholder')));
drop policy if exists lot_funding_write on public.lot_funding;
create policy lot_funding_write on public.lot_funding for all to authenticated
  using (business_id in (select public.my_business_ids('owner')))
  with check (business_id in (select public.my_business_ids('owner')));
grant select, insert, update on public.lot_funding to authenticated;
