-- Creators (influencer sponsorships for a brand, e.g. Polymaker through its reseller): who they are, what filament
-- they got, what they posted and how it did, student/robotics projects to pass on, and the monthly report for the
-- brand. Owner-only on the page ("Only me" app, handlers/apps.js); the tables follow the ordinary business rules.
create table if not exists public.erp_creators (
  id            bigserial primary key,
  business_id   uuid not null,
  name          text not null,
  handle        text,                                   -- channel / page / group name
  platforms     text,                                   -- "YouTube, Facebook group"
  followers     text,                                   -- free text: "12k group, 3k YouTube"
  brand         text not null default '',               -- whose filament: Polymaker
  code          text,                                   -- their discount code / tracking word on invoices
  videos_month  int  not null default 2,
  posts_month   int  not null default 2,
  rolls_video   int  not null default 2,
  filament      text,                                   -- "general, from stock" / "engineering grade (ask first)"
  trial_until   date,
  status        text not null default 'active',         -- active | paused | stopped
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.erp_creator_ships (
  id            bigserial primary key,
  business_id   uuid not null,
  creator_id    bigint not null references public.erp_creators(id) on delete cascade,
  on_date       date not null,
  sku           text,
  product       text not null,
  qty           numeric(12,2) not null default 1,
  value         numeric(14,2) not null default 0,       -- retail value in BDT (sell price x qty when the SKU is known)
  note          text,
  created_at    timestamptz not null default now()
);
create table if not exists public.erp_creator_posts (
  id            bigserial primary key,
  business_id   uuid not null,
  creator_id    bigint not null references public.erp_creators(id) on delete cascade,
  on_date       date not null,
  platform      text,                                   -- YouTube | Facebook | Instagram | TikTok
  kind          text not null default 'video',          -- video | post | reel
  url           text,
  product       text,
  views         int  not null default 0,
  likes         int  not null default 0,
  comments      int  not null default 0,
  shares        int  not null default 0,
  leads         int  not null default 0,                -- customer enquiries they reported
  note          text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create table if not exists public.erp_creator_projects (
  id            bigserial primary key,
  business_id   uuid not null,
  creator_id    bigint not null references public.erp_creators(id) on delete cascade,
  team          text not null,
  project       text,
  competition   text,
  material      text,
  qty           text,
  status        text not null default 'new',            -- new | sent | approved | declined
  note          text,
  created_at    timestamptz not null default now()
);
create index if not exists erp_creators_biz_idx on public.erp_creators(business_id);
create index if not exists erp_creator_ships_idx on public.erp_creator_ships(business_id, creator_id, on_date);
create index if not exists erp_creator_posts_idx on public.erp_creator_posts(business_id, creator_id, on_date);
create index if not exists erp_creator_projects_idx on public.erp_creator_projects(business_id, creator_id);
do $$ declare t text; begin
  foreach t in array array['erp_creators', 'erp_creator_ships', 'erp_creator_posts', 'erp_creator_projects'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all using (business_id in (select public.my_business_ids(''owner''))) with check (business_id in (select public.my_business_ids(''owner'')))', t || '_rw', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
