# Joint stock with a partner company — blueprint

Written 2026-10-06 after research. Nothing in here is built yet unless marked "already there".
Purpose: you and a partner company co-own some stock. Each company sells it to its own
customers under its own name. Each company's books stay separate. Profit on the joint stock
is shared by how much each put in.

## 1. What the research says

| Where | What they do | What we take |
|---|---|---|
| Odoo (consignment / "owner" on stock) | Stock in your warehouse can belong to someone else. You sell it on your normal invoice, under your name. It is not counted as your stock. Paying the owner is not built in (paid add-ons do it). | The owner tag on each invoice line. |
| OCA add-on `sale_owner_stock_sourcing` | Pick the stock owner per line on one sales order. | Mixed invoice: own lines and joint lines on one paper. |
| SAP Joint Venture Accounting | One party runs the sales; at month end the result is split by each partner's share, money already put in is netted, each partner gets a statement. | Month-end split, netting and statement. |
| NetSuite / Dynamics | Sell from another company's stock; the system makes the matching entries between the companies by itself. | Automatic mirror entry, no typing twice. |
| Agent selling in his own name (commission-agent rule, IFRS 15) | The customer sees only the seller. The goods' real owner books the sale and the cost. The seller only holds the money for the owner. | This is the model: the selling company acts as the pool's agent. |
| Joint-venture bookkeeping (textbook "separate books" method) | The venture has its own book. Each partner has a running account in it: what he put in, what he collected, what he paid. | Already how the pool's book works. |
| Small open-source project ConsignTrack | A payout counts only when both sides confirm it. | Both owners sign off the month. |

Nobody ships exactly this case (two sellers, one co-owned stock, one mixed invoice), so the
design below combines the pieces.

Rejected ways:
- **Two invoices** (one from you, one from the pool): cleanest books, but the customer gets two papers.
- **Pool sells to you, you sell to the customer** at a transfer price: needs a transfer price for
  every product, splits the profit in two places, and may create a VAT sale between the companies.

## 2. The design

### Three books
- **Your company** — your own stock, sales, profit. Unchanged.
- **Partner's company** — his own. Unchanged. He never sees your cost or profit, nor you his.
- **Joint pool** — the co-owned stock, its sales, its costs, its profit. Both owners see all of it. (already there)

### Selling
- Staff of either company open **New invoice in their own company**, as today.
- Joint products appear in the same product search with a small **Joint** tag. Own and joint
  products can be mixed on one invoice.
- The invoice is **the seller's invoice**: seller's name, address, logo, design, and the
  seller's own invoice number. The customer sees nothing about the pool.
  (This changes my earlier suggestion of a separate pool number series: with mixed lines the
  paper has to be the seller's own.)
- Behind it, automatically, for each joint line:
  - the stock leaves the **pool's** stock, at the pool's cost;
  - the sale and its cost are written in the **pool's** book, marked "sold by <company>";
  - in the seller's own profit report the joint lines are **left out** (shown on a separate
    line "Sold for the joint pool"), so nobody's own profit is inflated.
- The customer and his due stay in the seller's company. The pool never chases a customer.

### What staff can see and do
- Sales staff and managers of both companies can sell joint products.
- They see: name, selling price, floor price, how many are left. Never the cost, the profit or
  the settlement.
- Their own company's limits apply (for example the 20 % discount limit for sales staff).

### Prices
- Each company sells at its own price (you wholesale, he retail — already there as price tiers).
  The pool gets the real price each sale was made at.
- Each joint product has a **floor price** agreed by both owners. Staff cannot sell below it.
  An owner can, and that sale is flagged in the month-end statement.
- Delivery charge belongs to the seller (he pays the courier). It is not pool income.

### Money collected
- The customer pays the seller. The pool's part of that money shows as **"held by <company>
  for the pool"**.
- **Part payment on a mixed invoice: split by share.** Bill 10,000, of which 2,000 is joint;
  customer pays 5,000 → 1,000 counts for the pool, 4,000 for the seller. Later payments the same way.
- **Slow payers:** the seller chose the customer, so after an agreed number of days
  (suggested: 45) the unpaid joint part counts as owed by the selling company itself.
  Before that, an unpaid joint sale is shared risk.
- **Returns:** the item goes back to the stock it came from. A return after a month is closed
  is written in the current month; a closed month is never reopened.

### Investment and buying together
- Each owner's money put in or taken out is a dated entry in the pool's book. (already there)
- Stock bought for the pool records who paid. Shared costs record who paid. (already there)
- **Profit split = capital ratio at the start of each month** (already there, as agreed on
  2 Oct). New money counts from the next month. Unsold stock and unpaid customer bills belong
  to both in the same ratio.

### Month end
- One statement: sales by each company, cost, shared expenses, profit, each share, money each
  is holding, and the one line that matters: **"A pays B this much"**. (already there)
- New: **both owners must press Agree**. Then the month is frozen and locked.
- New: the statement as a PDF for both.
- A disputed item can be flagged; it is carried to next month and does not block the rest.

### Controls
- Stock corrections in the pool show in the statement with who made them.
- Everything is struck out with a reason, never deleted. (already there)
- The whole feature is **off for every company** and switched on by you (platform panel) only
  for the companies you choose.

## 3. Things outside the software

- **Write the rules on one page and both sign it**: the profit-split rule, floor prices, the
  45-day rule. Without a written agreement, partnership law assumes equal shares.
- **VAT / tax — not verified.** I could not confirm how NBR treats two companies selling
  co-owned stock under their own invoices. If either company is VAT-registered, ask a VAT
  consultant before relying on this flow.

## 4. Build order

| Step | What | Result you can see |
|---|---|---|
| 1 | Switch in the platform panel; pool set-up tidy | "Joint stock" appears only for chosen companies |
| 2 | Joint products on the normal invoice, mixed lines, staff can sell | One invoice, your header, own + joint lines; pool stock goes down |
| 3 | Books: pool sale entries, seller's profit leaves joint lines out, payments split by share, returns | Month-end numbers are right for mixed invoices |
| 4 | Floor price, 45-day rule, both-owners Agree, statement PDF | The controls and the paper for both partners |

Each step is tested and live before the next one starts. The old "Selling from: Joint pool"
switch (owners only, whole invoice from the pool) is replaced by step 2.

## 5. Decisions needed

1. Slow-payer rule: 30, 45 or 60 days, or none? (suggested 45)
2. Floor price: staff blocked below it, owner can override with a flag — agreed?
3. Is the partner's company already on this ERP? If not, it is created from your
   Partnership tab with its own private link.
