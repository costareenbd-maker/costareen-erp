-- control-only (the installer never copies this file into a company's database)
-- Stage N7 (docs/NETWORK-BLUEPRINT.md section 4.1 "Get it printed"): a public board of print jobs. A stranger posts
-- a file (or a sketch), sees an estimate made in his browser, farms on the platform offer a price, he chooses one,
-- the farm prints and invoices in its own ERP, he rates the farm. The platform is only the board: it holds no money.
create table if not exists public.erp_print_board (
  id           uuid primary key default gen_random_uuid(),
  job_no       text not null unique,                   -- GP-yymmdd-xxxx
  name         text,                                   -- the buyer; shown to the chosen farm only
  phone        text,
  city         text,
  material     text,
  colour       text,
  qty          int not null default 1,
  notes        text,
  link         text,                                   -- a file elsewhere (Drive, Printables)
  file_name    text,                                   -- uploaded file under public/printjobs/<id>/
  file_path    text,
  file_size    int,
  est          jsonb,                                  -- the browser's estimate: {grams, hours, low, high, infill, triangles, box}
  status       text not null default 'uploading' check (status in ('uploading', 'open', 'taken', 'done', 'closed', 'removed')),
  token_hash   text,                                   -- the buyer's job link
  consent      jsonb,
  chosen_offer uuid,
  taken_by     text,                                   -- "<source>:<business>"
  taken_at     timestamptz,
  done_at      timestamptz,
  farm_job_no  text,                                   -- the farm's print job (print_jobs.job_no)
  farm_contact jsonb,                                  -- the chosen farm's name/phone/address, shown to the buyer
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists erp_print_board_idx on public.erp_print_board(status, created_at desc);
alter table public.erp_print_board enable row level security;
revoke all on public.erp_print_board from anon, authenticated;

create table if not exists public.erp_board_offers (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.erp_print_board(id) on delete cascade,
  source       text not null,
  business_id  uuid not null,
  farm_name    text,                                   -- the shop's public name when it is public, else "Farm · city"
  city         text,
  price        numeric(14,2) not null,
  days         int,
  note         text,
  status       text not null default 'offered' check (status in ('offered', 'chosen', 'passed', 'withdrawn')),
  created_at   timestamptz not null default now(),
  unique (board_id, source, business_id)
);
alter table public.erp_board_offers enable row level security;
revoke all on public.erp_board_offers from anon, authenticated;

create table if not exists public.erp_farm_ratings (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references public.erp_print_board(id) on delete cascade,
  source       text not null,
  business_id  uuid not null,
  stars        int not null check (stars between 1 and 5),
  text         text,
  created_at   timestamptz not null default now(),
  unique (board_id)
);
create index if not exists erp_farm_ratings_idx on public.erp_farm_ratings(source, business_id);
alter table public.erp_farm_ratings enable row level security;
revoke all on public.erp_farm_ratings from anon, authenticated;
