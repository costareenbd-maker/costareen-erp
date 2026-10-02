-- ============================================================================
-- COSTAREEN ERP - partnerships and joint stock pools
-- ----------------------------------------------------------------------------
-- Run AFTER 004_grants.sql. Idempotent.
--
-- The model
--   A JOINT POOL is an ordinary business (products, stock, invoices) with
--   is_pool = true. Two or more PARTNER businesses own it together. Each
--   partner's people are members of the pool and sell from it at their own
--   price tier (one partner wholesale, the other retail).
--
--   Partners keep their own private businesses. Linked partners may see each
--   other's private stock COUNTS (never cost, price or profit) through
--   partner_stock(), which each side can switch off for its own shop.
--
-- The money
--   pool_ledger records every taka that is not a sale or a stock purchase:
--     CAPITAL_IN / CAPITAL_OUT  - investment, drives the profit ratio
--     EXPENSE                   - a pool cost one partner paid
--     TRANSFER                  - cash handed from one partner to another
--   Sales are attributed to the partner who made them (invoices.sold_by),
--   stock purchases to the partner who paid (stock_movements.paid_by).
--
-- Profit ratio
--   Each month, a partner's share = their capital / total capital, measured
--   at the START of the month. Money added mid-month counts from next month.
--   (If nobody had capital at the start - the first month - the month-end
--   capital is used; if that is also zero, the split is equal.)
--
-- Settlement (cumulative, so earlier transfers are already accounted for)
--   held_i   = capital_i + cash collected_i - purchases paid_i
--              - expenses paid_i - transfers out_i + transfers in_i
--   due_i    = capital_i + profit share_i - ratio_i x stock at cost
--   balance_i = held_i - due_i       (> 0 pays, < 0 receives)
--   The balances always sum to zero; paying them evens everyone out.
--
-- Partner deals
--   Selling from the OTHER partner's private stock is a sale between the two
--   companies, not a pool sale. partner_deals records the agreed price as a
--   debt; the stock owner records the stock leaving in their own business.
-- ============================================================================

-- ============================================================================
-- 1. SCHEMA
-- ============================================================================

alter table public.businesses      add column if not exists is_pool boolean not null default false;
alter table public.products        add column if not exists wholesale_price numeric(14,2) not null default 0;
-- cost at the moment of sale, so later cost changes never rewrite old profit
alter table public.invoice_lines   add column if not exists unit_cost numeric(14,2);
-- pool only: which partner made the sale / paid for the stock
alter table public.invoices        add column if not exists sold_by uuid references public.businesses(id);
alter table public.stock_movements add column if not exists paid_by uuid references public.businesses(id);

do $$ begin
  create type public.price_tier as enum ('retail', 'wholesale');
exception when duplicate_object then null; end $$;

do $$ begin
  create type public.pool_entry_kind as enum ('CAPITAL_IN', 'CAPITAL_OUT', 'EXPENSE', 'TRANSFER');
exception when duplicate_object then null; end $$;

create table if not exists public.pool_partners (
  pool_id             uuid not null references public.businesses(id) on delete cascade,
  partner_business_id uuid not null references public.businesses(id) on delete cascade,
  display_name        text not null,
  price_tier          public.price_tier not null default 'retail',
  share_stock         boolean not null default true,
  joined_at           timestamptz not null default now(),
  primary key (pool_id, partner_business_id),
  check (pool_id <> partner_business_id)
);

create index if not exists pool_partners_partner_idx on public.pool_partners(partner_business_id);

create table if not exists public.pool_invites (
  code        text primary key,
  pool_id     uuid not null references public.businesses(id) on delete cascade,
  created_by  uuid references auth.users(id),
  expires_at  timestamptz not null default now() + interval '7 days',
  used_at     timestamptz,
  used_by     uuid references auth.users(id)
);

create table if not exists public.pool_ledger (
  id                  uuid primary key default gen_random_uuid(),
  pool_id             uuid not null references public.businesses(id) on delete cascade,
  kind                public.pool_entry_kind not null,
  -- who put the money in / paid the expense / handed the cash over
  partner_business_id uuid not null references public.businesses(id),
  -- TRANSFER only: who received the cash
  to_business_id      uuid references public.businesses(id),
  amount              numeric(14,2) not null check (amount > 0),
  entry_date          date not null default (now() at time zone 'Asia/Dhaka')::date,
  category            text,
  note                text,
  created_by          uuid references auth.users(id),
  created_at          timestamptz not null default now(),
  check ((kind = 'TRANSFER') = (to_business_id is not null)),
  check (to_business_id is null or to_business_id <> partner_business_id)
);

create index if not exists pool_ledger_pool_idx on public.pool_ledger(pool_id, entry_date);

