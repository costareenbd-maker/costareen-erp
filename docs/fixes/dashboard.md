# Dashboard group: fixes and deliberate changes

Group: `supabase/functions/erp/handlers/dashboard.js` (erpDashboardData, erpDaySales,
erpPnl, erpMoney, erpCostBook, erpSaveCostSettings, erpSaveCostRows). Spec: `docs/spec/01-dash-profit-costs.md`.
No migration was needed (no `014_dashboard.sql`): `cost_book`, `business_config`, the
expense and courier tables from 007 hold everything.

## 1. Dashboard money no longer reaches sales and manager browsers (D-SEC)
- **Original:** every role loads `dash` through `erpBundle` (ErpUI.html:9918; the bundle
  needs only `sales`). `erpScrub_` (ERP.js:4419-4436) deleted keys that no longer existed
  (`profitToday`, `profitMonth`, ...), so the `profit`, `cash` and `cover` blocks (gross
  profit, expenses, money owed, courier balance, stock at cost, cost per day) still went to
  sales and manager users.
- **Web app:** `erpDashboardData` checks the caller's role. Below shareholder it never
  computes those blocks: no `profit`, `cover` or `cash` key, `stockByCat[]` without `cost`
  and `uncosted`, `quality.costMissing` = 0, `hideProfit: true`. Expenses, dues, credit and the
  courier balance are not even read. Everything a sales person may already see stays: revenue,
  orders, units, retail stock value (sell price), stock health, top products, recent orders,
  web-order and courier-parcel counts. The page already renders without these blocks (it shows
  "Average order today" instead of profit, and no shelf / cash cards), so nothing on screen
  changes for shareholder and owner. `scrub.js` still runs afterwards as a backstop.

## 2. One cost precedence everywhere: the product's own cost first, then the price book
- **Original:** the dashboard, `erpMonthGross_` and `erpPnl` used
  `PRODUCT_MASTER.cost_price || book` (ERP.js:216, 6724, 8322); `erpMoney` used
  `book || PRODUCT_MASTER.cost_price` (ERP.js:5606). The same sale could therefore show a
  different cost on Profitability than on the P&L and Dashboard.
- **Web app:** all four use **`products.cost_price` first, then the price book's landed
  cost** (one helper, `products()` in dashboard.js).
- **Why this one:** the original's own comments (ERP.js:2817-2819, 3112+) say
  `cost_price` is what stock *actually* cost (weighted average of receipts, filled by
  shipment receiving), while the book is the *replacement* cost used to set prices. Profit is
  about what was really paid, so the real cost wins and the book fills the gap where no
  receipt cost exists. It is also what three of the four screens already did, so only the
  Profitability screen's numbers move, and only for products that have both figures.

## 3. Price-book matching of blank category / brand / type
- **Original:** `erpCostSync_` writes book rows with `'Uncategorised'` for a blank
  category and `'-'` for a blank brand or type (ERP.js:3028-3030), but every lookup used the
  raw blanks (the dashboard alone defaulted the category, ERP.js:211). A product with no brand
  or type never matched its own book row and stayed uncosted.
- **Web app:** one key function, `bookKey(cat, brand, type)` (exported from dashboard.js):
  trimmed, blank category → `Uncategorised`, blank brand/type → `-`, lower-cased. It is used
  for the book's rows, for product lookups on every screen, by the sync, and by
  `erpSaveCostRows`. Side effect: the sync now matches existing rows case-insensitively, like
  saving already did (the original sync was case-sensitive, ERP.js:3045, so a row typed as
  "filaments" got a duplicate "Filaments" row). When the book holds two rows with the same
  key, the first one (sheet order) is the one used everywhere.

## 4. The price book is a table
- `COST_PRICES` → `cost_book`; O2:O4 → `business_config` `cost_rate`, `cost_handling`,
  `cost_min_margin`. Landed (column G formula) and margin (column J formula) are computed on
  read with the same rules (`landedOf`, `marginOf`), never stored, so changing the rate
  re-prices every row at once exactly as the sheet formulas did.
- `row` in `erpCostBook` is the row's position (sort order) + 2, as the sheet row was; saving
  matches by name, as the original does, so the number is only a display key.
- The tab can no longer be missing: `missingTab` is never returned and
  "The COST_PRICES tab is missing from this sheet." can no longer happen.
- `updated_at` is a timestamp instead of the text stamp `yyyy-MM-dd HH:mm`.

## 5. A refused cost save no longer half-saves
- **Original:** a negative value threw part-way through `erpSaveCostRows`; rows written
  before it stayed written while the page was told the save failed (spec 3.5 caveat).
- **Web app:** the whole call is one transaction, so the error rolls back every row of
  that save. Same error sentences.

## Kept as the original (decided, not fixed)
- **Returns counted three ways** (dashboard nets negative lines and does not count `RTN-`
  as an order; the day picker counts `RTN-` as an order; the P&L treats every line of an
  `RTN-` invoice as a return). Kept: each screen labels its figure consistently with how it
  counts, and changing one would change totals people already compare against the sheet.
- **Month-to-date vs the full previous month** in the dashboard comparison. Kept: it is a
  presentation choice ("compared with Sep '26"), not a wrong number.
- **Unknown-cost revenue counted with zero cost** (dashboard month gross, P&L, erpMoney
  profit). Kept: the P&L footnote says so outright; the dashboard and Profitability wording
  ("left out") is the page's text, which this group does not change. Flagged for the owner.
- **Today's margin ignores invoice discounts; the month's applies them.** Kept.
- **Zero-total legacy lines still add cost.** Kept (quality note explains them).
- **`alerts.queueOpen`** is always 0: there is no MANAGER_QUEUE table, and the page never
  shows it.
- **Courier balance:** taken from `courier.js` `sfBalance(ctx)` (owned by the courier group,
  including its 30-minute cache and the website fallback). If that export is missing or
  fails, `courierBalance` is `null`, which is exactly what the original returned when the
  courier could not be reached: the page shows our own 30-day figure with
  "collected in 30 days — courier did not answer".
- **Courier alerts** read `courier_recon`, `courier_payout_lines` and `business_config`
  `sf_night` (JSON `{at, error, ...}` written by the nightly courier run; an error is shown
  only when `at` is set, as `erpSfNightInfo_` did).
- **Customers count** is every `customers` row (the sheet skipped rows with a blank
  customer_id; a table has no blank rows).

## P&L "Delivery charged to customers" on unpriced sales (found on real data)
Original ERP.js:8363 adds `grand - (lines - discount left)` as delivery income for
every invoice. Sales logged before July 2026 have line totals of 0, so their whole
invoice total was counted as delivery income (May 2026: 8,686,750; June: 5,841,950).
The web app only counts delivery when the lines carry prices (`I.sum > 0`).
