-- Online Brawl across companies (multi-3): owners of businesses that switched it on meet in one
-- world room. Server-only tables: no policy, so no login reads or writes them through the API;
-- the Edge Function writes them on its own connection after checking the caller.
create table if not exists public.arena_settings (
  k text primary key,
  v text not null default ''
);
alter table public.arena_settings enable row level security;
revoke all on public.arena_settings from anon, authenticated;

create table if not exists public.arena_world (
  id           uuid primary key default gen_random_uuid(),
  mid          text not null unique,
  winner       uuid not null,
  loser        uuid not null,
  winner_name  text not null default '',
  loser_name   text not null default '',
  winner_co    text not null default '',
  loser_co     text not null default '',
  score        text not null default '',
  created_at   timestamptz not null default now()
);
create index if not exists arena_world_at_idx on public.arena_world(created_at desc);
alter table public.arena_world enable row level security;
revoke all on public.arena_world from anon, authenticated;
