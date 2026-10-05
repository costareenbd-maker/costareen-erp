# The open maker network — full blueprint (2026-10-06)

Status: **blueprint. Nothing in here is built unless marked "exists".**
Asked by the owner: design the whole application again, with everything decided so far and the
new research, and say why it will work and which widely felt problems it solves.
Read with `PLATFORM-BLUEPRINT.md` (the free ERP, the bridge, the trade market - built),
`GROWTH-RESEARCH.md` (evidence and sources) and `JOINT-POOL-BLUEPRINT.md`.
This file replaces the build order in `GROWTH-RESEARCH.md` section 5.

## 1. What it is

One neutral place, at its own address (3dowala.com), for everyone around 3D printing in
Bangladesh - and built so it can later serve any small seller of things with a serial number.

- **Anyone** can check a printer's warranty and history, fix a failing print in Bangla, find
  who has a product in stock, and get something printed at a known price. No account needed.
- **Every seller, print farm, repair shop, reseller and designer** runs their work in it for
  free, gets orders from it, and is protected from fake cash-on-delivery orders.
- The more sellers are in it, the better the public tools get. The more people use the public
  tools, the more orders sellers get.

## 2. Rules carried over (already decided - do not drift)

1. Neutral name. The builder's name never appears. Brand names of others (e.g. Polymaker) only
   with their written permission, and then labelled as sponsor.
2. "Open" means **open to join, open rules, an open registry anyone can check**. The code stays
   closed and on the provider's side, as decided ("nobody can copy the system").
   (If the owner meant publishing the code: that undoes the copy protection. To be confirmed.)
3. Logic on the provider's side; a company keeps only its data; the ERP stops if the provider's
   key is removed; compliance views are disclosed and logged (exists).
4. The operator's own stock is always visible on the trade market, unlabelled; the terms say the
   operator may list stock (exists). Others choose what to share.
5. Free to run: free plans, no paid AI, rules instead of AI. Nothing on the office VPS.
6. Money is traceable; nothing is deleted. Plain words, visible buttons, Bangla for customers.
7. New, from this research:
   - **The platform never holds anybody's money.** Buyers pay sellers, farms and designers
     directly (cash on delivery, bKash). Holding money needs a payment licence.
   - **Consent in plain words** before keeping a phone number or sending reminders, and an easy
     way to withdraw it (Personal Data Protection Ordinance 2025). A line in the terms is not enough.
   - No lucky draws (Penal Code s. 294A). No fake urgency, fake reviews or hidden boosts.

## 3. The problems, and how many people have them

| Problem people voice | How big (see sources; vendor figures are a direction only) | Our answer |
|---|---|---|
| "Will I be cheated? Is the warranty real?" | Over 90 % of online buyers choose cash on delivery because of trust; most report fraud or a bad experience. The same printer is sold with 4 days, 1 month or 1 year of warranty. China-only printer versions are sold here and confuse buyers. Since the phone register (NEIR, Dec 2025) every phone owner knows what a device check is. | Printer Passport, verified sellers, ratings, an order page |
| "My print failed and nobody explains it in my language" | The main reason people give up the hobby everywhere; humidity and load shedding make it worse here. | Print Doctor in Bangla, tested settings, monsoon and power helpers |
| "Who has it in stock? What does it cost?" | Everything is imported; colours and parts run out; prices are given "in the inbox". | Public stock finder fed by sellers' live stock; instant print estimate |
| "I have an idea but no printer, or no 3D file" | Students, gift buyers, small businesses. | Get it printed (jobs go to farms); design desk; name-sign maker |
| Sellers: "fake orders, no system, wrong prices, no steady orders" | About 300,000 active Facebook sellers; a 40 % return rate on cash on delivery is called typical; sellers price by feel and lose money. Free business apps are wanted: TallyKhata reports 4.4 million registered users. | Free ERP with a delivery-history check, courier, WhatsApp, true-cost calculator, and orders from the network |
| Designers: "I am copied and not paid" | A running complaint on every model site. | Paid design jobs; later a catalogue that pays per print sold |

Honest size note: 3D printing itself is a small market here. That is why it starts there (the
owner has the stock, the brand and the community contacts) but every part is built to work for
any product with a serial number and any small online seller.

