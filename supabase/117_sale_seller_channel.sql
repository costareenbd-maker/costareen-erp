-- 117: who sold it and where the customer came from (FilaDash merge, the New sale screen).
--
-- invoices.seller_id: the person the sale belongs to (commission). Empty = whoever made the invoice (as before).
--   A manager or the owner may name another member of the business; sales staff always sell as themselves.
-- invoices.channel: where the customer came from (Walk-in, Facebook, WhatsApp, Phone, Website, Other) - the "Sales
--   Channel" chart counts it; invoices.source stays the delivery (courier, pickup) as before.
-- invoices.price_reason: why a price was more than 5 % below the product's price (the New sale screen asks).

alter table public.invoices add column if not exists seller_id uuid references auth.users(id);
alter table public.invoices add column if not exists channel text;
alter table public.invoices add column if not exists price_reason text;
