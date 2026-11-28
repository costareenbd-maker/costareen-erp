-- ship-8 (28 Nov 2026): the traveller's own page (web/c/). Owner's rules: one permanent personal link; without our bag
-- he sees only his own details; from the moment staff put him on a shipment until staff mark it received he sees the
-- shipment (who receives, where to meet, how to exit, flight, bags, QR); requests for luggage from his page; works
-- offline. See .impeccable/mocks/traveller-portal-2026-11-28/BRIEF.md.
alter table public.ship_people add column if not exists addr_bd text not null default '';
alter table public.ship_people add column if not exists addr_kr text not null default '';
alter table public.ship_people add column if not exists portal_token text;
alter table public.ship_people add column if not exists self_joined boolean not null default false;
create unique index if not exists ship_people_portal_idx on public.ship_people (portal_token) where portal_token is not null;

alter table public.ships add column if not exists meet_note text not null default '';

-- "I can take luggage": the temporary facts of one journey (the permanent ones are on the profile)
create table if not exists public.ship_requests (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  person_id   bigint not null references public.ship_people(id) on delete cascade,
  direction   text not null default 'kr_bd' check (direction in ('kr_bd', 'bd_kr', 'both')),
  leave_on    date,
  return_on   date,
  flight      text not null default '',
  bags        int not null default 1,
  devices     int not null default 0,
  own_goods   boolean not null default false,
  note        text not null default '',
  state       text not null default 'new' check (state in ('new', 'talked', 'made', 'no')),
  ship_id     bigint references public.ships(id) on delete set null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists ship_requests_biz_idx on public.ship_requests (business_id, state, id desc);

-- where to meet at each airport, written once by staff (terminal, the meeting place, numbered steps, photos)
create table if not exists public.ship_guides (
  business_id uuid not null references public.businesses(id) on delete cascade,
  port        text not null check (port in ('DAC', 'ICN')),
  terminal    text not null default '',
  meet        text not null default '',
  steps       text not null default '',
  photos      jsonb not null default '[]'::jsonb,
  updated_at  timestamptz not null default now(),
  primary key (business_id, port)
);

-- a 6-digit code on WhatsApp to open the page on a new phone
create table if not exists public.ship_portal_codes (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  person_id   bigint not null references public.ship_people(id) on delete cascade,
  code_hash   text not null,
  tries       int not null default 0,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists ship_portal_codes_person_idx on public.ship_portal_codes (person_id, id desc);

do $$
declare t text;
begin
  foreach t in array array['ship_requests', 'ship_guides', 'ship_portal_codes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (business_id in (select public.my_business_ids(''member'')))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (business_id in (select public.my_business_ids(''member'')))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
grant usage, select on sequence public.ship_requests_id_seq to authenticated;
grant usage, select on sequence public.ship_portal_codes_id_seq to authenticated;
