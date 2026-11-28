-- clinic-rx (owner 29 Nov 2026): prescriptions in the Doctor desk, made like a sales invoice. The pad follows the two
-- prescriptions Raj sent (Oliareen logo, the doctor's name and degrees, patient line, concerns / history / findings /
-- diagnosis, a table of recommended products, medicines, advice, follow-up, signature). A finished prescription is
-- locked and kept as a PDF; a correction strikes it out and starts the next version. Nothing is deleted.
create table if not exists public.clinic_prescriptions (
  id            bigserial primary key,
  business_id   uuid not null references public.businesses(id) on delete cascade,
  no            text not null,                       -- O-28-0001: the business letter, the day, that day's number
  version       int not null default 1,
  consult_id    bigint references public.clinic_consults(id),
  patient_id    bigint not null references public.clinic_patients(id),
  doctor_id     bigint not null references public.clinic_doctors(id),
  rx_date       date not null,
  data          jsonb not null default '{}'::jsonb,  -- concerns, history, findings, diagnosis, products[], medicines[], advice[], follow_up, review
  state         text not null default 'draft' check (state in ('draft', 'final', 'struck')),
  final_at      timestamptz,
  struck_at     timestamptz,
  struck_reason text not null default '',
  pdf_path      text not null default '',
  sent_at       timestamptz,
  created_by    text not null default '',
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create unique index if not exists clinic_rx_no_idx on public.clinic_prescriptions (business_id, no, version);
create index if not exists clinic_rx_p_idx on public.clinic_prescriptions (patient_id, rx_date desc);
create index if not exists clinic_rx_c_idx on public.clinic_prescriptions (consult_id);

do $$
begin
  alter table public.clinic_prescriptions enable row level security;
  drop policy if exists clinic_prescriptions_read on public.clinic_prescriptions;
  create policy clinic_prescriptions_read on public.clinic_prescriptions for select to authenticated using (business_id in (select public.my_business_ids('manager')));
  drop policy if exists clinic_prescriptions_ins on public.clinic_prescriptions;
  create policy clinic_prescriptions_ins on public.clinic_prescriptions for insert to authenticated with check (business_id in (select public.my_business_ids('manager')));
  drop policy if exists clinic_prescriptions_upd on public.clinic_prescriptions;
  create policy clinic_prescriptions_upd on public.clinic_prescriptions for update to authenticated using (business_id in (select public.my_business_ids('manager'))) with check (business_id in (select public.my_business_ids('manager')));
  grant select, insert, update on public.clinic_prescriptions to authenticated;
  grant usage, select on sequence public.clinic_prescriptions_id_seq to authenticated;
end $$;
