-- control-only (the installer never copies this file into a company's database)
-- Feedback and complaints (Apps > Feedback): anyone using any company's ERP reports a problem, a complaint, an idea
-- or praise; the provider reads and answers them in one inbox. Private: no company sees another's reports.
create table if not exists public.erp_feedback (
  id            bigserial primary key,
  business_id   uuid,
  company       text,
  who           text,
  role          text,
  kind          text not null default 'problem',      -- complaint | problem | idea | praise
  text          text not null,
  screen        text,                                  -- which screen they were on
  contact       text,                                  -- phone or e-mail they chose to leave
  status        text not null default 'new',           -- new | looking | fixed | wont
  reply         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index if not exists erp_feedback_status_idx on public.erp_feedback (status, created_at desc);
alter table public.erp_feedback enable row level security;
revoke all on public.erp_feedback from anon, authenticated;
