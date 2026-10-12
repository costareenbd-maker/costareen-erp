-- 111: a cost that arrives after the goods (FilaDash merge P3, spec §2.16.2 step 5: "a bill that arrives after the goods
-- is added as a cost adjustment: the part for units already sold goes into this month's cost of sales, the rest raises
-- the cost of the units still on the shelf; nothing is silently recalculated").
--
-- The money itself is a shipment_costs row (it leaves the account named, as freight does). Each late cost is shared
-- over the shipment's lots (by value, weight or units); for each lot the part of the units already gone is
-- `sold` - cost of goods sold of the month it was entered in (Profitability) - and the rest is added to the
-- lot's unit cost, so the units still on the shelf carry it when they sell. Sales already made keep their cost.

create table if not exists public.late_costs (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  reference     text not null,
  month         text not null,
  label         text not null,
  amount        numeric(14,2) not null,
  basis         text not null,
  sold_part     numeric(14,2) not null,
  shelf_part    numeric(14,2) not null,
  split         jsonb not null default '[]'::jsonb,       -- [{ lot, share, sold, shelf, before, after }]
  cost_id       uuid references public.shipment_costs(id) on delete set null,
  by            text,
  at            timestamptz not null default now()
);
create index if not exists late_costs_idx on public.late_costs (business_id, month);
alter table public.late_costs enable row level security;
drop policy if exists late_costs_read on public.late_costs;
create policy late_costs_read on public.late_costs for select to authenticated
  using (business_id in (select public.my_business_ids('manager')));
grant select on public.late_costs to authenticated;
drop policy if exists late_costs_write on public.late_costs;
create policy late_costs_write on public.late_costs for insert to authenticated
  with check (business_id in (select public.my_business_ids('manager')));
grant insert on public.late_costs to authenticated;
