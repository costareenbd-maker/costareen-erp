-- Stage N4 (docs/NETWORK-BLUEPRINT.md section 4, "print-business kit"): for a business that prints for customers.
-- Printers it owns, spools it has opened (grams are taken from them per job), print jobs with their true cost, and
-- quote requests that arrive through the business's own public quote link. Company database (every copy gets it).

create table if not exists public.printers (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  name           text not null,
  model          text,
  serial         text,
  bought_at      date,
  cost           numeric(14,2) not null default 0,      -- what it cost (for wear per hour)
  life_hours     int not null default 5000,             -- expected printing hours before it is worth nothing
  power_w        int not null default 150,              -- average draw while printing
  maintenance_hr numeric(14,2) not null default 0,      -- nozzles, belts, bed sheets per printing hour
  status         text not null default 'active' check (status in ('active', 'down', 'sold')),
  notes          text,
  created_at     timestamptz not null default now()
);
create index if not exists printers_idx on public.printers(business_id, status);
alter table public.printers enable row level security;
drop policy if exists printers_rw on public.printers;
create policy printers_rw on public.printers for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.printers to authenticated;

-- a spool taken off the shelf for printing (one unit out of stock); jobs draw grams from it
create table if not exists public.filament_spools (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  product_id   uuid not null references public.products(id),
  sku          text not null,
  name         text not null,
  net_g        numeric(10,1) not null default 1000,
  remaining_g  numeric(10,1) not null default 1000,
  cost         numeric(14,2) not null default 0,        -- the spool's cost when opened (cost per gram = cost / net_g)
  txn_no       text,                                    -- the stock movement that took it off the shelf
  opened_at    timestamptz not null default now(),
  finished_at  timestamptz,
  note         text
);
create index if not exists filament_spools_idx on public.filament_spools(business_id, finished_at, opened_at desc);
alter table public.filament_spools enable row level security;
drop policy if exists filament_spools_rw on public.filament_spools;
create policy filament_spools_rw on public.filament_spools for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.filament_spools to authenticated;

create table if not exists public.print_jobs (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  job_no         text not null,
  title          text not null,
  customer       text,
  phone          text,
  customer_key   text,
  invoice_no     text,
  request_id     uuid,
  printer_id     uuid references public.printers(id),
  spool_id       uuid references public.filament_spools(id),
  sku            text,                                  -- the filament product (when no spool is picked)
  material       text,
  planned_g      numeric(10,1) not null default 0,
  actual_g       numeric(10,1) not null default 0,
  failed_g       numeric(10,1) not null default 0,      -- wasted on failed attempts
  planned_h      numeric(10,2) not null default 0,
  actual_h       numeric(10,2) not null default 0,
  labour_min     int not null default 0,
  extra_cost     numeric(14,2) not null default 0,      -- inserts, glue, paint, courier...
  price          numeric(14,2) not null default 0,      -- what the customer pays
  cost_material  numeric(14,2) not null default 0,
  cost_machine   numeric(14,2) not null default 0,
  cost_labour    numeric(14,2) not null default 0,
  cost_pack      numeric(14,2) not null default 0,
  cost_total     numeric(14,2) not null default 0,
  status         text not null default 'queued' check (status in ('queued', 'printing', 'finishing', 'ready', 'delivered', 'failed', 'cancelled')),
  queued_at      timestamptz not null default now(),
  started_at     timestamptz,
  done_at        timestamptz,
  delivered_at   timestamptz,
  file_name      text,
  notes          text,
  created_by     text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (business_id, job_no)
);
create index if not exists print_jobs_idx on public.print_jobs(business_id, status, queued_at desc);
alter table public.print_jobs enable row level security;
drop policy if exists print_jobs_rw on public.print_jobs;
create policy print_jobs_rw on public.print_jobs for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.print_jobs to authenticated;

-- a customer's request through the business's public quote link
create table if not exists public.print_requests (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  req_no       text not null,
  name         text not null,
  phone        text not null,
  email        text,
  material     text,
  colour       text,
  qty          int not null default 1,
  notes        text,
  link         text,                                    -- where the file is (Drive, Printables...)
  status       text not null default 'new' check (status in ('new', 'quoted', 'accepted', 'declined', 'job', 'closed')),
  price        numeric(14,2),
  quote_note   text,
  token_hash   text,
  job_no       text,
  consent      jsonb,
  created_at   timestamptz not null default now(),
  quoted_at    timestamptz,
  answered_at  timestamptz,
  unique (business_id, req_no)
);
create index if not exists print_requests_idx on public.print_requests(business_id, status, created_at desc);
alter table public.print_requests enable row level security;
drop policy if exists print_requests_rw on public.print_requests;
create policy print_requests_rw on public.print_requests for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.print_requests to authenticated;
