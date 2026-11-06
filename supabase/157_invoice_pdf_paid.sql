-- paidpdf-1 (owner 6 Nov 2026): "when it is paid the PDF shows Paid; part paid shows what was paid" - one PDF per invoice,
-- drawn again when what was paid has changed since it was drawn (sales.js erpInvoicePdf / makeInvoicePdf). This is what
-- was paid when the saved PDF was drawn; null = drawn before this existed.
alter table public.invoices add column if not exists pdf_paid numeric(16,2);
