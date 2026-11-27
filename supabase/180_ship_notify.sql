-- ship-4 (27 Nov 2026): reminders for the vendor shipment business.
-- Owner: "app notifications, and WhatsApp through Alvi's number - flight tomorrow, be at the airport at least 2 hours
-- early; X is bringing product Y." Every message the timer (or a person) sends is written here once, so it never goes
-- twice and the shipment page can show what went, to whom and when. Settings live in business_config:
--   ship_team_wa      the team's WhatsApp numbers (Dhaka receivers), commas between
--   ship_wa_carrier   'off' = no messages to travellers (default on)
create table if not exists public.ship_notes (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  ship_id     bigint not null references public.ships(id) on delete cascade,
  kind        text not null,                        -- c_eve c_day c_land t_eve t_land t_late t_count a_eve a_land
  target      text not null check (target in ('carrier', 'team')),
  phone       text not null default '',
  body        text not null default '',
  state       text not null check (state in ('sent', 'failed', 'skipped')),
  error       text not null default '',
  tries       int not null default 1,
  by_name     text not null default '',             -- '' = the timer; a name = sent by hand
  at          timestamptz not null default now(),
  unique (ship_id, kind, phone)
);
create index if not exists ship_notes_biz_idx on public.ship_notes (business_id, at desc);

alter table public.ship_notes enable row level security;
drop policy if exists ship_notes_read on public.ship_notes;
create policy ship_notes_read on public.ship_notes for select to authenticated using (business_id in (select public.my_business_ids('member')));
drop policy if exists ship_notes_ins on public.ship_notes;
create policy ship_notes_ins on public.ship_notes for insert to authenticated with check (business_id in (select public.my_business_ids('member')));
drop policy if exists ship_notes_upd on public.ship_notes;
create policy ship_notes_upd on public.ship_notes for update to authenticated using (business_id in (select public.my_business_ids('member'))) with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.ship_notes to authenticated;
grant usage, select on sequence public.ship_notes_id_seq to authenticated;
