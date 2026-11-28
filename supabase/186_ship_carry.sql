-- ship-12 (28 Nov 2026): what else a travel partner can carry, ticked from OUR list (owner: "mobile, laptop... tick
-- boxes; we show what we have to offer above the customer's request"). The list itself: business_config
-- ship_carry_items (one per line, edited by staff). No rules tick on the form any more (we pack the bags ourselves).
alter table public.ship_requests add column if not exists carry jsonb not null default '[]'::jsonb;
