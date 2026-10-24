-- 145 fix-3 (24 Oct 2026, the partner's odd-case report, batch 3 "investors and shareholders"):
--   H7/H13  a share or an investor's terms change FROM a month: capital_holders.history keeps every month's terms
--           ([{from: 'yyyy-MM', pct, value}], empty = the columns hold the terms for every month)
--   H7/H14  a closed month keeps what each investor earned in it (capital_closed.returns {holder_no: amount}); later
--           changes of terms, fundings or holders never rewrite it
--   Q1/M18  a shipment funding keeps the money it stands for (lot_funding.amount): the investor's loss on it stops there,
--           and "funded" does not grow when a late bill raises the shipment's cost
alter table public.capital_holders add column if not exists history jsonb not null default '[]'::jsonb;
alter table public.capital_closed add column if not exists returns jsonb;
alter table public.lot_funding add column if not exists amount numeric(14,2);

-- fundings made before this: the money is their share of what the shipment cost when it was received
update public.lot_funding f set amount = round(coalesce((
    select sum(l.qty_in * coalesce(nullif(m.unit_price, 0), l.unit_cost, 0)) from public.stock_lots l
    left join public.stock_movements m on m.id = l.movement_id
    where l.business_id = f.business_id and l.reference = f.reference and l.source = 'receive'), 0) * f.pct / 100, 2)
 where f.amount is null;
