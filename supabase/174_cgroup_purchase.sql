-- cgroup-2 (owner 11 Nov 2026): customer groups are made only after a purchase (the invoice that started it) and the
-- manager greets every group once (greeted_at).
alter table public.customer_groups add column if not exists invoice_no text;
alter table public.customer_groups add column if not exists greeted_at timestamptz;
