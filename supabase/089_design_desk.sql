-- control-only (the installer never copies this file into a company's database)
-- Stage N8 (docs/NETWORK-BLUEPRINT.md section 4.1 "Design desk", repair-part requests): a sketch becomes a file, then a
-- print. A buyer (or a repair shop for its customer) posts what he needs - a new design, a broken part to copy, a
-- personalised thing - with a photo or sketch; designers on the desk offer a price and days; the buyer chooses one; the
-- designer delivers the file on the request; the buyer accepts and rates; "Get it printed" takes the file to the farms.
-- Designers need no ERP: a Lite-style record with a link (like the Lite sellers of stage N2). The platform holds no money.
create table if not exists public.erp_designers (
  id           uuid primary key default gen_random_uuid(),
  slug         text not null unique,                  -- the public profile: design?p=<slug>
  name         text not null,
  phone        text,                                  -- shown to the buyer who chose this designer only
  city         text,
  link         text,                                  -- portfolio (Printables, MakerWorld, Behance, Facebook page)
  skills       text,                                  -- "Fusion 360, FreeCAD, Blender"
  about        text,
  public       boolean not null default true,         -- listed on the desk's front page
  token_hash   text,                                  -- the designer's own link
  status       text not null default 'active' check (status in ('active', 'blocked')),
  consent      jsonb,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.erp_designers enable row level security;
revoke all on public.erp_designers from anon, authenticated;

create table if not exists public.erp_design_requests (
  id           uuid primary key default gen_random_uuid(),
  req_no       text not null unique,                  -- DR-yymmdd-xxxx
  kind         text not null default 'design' check (kind in ('design', 'repair', 'personal')),
  title        text,
  what         text,                                  -- the description
  size         text,                                  -- measurements, in words
  deadline     text,
  budget       text,                                  -- a hint, in words
  city         text,
  name         text,                                  -- the buyer; shown to the chosen designer only
  phone        text,
  link         text,                                  -- a photo or drawing elsewhere
  file_name    text,                                  -- the sketch / photo uploaded, under public/design/<id>/
  file_path    text,
  file_size    int,
  out_name     text,                                  -- the delivered file, under public/design/<id>/out/
  out_path     text,
  out_size     int,
  out_note     text,                                  -- the designer's words with the file
  change_note  text,                                  -- the buyer's "needs changes" words
  status       text not null default 'uploading' check (status in ('uploading', 'open', 'taken', 'delivered', 'done', 'closed', 'removed')),
  token_hash   text,                                  -- the buyer's request link
  consent      jsonb,
  chosen_offer uuid,
  designer_id  uuid references public.erp_designers(id),
  taken_at     timestamptz,
  delivered_at timestamptz,
  done_at      timestamptz,
  via          text,                                  -- "<source>:<business>" when a repair shop posted it from a job
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists erp_design_requests_idx on public.erp_design_requests(status, created_at desc);
alter table public.erp_design_requests enable row level security;
revoke all on public.erp_design_requests from anon, authenticated;

create table if not exists public.erp_design_offers (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.erp_design_requests(id) on delete cascade,
  designer_id  uuid not null references public.erp_designers(id) on delete cascade,
  price        numeric(14,2) not null,
  days         int,
  note         text,
  status       text not null default 'offered' check (status in ('offered', 'chosen', 'passed', 'withdrawn')),
  created_at   timestamptz not null default now(),
  unique (request_id, designer_id)
);
alter table public.erp_design_offers enable row level security;
revoke all on public.erp_design_offers from anon, authenticated;

create table if not exists public.erp_designer_ratings (
  id           uuid primary key default gen_random_uuid(),
  request_id   uuid not null references public.erp_design_requests(id) on delete cascade,
  designer_id  uuid not null references public.erp_designers(id) on delete cascade,
  stars        int not null check (stars between 1 and 5),
  text         text,
  created_at   timestamptz not null default now(),
  unique (request_id)
);
create index if not exists erp_designer_ratings_idx on public.erp_designer_ratings(designer_id);
alter table public.erp_designer_ratings enable row level security;
revoke all on public.erp_designer_ratings from anon, authenticated;
