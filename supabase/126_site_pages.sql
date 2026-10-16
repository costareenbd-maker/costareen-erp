-- 126: pages read from the business's own website for the Inbox AI (owner 17 Oct 2026: "connect it with the website so
-- it can read the privacy policy, product descriptions and other things"). Every page is a DRAFT until a person adds it:
-- a policy or other page goes into the knowledge base, a product page becomes that product's description for the AI.

create table if not exists public.site_pages (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  url         text not null,
  title       text,
  kind        text not null default 'page' check (kind in ('policy', 'page', 'product')),
  body        text,
  sku         text,                                   -- the product it was matched to (product pages)
  source      text not null default 'web' check (source in ('web', 'woo', 'shopify')),
  status      text not null default 'draft' check (status in ('draft', 'added', 'skipped')),
  found_at    timestamptz not null default now(),
  decided_by  text,
  decided_at  timestamptz,
  kb_doc      uuid,                                   -- the knowledge-base copy (archived when the page is added again)
  unique (business_id, url)
);

do $$
declare t text;
begin
  foreach t in array array['site_pages']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_rw', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
