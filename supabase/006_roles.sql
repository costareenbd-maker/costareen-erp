-- ============================================================================
-- COSTAREEN ERP - the four roles of the sheet ERP
-- ----------------------------------------------------------------------------
-- Run AFTER 005_partnership.sql, and ON ITS OWN: Postgres cannot use an enum
-- value in the same transaction that adds it, and 007 uses these.
--
-- The sheet ERP ranks people sales 1 < manager 2 < shareholder 3 < owner 4
-- (ERP.js:3971). 001 had owner/manager/staff; `staff` stays as a synonym of
-- `sales` so existing memberships keep working.
-- ============================================================================

alter type public.member_role add value if not exists 'shareholder';
alter type public.member_role add value if not exists 'sales';

-- Stock movement types the sheet's TXN_LOG uses that 001 did not have.
alter type public.movement_kind add value if not exists 'DAMAGE';
alter type public.movement_kind add value if not exists 'ADJUSTMENT';
