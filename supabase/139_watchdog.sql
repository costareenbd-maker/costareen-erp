-- 139 watch-1 (owner 22 Oct 2026, Engine step 2): the Watchdog - "an agent who looks for issues all over the business:
-- the website and the ERP" (docs/ENGINE-PLAN.md). The Engine checks the pages every 5 minutes, the ERP checks itself,
-- every problem is an issue (opened once, seen again, closed by itself when it is fixed); urgent ones reach the bell and
-- the owner's WhatsApp. Timed jobs (engine_schedules) let any agent work on a schedule (the Watchdog's daily review first).

create table if not exists public.engine_issues (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  key          text not null,                         -- 'web:<target>:down', 'timer:nightly:backup', 'ai:<slug>' ... one row per problem
  area         text not null default 'erp',           -- website | erp | money | stock | channels | engine | other
  severity     text not null default 'medium',        -- urgent | high | medium | low
  title        text not null,
  detail       text not null default '',
  proof        text not null default '',
  fix          text not null default '',
  source       text not null default 'check',         -- check | ai | owner
  status       text not null default 'open',          -- open | resolved | ignored
  first_seen   timestamptz not null default now(),
  last_seen    timestamptz not null default now(),
  seen_count   integer not null default 1,
  resolved_at  timestamptz,
  ignored_until timestamptz,
  job_id       uuid,
  unique (business_id, key)
);
create index if not exists engine_issues_open_idx on public.engine_issues (business_id, status, severity);

-- the pages the Watchdog opens every 5 minutes
create table if not exists public.engine_watch_targets (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  label        text not null default '',
  url          text not null,
  must         text not null default '',               -- text the page must contain (e.g. "Add to cart")
  enabled      boolean not null default true,
  last_at      timestamptz,
  last_status  integer,
  last_ms      integer,
  last_ok      boolean,
  last_error   text,
  ssl_days     integer,
  created_at   timestamptz not null default now(),
  unique (business_id, url)
);

-- timed jobs: an agent's task that becomes an Engine job on its schedule (Dhaka time)
create table if not exists public.engine_schedules (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  agent        text not null default 'command',
  title        text not null,
  ask          text not null,
  every        text not null default 'daily',          -- hourly | daily | weekly
  at_time      text not null default '09:00',          -- HH:MM Dhaka (daily / weekly)
  weekday      smallint not null default 0,            -- 0 Sunday .. 6 Saturday (weekly)
  enabled      boolean not null default true,
  next_at      timestamptz,
  last_job     uuid,
  last_run     timestamptz,
  key          text,                                   -- a built-in schedule ('watchdog-daily'), made once
  created_by   text,
  created_at   timestamptz not null default now()
);
create unique index if not exists engine_schedules_key_uq on public.engine_schedules (business_id, key) where key is not null;
create index if not exists engine_schedules_due_idx on public.engine_schedules (business_id, enabled, next_at);

do $$ declare t text; begin
  foreach t in array array['engine_issues', 'engine_watch_targets', 'engine_schedules'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''manager''))) with check (business_id in (select public.my_business_ids(''manager'')))', t || '_rw', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
-- a watched page or a timed job taken off the list is gone (not books)
grant delete on public.engine_watch_targets, public.engine_schedules to authenticated;
