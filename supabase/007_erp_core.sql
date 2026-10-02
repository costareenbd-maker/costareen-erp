-- ============================================================================
-- COSTAREEN ERP - every tab of the sheet ERP, as tables
-- ----------------------------------------------------------------------------
-- Run AFTER 006_roles.sql (separately). Idempotent.
--
-- One table per sheet tab the ERP reads or writes (docs/spec/04 part C).
-- Column names follow the sheet's header names so the handler code in
-- supabase/functions/erp reads like the original ERP.js it re-implements.
-- Where 001 already had the table (products, stock_movements, customers,
-- invoices, invoice_lines, web_orders, lookups) it is extended, not replaced.
--
-- Access: every row carries business_id and RLS checks membership, exactly as
-- in 001. Finer rules (who may record a payment, who may see cost) live in the
-- Edge Function's ERP_ALLOW table and scrub step, which is where the original
-- kept them too - the browser never queries these tables directly.
-- ============================================================================

-- ============================================================================
-- 1. ROLES
-- ============================================================================

-- sales 1 < manager 2 < shareholder 3 < owner 4 (ERP.js:3971). staff = sales.
create or replace function public.role_rank(r public.member_role)
returns int
language sql
immutable
as $$
  select case r
    when 'owner'       then 4
    when 'shareholder' then 3
    when 'manager'     then 2
    when 'sales'       then 1
    when 'staff'       then 1
    else 0 end;
$$;

create or replace function public.my_rank(b uuid)
returns int
language sql
stable
security definer
set search_path = public
as $$ select coalesce(public.role_rank(public.member_role(b)), 0) $$;

-- "manager or better" now includes shareholders.
create or replace function public.is_manager(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.my_rank(b) >= 2 $$;

create or replace function public.is_shareholder(b uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$ select public.my_rank(b) >= 3 $$;

-- ============================================================================
-- 2. EXTEND THE 001 TABLES TO CARRY EVERY SHEET COLUMN
-- ============================================================================

-- PRODUCT_MASTER
alter table public.products add column if not exists notes        text;
alter table public.products add column if not exists date_added   timestamptz not null default now();
alter table public.products add column if not exists image_link   text;
alter table public.products add column if not exists supplier_sku text;
alter table public.products add column if not exists barcode      text;

-- TXN_LOG
alter table public.stock_movements add column if not exists txn_no   text;
alter table public.stock_movements add column if not exists operator text;
alter table public.stock_movements add column if not exists product_name text;

-- CUSTOMERS (total_orders / total_spent are the sheet's stored figures; the
-- ERP recomputes from sales and only falls back to these, ERP.js:1405)
alter table public.customers add column if not exists customer_no   text;
alter table public.customers add column if not exists total_orders  int     not null default 0;
alter table public.customers add column if not exists total_spent   numeric(14,2) not null default 0;
alter table public.customers add column if not exists last_order_at timestamptz;
alter table public.customers add column if not exists last_product  text;
alter table public.customers add column if not exists customer_key  text;
create index if not exists customers_key_idx on public.customers(business_id, customer_key);

-- SALES_LOG, invoice level. `source` (001) carries the sheet's
-- customer_source column, which the ERP uses as the DELIVERY METHOD.
alter table public.invoices add column if not exists item_discount    numeric(14,2) not null default 0;
alter table public.invoices add column if not exists invoice_discount numeric(14,2) not null default 0;
alter table public.invoices add column if not exists customer_key     text;
alter table public.invoices add column if not exists web_order_no     text;
alter table public.invoices add column if not exists cancelled_at     timestamptz;
-- legacy split invoices (ORD-<ms>, one id per line, ERP.js:5508) are grouped
-- under the first id of their group; NULL for normal invoices
alter table public.invoices add column if not exists legacy_group     text;
alter table public.invoices add column if not exists pdf_path         text;
alter table public.invoices add column if not exists pdf_designed     boolean not null default false;
create index if not exists invoices_key_idx on public.invoices(business_id, customer_key);
create index if not exists invoices_web_idx on public.invoices(business_id, web_order_no);

-- WEB_ORDERS
alter table public.web_orders add column if not exists entered      boolean not null default false;
alter table public.web_orders add column if not exists manager_note text;
alter table public.web_order_lines add column if not exists status  text;

-- ============================================================================
-- 3. PER-BUSINESS CONFIG AND SECRETS  (SETTINGS I:J, script properties)
-- ============================================================================

create table if not exists public.business_config (
  business_id uuid not null references public.businesses(id) on delete cascade,
  key         text not null,
  value       text,
  updated_at  timestamptz not null default now(),
  primary key (business_id, key)
);

-- Courier keys, website sync key, WhatsApp server key, render key.
-- RLS on, NO policies, no grants: only the Edge Function's privileged
-- connection reads these. Never selected into a browser response.
create table if not exists public.business_secrets (
  business_id uuid not null references public.businesses(id) on delete cascade,
  key         text not null,
  value       text not null,
  updated_at  timestamptz not null default now(),
  primary key (business_id, key)
);

-- ============================================================================
-- 4. MONEY  (PAYMENTS, RETURNS, INVOICE_FIXES, DUE_REMINDERS)
-- ============================================================================

-- PAYMENTS: append-only ledger. amount + is money in, - is money out.
-- invoice_no NULL = a customer-account row (advance), tagged [acct:KEY].
create table if not exists public.payments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  payment_no   text not null,
  invoice_no   text,
  customer     text,
  customer_key text,
  paid_at      timestamptz not null default now(),
  amount       numeric(14,2) not null,
  method       text,
  note         text,
  recorded_by  text,
  created_at   timestamptz not null default now()
);
create index if not exists payments_inv_idx on public.payments(business_id, invoice_no);
create index if not exists payments_key_idx on public.payments(business_id, customer_key);

-- RETURNS: one row per returned line, grouped by return_no (RTN-yyMMddHHmmss)
create table if not exists public.returns (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  return_no    text not null,
  returned_at  timestamptz not null default now(),
  invoice_no   text not null,
  sku          text,
  product      text,
  qty          numeric(14,2) not null default 0,
  condition    text,                 -- good | damaged
  value        numeric(14,2) not null default 0,
  money        text,                 -- "due reduced" | "refunded N" | "advance N"
  customer     text,
  reason       text,
  recorded_by  text
);
create index if not exists returns_inv_idx on public.returns(business_id, invoice_no);

create table if not exists public.invoice_fixes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  fixed_at    timestamptz not null default now(),
  invoice_no  text not null,
  field       text,
  was         text,
  now         text,
  fixed_by    text
);

