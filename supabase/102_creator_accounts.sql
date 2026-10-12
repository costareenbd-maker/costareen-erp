-- Creator accounts (handlers/creatorportal.js): a creator joins by himself with name, e-mail and phone, chooses a
-- password from the e-mailed link (Supabase Auth, the same mailer the ERP's own sign-in uses), fills his profile,
-- and waits for the owner to switch him to active. The programme's join link carries only a code, no company name.
alter table public.erp_creators add column if not exists user_id uuid;                 -- auth.users id once he has a login
alter table public.erp_creators add column if not exists email text;
alter table public.erp_creators add column if not exists links text;                   -- channel / page / group links
alter table public.erp_creators add column if not exists niche text;
alter table public.erp_creators add column if not exists city text;
alter table public.erp_creators add column if not exists about text;                   -- his audience in his words
alter table public.erp_creators add column if not exists applied_at timestamptz;
alter table public.erp_creators add column if not exists profile_at timestamptz;       -- when he last saved his profile
create unique index if not exists erp_creators_user_idx on public.erp_creators(user_id) where user_id is not null;
create index if not exists erp_creators_email_idx on public.erp_creators(business_id, lower(email));
