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

### Lessons from AiPraktor (aipraktor.com, reviewed 14 Oct 2026)

A Bangladeshi AI agent for Messenger, Instagram, WhatsApp and Facebook comments (pay per reply, 5-20 paisa). It is
only our Part 1, but a good one. What we take, and what we do better because we are the ERP:

| Their feature | In our Inbox |
|---|---|
| The AI **answers by itself** 24/7, from the catalogue only, never invents a price | Same, from the ERP's live products, prices, stock and delivery rules (not a copied catalogue) |
| Asks what you want first, then **product cards / carousel** with price, code and buttons | Same, with our photos, colours and stock |
| **Photo → product**: code, exact photo, look-alike; if unsure shows the closest 3 and asks | Same, plus our colour data (Colour Finder) for filament colours |
| **Voice notes** understood; Banglish understood, answers in Bangla | Same (the AI reads audio) |
| **Order taken in chat** → receipt | Better: becomes a real ERP invoice (stock, dues, commission, courier) after the customer confirms |
| **Courier updates** sent into the chat (Steadfast, Pathao) with a track button; **review request** after delivery | Same: we already track Steadfast parcels |
| **Follow-up** once inside Meta's 24 h window, hot / warm chosen by the owner | Same, tied to our Follow-ups |
| **Broadcast** an offer to everyone who wrote in the last 23 h (inside the 24 h rule) | Same |
| **Comment replies** by name on Page posts + a private message to the inbox | Same |
| **Human hand-over**: the AI calls the team for a complaint, refund or special request and writes why; push to the phone; one tap "Claim"; waiting timer; the chat goes back to the AI after 1 h / 4 h / never; "." from Messenger takes it over | Same; plus the ERP bell and the customer's dues and orders right there |
| **Customer timeline + AI helper**: summary, "what did he buy before?", next reply drafted, "make a lead" | Same, with the full ERP history (invoices, returns, warranty, points) |
| Inbox sorted by **who waited longest**; alerts stay until someone closes them | Same |
| **Agent desk**: teach the AI in plain words ("delivery charge 80"), it shows the current value, tests it in a customer's-phone view, goes live only on "yes", one click back to the old version | Same - and where the answer is an ERP setting (delivery charge), it changes the setting itself |
| **Knowledge base**: answers from your own documents (return policy...) | Same |
| **Analytics**: how much the AI handled, how fast the team answered, why people were handed over | Same |
| Team roles per page; phone app with notifications; keys encrypted; nightly encrypted backups | We have roles, the phone layout, encrypted secrets and nightly backups already |
| Bookings for service businesses (bKash advance + TrxID, reminders) | Later, for other companies on the platform |

Watch out:
- Their one-click "connect your Page" works because their Meta app is approved. Ours needs its own App Review.
- WhatsApp "scan the QR code, the phone keeps working": checked in their help centre - it IS a WhatsApp-Web style
  linked device through a third party, not Meta's API; a number can be banned. We use the official API only.
- An AI that answers by itself must be grounded: it only says prices, stock and rules the ERP gives it, and hands
  over when unsure. Every auto-sent message is in the log.

### AiPraktor in detail (help centre: 120 answers, read 14 Oct 2026) - the checklist we build against

**Correction to the first review:** their WhatsApp is NOT Meta's official system. It is a linked device like
WhatsApp Web, through a third party (WaSenderAPI); they say themselves the number can be banned for good, and they
send no broadcasts or reminders on WhatsApp because of it. We use the official WhatsApp Cloud API only.

How the agent talks
- Waits ~15 s before answering so two quick messages get one reply (owner can set 0-15 s; website chat 3 s).
- Sends "Seen" a few seconds after a message, then "typing…".
- Speaks as "we", one of the team; does not say it is an AI unless asked, never denies it when asked; the website
  chat window says it is an AI assistant.