create table if not exists public.due_reminders (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  reminded_at  timestamptz not null default now(),
  customer_key text,
  customer     text,
  phone        text,
  due          numeric(14,2),
  reminded_by  text
);

-- ============================================================================
-- 5. COURIER  (COURIER_LOG, COURIER_PAYOUTS, _LINES, COURIER_RECON)
-- ============================================================================

create table if not exists public.courier_log (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  booked_at      timestamptz not null default now(),
  invoice_no     text not null,
  consignment_id text,
  customer       text,
  phone          text,
  address        text,
  cod_amount     numeric(14,2),
  invoice_total  numeric(14,2),
  booked_by      text,
  note           text                -- "[by hand]" marks a set-aside
);
create index if not exists courier_log_inv_idx on public.courier_log(business_id, invoice_no);

create table if not exists public.courier_payouts (
  id               uuid primary key default gen_random_uuid(),
  business_id      uuid not null references public.businesses(id) on delete cascade,
  payout_id        text not null,
  created_src      text,
  paid_at          text,
  cod_collected    numeric(14,2),
  delivery_charges numeric(14,2),
  cod_fee          numeric(14,2),
  paid_to_bank     numeric(14,2),
  parcels          int,
  synced_at        timestamptz not null default now(),
  fields_seen      text,
  unique (business_id, payout_id)
);

create table if not exists public.courier_payout_lines (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  payout_id       text not null,
  consignment_id  text,
  tracking_code   text,
  cod_amount      numeric(14,2),
  status          text,
  recipient_name  text,
  recipient_phone text,
  parcel_created  text,
  invoice_no      text,
  match           text,              -- exact | phone | ''
  delivery_charge numeric(14,2),
  cod_charge      numeric(14,2)
);
create index if not exists payout_lines_idx on public.courier_payout_lines(business_id, payout_id);

