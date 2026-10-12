-- Abilities per person (2026-10-05). Each person keeps their role; the owner can switch single
-- abilities on or off for them on top of it (Settings > Users > Abilities), and set their own
-- discount limit. {"dash": true, "costs": false, "discount": 30}. A missing key = the role's default.
alter table public.memberships add column if not exists powers jsonb not null default '{}'::jsonb;
grant update (powers) on public.memberships to authenticated;
