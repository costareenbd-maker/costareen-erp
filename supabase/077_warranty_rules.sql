-- Stage N0 (docs/NETWORK-BLUEPRINT.md): warranty rules, set once per category (and brand), so every new product of
-- that kind is sold by serial number with the right warranty, and the existing ones get it with one button.
-- '' in category or brand means "any". A product changed by hand afterwards keeps its own values until a rule is applied again.
create table if not exists public.warranty_rules (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  category        text not null default '',
  brand           text not null default '',
  serialised      boolean not null default true,
  warranty_months int,
  transferable    boolean not null default true,
  created_by      text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists warranty_rules_one_idx on public.warranty_rules(business_id, lower(category), lower(brand));
alter table public.warranty_rules enable row level security;
drop policy if exists warranty_rules_read on public.warranty_rules;
create policy warranty_rules_read on public.warranty_rules for select
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists warranty_rules_write on public.warranty_rules;
create policy warranty_rules_write on public.warranty_rules for all
  using (business_id in (select public.my_business_ids('manager')))
  with check (business_id in (select public.my_business_ids('manager')));
grant select, insert, update, delete on public.warranty_rules to authenticated;
-- whether the warranty moves with the machine when it is sold on (shown on the passport)
alter table public.products add column if not exists warranty_transferable boolean not null default true;
