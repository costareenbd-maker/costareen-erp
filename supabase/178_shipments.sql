-- ship-1 (owner 27 Nov 2026): the vendor shipment business - goods we move ourselves between Korea and Bangladesh,
-- in a traveller's luggage ("bag", code BG-0001) or by air cargo through a forwarder ("air", code AC-0001).
-- A bag makes round trips: every trip is one ships row with the bag's code; the newest trip is the bag's state now.
--   ship_people   the travellers who carry our bags (carriers): contact, photo, WhatsApp consent, note
--   ships         one trip / one cargo: route, step, carrier + flight or forwarder + AWB, fee, customs duty
--   ship_items    what is inside: sent quantity, counted quantity on arrival (null = not counted yet)
--   ship_events   what happened, by whom (never deleted)
-- Steps (bag):  0 pack, 1 sealed, 2 handed to carrier, 3 flying, 4 landed, 5 received, 6 checked
-- Steps (air):  0 pack, 1 booked, 2 picked up, 3 flying, 4 customs, 5 received, 6 checked
-- Nothing is deleted: items and people are struck out (struck_at / removed_at).
create table if not exists public.ship_people (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  phone       text not null default '',
  email       text not null default '',
  city        text not null default '',
  photo       text,                                   -- small data:image (made small on the page)
  wa_ok       boolean not null default false,         -- said yes to WhatsApp reminders
  note        text not null default '',
  created_at  timestamptz not null default now(),
  removed_at  timestamptz
);
create index if not exists ship_people_biz_idx on public.ship_people (business_id, name);

create table if not exists public.ships (
  id            bigserial primary key,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  code          text not null,                        -- BG-0007 / AC-0004 (a bag keeps its code on every trip)
  trip_no       int not null default 1,
  type          text not null default 'bag' check (type in ('bag', 'air')),
  nickname      text not null default '',
  from_port     text not null default 'ICN',
  to_port       text not null default 'DAC',
  step          int not null default 0 check (step between 0 and 6),
  carrier_id    bigint references public.ship_people(id),
  flight_no     text not null default '',
  depart_at     timestamptz,
  land_at       timestamptz,
  return_on     date,
  forwarder     text not null default '',
  awb           text not null default '',
  cartons       int,
  weight_kg     numeric(10,2),
  track_url     text not null default '',
  fee_amt       numeric(14,2),                        -- carrier's fee or the cargo freight
  fee_cur       text not null default 'KRW' check (fee_cur in ('KRW', 'BDT', 'USD')),
  customs_amt   numeric(14,2),                        -- null = not written yet; 0 = nothing to pay
  customs_by    text not null default 'carrier' check (customs_by in ('carrier', 'us')),
  customs_photo text,
  received_at   timestamptz,
  checked_at    timestamptz,
  created_by    uuid,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (business_id, code, trip_no)
);
create index if not exists ships_biz_idx on public.ships (business_id, updated_at desc);
create index if not exists ships_awb_idx on public.ships (business_id, awb);

create table if not exists public.ship_items (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  ship_id     bigint not null references public.ships(id) on delete cascade,
  name        text not null,
  qty         int not null default 1 check (qty >= 0),
  got_qty     int check (got_qty >= 0),
  for_label   text not null default '',               -- whose goods (e.g. Oliareen), free text
  created_at  timestamptz not null default now(),
  struck_at   timestamptz
);
create index if not exists ship_items_ship_idx on public.ship_items (ship_id, id);

create table if not exists public.ship_events (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  ship_id     bigint not null references public.ships(id) on delete cascade,
  what        text not null,
  by_user     uuid,
  by_name     text not null default '',
  at          timestamptz not null default now()
);
create index if not exists ship_events_ship_idx on public.ship_events (ship_id, id);

do $$
declare t text;
begin
  foreach t in array array['ship_people', 'ships', 'ship_items', 'ship_events'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (business_id in (select public.my_business_ids(''member'')))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (business_id in (select public.my_business_ids(''member'')))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant usage, select on sequence public.%I to authenticated', t || '_id_seq');
  end loop;
end $$;