-- Frozen monthly reports. Once a month is closed its numbers never change.
create table if not exists public.pool_settlements (
  pool_id    uuid not null references public.businesses(id) on delete cascade,
  month      date not null check (month = date_trunc('month', month)::date),
  report     jsonb not null,
  closed_by  uuid references auth.users(id),
  closed_at  timestamptz not null default now(),
  primary key (pool_id, month)
);

create table if not exists public.partner_deals (
  id                uuid primary key default gen_random_uuid(),
  -- the partner whose private stock was sold, and who is owed the money
  from_business_id  uuid not null references public.businesses(id) on delete cascade,
  -- the partner who sold it to their customer, and who owes
  to_business_id    uuid not null references public.businesses(id) on delete cascade,
  deal_date         date not null default (now() at time zone 'Asia/Dhaka')::date,
  description       text not null,
  qty               numeric(14,2) not null default 1 check (qty > 0),
  amount            numeric(14,2) not null check (amount > 0),
  note              text,
  created_by        uuid references auth.users(id),
  created_side      uuid not null references public.businesses(id),
  created_at        timestamptz not null default now(),
  confirmed_at      timestamptz,
  confirmed_by      uuid references auth.users(id),
  settled_at        timestamptz,
  settled_by        uuid references auth.users(id),
  check (from_business_id <> to_business_id),
  check (created_side in (from_business_id, to_business_id))
);

create index if not exists partner_deals_from_idx on public.partner_deals(from_business_id);
create index if not exists partner_deals_to_idx   on public.partner_deals(to_business_id);

-- ============================================================================
-- 2. HELPERS
-- ============================================================================

