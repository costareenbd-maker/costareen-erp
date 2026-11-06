-- 159 night-stock (renumbered from 158 at integrate: night-books took 158) (6 Nov 2026, owner decision D19 "yes - one lead list (campaign leads + Leads page)").
--
-- Before: two lead lists. Campaigns > Contacts > Leads wrote campaign_leads (a phone list a WhatsApp campaign can
-- message); the Leads page lists inbox_leads (137). Neither saw the other.
-- After: inbox_leads is the one list. Every campaign lead also has an inbox_leads row (source 'campaign',
-- source_ref 'campaign:<lead_key>'), and the campaign audience reads customer leads with a phone from inbox_leads too
-- (handlers/campaigns.js leadMap). Additive only: campaign_leads keeps every old row (the campaign sender, STOP replies
-- and old sends still read it); it just gains a link column. Idempotent.

alter table public.campaign_leads add column if not exists inbox_lead_id uuid;

-- 1. a campaign lead whose number is already a customer lead on the Leads page links to that row (never added twice)
update public.campaign_leads cl
   set inbox_lead_id = il.id
  from public.inbox_leads il
 where cl.inbox_lead_id is null
   and il.business_id = cl.business_id
   and il.kind = 'customer'
   and length(regexp_replace(coalesce(il.phone, ''), '\D', '', 'g')) >= 10
   and right(regexp_replace(coalesce(il.phone, ''), '\D', '', 'g'), 10) = right(regexp_replace(coalesce(cl.phone, ''), '\D', '', 'g'), 10);

-- 2. the rest get their own row on the Leads page (the newest campaign row of a key wins, as the campaign list reads)
insert into public.inbox_leads (business_id, kind, name, phone, note, source, stage, source_ref, added_by, created_at, updated_at)
select distinct on (cl.business_id, cl.lead_key)
       cl.business_id, 'customer', nullif(cl.name, ''), cl.phone,
       nullif(concat_ws(' · ', nullif(cl.source, ''), nullif(cl.note, '')), ''),
       'campaign', 1, 'campaign:' || cl.lead_key, cl.by, cl.added_at, cl.added_at
  from public.campaign_leads cl
 where cl.inbox_lead_id is null
   and coalesce(cl.lead_key, '') <> ''
 order by cl.business_id, cl.lead_key, cl.seq desc
on conflict (business_id, source_ref) where source_ref is not null do nothing;

update public.campaign_leads cl
   set inbox_lead_id = il.id
  from public.inbox_leads il
 where cl.inbox_lead_id is null
   and il.business_id = cl.business_id
   and il.source_ref = 'campaign:' || cl.lead_key;

create index if not exists campaign_leads_inbox_idx on public.campaign_leads (inbox_lead_id) where inbox_lead_id is not null;

-- review fix: no blanket grant here - it would hand authenticated back the server-only tables earlier migrations
-- revoked (business_secrets, erp_access_keys, ...). Nothing new needs one: campaign_leads and inbox_leads have theirs.
