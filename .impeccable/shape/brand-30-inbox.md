# Brand desk: ইনবক্স (brand-30), shape brief

Owner, 14 Nov 2026: one inbox for HIS personal channels inside the Brand desk, independent of every ERP (never reads
or writes ERP inbox data). He is outside on the phone until tonight and gives no keys now, so every channel is built
"ready to switch on with one form or one tap". Same Line Map world (`.impeccable/surfaces/web-app-html.md`), Operate
mode, phone first (390), PC second. Owner gave design authority; no mock round. Assumptions marked (A).

## 1. Job and audience
Owner only, mostly on the phone, a few seconds at a time: "who wrote to me, anywhere?" and "answer them in my voice".
Not a programmer: no IMAP/SMTP words in the main view, setup words only inside the "যুক্ত করুন" forms.

## 2. Outcome and proof
- One list of conversations from every channel, newest first: channel logo, name, last line, time, unread dot.
- Filters as pills: সব / Email / WhatsApp / Telegram / Facebook / Instagram / কমেন্ট (comments has its own platform
  pills: Facebook, Instagram, YouTube). Unread counts on the pills and on the rail badge.
- A thread opens as a chat: their messages left on the second neutral, his replies right in ink. Opening marks read.
- Composer: text, photo, send; "AI দিয়ে উত্তর লিখুন" puts a draft in the box (his voice: voice guide, story bank,
  owner_lessons) - he edits and sends; nothing is ever sent by the AI. "শেষ" (done) hides a thread from the list
  until a new message comes.
- People's own words (messages, names, subjects) are never translated: data-noi18n.
- Networks with no message API (LinkedIn, TikTok, X) appear only in "যুক্ত করুন" with the reason and "app-এ খুলুন".
  YouTube comments come from Listen (other creators' videos where buyers ask) - reply opens YouTube; AI draft works.

## 3. Selected direction
- Line Map world: white ground, ink, 1px rules, #F2F3F5 shelves. Colour only from the network logos, red for errors,
  amber for "waiting for you". Rows on rules, not floating cards.
- PC: list (360 px) left, open thread right inside the main column (a two-pane mail layout). Phone: list, then the
  thread replaces it with a back button; the composer sticks to the bottom of the thread.
- "যুক্ত করুন" is a section of the same page (a pill beside the filters, and the empty state's main button): one row
  per channel with its state word (চালু / ভুল / বাকি) and its form opening inline under it. No modal.

## 4. Scope and boundaries
Bridge (brand-bridge on the Mac): inbox_channels / inbox_threads / inbox_messages; IMAP every minute + SMTP replies
(In-Reply-To kept); Telegram getUpdates (his NEW bot, never Postiz's); WhatsApp on a separate evolution-personal
server (own Postgres, 127.0.0.1 only, webhook to the bridge); Facebook Page + Instagram through Postiz's Meta app
(OAuth connect in one tap, webhook verify + signature). Secrets Fernet-encrypted (INBOX_KEY), never returned.
ERP: ten owner-only proxies. Untouched: ERP inbox tables, business Evolution servers (evolution, evolution2, evo-db),
Chatwoot (off), the live ERP, live websites.
Anti-goals: no auto-send, no translation of people's text, no hero metrics, no modal, no secret ever echoed.

## 5. States and ranges
Channels 0-12 (email 3 now + more). Threads 0-2000 (page shows 60 newest per filter, "আরও" loads more). Messages per
thread 1-500 (newest 80). States: no channel yet (empty state leads to যুক্ত করুন), channel error (red line at the
top of the list naming the channel and the fix), Mac off (desk offline state), sending (spinner), send failed (the
bubble says "যায়নি" with আবার পাঠান), AI drafting (spinner in the button), email test failed (Bangla reason).

## 6. Interaction and layout
44 px targets on phone; the rail entry "ইনবক্স" sits second (after হোম) and in the phone bar (A: 5 entries + আরও fit
at 390). Unread badge amber. Composer Enter = new line, Ctrl+Enter = send on PC. Photo picker resizes in the browser.

## 7. Constraints
Bangla with আপনি, প্রোডাক্ট never পণ্য, no grey hint text beside labels (help lives in the BotFather steps and the
form's own lines under the field group), owner-only handlers in allow.js (reads in ERP_READS + SRV_READS), security.js
words for writes, passwords never in the activity log, tests in supabase/tests/branddesk_test.mjs.
