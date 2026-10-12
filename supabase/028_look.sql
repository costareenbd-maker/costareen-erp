-- ============================================================================
-- COSTAREEN ERP - theme library
-- ----------------------------------------------------------------------------
-- Run AFTER 027. Idempotent.
-- The theme a person picked (name, or their own two colours), kept with their
-- other preferences so it follows them to every device.
-- ============================================================================
alter table public.erp_prefs add column if not exists look text;
