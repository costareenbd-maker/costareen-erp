-- studiosteps-1 (owner 28 Nov 2026, for Oliareen's marketer): the Content desk Studio, step by step. He wants to be asked at
-- every step instead of getting a finished video at once:
--   1 idea (text + pictures / video / link / JSON)  ->  2 pictures (4 made, he ticks / remakes / changes one with a note)
--   3 scene cards (picture + seconds + spoken line + on-screen text; he ticks, edits, asks the AI, reorders, adds)
--   4 video (made from the ticked cards; feedback = the next version; back to the cards any time).
-- The one-shot prompt -> video path stays as it is (mode 'video'). Additive only: older rows are mode 'video'.
--   content_studio_projects.mode / step / idea / advice   the step a project is on and the AI's advice line per step
--   content_studio_jobs: kinds 'pics' (make / remake pictures), 'cards' (write the cards or change one), 'render' (the video
--     from the cards); detail = what this job should do; wait_until = do not start before (the day's picture cap, a
--     ChatGPT usage limit)
--   content_studio_pics    every picture ever made for a project (a remade one stays, state 'replaced'); never deleted
--   content_studio_cards   the scene cards (a rewritten set keeps the old cards, state 'replaced'; removed = 'removed')
alter table public.content_studio_projects add column if not exists mode text not null default 'video';
alter table public.content_studio_projects add column if not exists step smallint not null default 0;
alter table public.content_studio_projects add column if not exists idea text;
alter table public.content_studio_projects add column if not exists advice jsonb not null default '{}'::jsonb;
do $$ begin
  alter table public.content_studio_projects add constraint content_studio_projects_mode_check check (mode in ('video', 'steps'));
exception when duplicate_object then null; end $$;

alter table public.content_studio_jobs drop constraint if exists content_studio_jobs_kind_check;
alter table public.content_studio_jobs add constraint content_studio_jobs_kind_check check (kind in ('new', 'revise', 'improve', 'pics', 'cards', 'render'));
alter table public.content_studio_jobs add column if not exists detail jsonb not null default '{}'::jsonb;
alter table public.content_studio_jobs add column if not exists wait_until timestamptz;

create table if not exists public.content_studio_pics (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  project_id  bigint not null references public.content_studio_projects(id) on delete cascade,
  user_id     uuid not null,
  job_id      bigint,                                 -- the job that makes (made) it
  slot        int not null,                           -- the number he sees (1, 2, 3 ...); a remake keeps the slot
  state       text not null default 'making' check (state in ('waiting', 'making', 'ready', 'failed', 'replaced')),
  approved    boolean not null default false,         -- his tick
  ask         text not null default '',               -- 'new' | 'again' | his change note ("আলো একটু উষ্ণ")
  prompt      text not null default '',               -- the picture prompt the AI wrote (English)
  what        text not null default '',               -- what it shows, short Bangla (for the cards and the log)
  file_path   text,                                   -- content/studio-pics/<uuid>.jpg in the business's file store
  error       text,
  replaced_by bigint,
  created_at  timestamptz not null default now(),
  made_at     timestamptz
);
create index if not exists content_studio_pics_p_idx on public.content_studio_pics (project_id, slot, id);
create index if not exists content_studio_pics_day_idx on public.content_studio_pics (business_id, made_at);
create index if not exists content_studio_pics_j_idx on public.content_studio_pics (job_id);

create table if not exists public.content_studio_cards (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  project_id  bigint not null references public.content_studio_projects(id) on delete cascade,
  user_id     uuid not null,
  job_id      bigint,                                 -- the job that wrote it (null = he added it)
  pos         int not null default 0,                 -- order in the video
  pic_id      bigint,                                 -- the picture shown
  seconds     numeric(4,1) not null default 5,
  line        text not null default '',               -- what is said (voice-over)
  onscreen    text not null default '',               -- what is written on screen
  liked       boolean not null default false,         -- his "✓ ঠিক"
  state       text not null default 'active' check (state in ('active', 'making', 'replaced', 'removed')),
  edited_by   text not null default 'ai' check (edited_by in ('ai', 'him')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists content_studio_cards_p_idx on public.content_studio_cards (project_id, state, pos);

do $$
declare t text;
begin
  foreach t in array array['content_studio_pics', 'content_studio_cards'] loop
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
