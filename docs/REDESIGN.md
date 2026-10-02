# Redesign plan — from "sheet ERP copy" to a proper web app

Decided with the owner 2026-10-02. The web app is now the main system; it no
longer follows the sheet ERP. Staff are still on the sheet, so screens can
change freely until go-live. Go-live starts from EMPTY data (opening stock
typed in) — nothing is carried over from the sheet. The owner delegated design
decisions: choose what is best, do not stop to ask, report what was done.

Rules for every phase: server behaviour keeps its tests (add tests for new
behaviour, never delete one to make a change pass); each phase is deployed and
checked live before the next starts; every deliberate change is one line in
`docs/CHANGES.md`.

## What the sheet forced on the design (and no longer does)

| Sheet-era habit | Why it existed | Replace with |
|---|---|---|
| `window.prompt` / `confirm` boxes for payments, reasons, strike-outs | a dialog could not open inside the sheet's dialog | real in-page dialogs with fields, validation and a summary |
| Whole lists loaded and filtered in the browser (customers capped at 300, sales "newest 100") | one slow call per screen | search, filter and paging done by the database |
| No addresses: Back button leaves the app, reload returns to Dashboard | one HTML dialog | a route per screen and per record (`#/sales/INV-…`), Back works |
| Manual **Refresh** button, "saved copy, updating…" dashboard | 10-second recalculation | data is fast; refresh on focus and after every save |
| Everything recalculated in the server's JavaScript from the full sales history | no database | SQL views / functions per figure, indexed |
| Tools screen: rebuild stock view, heal invoice layout, refresh QR, prepare template | sheet maintenance | removed; what remains (merge duplicate customers, recalc reorder levels) moves to the screen it belongs to |
| "System values", "Links", "Add a business sheet", partner links | spreadsheets as businesses | one Businesses section: create, rename, members |
| Wording: "the sheet did not answer", "Reading the sheet…", "saved in Drive" | — | plain wording |
| 6-digit code as the only staff secret | no accounts possible | kept (fast at a shop counter) but: per-address guess limit (done), owner sees and ends sessions, optional PIN + device |
| Data-quality notes about unpriced pre-July sales | old sheet data | gone with the fresh start |

## Page by page

| Page | Keep | Change |
|---|---|---|
| **Sign-in** | code + approved device for staff; email for owner | one clear screen with two tabs (Staff code / Owner); owner second step (authenticator app); "forgot password" link; show which business you are entering |
| **Shell** | grouped side menu, business switcher, dark/light | routes + Back; global search (invoice no., customer, product, phone); phone bottom bar with the 4 daily screens; remove Refresh; a small "saving / saved / offline" indicator |
| **Dashboard** | attention cards, today, month, charts | first row = things to act on (to send, dues to chase, out of stock, web orders); money figures second; every card opens the list behind it, already filtered; remove data-quality notes and the saved-copy stamp |
| **New invoice** | phone lookup, cart, both discounts, delivery suggestion, pay modes | one-screen layout on desktop (customer left, cart right, totals pinned); barcode / quick-add by SKU; keyboard flow; a real confirm dialog with the totals; delivery rules from Settings instead of "spool = 1.3 kg" |
| **Sales** | waiting-for-courier box, filters, return / cancel / fix | an invoice detail page (lines, payments, returns, parcel, history) instead of a row of buttons; database search and paging; "Receive payment" works here |
| **Web orders** | enter as invoice, link to invoice | merge the courier report into Sales' parcel tracking; this page only lists orders still to enter |
| **Quotations** | 4-step editor, live A4 preview, conditions library | turn a quotation into an invoice (did not exist); server-made PDF like invoices instead of browser print |
| **Customers** | owe / advance lists, statement, WhatsApp reminder | a customer page (orders, payments, statement, notes) instead of boxes above the table; database search; merge duplicates here |
| **Campaigns** | wizard, groups, by-hand queue, STOP handling | unchanged for now — newest and least sheet-shaped screen |
| **Products** | filters, days cover, "should be" level | product page with stock history (was loaded and never shown), price and cost history; bulk edit; photo |
| **Stock entry** | receive with costing, supplier orders, to-order plan | split into three clear tabs (Receive, Orders, To order); stock count (physical check) flow; history panel |
| **Product cost** | price book by category/brand/type | buying currency and rate per supplier from Settings instead of fixed RMB / sea / air |
| **Profitability** | P&L by month, by brand/category, dead stock | month picker and export; drill from a figure to the invoices behind it |
| **Expenses** | fixed / recurring / one-off, strike-out, Excel | categories editable in Settings; attach a receipt photo |
| **Capital** | shareholders, investors, book, month close | add the joint-pool settlement (who holds the cash) from 005_partnership.sql as a "Partnership" tab |
| **Settings** | lists, staff + devices, courier keys, AI keys, backups | regroup: Business (name, logo, bank, invoice look) · People · Lists · Connections (courier, website, WhatsApp) · Security (sessions, 2-step, activity log) · Backups |
| **Tools** | — | removed (see table above) |

## Security

Done 2026-10-02 (021_lockdown.sql, auth settings, headers):
- sign-up closed; e-mail confirmation on; passwords 10+ characters
- the not-signed-in role has no table or function permission at all; every table has RLS
- leftover `sheet-sync` manager login and its password file deleted
- wrong-code guessing limited per device (5) and per internet address (20) per 15 minutes
- Content-Security-Policy and related headers: the page may only load code from itself and jsdelivr, and only talk to its own Supabase project
- allowed origins narrowed to erp.costareen.com and this project's own preview addresses

Next:
- owner second step (authenticator app) and "forgot password" on the sign-in screen
- Settings → Security: signed-in devices, end a session, activity log (who did what, from where)
- secrets moved from a plain table into Supabase Vault
- staff sessions expire after N days without use; code + 4-digit personal PIN option
- alert to the owner (e-mail / WhatsApp) on failed nightly job, new device request, 20-wrong-codes lock
- the owner must rotate: Supabase access token, Cloudflare Global API key (both were pasted in chat)

## Phases

0. Security lock-down — **done**
1. Shell: routes + Back, dialogs replacing prompt/confirm, wording, remove Refresh and Tools, sign-in screen, phone bottom bar
2. Daily screens: New invoice, Sales + invoice page, Customers + customer page
3. Goods: Products + product page, Stock entry tabs, stock count
4. Money: Dashboard, Profit, Expenses, Capital + Partnership tab
5. Settings regroup, per-business settings for the Costareen / 3D-specific defaults, Security section
6. Scale: figures in SQL, paging everywhere, alerts
7. Go-live: empty the imported test data, opening stock, staff codes, Supabase Pro
