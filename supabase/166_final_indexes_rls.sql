-- 164_final_indexes_rls.sql - final pass, 10 Nov 2026 (area: server)
--
-- Safe on a live database with data, safe to run twice: only `create index if not exists` (small, targeted,
-- each on a table the server filters by exactly these columns) and a self-guarding row-security sweep.
-- No table is rewritten, no column is added, nothing is dropped.
--
-- Why these indexes (from reading every query in supabase/functions/erp):
--   erp_errors        alerts.js / watchdog.js / platform.js read "business_id = ? and at > now() - interval" and
--                     "order by at desc limit 50"; jobs.pruneLogs deletes by `at`. The table had NO index.
--   erp_ai_log        settings.js: business_id order by at desc limit 25. No index.
--   erp_speed         written by bundle.js on slow loads, pruned by `at`. No index.
--   erp_activity      core.js / jobs.pruneLogs delete by `at` (the (business_id, at) index does not serve a whole-table prune).
--   lot_draws         holding.js: business_id and at < ? order by at (had only lot_id / movement_id / product_id).
--   inbox_lead_events, chat_order_events, booking_events: read by their parent id "order by id" (timelines).
--   agent_rule_versions: inbox2.js rule_id and version < ? order by version desc.
--   kb_chunks         inbox2.js counts by doc_id (had only the tsv index).
--   inbox_comments    inbox.js finds a comment by (channel_id, comment_id) on every Meta comment event.
--   inbox_contacts    inbox.js finds a contact by (channel_id, external_id) on every message; (business_id, customer_key) for the
--                     customer link.
--   inbox_broadcast_sends: inbox2.js "s.conversation_id = v.id and s.at > ?" (who already had a broadcast).
--   invoice_fixes     pages.js: business_id and invoice_no order by fixed_at (the invoice page's "changed" list).
--   shop_offers, saved_replies, inbox_groups, crm_rules, crm_hooks, campaign_groups, campaign_messages, due_reminders,
--   engine_skill_previews: read by business_id (small today; the index keeps them small-cost when 100 businesses share one server).

create index if not exists erp_errors_biz_at_idx            on public.erp_errors (business_id, at desc);
create index if not exists erp_errors_at_idx                on public.erp_errors (at);
create index if not exists erp_ai_log_biz_at_idx            on public.erp_ai_log (business_id, at desc);
create index if not exists erp_speed_biz_at_idx             on public.erp_speed (business_id, at desc);
create index if not exists erp_activity_at_idx              on public.erp_activity (at);
create index if not exists lot_draws_biz_at_idx             on public.lot_draws (business_id, at);
create index if not exists inbox_lead_events_lead_idx       on public.inbox_lead_events (lead_id, id);
create index if not exists chat_order_events_order_idx      on public.chat_order_events (order_id, id);
create index if not exists booking_events_booking_idx       on public.booking_events (booking_id, id);
create index if not exists agent_rule_versions_rule_idx     on public.agent_rule_versions (rule_id, version desc);
create index if not exists kb_chunks_doc_idx                on public.kb_chunks (doc_id);
create index if not exists inbox_comments_channel_idx       on public.inbox_comments (channel_id, comment_id);
create index if not exists inbox_comments_biz_idx           on public.inbox_comments (business_id, created_at desc);
create index if not exists inbox_contacts_channel_ext_idx   on public.inbox_contacts (channel_id, external_id);
create index if not exists inbox_contacts_biz_key_idx       on public.inbox_contacts (business_id, customer_key);
create index if not exists inbox_broadcast_sends_conv_idx   on public.inbox_broadcast_sends (conversation_id, at);
create index if not exists invoice_fixes_biz_inv_idx        on public.invoice_fixes (business_id, invoice_no, fixed_at);
create index if not exists shop_offers_biz_idx              on public.shop_offers (business_id);
create index if not exists saved_replies_biz_idx            on public.saved_replies (business_id);
create index if not exists inbox_groups_biz_idx             on public.inbox_groups (business_id);
create index if not exists crm_rules_biz_idx                on public.crm_rules (business_id);
create index if not exists crm_hooks_biz_idx                on public.crm_hooks (business_id);
create index if not exists campaign_groups_biz_idx          on public.campaign_groups (business_id, seq);
create index if not exists campaign_messages_biz_idx        on public.campaign_messages (business_id, seq);
create index if not exists due_reminders_biz_idx            on public.due_reminders (business_id);
create index if not exists engine_skill_previews_biz_idx    on public.engine_skill_previews (business_id, at);

-- Row security sweep. Every table with a business_id column already has row level security in the migrations
-- (checked by server_check.py over 001-163). This guards against drift on a live database: a table that has
-- policies written for it but where security was switched off by hand is switched on again. A table with NO
-- policy is deliberately left alone - switching it on would hide every row from the handlers (the privileged
-- connection is its only reader by design: secrets, device locks, the provider's tables).
do $$
declare t record;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join pg_class pc on pc.relname = c.table_name
    join pg_namespace n on n.oid = pc.relnamespace and n.nspname = 'public'
    where c.table_schema = 'public' and c.column_name = 'business_id' and pc.relkind = 'r'
      and not pc.relrowsecurity
      and exists (select 1 from pg_policies p where p.schemaname = 'public' and p.tablename = c.table_name)
  loop
    execute format('alter table public.%I enable row level security', t.table_name);
    raise notice 'row level security switched on again for %', t.table_name;
  end loop;
end $$;
