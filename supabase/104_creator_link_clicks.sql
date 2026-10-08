-- The project link (handlers/creatorportal.js): every filament request gets its own short link the creator puts in
-- that video / post. A click is counted here and the buyer goes on to the product on the shop's website.
alter table public.erp_creator_requests add column if not exists link_code text;
alter table public.erp_creator_requests add column if not exists link_to text;          -- where a click goes (empty = the product search on the website)
alter table public.erp_creator_requests add column if not exists clicks int not null default 0;
create table if not exists public.erp_creator_clicks (
  id           bigserial primary key,
  business_id  uuid not null,
  request_id   bigint not null references public.erp_creator_requests(id) on delete cascade,
  visitor      text,                                    -- hash of address + day: one visitor a day counts once as unique
  referer      text,                                    -- youtube.com, facebook.com ... (host only)
  at           timestamptz not null default now()
);
create index if not exists erp_creator_clicks_idx on public.erp_creator_clicks(business_id, request_id, at);
alter table public.erp_creator_clicks enable row level security;
drop policy if exists erp_creator_clicks_rw on public.erp_creator_clicks;
create policy erp_creator_clicks_rw on public.erp_creator_clicks for all using (business_id in (select public.my_business_ids('owner'))) with check (business_id in (select public.my_business_ids('owner')));
grant select, insert, update, delete on public.erp_creator_clicks to authenticated;
