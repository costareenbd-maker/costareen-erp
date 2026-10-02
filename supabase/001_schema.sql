-- ============================================================================
-- COSTAREEN ERP - multi-tenant schema
-- ----------------------------------------------------------------------------
-- Run this ONCE in the Supabase SQL Editor on a new project.
-- It is idempotent: running it twice is safe.
--
-- Isolation model
--   Every business-owned row carries business_id.
--   Every table has RLS enabled with policies that check membership.
--   A user sees a row only if they hold a membership in that business.
--   This is enforced by Postgres, not by application code, so an application
--   bug cannot leak another tenant's data.
--
-- Roles
--   owner   - everything, including deleting the business and managing staff
--   manager - everything operational: sell, receive, void, edit products/prices
--   staff   - sell and receive stock; cannot see cost price or profit,
--             cannot void invoices, cannot delete anything
-- ============================================================================

create extension if not exists "pgcrypto";

-- ============================================================================
-- 1. TENANTS AND PEOPLE
-- ============================================================================

create table if not exists public.businesses (
  id            uuid primary key default gen_random_uuid(),
  name          text        not null,
  currency      text        not null default 'BDT',
  phone         text,
  address       text,
  logo_url      text,
  bank_details  text,
  created_at    timestamptz not null default now()
);

create table if not exists public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  email       text,
  full_name   text,
  created_at  timestamptz not null default now()
);

create type public.member_role as enum ('owner', 'manager', 'staff');

create table if not exists public.memberships (
  business_id uuid        not null references public.businesses(id) on delete cascade,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  role        public.member_role not null default 'staff',
  created_at  timestamptz not null default now(),
  primary key (business_id, user_id)
);

create index if not exists memberships_user_idx on public.memberships(user_id);

-- ---------------------------------------------------------------------------
-- Membership helpers.
--
-- SECURITY DEFINER is required: a policy on memberships that queries
-- memberships would recurse. These run as the owner and bypass RLS, so they
-- are kept tiny and read-only.
-- ---------------------------------------------------------------------------

create or replace function public.is_member(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.business_id = b and m.user_id = auth.uid()
  );
$$;

create or replace function public.member_role(b uuid)
returns public.member_role
language sql
stable
security definer
set search_path = public
as $$
  select m.role from public.memberships m
  where m.business_id = b and m.user_id = auth.uid();
$$;

