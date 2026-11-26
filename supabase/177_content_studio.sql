-- studio-1 (owner 26 Nov 2026): the Content desk "Studio" tab. A person (Oliareen's marketer first) types one prompt and
-- gets a video from the business's own video engine; feedback makes the next version without losing anything.
-- Lanes: every person's rules are their own (content_studio_rules.user_id); the owner's engine rules and lessons are
-- never written from here. The PC studio reads the queue over the server connection and uploads into content_videos.
--   content_studio_projects  one video idea per row, its versions are jobs; state working | saved | draft
--   content_studio_jobs      the queue: new | revise | improve; queued -> running -> done | failed
--   content_studio_msgs      the work log: every prompt, every feedback, every version (never deleted)
--   content_studio_rules     the person's own rules, words and style (kind rule | term | style), remembered for the next video
create table if not exists public.content_studio_projects (
  id            bigserial primary key,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  user_id       uuid not null,
  title         text not null default '',
  state         text not null default 'working' check (state in ('working', 'saved', 'draft')),
  base_video_id bigint,                              -- started from a desk video ("make one like this")
  video_id      bigint,                              -- the newest version's video
  version       int not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists content_studio_projects_user_idx on public.content_studio_projects (business_id, user_id, updated_at desc);

create table if not exists public.content_studio_jobs (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  project_id  bigint not null references public.content_studio_projects(id) on delete cascade,
  user_id     uuid not null,
  kind        text not null check (kind in ('new', 'revise', 'improve')),
  prompt      text not null default '',
  state       text not null default 'queued' check (state in ('queued', 'running', 'done', 'failed', 'cancelled')),
  version     int,
  video_id    bigint,
  note        text,                                 -- what the engine did ("only scene 1 changed"), or why it failed
  dropped     jsonb not null default '[]'::jsonb,   -- asks the owner's locked rules did not allow
  worker      text,
  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz,
  notified_at timestamptz,
  seen_at     timestamptz                           -- the person opened the finished version (the bell stops)
);
create index if not exists content_studio_jobs_q_idx on public.content_studio_jobs (state, created_at);
create index if not exists content_studio_jobs_p_idx on public.content_studio_jobs (project_id, id);

create table if not exists public.content_studio_msgs (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  project_id  bigint not null references public.content_studio_projects(id) on delete cascade,
  user_id     uuid,                                 -- null = the engine
  body        text not null default '',
  version     int,
  job_id      bigint,
  created_at  timestamptz not null default now()
);
create index if not exists content_studio_msgs_p_idx on public.content_studio_msgs (project_id, id);

create table if not exists public.content_studio_rules (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid not null,
  kind        text not null default 'rule' check (kind in ('rule', 'term', 'style')),
  body        text not null,
  source      text not null default '',             -- "নিজে লিখেছেন" or the video it came from
  project_id  bigint,
  msg_id      bigint,
  used        int not null default 0,
  active      boolean not null default true,
  created_at  timestamptz not null default now(),
  removed_at  timestamptz
);
create index if not exists content_studio_rules_u_idx on public.content_studio_rules (business_id, user_id, active);

-- a studio version is a content_videos row too, but stays out of the desk's video list until the person presses
-- "ড্রাফটে দিন" (hidden = false then)
alter table public.content_videos add column if not exists studio_project bigint;
alter table public.content_videos add column if not exists hidden boolean not null default false;

do $$
declare t text;
begin
  foreach t in array array['content_studio_projects', 'content_studio_jobs', 'content_studio_msgs', 'content_studio_rules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (business_id in (select public.my_business_ids(''member'')))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (business_id in (select public.my_business_ids(''manager'')))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (business_id in (select public.my_business_ids(''manager''))) with check (business_id in (select public.my_business_ids(''manager'')))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant usage, select on sequence public.%I to authenticated', t || '_id_seq');
  end loop;
end $$;
