-- Joint stock: a sale an owner made under the floor price is flagged for the partner.
alter table public.joint_sales add column if not exists below_floor numeric(14,2) not null default 0;
