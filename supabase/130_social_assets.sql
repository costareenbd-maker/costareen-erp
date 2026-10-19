-- 130: the content factory (owner 20 Oct 2026, advertising automation S2): pictures and videos made for the shop -
-- photo cards drawn from the product's own photo and price, AI photos (the product placed in a scene), template reels
-- cut on the office server from photos, text and a voice-over. Each one is a row here; the file lives in 'social'.
-- A video is made on the render server and uploaded straight into the file store; its row waits as 'rendering'
-- until the minute timer sees the job finished.

create table if not exists public.social_assets (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  kind          text not null check (kind in ('image', 'video')),
  template      text not null,                         -- card: clean | offer | left | new | bundle; ai: scene; video: spin | reveal | reasons | showcase
  sku           text,
  title         text,
  file          text not null,                         -- 'social/<name>'
  status        text not null default 'ready' check (status in ('rendering', 'ready', 'failed', 'removed')),
  job           text,                                  -- the render server's job id while rendering
  error         text,
  meta          jsonb not null default '{}',           -- {width,height,seconds,script,voice,lang,...}
  cost_bdt      numeric(10,2) not null default 0,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists social_assets_biz_idx on public.social_assets(business_id, created_at desc);
create index if not exists social_assets_job_idx on public.social_assets(status) where status = 'rendering';

alter table public.social_assets enable row level security;
drop policy if exists social_assets_rw on public.social_assets;
create policy social_assets_rw on public.social_assets for all to authenticated
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.social_assets to authenticated;
