-- 119: money an invoice took before this ERP (14 Oct 2026, owner: a return on a July sale showed the whole sale as due).
--
-- Sales brought over from the Google Sheet were marked Paid on the invoice itself; the money never had a row in
-- payments. Whenever a payment or a return was then recorded on such an invoice, syncInvoiceStatus rewrote the
-- invoice's paid / due / status from the payments rows alone - and the sheet's "paid" was lost: INV-20260728-1469
-- (3,900, paid on the sheet) became 3,900 due after one item was returned and refunded.
--
-- paid_outside keeps that money on the invoice: what was paid outside the payments ledger. The recalculation adds it
-- to the ledger, so a later payment or return can never take it away. It is not money in any account (the books for
-- that period are the sheet's), so cash, banks, sales and profit do not change.
--
-- Filled once: an invoice marked Paid whose payments rows hold less than its total had the rest paid outside. On the
-- live server that is 374 Costareen invoices from the sheet (2 May - 29 Sep 2026); every invoice made inside the ERP
-- already matches its payments exactly, so none of them is touched.

alter table public.invoices add column if not exists paid_outside numeric(14,2) not null default 0;

update public.invoices i
   set paid_outside = round(i.grand_total - coalesce(p.got, 0), 2)
  from (select i2.id, (select sum(p2.amount) from public.payments p2
                        where p2.business_id = i2.business_id and p2.invoice_no = i2.invoice_no) as got
          from public.invoices i2) p
 where p.id = i.id
   and i.payment_status = 'Paid'
   and i.voided_at is null
   and i.paid_outside = 0
   and i.grand_total - coalesce(p.got, 0) > 0.5;
