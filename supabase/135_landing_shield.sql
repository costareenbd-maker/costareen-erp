-- Order landing pages, unfinished orders and the fake-order shield (owner 20 Oct 2026, after looking at Bizmation:
-- "make improvement"). Inside the Inbox (owner-only app), handlers/landing.js; the public page is web/land.html.
--   landing_pages    one product's page for an ad: headline, selling points, offer price; its own link (token)
--   landing_drafts   a visitor who typed a phone number on the order form but did not send it (to call back)
--   order_blocks     phone numbers / internet addresses that may not order (fake or abusive buyers)
--   chat_orders      + risk (the shield's reading), landing_id, ip

create table if not exists public.landing_pages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  token       text not null default md5(random()::text || clock_timestamp()::text || random()::text),
  sku         text not null,
  headline    text,
  points      jsonb not null default '[]'::jsonb,   -- selling points, one line each
  offer_price numeric(14,2),                        -- null = the product's own price
  colour      text,
  active      boolean not null default true,
  views       int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create unique index if not exists landing_pages_token_idx on public.landing_pages (token);
create index if not exists landing_pages_biz_idx on public.landing_pages (business_id, created_at desc);

create table if not exists public.landing_drafts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  page_id     uuid not null references public.landing_pages(id) on delete cascade,
  visitor     text not null,                        -- the browser's own random id
  name        text,
  phone       text not null,
  address     text,
  qty         int not null default 1,
  area        text,
  ip          text,
  status      text not null default 'open' check (status in ('open', 'called', 'ordered', 'dismissed')),
  order_no    text,
  note        text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (page_id, visitor)
);
create index if not exists landing_drafts_biz_idx on public.landing_drafts (business_id, status, updated_at desc);

create table if not exists public.order_blocks (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  kind        text not null check (kind in ('phone', 'ip')),
  value       text not null,
  reason      text,
  created_by  text,
  created_at  timestamptz not null default now(),
  unique (business_id, kind, value)
);

alter table public.chat_orders add column if not exists risk jsonb;
alter table public.chat_orders add column if not exists landing_id uuid references public.landing_pages(id) on delete set null;
alter table public.chat_orders add column if not exists ip text;

do $$
declare t text;
begin
  foreach t in array array['landing_pages', 'landing_drafts', 'order_blocks']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_rw', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
