-- control-only (the installer never copies this file into a company's database)
-- Stage N5b (docs/NETWORK-BLUEPRINT.md section 4.1 "Colour Finder" / "Help me choose"): a shop may set a swatch
-- (sRGB hex) for each colour name it uses; the market listing carries it so the Colour Finder can compare a
-- photographed colour with what is in stock. Still no SKU, cost or stock number on a listing.
alter table public.erp_market_listings add column if not exists color_hex text;
