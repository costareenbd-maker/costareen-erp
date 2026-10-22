-- 140 brain-1 (owner 22 Oct 2026): "this ERP will hold other, different businesses and later public users - how will
-- the AI keep them apart and know each business?" Each business gets its own Business Brain: a profile in blocks
-- (what it sells, to whom, where, prices, competitors, goals, voice, limits, never-do rules) drafted by the Engine from
-- the business's own data and website, confirmed by the owner question by question, versioned; and its own memory of
-- lasting facts (a changed fact is marked out of date, never deleted, and keeps its source).
-- Patterns borrowed (research 22 Oct 2026): Letta memory blocks (label / limit / locked), Graphiti's dated facts,
-- the OpenAI cookbook's "store only stated, lasting facts" rule, Anthropic's memory-tool commands - all in Postgres.

create table if not exists public.engine_brain (
  business_id  uuid primary key references public.businesses(id) on delete cascade,
  status       text not null default 'empty',          -- empty | drafting | draft | approved
  version      integer not null default 0,              -- +1 at every approval
  blocks       jsonb not null default '{}'::jsonb,       -- {label: {value, source, confidence, draft, updated}}
  draft_job    uuid,
  approved_at  timestamptz,
  approved_by  text,
  updated_at   timestamptz not null default now()
);

create table if not exists public.engine_brain_versions (
  id           bigserial primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  version      integer not null,
  blocks       jsonb not null,
  approved_by  text,
  at           timestamptz not null default now()
);
create index if not exists engine_brain_versions_idx on public.engine_brain_versions (business_id, version desc);

create table if not exists public.engine_facts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  kind          text not null default 'fact',            -- fact (what is true) | event (what happened) | lesson (what works)
  text          text not null,
  keywords      text[] not null default '{}',
  source        text not null default 'engine',          -- engine | owner | rating
  source_ref    text,                                    -- job id, screen, ...
  confidence    real not null default 0.8,
  valid_from    timestamptz not null default now(),
  invalid_at    timestamptz,                             -- out of date (kept, never deleted)
  invalid_why   text,
  superseded_by uuid,
  job_id        uuid
);
create index if not exists engine_facts_live_idx on public.engine_facts (business_id, valid_from desc) where invalid_at is null;

do $$ declare t text; begin
  foreach t in array array['engine_brain', 'engine_brain_versions', 'engine_facts'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''owner''))) with check (business_id in (select public.my_business_ids(''owner'')))', t || '_rw', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.engine_brain_versions_id_seq to authenticated;
