-- control-only (the installer never copies this file into a company's database)
-- Stage N1b (docs/NETWORK-BLUEPRINT.md section 4.5): the community base - a public updates page, an ideas board with
-- votes and a status on every idea (planned / being built / done), guides, and credits for who contributed what.
create table if not exists public.erp_ideas (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  text        text not null,
  name        text not null,                       -- first name for the credit
  contact     text,                                -- phone or e-mail, only for the platform to ask back; never shown
  consent     jsonb,
  status      text not null default 'new' check (status in ('new', 'planned', 'building', 'done', 'declined')),
  reply       text,                                -- the platform's answer, shown under the idea
  votes       int not null default 0,
  removed     boolean not null default false,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists erp_ideas_idx on public.erp_ideas(removed, status, votes desc, created_at desc);
alter table public.erp_ideas enable row level security;
revoke all on public.erp_ideas from anon, authenticated;

create table if not exists public.erp_idea_votes (
  idea_id  uuid not null references public.erp_ideas(id) on delete cascade,
  ip_hash  text not null,
  at       timestamptz not null default now(),
  primary key (idea_id, ip_hash)
);
alter table public.erp_idea_votes enable row level security;
revoke all on public.erp_idea_votes from anon, authenticated;

-- the public changelog, in plain words (announcements inside the ERPs stay in erp_news; an update may post one too)
create table if not exists public.erp_updates (
  id            uuid primary key default gen_random_uuid(),
  title         text not null,
  text          text not null,
  idea_id       uuid references public.erp_ideas(id) on delete set null,
  credit        text,                              -- "from an idea by Sumon"
  removed       boolean not null default false,
  published_at  timestamptz not null default now()
);
alter table public.erp_updates enable row level security;
revoke all on public.erp_updates from anon, authenticated;

-- trusted volunteers who check what members send; a badge and their name
create table if not exists public.erp_guides (
  id      uuid primary key default gen_random_uuid(),
  name    text not null,
  area    text,                                    -- what they check: "Print Doctor cases", "Bangla wording"
  since   date not null default current_date,
  active  boolean not null default true
);
alter table public.erp_guides enable row level security;
revoke all on public.erp_guides from anon, authenticated;