-- FIX for databases built from the original 001: is_manager / is_owner
-- returned NULL (not false) for a non-member, so "if not is_owner(x)" inside a
-- function let outsiders straight past the check. RLS was unaffected (NULL
-- denies there), but every SECURITY DEFINER function below relies on these.
create or replace function public.is_manager(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
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

-- Dhaka calendar date of a timestamp - every month boundary uses this.
create or replace function public.dhaka_date(t timestamptz)
returns date
language sql
immutable
as $$ select (t at time zone 'Asia/Dhaka')::date $$;

create or replace function public.is_pool(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select coalesce((select is_pool from public.businesses where id = b), false) $$;

-- The partner business the CURRENT user acts for inside a pool.
-- A user who belongs to two partners of the same pool is ambiguous and
-- refused, rather than silently crediting the wrong company.
create or replace function public.my_partner_in(p_pool uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  select array_agg(pp.partner_business_id) into v_ids
  from public.pool_partners pp
  join public.memberships m
    on m.business_id = pp.partner_business_id and m.user_id = auth.uid()
  where pp.pool_id = p_pool;

  if v_ids is null then
    raise exception 'Your account is not linked to any partner of this pool.';
  end if;
  if array_length(v_ids, 1) > 1 then
    raise exception 'Your account belongs to more than one partner of this pool; use a separate login per company.';
  end if;
  return v_ids[1];
end $$;

-- Two businesses are linked when they are partners in the same pool.
create or replace function public.are_partners(a uuid, b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select a <> b and exists (
    select 1 from public.pool_partners x
    join public.pool_partners y on y.pool_id = x.pool_id
    where x.partner_business_id = a and y.partner_business_id = b);
$$;

-- Last day (exclusive bound) covered by a closed settlement, or null.
create or replace function public.pool_locked_until(p_pool uuid)
returns date
language sql
stable
security definer
set search_path = public
as $$
  select (max(month) + interval '1 month')::date
  from public.pool_settlements where pool_id = p_pool;
$$;

-- Pool-aware selling price: the partner's tier decides wholesale or retail.
-- Replaces the plain version from 002_functions.sql.
create or replace function public.sale_price_for(p_business uuid, p_product uuid)
returns numeric
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_prod public.products;
  v_tier public.price_tier;
begin
  select * into v_prod from public.products
  where id = p_product and business_id = p_business;
  if not found then
    return null;
  end if;

  if public.is_pool(p_business) then
    select price_tier into v_tier from public.pool_partners
    where pool_id = p_business
      and partner_business_id = public.my_partner_in(p_business);
    if v_tier = 'wholesale' and v_prod.wholesale_price > 0 then
      return v_prod.wholesale_price;
    end if;
  end if;

  return v_prod.sell_price;
end $$;

-- ============================================================================
-- 3. TRIGGERS
-- ============================================================================

-- Stamp who sold a pool invoice. Never trusted from the client.
create or replace function public.trg_invoice_sold_by()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if public.is_pool(new.business_id) then
    new.sold_by := public.my_partner_in(new.business_id);
  else
    new.sold_by := null;
  end if;
  return new;
end $$;

drop trigger if exists invoice_sold_by on public.invoices;
create trigger invoice_sold_by
  before insert on public.invoices
  for each row execute function public.trg_invoice_sold_by();

-- A pool invoice in a closed month cannot be voided or re-attributed:
-- the settlement for that month has already been paid out.
create or replace function public.trg_invoice_pool_lock()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lock date;
begin
  if public.is_pool(old.business_id) then
    v_lock := public.pool_locked_until(old.business_id);
    if v_lock is not null and public.dhaka_date(old.created_at) < v_lock
       and (new.voided_at is distinct from old.voided_at
            or new.grand_total is distinct from old.grand_total
            or new.sold_by is distinct from old.sold_by) then
      raise exception 'Invoice % belongs to a settled month and cannot be changed.', old.invoice_no;
    end if;
  end if;
  return new;
end $$;

drop trigger if exists invoice_pool_lock on public.invoices;
create trigger invoice_pool_lock
  before update on public.invoices
  for each row execute function public.trg_invoice_pool_lock();

-- Snapshot the cost on every sold line.
create or replace function public.trg_line_unit_cost()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if new.unit_cost is null then
    select cost_price into new.unit_cost
    from public.products where id = new.product_id;
    new.unit_cost := coalesce(new.unit_cost, 0);
  end if;
  return new;
end $$;

drop trigger if exists line_unit_cost on public.invoice_lines;
create trigger line_unit_cost
  before insert on public.invoice_lines
  for each row execute function public.trg_line_unit_cost();

-- Stock bought into a pool must say which partner paid for it, or the
-- settlement cannot balance. Defaults to the partner of whoever records it;
-- pool_receive_stock() can name a different payer.
create or replace function public.trg_movement_paid_by()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
begin
  if not public.is_pool(new.business_id) then
    new.paid_by := null;
    return new;
  end if;

  if new.kind in ('RECEIVE', 'OPENING') then
    new.paid_by := coalesce(
      new.paid_by,
      nullif(current_setting('erp.paid_by', true), '')::uuid,
      public.my_partner_in(new.business_id));
    if not exists (select 1 from public.pool_partners
                   where pool_id = new.business_id
                     and partner_business_id = new.paid_by) then
      raise exception 'The payer must be a partner of this pool.';
    end if;
    -- the purchase value is what the payer is credited with
    if coalesce(new.unit_price, 0) = 0 then
      select cost_price into new.unit_price from public.products where id = new.product_id;
      new.unit_price := coalesce(new.unit_price, 0);
    end if;
    if coalesce(new.total, 0) = 0 then
      new.total := new.qty * new.unit_price;
    end if;
  else
    new.paid_by := null;
  end if;
  return new;
end $$;

drop trigger if exists movement_paid_by on public.stock_movements;
create trigger movement_paid_by
  before insert on public.stock_movements
  for each row execute function public.trg_movement_paid_by();

-- Ledger entries must name real partners and stay out of settled months.
create or replace function public.trg_pool_ledger_check()
returns trigger
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_lock date;
begin
  if tg_op <> 'INSERT' then
    v_lock := public.pool_locked_until(old.pool_id);
    if v_lock is not null and old.entry_date < v_lock then
      raise exception 'That entry belongs to a settled month and cannot be changed.';
    end if;
  end if;
  if tg_op <> 'DELETE' then
    v_lock := public.pool_locked_until(new.pool_id);
    if v_lock is not null and new.entry_date < v_lock then
      raise exception 'That month is already settled; record the entry in an open month.';
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;

  if not exists (select 1 from public.pool_partners
                 where pool_id = new.pool_id and partner_business_id = new.partner_business_id) then
    raise exception 'The paying business is not a partner of this pool.';
  end if;
  if new.to_business_id is not null and not exists (
       select 1 from public.pool_partners
       where pool_id = new.pool_id and partner_business_id = new.to_business_id) then
    raise exception 'The receiving business is not a partner of this pool.';
  end if;

  if tg_op = 'INSERT' then
    new.created_by := auth.uid();
  end if;
  return new;
end $$;

drop trigger if exists pool_ledger_check on public.pool_ledger;
create trigger pool_ledger_check
  before insert or update or delete on public.pool_ledger
  for each row execute function public.trg_pool_ledger_check();

-- ============================================================================
-- 4. ROW LEVEL SECURITY
-- ============================================================================

alter table public.pool_partners    enable row level security;
alter table public.pool_invites     enable row level security;
alter table public.pool_ledger      enable row level security;
alter table public.pool_settlements enable row level security;
alter table public.partner_deals    enable row level security;

-- pool_partners: visible to pool members and to the partner business itself.
-- Written only through the functions below.
drop policy if exists pool_partners_read on public.pool_partners;
create policy pool_partners_read on public.pool_partners
  for select using (public.is_member(pool_id) or public.is_member(partner_business_id));

-- pool_invites: owners of the pool only.
drop policy if exists pool_invites_owner on public.pool_invites;
create policy pool_invites_owner on public.pool_invites
  for select using (public.is_owner(pool_id));

-- pool_ledger: money is a manager matter. Staff of a partner see none of it.
drop policy if exists pool_ledger_read on public.pool_ledger;
create policy pool_ledger_read on public.pool_ledger
  for select using (public.is_manager(pool_id));
drop policy if exists pool_ledger_insert on public.pool_ledger;
create policy pool_ledger_insert on public.pool_ledger
  for insert with check (public.is_manager(pool_id));
drop policy if exists pool_ledger_update on public.pool_ledger;
create policy pool_ledger_update on public.pool_ledger
  for update using (public.is_manager(pool_id)) with check (public.is_manager(pool_id));
drop policy if exists pool_ledger_delete on public.pool_ledger;
create policy pool_ledger_delete on public.pool_ledger
  for delete using (public.is_manager(pool_id));

-- pool_settlements: read by managers; written only by close_pool_month().
drop policy if exists pool_settlements_read on public.pool_settlements;
create policy pool_settlements_read on public.pool_settlements
  for select using (public.is_manager(pool_id));

-- partner_deals: either side's managers can read; written through functions.
drop policy if exists partner_deals_read on public.partner_deals;
create policy partner_deals_read on public.partner_deals
  for select using (public.is_manager(from_business_id) or public.is_manager(to_business_id));

-- ============================================================================
-- 5. SETTING UP A POOL
-- ============================================================================

-- Create a joint pool owned by one of my businesses. The caller becomes an
-- owner of the pool; the other partner joins with an invite code.
create or replace function public.create_pool(
  p_name          text,
  p_my_business   uuid,
  p_display_name  text default null,
  p_tier          public.price_tier default 'retail'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_pool uuid;
begin
  if not public.is_owner(p_my_business) then
    raise exception 'Only the owner of a business can start a partnership for it.';
  end if;
  if public.is_pool(p_my_business) then
    raise exception 'A pool cannot be a partner of another pool.';
  end if;

  v_pool := public.create_business(p_name);
  update public.businesses set is_pool = true where id = v_pool;
  update public.invoice_counters set prefix = 'JV' where business_id = v_pool;

  insert into public.pool_partners (pool_id, partner_business_id, display_name, price_tier)
  values (v_pool, p_my_business,
          coalesce(nullif(btrim(p_display_name), ''),
                   (select name from public.businesses where id = p_my_business)),
          coalesce(p_tier, 'retail'));
  return v_pool;
end $$;

create or replace function public.create_pool_invite(p_pool uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code text;
begin
  if not public.is_pool(p_pool) or not public.is_owner(p_pool) then
    raise exception 'Only an owner of the pool can invite a partner.';
  end if;
  v_code := upper(substr(encode(gen_random_bytes(6), 'hex'), 1, 10));
  insert into public.pool_invites (code, pool_id, created_by)
  values (v_code, p_pool, auth.uid());
  return v_code;
end $$;

-- The other partner accepts the invite for one of THEIR businesses and
-- becomes an owner of the pool too: partners are equals.
create or replace function public.join_pool(
  p_code          text,
  p_my_business   uuid,
  p_display_name  text default null,
  p_tier          public.price_tier default 'retail'
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_inv public.pool_invites;
begin
  if not public.is_owner(p_my_business) then
    raise exception 'Only the owner of a business can join a partnership with it.';
  end if;
  if public.is_pool(p_my_business) then
    raise exception 'A pool cannot be a partner of another pool.';
  end if;

  select * into v_inv from public.pool_invites
  where code = upper(btrim(p_code)) for update;
  if not found or v_inv.used_at is not null or v_inv.expires_at < now() then
    raise exception 'This invite code is invalid, used or expired.';
  end if;
  if exists (select 1 from public.pool_partners
             where pool_id = v_inv.pool_id and partner_business_id = p_my_business) then
    raise exception 'This business is already a partner of the pool.';
  end if;

  insert into public.pool_partners (pool_id, partner_business_id, display_name, price_tier)
  values (v_inv.pool_id, p_my_business,
          coalesce(nullif(btrim(p_display_name), ''),
                   (select name from public.businesses where id = p_my_business)),
          coalesce(p_tier, 'retail'));

  insert into public.memberships (business_id, user_id, role)
  values (v_inv.pool_id, auth.uid(), 'owner')
  on conflict (business_id, user_id) do update set role = 'owner';

  update public.pool_invites set used_at = now(), used_by = auth.uid()
  where code = v_inv.code;

  return v_inv.pool_id;
end $$;

-- Pool owners set each partner's price tier.
create or replace function public.set_partner_tier(p_pool uuid, p_partner uuid, p_tier public.price_tier)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner(p_pool) then
    raise exception 'Only an owner of the pool can change price tiers.';
  end if;
  update public.pool_partners set price_tier = p_tier
  where pool_id = p_pool and partner_business_id = p_partner;
  if not found then
    raise exception 'That business is not a partner of this pool.';
  end if;
end $$;

-- Each business decides for itself whether partners may see its stock counts.
create or replace function public.set_share_stock(p_my_business uuid, p_share boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_owner(p_my_business) then
    raise exception 'Only the owner can change who sees this business''s stock.';
  end if;
  update public.pool_partners set share_stock = p_share
  where partner_business_id = p_my_business;
end $$;

-- Record stock bought into the pool, naming who paid (defaults to me).
create or replace function public.pool_receive_stock(
  p_pool      uuid,
  p_lines     jsonb,
  p_paid_by   uuid default null,
  p_supplier  text default null,
  p_reference text default null,
  p_note      text default null
)
returns int
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n int;
begin
  if not public.is_pool(p_pool) then
    raise exception 'This business is not a joint pool.';
  end if;
  perform set_config('erp.paid_by', coalesce(p_paid_by, public.my_partner_in(p_pool))::text, true);
  v_n := public.receive_stock(p_pool, p_lines, p_supplier, p_reference, p_note);
  perform set_config('erp.paid_by', '', true);
  return v_n;
end $$;

-- ============================================================================
-- 6. SEEING EACH OTHER'S STOCK
-- ============================================================================

-- Businesses linked to any business I belong to.
create or replace function public.my_partners()
returns table (
  my_business_id      uuid,
  partner_business_id uuid,
  partner_name        text,
  pool_id             uuid,
  pool_name           text,
  shares_stock        boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select distinct on (mine.partner_business_id, theirs.partner_business_id)
         mine.partner_business_id, theirs.partner_business_id, theirs.display_name,
         mine.pool_id, pool.name, theirs.share_stock
  from public.pool_partners mine
  join public.memberships m
    on m.business_id = mine.partner_business_id and m.user_id = auth.uid()
  join public.pool_partners theirs
    on theirs.pool_id = mine.pool_id
   and theirs.partner_business_id <> mine.partner_business_id
  join public.businesses pool on pool.id = mine.pool_id
  order by mine.partner_business_id, theirs.partner_business_id, mine.joined_at;
$$;

-- A partner's private stock: counts only. No cost, no price, no profit.
create or replace function public.partner_stock(p_partner uuid)
returns table (
  sku      text,
  name     text,
  category text,
  brand    text,
  color    text,
  unit     text,
  stock    numeric,
  state    text
)
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.my_partners() mp
    where mp.partner_business_id = p_partner and mp.shares_stock) then
    raise exception 'This business does not share its stock with you.';
  end if;

  return query
  select p.sku, p.name, p.category, p.brand, p.color, p.unit,
         coalesce(sum(case when m.direction = 'IN' then m.qty else -m.qty end), 0),
         case
           when coalesce(sum(case when m.direction = 'IN' then m.qty else -m.qty end), 0) <= 0 then 'out'
           when coalesce(sum(case when m.direction = 'IN' then m.qty else -m.qty end), 0) <= p.reorder_level then 'low'
           else 'ok'
         end
  from public.products p
  left join public.stock_movements m on m.product_id = p.id
  where p.business_id = p_partner and p.status = 'Active'
  group by p.id
  order by p.name;
end $$;

-- ============================================================================
-- 7. PARTNER DEALS  (selling from the other partner's PRIVATE stock)
-- ============================================================================

-- p_from = whose stock it was (owed the money), p_to = who sold it (owes).
create or replace function public.record_partner_deal(
  p_from        uuid,
  p_to          uuid,
  p_description text,
  p_amount      numeric,
  p_qty         numeric default 1,
  p_date        date default null,
  p_note        text default null
)
returns public.partner_deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_side uuid;
  v_deal public.partner_deals;
begin
  if public.is_manager(p_from) then
    v_side := p_from;
  elsif public.is_manager(p_to) then
    v_side := p_to;
  else
    raise exception 'You must be a manager of one side of the deal.';
  end if;
  if not public.are_partners(p_from, p_to) then
    raise exception 'These two businesses are not partners.';
  end if;
  if coalesce(btrim(p_description), '') = '' then
    raise exception 'Describe what was sold.';
  end if;

  insert into public.partner_deals (
    from_business_id, to_business_id, deal_date, description, qty, amount,
    note, created_by, created_side)
  values (
    p_from, p_to, coalesce(p_date, public.dhaka_date(now())), btrim(p_description),
    coalesce(p_qty, 1), p_amount, p_note, auth.uid(), v_side)
  returning * into v_deal;
  return v_deal;
end $$;

-- The side that did NOT record the deal confirms the agreed price.
create or replace function public.confirm_partner_deal(p_deal uuid)
returns public.partner_deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal  public.partner_deals;
  v_other uuid;
begin
  select * into v_deal from public.partner_deals where id = p_deal for update;
  if not found then
    raise exception 'Deal not found.';
  end if;
  v_other := case when v_deal.created_side = v_deal.from_business_id
                  then v_deal.to_business_id else v_deal.from_business_id end;
  if not public.is_manager(v_other) then
    raise exception 'Only the other company can confirm this deal.';
  end if;
  if v_deal.confirmed_at is not null then
    raise exception 'Deal already confirmed.';
  end if;

  update public.partner_deals set confirmed_at = now(), confirmed_by = auth.uid()
  where id = p_deal returning * into v_deal;
  return v_deal;
end $$;

-- Mark a confirmed deal paid. The company that is owed the money says so.
create or replace function public.settle_partner_deal(p_deal uuid)
returns public.partner_deals
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.partner_deals;
begin
  select * into v_deal from public.partner_deals where id = p_deal for update;
  if not found then
    raise exception 'Deal not found.';
  end if;
  if not public.is_manager(v_deal.from_business_id) then
    raise exception 'Only the company that is owed can mark the deal paid.';
  end if;
  if v_deal.confirmed_at is null then
    raise exception 'Confirm the deal before marking it paid.';
  end if;
  if v_deal.settled_at is not null then
    raise exception 'Deal already marked paid.';
  end if;

  update public.partner_deals set settled_at = now(), settled_by = auth.uid()
  where id = p_deal returning * into v_deal;
  return v_deal;
end $$;

-- An unconfirmed deal can be withdrawn by the side that recorded it.
create or replace function public.cancel_partner_deal(p_deal uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_deal public.partner_deals;
begin
  select * into v_deal from public.partner_deals where id = p_deal for update;
  if not found then
    raise exception 'Deal not found.';
  end if;
  if not public.is_manager(v_deal.created_side) then
    raise exception 'Only the company that recorded the deal can cancel it.';
  end if;
  if v_deal.confirmed_at is not null then
    raise exception 'A confirmed deal cannot be cancelled.';
  end if;
  delete from public.partner_deals where id = p_deal;
end $$;

-- ============================================================================
-- 8. SETTLEMENT
-- ============================================================================

-- Settlement report up to the end of p_month (default: this month).
-- Read-only; close_pool_month() freezes it.
create or replace function public.pool_settlement(p_pool uuid, p_month date default null)
returns jsonb
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_month   date := date_trunc('month', coalesce(p_month, public.dhaka_date(now())))::date;
  v_end     date := (date_trunc('month', coalesce(p_month, public.dhaka_date(now()))) + interval '1 month')::date;
  v_first   date;
  v_result  jsonb;
begin
  if not public.is_pool(p_pool) then
    raise exception 'This business is not a joint pool.';
  end if;
  if not public.is_manager(p_pool) then
    raise exception 'Only a manager or owner of the pool can see the settlement.';
  end if;

  select date_trunc('month', public.dhaka_date(created_at))::date into v_first
  from public.businesses where id = p_pool;
  v_first := least(v_first, v_month,
    coalesce((select date_trunc('month', min(entry_date))::date
              from public.pool_ledger where pool_id = p_pool), v_month),
    coalesce((select date_trunc('month', min(public.dhaka_date(created_at)))::date
              from public.invoices where business_id = p_pool), v_month),
    coalesce((select date_trunc('month', min(public.dhaka_date(created_at)))::date
              from public.stock_movements where business_id = p_pool), v_month));

  with
  partners as (
    select partner_business_id as pid, display_name, price_tier
    from public.pool_partners where pool_id = p_pool
  ),
  n as (select count(*)::numeric as cnt from partners),
  months as (
    select m::date as m, (m + interval '1 month')::date as m_end
    from generate_series(v_first, v_month, interval '1 month') g(m)
  ),
  -- capital balance per partner at a month's start and end
  cap as (
    select mo.m, p.pid,
      coalesce(sum(case when l.entry_date < mo.m
                        then case l.kind when 'CAPITAL_IN' then l.amount else -l.amount end end), 0) as at_start,
      coalesce(sum(case when l.entry_date < mo.m_end
                        then case l.kind when 'CAPITAL_IN' then l.amount else -l.amount end end), 0) as at_end
    from months mo
    cross join partners p
    left join public.pool_ledger l
      on l.pool_id = p_pool and l.partner_business_id = p.pid
     and l.kind in ('CAPITAL_IN', 'CAPITAL_OUT')
    group by mo.m, p.pid
  ),
  cap_tot as (
    select m, sum(at_start) as tot_start, sum(at_end) as tot_end from cap group by m
  ),
  ratio as (
    select c.m, c.pid,
      case when t.tot_start > 0 then c.at_start / t.tot_start
           when t.tot_end   > 0 then c.at_end   / t.tot_end
           else 1 / (select cnt from n) end as r,
      case when t.tot_start > 0 then 'month_start'
           when t.tot_end   > 0 then 'month_end'
           else 'equal' end as basis
    from cap c join cap_tot t using (m)
  ),
  inv as (
    select i.id, i.sold_by, i.grand_total,
           date_trunc('month', public.dhaka_date(i.created_at))::date as m
    from public.invoices i
    where i.business_id = p_pool and i.voided_at is null
      and public.dhaka_date(i.created_at) < v_end
  ),
  cogs as (
    select inv.m, sum(l.qty * coalesce(l.unit_cost, 0)) as amt
    from inv join public.invoice_lines l on l.invoice_id = inv.id
    group by inv.m
  ),
  mv as (
    select kind, direction, total, paid_by,
           date_trunc('month', public.dhaka_date(created_at))::date as m
    from public.stock_movements
    where business_id = p_pool and public.dhaka_date(created_at) < v_end
  ),
  led as (
    select kind, partner_business_id as pid, to_business_id as to_pid, amount,
           date_trunc('month', entry_date)::date as m
    from public.pool_ledger
    where pool_id = p_pool and entry_date < v_end
  ),
  -- profit per month, before splitting
  month_pl as (
    select mo.m,
      coalesce((select sum(grand_total) from inv where inv.m = mo.m), 0) as revenue,
      coalesce((select amt from cogs where cogs.m = mo.m), 0)            as cogs,
      coalesce((select sum(amount) from led where led.m = mo.m and kind = 'EXPENSE'), 0) as expenses,
      coalesce((select sum(case when kind = 'RETURN' then total
                                when kind = 'ADJUST' then -total else 0 end)
                from mv where mv.m = mo.m), 0) as stock_gain
    from months mo
  ),
  month_profit as (
    select m, revenue, cogs, expenses, stock_gain,
           revenue - cogs - expenses + stock_gain as profit
    from month_pl
  ),
  share as (
    select r.pid, sum(r.r * mp.profit) as profit_share
    from ratio r join month_profit mp using (m)
    group by r.pid
  ),
  stock_book as (
    select coalesce((select sum(total) from mv where kind in ('RECEIVE', 'OPENING')), 0)
         + coalesce((select sum(stock_gain) from month_profit), 0)
         - coalesce((select sum(cogs) from month_profit), 0) as value
  ),
  per as (
    select p.pid, p.display_name, p.price_tier,
      (select at_end from cap where cap.pid = p.pid and cap.m = v_month)          as capital,
      (select r from ratio where ratio.pid = p.pid and ratio.m = v_month)         as ratio,
      coalesce((select profit_share from share where share.pid = p.pid), 0)       as profit_share,
      coalesce((select sum(grand_total) from inv where sold_by = p.pid), 0)       as collected,
      coalesce((select sum(grand_total) from inv where sold_by = p.pid and inv.m = v_month), 0) as month_sales,
      coalesce((select sum(total) from mv where paid_by = p.pid
                and kind in ('RECEIVE', 'OPENING')), 0)                           as purchases,
      coalesce((select sum(amount) from led where pid = p.pid and kind = 'EXPENSE'), 0)  as expenses_paid,
      coalesce((select sum(amount) from led where pid = p.pid and kind = 'TRANSFER'), 0) as transfers_out,
      coalesce((select sum(amount) from led where to_pid = p.pid and kind = 'TRANSFER'), 0) as transfers_in
    from partners p
  ),
  bal as (
    select per.*,
      capital + collected - purchases - expenses_paid - transfers_out + transfers_in as held,
      capital + profit_share - ratio * (select value from stock_book)                as due
    from per
  )
  select jsonb_build_object(
    'pool_id', p_pool,
    'month', to_char(v_month, 'YYYY-MM'),
    'closed', exists (select 1 from public.pool_settlements
                      where pool_id = p_pool and month = v_month),
    'ratio_basis', (select basis from ratio where m = v_month limit 1),
    'this_month', (select jsonb_build_object(
        'revenue', round(revenue, 2), 'cogs', round(cogs, 2),
        'expenses', round(expenses, 2), 'stock_gain', round(stock_gain, 2),
        'profit', round(profit, 2))
      from month_profit where m = v_month),
    'to_date', jsonb_build_object(
        'revenue',  round((select sum(revenue)  from month_profit), 2),
        'cogs',     round((select sum(cogs)     from month_profit), 2),
        'expenses', round((select sum(expenses) from month_profit), 2),
        'profit',   round((select sum(profit)   from month_profit), 2),
        'capital',  round((select sum(capital)  from per), 2),
        'stock_at_cost', round((select value from stock_book), 2)),
    'months', (select jsonb_agg(jsonb_build_object(
        'month', to_char(mp.m, 'YYYY-MM'), 'profit', round(mp.profit, 2),
        'ratios', (select jsonb_object_agg(r.pid, round(r.r, 6))
                   from ratio r where r.m = mp.m))
        order by mp.m) from month_profit mp),
    'partners', (select jsonb_agg(jsonb_build_object(
        'business_id',   b.pid,
        'name',          b.display_name,
        'tier',          b.price_tier,
        'capital',       round(b.capital, 2),
        'ratio',         round(b.ratio, 6),
        'month_sales',   round(b.month_sales, 2),
        'profit_share',  round(b.profit_share, 2),
        'collected',     round(b.collected, 2),
        'purchases',     round(b.purchases, 2),
        'expenses_paid', round(b.expenses_paid, 2),
        'transfers_out', round(b.transfers_out, 2),
        'transfers_in',  round(b.transfers_in, 2),
        'held',          round(b.held, 2),
        'due',           round(b.due, 2),
        'balance',       round(b.held - b.due, 2),
        -- top-up needed to bring this partner's capital level with the largest
        'top_up_to_equal', round((select max(capital) from per) - b.capital, 2))
        order by b.display_name) from bal b),
    'balance_check', round((select sum(held - due) from bal), 2),
    'partner_deals_open', coalesce((select jsonb_agg(jsonb_build_object(
        'id', d.id, 'date', d.deal_date, 'description', d.description,
        'qty', d.qty, 'amount', d.amount,
        'owed_to', d.from_business_id, 'owed_by', d.to_business_id,
        'confirmed', d.confirmed_at is not null) order by d.deal_date)
      from public.partner_deals d
      where d.settled_at is null
        and d.from_business_id in (select pid from partners)
        and d.to_business_id   in (select pid from partners)), '[]'::jsonb)
  ) into v_result;

  -- Who pays whom: match the largest payer with the largest receiver.
  declare
    v_pay   jsonb := '[]'::jsonb;
    v_from  record;
    v_to    record;
    v_amt   numeric;
    v_bals  jsonb := '{}'::jsonb;
  begin
    select jsonb_object_agg(x->>'business_id', (x->>'balance')::numeric)
      into v_bals from jsonb_array_elements(v_result->'partners') x;
    loop
      select key, value::numeric as amt into v_from
        from jsonb_each_text(v_bals) order by value::numeric desc limit 1;
      select key, value::numeric as amt into v_to
        from jsonb_each_text(v_bals) order by value::numeric asc limit 1;
      exit when v_from.amt < 0.01 or v_to.amt > -0.01;
      v_amt := least(v_from.amt, -v_to.amt);
      v_pay := v_pay || jsonb_build_object(
        'from', v_from.key, 'to', v_to.key, 'amount', round(v_amt, 2));
      v_bals := v_bals || jsonb_build_object(v_from.key, v_from.amt - v_amt,
                                             v_to.key,   v_to.amt + v_amt);
    end loop;
    v_result := v_result || jsonb_build_object('transfers', v_pay);
  end;

  return v_result;
end $$;

-- Freeze a finished month. After this its ledger entries and invoices are
-- locked, and the report is kept exactly as it was agreed.
-- SECURITY DEFINER because pool_settlements deliberately has no insert
-- policy; every check below runs against the real caller (auth.uid()).
create or replace function public.close_pool_month(p_pool uuid, p_month date)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month  date := date_trunc('month', p_month)::date;
  v_lock   date;
  v_report jsonb;
begin
  if not public.is_pool(p_pool) or not public.is_owner(p_pool) then
    raise exception 'Only an owner of the pool can close a month.';
  end if;
  if v_month >= date_trunc('month', public.dhaka_date(now()))::date then
    raise exception 'A month can only be closed after it has ended.';
  end if;
  v_lock := public.pool_locked_until(p_pool);
  if v_lock is not null and v_month < v_lock then
    raise exception 'That month is already closed.';
  end if;

  v_report := public.pool_settlement(p_pool, v_month) || jsonb_build_object('closed', true);
  insert into public.pool_settlements (pool_id, month, report, closed_by)
  values (p_pool, v_month, v_report, auth.uid());
  return v_report;
end $$;

drop function if exists public.store_pool_settlement(uuid, date, jsonb);

-- ============================================================================
-- 9. GRANTS  (same rule as 004: RLS picks rows, grants open the table)
-- ============================================================================

grant select, insert, update, delete on all tables in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
