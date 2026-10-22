-- 141 brief-1 (owner 22 Oct 2026, Engine step 3b): the daily brief at 8 PM - "everything based on the business, the actions
-- strategic and massive for growth, done by AI automatically with approval, and the approval by a button".
-- A brief = the day's scoreboard (computed by the ERP, not the AI), what changed and why, risks, opportunities, five big
-- moves (and on Saturdays the week's big bet). Every move is an action with its cited figures, the expected gain in taka,
-- cost and risk, and a ready payload; Approve runs it through the ERP's own functions; the result is measured after its
-- window and becomes a lesson in the Business Brain. (Pattern borrowed: specialist analysts propose, one ranker picks -
-- virattt/ai-hedge-fund; "every figure from a tool" - the faithfulness idea of deepeval / ragas.)

create table if not exists public.engine_briefs (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  day          date not null,
  job_id       uuid,
  scoreboard   jsonb not null default '{}'::jsonb,      -- the ERP's own figures at the time of the brief
  headline     text not null default '',
  changes      jsonb not null default '[]'::jsonb,      -- [{text, figures}]
  risks        jsonb not null default '[]'::jsonb,
  opportunities jsonb not null default '[]'::jsonb,
  results_note text not null default '',                -- what yesterday's approved moves brought
  created_at   timestamptz not null default now(),
  read_at      timestamptz,
  unique (business_id, day)
);

create table if not exists public.engine_actions (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  brief_id     uuid references public.engine_briefs(id) on delete cascade,
  job_id       uuid,
  no           smallint not null default 1,
  big_bet      boolean not null default false,
  type         text not null,                           -- ad | post | reorder | price | followup | whatsapp | lead_message | task
  title        text not null,
  why          text not null default '',
  figures      jsonb not null default '[]'::jsonb,       -- [{label, value, source}] every figure the card relies on
  impact_bdt   numeric not null default 0,
  cost_bdt     numeric not null default 0,
  risk         text not null default 'low',
  confidence   real not null default 0.5,
  payload      jsonb not null default '{}'::jsonb,       -- what Approve runs
  metric       jsonb not null default '{}'::jsonb,       -- {kind: sales_sku | dues | none, sku, days}
  status       text not null default 'proposed',         -- proposed | approved | running | done | failed | rejected | changing | replaced
  decided_by   text,
  decided_at   timestamptz,
  note         text,                                     -- the owner's "change it" words or "no" reason
  result       text,
  executed_at  timestamptz,
  outcome      jsonb,                                    -- {baseline, observed, verdict, measured_at}
  created_at   timestamptz not null default now()
);
create index if not exists engine_actions_biz_idx on public.engine_actions (business_id, created_at desc);
create index if not exists engine_actions_measure_idx on public.engine_actions (business_id, status, executed_at) where outcome is null;

do $$ declare t text; begin
  foreach t in array array['engine_briefs', 'engine_actions'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''owner''))) with check (business_id in (select public.my_business_ids(''owner'')))', t || '_rw', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
