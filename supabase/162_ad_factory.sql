-- factory-1 (9 Nov 2026): the weekly ad factory (handlers/factory.js). One row per business per ISO week, and its angles.
create table if not exists public.ad_factory_weeks (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  week         text not null,                                      -- 2026-W46 (Dhaka)
  status       text not null default 'planning' check (status in ('planning', 'ready', 'empty', 'approving', 'testing', 'reviewed')),
  approved_by  text,
  approved_at  timestamptz,
  error        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (business_id, week)
);
create table if not exists public.ad_factory_items (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  week_id      uuid not null references public.ad_factory_weeks(id) on delete cascade,
  sku          text,
  name         text,
  kind         text,                                               -- advertise | rising | clear
  angle        text,
  hook         text,
  caption      text,
  scene        text,
  why          text,
  asset_id     uuid,                                               -- social_assets (the ChatGPT picture)
  post_id      uuid,                                               -- social_posts (the test post)
  campaign_id  uuid,                                               -- ad_campaigns (a winner, made PAUSED)
  state        text not null default 'ready' check (state in ('photo', 'ready', 'posted', 'skipped', 'tested', 'winner')),
  score        jsonb,
  error        text,
  created_at   timestamptz not null default now()
);
create index if not exists ad_factory_items_week_idx on public.ad_factory_items(week_id);

alter table public.ad_factory_weeks enable row level security;
alter table public.ad_factory_items enable row level security;
drop policy if exists ad_factory_weeks_rw on public.ad_factory_weeks;
create policy ad_factory_weeks_rw on public.ad_factory_weeks for all to authenticated
  using (business_id in (select public.my_business_ids('manager'))) with check (business_id in (select public.my_business_ids('manager')));
drop policy if exists ad_factory_items_rw on public.ad_factory_items;
create policy ad_factory_items_rw on public.ad_factory_items for all to authenticated
  using (business_id in (select public.my_business_ids('manager'))) with check (business_id in (select public.my_business_ids('manager')));
grant select, insert, update on public.ad_factory_weeks, public.ad_factory_items to authenticated;