## 4. The application

### 4.1 For everyone - no account

| Part | What it does | Status |
|---|---|---|
| **Printer Passport** | Type or scan a serial: model, version (global / China), who sold it, warranty until when, repairs on record, reported stolen or not. Register a printer yourself. See section 5. | new |
| **Print Doctor** | Pictures of failed prints; tap the one that looks like yours; cause and fix in Bangla and English; the product that solves it. Monsoon guide; "which UPS for my printer". | new |
| **Find stock** | Search a product, colour or brand: which shops have it now, price or "ask", city. Each shop has its own page. Order goes straight into that shop's system. | new (the trade market between companies exists) |
| **Get it printed** | Upload a file, get an estimate at once (worked out in the browser), farms take the job or offer a price. No file: send a sketch or photo to the design desk. | new (wanted board and deals exist) |
| **Help me choose** | Filament and printer picker with live stock, measured colours, "closest colour in stock". | new |
| **Makers directory** | Verified sellers, farms, repair shops, designers, with ratings. | new (ratings exist) |
| **Print of the week, monthly contest** | A file, its settings and the filament for it every Friday; a contest judged on merit; prizes from sponsors, labelled. | new |

### 4.2 For members - free, sign in by sending a WhatsApp message (no password, no SMS cost)

- **My printers**: passports, warranty countdown, repair history, tested settings for my model.
- **My orders** from every shop on the network; my print jobs and design requests.
- **My points** at each shop; my level; my gallery and reviews.
- **Reminders I agreed to**: filament likely running low, colour back in stock, warranty ending,
  a humid week ahead.

### 4.3 For businesses - free

Two sizes, so nobody is stopped by the hard set-up step:

