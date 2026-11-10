-- boss-2 (owner 11 Nov 2026): "any doubt, anything - the AI on 59 tells our manager (52) on WhatsApp directly".
-- superior_asks now also carries the AI's questions it cannot answer (team) and its hand-overs (handover).
alter table public.superior_asks add column if not exists kind text not null default 'discount';
-- who it went to: 'manager' (basic: stock, fit, delivery, a discount) or 'md' (strategic: bringing a product in by a
-- date, new products, dealer / bulk deals, proposals) - the owner's split; their answers teach the AI (bossKnowledge)
alter table public.superior_asks add column if not exists sent_to text not null default 'manager';
