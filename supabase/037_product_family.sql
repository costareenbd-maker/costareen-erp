-- Plan D3 (second half): colours of one product, kept together.
-- A family is only a label shared by products. Every product keeps its own
-- code, stock, cost and history, so nothing recorded before changes, and
-- taking the label off undoes it completely.
alter table public.products add column if not exists family text;
create index if not exists products_family_idx on public.products(business_id, family) where family is not null;
