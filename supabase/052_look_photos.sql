-- ui-6: a person's photo (small, kept with them), and switching the business's background photo off for oneself.
alter table public.profiles  add column if not exists avatar text;          -- data:image/...;base64, about 128 px
alter table public.erp_prefs add column if not exists bg_off boolean not null default false;