- **Lite (2 minutes, kept on the provider's side)**: digital warranty cards for their customers,
  a shop page, an orders inbox, the delivery-history check. For sellers who only want the basics
  and for sellers invited by their own customers (section 5).
- **Full ERP (exists)**: stock, invoices and designs, quotations, courier, cash on delivery,
  WhatsApp campaigns, serials and warranty, repairs, money, partners, the trade market
  (share stock, requests and deals, wanted board, price guide, ratings).

New for the full ERP:

| Part | For whom | Size |
|---|---|---|
| Warranty automation, scan with the phone camera | sellers of printers and devices | M (agreed) |
| Customer page behind a QR on every invoice | all sellers | M |
| Points and levels, referral; refill and back-in-stock reminders | all sellers | M + S |
| Delivery-history check before a cash-on-delivery parcel; WhatsApp "confirm your delivery" | all sellers | S |
| Public sharing switch per product (private / trade / public) | all sellers | S |
| Farm kit: true-cost calculator, job board, grams per job, own quote link | print farms | S + M + M |
| Sell without stock: reseller orders shipped under the reseller's name, settled monthly | resellers | L |
| Service records onto a passport | repair shops | S |
| Profile, paid design jobs; later the licensed catalogue with a royalty per print | designers | M, later L |

### 4.4 For the operator

- Companies, announcements, updates, lock, compliance views (exist).
- Registry care: disputes over a serial, verification badges, abuse reports.
- Sponsor programme: a brand pays for prizes or a featured page, always labelled.
- Conduct rule: the operator never uses a company's private data to trade against it. One
  discovered breach would end the network.

## 5. Printer Passport - and the buyer whose seller is not in the system

A public record per serial number. It shows the product and the promises made about it, never
the owner's name, phone or price.

**Three levels of trust, shown as a colour:**

| Level | How it gets there | What a reader can rely on |
|---|---|---|
| Verified by the seller (green) | A seller in the system sold it; the ERP wrote the record with the invoice. | The seller's own record. |
| Confirmed by the seller (green) | The buyer registered it; the seller opened the link and pressed Confirm. | The same. |
| Self-declared (grey) | The buyer registered it with photos of the invoice and the serial sticker; the seller has not answered. | Proof is on file; the seller has not confirmed. |

**A buyer whose seller is outside the system:**
1. He types or scans the serial on the Check page. Answer: "Not registered yet."
2. He registers it himself: photo of the invoice, photo of the serial sticker, shop name,
   date, the warranty he was promised. His passport exists at once, grey.
3. He gets a link to send to his seller ("please confirm my warranty"). The buyer sends it
   himself, so nobody is spammed and it costs nothing.
4. The seller opens it, makes a Lite account in two minutes, and presses Confirm, Correct or
   Reject. Confirmed: the passport turns green, and that seller is now in the network.
5. The seller never answers: the passport stays grey. The buyer still has his proof in one
   place, warranty reminders, a repair history, tested settings for his model, and something
   to show a buyer if he sells the printer.

What it cannot do, said plainly on the page: it cannot make an outside seller honour a promise,
and it cannot see the maker's own warranty records. It keeps the promise and the proof, which
is what is missing when a paper card or a chat is lost.

Why a seller says yes: free digital warranty cards, fewer arguments, a "verified seller" mark on
a public register, claims that arrive with proof.

Also in the passport:
- **Repairs**: a repair shop scans the passport's QR (the owner showing it is the consent) and
  adds what was done.
- **Selling a used printer**: the owner presses Transfer, the buyer scans; the history stays.
  Whether the warranty moves with it is the seller's stated rule.
- **Stolen**: the owner can flag it; the check shows it.
- **Two people claim one serial**: both see "disputed" until proof settles it.
- Works for any product with a serial number.

Why this piece comes first: it is useful with one seller (the owner's own customers), it spreads
by itself (every outside buyer invites his seller), and it is what makes the neutral name
trusted.

## 6. Why it will work

1. **It starts from complaints people already make**, not from features we like.
2. **Every public part is useful on day one without a network**: the Doctor, the Passport for
   the owner's own customers, the estimate.
3. **It spreads by itself**: a buyer invites his seller; a QR sits on every invoice and box; a
   Doctor answer is shared in a group; print jobs pull farms; the stock finder brings people back.
4. **It costs almost nothing to run**, so it does not need to earn from day one. The operator
   earns the quiet way: its stock is in front of every seller, and low-stock hints offer it (exists).
5. **Head start nobody else here has**: a working ERP, the trade market, a supply line, and
   contacts in the community.

Precedents:

| Who | What it shows |
|---|---|
| Bike Index (free open bicycle register, about 1.4 million bikes) | A neutral serial register grows when it is free and useful. |
| NEIR, the phone register | The whole country already understands "check the device, official or not". |
| TallyKhata (4.4 million registered), Hishabee (200,000) | Small businesses here take up free tools. They do bookkeeping; none does warranty, courier risk, a maker market. |
| ShopUp / Mokam | Selling without stock, with a partner delivering, works here. |
| MakerWorld points, Printables contests | Points and contests keep this exact hobby coming back. |
| 3D Hubs (tens of thousands of local printers, 1.7 million parts, then shut the community side in 2018) | A print network gets big, but fails as a business on its own: buyers got their own printers and professionals wanted guaranteed quality. So we do not live on job fees, and we guard quality. |

## 7. Where it can fail, and the guard

| Risk | Guard |
|---|---|
| The niche is small | Built for any serial-numbered product and any small seller; widen after the niche works. |
| Empty market at the start | The owner's stock and customers are the first supply and demand; partners and resellers next; public tools need no network. |
| Trust in a neutral operator who also trades | Disclosed in the terms; every compliance view logged where the company sees it; conduct rule in 4.4; ranking by distance, price and rating only. |
| Bad prints from a farm | New farms get small jobs until five good ratings; a photo of the print before dispatch on the order; reprint-or-refund rule in the terms. |
| WhatsApp number blocked | Only answer people who wrote first; reminders only with consent; e-mail as a fallback. |
| Free plan limits when the public arrives | Doctor is plain pages (no server calls); stock search reads a snapshot refreshed every 15 minutes; rate limits. A paid plan (about US$25 a month) only when the owner decides. |
| Law: data, warranties, money | Consent screens; "a record, not a guarantee by the platform" on every passport; never holding money; a lawyer reads the terms (owner's task, already listed). |
| One person runs it | Everything self-service; disputes by rule, with proof on file. |

## 8. Making it a habit

Trigger, one tap, a reward that varies, something of theirs stored with us - as in
`GROWTH-RESEARCH.md` section 4. The passport adds the strongest stored thing of all: their
printer's history lives here.

## 9. How it sits on what exists

- Public pages are plain pages on the same Cloudflare project and address; they call open
  routes of the same server function (the install pages already work this way).
- The register, public listings, print jobs and members live in the provider's control tables,
  like the trade market's tables. A passport is a few hundred bytes.
- Lite accounts are companies kept on the provider's side, limited to the Lite parts so they
  stay small. This is the "hosted plan" (Stage 5) in its smallest form.
- A sale with a serial in any ERP writes the passport by itself (serials exist).
- Print jobs reuse the wanted board, requests, quotations, invoices and ratings (exist).

## 10. Build order

Each line is one stage: built, tested, deployed, checked, recorded.

| # | Stage | Size | Done when |
|---|---|---|---|
| N0 | Warranty automation + phone camera scan (agreed) | M | Every printer model has a rule; a box is scanned in with a phone. |
| N1 | Printer Passport: public check page, QR and card, customer page on every invoice | M | A customer scans an invoice and sees parcel, warranty and reorder; a stranger checks a serial. |
| N2 | Self-registration, the confirm link, Lite accounts | M-L | An outside buyer registers, his seller confirms from a phone in two minutes. |
| N3 | Print Doctor, tested settings, monsoon and UPS helpers | M (mostly writing and pictures) | 20 problems with pictures, in two languages. |
| N4 | Find stock: sharing switch, shop pages, search, back-in-stock alert | M | A stranger finds which shop has a colour and orders it. |
| N5 | Keep-customers kit: points and levels, refill reminders, delivery-history check | M + S + S | A repeat customer reorders from a reminder; a risky parcel is flagged before it ships. |
| N6 | Get it printed: estimate, jobs to farms, farm kit | L | A file from a stranger becomes a paid, rated job at a farm. |
| N7 | Design desk, repair-part requests | M | A sketch becomes a file, then a print. |
| N8 | Sell without stock for resellers | L | A reseller's order ships under his name and settles at month end. |
| N9 | Licensed catalogue with royalty; sponsor programme; full hosted ERP | L | Owner's call, after real use. |

Recommended start: N0 and N1 together, then N3 beside N2 (N3 is mostly content).

## 11. Decisions for the owner

1. "Open" = open to join and an open register, code stays closed. Right?
2. One name for everything public (3D Owala), or another name for the public side?
3. Does the owner's own business print for customers, or only pass print jobs to farms?
4. Start with N0 + N1?

## 12. Sources added for this blueprint

(The rest are in `GROWTH-RESEARCH.md`.)

- https://prototypebd.com/2025/11/02/elementor-4899/ (Bambu A1 Chinese vs Global, local shop)
- https://x.com/BambulabGlobal/status/1712372322274062387 (maker on the China region limit)
- https://forum.bambulab.com/t/bambu-lab-region-lock-china/6602
- https://bikeindex.org/news/why-register-your-bikes-on-bike-index
- https://en.wikipedia.org/wiki/Bike_Index
- https://www.thedailystar.net/tech-startup/news/how-check-if-your-mobile-illegal-or-not-4022981 (NEIR)
- https://en.prothomalo.com/bangladesh/3omueuisfc (NEIR launch)
- https://www.tbsnews.net/economy/facebook-restriction-keeps-f-commerce-entrepreneurs-bay-905416 (Facebook sellers)
- https://www.tallykhata.com/en/home-eng/
- https://bd.linkedin.com/company/hishabee-technologies-limited
- https://techcrunch.com/2018/09/14/3dhubs-once-a-community-3d-printing-service-is-now-sourcing-all-3d-prints-internally
- https://en.wikipedia.org/wiki/Protolabs_Network
- https://www.thedailystar.net/tech-startup/news/bangladeshs-personal-data-protection-ordinance-2025-key-takeaways-4015401
- https://mahbub-law.com/key-highlights-of-the-personal-data-protection-ordinance-2025-for-businesses/
- https://acviss.com/glossary/digital-warranty-registration/
