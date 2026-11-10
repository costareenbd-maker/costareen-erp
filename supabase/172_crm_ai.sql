-- crmai-1 (owner 11 Nov 2026): "we have the AI now, it reads every chat on WhatsApp and both Facebook pages - it should
-- keep the customer tools up to date itself." The AI reads each chat once it has gone quiet and writes what it learned:
-- the lead and its follow-up date, the customer's own fields, their company, and it checks the possible duplicates.
-- This column is how far it has read each chat (the id of the last message it saw).
alter table public.inbox_conversations add column if not exists crm_ai_msg bigint;
