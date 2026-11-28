-- ship-7 (28 Nov 2026): our people who meet travellers and take the bags, and a private page per shipment for the
-- traveller. Owner: "the person carrying the bag must recognise the employees who receive it - photo, name and phone,
-- kept inside the system." Decisions: the traveller gets WhatsApp + his own link (no login); every active team member at
-- the destination airport is shown.
create table if not exists public.ship_team (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  phone       text not null default '',
  role        text not null default '',              -- e.g. "receives at Dhaka airport"
  port        text not null default 'DAC' check (port in ('DAC', 'ICN')),
  photo       text not null default '',              -- data:image/jpeg;base64, ~600 px
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ship_team_biz_idx on public.ship_team (business_id, port, sort, id);

alter table public.ships add column if not exists share_token text;
create unique index if not exists ships_share_token_idx on public.ships (share_token) where share_token is not null;

alter table public.ship_team enable row level security;
drop policy if exists ship_team_read on public.ship_team;
create policy ship_team_read on public.ship_team for select to authenticated using (business_id in (select public.my_business_ids('member')));
drop policy if exists ship_team_ins on public.ship_team;
create policy ship_team_ins on public.ship_team for insert to authenticated with check (business_id in (select public.my_business_ids('member')));
drop policy if exists ship_team_upd on public.ship_team;
create policy ship_team_upd on public.ship_team for update to authenticated using (business_id in (select public.my_business_ids('member'))) with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.ship_team to authenticated;
grant usage, select on sequence public.ship_team_id_seq to authenticated;
