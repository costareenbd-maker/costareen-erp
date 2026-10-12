-- Sheet build b261003-0358: every round of "which parcels are delivered?" is
-- written down - what was asked about and what the courier said - so
-- "is it really checking?" has an answer (was: the hidden DELIVERY_CHECKS tab).
create table if not exists public.delivery_checks (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  at          timestamptz not null default now(),
  by          text,
  asked       int not null default 0,
  collected   text,
  amount      numeric(14,2) not null default 0,
  raised      text,
  came_back   text,
  part        text,
  problem     text,
  said        text
);
create index if not exists delivery_checks_idx on public.delivery_checks(business_id, at desc);
alter table public.delivery_checks enable row level security;
drop policy if exists delivery_checks_read on public.delivery_checks;
create policy delivery_checks_read on public.delivery_checks for select
  using (business_id in (select public.my_business_ids('manager')));
drop policy if exists delivery_checks_insert on public.delivery_checks;
create policy delivery_checks_insert on public.delivery_checks for insert
  with check (business_id in (select public.my_business_ids('manager')));
grant select, insert on public.delivery_checks to authenticated;
