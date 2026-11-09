-- final-sales (10 Nov 2026): a Save pressed twice, or sent again after a slow answer, books ONE invoice.
-- The page sends a key it made for this sale (client_key); the second arrival finds the first invoice and
-- answers with it instead of selling the goods twice.
alter table public.invoices add column if not exists client_key text;
create unique index if not exists invoices_client_key_uq on public.invoices (business_id, client_key) where client_key is not null;
