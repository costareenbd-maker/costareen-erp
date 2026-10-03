-- The sheet ERP's timers, on the live project. deploy.py fills in
-- __FN_URL__ (…/functions/v1/erp) and __CRON_KEY__ (same as the function's
-- CRON_KEY secret). Times are UTC: 21:00 UTC = 03:00 Dhaka.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.unschedule(jobname) from cron.job where jobname like 'erp-%';

select cron.schedule('erp-nightly', '0 21 * * *', $$
  select net.http_post(url := '__FN_URL__',
    headers := '{"Content-Type":"application/json","x-erp-cron":"__CRON_KEY__"}'::jsonb,
    body := '{"job":"nightly"}'::jsonb, timeout_milliseconds := 600000) $$);

select cron.schedule('erp-campaigns', '*/10 * * * *', $$
  select net.http_post(url := '__FN_URL__',
    headers := '{"Content-Type":"application/json","x-erp-cron":"__CRON_KEY__"}'::jsonb,
    body := '{"job":"campaigns"}'::jsonb, timeout_milliseconds := 150000) $$);

select cron.schedule('erp-websync', '*/15 * * * *', $$
  select net.http_post(url := '__FN_URL__',
    headers := '{"Content-Type":"application/json","x-erp-cron":"__CRON_KEY__"}'::jsonb,
    body := '{"job":"websync"}'::jsonb, timeout_milliseconds := 150000) $$);

select cron.schedule('erp-alerts', '*/10 * * * *', $$
  select net.http_post(url := '__FN_URL__',
    headers := '{"Content-Type":"application/json","x-erp-cron":"__CRON_KEY__"}'::jsonb,
    body := '{"job":"alerts"}'::jsonb, timeout_milliseconds := 60000) $$);

select cron.schedule('erp-deliveries', '7 * * * *', $$
  select net.http_post(url := '__FN_URL__',
    headers := '{"Content-Type":"application/json","x-erp-cron":"__CRON_KEY__"}'::jsonb,
    body := '{"job":"deliveries"}'::jsonb, timeout_milliseconds := 150000) $$);

select cron.schedule('erp-drive', '*/10 * * * *', $$
  select net.http_post(url := '__FN_URL__',
    headers := '{"Content-Type":"application/json","x-erp-cron":"__CRON_KEY__"}'::jsonb,
    body := '{"job":"drive"}'::jsonb, timeout_milliseconds := 150000) $$);

select cron.schedule('erp-sheet', '5-59/10 * * * *', $$
  select net.http_post(url := '__FN_URL__',
    headers := '{"Content-Type":"application/json","x-erp-cron":"__CRON_KEY__"}'::jsonb,
    body := '{"job":"sheet"}'::jsonb, timeout_milliseconds := 150000) $$);

select cron.schedule('erp-heartbeat', '23 * * * *', $$
  select net.http_post(url := '__FN_URL__',
    headers := '{"Content-Type":"application/json","x-erp-cron":"__CRON_KEY__"}'::jsonb,
    body := '{"job":"heartbeat"}'::jsonb, timeout_milliseconds := 60000) $$);
