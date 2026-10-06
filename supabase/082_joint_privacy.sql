-- Joint stock privacy (owner's check, 2026-10-06): a partner sees the joint stock, never your own shelf.
-- The old "partners can see my stock counts" default is switched off for every partner; an owner can still
-- switch it on by hand (Capital > Partner's own stock).
alter table public.pool_partners alter column share_stock set default false;
update public.pool_partners set share_stock = false where share_stock;
