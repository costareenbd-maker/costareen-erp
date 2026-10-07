-- Joint stock: where the goods physically are. Each movement in a pool says whose shelf it touched (held_by = the
-- partner business). Received at A, sold by B (moved to B first), moved A -> B: the held counts per partner come from
-- summing IN minus OUT per (product, held_by). Ownership and profit stay by money (paid_by); this is only "whose shelf".
-- a new kind of movement: goods handed from one partner's shelf to the other's (an OUT and an IN, same note)
alter type public.movement_kind add value if not exists 'MOVE';
alter table public.stock_movements add column if not exists held_by uuid references public.businesses(id);
create index if not exists stock_movements_held_idx on public.stock_movements (business_id, product_id, held_by);
-- what is there already: receipts were on the payer's shelf, sales left the seller's shelf, returns came back to it
update public.stock_movements m set held_by = m.paid_by
  where m.held_by is null and m.paid_by is not null and m.kind = 'RECEIVE'
    and exists (select 1 from public.businesses b where b.id = m.business_id and b.is_pool);
update public.stock_movements m set held_by = i.sold_by
  from public.invoices i
  where m.held_by is null and m.invoice_id = i.id and i.sold_by is not null
    and exists (select 1 from public.businesses b where b.id = m.business_id and b.is_pool);
