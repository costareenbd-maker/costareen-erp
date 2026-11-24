-- grev-1 (owner 24 Nov 2026): a review card in the customer's WhatsApp group after an INVOICE is delivered
-- (until now only chat orders asked for a review, and real sales are invoices). One ask per invoice.
alter table public.review_asks add column if not exists invoice_no text;
create unique index if not exists review_asks_invoice_idx on public.review_asks (business_id, invoice_no) where invoice_no is not null;
