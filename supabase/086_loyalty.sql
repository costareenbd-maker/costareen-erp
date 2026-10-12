-- Stage N6 (docs/NETWORK-BLUEPRINT.md section 4, "keep-customers kit"): points and levels per customer, consent for
-- reminders, and a log of reminders sent. Company database (every copy gets it).
create table if not exists public.customer_points (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_key  text not null,                  -- last 10 digits of the phone, else "n:<name>" (lib/phone.js custKey)
  invoice_no    text,                           -- for kind 'order': the paid invoice the points come from
  kind          text not null check (kind in ('order', 'bonus', 'redeem', 'adjust')),
  points        int not null,
  note          text,
  created_by    text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists customer_points_order_idx on public.customer_points(business_id, invoice_no) where kind = 'order';
create index if not exists customer_points_cust_idx on public.customer_points(business_id, customer_key);
alter table public.customer_points enable row level security;
drop policy if exists customer_points_rw on public.customer_points;
create policy customer_points_rw on public.customer_points for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.customer_points to authenticated;

-- plain-words consent before any reminder (Personal Data Protection Ordinance 2025): who said yes, when, how
create table if not exists public.customer_consent (
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_key  text not null,
  reminders     boolean not null default false,
  at            timestamptz,
  by            text,                           -- the staff member, or 'the customer'
  how           text,                           -- 'asked on WhatsApp', 'on the customer page'...
  primary key (business_id, customer_key)
);
alter table public.customer_consent enable row level security;
drop policy if exists customer_consent_rw on public.customer_consent;
create policy customer_consent_rw on public.customer_consent for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.customer_consent to authenticated;

create table if not exists public.reminder_log (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  customer_key  text not null,
  kind          text not null default 'refill',
  note          text,
  sent_by       text,
  sent_at       timestamptz not null default now()
);
create index if not exists reminder_log_idx on public.reminder_log(business_id, customer_key, sent_at desc);
alter table public.reminder_log enable row level security;
drop policy if exists reminder_log_rw on public.reminder_log;
create policy reminder_log_rw on public.reminder_log for all
  using (business_id in (select public.my_business_ids('member')))
  with check (business_id in (select public.my_business_ids('member')));
grant select, insert, update on public.reminder_log to authenticated;
