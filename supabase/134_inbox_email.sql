-- The Inbox's e-mail channel (owner 20 Oct 2026: "I also want to connect the email"). A mailbox is read every minute
-- (IMAP) and answered by e-mail (SMTP over SSL); handlers/inboxmail.js, lib/mail.js. Only the channel kind is new:
-- the address is the channel's external_id, the servers sit in settings, the app password is a sealed secret.

do $$
declare c text;
begin
  for c in select conname from pg_constraint
           where conrelid = 'public.inbox_channels'::regclass and contype = 'c' and pg_get_constraintdef(oid) like '%kind%'
  loop
    execute 'alter table public.inbox_channels drop constraint ' || quote_ident(c);
  end loop;
end $$;
alter table public.inbox_channels add constraint inbox_channels_kind_check
  check (kind in ('messenger', 'instagram', 'wa_cloud', 'wa_evo', 'wa_sender', 'webchat', 'email'));
