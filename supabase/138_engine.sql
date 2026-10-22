-- 138 engine-1 (owner 22 Oct 2026): "The ERP is a screen where I see the output and give inputs; the engine must be
-- stronger" (docs/ENGINE-PLAN.md). The ERP keeps the Engine's job queue, its skills and how much each skill is used;
-- the Engine (a runner on the office VPS) takes the jobs, does the work and writes the result back here.

-- every task for the Engine: from the owner (Command Center), a schedule or an event
create table if not exists public.engine_jobs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  agent        text not null default 'command',     -- which specialist (handlers/engine.js AGENTS)
  title        text not null default '',
  ask          text not null default '',             -- the owner's words / the task
  source       text not null default 'owner',        -- owner | schedule | event
  status       text not null default 'queued',       -- queued | running | done | failed | cancelled
  brain        text,                                 -- e.g. claude:opus
  result       text,                                 -- the answer (plain text / markdown)
  proposals    jsonb not null default '[]'::jsonb,   -- writes waiting for the owner's Yes [{id, tool, args, summary, warnings, state}]
  steps        jsonb not null default '[]'::jsonb,   -- what it did (short lines: searched, read, used a skill)
  skills       text[] not null default '{}',         -- slugs of the skills it used
  error        text,
  tokens       integer not null default 0,
  ms           integer not null default 0,
  attempts     integer not null default 0,
  rating       smallint,                             -- the owner's thumbs: 1 up, -1 down
  created_by   text,
  created_at   timestamptz not null default now(),
  started_at   timestamptz,
  finished_at  timestamptz
);
create index if not exists engine_jobs_biz_idx on public.engine_jobs (business_id, created_at desc);
create index if not exists engine_jobs_queue_idx on public.engine_jobs (status, created_at) where status in ('queued', 'running');

-- installed skills (the open SKILL.md format: instructions + examples + files)
create table if not exists public.engine_skills (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  slug         text not null,
  name         text not null,
  description  text not null default '',
  summary      text not null default '',             -- the Engine's plain-words review before install
  source       text not null default 'library',      -- library | github
  source_url   text,
  repo         text,                                 -- owner/name
  path         text,                                 -- folder of the skill inside the repo
  ref          text,                                 -- commit the files came from
  update_ref   text,                                 -- a newer commit seen on GitHub (update available)
  files        jsonb not null default '{}'::jsonb,   -- {relative path: text}
  has_code     boolean not null default false,
  risk         text not null default 'low',          -- low | medium | high
  risk_note    text not null default '',
  agents       text[] not null default '{}',
  why          text not null default '',             -- why these agents
  enabled      boolean not null default true,
  installed_by text,
  installed_at timestamptz not null default now(),
  checked_at   timestamptz,
  unique (business_id, slug)
);

-- one row each time a job used a skill
create table if not exists public.engine_skill_use (
  id           bigserial primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  skill_slug   text not null,
  job_id       uuid references public.engine_jobs(id) on delete cascade,
  agent        text,
  ok           boolean,
  rating       smallint,
  at           timestamptz not null default now()
);
create index if not exists engine_skill_use_idx on public.engine_skill_use (business_id, skill_slug, at desc);

-- what was read from a pasted GitHub link, kept until it is installed (the install uses this copy, not the browser's)
create table if not exists public.engine_skill_previews (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  url          text not null,
  data         jsonb not null,
  at           timestamptz not null default now()
);

-- the Engine says it is alive
create table if not exists public.engine_runners (
  business_id  uuid not null references public.businesses(id) on delete cascade,
  runner       text not null,
  seen_at      timestamptz not null default now(),
  info         jsonb not null default '{}'::jsonb,
  primary key (business_id, runner)
);

do $$ declare t text; begin
  foreach t in array array['engine_jobs', 'engine_skills', 'engine_skill_use', 'engine_skill_previews', 'engine_runners'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''manager''))) with check (business_id in (select public.my_business_ids(''manager'')))', t || '_rw', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
-- uninstalling a skill and clearing an old preview are real deletes (not books)
grant delete on public.engine_skills, public.engine_skill_previews to authenticated;
grant usage, select on sequence public.engine_skill_use_id_seq to authenticated;
