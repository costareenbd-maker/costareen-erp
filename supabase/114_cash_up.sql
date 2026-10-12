-- 114: the daily cash-up (FilaDash merge, Payments > Cash-up).
--
-- At the end of a day the owner or a shareholder (who see the money accounts) counts what an account really holds (the cash drawer, by notes) and the ERP compares it
-- with the book. The count is kept (who, when, the notes counted, book, counted, difference). A difference is booked on
-- the account at once as a correction (money_moves 'adjust', note 'cash-up ...'), so the book equals the drawer; the
-- owner sees every difference in the cash-up history and can strike a correction out like any other.

create table if not exists public.cash_ups (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  account_id   uuid not null references public.money_accounts(id),
  at           timestamptz not null default now(),
  book         numeric(14,2) not null,
  counted      numeric(14,2) not null,
  variance     numeric(14,2) not null,
  notes        jsonb not null default '{}'::jsonb,           -- { "1000": 3, "500": 2, ... } when counted by notes
  note         text,
  move_id      uuid references public.money_moves(id) on delete set null,
  by           text
);
create index if not exists cash_ups_idx on public.cash_ups (business_id, at desc);
alter table public.cash_ups enable row level security;
drop policy if exists cash_ups_read on public.cash_ups;
create policy cash_ups_read on public.cash_ups for select to authenticated
  using (business_id in (select public.my_business_ids('shareholder')));
drop policy if exists cash_ups_write on public.cash_ups;
create policy cash_ups_write on public.cash_ups for insert to authenticated
  with check (business_id in (select public.my_business_ids('shareholder')));
grant select, insert on public.cash_ups to authenticated;