create table if not exists public.courier_recon (
  id             uuid primary key default gen_random_uuid(),
  business_id    uuid not null references public.businesses(id) on delete cascade,
  consignment_id text not null,
  payout_id      text,
  invoice_no     text,
  customer       text,
  expected       numeric(14,2),
  collected      numeric(14,2),
  gap            numeric(14,2),
  action         text,               -- ok|writeoff|review|kept|extra|settled
  amount         numeric(14,2),
  note           text,
  at             timestamptz not null default now(),
  by             text
);
create index if not exists courier_recon_cid_idx on public.courier_recon(business_id, consignment_id);

-- ============================================================================
-- 6. PRICE BOOK  (COST_PRICES; rate/handling/min margin go in business_config
--    as cost_rate / cost_handling / cost_min_margin)
-- ============================================================================

create table if not exists public.cost_book (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  sort_order   int not null default 0,     -- the sheet's row order
  category     text not null default '',
  brand        text not null default '',
  type         text not null default '',
  buy_rmb      numeric(14,4),
  buy_bdt      numeric(14,2),
  handling     numeric(14,2),              -- NULL = follow the default
  products     int not null default 0,
  typical_sell numeric(14,2) not null default 0,
  updated_at   timestamptz,
  note         text
);
create index if not exists cost_book_key_idx
  on public.cost_book(business_id, lower(category), lower(brand), lower(type));

-- ============================================================================
-- 7. SUPPLIER ORDERS  (PURCHASE_ORDERS, PO_SHIPMENTS, PO_DIFFS)
-- ============================================================================

create table if not exists public.po_lines (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  po_no       text not null,
  ordered_at  timestamptz not null default now(),
  sku         text not null,
  product     text,
  qty         numeric(14,2) not null default 0,
  received    numeric(14,2) not null default 0,
  ship_by     text,
  note        text,
  status      text not null default 'open',   -- open | arrived | closed: <why>
  ordered_by  text,
  closed_at   timestamptz,
  rmb_unit    numeric(14,4),
  rmb_rate    numeric(14,4),
  supplier    text
);
create index if not exists po_lines_po_idx on public.po_lines(business_id, po_no);

create table if not exists public.po_shipments (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  po_no        text not null,
  shipment_no  text,
  agent        text,
  ship_by      text,
  weight_kg    numeric(14,2),
  shipping_bdt numeric(14,2),
  arrived_on   date,
  lines        int,
  units        numeric(14,2),
  received_by  text,
  recorded_at  timestamptz not null default now()
);

create table if not exists public.po_diffs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  diff_no     text not null,
  po_no       text,
  supplier    text,
  sku         text,
  product     text,
  kind        text,               -- extra | wrong | short
  qty         numeric(14,2),
  rmb_unit    numeric(14,4),
  rmb_value   numeric(14,2),
  unit_bdt    numeric(14,2),
  status      text not null default 'open',  -- open|i_owe|free|returned|supplier_owes
  created_at  timestamptz not null default now(),
  decided_at  timestamptz,
  decided_by  text,
  settled_at  timestamptz,
  note        text
);

-- ============================================================================
-- 8. EXPENSES  (EXPENSES, EXPENSE_ITEMS). Months are 'yyyy-MM' text.
-- ============================================================================

create table if not exists public.expense_items (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  item_no     text not null,
  kind        text not null,      -- fixed | recurring
  name        text not null,
  category    text,
  amount      numeric(14,2),
  from_month  text,
  to_month    text,
  note        text,
  set_by      text
);

create table if not exists public.expenses (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  expense_no  text not null,
  recorded_at timestamptz not null default now(),
  month       text not null,
  kind        text not null,      -- fixed | recurring | oneoff
  category    text,
  description text,
  amount      numeric(14,2) not null,
  item_no     text,
  recorded_by text,
  voided      text                -- reason text; NULL = live
);
create index if not exists expenses_month_idx on public.expenses(business_id, month);

-- ============================================================================
-- 9. QUOTATIONS  (QUOTATIONS, QUOTE_SETTINGS, QUOTE_ITEMS)
-- ============================================================================

create table if not exists public.quotations (
  id          text not null,              -- the quote's own uuid (client-made)
  business_id uuid not null references public.businesses(id) on delete cascade,
  reference   text,
  version     int not null default 0,
  status      text,
  title       text,
  customer    text,
  kind        text,
  total       numeric(16,2),
  currency    text,
  issue_date  date,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  created_by  text,
  updated_by  text,
  save_key    text,
  doc         jsonb not null,
  primary key (business_id, id)
);

