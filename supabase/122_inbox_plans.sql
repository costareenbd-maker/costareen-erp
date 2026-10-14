-- 122: the Inbox as a subscription product. The provider (platform admin) sets, business by business, which Inbox
-- features its plan includes and a monthly AI budget in taka; the business's owner switches the included features on
-- or off for his own business (business_config 'inbox_features'). A feature runs only when the plan includes it AND
-- the owner has it on. Written by the server only (platform admin through the server pool), read by the business.

create table if not exists public.inbox_plans (
  business_id   uuid primary key references public.businesses(id) on delete cascade,
  plan_name     text,
  features      jsonb not null default '{}'::jsonb,      -- {key: false} = not in the plan; a missing key = included
  ai_budget_bdt numeric(12,2),                          -- per Dhaka calendar month; null = no limit
  set_by        uuid,
  set_at        timestamptz not null default now()
);
alter table public.inbox_plans enable row level security;
drop policy if exists inbox_plans_read on public.inbox_plans;
create policy inbox_plans_read on public.inbox_plans for select to authenticated using (business_id in (select public.my_business_ids('member')));
grant select on public.inbox_plans to authenticated;
