-- 118: the FilaDash look a person chose (theme, accent colour, chart colours, text size, density, corners) and their
-- dashboard layout (which cards, in which order), kept with their other preferences so it follows them to every device.
-- Written only by erpSetFdPrefs, which accepts known keys and colour codes only.
alter table public.erp_prefs add column if not exists fd jsonb;
