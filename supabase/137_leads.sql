-- 137 leads-1 (owner 22 Oct 2026: "a Leads menu - leads of customers AND suppliers from Google, LinkedIn, Facebook comments
-- and every possible source"). The Inbox's leads (120: inbox_leads, stages new..lost, history in inbox_lead_events) become
-- the one list: a lead is now a customer lead or a supplier lead, with where it came from and how to reach it.
alter table public.inbox_leads add column if not exists kind        text not null default 'customer';
alter table public.inbox_leads add column if not exists company     text;
alter table public.inbox_leads add column if not exists website     text;
alter table public.inbox_leads add column if not exists link        text;          -- the profile / post / listing it was found on
alter table public.inbox_leads add column if not exists city        text;
alter table public.inbox_leads add column if not exists country     text;
alter table public.inbox_leads add column if not exists tags        text[];
alter table public.inbox_leads add column if not exists source_ref  text;          -- 'comment:<id>', 'osm:node/1', 'landing:<id>' ... never added twice
alter table public.inbox_leads add column if not exists customer_id uuid;
alter table public.inbox_leads add column if not exists supplier_id uuid;
alter table public.inbox_leads add column if not exists added_by    text;

do $$ begin
  alter table public.inbox_leads add constraint inbox_leads_kind_chk check (kind in ('customer', 'supplier'));
exception when duplicate_object then null; end $$;

create unique index if not exists inbox_leads_ref_uq on public.inbox_leads (business_id, source_ref) where source_ref is not null;
create index if not exists inbox_leads_kind_idx on public.inbox_leads (business_id, kind, stage);
