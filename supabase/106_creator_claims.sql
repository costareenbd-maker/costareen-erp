-- Sponsorship rolls owed back by the brand (handlers/creatorportal.js). When filament is handed over it leaves the
-- stock it came from (the shop's own, or a joint pool) as a zero-value move - no money anywhere. The brand replaces
-- the rolls in a later shipment; then they come back into the same stock, again with no money.
alter table public.erp_creator_ships add column if not exists source text;                   -- 'own' | 'pool:<pool id>' | 'none'
alter table public.erp_creator_ships add column if not exists source_name text;              -- "My stock" / the pool's name
alter table public.erp_creator_ships add column if not exists replaced numeric(12,2) not null default 0;
alter table public.erp_creator_ships add column if not exists replaced_at timestamptz;
alter table public.erp_creator_ships add column if not exists replaced_note text;           -- which shipment
