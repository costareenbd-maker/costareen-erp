-- 121: bookings for service businesses in the Inbox (AiPraktor's "services": a coaching centre, a clinic, a salon,
-- a travel agency). The AI works like a receptionist: it answers about the services, fees, place and hours from what
-- the business wrote, asks the business's own questions one at a time and records a booking REQUEST (a visit, a call,
-- an admission, a reservation). A person confirms it with one tap (or proposes another time, or declines) unless the
-- owner switched on automatic confirmation; an advance paid by bKash / Nagad is kept with its transaction id until a
-- person marks it received. A confirmed booking gets reminders the day before and a few hours before. Nothing is
-- deleted: a booking is declined or cancelled with a reason.

create table if not exists public.bookings (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  no              text not null,
  conversation_id uuid references public.inbox_conversations(id) on delete set null,
  name            text not null,
  phone           text,
  service         text not null,
  wanted          text,                             -- the time the customer asked for, in their words
  at              timestamptz,                      -- the confirmed (or proposed) time
  place           text,
  bring           text,
  answers         jsonb not null default '{}'::jsonb,
  status          text not null default 'requested' check (status in ('requested', 'proposed', 'confirmed', 'declined', 'cancelled', 'done')),
  reason          text,
  advance         numeric(14,2),
  trx_id          text,
  paid            boolean not null default false,
  reminded_day    boolean not null default false,
  reminded_hours  boolean not null default false,
  created_at      timestamptz not null default now(),
  unique (business_id, no)
);
create table if not exists public.booking_events (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  booking_id  uuid not null references public.bookings(id) on delete cascade,
  what        text not null,
  by_name     text,
  at          timestamptz not null default now()
);
create index if not exists bookings_idx on public.bookings (business_id, status, at);
create unique index if not exists bookings_trx_idx on public.bookings (business_id, trx_id) where trx_id is not null;

do $$
declare t text;
begin
  foreach t in array array['bookings', 'booking_events']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_rw', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
