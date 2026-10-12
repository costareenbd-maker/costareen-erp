-- Online Brawl between people of one business: who beat whom. The fight itself goes
-- browser to browser over Supabase Realtime; only the result is kept here.
create table if not exists public.arena_matches (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  mid         text not null,
  winner      uuid not null,
  loser       uuid not null,
  winner_name text not null default '',
  loser_name  text not null default '',
  score       text not null default '',
  created_at  timestamptz not null default now(),
  unique (business_id, mid)
);
create index if not exists arena_matches_biz_idx on public.arena_matches(business_id, created_at desc);
alter table public.arena_matches enable row level security;
drop policy if exists arena_member_read on public.arena_matches;
create policy arena_member_read on public.arena_matches for select
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists arena_member_insert on public.arena_matches;
create policy arena_member_insert on public.arena_matches for insert
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert on public.arena_matches to authenticated;
