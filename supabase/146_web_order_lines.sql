-- 146 fix-4 (24 Oct 2026, the partner's odd-case report, batch 4 "website orders"):
--   H17 a website line is known by the website's own line id (two lines of one SKU are two lines)
--   H21/M19/M20 an order that changed on the website after it was entered says so (and what changed)
alter table public.web_order_lines add column if not exists ext_line_id text;
alter table public.web_orders add column if not exists changed_after_entry boolean not null default false;
alter table public.web_orders add column if not exists change_note text;
