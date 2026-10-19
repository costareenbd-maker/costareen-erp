-- 128: the Inbox's Day review (owner 19 Oct 2026: "that night when checking everything I can go to that page and see
-- today person X had this issue which we solved by doing this" - one short AI summary per customer per day, so the
-- owner never has to open the full conversation). A summary is made once and kept; it is made again only when the
-- conversation has more messages than it had when the summary was written.

create table if not exists public.inbox_digests (
  id              bigint generated always as identity primary key,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  day             date not null,
  summary         text not null,
  msgs            int not null default 0,              -- messages the chat had that day when this was written
  made_at         timestamptz not null default now(),
  unique (conversation_id, day)
);
create index if not exists inbox_digests_day_idx on public.inbox_digests(business_id, day desc);

alter table public.inbox_digests enable row level security;
drop policy if exists inbox_digests_rw on public.inbox_digests;
create policy inbox_digests_rw on public.inbox_digests for all to authenticated
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.inbox_digests to authenticated;
