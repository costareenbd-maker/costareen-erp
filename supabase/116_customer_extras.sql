-- 116: customer extras (FilaDash merge, Customers): follow-ups and removing a customer's personal data on request.
--
-- customer_followups: "call Karim on the 20th about the A1 he asked for" - a date, a note, done with what came of it.
-- customer_erasures: a customer asked for their personal data to be removed. Their name, phone, address and e-mail are
-- taken out everywhere they appear (invoices, payments, parcels, campaigns, repairs, print jobs, pre-orders, warranty
-- records, points...) and replaced by "Removed customer N"; the amounts stay, so the books do not change. This row keeps
-- only when, who did it, why and how many rows changed - never the removed details.

create table if not exists public.customer_followups (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_key  text not null,
  customer      text not null,
  phone         text,
  due_on        date not null,
  note          text not null,
  status        text not null default 'open' check (status in ('open', 'done')),
  outcome       text,
  by            text,
  at            timestamptz not null default now(),
  done_by       text,
  done_at       timestamptz
);
create index if not exists customer_followups_idx on public.customer_followups (business_id, status, due_on);
alter table public.customer_followups enable row level security;
drop policy if exists customer_followups_rw on public.customer_followups;
create policy customer_followups_rw on public.customer_followups for all to authenticated
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.customer_followups to authenticated;

create table if not exists public.customer_erasures (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  label         text not null,
  reason        text not null,
  rows_changed  int not null,
  tables        jsonb not null default '{}'::jsonb,
  by            text,
  at            timestamptz not null default now()
);
alter table public.customer_erasures enable row level security;
drop policy if exists customer_erasures_owner on public.customer_erasures;
create policy customer_erasures_owner on public.customer_erasures for all to authenticated
  using (business_id in (select public.my_business_ids('owner')))
  with check (business_id in (select public.my_business_ids('owner')));
grant select, insert on public.customer_erasures to authenticated;

