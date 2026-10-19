-- 129: social posts (owner 20 Oct 2026, advertising automation stage S1): a post made in the ERP - media, a caption
-- for each platform - published to the Facebook Page and Instagram through the one Meta login, now or at a set time,
-- with what each platform answered and the figures read back later. Nothing is deleted once published.

create table if not exists public.social_posts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  sku           text,                                  -- the product it is about (optional)
  title         text,                                  -- how the list names it
  media         jsonb not null default '[]',           -- [{kind:'image'|'video', file:'folder/name' | url, name}]
  captions      jsonb not null default '{}',           -- {facebook, instagram, marketplace, whatsapp}
  targets       jsonb not null default '{}',           -- {facebook:true, instagram:false}
  page_id       text,                                  -- the Facebook Page (its Instagram comes with it)
  state         text not null default 'draft' check (state in ('draft', 'approved', 'scheduled', 'publishing', 'published', 'failed', 'removed')),
  scheduled_at  timestamptz,
  published_at  timestamptz,
  results       jsonb not null default '{}',           -- {facebook:{id,link,error}, instagram:{id,link,creation,error}}
  stats         jsonb not null default '{}',           -- {facebook:{reach,reactions,comments,shares}, instagram:{reach,likes,comments,saved,shares}, at}
  stats_at      timestamptz,
  error         text,
  created_by    text,
  approved_by   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists social_posts_biz_idx on public.social_posts(business_id, created_at desc);
create index if not exists social_posts_due_idx on public.social_posts(state, scheduled_at) where state in ('scheduled', 'publishing');

alter table public.social_posts enable row level security;
drop policy if exists social_posts_rw on public.social_posts;
create policy social_posts_rw on public.social_posts for all to authenticated
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.social_posts to authenticated;
