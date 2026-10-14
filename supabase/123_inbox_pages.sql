-- 123: the Inbox's public pages (AiPraktor's "order's own page", "product page with Buy", "bill as a picture").
-- A chat order gets a page token (order.html?o=...: its status, the bill, the courier's Track link); a conversation
-- gets a shop token (item.html?c=...&sku=...: a product page opened from that chat - Buy places an order linked to
-- the chat). Steadfast's tracking code is kept with the booking so the Track button can open the courier's page.

alter table public.chat_orders add column if not exists page_token text default md5(random()::text || clock_timestamp()::text || random()::text);
update public.chat_orders set page_token = md5(random()::text || clock_timestamp()::text || id::text) where page_token is null;
create unique index if not exists chat_orders_page_token_idx on public.chat_orders (page_token);

alter table public.inbox_conversations add column if not exists shop_token text default md5(random()::text || clock_timestamp()::text || random()::text);
update public.inbox_conversations set shop_token = md5(random()::text || clock_timestamp()::text || id::text) where shop_token is null;
create unique index if not exists inbox_conv_shop_token_idx on public.inbox_conversations (shop_token);

alter table public.courier_log add column if not exists tracking_code text;
