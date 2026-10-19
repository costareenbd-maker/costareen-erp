-- 132: paid campaigns on Facebook / Instagram (owner 20 Oct 2026, advertising automation S4). The ERP builds the
-- campaign PAUSED (campaign, ad set, creative on one of our published posts, ad), shows the preview and the cost, and
-- only the owner's Start makes it run. Spend is read every hour and written to Expenses under Advertising; caps and
-- auto-pause rules live in business_config (ads_settings). Nothing is deleted: a stopped campaign stays here.

create table if not exists public.ad_campaigns (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  post_id       uuid references public.social_posts(id) on delete set null,
  name          text not null,
  objective     text not null check (objective in ('messages', 'traffic', 'reach', 'sales')),
  account       text not null,                          -- act_<id>
  campaign_id   text,
  adset_id      text,
  creative_id   text,
  ad_id         text,
  story_id      text,                                   -- the page post the ad shows (pageid_postid)
  daily_budget  numeric(12,2) not null,                 -- in the account's currency
  days          int not null default 7,
  starts_at     timestamptz,
  ends_at       timestamptz,
  targeting     jsonb not null default '{}',            -- {countries, ageMin, ageMax, interests:[{id,name}], customers, lookalike}
  status        text not null default 'ready' check (status in ('ready', 'running', 'paused', 'done', 'stopped', 'failed')),
  preview       text,                                   -- the iframe Meta gives for the preview
  spend         numeric(12,2) not null default 0,
  results       jsonb not null default '{}',            -- {impressions, reach, clicks, messages, purchases, cpm, costPerResult, byDay:{date:spend}}
  error         text,
  auto_note     text,                                   -- why the ERP paused it, if it did
  stats_at      timestamptz,
  started_by    text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists ad_campaigns_biz_idx on public.ad_campaigns(business_id, created_at desc);

alter table public.ad_campaigns enable row level security;
drop policy if exists ad_campaigns_rw on public.ad_campaigns;
create policy ad_campaigns_rw on public.ad_campaigns for all to authenticated
  using (business_id in (select public.my_business_ids('manager')))
  with check (business_id in (select public.my_business_ids('manager')));
grant select, insert, update on public.ad_campaigns to authenticated;
