-- Plan D2: repair / service jobs. A customer's machine comes in, is looked
-- at, parts are used, a charge is made, the machine goes back.
create table if not exists public.service_jobs (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  job_no         text not null,
  customer       text not null default '',
  phone          text not null default '',
  customer_key   text,
  item           text not null default '',   -- what came in: "Bambu A1 Mini", "Creality K1"
  sku            text,
  serial         text,
  under_warranty boolean not null default false,
  warranty_until date,
  problem        text not null default '',
  accessories    text,
  status         text not null default 'received'
                 check (status in ('received', 'diagnosed', 'waiting', 'repaired', 'returned', 'cancelled')),
  diagnosis      text,
  parts          jsonb not null default '[]'::jsonb,   -- [{sku, name, qty, price, cost}]
  labour         numeric(14,2) not null default 0,
  charge         numeric(14,2) not null default 0,     -- labour + parts, what the customer pays
  received_at    timestamptz not null default now(),
  returned_at    timestamptz,
  note           text,
  opened_by      text,
  updated_at     timestamptz not null default now(),
  unique (business_id, job_no)
);
create index if not exists service_jobs_idx on public.service_jobs(business_id, status, received_at desc);
alter table public.service_jobs enable row level security;
drop policy if exists service_jobs_rw on public.service_jobs;
create policy service_jobs_rw on public.service_jobs for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.service_jobs to authenticated;
