-- Google Drive copies: a queue of stored files to copy into the owner's Drive.
-- Written and read by the server only (no policy); the timer drains it.
create table if not exists public.drive_queue (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  folder      text not null,
  name        text not null,
  mime        text,
  created_at  timestamptz not null default now(),
  tries       int not null default 0,
  done_at     timestamptz,
  drive_id    text,
  error       text
);
create index if not exists drive_queue_todo_idx on public.drive_queue(business_id, id) where done_at is null;
alter table public.drive_queue enable row level security;
revoke all on public.drive_queue from anon, authenticated;
