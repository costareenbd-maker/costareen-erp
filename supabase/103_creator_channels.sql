-- Creator profile, per channel (handlers/creatorportal.js): one block per platform the creator ticks - name, number
-- of followers / subscribers / members, link. Kept as JSON; handle / platforms / followers / links stay as the
-- derived one-line strings the ERP and the sponsor page show.
alter table public.erp_creators add column if not exists channels text;   -- JSON: [{platform, name, count, url}]
