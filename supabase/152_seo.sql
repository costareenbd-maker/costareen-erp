-- seo-1 (Bendar B6, 28 Oct 2026): SEO checks per website. One row per check (nightly, or "Check now");
-- the latest row per site is the screen, the older rows the history. Advice = the AI's fix list for that check.
create table if not exists seo_checks (
  id uuid primary key default gen_random_uuid(),
  business_id uuid not null references businesses(id) on delete cascade,
  site text not null,
  checked_at timestamptz not null default now(),
  ok boolean not null default true,
  status int,
  ms int,
  score int not null default 0,
  light text not null default 'r' check (light in ('g', 'y', 'r')),
  perf int,
  seo int,
  lcp numeric,
  cls numeric,
  issues jsonb not null default '[]'::jsonb,
  facts jsonb not null default '{}'::jsonb,
  advice jsonb,
  advised_at timestamptz
);
create index if not exists seo_checks_biz_site on seo_checks (business_id, site, checked_at desc);
alter table seo_checks enable row level security;
drop policy if exists seo_checks_read on seo_checks;
create policy seo_checks_read on seo_checks for select to authenticated
  using (business_id in (select public.my_business_ids('shareholder')));
drop policy if exists seo_checks_write on seo_checks;
create policy seo_checks_write on seo_checks for insert to authenticated
  with check (business_id in (select public.my_business_ids('shareholder')));
drop policy if exists seo_checks_update on seo_checks;
create policy seo_checks_update on seo_checks for update to authenticated
  using (business_id in (select public.my_business_ids('shareholder')))
  with check (business_id in (select public.my_business_ids('shareholder')));
grant select, insert, update on seo_checks to authenticated;
