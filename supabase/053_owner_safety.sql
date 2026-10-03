-- Owner safety: taking access from an owner needs both owners to agree, each through a link in their own e-mail.
create table if not exists public.erp_owner_changes (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  target_user   uuid not null,
  new_role      text,               -- the role the owner would get (null = unchanged)
  switch_off    boolean not null default false,
  requested_by  uuid not null,
  made_at       timestamptz not null default now(),
  expires_at    timestamptz not null default now() + interval '48 hours',
  status        text not null default 'waiting'    -- waiting | done | refused | expired | cancelled
);
create table if not exists public.erp_owner_votes (
  change_id    uuid not null references public.erp_owner_changes(id) on delete cascade,
  user_id      uuid not null,
  token_hash   text not null unique,
  answer       text,                 -- yes | no
  answered_at  timestamptz,
  primary key (change_id, user_id)
);
alter table public.erp_owner_changes enable row level security;
alter table public.erp_owner_votes enable row level security;
revoke all on public.erp_owner_changes, public.erp_owner_votes from anon, authenticated;
