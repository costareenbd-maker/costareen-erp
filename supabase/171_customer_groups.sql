-- cgroup-1 (owner 10 Nov 2026): one WhatsApp group per customer (the customer + MD + manager's number + the AI
-- salesperson's number), made by the manager's number a few a day; orders, invoices, delivery news and the review card
-- go there. Modelled on a supplier's customer group the owner uses ("Nazir Vai (Korea)").
create table if not exists public.customer_groups (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  phone           text not null,                   -- 8801XXXXXXXXX
  name            text not null default '',
  gender          text,
  source          text not null default '',        -- 'whatsapp chat' / 'invoice'
  status          text not null default 'queued' check (status in ('queued', 'made', 'invited', 'failed', 'skipped')),
  group_jid       text,
  subject         text,
  conversation_id uuid references public.inbox_conversations(id) on delete set null,
  error           text,
  queued_at       timestamptz not null default now(),
  made_at         timestamptz
);
create unique index if not exists customer_groups_phone_idx on public.customer_groups (business_id, phone);
create index if not exists customer_groups_status_idx on public.customer_groups (business_id, status, queued_at);
create index if not exists customer_groups_jid_idx on public.customer_groups (group_jid);

do $$
begin
  execute 'alter table public.customer_groups enable row level security';
  execute 'drop policy if exists customer_groups_rw on public.customer_groups';
  execute 'create policy customer_groups_rw on public.customer_groups for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))';
  execute 'grant select, insert, update on public.customer_groups to authenticated';
end $$;
