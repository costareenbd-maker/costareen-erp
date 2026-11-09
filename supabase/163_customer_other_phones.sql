-- 163 final-contacts (10 Nov 2026, owner: "a form that assumes ONE where the real world has MANY").
--
-- A shop has two or three phone numbers (the counter, the owner, WhatsApp). The customer form held one. The main
-- phone stays the customer's identity (customer_key, the invoice lookups); the other numbers are kept beside it so
-- the list finds the customer by any of them and a second row is never made for the same shop. Additive, idempotent.

alter table public.customers add column if not exists other_phones text not null default '';
