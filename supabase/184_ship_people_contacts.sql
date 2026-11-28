-- ship-9 (28 Nov 2026): a traveller has two numbers (Korea and Bangladesh) and an optional emergency contact.
-- Owner: "there must be two numbers, Korean and Bangladeshi, and an option to add an emergency contact, optional".
-- ship_people.phone stays the WhatsApp number (messages, codes); phone_kr / phone_bd are the two numbers.
alter table public.ship_people add column if not exists phone_kr text not null default '';
alter table public.ship_people add column if not exists phone_bd text not null default '';
alter table public.ship_people add column if not exists em_name text not null default '';
alter table public.ship_people add column if not exists em_relation text not null default '';
alter table public.ship_people add column if not exists em_phone text not null default '';
-- the numbers people already gave land in the right box
update public.ship_people set phone_kr = phone where phone like '+82%' and phone_kr = '';
update public.ship_people set phone_bd = phone where phone like '+880%' and phone_bd = '';
