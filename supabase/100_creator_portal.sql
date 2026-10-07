-- Creator portal (handlers/creatorportal.js): a creator's own page behind a permanent link - he requests filament
-- for his next project, the owner approves and hands it over, the creator pastes the video / post links into that
-- project, YouTube numbers are fetched by the ERP; the brand watches it all on its own read-only page.
create table if not exists public.erp_creator_requests (
  id            bigserial primary key,
  business_id   uuid not null,
  creator_id    bigint not null references public.erp_creators(id) on delete cascade,
  status        text not null default 'requested',       -- requested | approved | given | declined | done
  title         text,                                    -- what the video is about
  sku           text,
  product       text not null,
  qty           numeric(12,2) not null default 1,        -- asked
  qty_ok        numeric(12,2),                           -- approved / given
  value         numeric(14,2) not null default 0,        -- retail value of what was given
  note          text,                                    -- the creator's note
  owner_note    text,                                    -- the owner's reply
  requested_at  timestamptz not null default now(),
  decided_at    timestamptz,
  given_at      timestamptz,
  updated_at    timestamptz not null default now()
);
alter table public.erp_creator_ships add column if not exists request_id bigint references public.erp_creator_requests(id) on delete set null;
alter table public.erp_creator_posts add column if not exists request_id bigint references public.erp_creator_requests(id) on delete set null;
alter table public.erp_creator_posts add column if not exists verified boolean not null default false;   -- numbers fetched from YouTube
alter table public.erp_creator_posts add column if not exists fetched_at timestamptz;
alter table public.erp_creator_posts add column if not exists by text not null default 'owner';           -- owner | creator | youtube
alter table public.erp_creators add column if not exists open_limit int not null default 1;               -- projects allowed with filament given but no link yet
alter table public.erp_creators add column if not exists whatsapp text;
create table if not exists public.erp_creator_events (
  id            bigserial primary key,
  business_id   uuid not null,
  creator_id    bigint references public.erp_creators(id) on delete cascade,
  request_id    bigint,
  post_id       bigint,
  who           text not null,                           -- owner | creator | youtube | system
  what          text not null,                           -- requested | approved | declined | given | linked | numbers | fetched | saved
  detail        text,
  ip            text,
  at            timestamptz not null default now()
);
create index if not exists erp_creator_requests_idx on public.erp_creator_requests(business_id, creator_id, status);
create index if not exists erp_creator_events_idx on public.erp_creator_events(business_id, creator_id, at desc);
do $$ declare t text; begin
  foreach t in array array['erp_creator_requests', 'erp_creator_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all using (business_id in (select public.my_business_ids(''owner''))) with check (business_id in (select public.my_business_ids(''owner'')))', t || '_rw', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