- Calls the customer sir / madam or bhaiya / apu (owner's choice), with or without the first name; guesses from the
  Facebook profile or a list of Bangladeshi names; male if unknown.
- Keeps the language the customer started in; Banglish is answered in Bangla script; owner picks Bangla / English / both.
- Owner sets the tone (formal or friendly, which emoji, what never to say); the platform keeps replies short.
- Never invents a price, discount, stock, delivery date or rule; no haggling; offers only from a "Special offers"
  list (product, dates, name); no price on record → hand over.
- A missing fact is not a hand-over: it answers what it knows, says the rest is not written, offers to ask the team.
- Hand-over reasons from a fixed list: asked for a discount, complaint, refund, wants a person, out of scope, angry,
  ready to buy, other; repeated abuse.
- Remembers the customer's recent history across days (not the whole history); each channel is a separate person.
- Stock: says "in stock / out of stock", never the count.
- Suggests up to 10 products after asking what kind; one extra offer before the order; stops pushing once the customer chose.
- Photo → product: code in the picture, then near-copy of one of our photos, then look-alike; names it only on a strong
  match, otherwise the 10 closest, best first; says so when the item is not ours and shows similar ones.
  Products must be "prepared" (indexed) first, which costs AI credit.
- Voice notes turned into text; warns that spoken phone numbers and addresses can be misheard (staff check before sending).
- Does not read customers' videos or documents.

Orders from the chat
- Asks name, phone and full address in one message; then makes a cash-on-delivery order without asking again
  (giving the details is the consent; a button press alone is not an order).
- The order goes in as Pending for the team to approve; the customer gets the product card, the bill as a picture,
  a link to the order's own page, a thank-you with the order number and a 1-5 star rating request.
- Until the team approves, the customer can change or cancel in the chat by himself; after that the AI only writes it
  down and hands over.
- Delivery charge: inside / outside Dhaka from the address (Savar, Keraniganj, Tongi count as outside); if the AI said
  another figure, that stays and the difference is written in the history.
- No payments in chat; never asks for card, OTP or password; gives the bKash / Nagad number; staff record the payment
  with its transaction id (an id can be used once; payments are never deleted, only cancelled with a reason; screenshot
  can be attached); the AI never says money was received.
- Stages: Pending → On hold (reason: not reachable, waiting for advance, pre-order, out of stock, customer asked to
  wait, check address; a follow-up date) → Approved → Processing → Ready to ship → In transit → Delivered (payment due /
  collected; partly delivered) - Flagged (being returned, returned, damaged) - Cancelled (with reason). The customer sees simpler words.
- Same phone with another open order is flagged (no double parcels). Customer record per phone: addresses, all
  orders and how they ended, staff notes and tags; the courier's record for that phone (delivered vs returned).
- Picking list for the day; bulk invoice print with a QR code; Scan screen (scanner, typed number or phone camera) moves a
  whole pile to the next stage; hand-over sheet per courier per day with the COD total and two signature boxes.
- Courier webhooks move orders by themselves (picked up, delivered, returning, partly delivered, money paid out).
- Customer told by itself: being prepared, handed to the courier (track button), out for delivery (money to keep ready),
  delivery failed; after Meta's 24 h only through Meta-approved templates; review request one day after delivery with the page's review link.
- Order report: orders and value, delivered / cancelled / returned against the period before, who took the order (AI,
  product page, website, which teammate), best sellers, cancel and hold reasons, each courier, new vs returning customers.
- "To chase": people who showed interest (pressed Buy on a product page, open lead, liked an offer) and did not order.
- Every product has its own public page with a Buy button. Exchange = a new order linked to the old one.

Comments
- Answers under the comment by name, with the product's photo when the comment is about one; sends a private message;
  never puts an address or phone in public; deletes certain spam / abuse, hides doubtful ones and tells the owner;
  Comments screen: hide, delete, reply, block. Instagram comments too.

Website chat
- One line of code; the visitor gives name and mobile; the business's colour and logo; photos and voice notes; a
  **voice call where the AI speaks**; a daily AI-reply limit per visitor, then the team; Off / Test / On switch.

Team and hand-over
- Alerts to people on duty (Off duty switch); groups choose which hand-over reasons reach which group; app badge,
  sound; desktop alerts through the Chrome extension.
- Take over from the inbox (30 min, 1 h, 6 h, for good) or by sending "." from Messenger / the business's WhatsApp
  (another "." gives it back); replies from Meta Business Suite are recorded but do not pause the AI.
- A hand-over nobody claims stays in Notifications as "never answered"; every human task (hand-over, AI alert,
  booking, payment claim, website question) stays open until someone acts.
- Inbox tabs Open / Later / Done; a Done chat comes back when the customer writes again.
- Leads made by the AI (asked a product or price, wants to order, gave a phone); one open lead per customer; 6-stage
  pipeline, list, "Today" (who to call, who is late); assign; export; open WhatsApp from the lead card to write by hand.
- Analytics (7 / 14 / 30 days): messages, AI vs team replies, customers, solved by AI vs needed a person, first-reply
  time, busy hours, per channel, hand-overs and why, how fast the team claimed, waiting now, leads.
- AI off for one customer, one channel (for a time or until switched on) or the website chat; disconnect a page.
- Saved replies, with "suggest the fitting reply" and "adapt with AI"; microphone dictation in the reply box.
- Up to 5 businesses per login sharing one credit; several pages per business share products and rules, separate inboxes.
- Install as a phone app (no store app) with notifications.

Teaching the AI
- Agent Desk: change rules in plain words; draft → test in a customer's-phone view → publish → undo. The helper also
  saves facts to the knowledge base. Practice mode before going live (AI answers only test chats such as "test 12345");
  "Go live" needs the page, rules, credit and an automatic test of three questions.
- Knowledge base: pasted text, question-answer pairs, .txt / .md / .csv; a test box shows which passages it would find.
- Products: WooCommerce sync (preview then approve, webhooks), CSV / Excel template (code, name, description, price,
  photo link, old price, product link, options such as size / colour / weight, extra photos), or added one by one with a
  phone photo; options with their own price; video links.
- Follow-ups: the AI rates a quiet customer cold / warm / hot - cold nothing, warm one reminder, hot two; inside 24 h;
  not when a person holds the chat or the customer already ordered.
- Broadcasts: only to those who wrote in the last 23 h, minus chats held by a person and people who got one recently;
  a test to yourself first, every time the text changes.

Money and data
- Credit, cost of every AI action listed, statement, low-credit e-mail at a level the owner sets; the AI stops just
  before zero but messages are still saved.
- Keys encrypted before they reach the database, never sent back to the browser; hashed passwords; nightly encrypted
  backups on another server; CSV exports; a deletion procedure.

Where we beat them (because we are the ERP)
- Their orders sit in their own book and are exported to "your system"; ours ARE the system (stock, dues, cost,
  commission, courier, returns, loyalty) - no export.
- They never tell stock counts and know stock only if you type it; ours is live.
- When their AI stops (no credit), nobody is alerted; ours keeps alerting the team.
- Conversations cannot be downloaded there; ours can.
- One person on Messenger and WhatsApp is two customers there; ours joins them by phone number.
- Website chat there has no product cards, Instagram no receipts or reminders; ours can draw cards on the website chat.
- Their dashboard is mostly English; ours is Bangla / English everywhere.
- Their WhatsApp risks a ban; ours is the official API.
- We already have Steadfast checks, the courier's COD figure, dues, follow-ups, pre-orders, warranty and points.

### Part 1 stages (after the review)
- **1a** Inbox core: conversations, customer timeline, AI helper (summary / ask / draft), hand-over states, claim,
  waiting timer, alerts; website chat bubble; Telegram.
- **1b** Facebook Messenger + Instagram + Page comments (needs the owner's Meta app; built and tested with his own
  accounts while Meta reviews).
- **1c** The AI agent answering by itself: product cards, photo → product, voice notes, order → invoice after the
  customer confirms, follow-ups and broadcasts inside 24 h, courier updates and review requests.
- **1d** WhatsApp (official Cloud API / coexistence).
- **1e** Agent desk (teach, test, go live, versions), knowledge base, analytics.

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
