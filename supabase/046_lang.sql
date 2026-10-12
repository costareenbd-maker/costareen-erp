-- Each person's screen language (English / Bangla), kept with their other preferences.
alter table public.erp_prefs add column if not exists lang text;