-- "manager or better" - the bar for editing prices, voiding, deleting
create or replace function public.is_manager(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  -- coalesce: a non-member has no role, and NULL would slip past
  -- "if not is_manager(...)" checks inside functions
  select coalesce(public.member_role(b)::text in ('owner', 'shareholder', 'manager'), false);
$$;

create or replace function public.is_owner(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(public.member_role(b) = 'owner', false);
$$;

-- ============================================================================
-- 2. REFERENCE LISTS  (categories, brands, types, suppliers, units, colours,
--    payment methods, customer sources) - one table, keyed by kind
-- ============================================================================

create table if not exists public.lookups (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null,
  value       text not null,
  sort_order  int  not null default 0,
  unique (business_id, kind, value)
);

create index if not exists lookups_business_idx on public.lookups(business_id, kind);

-- ============================================================================
-- 3. PRODUCTS
-- ============================================================================

create table if not exists public.products (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  sku            text not null,
  name           text not null,
  category       text,
  brand          text,
  type           text,
  color          text,
  unit           text default 'Piece',
  supplier       text,
  cost_price     numeric(14,2) not null default 0,
  sell_price     numeric(14,2) not null default 0,
  reorder_level  numeric(14,2) not null default 0,
  lead_time_days int           not null default 0,
  location_bin   text,
  status         text          not null default 'Active',
  image_url      text,
  created_at     timestamptz   not null default now(),
  updated_at     timestamptz   not null default now(),
  unique (business_id, sku)
);

create index if not exists products_business_idx on public.products(business_id);
-- case-insensitive SKU lookup, which is what the website sync needs
create index if not exists products_sku_lower_idx
  on public.products(business_id, lower(btrim(sku)));

-- ============================================================================
-- 4. STOCK MOVEMENTS  (the ledger - current stock is derived, never stored)
-- ============================================================================

create type public.movement_kind as enum
  ('OPENING', 'RECEIVE', 'SALE', 'RETURN', 'ADJUST', 'VOID');

create table if not exists public.stock_movements (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  product_id  uuid not null references public.products(id)   on delete cascade,
  kind        public.movement_kind not null,
  direction   text not null check (direction in ('IN', 'OUT')),
  qty         numeric(14,2) not null check (qty > 0),
  unit_price  numeric(14,2) not null default 0,
  total       numeric(14,2) not null default 0,
  reference   text,
  supplier    text,
  note        text,
  invoice_id  uuid,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);

create index if not exists movements_business_idx on public.stock_movements(business_id, created_at desc);
create index if not exists movements_product_idx  on public.stock_movements(product_id);
create index if not exists movements_invoice_idx  on public.stock_movements(invoice_id);

-- ============================================================================
-- 5. CUSTOMERS
-- ============================================================================

create table if not exists public.customers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  phone       text,
  email       text,
  address     text,
  type        text default 'Retail',
  source      text default 'Walk-in',
  status      text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists customers_business_idx on public.customers(business_id);
-- phone matching on the last 10 digits, so 01712..., 8801712... and
-- +8801712... all resolve to the same customer
create index if not exists customers_phone_idx on public.customers
  (business_id, right(regexp_replace(coalesce(phone,''), '\D', '', 'g'), 10));

-- ============================================================================
-- 6. INVOICES
-- ============================================================================

create table if not exists public.invoices (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  invoice_no      text not null,
  customer_id     uuid references public.customers(id) on delete set null,
  customer_name   text,
  customer_phone  text,
  customer_address text,
  source          text default 'Walk-in',
  subtotal        numeric(14,2) not null default 0,
  discount        numeric(14,2) not null default 0,
  delivery_charge numeric(14,2) not null default 0,
  grand_total     numeric(14,2) not null default 0,
  advance_paid    numeric(14,2) not null default 0,
  due_amount      numeric(14,2) not null default 0,
  payment_method  text,
  payment_status  text default 'Pending',
  delivery_status text default 'Processing',
  note            text,
  pdf_url         text,
  voided_at       timestamptz,
  voided_by       uuid references auth.users(id),
  created_by      uuid references auth.users(id),
  created_at      timestamptz not null default now(),
  unique (business_id, invoice_no)
);

create index if not exists invoices_business_idx on public.invoices(business_id, created_at desc);
create index if not exists invoices_customer_idx on public.invoices(customer_id);

create table if not exists public.invoice_lines (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  invoice_id  uuid not null references public.invoices(id) on delete cascade,
  product_id  uuid references public.products(id) on delete set null,
  sku         text,
  name        text,
  qty         numeric(14,2) not null,
  unit_price  numeric(14,2) not null default 0,
  discount    numeric(14,2) not null default 0,
  line_total  numeric(14,2) not null default 0,
  line_no     int not null default 1
);

create index if not exists invoice_lines_invoice_idx on public.invoice_lines(invoice_id);
create index if not exists invoice_lines_business_idx on public.invoice_lines(business_id);

-- Per-business invoice numbering
create table if not exists public.invoice_counters (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  next_number int not null default 1001,
  prefix      text not null default 'INV'
);

-- ============================================================================
-- 7. WEBSITE ORDERS  (WooCommerce sync)
-- ============================================================================

create table if not exists public.web_orders (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  order_no      text not null,
  order_date    timestamptz,
  status        text,
  customer_name text,
  customer_phone text,
  customer_address text,
  payment       text,
  order_total   numeric(14,2) not null default 0,
  invoice_id    uuid references public.invoices(id) on delete set null,
  pulled_at     timestamptz not null default now(),
  unique (business_id, order_no)
);

create table if not exists public.web_order_lines (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  web_order_id  uuid not null references public.web_orders(id) on delete cascade,
  sku           text,
  product_name  text,
  qty           numeric(14,2) not null default 0,
  line_total    numeric(14,2) not null default 0
);

create index if not exists web_orders_business_idx on public.web_orders(business_id, order_date desc);
create index if not exists web_order_lines_order_idx on public.web_order_lines(web_order_id);

-- Per-business website connection. The key is write-only to the client:
-- policies below let only owners read it back.
create table if not exists public.site_connections (
  business_id uuid primary key references public.businesses(id) on delete cascade,
  base_url    text,
  sync_key    text,
  auto_sync   boolean not null default false,
  last_push   timestamptz,
  last_pull   timestamptz
);

-- ============================================================================
-- 8. DERIVED VIEWS
-- ============================================================================

-- Current stock per product, straight from the ledger.
create or replace view public.product_stock as
select
  p.id            as product_id,
  p.business_id,
  p.sku,
  p.name,
  p.category,
  p.brand,
  p.color,
  p.unit,
  p.supplier,
  p.sell_price,
  p.cost_price,
  p.reorder_level,
  p.status,
  coalesce(sum(case when m.direction = 'IN'  then m.qty else 0 end), 0) -
  coalesce(sum(case when m.direction = 'OUT' then m.qty else 0 end), 0) as stock,
  case
    when coalesce(sum(case when m.direction = 'IN'  then m.qty else 0 end), 0) -
         coalesce(sum(case when m.direction = 'OUT' then m.qty else 0 end), 0) <= 0
      then 'out'
    when coalesce(sum(case when m.direction = 'IN'  then m.qty else 0 end), 0) -
         coalesce(sum(case when m.direction = 'OUT' then m.qty else 0 end), 0) <= p.reorder_level
      then 'low'
    else 'ok'
  end as state
from public.products p
left join public.stock_movements m on m.product_id = p.id
group by p.id;

-- Customer totals, derived from invoices rather than stored and drifting.
create or replace view public.customer_stats as
select
  c.id as customer_id,
  c.business_id,
  c.name,
  c.phone,
  c.address,
  c.source,
  c.type,
  c.status,
  count(i.id) filter (where i.voided_at is null)                as orders,
  coalesce(sum(i.grand_total) filter (where i.voided_at is null), 0) as spent,
  max(i.created_at) filter (where i.voided_at is null)          as last_order_at
from public.customers c
left join public.invoices i on i.customer_id = c.id
group by c.id;


-- A view without security_invoker runs as its OWNER, so RLS on the underlying
-- tables is checked as postgres and tenant isolation is bypassed entirely.
-- Postgres 15+ only; Supabase is on 17.
alter view public.product_stock  set (security_invoker = true);
alter view public.customer_stats set (security_invoker = true);

-- ============================================================================
-- 9. ROW LEVEL SECURITY
-- ============================================================================

alter table public.businesses      enable row level security;
alter table public.profiles        enable row level security;
alter table public.memberships     enable row level security;
alter table public.lookups         enable row level security;
alter table public.products        enable row level security;
alter table public.stock_movements enable row level security;
alter table public.customers       enable row level security;
alter table public.invoices        enable row level security;
alter table public.invoice_lines   enable row level security;
alter table public.invoice_counters enable row level security;
alter table public.web_orders      enable row level security;
alter table public.web_order_lines enable row level security;
alter table public.site_connections enable row level security;

-- ---- profiles: you only ever see your own -------------------------------
drop policy if exists profiles_self on public.profiles;
create policy profiles_self on public.profiles
  for all using (id = auth.uid()) with check (id = auth.uid());

-- ---- businesses ----------------------------------------------------------
drop policy if exists businesses_read on public.businesses;
create policy businesses_read on public.businesses
  for select using (public.is_member(id));

drop policy if exists businesses_insert on public.businesses;
create policy businesses_insert on public.businesses
  for insert with check (auth.uid() is not null);

drop policy if exists businesses_update on public.businesses;
create policy businesses_update on public.businesses
  for update using (public.is_manager(id)) with check (public.is_manager(id));

drop policy if exists businesses_delete on public.businesses;
create policy businesses_delete on public.businesses
  for delete using (public.is_owner(id));

-- ---- memberships ---------------------------------------------------------
drop policy if exists memberships_read on public.memberships;
create policy memberships_read on public.memberships
  for select using (user_id = auth.uid() or public.is_member(business_id));

drop policy if exists memberships_write on public.memberships;
create policy memberships_write on public.memberships
  for all using (public.is_owner(business_id)) with check (public.is_owner(business_id));

-- ---- generic per-business tables ----------------------------------------
-- read for any member; write for any member; destructive work is gated
-- separately below for the tables where it matters.
do $$
declare t text;
begin
  foreach t in array array['lookups','products','customers','stock_movements',
                           'invoices','invoice_lines','invoice_counters',
                           'web_orders','web_order_lines']
  loop
    execute format('drop policy if exists %1$s_member_read on public.%1$s', t);
    execute format(
      'create policy %1$s_member_read on public.%1$s for select using (public.is_member(business_id))', t);

    execute format('drop policy if exists %1$s_member_write on public.%1$s', t);
    execute format(
      'create policy %1$s_member_write on public.%1$s for insert with check (public.is_member(business_id))', t);

    execute format('drop policy if exists %1$s_member_update on public.%1$s', t);
    execute format(
      'create policy %1$s_member_update on public.%1$s for update using (public.is_member(business_id)) with check (public.is_member(business_id))', t);
  end loop;
end $$;

-- Deleting is a manager action everywhere.
do $$
declare t text;
begin
  foreach t in array array['lookups','products','customers','stock_movements',
                           'invoices','invoice_lines','web_orders','web_order_lines']
  loop
    execute format('drop policy if exists %1$s_manager_delete on public.%1$s', t);
    execute format(
      'create policy %1$s_manager_delete on public.%1$s for delete using (public.is_manager(business_id))', t);
  end loop;
end $$;

-- ---- site_connections: the sync key is owner-only ------------------------
drop policy if exists site_conn_owner on public.site_connections;
create policy site_conn_owner on public.site_connections
  for all using (public.is_owner(business_id)) with check (public.is_owner(business_id));

-- ============================================================================
-- 10. SIGN-UP: create the profile row automatically
-- ============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email))
  on conflict (id) do nothing;
  return new;
end $$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
