-- 108: shipment costing by weight + shipment stages (FilaDash merge P3; spec D46 / §2.10.13).
--
-- A product's shipping size: weight per unit in grams and, optionally, the box it travels in (mm). Freight is
-- charged on the CHARGEABLE weight: the larger of the real weight and the box-size weight (L x W x H / divisor,
-- default 6,000 cm3 per kg - in mm3 that gives grams). Receiving can then spread freight and every other cost
-- by weight (chargeable), by value or by units.
--
-- A purchase order goes Planned -> Ordered -> In transit -> Received. po_stages keeps the stage of each order
-- and what is known about the shipment on the way (number, agent, by sea/air, weight, freight rate per kg,
-- expected date). Receiving it (erpPoArrive) is unchanged and marks it Received.

alter table public.products add column if not exists weight_g  numeric(12,1);
alter table public.products add column if not exists length_mm numeric(10,1);
alter table public.products add column if not exists width_mm  numeric(10,1);
alter table public.products add column if not exists height_mm numeric(10,1);

create table if not exists public.po_stages (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  po_no          text not null,
  stage          text not null default 'ordered' check (stage in ('planned', 'ordered', 'in_transit', 'received')),
  shipment_no    text,
  agent          text,
  ship_by        text,
  weight_kg      numeric(12,2),
  freight_per_kg numeric(12,2),
  divisor        numeric(10,0),
  eta            date,
  note           text,
  updated_by     text,
  updated_at     timestamptz not null default now(),
  unique (business_id, po_no)
);
alter table public.po_stages enable row level security;
drop policy if exists po_stages_read on public.po_stages;
create policy po_stages_read on public.po_stages for select to authenticated
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists po_stages_write on public.po_stages;
create policy po_stages_write on public.po_stages for all to authenticated
  using (business_id in (select public.my_business_ids('manager')))
  with check (business_id in (select public.my_business_ids('manager')));
grant select, insert, update on public.po_stages to authenticated;
