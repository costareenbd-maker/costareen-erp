-- control-only (the installer never copies this file into a company's database)
-- Stage N3 (docs/NETWORK-BLUEPRINT.md sections 4, 4.5): the Print Doctor's community parts. The problems, causes and
-- fixes themselves are content in the page (web/doctor-data.js). Here: what members send (a failed print with its
-- story, settings that worked), what the platform publishes from it (tips with credit), and "did this help" votes.
create table if not exists public.erp_doctor_cases (
  id          uuid primary key default gen_random_uuid(),
  problem     text not null,                          -- a problem id from the page, or 'other'
  printer     text,
  material    text,
  story       text not null,                          -- what happened
  tried       text,                                   -- what was tried already
  name        text,                                   -- first name for the credit (the member's choice)
  contact     text,                                   -- phone or e-mail, optional, only to answer
  consent     jsonb,                                  -- {at, text, ip}
  photo       jsonb,                                  -- [{name, mime}] under public/doctor/<id>/
  status      text not null default 'new' check (status in ('new', 'answered', 'published', 'removed')),
  reply       text,                                   -- the guide's answer, shown to the sender on the case link
  token_hash  text,                                   -- the sender's case link
  created_at  timestamptz not null default now(),
  answered_at timestamptz
);
create index if not exists erp_doctor_cases_status_idx on public.erp_doctor_cases(status, created_at desc);
alter table public.erp_doctor_cases enable row level security;
revoke all on public.erp_doctor_cases from anon, authenticated;

create table if not exists public.erp_doctor_tips (
  id          uuid primary key default gen_random_uuid(),
  problem     text not null,
  text        text not null,
  credit      text,                                   -- "Sumon, Mirpur" - as the member wrote it
  case_id     uuid references public.erp_doctor_cases(id) on delete set null,
  created_at  timestamptz not null default now()
);
create index if not exists erp_doctor_tips_problem_idx on public.erp_doctor_tips(problem, created_at desc);
alter table public.erp_doctor_tips enable row level security;
revoke all on public.erp_doctor_tips from anon, authenticated;

create table if not exists public.erp_doctor_votes (
  problem   text not null,
  helped    boolean not null,
  ip_hash   text not null,
  at        timestamptz not null default now()
);
create index if not exists erp_doctor_votes_idx on public.erp_doctor_votes(problem);
alter table public.erp_doctor_votes enable row level security;
revoke all on public.erp_doctor_votes from anon, authenticated;

-- settings that worked for a member: a printer, a filament, the numbers; approved by a guide, confirmed by others
create table if not exists public.erp_doctor_settings (
  id          uuid primary key default gen_random_uuid(),
  printer     text not null,
  material    text not null,                          -- PLA, PETG, ABS, TPU, ...
  brand       text,                                   -- the filament brand as written
  nozzle_c    int,
  bed_c       int,
  speed       text,
  cooling     text,
  retraction  text,
  notes       text,
  name        text,                                   -- credit
  status      text not null default 'pending' check (status in ('pending', 'approved', 'removed')),
  confirms    int not null default 0,
  created_at  timestamptz not null default now()
);
create index if not exists erp_doctor_settings_idx on public.erp_doctor_settings(status, material, created_at desc);
alter table public.erp_doctor_settings enable row level security;
revoke all on public.erp_doctor_settings from anon, authenticated;
