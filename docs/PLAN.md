# The plan (from the review of 2026-10-03)

Source: `REVIEW-VS-ODOO.md` (money logic) and the follow-up review of look, navigation, shared inventory and missing features. Rules that hold throughout:

- Navigation stays in the always-visible side menu. Odoo ideas come in as helpers inside screens, never as a new way of getting around.
- Nothing is deleted from the books; corrections are reversals.
- Security and per-person sign-in are rebuilt **last** (access is by private link until then).
- Every stage ends with tests green, a saved fallback point (git tag) and a note in `CHANGES.md`.
- The live data is a trial copy until go-live, so changes to how figures are worked out are safe to make now and expensive later. That is why the money stages come first.

## Track A — make the numbers right

| Stage | What | Why first / depends on |
|---|---|---|
| **A1. Cost fixed at sale** | Each invoice line keeps the product's cost at the moment of sale; every report uses it. Old lines are back-filled once with today's cost. Returns take the cost of the line they return. | Root of every profit figure. |
| **A2. One net profit** | One function for a month's profit (sales − returns − cost + delivery charged − courier fees ± courier differences − expenses), used by Profitability, Expenses, Capital, Dashboard. | Needs A1. |
| **A3. Money accounts** | Cash, bKash, Bank… as accounts with balances. Every payment received, expense, capital line, profit paid, supplier payment moves one. Transfers between accounts. Screen: balances + statement per account. | Independent; needed by A4, A6, A7. |
| **A4. Suppliers and what you owe** | Supplier records. A received shipment creates what is owed; payments (from a money account) reduce it. Supplier statement. | Needs A3. |
| **A5. Currencies and landed cost** | Currency list with dated rates (USD, RMB, any). Buying price per product per supplier in the supplier's currency. A shipment carries its currency and rate, plus duty / freight / insurance / other, split by weight, quantity or value. | Needs A4. |
| **A6. Capital corrections** | Investor return per month on that month's balance, counted when due. No "unowned" share. Capital lines move a money account. Month lock applies to the whole books, not only capital. | Needs A2, A3. |
| **A7. Partnership corrections** | Settlement on money received, not invoices raised. One expense system for the pool. Book lines are reversed, never removed, and both partners see every line. Capital tab hidden inside a pool. | Needs A1–A3. |

## Track B — shared inventory, the way it should work

| Stage | What |
|---|---|
| **B1. Partner can get in** | An access link for the partner, tied to his own company (email sign-in is off). Create-partner-company flow issues it. |
| **B2. One inventory screen** | Products list with a switch **Mine · Pool · Partner's · All**, counts side by side. Moves out of Capital into Inventory. |
| **B3. One invoice, any stock** | An invoice line can come from your stock, the pool or the partner's stock. Pool lines become a pool sale; partner lines become a request he confirms, then his stock drops and the agreed price is owed. |

## Track C — look and ease

| Stage | What |
|---|---|
| **C1. Row buttons back** | The most-used actions return to each list row (Add to invoice, Edit, Receive payment, Return). |
| **C2. One style everywhere** | Web orders, Expenses, Stock, Capital, Settings, Quotations get the same list / page style as Invoices. |
| **C3. New invoice redone** | Fast entry: product search with photo and stock, quantity keys, customer on one line, totals always visible; fits a phone without long scrolling. |
| **C4. Dashboard trimmed** | What needs doing, today, this month - the rest behind tabs. |
| **C5. Small things** | One search (top bar) that also filters the open list; shorter help text with a "?" for the long version; menu groups fold on the phone. |

## Track D — features that matter for this business

| Stage | What |
|---|---|
| **D1. Serial numbers and warranty** | Serial per printer on receive and on sale; warranty end date; look up by serial. |
| **D2. Repair / service jobs** | A job for a customer's machine: received, diagnosed, parts used, charge, returned. Linked to serial and warranty. |
| **D3. Product photos and variants** | Photo per product (shown in lists, invoice entry, price list PDF). One product with colours instead of 137 separate ones - with a tool that groups the existing ones. |
| **D4. Quotation → invoice** | One click. |
| **D5. Notes, files and history on every record** | Product, customer, supplier, shipment - as invoices have today. |
| **D6. Import from Excel** on every list; export on every list. |
| **D7. Other couriers** (Pathao, RedX) - only if used. |
| **D8. VAT** - only if the accountant says the business is registered. |

Not planned (not needed now): payroll and attendance, CRM pipeline, subscriptions, budgets, fixed assets, several warehouses, loyalty points, approval chains, report builder.

## Order of work

1. **A1 → A2** (profit is right)
2. **A3** (cash is known)
3. **C1** (quick, removes the daily annoyance)
4. **A4 → A5** (suppliers, USD, duty)
5. **A6 → A7** (capital and partnership are right)
6. **B1 → B2 → B3** (shared inventory)
7. **C2 → C3 → C4 → C5** (one look, fast invoice)
8. **D1 → D2 → D3 → D4 → D5 → D6** (features)
9. **Per-person sign-in and roles** (the security rebuild)
10. **Go-live** (`GOLIVE.md`)

Needed from the owner along the way: the list of money accounts (A3); suppliers and currencies used (A4, A5); how duty is charged today (A5); partner's company name for his link (B1); answer on VAT (D8).


Owner, 2026-10-03: the business also sells 3D printers and will sell more electronics - D1 (serials, warranty) and D2 (repairs) are wanted. Order from here: D1, D2, D6, per-person sign-in, go-live.

## Agreed with the owner 2026-10-03 (evening) - one build, then the installer

Build "tidy-1" (all together, one command):
1. Courier field on the invoice: Steadfast courier -> no consignment box by default; switch "Already booked in Steadfast?" No/Yes, Yes shows the box. No -> Send parcel after saving returns the number. Steadfast Express -> the box shows at once (may stay empty, added later).
2. Less text: long grey explanations (card subtitles, field hints) move behind a "?" icon (tap to open/close), one rule for every screen. Warnings/errors (red/amber notes) always stay visible. Labels short.
3. Payment logic: one question - Paid now (method; COD not offered) / Cash on delivery (courier or rider only; optional advance with its own method; rest "COD - with the courier", cleared on delivery) / Part paid (amount + method, rest due) / Due (credit; no method). Status always from real payments; "Part paid" with 0 = Due. Old invoices unchanged; "Cash" shown as "-" where nothing was paid (display only; 465 such in the trial data).
4. Business switcher: "+ Add a business" only in the top dropdown -> clean New business page (name, currency, optional logo), same owner, opens at once. Removed from Settings, and "A company for a partner" removed from Settings. Joint-venture pool untouched.

Then "installer-1..3": bring-your-own-Supabase installer. Link -> connect their Supabase (OAuth) -> ERP built in their project -> each copy checks in with the owner's Platform screen (list, version, errors, push updates, switch off). First user: a friendly company (not a partner, no shared pool). Their own domain possible via DNS + Cloudflare custom domain.
