-- 131: the inspiration box (owner 20 Oct 2026, advertising automation S3): a reel or post the owner points at - a link,
-- or the video file when the site will not give it to a server - studied by the AI into a "style card": the hook, the
-- structure, the shots, the pace, the caption style, what to copy. The next reel can be made "in this style".
-- The owner's rules, what worked (the learning loop) and the Pexels key live in business_config / business_secrets.

create table if not exists public.social_inspo (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  url           text,
  file          text,                                  -- 'social/inspo-<id>.mp4' when uploaded
  note          text,                                  -- what the owner liked about it
  status        text not null default 'studying' check (status in ('studying', 'ready', 'failed', 'removed')),
  job           text,
  error         text,
  meta          jsonb not null default '{}',           -- {title, by, views, likes, seconds, width, height, site, frames:[files], audio:file}
  style         jsonb not null default '{}',           -- the style card
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists social_inspo_biz_idx on public.social_inspo(business_id, created_at desc);

alter table public.social_inspo enable row level security;
drop policy if exists social_inspo_rw on public.social_inspo;
create policy social_inspo_rw on public.social_inspo for all to authenticated
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.social_inspo to authenticated;
