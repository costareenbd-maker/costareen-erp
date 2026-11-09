-- crit2-ui (10 Nov 2026): games (Print Run / Brawl under New invoice, the stick fight on every page) are OFF until
-- each person turns them on for themselves. The business setting game_who now only says who MAY turn them on.
alter table public.erp_prefs add column if not exists games boolean not null default false;