-- The removal itself, in one place: it runs with the rights to change every table (payments and others are not
-- editable by people), but only for an OWNER of that business. It changes only base tables that exist; a column
-- that cannot be empty gets ''. Returns { table: rows changed }.
create or replace function public.erase_customer(p_biz uuid, p_key text, p_digits text, p_label text, p_newkey text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  t record; v_set text; v_where text; v_n int; v_out jsonb := '{}'::jsonb;
  function_cols text[]; v_nos text[];
begin
  if not (p_biz in (select public.my_business_ids('owner'))) then
    raise exception 'Only the owner removes a customer''s personal data.';
  end if;
  -- the invoices that are theirs, found before anything changes: their payments and returns carry the name too
  select coalesce(array_agg(invoice_no), '{}') into v_nos from public.invoices
   where business_id = p_biz and (customer_key = p_key
     or (p_digits <> '' and right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) = p_digits));
  update public.payments set customer = p_label where business_id = p_biz and invoice_no = any(v_nos);
  get diagnostics v_n = row_count;
  if v_n > 0 then v_out := v_out || jsonb_build_object('payments (of their invoices)', v_n); end if;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'returns' and column_name = 'customer') then
    update public.returns set customer = p_label where business_id = p_biz and invoice_no = any(v_nos);
    get diagnostics v_n = row_count;
    if v_n > 0 then v_out := v_out || jsonb_build_object('returns', v_n); end if;
  end if;
  for t in select * from (values
      ('customers', 'name', 'phone', 'email', 'address', 'note', 'customer_key'),
      ('invoices', 'customer_name', 'customer_phone', null, 'customer_address', null, 'customer_key'),
      ('payments', 'customer', null, null, null, null, 'customer_key'),
      ('web_orders', 'customer_name', 'customer_phone', null, 'customer_address', null, null),
      ('courier_log', 'customer', 'phone', null, 'address', null, null),
      ('campaign_sends', 'customer', 'phone', null, null, null, 'customer_key'),
      ('campaign_optouts', 'customer', 'phone', null, null, null, 'customer_key'),
      ('campaign_leads', 'name', 'phone', null, null, null, null),
      ('due_reminders', 'customer', 'phone', null, null, null, 'customer_key'),
      ('reminder_log', null, null, null, null, null, 'customer_key'),
      ('customer_points', null, null, null, null, null, 'customer_key'),
      ('customer_consent', null, null, null, null, null, 'customer_key'),
      ('erp_customer_links', null, null, null, null, null, 'customer_key'),
      ('erp_passports', null, null, null, null, null, 'customer_key'),
      ('serials', 'customer', null, null, null, null, 'customer_key'),
      ('service_jobs', 'customer', 'phone', null, null, null, 'customer_key'),
      ('print_jobs', 'customer', 'phone', null, null, null, 'customer_key'),
      ('print_requests', null, 'phone', 'email', null, null, null),
      ('preorders', 'customer', 'phone', null, null, null, 'customer_key'),
      ('restock_orders', 'customer_name', 'phone', null, 'address', null, null),
      ('customer_followups', 'customer', 'phone', null, null, null, 'customer_key')
    ) as x(tbl, c_name, c_phone, c_email, c_addr, c_note, c_key)
  loop
    if not exists (select 1 from information_schema.tables where table_schema = 'public' and table_name = t.tbl and table_type = 'BASE TABLE') then continue; end if;
    select array_agg(column_name::text) into function_cols from information_schema.columns where table_schema = 'public' and table_name = t.tbl;
    v_set := ''; v_where := '';
    if t.c_name is not null and t.c_name = any(function_cols) then v_set := v_set || format(', %I = %L', t.c_name, p_label); end if;
    if t.c_phone is not null and t.c_phone = any(function_cols) then
      v_set := v_set || format(', %I = %s', t.c_phone, case when (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = t.tbl and column_name = t.c_phone) = 'YES' then 'null' else '''''' end);
      if p_digits <> '' then v_where := v_where || format(' or right(regexp_replace(coalesce(%I::text, ''''), ''[^0-9]'', '''', ''g''), 10) = %L', t.c_phone, p_digits); end if;
    end if;
    if t.c_email is not null and t.c_email = any(function_cols) then v_set := v_set || format(', %I = null', t.c_email); end if;
    if t.c_addr is not null and t.c_addr = any(function_cols) then
      v_set := v_set || format(', %I = %s', t.c_addr, case when (select is_nullable from information_schema.columns where table_schema = 'public' and table_name = t.tbl and column_name = t.c_addr) = 'YES' then 'null' else '''''' end);
    end if;
    if t.c_note is not null and t.c_note = any(function_cols) then v_set := v_set || format(', %I = null', t.c_note); end if;
    if t.c_key is not null and t.c_key = any(function_cols) then
      v_set := v_set || format(', %I = %L', t.c_key, p_newkey);
      v_where := v_where || format(' or %I = %L', t.c_key, p_key);
    end if;
    if v_set = '' or v_where = '' then continue; end if;
    execute format('update public.%I set %s where business_id = %L and (%s)', t.tbl, substr(v_set, 3), p_biz, substr(v_where, 5));
    get diagnostics v_n = row_count;
    if v_n > 0 then v_out := v_out || jsonb_build_object(t.tbl, v_n); end if;
  end loop;
  -- the account tag in payment notes carries the old key (the phone's digits)
  update public.payments set note = replace(note, '[acct:' || p_key || ']', '[acct:' || p_newkey || ']')
   where business_id = p_biz and note like '%[acct:' || p_key || ']%';
  get diagnostics v_n = row_count;
  if v_n > 0 then v_out := v_out || jsonb_build_object('payments (notes)', v_n); end if;
  return v_out;
end $$;
grant execute on function public.erase_customer(uuid, text, text, text, text) to authenticated;
