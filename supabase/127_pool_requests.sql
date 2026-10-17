-- 127: joint stock - one partner asks the other for goods, the other sends them (owner 18 Oct 2026: "if he needs more
-- he asks and I send to him; moving can cost money or be free when they collect"). Lives with the pool (provider's
-- database); reached by the server only (asSystem / erp.system), like the pool's other rows.

create table if not exists public.pool_requests (
  id            uuid primary key default gen_random_uuid(),
  pool_id       uuid not null references public.businesses(id) on delete cascade,
  sku           text not null,
  product_name  text,
  qty           numeric(12,2) not null check (qty > 0),
  asked_by      uuid not null,                         -- the partner company that wants the goods
  asked_name    text,                                  -- the person who asked
  holder        uuid,                                  -- the partner asked to send them
  note          text,
  status        text not null default 'asked' check (status in ('asked', 'sent', 'received', 'declined', 'cancelled')),
  sent_qty      numeric(12,2),
  sent_name     text,
  sent_at       timestamptz,
  how           text check (how in ('collected', 'delivered')),
  cost          numeric(14,2) not null default 0,     -- transport: a joint expense, credited to who paid it
  cost_paid_by  uuid,
  answer        text,
  received_name text,
  received_at   timestamptz,
  created_at    timestamptz not null default now()
);
create index if not exists pool_requests_pool_idx on public.pool_requests(pool_id, created_at desc);

alter table public.pool_requests enable row level security;
drop policy if exists pool_requests_rw on public.pool_requests;
create policy pool_requests_rw on public.pool_requests for all to authenticated
  using (pool_id in (select public.my_business_ids('member')) or public.erp_system())
  with check (pool_id in (select public.my_business_ids('member')) or public.erp_system());
grant select, insert, update on public.pool_requests to authenticated;