create table if not exists public.quote_settings (
  business_id uuid not null references public.businesses(id) on delete cascade,
  key         text not null,   -- profile | settings | letterhead | snippets | assets | seq:<PREFIX>
  value       jsonb,
  primary key (business_id, key)
);

create table if not exists public.quote_items (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  key             text not null,
  name            text,
  description     text,
  kind            text,
  unit            text,
  historical_rate numeric(14,2),
  product_sku     text,
  requires_review text,
  source          text,
  added_at        timestamptz not null default now(),
  added_by        text
);

-- ============================================================================
-- 10. CAMPAIGNS  (WhatsApp)
-- ============================================================================

create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  campaign_no text not null,             -- CMP-yyMMdd-HHmmss
  created_at  timestamptz not null default now(),
  created_by  text,
  name        text,
  message     text,
  recipients  int,
  -- spread state that lived in the ERP_CMP_STATE script property
  spread      jsonb
);

create table if not exists public.campaign_sends (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  campaign_no  text not null,
  customer_key text not null,
  customer     text,
  phone        text,
  status       text not null default 'waiting',   -- waiting|sent|skipped|failed
  updated_at   timestamptz not null default now(),
  by           text
);
create index if not exists campaign_sends_idx on public.campaign_sends(business_id, campaign_no);

create table if not exists public.campaign_optouts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_key  text not null,
  customer      text,
  phone         text,
  opted_out_at  timestamptz not null default now(),
  reason        text,
  by            text
);

create table if not exists public.campaign_messages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  message_no  text not null,
  name        text,
  text        text,
  attach      text,
  updated_at  timestamptz not null default now(),
  by          text
);

create table if not exists public.campaign_groups (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  group_no    text not null,
  name        text,
  filter      jsonb,
  updated_at  timestamptz not null default now(),
  by          text
);

create table if not exists public.campaign_leads (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_key    text not null,
  name        text,
  phone       text,
  source      text,
  note        text,
  added_at    timestamptz not null default now(),
  by          text
);

-- ============================================================================
-- 11. PEOPLE, DEVICES, AI KEYS, LOGS
-- ============================================================================

-- ERP_USERS. One row per person; their role in each business is a
-- membership. user_id is an auth.users row with no password, so RLS can
-- name them as the subject of a transaction.
create table if not exists public.erp_people (
  user_id       uuid primary key references auth.users(id) on delete cascade,
  home_business uuid not null references public.businesses(id) on delete cascade,
  person_no     text,                 -- U+yyMMddHHmmss
  name          text not null,
  phone         text,
  code          text unique,          -- 6 digits; NULL once revoked
  status        text not null default 'active',   -- active | revoked
  last_used     timestamptz,
  created_at    timestamptz not null default now(),
  failed        int not null default 0,
  locked_until  timestamptz,
  note          text
);

-- ERP_DEVICES
create table if not exists public.erp_devices (
  id           uuid primary key default gen_random_uuid(),
  device_id    text not null,
  user_id      uuid not null references public.erp_people(user_id) on delete cascade,
  label        text,
  status       text not null default 'pending',  -- pending|approved|denied|revoked
  requested_at timestamptz not null default now(),
  decided_at   timestamptz,
  last_used    timestamptz,
  note         text,
  unique (device_id, user_id)
);

-- erpbad_<device> / erplock_<device>: wrong-code counting per device
create table if not exists public.erp_device_locks (
  device_id    text primary key,
  failed       int not null default 0,
  locked_until timestamptz
);

-- ERP_AI_KEYS (script property) and ERP_AI_LOG
create table if not exists public.erp_ai_keys (
  id          text primary key,          -- k + 12 hex
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  role        public.member_role not null,
  hash        text not null,             -- sha-256 of the key; the key is never stored
  enabled     boolean not null default true,
  created_at  timestamptz not null default now(),
  last_used   timestamptz
);

create table if not exists public.erp_ai_log (
  id          bigint generated always as identity primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  at          timestamptz not null default now(),
  key_name    text,
  role        text,
  action      text,
  result      text,
  detail      text
);

