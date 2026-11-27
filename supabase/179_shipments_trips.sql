-- ship-2 (owner 27 Nov 2026): one shipment = one traveller on one flight (or one air cargo), carrying any number of our
-- bags plus loose things (in hand, in the traveller's own bag). Owner agreed after research: a permanent keyword per
-- traveller (code C-0001 + QR card) and an automatic shipment number per trip (TR-0001); a bag keeps its code and QR
-- for life - when the physical bag is replaced the code stays and the bag number goes up (BG-0007 · bag 2).
--   ship_bags          our bags: code (never changes), nickname, body_no (which physical bag), retired
--   ship_bag_changes   every bag replacement: old/new body, reason, who
--   ship_trip_bags     which bags travel in which shipment
--   ship_people.code   the traveller's permanent keyword
--   ship_items.bag_id / place   where an item travels: in one of our bags, in hand, in the traveller's own bag, cargo
create table if not exists public.ship_bags (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  code        text not null,
  nickname    text not null default '',
  body_no     int not null default 1,
  retired_at  timestamptz,
  created_at  timestamptz not null default now(),
  unique (business_id, code)
);
create table if not exists public.ship_bag_changes (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  bag_id      bigint not null references public.ship_bags(id) on delete cascade,
  old_body    int not null,
  new_body    int not null,
  reason      text not null default '',
  by_name     text not null default '',
  at          timestamptz not null default now()
);
create table if not exists public.ship_trip_bags (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  ship_id     bigint not null references public.ships(id) on delete cascade,
  bag_id      bigint not null references public.ship_bags(id),
  body_no     int not null default 1,                 -- the physical bag that made this trip
  removed_at  timestamptz,
  unique (ship_id, bag_id)
);
create index if not exists ship_trip_bags_bag_idx on public.ship_trip_bags (bag_id);
alter table public.ship_people add column if not exists code text;
alter table public.ship_items add column if not exists bag_id bigint references public.ship_bags(id);
alter table public.ship_items add column if not exists place text not null default 'bag';
do $$ begin
  alter table public.ship_items add constraint ship_items_place_chk check (place in ('bag', 'hand', 'own', 'cargo'));
exception when duplicate_object then null; end $$;
alter table public.ships drop constraint if exists ships_type_check;
-- 'bag' trips from 178 become 'trip' (a traveller's shipment)
update public.ships set type = 'trip' where type = 'bag';
alter table public.ships add constraint ships_type_check check (type in ('trip', 'air'));
alter table public.ships alter column type set default 'trip';

-- carry 178's rows over (dev/local demo data only; live never had 178 rows)
insert into public.ship_bags (business_id, code, nickname)
  select distinct on (business_id, code) business_id, code, nickname from public.ships where code like 'BG-%' order by business_id, code, trip_no desc
  on conflict do nothing;
insert into public.ship_trip_bags (business_id, ship_id, bag_id)
  select s.business_id, s.id, b.id from public.ships s join public.ship_bags b on b.business_id = s.business_id and b.code = s.code
  where s.code like 'BG-%' on conflict do nothing;
update public.ship_items i set bag_id = b.id, place = 'bag' from public.ships s join public.ship_bags b on b.business_id = s.business_id and b.code = s.code
  where i.ship_id = s.id and s.code like 'BG-%' and i.bag_id is null;
update public.ship_items i set place = 'cargo' from public.ships s where i.ship_id = s.id and s.type = 'air';
with n as (select id, row_number() over (partition by business_id order by id) as k from public.ships where code like 'BG-%')
  update public.ships s set code = 'TR-' || lpad(n.k::text, 4, '0'), trip_no = 1 from n where s.id = n.id;
with n as (select id, row_number() over (partition by business_id order by id) as k from public.ship_people where code is null)
  update public.ship_people p set code = 'C-' || lpad(n.k::text, 4, '0') from n where p.id = n.id;
create unique index if not exists ship_people_code_idx on public.ship_people (business_id, code);

do $$
declare t text;
begin
  foreach t in array array['ship_bags', 'ship_bag_changes', 'ship_trip_bags'] loop
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
