-- 163 (final-money, 10 Nov 2026): the money screens' last pass.
--
--   * an expense keeps EVERY receipt given to it (expenses.receipts, a list), not only the last one: the old
--     `receipt` column stays and points at the newest file, so older pages keep working
--   * a payment (or payout, expense, capital line...) moved to another account leaves a trail: who moved it, from
--     which account to which, when and why (money_reassigns). The Money statement prints it under the line.
-- Idempotent.

alter table public.expenses add column if not exists receipts jsonb not null default '[]'::jsonb;

create table if not exists public.money_reassigns (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  src          text not null,              -- payment | payout | expense | capital | shipcost | supplier
  line_id      uuid not null,
  from_account uuid references public.money_accounts(id),
  to_account   uuid not null references public.money_accounts(id),
  reason       text,
  by           text,
  at           timestamptz not null default now()
);
create index if not exists money_reassigns_idx on public.money_reassigns (business_id, src, line_id);
alter table public.money_reassigns enable row level security;
drop policy if exists money_reassigns_read on public.money_reassigns;
create policy money_reassigns_read on public.money_reassigns for select to authenticated
  using (business_id in (select public.my_business_ids('shareholder')));
drop policy if exists money_reassigns_write on public.money_reassigns;
create policy money_reassigns_write on public.money_reassigns for insert to authenticated
  with check (business_id in (select public.my_business_ids('shareholder')));
grant select, insert on public.money_reassigns to authenticated;
