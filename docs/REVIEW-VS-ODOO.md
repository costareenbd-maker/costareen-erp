# Review: Costareen ERP against a professional ERP (Odoo)

Written 2026-10-03 from the code as it runs, not from memory. For each area: what the system does today, what Odoo does, and whether the gap matters for this business. "Matters" is judged for a trading company that imports, sells retail and wholesale, uses couriers, has shareholders/investors and one joint-venture partner.

Verdict in one paragraph: the daily operations (selling, stock, couriers, dues, reorder suggestions, WhatsApp) are sound and in places better fitted to Bangladesh than Odoo is. The weak side is **money logic**: there is no fixed cost per sale, no single definition of profit, no record of where cash is, and one currency rate. Capital and Partnership sit on top of those, so their numbers inherit the weakness. Those are the things to fix; most of the rest can stay simple.

---

## A. Serious — the numbers can be wrong

### A1. Profit of a past sale changes when a product's cost changes
- **Today:** cost of goods sold = quantity × the product's *current* cost price, worked out again every time a report opens. Receive a new shipment at a higher cost and last month's profit drops, although nothing about last month changed. Only a *closed* capital month is frozen.
- **Odoo:** the cost is fixed at the moment the goods leave (valuation layer, average or FIFO). History never moves.
- **Matters:** yes. Profit share for shareholders, investor reporting and the P&L all read this figure.
- **Note:** the joint-pool settlement already stores the cost on each invoice line (`unit_cost`). The main business does not use it. Two methods in one system.

### A2. "Net profit" has two different definitions
- **P&L screen:** gross profit + delivery charged − courier fees ± courier differences − expenses.
- **Capital and Expenses screens:** gross profit − expenses. Courier fees and delivery income are left out.
- **Odoo:** one ledger, so one profit.
- **Matters:** yes. Shareholders are credited from a profit that ignores what Steadfast keeps.

### A3. Nobody knows where the cash is
- **Today:** payments record a method (bKash, cash, bank) but there are no cash/bank accounts with balances. Capital put in, profit paid out, expenses, supplier payments — none move a balance. "Where the cash is" on the dashboard shows only what is *not* in hand yet.
- **Odoo:** every payment goes through a cash or bank journal; balances reconcile with the bank statement.
- **Matters:** yes. Without it you cannot answer "how much money should be in the drawer / bKash / bank today", and theft or mistakes are invisible.

### A4. What you owe suppliers is not recorded
- **Today:** supplier orders and receipts exist; whether the supplier was paid, and how much is still owed, does not. Suppliers are a name in a list, not a record.
- **Odoo:** vendor record, vendor bill, payable balance, payment.
- **Matters:** yes for an importer paying in advance or in parts.

### A5. Partnership: a credit sale counts as cash in the seller's hand
- **Today:** the settlement treats each partner as holding the full total of every pool invoice they made — paid or not. A partner who sells 100,000 on credit is told to hand over money they never received.
- **Odoo:** settlement between partners would run on payments received, not invoices raised.
- **Matters:** yes, as soon as either side sells from the pool on credit or COD.

---

## B. Capital (your own business) — the doubts are justified

| Point | Today | Professional practice | Verdict |
|---|---|---|---|
| Share % | typed by hand, independent of money put in | ownership is by agreement, so this is normal | fine |
| Unallocated % ("stays with the business") | allowed | 100% is always owned by someone; retained profit still belongs to the owners | misleading — wording and logic |
| Profit credited to shareholders | from the profit of A2, recalculated until the month is closed | from the closed books of the period | fix A1 + A2, then fine |
| Investor return due | every month since joining, calculated on the money they have in **today** — past months change if they add or withdraw | due per month on the balance of *that* month | wrong for anyone whose balance changed |
| Investor return as an expense | when it is *paid* | when it falls *due* (owed = a liability) | acceptable for a small firm, but profit looks better in months you delay paying |
| Money in / out | lines in a book, not tied to a cash or bank account | moves a real account (A3) | gap |
| Loss months | reduce "profit earned" | same | fine |
| Closing a month | freezes that month's profit and shares | lock date on the whole ledger | good idea, incomplete (only capital is locked) |

## C. Partnership (joint pool)

