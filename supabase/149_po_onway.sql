-- 149 (27 Oct 2026, onway-1): "Still coming" on the Receive page. A shipment written down when it is bought - the
-- goods, the supplier invoice total, how it was paid - becomes a supplier order; shipping, weight and the other
-- costs are asked when it arrives (owner: "I only know the shipment's cost and real weight when I receive it").
-- The order remembers the invoice currency and totals, and the joint stock it is meant for (received into that pool).
alter table public.po_stages
  add column if not exists pool      uuid,
  add column if not exists currency  text,
  add column if not exists goods_fx  numeric(14,2),
  add column if not exists goods_bdt numeric(14,2);
