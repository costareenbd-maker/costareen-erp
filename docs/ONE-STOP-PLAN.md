# One-stop business system: the plan (14 Oct 2026)

Owner's goal: the ERP becomes the one place to run a digital business. Five parts, in this order:

1. **Inbox**: every social media and chat account in one screen; read and reply from the ERP.
2. **AI marketing**: market research, which product to push and how, videos made by the ERP, posted to social
   media from the ERP after the owner says yes.
3. **Leads**: suggested suppliers and buyers.
4. **Watcher**: an agent that checks the website and the whole system again and again and says when something is wrong.

Everything new ships **owner-only** first (the "Only me" app flag, as since 8 Oct), on the dev copy first, then live
on the owner's yes. Nothing that costs money is switched on without his yes.

---

## What already exists (built on, not rebuilt)

| Already in the ERP | Used for |
|---|---|
| Customers (phone = key), invoices, quotations, pre-orders, dues | the customer card next to every chat; "make an invoice from this chat" |
| Assistant (Gemini, reads the ERP through the same role checks, writes only after a yes) | AI reply drafts in the inbox; the brain of the marketing and leads parts |
| Campaigns > What to push next (push.js) | the start of "which product to market" |
| Campaigns > Advertisement (post drafts, Improve with AI, en/bn/Banglish) | captions for posts and videos |
| Creators (influencer tracker, YouTube numbers) | part of the marketing plan |
| Market / Find stock / Wanted (the network of shops on this platform) | first source of buyer and supplier leads |
| System check, nightly jobs, error log, backup log, courier and website-sync checks | the watcher's eyes |
| Product photos, colour data, price list | the material for videos |

---

## Part 1 – Inbox (the next target)

**One screen "Inbox"**: all conversations from every channel, newest first; unread count in the menu; filter by
channel / unread / mine / waiting. Each conversation: the messages, a reply box (text, photo, product card with price
and stock, quick replies), and on the right the **customer card** (matched by phone or by the channel's id: name,
dues, last orders, notes) with buttons **New invoice**, **New quotation**, **Pre-order**, **Follow-up**.
Assign a chat to a staff member; mark done; internal notes the customer never sees. Every reply is written to the
activity log with who sent it.

**AI in the inbox**: "Draft a reply" (uses stock, prices, order status, delivery rules – reads only); later
"answer the easy ones by itself" (price / stock / order status / shop hours) only after the owner switches it on,
always with a human take-over.

**Channels, in order of how soon they can work:**

| Channel | What is needed | Can start |
|---|---|---|
| Website chat (a chat bubble on costareen.com) | nothing – we build it | at once |
| Telegram | a free bot from @BotFather | at once |
| E-mail (shop Gmail) | Google link already exists in the ERP | soon |
| Facebook Page Messenger | a Meta developer app made by the owner, then Meta's **App Review** and **Business Verification** for messaging customers who are not testers | built at once; real customers once Meta approves (days to weeks) |
| Instagram DMs (business account linked to the Page) | same Meta app and review | same |
| WhatsApp Business | WhatsApp Cloud API on the same Meta business; a phone number for it (the shop number can move, or a second number) | after Meta; replies within 24 h of the customer's message are free; messages the shop starts later are paid templates |
| TikTok messages | no dependable open access for Bangladesh today | later, if TikTok opens it |
| Daraz / marketplace chats | no open access | not planned |

Meta's rule to know: a reply is allowed within **24 hours** of the customer's last message (Messenger/Instagram
allow a human agent up to 7 days with a tag). The inbox shows the time left on each chat.

How it works inside: one table of channels (keys kept like the other secrets), conversations, messages; each
channel sends its messages to the ERP server (webhooks) and the ERP sends replies through that channel's API. Photos
are stored with the business's files. Nothing is deleted.

**Stages**
- **1a**: Inbox screen, conversations, customer card, assign / done / notes, quick replies; website chat bubble; Telegram.
- **1b**: Facebook Messenger + Instagram (owner makes the Meta app; ERP has the "Connect your Page" button).
- **1c**: WhatsApp Cloud API.
- **1d**: AI reply drafts; "answer the easy ones" switch.

## Part 2 – AI marketing

- **Market research report** (weekly or on request): our own sales, margins, stock age and returns + what the AI
  can read on the open web about demand, prices and what sells in Bangladesh → "push these 5 products, this way,
  on these channels, this budget, this week", with the reasons.
- **The playbook / skills**: for each suggestion, the steps and the skill it needs (shoot a reel, boost a post,
  Marketplace listing, creator video) – who on the team does it, or which creator.
- **Videos**: first **template videos** made from our product photos, prices and captions (made on our own server,
  no cost per video); later AI-generated video (costs per second of video – only with the owner's yes and a monthly limit).
- **Post from the ERP**: the ERP shows the video and caption, the owner presses **Post**, and it goes to the
  Facebook Page and Instagram (and YouTube / TikTok when their approvals are in) without opening those apps.
  Needs the same Meta app with publishing permission; YouTube and TikTok need their own app approval or the post
  stays private until then.
- Results come back into the ERP: reach, messages and sales from each post (sales by the post's code, as Creators does).

## Part 3 – Leads

- **Buyers**: shops and companies that could buy wholesale (our own Market network first; then public business
  listings such as Google Maps, which is free up to a monthly limit), scored by fit, with a "why".
- **Suppliers**: makers and wholesalers for the products we sell or should sell (from our cost book, what customers
  ask for and do not find, Wanted lists; then the open web), with contact routes.
- Each lead goes into a small pipeline: new → contacted → replied → deal, linked to Inbox chats and quotations.
- No scraping of sites that forbid it; no buying of contact lists.

## Part 4 – The watcher

- Every few minutes: the website and the ERP answer? checkout works? the website ↔ ERP stock sync ran? courier check
  ran? backups made? errors in the last hour?
- Every night: System check of the books, stock mismatches, unpaid dues getting old, products without cost, failed jobs.
- Tells the owner at once when something is wrong (ERP bell + push to the phone + Telegram), with what to do; a
  daily "all good" line; the AI explains a problem in plain words and suggests the fix. It never changes the books on its own.

---

## What only the owner can do (needed along the way)

1. **Meta**: create the developer app with his Facebook account, verify the business, submit App Review (the ERP
   prepares the texts and the screen recordings Meta asks for). Needed for Messenger, Instagram, WhatsApp and posting.
2. **WhatsApp number**: which number becomes the WhatsApp Business API number.
3. **AI key** for the ERP (Gemini has a free tier; paid only if he chooses).
4. **Telegram**: make the bot (2 minutes) – or the ERP shows him the steps.
5. **Money**: any paid service (AI video, WhatsApp templates, Google Maps beyond the free limit) – his yes and a limit first.
