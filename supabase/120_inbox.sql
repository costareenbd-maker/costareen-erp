-- 120: the Inbox (owner 14 Oct 2026: "build everything as AiPraktor has built" - docs/ONE-STOP-PLAN.md).
-- Every chat channel of the business in one place, answered by an AI agent from the ERP's own products, prices,
-- stock and rules, handed to a person when one is needed, with leads, chat orders (which become real invoices when
-- the team approves them), follow-ups, broadcasts, comments, the Agent Desk (rules as drafts, tested, published,
-- undone), a knowledge base, saved replies and a log of every AI action and what it cost.
--
-- Channels: messenger, instagram (Meta Graph API), wa_cloud (WhatsApp's official Cloud API), wa_evo (a WhatsApp
-- number linked as a device through the business's own Evolution API server - NOT official, a number can be banned),
-- wa_sender (the same through WaSenderAPI, a paid service - NOT official), webchat (the chat bubble on the business's
-- own website). Keys live in business_secrets (encrypted), never in these tables. Nothing here is deleted: a channel is
-- removed (status 'removed'), a document archived, a lead lost, an order cancelled with a reason.

create table if not exists public.inbox_channels (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  kind          text not null check (kind in ('messenger', 'instagram', 'wa_cloud', 'wa_evo', 'wa_sender', 'webchat')),
  name          text not null,
  external_id   text,                              -- page id / instagram account id / phone number id / instance / site
  hook_key      text not null default md5(random()::text || clock_timestamp()::text || random()::text),   -- in the webhook address; a guess gets nowhere
  status        text not null default 'setup' check (status in ('setup', 'practice', 'live', 'removed')),
  ai_on         boolean not null default true,     -- the AI answers on this channel (comments have their own switch)
  ai_off_until  timestamptz,                       -- switched off for a time
  comments_ai   boolean not null default true,
  settings      jsonb not null default '{}'::jsonb, -- wait_s, revert_min, website colour / logo / daily cap, test code...
  created_by    text,
  created_at    timestamptz not null default now(),
  unique (business_id, kind, external_id)
);

create table if not exists public.inbox_contacts (
  id            uuid primary key default gen_random_uuid(),
  business_id   uuid not null references public.businesses(id) on delete cascade,
  channel_id    uuid not null references public.inbox_channels(id) on delete cascade,
  external_id   text not null,                     -- PSID / IGSID / WhatsApp number / website visitor id
  name          text,
  avatar        text,
  phone         text,
  customer_key  text,                              -- joins the ERP customer (last 10 digits of the phone, or n:<name>)
  gender        text check (gender in ('m', 'f')),
  lang          text check (lang in ('bn', 'en')),
  tags          text[] not null default '{}',
  note          text,
  created_at    timestamptz not null default now(),
  unique (channel_id, external_id)
);

create table if not exists public.inbox_conversations (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  channel_id      uuid not null references public.inbox_channels(id) on delete cascade,
  contact_id      uuid not null references public.inbox_contacts(id) on delete cascade,
  mode            text not null default 'ai' check (mode in ('ai', 'human')),
  human_until     timestamptz,                     -- null with mode human = held for good
  claimed_by      uuid,
  claimed_name    text,
  handover_reason text check (handover_reason in ('discount', 'complaint', 'refund', 'person', 'unknown', 'angry', 'ready', 'abuse', 'other')),
  handover_note   text,
  handover_at     timestamptz,
  pile            text not null default 'open' check (pile in ('open', 'later', 'done')),
  interest        text not null default 'cold' check (interest in ('cold', 'warm', 'hot')),
  followups_left  int not null default 0,
  next_followup   timestamptz,
  ordered         boolean not null default false,
  last_in_at      timestamptz,                     -- the customer's last message: Meta's 24-hour window
  last_out_at     timestamptz,
  last_at         timestamptz not null default now(),
  last_text       text,
  unread          int not null default 0,
  first_reply_s   int,                             -- seconds to the first reply (analytics)
  ai_replies      int not null default 0,
  team_replies    int not null default 0,
  reply_due_at    timestamptz,                     -- the AI answers at this moment (the wait that joins quick messages)
  is_test         boolean not null default false,  -- practice chats from the Agent Desk / 'test <code>'
  created_at      timestamptz not null default now(),
  unique (contact_id)
);

create table if not exists public.inbox_messages (
  id              bigint generated always as identity primary key,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  direction       text not null check (direction in ('in', 'out', 'note')),
  author          text not null check (author in ('customer', 'ai', 'team', 'system')),
  user_id         uuid,
  user_name       text,
  kind            text not null default 'text' check (kind in ('text', 'image', 'audio', 'video', 'file', 'cards', 'buttons', 'comment', 'event', 'order', 'rating')),
  text            text,
  media           text,                            -- stored file name (folder 'inbox') or a URL
  transcript      text,                            -- a voice note in words
  seen_as         text,                            -- a photo: what the AI saw
  payload         jsonb,                           -- cards, buttons, order id...
  external_id     text,                            -- the platform's message id
  status          text not null default 'sent' check (status in ('queued', 'sent', 'failed', 'received')),
  error           text,
  created_at      timestamptz not null default now()
);

create table if not exists public.inbox_tasks (
  id              bigint generated always as identity primary key,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  conversation_id uuid references public.inbox_conversations(id) on delete cascade,
  kind            text not null check (kind in ('handover', 'alert', 'order', 'payment', 'enquiry', 'comment', 'change')),
  reason          text,
  text            text,
  status          text not null default 'open' check (status in ('open', 'done')),
  never_answered  boolean not null default false,
  created_at      timestamptz not null default now(),
  done_by         text,
  done_at         timestamptz
);

create table if not exists public.inbox_leads (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  contact_id      uuid references public.inbox_contacts(id) on delete set null,
  conversation_id uuid references public.inbox_conversations(id) on delete set null,
  name            text,
  phone           text,
  email           text,
  want            text,
  stage           int not null default 1 check (stage between 1 and 6),   -- new, contacted, interested, quoted, won, lost
  value           numeric(14,2),
  priority        text check (priority in ('low', 'normal', 'high')),
  intent          text,
  source          text,                            -- ai / team / comment / website
  channel         text,
  assigned_to     uuid,
  assigned_name   text,
  follow_up_on    date,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create table if not exists public.inbox_lead_events (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  lead_id     uuid not null references public.inbox_leads(id) on delete cascade,
  what        text not null,
  by_name     text,
  at          timestamptz not null default now()
);

-- an order taken in a chat; Approved turns it into a real invoice (stock, dues, courier...) and from then on the
-- invoice is the record. Nothing is deleted: cancelled with a reason.
create table if not exists public.chat_orders (
  id              uuid primary key default gen_random_uuid(),
  business_id     uuid not null references public.businesses(id) on delete cascade,
  no              text not null,
  conversation_id uuid references public.inbox_conversations(id) on delete set null,
  name            text not null,
  phone           text not null,
  address         text not null,
  items           jsonb not null,                  -- [{sku, name, qty, price}]
  delivery_charge numeric(14,2) not null default 0,
  delivery_said   numeric(14,2),                   -- what the AI said in the chat, when it differs
  note            text,
  status          text not null default 'pending' check (status in ('pending', 'hold', 'approved', 'cancelled')),
  hold_reason     text,
  follow_up_on    date,
  cancel_reason   text,
  invoice_no      text,
  taken_by        text not null default 'ai',      -- ai / team / product page / website
  change_request  text,
  rating          int check (rating between 1 and 5),
  review_asked_at timestamptz,
  notified_status text,                            -- the last delivery update told to the customer
  created_at      timestamptz not null default now(),
  approved_at     timestamptz,
  unique (business_id, no)
);
create table if not exists public.chat_order_events (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  order_id    uuid not null references public.chat_orders(id) on delete cascade,
  what        text not null,
  by_name     text,
  at          timestamptz not null default now()
);

-- the Agent Desk: the business's own instructions to the AI, each a line of versions (a draft is version null)
create table if not exists public.agent_rules (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title       text not null,
  body        text not null,
  enabled     boolean not null default true,
  draft       text,                                -- an unpublished change
  version     int not null default 1,
  archived    boolean not null default false,
  updated_by  text,
  updated_at  timestamptz not null default now()
);
create table if not exists public.agent_rule_versions (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  rule_id     uuid not null references public.agent_rules(id) on delete cascade,
  version     int not null,
  body        text not null,
  by_name     text,
  at          timestamptz not null default now()
);

create table if not exists public.kb_docs (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title       text not null,
  kind        text not null default 'text' check (kind in ('text', 'qa', 'file')),
  body        text not null,
  archived    boolean not null default false,
  created_by  text,
  created_at  timestamptz not null default now()
);
create table if not exists public.kb_chunks (
  id          bigint generated always as identity primary key,
  business_id uuid not null references public.businesses(id) on delete cascade,
  doc_id      uuid not null references public.kb_docs(id) on delete cascade,
  text        text not null,
  tsv         tsvector generated always as (to_tsvector('simple', text)) stored
);

create table if not exists public.shop_offers (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  label       text not null,
  sku         text,                                -- null: the whole shop
  detail      text,
  starts_on   date,
  ends_on     date,
  active      boolean not null default true,
  created_at  timestamptz not null default now()
);

create table if not exists public.inbox_broadcasts (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  text        text not null,
  tested_text text,                                -- the text last sent as a test (sending needs tested_text = text)
  tested_at   timestamptz,
  sent_at     timestamptz,
  sent_count  int not null default 0,
  created_by  text,
  created_at  timestamptz not null default now()
);
create table if not exists public.inbox_broadcast_sends (
  id              bigint generated always as identity primary key,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  broadcast_id    uuid not null references public.inbox_broadcasts(id) on delete cascade,
  conversation_id uuid not null references public.inbox_conversations(id) on delete cascade,
  at              timestamptz not null default now()
);

create table if not exists public.saved_replies (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  title       text not null,
  body        text not null,
  archived    boolean not null default false,
  created_at  timestamptz not null default now()
);

create table if not exists public.inbox_comments (
  id          uuid primary key default gen_random_uuid(),
  business_id uuid not null references public.businesses(id) on delete cascade,
  channel_id  uuid not null references public.inbox_channels(id) on delete cascade,
  post_id     text,
  comment_id  text not null,
  from_id     text,
  from_name   text,
  text        text,
  ai_reply    text,
  action      text check (action in ('replied', 'hidden', 'deleted', 'ignored', 'blocked')),
  by_name     text,
  created_at  timestamptz not null default now(),
  unique (channel_id, comment_id)
);

-- every piece of AI work and what it cost (tokens, the model, an estimate in taka)
create table if not exists public.ai_work (
  id              bigint generated always as identity primary key,
  business_id     uuid not null references public.businesses(id) on delete cascade,
  at              timestamptz not null default now(),
  purpose         text not null,                   -- reply, photo, voice, summary, draft, followup, test, kb, comment...
  conversation_id uuid,
  model           text,
  tokens_in       int not null default 0,
  tokens_out      int not null default 0,
  cost_bdt        numeric(12,4) not null default 0
);

create index if not exists inbox_conv_idx on public.inbox_conversations (business_id, pile, last_at desc);
create index if not exists inbox_conv_due_idx on public.inbox_conversations (reply_due_at) where reply_due_at is not null;
create index if not exists inbox_msg_idx on public.inbox_messages (conversation_id, id);
create index if not exists inbox_msg_ext_idx on public.inbox_messages (business_id, external_id);
create index if not exists inbox_task_idx on public.inbox_tasks (business_id, status, created_at);
create index if not exists inbox_lead_idx on public.inbox_leads (business_id, stage, follow_up_on);
create index if not exists chat_orders_idx on public.chat_orders (business_id, status, created_at);
create index if not exists kb_chunks_tsv on public.kb_chunks using gin (tsv);
create index if not exists ai_work_idx on public.ai_work (business_id, at);

do $$
declare t text;
begin
  foreach t in array array['inbox_channels', 'inbox_contacts', 'inbox_conversations', 'inbox_messages', 'inbox_tasks', 'inbox_leads',
                           'inbox_lead_events', 'chat_orders', 'chat_order_events', 'agent_rules', 'agent_rule_versions', 'kb_docs',
                           'kb_chunks', 'shop_offers', 'inbox_broadcasts', 'inbox_broadcast_sends', 'saved_replies', 'inbox_comments', 'ai_work']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_rw', t);
    execute format('create policy %I on public.%I for all to authenticated using (business_id in (select public.my_business_ids(''member''))) with check (business_id in (select public.my_business_ids(''member'')))', t || '_rw', t);
    execute format('grant select, insert, update on public.%I to authenticated', t);
  end loop;
end $$;
