-- ============================================================================
-- COSTAREEN ERP - customers group
-- ----------------------------------------------------------------------------
-- Run AFTER 008. Idempotent.
--
-- CUSTOMERS_DUPLICATES_BACKUP (ERP.js:2622 erpMergeCustomers): every customer
-- row removed by "Merge duplicate customers" is copied here first, with the
-- row it was merged into, so nothing is thrown away.
-- ============================================================================

create table if not exists public.customers_duplicates_backup (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  original_id   uuid,                 -- customers.id of the removed row
  merged_into   uuid,                 -- customers.id of the row that was kept
  customer_no   text,
  name          text,
  phone         text,
  email         text,
  address       text,
  type          text,
  total_orders  int,
  total_spent   numeric(14,2),
  date_added    timestamptz,
  note          text,
  last_order_at timestamptz,
  last_product  text,
  source        text,
  status        text,
  customer_key  text,
  backed_up_at  timestamptz not null default now(),
  backed_up_by  text
);
create index if not exists customers_dup_backup_biz_idx
  on public.customers_duplicates_backup(business_id, backed_up_at);

-- row level security: same rule as 007 section 12
do $$
declare t text;
begin
  foreach t in array array['customers_duplicates_backup']
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

-- grants (same as 007 section 13)
grant select, insert, update, delete on all tables in schema public to authenticated;
grant usage, select on all sequences in schema public to authenticated;
grant execute on all functions in schema public to authenticated;
revoke all on public.business_secrets from anon, authenticated;
revoke all on public.erp_device_locks from anon, authenticated;
