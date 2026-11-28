-- ship-10 (28 Nov 2026): trips a travel partner tells us about, v2. Owner: luggage weight too (kg), which airport,
-- an optional e-ticket (itinerary receipt) upload that staff can compare with what the partner typed and, after a call
-- to confirm, copy in with one click (never automatically); a return date that is only remembered (one tap later books
-- the way back); history with each trip's details (when, money received).
alter table public.ship_requests add column if not exists from_airport text not null default '';
alter table public.ship_requests add column if not exists to_airport text not null default '';
alter table public.ship_requests add column if not exists bag_kg numeric(5,1);
alter table public.ship_requests add column if not exists ticket_file text not null default '';
alter table public.ship_requests add column if not exists ticket_name text not null default '';
alter table public.ship_requests add column if not exists ticket_mime text not null default '';
alter table public.ship_requests add column if not exists ticket_data jsonb;
alter table public.ship_requests add column if not exists ticket_read_at timestamptz;
alter table public.ship_requests add column if not exists ticket_applied_at timestamptz;
alter table public.ship_requests add column if not exists ticket_applied_by text not null default '';
alter table public.ship_requests add column if not exists return_of bigint references public.ship_requests(id) on delete set null;
update public.ship_requests set from_airport = case when direction = 'bd_kr' then 'DAC' else 'ICN' end where from_airport = '';
update public.ship_requests set to_airport = case when direction = 'bd_kr' then 'ICN' else 'DAC' end where to_airport = '';