| Point | Today | Verdict |
|---|---|---|
| Profit split by capital ratio at month start | yes | sound, a standard capital-account method |
| Cost per sale fixed at sale time | yes | good — better than the main business |
| Cash held by each partner | invoices, not payments (A5) | wrong on credit sales |
| Pool expenses | only the pool's own book counts; anything entered on the pool's normal **Expenses** screen is ignored by the settlement | trap — two expense systems |
| Pool business also shows the **Capital** tab (shareholders/investors) | yes | confusing — two capital systems on one screen |
| A book line can be removed by either owner | yes, until the month is closed | weak control; professional systems reverse, never delete, and the other side sees it |
| Unsold stock | valued at cost, owned by ratio | fine |
| Sales from each other's own stock | recorded, confirmed, settled separately | fine |

## D. Buying prices and currency — your doubt is right

- **Today:** the price book holds a buying price in **RMB or BDT only**, one global RMB rate, one handling figure, per *category + brand + type* (not per product, not per supplier). A shipment is costed in RMB or BDT with shipping split by weight.
- **Odoo:** a currency table (any currency) with a rate per date; a vendor price list per product per supplier in the supplier's currency; the purchase order carries its own currency and rate; "landed costs" add freight, duty, insurance and split them by weight, quantity or value.
- **Gaps:** no USD or any third currency; no rate history (yesterday's shipment and today's use the same rate unless you change it by hand); no duty/customs line; no price per supplier.
- **Good as it is:** weighted-average cost on receipt, shipping split by weight.

## E. Selling

| Point | Today | Odoo | Matters? |
|---|---|---|---|
| Flow | invoice = order = delivery, one step | quotation → order → delivery → invoice → payment | one step is right for a shop (it is how Odoo's Point of Sale works) |
| Quotation → invoice | a quotation is a document only; it is retyped as an invoice | one click converts | small gap, easy win |
| Selling prices | one price + wholesale | price lists by customer group, quantity, date | add only if you really price by customer |
| Tax / VAT | none | taxes on every line, tax report | **check with your accountant** — if registered for VAT this is a legal gap |
| Returns, cancel, fix | kept as records, nothing deleted | credit notes | good |
| Dues, advances, statements, reminders | yes | yes | good |
| Customer identity | matched by phone / name text | a customer ID on every document | causes duplicates; you already needed a merge tool |

## F. Stock

| Point | Today | Odoo | Matters? |
|---|---|---|---|
| Locations | one shelf, a text "bin" | warehouses, locations, transfers | no, unless a second store opens |
| Serial numbers / warranty | none | serial per unit, traceable to the sale | **yes for printers** — warranty claims need it |
| Variants | every colour is a separate product (137 filaments) | one product, colour as an attribute | convenience; reporting by "PLA+ any colour" is clumsy today |
| Stock count | yes (new) | yes | good |
| Reorder | suggested from real sales speed and lead time | fixed min / max by default | yours is better |
| Reserved stock | none — a saved invoice takes stock at once | reservation for confirmed orders | fine with one-step selling |
| Barcode | none | yes | optional |

## G. Accounting — the root of section A

- **Today:** no chart of accounts, no journal, no balance sheet, no cash-flow report. Every money figure is recomputed from sales, stock and expense rows when a screen opens.
- **Odoo:** every action posts a balanced journal entry; reports read the journal; a lock date stops the past from changing.
- **Do you need full accounting?** No. A full ledger is heavy and you would need an accountant to run it. What you need are the four things it gives: fixed cost per sale (A1), one profit (A2), money accounts with balances (A3), payables (A4), plus a lock date for closed months.

## H. What you did well (keep)

- Nothing is deleted: cancels, returns, struck-out lines all stay readable.
- Courier reconciliation with Steadfast, parcel by parcel — Odoo has nothing like it out of the box.
- Reorder plan from real demand.
- Dues with reminders, statements, advances.
- Roles with money hidden below shareholder level (currently bypassed by the single access link — to be rebuilt last, as agreed).
- Activity log, nightly backup, several businesses in one system.

## I. Order to fix (each step stands on the one before)

1. **Fix the cost of each sale at sale time** (A1) and use it everywhere.
2. **One net profit** used by P&L, Expenses, Capital, Dashboard (A2).
3. **Money accounts**: Cash, bKash, Bank… every payment, expense, capital line and supplier payment moves one; balances shown (A3).
4. **Suppliers as records + what you owe them** (A4).
5. **Currencies**: any currency with dated rates; buying price per product per supplier; duty and other landed costs (D).
6. **Capital corrections** (B): investor return per month on that month's balance; no "unowned" share; tied to money accounts.
7. **Partnership corrections** (C): settle on money received; one expense system; no deleting, partner sees every line.
8. Serial numbers for printers; quotation → invoice; variants; VAT if your accountant says so.
