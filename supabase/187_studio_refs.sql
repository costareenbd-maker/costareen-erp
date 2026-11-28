-- studioref-1 (owner 28 Nov 2026): reference pictures and videos for the Content desk Studio. The person attaches up to 6
-- pictures and 2 videos to a prompt or a feedback. Pictures = her avatar / product / content pictures: the engine shows them
-- inside the video (still with a gentle push) and, when a new shot made from the picture would be better, saves it for the
-- brand's night clip desk. A video = the style structure to follow: pace, layout, beats, text style ("same" = this exact
-- structure, "better" = this structure, made more real and more beautiful). Removing before sending is fine (state
-- 'removed', the row stays); after sending, the refs stay with the work log. No delete policy.
create table if not exists public.content_studio_refs (
  id           bigserial primary key,
  business_id  uuid not null references public.businesses(id) on delete cascade,
  user_id      uuid not null,
  project_id   bigint references public.content_studio_projects(id) on delete cascade,
  msg_id       bigint,                                -- the prompt / feedback it was sent with
  job_id       bigint,                                -- the version job that uses it
  kind         text not null check (kind in ('image', 'video')),
  file_path    text not null,                         -- content/studio-refs/<uuid>.<ext> in the business's file store
  name         text not null default '',
  mime         text not null default '',
  bytes        bigint not null default 0,
  note         text,                                  -- optional: what it is ("Rini", "this serum")
  mode         text not null default 'better' check (mode in ('same', 'better')),   -- video only
  state        text not null default 'uploading' check (state in ('uploading', 'ready', 'sent', 'removed')),
  used         jsonb not null default '{}'::jsonb,    -- what the engine did with it ({"shown": true, "night": "..."})
  created_at   timestamptz not null default now(),
  confirmed_at timestamptz,
  sent_at      timestamptz,
  removed_at   timestamptz
);
create index if not exists content_studio_refs_u_idx on public.content_studio_refs (business_id, user_id, state);
create index if not exists content_studio_refs_p_idx on public.content_studio_refs (project_id, msg_id);
create index if not exists content_studio_refs_j_idx on public.content_studio_refs (job_id);
create unique index if not exists content_studio_refs_path_idx on public.content_studio_refs (business_id, file_path);

alter table public.content_studio_refs enable row level security;
drop policy if exists content_studio_refs_read on public.content_studio_refs;
create policy content_studio_refs_read on public.content_studio_refs for select to authenticated
  using (business_id in (select public.my_business_ids('member')));
drop policy if exists content_studio_refs_ins on public.content_studio_refs;
create policy content_studio_refs_ins on public.content_studio_refs for insert to authenticated
  with check (business_id in (select public.my_business_ids('manager')));
drop policy if exists content_studio_refs_upd on public.content_studio_refs;
create policy content_studio_refs_upd on public.content_studio_refs for update to authenticated
  using (business_id in (select public.my_business_ids('manager'))) with check (business_id in (select public.my_business_ids('manager')));
grant select, insert, update on public.content_studio_refs to authenticated;
grant usage, select on sequence public.content_studio_refs_id_seq to authenticated;