-- ERP_ERRORS and ERP_SPEED
create table if not exists public.erp_errors (
  id          bigint generated always as identity primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  at          timestamptz not null default now(),
  who         text,
  role        text,
  action      text,
  message     text,
  build       text
);

create table if not exists public.erp_speed (
  id          bigint generated always as identity primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  at          timestamptz not null default now(),
  who         text,
  parts       text,
  total_ms    int,
  took        jsonb,
  build       text
);

-- Per-person preferences that the sheet kept in (shared!) user properties.
create table if not exists public.erp_prefs (
  user_id         uuid primary key references auth.users(id) on delete cascade,
  theme           text not null default 'dark',
  active_business uuid references public.businesses(id) on delete set null
);

-- ============================================================================
-- 12. ROW LEVEL SECURITY
-- ============================================================================

do $$
declare t text;
begin
  foreach t in array array[
    'business_config','payments','returns','invoice_fixes','due_reminders',
    'courier_log','courier_payouts','courier_payout_lines','courier_recon',
    'cost_book','po_lines','po_shipments','po_diffs','expense_items','expenses',
    'quotations','quote_settings','quote_items',
    'campaigns','campaign_sends','campaign_optouts','campaign_messages',
    'campaign_groups','campaign_leads','erp_errors','erp_speed','erp_ai_log']
  loop
    execute format('alter table public.%I enable row level security', t);

    execute format('drop policy if exists %1$s_member_read on public.%1$s', t);
    execute format('create policy %1$s_member_read on public.%1$s for select using (public.is_member(business_id))', t);

    execute format('drop policy if exists %1$s_member_insert on public.%1$s', t);
    execute format('create policy %1$s_member_insert on public.%1$s for insert with check (public.is_member(business_id))', t);

    execute format('drop policy if exists %1$s_member_update on public.%1$s', t);
    execute format('create policy %1$s_member_update on public.%1$s for update using (public.is_member(business_id)) with check (public.is_member(business_id))', t);

    execute format('drop policy if exists %1$s_manager_delete on public.%1$s', t);
    execute format('create policy %1$s_manager_delete on public.%1$s for delete using (public.is_manager(business_id))', t);
  end loop;
end $$;

-- Secrets and device locks: no policy at all. Only the privileged connection.
alter table public.business_secrets enable row level security;
alter table public.erp_device_locks enable row level security;
revoke all on public.business_secrets from anon, authenticated;
revoke all on public.erp_device_locks from anon, authenticated;

-- AI keys: owner of the business only (the hash is still not the key).
alter table public.erp_ai_keys enable row level security;
drop policy if exists erp_ai_keys_owner on public.erp_ai_keys;
create policy erp_ai_keys_owner on public.erp_ai_keys
  for all using (public.is_owner(business_id)) with check (public.is_owner(business_id));

-- People: yourself, or a shareholder+ of the business that added you.
alter table public.erp_people enable row level security;
drop policy if exists erp_people_read on public.erp_people;
create policy erp_people_read on public.erp_people
  for select using (user_id = auth.uid() or public.is_shareholder(home_business));
drop policy if exists erp_people_write on public.erp_people;
create policy erp_people_write on public.erp_people
  for all using (public.is_shareholder(home_business))
  with check (public.is_shareholder(home_business));

alter table public.erp_devices enable row level security;
drop policy if exists erp_devices_read on public.erp_devices;
create policy erp_devices_read on public.erp_devices
  for select using (exists (select 1 from public.erp_people p
                            where p.user_id = erp_devices.user_id
                              and (p.user_id = auth.uid() or public.is_shareholder(p.home_business))));
drop policy if exists erp_devices_write on public.erp_devices;
create policy erp_devices_write on public.erp_devices
  for all using (exists (select 1 from public.erp_people p
                         where p.user_id = erp_devices.user_id and public.is_shareholder(p.home_business)))
  with check (exists (select 1 from public.erp_people p
                      where p.user_id = erp_devices.user_id and public.is_shareholder(p.home_business)));

alter table public.erp_prefs enable row level security;
drop policy if exists erp_prefs_self on public.erp_prefs;
create policy erp_prefs_self on public.erp_prefs
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ============================================================================
-- 13. GRANTS (same rule as 004) - then take the secrets back out
-- ============================================================================

grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on public.business_secrets from anon, authenticated;
revoke all on public.erp_device_locks from anon, authenticated;
