-- clinic-1 (owner 28 Nov 2026): the Doctor desk. Oliareen now sells video-call consultations with dermatologists.
-- The business keeps doctor profiles and patient profiles; a WhatsApp booking assistant (its own number, purpose
-- 'clinic', like Alvi for sales) finds a free slot, asks the doctor on WhatsApp to confirm and keeps the routine
-- (reminders before the call, the call link, follow-ups). The schedule draws one line per doctor.
--   clinic_doctors   a doctor: name, degrees, BMDC number, WhatsApp, fee, consult length, gap, how long a slot is held
--   clinic_hours     weekly hours per doctor (weekday 0 = Sunday .. 6 = Saturday, Dhaka time)
--   clinic_offs      a day (or part of a day) off; struck out, never deleted
--   clinic_patients  a patient: the details the doctor needs, and the consent with its date and its words
--   clinic_consults  one consult: doctor, patient, time, state; never deleted (cancelled / declined / expired with a reason)
--   clinic_events    what happened to a consult and who did it
--   clinic_photos    a patient's skin photos (private storage folder 'clinic'), struck out, never deleted
-- States of a consult:
--   requested  the slot is held; the doctor has been asked on WhatsApp and has not answered yet (hold_until)
--   confirmed  the doctor said yes (or a person booked it by hand)
--   done       the call took place
--   no_show    the patient did not come
--   cancelled  the patient or the team cancelled (reason)
--   declined   the doctor said no
--   expired    nobody answered in time; the slot is free again
-- Two live consults (requested / confirmed) never overlap for one doctor: the booking locks the doctor's row and checks.
create table if not exists public.clinic_doctors (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  title       text not null default '',              -- degrees: "MBBS, DDV (চর্ম ও যৌন)"
  reg_no      text not null default '',              -- BMDC registration
  phone       text not null default '',              -- WhatsApp, 11 digits
  about       text not null default '',
  treats      text not null default '',              -- what they see: "ব্রণ, মেছতা, চুল পড়া"
  langs       text not null default 'বাংলা',
  fee         numeric(12,2) not null default 0,
  slot_min    int not null default 20 check (slot_min between 5 and 180),
  gap_min     int not null default 5 check (gap_min between 0 and 120),
  hold_min    int not null default 20 check (hold_min between 5 and 240),   -- how long the bot waits for the doctor's yes
  auto_ok     boolean not null default false,       -- trusted: a free slot in the hours is confirmed without asking
  color       text not null default '',
  video_link  text not null default '',              -- the doctor's own meeting room (Google Meet / Zoom), if they use one
  active      boolean not null default true,
  sort        int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index if not exists clinic_doctors_b_idx on public.clinic_doctors (business_id, active, sort);

create table if not exists public.clinic_hours (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  doctor_id   bigint not null references public.clinic_doctors(id) on delete cascade,
  weekday     smallint not null check (weekday between 0 and 6),
  start_min   int not null check (start_min between 0 and 1439),      -- minutes after midnight, Dhaka
  end_min     int not null check (end_min between 1 and 1440),
  check (end_min > start_min)
);
create index if not exists clinic_hours_d_idx on public.clinic_hours (doctor_id, weekday);

create table if not exists public.clinic_offs (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  doctor_id   bigint not null references public.clinic_doctors(id) on delete cascade,
  day         date not null,
  start_min   int,                                  -- null = the whole day
  end_min     int,
  reason      text not null default '',
  struck_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists clinic_offs_d_idx on public.clinic_offs (doctor_id, day);

create table if not exists public.clinic_patients (
  id           bigserial primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  name         text not null default '',
  phone        text not null default '',             -- 11 digits
  age          int,
  gender       text not null default '' check (gender in ('', 'f', 'm')),
  area         text not null default '',
  skin_type    text not null default '',
  concern      text not null default '',
  since        text not null default '',             -- how long the problem has been there
  routine      text not null default '',             -- what they use now
  allergies    text not null default '',             -- allergies, pregnancy, medicines
  notes        text not null default '',             -- the team's own notes
  consent_at   timestamptz,
  consent_text text not null default '',
  contact_id   uuid,                                 -- the Inbox contact the bot talks to
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists clinic_patients_b_idx on public.clinic_patients (business_id, updated_at desc);
create unique index if not exists clinic_patients_phone_idx on public.clinic_patients (business_id, phone) where phone <> '';

create table if not exists public.clinic_consults (
  id            bigserial primary key,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  no            text not null,                       -- C-<n>, also the word the doctor answers with ("#C12 হ্যাঁ")
  doctor_id     bigint not null references public.clinic_doctors(id),
  patient_id    bigint not null references public.clinic_patients(id),
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  state         text not null default 'requested' check (state in ('requested', 'confirmed', 'done', 'no_show', 'cancelled', 'declined', 'expired')),
  kind          text not null default 'new' check (kind in ('new', 'followup')),
  concern       text not null default '',
  fee           numeric(12,2) not null default 0,
  paid          boolean not null default false,
  pay_note      text not null default '',
  video_link    text not null default '',
  source        text not null default 'manual' check (source in ('manual', 'bot')),
  conversation_id uuid,
  hold_until    timestamptz,
  asked_at      timestamptz,
  nudged_at     timestamptz,
  doctor_said   text not null default '',
  reason        text not null default '',
  doctor_note   text not null default '',            -- what the doctor advised (after the call)
  follow_up     date,
  reminded_day  boolean not null default false,
  reminded_soon boolean not null default false,
  told_patient  timestamptz,                         -- the patient heard the doctor's answer
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);
create index if not exists clinic_consults_d_idx on public.clinic_consults (business_id, doctor_id, starts_at);
create index if not exists clinic_consults_p_idx on public.clinic_consults (patient_id, starts_at desc);
create index if not exists clinic_consults_s_idx on public.clinic_consults (business_id, state, hold_until);
create unique index if not exists clinic_consults_no_idx on public.clinic_consults (business_id, no);

create table if not exists public.clinic_events (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  consult_id  bigint not null references public.clinic_consults(id) on delete cascade,
  what        text not null,
  by_name     text not null default '',
  at          timestamptz not null default now()
);
create index if not exists clinic_events_c_idx on public.clinic_events (consult_id, id);

create table if not exists public.clinic_photos (
  id          bigserial primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  patient_id  bigint not null references public.clinic_patients(id) on delete cascade,
  path        text not null,
  mime        text not null default 'image/jpeg',
  source      text not null default 'page',          -- page | whatsapp
  struck_at   timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists clinic_photos_p_idx on public.clinic_photos (patient_id, id);

do $$
declare t text;
begin
  foreach t in array array['clinic_doctors', 'clinic_hours', 'clinic_offs', 'clinic_patients', 'clinic_consults', 'clinic_events', 'clinic_photos'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('create policy %I on public.%I for select to authenticated using (business_id in (select public.my_business_ids(''manager'')))', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_ins', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (business_id in (select public.my_business_ids(''manager'')))', t || '_ins', t);
    execute format('drop policy if exists %I on public.%I', t || '_upd', t);
    execute format('create policy %I on public.%I for update to authenticated using (business_id in (select public.my_business_ids(''manager''))) with check (business_id in (select public.my_business_ids(''manager'')))', t || '_upd', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
    execute format('grant usage, select on sequence public.%I to authenticated', t || '_id_seq');
  end loop;
  -- clinic_hours rows are replaced when a doctor's week is saved (the week is a setting, not a record)
  drop policy if exists clinic_hours_del on public.clinic_hours;
  create policy clinic_hours_del on public.clinic_hours for delete to authenticated using (business_id in (select public.my_business_ids('manager')));
  grant delete on public.clinic_hours to authenticated;
end $$;
