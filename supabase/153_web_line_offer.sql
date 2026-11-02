-- offer-1 (2 Nov 2026): the website's price list offer (e.g. "11.11 Offer") rides with each web order line,
-- so the invoice made from the order names the offer behind its discount.
alter table web_order_lines add column if not exists offer text;
