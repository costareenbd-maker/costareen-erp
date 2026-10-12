-- Plan D3 (first half): a photo per product.
--   photo  the stored file's name (the full picture, opened on demand)
--   thumb  a tiny JPEG as a data: URL, made by the browser, small enough to
--          travel with lists (a few KB) - so no link has to be signed per row
alter table public.products add column if not exists photo text;
alter table public.products add column if not exists thumb text;
