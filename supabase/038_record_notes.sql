-- Plan D5: notes and files on any record - a product, a customer, a supplier,
-- an invoice. One table; `kind` + `ref` say what the note is about (the
-- product code, the customer's key, the supplier's name, the invoice number).
-- Nothing is deleted: a wrong note is struck out and stays readable.
create table if not exists public.record_notes (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null check (kind in ('product', 'customer', 'supplier', 'invoice')),
  ref         text not null,
  body        text not null default '',
  file        text,                 -- stored file name (folder 'notes'), when something is attached
  file_name   text,                 -- what the person called it
  file_mime   text,
  by          text,
  at          timestamptz not null default now(),
  voided      text
);
create index if not exists record_notes_idx on public.record_notes(business_id, kind, lower(ref), at desc);

alter table public.record_notes enable row level security;
drop policy if exists record_notes_read on public.record_notes;
create policy record_notes_read on public.record_notes for select
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists record_notes_insert on public.record_notes;
create policy record_notes_insert on public.record_notes for insert
  with check (business_id in (select public.my_business_ids('member')));
drop policy if exists record_notes_update on public.record_notes;
create policy record_notes_update on public.record_notes for update
  using (business_id in (select public.my_business_ids('manager')))
  with check (business_id in (select public.my_business_ids('manager')));
grant select, insert, update on public.record_notes to authenticated;
