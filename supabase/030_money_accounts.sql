-- ============================================================================
-- COSTAREEN ERP - plan A3: money accounts
-- ----------------------------------------------------------------------------
-- Run AFTER 029. Idempotent.
--
-- Where the money is: the cash drawer, each bank account, a mobile wallet, the
-- courier who is holding collected cash. The owner makes, renames and retires
-- these freely. Nothing is entered twice: a customer payment, an expense, a
-- capital line and a courier payout each say which account they touched
-- (account_id, written when the row is made), and the account's statement is
-- read straight from those rows. Only what has no row of its own lives in
-- money_moves: a transfer between two accounts, and a correction after
-- counting.
-- ============================================================================

create table if not exists public.money_accounts (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null,
  kind         text not null default 'bank',       -- cash | bank | wallet | courier
  opening      numeric(14,2) not null default 0,   -- what was in it on opening_date
  opening_date date,
  archived     boolean not null default false,
  sort_order   int not null default 0,
  note         text,
  created_at   timestamptz not null default now()
);
create unique index if not exists money_accounts_name_idx on public.money_accounts(business_id, lower(btrim(name)));

create table if not exists public.money_moves (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  account_id  uuid not null references public.money_accounts(id),
  at          timestamptz not null default now(),
  amount      numeric(14,2) not null,              -- + in, - out
  kind        text not null,                       -- transfer | adjust
  pair_id     uuid,                                -- the two sides of one transfer share it
  note        text,
  by          text,
  voided      text,                                -- struck out: who, when, why. Never deleted.
  created_at  timestamptz not null default now()
);
create index if not exists money_moves_idx on public.money_moves(business_id, account_id, at);

alter table public.payments        add column if not exists account_id uuid references public.money_accounts(id);
alter table public.expenses        add column if not exists account_id uuid references public.money_accounts(id);
alter table public.capital_book    add column if not exists account_id uuid references public.money_accounts(id);
alter table public.courier_payouts add column if not exists account_id uuid references public.money_accounts(id);

alter table public.money_accounts enable row level security;
alter table public.money_moves    enable row level security;

-- money is a shareholder matter; making and changing accounts is the owner's
drop policy if exists money_accounts_read on public.money_accounts;
create policy money_accounts_read on public.money_accounts
  for select using (business_id in (select public.my_business_ids('shareholder')));
drop policy if exists money_accounts_write on public.money_accounts;
create policy money_accounts_write on public.money_accounts
  for all using (business_id in (select public.my_business_ids('owner')))
  with check (business_id in (select public.my_business_ids('owner')));

drop policy if exists money_moves_read on public.money_moves;
create policy money_moves_read on public.money_moves
  for select using (business_id in (select public.my_business_ids('shareholder')));
drop policy if exists money_moves_insert on public.money_moves;
create policy money_moves_insert on public.money_moves
  for insert with check (business_id in (select public.my_business_ids('shareholder')));
drop policy if exists money_moves_update on public.money_moves;
create policy money_moves_update on public.money_moves
  for update using (business_id in (select public.my_business_ids('owner')))
  with check (business_id in (select public.my_business_ids('owner')));
-- no delete policy: a wrong line is struck out, not removed

grant select, insert, update on public.money_accounts, public.money_moves to authenticated;
revoke all on public.money_accounts, public.money_moves from anon;
