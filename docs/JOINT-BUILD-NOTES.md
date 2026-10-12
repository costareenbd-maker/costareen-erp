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

## Built (2026-10-06): steps 1-4 done, tags joint-1 .. joint-4
Files: 068/069/070 sql; lib/system.js; handlers/joint.js (page, set-up, products, receive, adjust, catalog, prepareJointSale, floorCheck, mirrorJointSale, syncJoint, mirrorJointReturn, sales list, agree, card, statement PDF); invoice.js (joint lines + opts.mirror); money.js (syncJoint hook); sales.js (return hook, void refusal, clean codes); partners.js (erpPoolClose = agree); dashboard.js (pnl `joint`); page blocks joint-1, joint-2, joint-3/4 at the end of app.html.
Local trial: set the provider flag with erpPlatformJoint, make the partner's company (erpJointStart company), create the pool, join with the partner's link.

## Cross-database (2026-10-06, tag joint-x): a partner on its own Supabase
Owner's decision: partners keep their own Supabase (company copy on the bridge); the pools stay in the provider's
database (the shared space, like the market). Costareen (provider DB) keeps the one-transaction path.
- `isRemote(ctx)` = bridged company. Pool work goes through `withPool / poolRead / controlTx` (joint.js "where the pool lives"):
  same DB -> asSystem in the call's transaction; remote -> `ctx.deps.control.begin` with `erp.system = on`
  (075: `erp_system()` lets the server write pool rows for a partner that has no login here: create_pool_invite,
  close_pool_month, pool_settlement). `asSystem` is a no-op on such a control transaction (`t.__ctl`).
- A remote partner is a stand-in row in the provider's `businesses` (`remote_tenant`, `remote_business`), made on join
  (`remoteJoin`, invite code). It has no members; its owner counts as pool owner (`member: true` for remote).
  Remote companies only JOIN; pools are started by a provider-side company.
- Sale from a remote seller: `mirrorJointSale` writes the pool copy in its own control transaction, `joint_sales.status
  = 'pending'`; core.js hooks (075/core: `ctx.onRollback` -> `dropMirror`, `ctx.afterCommit` -> status 'ok').
  Money (`syncJoint`) and returns (`mirrorJointReturn`, idempotent `<rid>-J`) for remote run after the seller's
  commit (`later`). Pending sales are left out of the settlement.
- Safety net `jointReconcile(deps)` (jobs.js nightly + hourly 'deliveries'): pending > 3 min -> keep if the seller's
  invoice exists, else drop; re-sync money of remote joint sales of 90 days; write returns the pool missed.
- Switch for copies: `erp_tenants.joint` (076, control-only), Platform > Company copies button (`erpPlatformJointCopy`);
  `erpHello.joint` and `jointOn` read it for bridged companies.
- `invoice_lines.pool_id` FK dropped (075): in a partner's DB the pool is elsewhere.
- Mirror invoice (`createInvoice opts.mirror`) no longer calls `erpCatalog`/`sale_price_for` (they need a login in the pool).
- Also fixed: bridged company deps had lost `fetch` and `renderPdf` (a comment swallowed them in index.ts since Stage 2):
  company copies could not make PDFs.
- Card 1 on the Joint stock page = "make an install link" (erpInstallInvite, platform admin). The old "make their company
  here" server action stays but has no button.
- Test: joint4_test (45) runs a second database in the same test server as the partner's.
