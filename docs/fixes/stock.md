# Stock group — fixes and deliberate changes

Handlers: `supabase/functions/erp/handlers/stock.js`. Migration: `supabase/013_stock.sql`.
Tests: `supabase/tests/stock_test.mjs`. Spec: `docs/spec/02-products-stock.md`.

1. **A manager's product edit no longer wipes the cost.** Original: `erpProduct`
   is scrubbed for roles below shareholder (no `cost_price`), the form saves
   `cost_price: undefined`, and `erpSaveProduct` wrote `erpNum_(undefined) = 0` into
   PRODUCT_MASTER.I (ERP.js:1276, spec §4.3 / §8.1). Web app: below shareholder,
   a missing or 0 cost on an UPDATE keeps the stored cost. A manager who types a
   real cost (> 0) still sets it, as before. Creating a product is unchanged.

2. **Receive-screen new-product drafts: server ready, the page still drops them.**
   The page sends only `{sku, qty}` per line (ErpUI.html:6078-6087), so a draft
   (sku '') is filtered out and, if it is the only line, the server answers
   "Add at least one product with a quantity." (spec §8.2). The page is not
   changed (it must stay the original). `erpReceiveShipment` accepts
   `{isNew:true, product:{...}, qty}` exactly as the original server did, so
   the drafts work as soon as the page sends `isNew` and `product` along. To
   fix in the page (owner decision): map lines as
   `l.isNew ? {isNew:true, product:l.product, qty:l.qty} : {sku:l.sku, qty:l.qty}`.

3. **No double stock for a draft with an opening figure.** Original: a receive
   draft carries `opening_stock` (the form's field, also used as the line qty,
   ErpUI.html:5196) and `addProductAPI` booked it as an OPENING movement, then
   the receive booked the same qty again (ERP.js:3255-3256 + Code.js:1743-1748). Web app:
   products created by a receive get opening 0; the receive line is the stock.
   (erpPoCreate / erpPoArrive already forced 0 in the original.)

4. **Purchase-order ids no longer collide.** Original: `PO-yyMMdd-HHmm`, so two
   orders saved in the same minute merged into one (ERP.js:7988, spec §8.8).
   Web app: same id, and if it is already used, `-2`, `-3`, … is appended.
   Difference ids (`D<yyMMddHHmmss>-<n>`, `-s<n>`) get the same treatment, so
   two "Will not come" clicks in one second no longer share an id.

5. **Price book finds blank-attribute products.** Original: the price book writes
   a blank category as `Uncategorised` and a blank brand/type as `-`
   (erpCostSync_ ERP.js:3028), but receive and the To-order plan look up with
   blanks as `''`, so such products never matched (spec §8.10). Web app
   (`bookCost` in stock.js): the exact key first, then the
   `Uncategorised|-|-` form of it.

6. **Settling the "(no supplier named)" balance works.** Original: the balance
   for differences with a blank supplier is shown under "(no supplier named)",
   but `erpPoSettle` compared that label to the blank supplier and always said
   "Nothing is outstanding with that supplier." (ERP.js:8187, 8201). Web app:
   that label settles the blank-supplier items.

7. **Operator column = the ERP person's name everywhere.** Original wrote the
   Google account email or `erp` (receive, OUT adjustments) and the hard-coded
   `n8n-agent` (IN adjustments, OPENING rows, legacy erpReceiveStock) (spec §8.11).
   There is no Google account in the web app; every movement written here
   carries `erpWhoIsThis_` (the signed-in person's name), as the sales screens do.

8. **Every write is one transaction.** Original: a receive that failed half way
   (e.g. the second new product) left the first product created and said so
   ("already created: …"). Web app: the whole call rolls back; that message can
   still appear but nothing is left behind. Locks: the original single script
   lock is the advisory lock `stock` for every write here, plus `sale` for a
   stock-OUT adjustment so it cannot race a sale on the same units.

9. Small, forced by the database: `lead_time_days` is an integer column, so a
   fractional lead time is rounded. The PO box date (`arrived_on`) is a date
   column; a value that is not `yyyy-MM-dd` becomes today. `erpPoList` returns
   box dates as `yyyy-MM-dd` (the sheet turned the text into a Date cell, so the
   original's `String(date).slice(0,10)` printed e.g. "Wed Sep 30").

10. **No STOCK_VIEW.** Every `refreshStockView()` of the original is gone: stock is
    the `product_stock` view over the ledger, always current (so §8.13
    "erpSetProductStatus does not refresh STOCK_VIEW" no longer applies). The
    reorder level shown as 5 when stored 0 stays (catalog.js).

Reproduced on purpose (not fixed): adjustment IN is recorded as `RETURN` and OUT
as `ADJUST` (spec §1.2); "Sold" counts every invoice line; the To-order plan's
default lead 60 is unreachable; `erpStockHistory` is served but the page never
shows it; the receive reference is checked only by the server; receive results
(`unitCost`, `wasCost`, `nowCost`) and the plan's cost reach managers as in the
original (the scrub never touched them).
