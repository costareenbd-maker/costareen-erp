-- A save sent twice is saved once (2026-10-05). The page gives every write a one-time key; when it gave up
-- waiting and the person presses Save again with the same details, the same key comes back and the first
-- result is returned instead of selling / receiving / paying twice. Kept a few days, then removed (nightly).
create table if not exists public.erp_op_keys (
  business_id uuid not null references public.businesses(id) on delete cascade,
  op_key      text not null,
  name        text not null,
  result      jsonb,
  at          timestamptz not null default now(),
  primary key (business_id, op_key)
);
create index if not exists erp_op_keys_at_idx on public.erp_op_keys(at);
alter table public.erp_op_keys enable row level security;
drop policy if exists op_keys_member on public.erp_op_keys;
create policy op_keys_member on public.erp_op_keys for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.erp_op_keys to authenticated;
