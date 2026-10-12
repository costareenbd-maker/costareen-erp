-- ============================================================================
-- COSTAREEN ERP - plan A5: currencies, and the other costs of a shipment
-- ----------------------------------------------------------------------------
-- Run AFTER 031. Idempotent.
--
-- The price book and the receive screen knew two kinds of money: RMB and taka,
-- with one rate. A business buys in whatever its supplier charges in. So:
--   currencies       the ones this business uses, each with today's rate (taka per 1)
--   currency_rates   every rate that was ever set, by date - a rate is a fact of its day
--   shipment_costs   what a shipment cost besides the goods and besides what the
--                    supplier is owed: freight, customs duty, VAT at the port, the
--                    C&F agent... each spread into the cost of the goods, and each
--                    saying which money account paid it
-- The price book can price a line in any of the currencies.
-- ============================================================================

create table if not exists public.currencies (
  business_id uuid not null references public.businesses(id) on delete cascade,
  code        text not null,
  name        text,
  rate        numeric(14,4) not null default 0,     -- taka for 1 unit
  archived    boolean not null default false,
  updated_at  timestamptz not null default now(),
  primary key (business_id, code)
);
create table if not exists public.currency_rates (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  code        text not null,
  on_date     date not null default (now() at time zone 'Asia/Dhaka')::date,
  rate        numeric(14,4) not null,
  by          text,
  created_at  timestamptz not null default now()
);
create index if not exists currency_rates_idx on public.currency_rates(business_id, code, on_date desc);

create table if not exists public.shipment_costs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  reference   text not null,                         -- the shipment it belongs to
  at          timestamptz not null default now(),
  label       text not null,                         -- Freight, Customs duty, C&F agent…
  amount      numeric(14,2) not null,
  account_id  uuid references public.money_accounts(id),
  by          text,
  voided      text,
  created_at  timestamptz not null default now()
);
create index if not exists shipment_costs_idx on public.shipment_costs(business_id, reference);

alter table public.cost_book add column if not exists buy_amount numeric(14,4);
alter table public.cost_book add column if not exists buy_cur    text;
-- what was typed as RMB or taka becomes an amount and its currency
update public.cost_book set buy_amount = buy_rmb, buy_cur = 'RMB' where buy_amount is null and coalesce(buy_rmb, 0) > 0;
update public.cost_book set buy_amount = buy_bdt, buy_cur = 'BDT' where buy_amount is null and coalesce(buy_bdt, 0) > 0;

alter table public.currencies     enable row level security;
alter table public.currency_rates enable row level security;
alter table public.shipment_costs enable row level security;

do $$
declare t text;
begin
  foreach t in array array['currencies', 'currency_rates', 'shipment_costs'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (business_id in (select public.my_business_ids(''member'')))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (business_id in (select public.my_business_ids(''manager'')))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (business_id in (select public.my_business_ids(''manager''))) with check (business_id in (select public.my_business_ids(''manager'')))', t || '_update', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
