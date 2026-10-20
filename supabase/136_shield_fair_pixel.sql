-- The shield made fair, risky orders asked instead of refused, and the Meta pixel kept clean (owner 20 Oct 2026:
-- "build all three"). handlers/landing.js.
--   delivery_excuses   a return or cancellation that was the shop's fault (wrong item, late, out of stock...):
--                      it never counts against the customer
--   chat_orders.meta   the browser's Meta ids for the order (fbp, fbc, user agent) and which events were sent
--                      (lead, purchase, cancel) - Purchase only when approved / delivered, never for a fake order

create table if not exists public.delivery_excuses (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  ref         text not null,                 -- an invoice number or a chat order number
  reason      text,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (business_id, ref)
);
alter table public.delivery_excuses enable row level security;
drop policy if exists delivery_excuses_rw on public.delivery_excuses;
create policy delivery_excuses_rw on public.delivery_excuses for all to authenticated
  using (business_id in (select public.my_business_ids('member'))) with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update, delete on public.delivery_excuses to authenticated;

alter table public.chat_orders add column if not exists meta jsonb;
