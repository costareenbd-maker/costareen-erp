-- content-desk-1 (owner 19 Nov 2026, docs/CONTENT-DESK-PLAN.md): the business Content desk.
-- content_events: facts the ERP saw (a new product, a supplier order on its way, a shipment received). The minute
--   timer hands each one, when due, to the business's own content engine on the Mac (the bizdesk bridge, the same
--   protocol as the Brand desk) as a draft + video request. Nothing is ever published from here.
-- content_videos: the finished videos the engine uploaded into the ERP's file store, waiting for the people who run
--   the business's pages to download them or get them on the business's own WhatsApp (sent = who got it, when).
-- The handlers' list (name + phone) is the business_config key 'content_handlers' (JSON [{name, phone}]).
create table if not exists public.content_events (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null check (kind in ('new_product', 'shipment_coming', 'shipment_arrived')),
  ref         text not null,                      -- the order number / shipment reference / first product of a batch
  payload     jsonb not null default '{}'::jsonb, -- facts only, read from the ERP (names, brand, sku, price, qty, stock, ETA)
  due_at      timestamptz not null default now(),
  state       text not null default 'waiting' check (state in ('waiting', 'sent', 'failed', 'skipped')),
  tries       int not null default 0,
  sent_at     timestamptz,
  error       text,
  bridge_job  text,
  idea_id     bigint,
  created_at  timestamptz not null default now(),
  unique (business_id, kind, ref)
);
create index if not exists content_events_due_idx on public.content_events (state, due_at);
create index if not exists content_events_biz_idx on public.content_events (business_id, created_at desc);

create table if not exists public.content_videos (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  draft_id    bigint,
  title       text not null default '',
  platform    text not null default '',
  file_path   text not null,                      -- in the file store under <business id>/: content/<uuid>.mp4
  bytes       bigint,
  made_by     text,
  created_at  timestamptz not null default now(),
  sent        jsonb not null default '[]'::jsonb,  -- [{name, phone, at, by, via}]
  unique (business_id, file_path)
);
create index if not exists content_videos_biz_idx on public.content_videos (business_id, created_at desc);

do $$
begin
  execute 'alter table public.content_events enable row level security';
  execute 'alter table public.content_videos enable row level security';
  -- events are written by the system on whoever's save made the fact (a salesperson may add a product), so any member
  -- of the business may write them; the handlers only ever put ERP facts in them. No delete: they are history.
  execute 'drop policy if exists content_events_read on public.content_events';
  execute 'create policy content_events_read on public.content_events for select to authenticated using (business_id in (select public.my_business_ids(''member'')))';
  execute 'drop policy if exists content_events_ins on public.content_events';
  execute 'create policy content_events_ins on public.content_events for insert to authenticated with check (business_id in (select public.my_business_ids(''member'')))';
  execute 'drop policy if exists content_events_upd on public.content_events';
  execute 'create policy content_events_upd on public.content_events for update to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))';
  execute 'drop policy if exists content_videos_read on public.content_videos';
  execute 'create policy content_videos_read on public.content_videos for select to authenticated using (business_id in (select public.my_business_ids(''member'')))';
  execute 'drop policy if exists content_videos_write on public.content_videos';
  execute 'create policy content_videos_write on public.content_videos for insert to authenticated with check (business_id in (select public.my_business_ids(''manager'')))';
  execute 'drop policy if exists content_videos_upd on public.content_videos';
  execute 'create policy content_videos_upd on public.content_videos for update to authenticated using (business_id in (select public.my_business_ids(''manager''))) with check (business_id in (select public.my_business_ids(''manager'')))';
  execute 'grant select, insert, update on public.content_events to authenticated';
  execute 'grant select, insert, update on public.content_videos to authenticated';
  execute 'grant usage, select on sequence public.content_events_id_seq to authenticated';
  execute 'grant usage, select on sequence public.content_videos_id_seq to authenticated';
end $$;
