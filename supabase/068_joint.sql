-- Joint stock (docs/JOINT-POOL-BLUEPRINT.md, docs/JOINT-BUILD-NOTES.md).
--
--  1. The feature is off for every business. The provider switches it on per
--     company (joint_flags: server-only, nobody reads or writes it through
--     row-level security; joint_enabled() answers yes/no).
--  2. A joint product has a floor price; staff cannot sell below it.
--  3. A customer's invoice stays the seller's own. A line that came from a
--     joint pool carries the pool (invoice_lines.pool_id); joint_sales links
--     the seller's invoice to the pool's own copy of that sale.
--  4. The pool-side rows are written by the server for staff who are not
--     members of the pool: there the seller is given, not looked up.

create table if not exists public.joint_flags (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  enabled     boolean not null default true,
  set_by      uuid,
  set_at      timestamptz not null default now()
);
alter table public.joint_flags enable row level security;   -- no policy: the server only
revoke all on public.joint_flags from authenticated, anon;

create or replace function public.joint_enabled(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.joint_flags where business_id = b and enabled);
$$;
grant execute on function public.joint_enabled(uuid) to authenticated;

alter table public.products      add column if not exists floor_price numeric(14,2) not null default 0;
alter table public.invoice_lines add column if not exists pool_id uuid references public.businesses(id);
create index if not exists invoice_lines_pool_idx on public.invoice_lines(pool_id) where pool_id is not null;

create table if not exists public.joint_sales (
  id                 uuid primary key default gen_random_uuid(),
  pool_id            uuid not null references public.businesses(id) on delete cascade,
  seller_business_id uuid not null references public.businesses(id) on delete cascade,
  seller_invoice_no  text not null,
  pool_invoice_no    text not null,
  joint_total        numeric(14,2) not null default 0,
  created_at         timestamptz not null default now(),
  unique (seller_business_id, seller_invoice_no, pool_id),
  unique (pool_id, pool_invoice_no)
);
create index if not exists joint_sales_pool_idx on public.joint_sales(pool_id, created_at);
alter table public.joint_sales enable row level security;
drop policy if exists joint_sales_read on public.joint_sales;
create policy joint_sales_read on public.joint_sales for select
  using (seller_business_id in (select public.my_business_ids('member'))
      or pool_id in (select public.my_business_ids('member')));
grant select on public.joint_sales to authenticated;       -- written by the server only

-- Who sold a pool invoice: looked up from the person,
-- except when the server writes the pool's copy of a partner company's sale
-- (it is not running as "authenticated" then, and says who the seller is).
create or replace function public.trg_invoice_sold_by()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.is_pool(new.business_id) then
    if new.sold_by is null or current_user = 'authenticated' then
      new.sold_by := public.my_partner_in(new.business_id);
    end if;
  else
    new.sold_by := null;
  end if;
  return new;
end $$;
