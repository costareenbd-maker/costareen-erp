-- ============================================================================
-- COSTAREEN ERP - plan A1: the cost of a sale is fixed on the day of the sale
-- ----------------------------------------------------------------------------
-- Run AFTER 028. Idempotent.
--
-- invoice_lines.unit_cost has been written by a trigger since 005, for every
-- business. The reports did not read it: they multiplied by the product's cost
-- as it is today, so last month's profit moved whenever a shipment arrived at
-- another price. They now read the line (handlers/dashboard.js soldCost).
--
-- This file makes sure every existing line has a figure, once: where none was
-- written, the product's cost as it stands now is the best that is known.
-- Where the product has no cost either it stays 0 = "not known", and the
-- reports fall back to today's cost until one is filled in.
-- ============================================================================

alter table public.invoice_lines add column if not exists unit_cost numeric(14,2);

update public.invoice_lines l
set unit_cost = p.cost_price
from public.products p
where p.id = l.product_id and (l.unit_cost is null or l.unit_cost = 0) and p.cost_price > 0;

-- lines whose product link was lost in the import: match by SKU inside the same business
update public.invoice_lines l
set unit_cost = p.cost_price
from public.products p
where l.product_id is null and (l.unit_cost is null or l.unit_cost = 0) and p.cost_price > 0
  and p.business_id = l.business_id and lower(btrim(p.sku)) = lower(btrim(l.sku));
