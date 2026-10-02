-- ============================================================================
-- COSTAREEN ERP - plan A4: suppliers, and what is owed to them
-- ----------------------------------------------------------------------------
-- Run AFTER 030. Idempotent.
--
-- A supplier was only a name in a list. It is now a record, with a running
-- account: each shipment received from them is a bill (the goods, not the
-- freight - that is paid to someone else), each payment to them comes out of a
-- money account, and the difference is what is owed (or paid in advance).
-- Nothing is deleted: a wrong bill or payment is struck out.
-- ============================================================================

create table if not exists public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  name          text not null,
  phone         text,
  country       text,
  currency      text,                         -- what they are usually paid in: RMB, USD, BDT…
  note          text,
  opening_owed  numeric(14,2) not null default 0,   -- owed to them the day the books were started (negative: paid ahead)
  archived      boolean not null default false,
  created_at    timestamptz not null default now()
);
create unique index if not exists suppliers_name_idx on public.suppliers(business_id, lower(btrim(name)));

create table if not exists public.supplier_bills (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier    text not null,
  at          timestamptz not null default now(),
  reference   text,                           -- the shipment / their invoice number
  amount      numeric(14,2) not null,         -- in taka
  fx_amount   numeric(14,2),                  -- what it was in their money
  fx_currency text,
  fx_rate     numeric(14,4),
  source      text not null default 'manual', -- shipment | manual
  note        text,
  by          text,
  voided      text,
  created_at  timestamptz not null default now()
);
create index if not exists supplier_bills_idx on public.supplier_bills(business_id, lower(btrim(supplier)));

create table if not exists public.supplier_payments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  supplier    text not null,
  at          timestamptz not null default now(),
  amount      numeric(14,2) not null,         -- in taka, what left the account
  account_id  uuid references public.money_accounts(id),
  fx_amount   numeric(14,2),
  fx_currency text,
  note        text,                           -- how it was sent: bank, agent, in person
  by          text,
  voided      text,
  created_at  timestamptz not null default now()
);
create index if not exists supplier_payments_idx on public.supplier_payments(business_id, lower(btrim(supplier)));

alter table public.suppliers         enable row level security;
alter table public.supplier_bills    enable row level security;
alter table public.supplier_payments enable row level security;

do $$
declare t text;
begin
  foreach t in array array['suppliers', 'supplier_bills', 'supplier_payments'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select using (business_id in (select public.my_business_ids(''manager'')))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('create policy %I on public.%I for insert with check (business_id in (select public.my_business_ids(''manager'')))', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('create policy %I on public.%I for update using (business_id in (select public.my_business_ids(''shareholder''))) with check (business_id in (select public.my_business_ids(''shareholder'')))', t || '_update', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('revoke all on public.%I from anon', t);
  end loop;
end $$;
