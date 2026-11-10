-- boss-1 (owner 10 Nov 2026): when a customer wants more discount than the AI may give, or something feels off, the AI
-- says "I'll check with my superior right now" and messages the manager on WhatsApp from its own number; the
-- manager's reply goes back to the customer through the AI.
create table if not exists public.superior_asks (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid references public.inbox_conversations(id) on delete set null,
  ref             text not null,                    -- R12: the manager starts the reply with #R12
  question        text not null,
  sku             text not null default '',
  qty             numeric(14,2),
  wanted_price    numeric(14,2),
  status          text not null default 'open' check (status in ('open', 'answered', 'relayed')),
  answer          text,
  answer_price    numeric(14,2),
  asked_at        timestamptz not null default now(),
  answered_at     timestamptz
);
-- the price the manager agreed for a product in this chat (place_order uses it)
alter table public.inbox_conversations add column if not exists boss_agreed jsonb;

create index if not exists superior_asks_open_idx on public.superior_asks (business_id, status, asked_at);
create unique index if not exists superior_asks_ref_idx on public.superior_asks (business_id, ref);

do $$
begin
  execute 'alter table public.superior_asks enable row level security';
  execute 'drop policy if exists superior_asks_rw on public.superior_asks';
  execute 'create policy superior_asks_rw on public.superior_asks for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))';
  execute 'grant select, insert, update on public.superior_asks to authenticated';
end $$;
