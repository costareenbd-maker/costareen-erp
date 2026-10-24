-- 144 fix-2 (24 Oct 2026, the partner's odd-case report, batch 2 "profit and month lock"):
--   M12 reopening a closed month keeps what was closed (profit, shares, who, when) and why it was reopened
--   M13 voiding an invoice keeps a full copy of it (head, lines, stock movements) - nothing leaves the books unrecorded
create table if not exists public.capital_reopens (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  month        text not null,
  net_profit   numeric(14,2),
  shares       jsonb,
  closed_at    timestamptz,
  closed_by    text,
  reopened_at  timestamptz not null default now(),
  reopened_by  text,
  reason       text not null,
  paid_out     numeric(14,2) not null default 0     -- profit / returns already paid for that month when it was reopened
);
create index if not exists capital_reopens_biz on public.capital_reopens (business_id, month);

create table if not exists public.voided_invoices (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  invoice_no   text not null,
  voided_at    timestamptz not null default now(),
  voided_by    text,
  reason       text,
  invoice      jsonb not null,
  lines        jsonb not null default '[]'::jsonb,
  movements    jsonb not null default '[]'::jsonb
);
create index if not exists voided_invoices_biz on public.voided_invoices (business_id, invoice_no);

do $$
declare t text;
begin
  foreach t in array array['capital_reopens', 'voided_invoices']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''owner''))) with check (business_id in (select public.my_business_ids(''owner'')))', t || '_rw', t);
    execute format('grant select, insert on public.%I to authenticated', t);
  end loop;
end $$;
