# Bizmation (bizmation.io) compared with our ERP — 20 Oct 2026

Read from their own site (home, features, pricing, FAQ, blog). Nothing independent was found about them (no reviews,
no app-store listing with ratings), so their claims are their own.

## What they are
A Dhaka company (Uttara) selling one web tool for Facebook / online sellers, priced per order:
399 Tk up to 300 orders a month, then 1.5 / 1 / 0.75 Tk per order (Agency / Business / Enterprise), plus 100 Tk a month;
under 50 % confirmed orders the minimum charge applies to every order. 7-day trial.

Their three headline features (and what their customers praise):
1. **Failed order tracking** — orders started on a landing page / site but not finished, kept so the shop can call back.
2. **Fake order detection** — flags suspicious orders (phone, address, IP checks; block lists) before dispatch.
3. **One-click landing page** — a product page with an order form for Facebook ads, mobile, "SEO-optimised".

Also listed: inventory (real-time, low stock, shelf life), category + variations (colour/size), supplier purchases with
cash and credit, manufacturing from raw material, "Product Mixer" (combine products into a new one with its profit),
stock adjustments, courier delivery success tracking, cloud backup, a mobile app, and (blog, Oct 2026) AI auto-calling to
confirm orders (press 1 / say yes, retries, SMS fallback) and abandoned-cart e-mail/SMS.

## Where they are stronger (before today)
- Landing pages for ads with an order form — we had product pages only inside a chat.
- Failed / unfinished order tracking — we had nothing.
- A named fake-order shield with block lists — we had a delivery-history risk note on the customer, not on each order.
- Automatic order-confirmation calls (new for them; needs a paid telephony line).
- Manufacturing (raw material → finished goods) and "Product Mixer" bundles with their own profit.
- Size/colour variations as one product with variants (ours: colour families, not size × colour matrices).
- A mobile app in the stores (ours: an installable web app).
- Simple per-order price for small sellers.

## Where we are stronger
- **AI inbox that sells**: Messenger, Instagram, WhatsApp (official + linked), website chat and now e-mail, answered by an
  AI agent that reads photos and voice notes, takes orders, sends bills and order pages, follows up, answers comments.
  Their chatbot exists only as a blog article.
- **Real accounting**: FIFO + landed cost, one net profit everywhere, money accounts, cash-up, closed months, capital and
  investors with monthly returns, joint stock with a partner company, balance sheet. They show inventory + orders.
- **Courier**: Steadfast booking, delivery status, COD reconciliation and write-offs, payout tracking.
- **Marketing**: social posting to every network (through bridges), a content factory (cards, AI photos, reels with Bangla
  voice), paid Facebook ads built from posts, creators / sponsorships, what-to-push-next.
- **After sale**: serial numbers and warranty, repairs, returns, points and refill reminders, customer pages.
- **Network**: market across shops, find stock, resellers, print-job board, design desk.
- Bangla throughout, roles and per-person sign-in, activity log, a provider platform for many companies.

## What was built today (tag landing-shield-1, Inbox → Landing pages; owner-only like the rest of the Inbox)
1. **One-click order landing page** — choose a product (optional offer price) → a public page: headline, photo, offer
   price with the old one struck through and the saving, selling points written from the product (in the shop's
   language), trust badges, delivery charges, returns, and a cash-on-delivery order form on the page (inside / outside
   Dhaka, quantity, live total), a sticky Order button and a call button. Copy the link into an ad. Views, orders,
   unfinished and view→order % per page. Edit headline, points, offer, colour; switch off. Orders go into Inbox → Orders
   and are approved into invoices exactly like chat orders. (A Facebook pixel "Purchase" fires if the page has one.)
2. **Unfinished orders (failed order tracking)** — the moment a visitor types a real mobile number the form is kept;
   if they never press Confirm it shows under "Unfinished orders — call them back" with Call and WhatsApp links,
   "Called" (with what they said), "Make the order" (the call finished it: an order in Orders) and Dismiss.
3. **Fake-order shield** — every order (chat, product page, landing page) is checked and gets OK / CHECK / RISKY /
   BLOCKED with the reasons: block list (number or internet address), the buyer's own parcels with us (returned before),
   earlier cancelled orders, another open order on the same number, several numbers from one internet address in a
   day, a name or address that cannot be real, a big COD quantity. A blocked number cannot order online (the page asks
   them to call). "Block this number" on a flagged order; the block list and the flagged orders on the Landing pages tab.
   Rate limits on the public page.

Tests: landing_test (27). Checked on dev: a Bangla page at phone size, a real order through it (CO-261020-4191 ৳1,120),
the tab with its figures.

## How close we are now
Of their three headline features we now have all three, and the shield uses more signals than they list (own delivery
history, cancelled orders, double orders). Remaining gaps, in order of value:
1. **Courier-wide delivery ratio** (all merchants' history for a number). Couriers publish no official API for it; the
   tools that do it log into the merchant panel with your password (breaks when the site changes). Possible later as an
   opt-in network ratio across the companies on our own platform (needs your decision on sharing between companies).
2. **Order confirmation calls** — needs a paid voice line (e.g. a BD IVR/SIP provider); can be added behind a switch.
   A free alternative: a WhatsApp / SMS "reply 1 to confirm" message through the Inbox.
3. **Manufacturing and bundles** (raw material → product; combos with their own profit).
4. **Size × colour variants** as one product.
5. **Store app** (we are an installable web app).
Everything else they list we already have, mostly deeper.
