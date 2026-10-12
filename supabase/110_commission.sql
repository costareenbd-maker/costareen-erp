-- 110: sales commission (FilaDash merge P3).
--
-- Rules say what a seller earns on what they sell: for everyone or one person, on everything, a category, a brand or
-- one product, as a % of the sales (after discounts) or of the gross profit. On each invoice line the most specific
-- rule wins (product > brand > category > everything; one person's rule before everyone's at the same level).
-- The seller of an invoice is the person who made it; a return takes the commission back from the original seller.
-- What sellers earn in a month is a cost of that month (P&L, category Commission); paying it is an expense row
-- 'Commission paid to ...' that is not counted a second time.

create table if not exists public.commission_rules (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  seller       uuid references auth.users(id) on delete cascade,      -- null = everyone who sells
  scope        text not null check (scope in ('all', 'category', 'brand', 'sku')),
  match        text not null default '',
  basis        text not null check (basis in ('sales', 'profit')),
  pct          numeric(7,3) not null check (pct > 0 and pct <= 100),
  note         text,
  by           text,
  at           timestamptz not null default now(),
  voided_at    timestamptz
);
create index if not exists commission_rules_idx on public.commission_rules (business_id) where voided_at is null;
alter table public.commission_rules enable row level security;
drop policy if exists commission_rules_read on public.commission_rules;
create policy commission_rules_read on public.commission_rules for select to authenticated
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists commission_rules_write on public.commission_rules;
create policy commission_rules_write on public.commission_rules for all to authenticated
  using (business_id in (select public.my_business_ids('owner')))
  with check (business_id in (select public.my_business_ids('owner')));
grant select, insert, update on public.commission_rules to authenticated;
