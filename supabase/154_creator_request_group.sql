-- multi-1 (2 Nov 2026): one creator project can ask for several different filaments. Each filament stays its own
-- request row (approve / give / stock move / claims work per line as before); the rows of one project share group_id
-- (= the first row's id; old rows have none and are their own group).
alter table public.erp_creator_requests add column if not exists group_id bigint;
create index if not exists erp_creator_requests_group_idx on public.erp_creator_requests(business_id, group_id);
