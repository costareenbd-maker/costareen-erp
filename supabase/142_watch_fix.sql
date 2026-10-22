-- 142 watch-2 (owner 22 Oct 2026): "how can I mark fixed without fixing? I don't want to see problems - fix them by
-- checking every night and tell me next morning what you fixed; if a fix needs my decision, wait for my approval (or let
-- me write the change)". The Watchdog's fixes are actions like the brief's moves: done by itself when they are safe
-- (retries, closing what fixed itself) or waiting for the owner's one button when they change data.
alter table public.engine_actions add column if not exists kind      text not null default 'brief';   -- brief | watch
alter table public.engine_actions add column if not exists issue_key text;                              -- the Watchdog issue it fixes
alter table public.engine_actions add column if not exists auto      boolean not null default false;    -- done by itself (no approval needed)
create index if not exists engine_actions_kind_idx on public.engine_actions (business_id, kind, status, created_at desc);

-- the daily check-up becomes a night shift (03:00 Dhaka), so the owner wakes up to the result
update public.engine_schedules set at_time = '03:00', title = 'Watchdog: night check and fixes',
  next_at = (date_trunc('day', now() at time zone 'Asia/Dhaka') + interval '1 day 3 hours') at time zone 'Asia/Dhaka'
where key = 'watchdog-daily' and at_time = '09:00';
