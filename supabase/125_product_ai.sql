-- 125: what the Inbox AI may say about each product (owner 17 Oct 2026: "the AI must know our products"), and the
-- prices it agreed in a chat within the owner's limits.
--   product_ai          a description and the details customers ask about (material, shade, size, ingredients...);
--                       which details a business keeps is its own list (business_config 'product_fields').
--   inbox_conversations.agreed   {sku: price} a price the AI agreed inside the limits, used when it places the order.

create table if not exists public.product_ai (
  business_id uuid not null references public.businesses(id) on delete cascade,
  sku         text not null,
  description text,
  facts       jsonb not null default '{}'::jsonb,     -- field key -> value
  updated_by  text,
  updated_at  timestamptz not null default now(),
  primary key (business_id, sku)
);

alter table public.inbox_conversations add column if not exists agreed jsonb not null default '{}'::jsonb;

do $$
declare t text;
begin
  foreach t in array array['product_ai']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_rw', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
