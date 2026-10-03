-- installer-3: "Connect Supabase" (OAuth) instead of pasting a token.
create table if not exists public.erp_install_oauth (
  state       text primary key,
  invite      text not null,            -- the install link's code, to send the person back to the same page
  verifier    text not null,            -- PKCE
  access      text,
  refresh     text,
  expires_at  timestamptz,
  made_at     timestamptz not null default now()
);
alter table public.erp_install_oauth enable row level security;
revoke all on public.erp_install_oauth from anon, authenticated;

alter table public.erp_installs add column if not exists mgmt_kind     text not null default 'pat';   -- pat | oauth
alter table public.erp_installs add column if not exists oauth_refresh text;
alter table public.erp_installs add column if not exists oauth_expires timestamptz;
alter table public.erp_installs add column if not exists website       text;                          -- the company's own website domain, if any
alter table public.erp_installs add column if not exists domain_state  text;                          -- waiting | seen | ready
