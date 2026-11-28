-- studiojson-1 (owner 28 Nov 2026, for Oliareen's marketer): a "JSON video prompt" in the Content desk Studio. AI tools often
-- write a structured prompt (scenes, shots, voice-over lines, on-screen text, camera, style, duration); the person can
-- paste or attach one with a prompt or a feedback, or send it alone. It is kept with the work log line (msgs.spec) and
-- with the job the engine reads (jobs.spec, the planner follows it as her structured spec). Additive only: two nullable
-- columns, no new table, the existing RLS and grants cover them. Null = an ask without a JSON (every older row).
-- Type json (not jsonb) on purpose: it keeps her text as written (key order, numbers), so the log shows it as she sent it.
alter table public.content_studio_msgs add column if not exists spec json;
alter table public.content_studio_jobs add column if not exists spec json;
