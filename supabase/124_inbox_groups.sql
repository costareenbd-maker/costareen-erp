-- 124: team groups for the Inbox (AiPraktor's Team -> Groups). A group says which hand-overs and alerts its members
-- hear (a complaint to the support group, new orders to the order desk); a teammate can be limited to some channels
-- (pages / numbers). The owner always sees everything. A teammate in no group hears everything, as before.

create table if not exists public.inbox_groups (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  name        text not null,
  hears       text[] not null default '{}',     -- hand-over reasons (complaint, refund...) and task kinds (order, payment, enquiry, alert, comment)
  members     uuid[] not null default '{}',
  created_at  timestamptz not null default now()
);
create table if not exists public.inbox_access (
  business_id uuid not null references public.businesses(id) on delete cascade,
  user_id     uuid not null,
  channels    uuid[] not null default '{}',     -- the channels this teammate sees (a row = limited; no row = all)
  set_by      text,
  set_at      timestamptz not null default now(),
  primary key (business_id, user_id)
);

do $$
declare t text;
begin
  foreach t in array array['inbox_groups', 'inbox_access']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_rw', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
