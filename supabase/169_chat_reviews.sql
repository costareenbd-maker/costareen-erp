-- review-1 (owner 10 Nov 2026): after a chat order is delivered, the customer gets a review card in the same chat
-- (Messenger -> Messenger, WhatsApp -> WhatsApp). One tap on the stars rates the shop and each product bought; words
-- are optional. The reviews go to the website (POST /wp-json/cz/v1/reviews) and show there as "Verified buyer".
--
--   review_asks   one per delivered chat order: the page's token, what was bought, when it was asked / opened / done
--   chat_reviews  one row per star rating given: kind 'shop' (sku '') or 'product' (sku); pushed_at = on the website

create table if not exists public.review_asks (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  chat_order_id   uuid references public.chat_orders(id) on delete set null,
  conversation_id uuid references public.inbox_conversations(id) on delete set null,
  token           text not null,
  name            text not null default '',
  phone           text not null default '',
  items           jsonb not null default '[]',      -- [{sku, name}] what was bought
  channel_kind    text not null default '',
  asked_at        timestamptz not null default now(),
  opened_at       timestamptz,
  done_at         timestamptz
);
create unique index if not exists review_asks_token_idx on public.review_asks (token);
create unique index if not exists review_asks_order_idx on public.review_asks (chat_order_id);
create index if not exists review_asks_biz_idx on public.review_asks (business_id, asked_at);

create table if not exists public.chat_reviews (
  id           uuid primary key default gen_random_uuid(),
  business_id  uuid not null references public.businesses(id) on delete cascade,
  ask_id       uuid not null references public.review_asks(id) on delete cascade,
  kind         text not null check (kind in ('shop', 'product')),
  sku          text not null default '',
  product_name text not null default '',
  rating       int not null check (rating between 1 and 5),
  text         text not null default '',
  hidden       boolean not null default false,     -- the owner took it off the website (never deleted)
  pushed_at    timestamptz,                        -- null = still to send to the website
  push_error   text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create unique index if not exists chat_reviews_one_idx on public.chat_reviews (ask_id, kind, sku);
create index if not exists chat_reviews_biz_idx on public.chat_reviews (business_id, created_at);
create index if not exists chat_reviews_push_idx on public.chat_reviews (business_id) where pushed_at is null;

do $$
declare t text;
begin
  foreach t in array array['review_asks', 'chat_reviews']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_rw', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
