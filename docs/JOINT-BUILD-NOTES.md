# Joint stock — build notes (technical; the owner's version is JOINT-POOL-BLUEPRINT.md)

Owner's answers (2026-10-06): slow-payer rule 45 days; floor price = staff blocked, owner may
override with a flag; partner is NOT on the ERP yet (create his company on the provider's
database from the Joint page - never a separate install, pools need one database); part payment
split pro rata.

## Model
- A pool stays what it is: a business with `is_pool`, members = the partner companies' owners.
- The customer's invoice is the SELLER's (own number, header, customer, due). Joint lines on it:
  `invoice_lines.pool_id` set, `product_id` null, `sku` = pool sku + `~J` + first 4 hex of the
  pool id (so nothing in the seller's books mistakes it for an own product of the same code;
  stripped on the customer's paper), `unit_cost` = net unit price (zero profit in the seller's
  books: the money is held for the pool). No stock movement in the seller's business.
- For each pool on the invoice a MIRROR invoice is made inside the pool by the same
  `createInvoice` (`opts.mirror`): pool stock out, pool cost, pool number, `sold_by` = seller,
  customer shown as "<seller> · <seller invoice no>" (the partner never sees the other's customers).
  Link table `joint_sales`.
- Money: `syncInvoiceStatus` (seller) -> `syncJoint`: money on the seller's invoice
  (everything except Adjusted / Returned) x joint net / invoice net = what the pool should have;
  the difference is written in the pool as a payment, method `Joint`, `received_by` = seller.
- Returns / cancel: `returnGoods` (seller) -> mirror return in the pool (RTN invoice, stock in,
  `Returned` payment on the mirror), then syncJoint. Void (remove) is refused for an invoice with
  joint lines - cancel instead.
- Staff are not pool members: pool-side reads/writes run in `asSystem(ctx, fn)` (role reset inside
  the same transaction) after JS checks: feature on for the seller, seller is a partner of the pool.
- Switch: server-only table `joint_flags(business_id)`; `joint_enabled(biz)` definer function;
  platform admin flips it.
- Settlement (new pool_settlement): revenue counts returns (RTN lines), money = `Joint` + real
  methods, 45-day rule = unpaid part of a mirror older than N days counts as held by its seller,
  both owners agree -> close.

## Steps
1. Switch + Joint page shell (set-up, partner company, pools list) + Stock tab (add product, receive, floor price).
2. Joint products on New invoice (mixed lines), staff can sell, mirror in the pool.
3. Books: syncJoint, returns/cancel, void refusal, seller P&L memo line, settlement SQL.
4. Floor price enforcement, 45-day rule, both-owner Agree, statement PDF, dashboard card, tabs finished.

Progress is logged in docs/CHANGES.md under "joint-N".
