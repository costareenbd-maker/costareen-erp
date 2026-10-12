-- Run once on the live project (not part of the local test migrations:
-- the throwaway test database has no storage schema).
-- One private bucket for every business's files: invoices, logos, exports,
-- backups. Paths are <business id>/<folder>/<name>; only the Edge Function
-- (service role) reads or writes it, and hands the page signed links.
insert into storage.buckets (id, name, public)
values ('erp-files', 'erp-files', false)
on conflict (id) do nothing;
