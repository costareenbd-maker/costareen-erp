-- 112: the investor's own page (FilaDash merge P3: "read-only investor portal, secret link + 8-digit code").
--
-- The owner makes a link for one investor (Capital): a secret in the address and an 8-digit code given to the investor
-- separately. Only their hashes are kept. The page shows that investor alone: money in and out, returns earned month
-- by month and what is still owed, and for shipment investors each shipment they funded. Five wrong codes lock the
-- link for 15 minutes. A new link replaces the old one; the owner can switch it off.

create table if not exists public.investor_links (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  holder_no    text not null,
  token_hash   text not null unique,
  code_hash    text not null,
  made_by      text,
  made_at      timestamptz not null default now(),
  revoked_at   timestamptz,
  last_seen    timestamptz,
  failed       int not null default 0,
  locked_until timestamptz
);
create index if not exists investor_links_holder on public.investor_links (business_id, holder_no) where revoked_at is null;
alter table public.investor_links enable row level security;
drop policy if exists investor_links_owner on public.investor_links;
create policy investor_links_owner on public.investor_links for all to authenticated
  using (business_id in (select public.my_business_ids('owner')))
  with check (business_id in (select public.my_business_ids('owner')));
grant select, insert, update on public.investor_links to authenticated;
