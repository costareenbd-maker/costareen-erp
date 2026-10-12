-- ============================================================================
-- COSTAREEN ERP - redesign phase 6 (alerts)
-- ----------------------------------------------------------------------------
-- Run AFTER 024. Idempotent.
--
-- Which alerts have already been sent to the owner's WhatsApp, so the same
-- thing is not sent every ten minutes. Server-only: no browser reads it.
-- ============================================================================

create table if not exists public.erp_alert_sent (
  business_id uuid not null references public.businesses(id) on delete cascade,
  key         text not null,
  sent_at     timestamptz not null default now(),
  primary key (business_id, key)
);
alter table public.erp_alert_sent enable row level security;
revoke all on public.erp_alert_sent from anon, authenticated;

-- the sales log is fingerprinted on every call (count + newest change)
create index if not exists invoice_lines_business_idx on public.invoice_lines(business_id);
