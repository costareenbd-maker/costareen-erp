-- ship-6 (28 Nov 2026): photos of each bag. Owner: "when I make a bag (code + QR), there must be a way to add the bag's
-- photos, at least 2." Photos belong to one physical bag (body_no): a replaced bag gets its own photos, the old ones stay
-- in the bag's history. Removing a photo strikes it out (removed_at); nothing is deleted.
create table if not exists public.ship_bag_photos (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  bag_id      bigint not null references public.ship_bags(id) on delete cascade,
  body_no     int not null default 1,
  photo       text not null,                 -- data:image/jpeg;base64, up to ~1100 px
  thumb       text not null default '',      -- data:image/jpeg;base64, ~160 px (lists, shipment page)
  by_name     text not null default '',
  at          timestamptz not null default now(),
  removed_at  timestamptz
);
create index if not exists ship_bag_photos_bag_idx on public.ship_bag_photos (bag_id, body_no, id);

alter table public.ship_bag_photos enable row level security;
drop policy if exists ship_bag_photos_read on public.ship_bag_photos;
create policy ship_bag_photos_read on public.ship_bag_photos for select to authenticated using (business_id in (select public.my_business_ids('member')));
drop policy if exists ship_bag_photos_ins on public.ship_bag_photos;
create policy ship_bag_photos_ins on public.ship_bag_photos for insert to authenticated with check (business_id in (select public.my_business_ids('member')));
drop policy if exists ship_bag_photos_upd on public.ship_bag_photos;
create policy ship_bag_photos_upd on public.ship_bag_photos for update to authenticated using (business_id in (select public.my_business_ids('member'))) with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.ship_bag_photos to authenticated;
grant usage, select on sequence public.ship_bag_photos_id_seq to authenticated;
