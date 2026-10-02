# Spec 01: Dashboard, Profitability, Product cost

Source: `sheet-erp/ErpUI.html` (UI), `sheet-erp/ERP.js` (server), `sheet-erp/Code.js` (older sheet logic).
Build stamp in both files: `b261002-0449` (ErpUI.html:9629, ERP.js:4316).
All line refs are `file:line`. Everything below comes from the code. Where the code is inconsistent or buggy, it says so under **Caveat** and does not tidy it up. Rebuild it exactly, then decide what to fix.

---

## 0. Shared plumbing (used by all three screens)

### 0.1 Transport
- Every client call goes through `srv(name, args, ok, bad)` (ErpUI.html:8060). It is a **serial queue**: one call runs at a time (`SRV_BUSY`), with a watchdog per call.
  - Default timeout is 45 s (`SRV_TIMEOUT`, :8003). Longer ones (`SRV_SLOW`, :8007-8021): `erpBundle` 120 s, `erpMoney` 180 s, `erpPnl` 180 s. `erpDashboardData`, `erpDaySales`, `erpSaveCostSettings` and `erpSaveCostRows` use the 45 s default.
  - Timeout message: "The sheet did not answer within N seconds. It may be busy - press Refresh to try again." (:8094)
  - If the error contains "Unknown action", the page shows `staleBanner()`: a red fixed top bar telling the user to reload (:8083, :9630).
- The wire call is `google.script.run.erpCall(token, name, args)`. The one exception is `erpHello(token)` (:8106-8110). `token = {code, device, label}`: the code is from localStorage `erp_code`, the device is a random id kept in localStorage `erp_device_id`, and the label is the first 60 chars of the userAgent (:8030-8058).
- Server `erpCall` (ERP.js:4285):
  1. Looks the name up in `ERP_ALLOW` and throws `Unknown action` if it is missing.
  2. Authenticates the token, then checks the role rank against the minimum role.
  3. Sets `ERP_SESSION` and calls the function from `erpFunctionTable_()`.
  4. Runs `erpScrub_(name, out, role)` on the result.
  5. On error, logs to the `ERP_ERRORS` tab (columns at, who, role, action, message, build; trimmed to 700 rows by deleting 200) (ERP.js:4317-4330).
- Every exported server function begins with `erpDoor_(arguments[0])` (ERP.js:4355). It refuses direct `google.script.run` calls unless one of these holds: an erpCall session is active, the active user equals the effective user (the owner on his own link), or the call came from a real trigger.

### 0.2 Roles (ERP.js:3971-3976, 4125)
`sales`=1, `manager`=2, `shareholder`=3, `owner`=4. The test is "rank >= needed".

| Server fn | min role (ERP_ALLOW) |
|---|---|
| erpBundle | sales (ERP.js:4179) |
| erpDashboardData | shareholder (:4203) |
| erpDaySales | sales (:4182) |
| erpMoney | shareholder (:4205) |
| erpPnl | shareholder (:4211) |
| erpCostBook / erpSaveCostRows / erpSaveCostSettings | shareholder (:4193-4194) |
| erpFormOptions (source of `OPT.currency` on Profit) | sales |

Client nav gating is in `applyRole()` (ErpUI.html:9846-9884). It sets `need = {dash:3, costs:3, settings:3, tools:3, profit:3, expenses:3, campaigns:2, weborders:2, stock:2}`. Any nav button whose need is above the user's rank is hidden, a group heading with no visible buttons is hidden, and the home screen is `dash` for rank >= 3, otherwise `products`. **So Dashboard, Profitability and Product cost are visible only to shareholder and owner.** No screen in this spec renders differently for shareholder and owner.

### 0.3 Formatting helpers (ErpUI.html:630-688)
- `fmt(n)`: `Math.round(n||0).toLocaleString('en-US')`. Always whole numbers with thousands commas. **Percentages from the server have 1 decimal place, but every UI spot that runs them through `fmt` rounds them to an integer** (dashboard margin, P&L margins, profit pills). The Costs margin cell is the exception and keeps 1 dp (:8371).
- `compact(n)`: rounds n, then: >=1e7 → `x.xxCr`, >=1e5 → `x.xxL` (lakh), >=1000 → `x.xk`, otherwise integer. Trailing `.00` / `.0` is stripped.
- `delta(cur, prev)` (month KPIs):
  - If prev is falsy: "no {prevLabel} baseline".
  - Otherwise `pc = (cur-prev)/prev*100`, shown as ▲/▼ plus `abs(pc).toFixed(0)%`, then " vs {prevLabel} ({compact(prev)})". Class `up` (green chip) when pc>=0, `down` (red chip) otherwise.
- `kpi(label, cur, val, sub)` and `kpiT(label, cur, val, sub, tone)` (:680, :924) render a card with `.lbl`, `.val` (currency prefix in `span.cur`) and a sub line. The tone adds a 3px top border: accent=series blue, good=green, bad=red (CSS :148-151).
- Currency: the dashboard uses `D.currency`, hard-coded server-side to `'BDT'` (ERP.js:498). Profit uses `OPT.currency`, falling back to `'BDT'` (ErpUI.html:6857, 6909). The page never shows a ৳ symbol in money values; the only ৳ is the alert icon glyph.
- Tooltips: elements with `data-tip` (HTML) follow the mouse in `#tip` (:646-662).
- Toasts: `toast(html, bad, ms)`. Default 5 s, or 7 s when bad.
- Theme: dark is the default. Colour tokens are at ErpUI.html:27-41 (`--series-1` #2f6fed light / #5b8def dark, `--good`, `--warning`, `--critical`, and others).
- Pills: `.pill.ok` green, `.pill.low` amber, `.pill.out` red (CSS :199-203).

### 0.4 Time and dates
- The server timezone is `Asia/Dhaka` (`ERP_TZ`, ERP.js:104; appsscript.json `timeZone`). Month key `yyyy-MM`, day key `yyyy-MM-dd`, both formatted in Dhaka time.
- `erpDate_(v)` (ERP.js:124) accepts a Date, a serial number in 20000-80000 (`(v-25569)*86400000`), or a parseable string. Otherwise it returns null.
- `erpNum_` (ERP.js:117) returns 0 for blank or non-finite values.
- Client "today" = `TODAY_STR`, which comes from the server's `erpToday()` (Dhaka) in every bundle reply (ERP.js:1957, 3426). If that is missing it falls back to the browser's local date (ErpUI.html:881-889).

### 0.5 Bundle loading (ErpUI.html:9915-9940, ERP.js:1944-2001)
- After sign-in, `loadAll(true)` calls `erpBundle(['biz','dash','catalog','lists','options'])`, then `erpBundle(['customers','invoices','history','weborders'])`.
- `erpBundle` runs each part inside its own try/catch. It returns `{ok, took{}, errors{}, today, build, <part>: data}`.
  - Side effects on every bundle: `erpBackupEnsure_()` (nightly-backup trigger housekeeping, cached for 6 h) and `erpRenderKey_()` (pairs with an external PDF renderer `ERP_RENDER_URL/pair`).
  - The `dash` part calls `erpDashboardData()` directly. That role check is NOT applied inside the bundle, because the bundle needs only `sales` (see Caveat D-SEC).
  - `costs` part = `erpCostBook()`.
  - When `total > 2500 ms`, it appends a row to the hidden `ERP_SPEED` tab: at, who, parts, total_ms, took JSON, build, steps JSON. The tab is trimmed at 400 rows.
- `applyBundle` (ErpUI.html:9643): `b.dash` → `D`, which also sets the header stamp to `as of {generatedAt} · {monthLabel} to date`. `b.costs` → `COSTS`. `e.costs` → `COST_ERR`. `e.dash` → error toast "Dashboard: …" (10 s). A build mismatch triggers `staleBanner`.
- Header **Refresh** button (`#reloadBtn`, :9610): nulls D, CAT, ORDERS, CUST, WEB, HIST and LISTS, then repaints and runs `loadAll()`. It does not reset COSTS, MONEY or PNL.

---

## 1. DASHBOARD (`data-view="dash"`)

Nav: group "Overview", button "Dashboard" (ErpUI.html:503). The page title comes from the nav button text. Renderer `viewDash()` (ErpUI.html:965-1096), wiring `wireDash()` (:891-915).

Client state: `D` (payload), `DAYSEL` (picked past day or null), `DAY_BUSY`, `DASH_YEAR` (null = current year), `DAY_MODE` ('revenue' | 'units') (ErpUI.html:542, 583-586).

Loading state: when `!D`, show `<div class="loading">Loading dashboard…</div>` (:966).
**Caveat:** several actions set `D = null` without reloading. For example, Expenses saves (`show()` at :6735) do this, so the dashboard shows "Loading dashboard…" until the next `loadAll`/Refresh. Other actions such as a product save (:5257) call `loadDashboardOnly()` (:5267), which calls `erpDashboardData` directly.

### 1.1 Layout, top to bottom

#### (a) Hero (:969-980)
- `h1`: greeting chosen from the **browser's local hour** (not Dhaka time): <12 "Good morning", <17 "Good afternoon", otherwise "Good evening". If `ME.name` exists, append ", {first word of ME.name}".
- Sub line: `{D.monthLabel} to date · as of {D.generatedAt}`.
- Quick-action buttons on the right. Each appears only if its target nav button is visible (`navOn(v)`, :920):
  - "+ New invoice" (primary) → go('invoice')
  - "Receive stock" → go('stock')
  - "New quotation" → go('quotes')
  - "Campaign" → go('campaigns')

#### (b) Attention cards (`grid g-act`, min 230px columns) (:983-999)
Built in this order. Each card has a class (critical/warning/good), an icon, a big number `n`, a label `lbl` and an optional hint. A card with a `go` target becomes clickable (`data-go`, `cursor:pointer`) when that view is visible. A card with `sfp:1` also sets `data-sfp`: clicking it sets `SFP_OPEN = true` and calls `loadSfp()` if `SFP` is not loaded, which opens the Steadfast payouts panel on Sales.

| Condition | class | icon | n | label | hint | go |
|---|---|---|---|---|---|---|
| `alerts.webPending` > 0 | critical | ! | `alerts.webOrders` (distinct order nos) | "website orders not entered" | "{fmt(webPending)} lines · {cur} {fmt(webPendingValue)} · stock not deducted" | weborders |
| `alerts.outOfStock` | critical | ✕ | outOfStock | "products out of stock" | "cannot be sold today" | products |
| `alerts.reorder` | warning | ▲ | reorder | "products at or below reorder" | "see To order on Stock entry" | stock |
| `cash.owedByCustomers > 0` | warning | ৳ | fmt(owed) | "owed by customers" | "unpaid invoices · chase them from Customers" | customers |
| `alerts.courier.review` | critical | ! | review | "Steadfast parcel(s) collected much less than the invoice" | "write off, or the customer still owes — your decision" | sales + sfp |
| `alerts.courier.pending` | warning | ▲ | pending | "Steadfast parcel(s) to match to an invoice" | "booked by hand; phone matches, amount does not" | sales + sfp |
| `alerts.courier.error` | warning | ▲ | "!" | "last night's Steadfast check failed" | the error text | sales + sfp |
| none of the above | good | ✓ | "—" | "nothing needs attention" | – | – |

`alerts.queueOpen` (MANAGER_QUEUE) is computed but **not shown**.

#### (c) Today / chosen day section (:1001-1032)
Section header `h3`: "Today", or `DAYSEL.label` when a day is picked. Beside it:
- `<input type=date id=dayPick max=todayISO() value=DAYSEL.date or today>`.
- A "Back to today" button (`#dayToday`), shown only when DAYSEL is set.
- A "loading…" text while DAY_BUSY.

**Day picker behaviour** (wireDash :897-908):
- On change, if the value is empty or equals today: `DAYSEL = null` and repaint.
- Otherwise: `DAY_BUSY = true`, repaint, call `srv('erpDaySales', [v])`. Success → `DAYSEL = res`. Failure → DAYSEL = null and toast "Could not read that day: …" (10 s).

**Today mode** (DAYSEL null). Four KPIs in `grid g-kpi`:
1. "Revenue today", cur, `fmt(kpi.todayRevenue)`, sub `td(todayRevenue, yestRevenue, 'taken')`, tone accent.
2. "Orders today", `fmt(kpi.todayOrders)`, sub `td(todayOrders, yestOrders, 'ordered')`.
3. "Units sold today", `fmt(kpi.todayUnits)`, sub `td(todayUnits, yestUnits, 'sold')`.
4. If `D.profit` exists: "Gross profit today", cur, `fmt(profit.todayGross)`, sub "{fmt(todayMargin)}% margin", tone bad if todayGross<0, otherwise good. If `D.profit` is absent: "Average order today", cur, `fmt(todayOrders ? todayRevenue/todayOrders : 0)`, sub "{fmt(kpi.todayLines)} product line(s)".

`td(now, prev, word)` (:1002): if !prev → "nothing {word} yesterday". Otherwise ▲/▼ pct (0 dp), " vs yesterday ({fmt(prev)})".

**Picked-day mode**:
- KPIs:
  - "Revenue" (cur, fmt(revenue), sub "on {label}", accent)
  - "Orders" (sub "{fmt(lines)} product line(s)")
  - "Units sold"
  - "Average order" (cur, revenue/orders or 0)
- Then, if `DAYSEL.top.length`: card "Sold on {label}" with table **Product | Units (num) | Value (num)** (rows = top ≤ 8, sorted by units desc; values fmt).
- Otherwise: `<div class=empty>Nothing was sold on {label}.</div>`.
- `DAYSEL.invoices` (top 25 by total) is returned but **not displayed**.

#### (d) Month-to-date section (:1034-1046)
Header `h3` "{monthLabel} so far", sub "1st to today · compared with {prevLabel}". KPIs, in order:
1. "Revenue", cur, fmt(kpi.revenueMTD), `delta(revenueMTD, revenuePrev)`, accent.
2. (if profit) "Gross profit", cur, fmt(profit.monthGross), sub "{fmt(monthMargin)}% margin · goods cost {fmt(monthCost)}", tone bad if <0, otherwise good.
3. (if profit and `monthExpenses` is not null/undefined) "Net profit", cur, `fmt(monthGross - monthExpenses)`. Sub:
   - starts with red "a loss · " if negative;
   - then "after {fmt(monthExpenses)} of expenses paid";
   - then " · {fmt(monthUnpaid)} still to pay" if monthUnpaid>0.
   Tone bad or good.
4. "Orders", fmt(kpi.ordersMTD), delta(ordersMTD, ordersPrev).
5. "Average order", cur, fmt(kpi.aov), sub "{fmt(unitsMTD)} units sold".
6. "Customers", fmt(kpi.customers), sub: green "+N" + " new this month" when newCustomers, otherwise "no new customers yet".

Below the KPIs, if `profit.uncosted > 0`: "{cur} {fmt(uncosted)} of this month's sales have no buying price on record, so they are left out of the profit above rather than guessed."
**Caveat:** that sentence is not accurate. The uncosted revenue is in `monthG.revenue` with zero cost, so it inflates gross profit rather than being left out (see 1.3).

#### (e) Trend cards (`trendCardsHtml`, :817-842). `grid g-half` (min 420px), two cards
The section is skipped entirely if `D.years` is empty.

**Card 1: "Sales per month — {yr}"** (SVG bar chart `yearChart`, :738-782)
- Year selection: `DASH_YEAR` if it exists in D.years, else the current year (`D.thisMonth.slice(0,4)`), else the last year. If more than one year exists, a segmented control (`.seg`, buttons `data-year`) appears in the header, sorted ascending. Clicking sets DASH_YEAR and repaints.
- Sub: "{cur} {compact(total revenue of yr)} · {fmt(total units)} pcs in {yr}. On top: taken. Inside the bar: pieces sold." Add " Grey: sold, but no price was logged." if any month has revenue 0 and units > 0. Add " Dashed mark: the year before." if the previous year exists in D.years.
- Chart: viewBox 640×230, padding L46 R8 T30 B30, 12 slots, bar width 78% of slot.
  - Y max = `niceMax(max(revenue this yr, revenue prev yr))`, where niceMax rounds up to 1/2/2.5/5/10 × 10^k.
  - Five gridlines (0..4), left labels compact(value) and "0" at the base.
  - Months after `D.thisMonth` ("ahead") draw no bar.
  - Revenue>0: rounded-top bar in `--series-1`. If bar height >= 20, the compact(revenue) label sits above and units (fmt) sit inside the bar (in-lbl). Otherwise the revenue label sits 18px above with "{units} pcs" under it.
  - Revenue 0 but units>0: grey stub (14px, `--muted`, opacity .4) with "{units} pcs" label above.
  - Previous-year revenue>0: dashed horizontal mark (`--ink-2`, 2px, dash 4 3) at that height across the bar width +2px.
  - X labels: Jan..Dec.
  - Hover target is the full slot. Tooltip:
    - title `<b>{Mon} {yyyy}</b>`;
    - then "not here yet" for future months, or "no sales" for an empty month;
    - otherwise rows Revenue ("{cur} {fmt}", or "no price logged"), Sold "{units} pcs", Orders;
    - plus "Last year" "{cur} {fmt(rev)} · {units} pcs" when the previous year has data.

**Card 2: "Sales per day — last {n} days"** (n is always 30) (SVG line `dayChart`, :784-815)
- Header seg: "Taka" (`revenue`) / "Units" (`units`) → `DAY_MODE`.
- Sub: "{cur} {compact(sum rev)} · {fmt(sum units)} pcs · average {fmt(round(units/n))} pcs and {cur} {compact(rev/n)} a day. Point at a day for both figures."
- Chart: 640×230, L46 R14 T30 B30.
  - Area fill `--series-1-soft` at opacity .35, polyline `--series-1` width 2.
  - Average line dashed `--ink-2` with label "average {N pcs | compact}", drawn only when avg>0.
  - Dots r2.5, last dot r4 with value label ("{n} pcs" or compact).
  - X labels every 5th point counting back from the last.
  - Tooltip per day: label, Revenue "{cur} {fmt}", Sold "{units} pcs", Orders.
  - Empty data → "No data in range."

#### (f) Three-card row (`grid g-third`, min 300px) (:1052-1070)
**Card "Stock on hand"** (`stockCardHtml`, :939-963). Omitted if `D.stockByCat` is empty.
- `money` = `!D.hideProfit` AND some row has a `cost` key.
- Sub: "Pieces on the shelf, and what they cost to land." When money is false, only "Pieces on the shelf.".
- List lines: name, then grey "{skus} product(s) · cost {cur} {fmt(cost)}" ("not known" when cost is 0, and the cost part is omitted when !money), with "{fmt(units)} pcs" on the right.
  - The first line is "All stock" (lead style), only when there is more than one category.
  - Then the first 5 categories (sorted server-side by cost desc, then value desc, then units desc).
  - The remainder is summed into "{N} other categories".
- When money and `t.uncosted` (count of SKUs with stock>0 and no cost): "{N} product(s) in stock have no cost on record, so they are not in the cost above."
- An "Open products" button if the products view is visible.

**Card "The shelf"** (only if `D.cover`):
- Sub: "How long stock lasts against a {leadDays}-day wait for a shipment." leadDays is hard-coded at 60.
- "Days of stock left": value `cover.days`, or "—" if null. If `days < leadDays`, the value is red with the red note "shorter than the shipment wait".
- "Selling per day" (grey "at cost, last 90 days"): fmt(dailyCost).
- "Need reordering" (grey "{outOfStock} already out"): fmt(reorderNow).
- An "Open the order list" button → stock.

**Card "Where the cash is"** (only if `D.cash`). Sub: "Money that is yours but not in the bank yet."
- "Customers owe you" (grey "unpaid invoices"): fmt(owedByCustomers).
- "Steadfast is holding": `cb = courierBalance`.
  - If cb is null: the value is fmt(withCourier) and the grey note is "collected in 30 days — courier did not answer".
  - Otherwise: the value is fmt(cb) and the note is "their figure, not paid out yet", plus " · our books say {fmt(withCourier)}" when `|cb - withCourier| > 500`.
- "Advances you hold" (grey "owed in goods, not yours yet"): fmt(advancesHeld).

#### (g) What sold (`grid g-half`) (:1073-1076)
- **"Top products — {monthLabel}"**, sub "By units sold this month". `hBars(D.topProducts, 'name', 'units', fmt, 'units')` (:843):
  - one row per product (≤10) with a name (ellipsis), a bar track of width `max(1.5%, units/max*100%)` and a bold value;
  - row title "{name} · {units} units";
  - empty → "Nothing to show.".
- **"Stock health"**: sub "{in+reorder+out} products by availability · retail value {cur} {compact(kpi.stockValue)} in {fmt(kpi.stockUnits)} units". Contents: `stockBar(D.stock)` (:852), an SVG 640×52 horizontal stacked bar with three segments:
  - In stock `--good` ●, At reorder `--warning` ▲, Out of stock `--critical` ✕;
  - width proportional, 2px gaps;
  - count text inside if the segment is wider than 42px, and the % below;
  - tooltip "{n} of {total} SKUs";
  - a legend underneath;
  - empty → "No stock rows.".

#### (h) Recent orders (:1078-1088). Only if `D.recentOrders.length`
- Card header "Recent orders" plus an "All sales" button (→ sales) if visible.
- Table: **Invoice | Date | Customer | Products | Total (num) | Status**.
  - Customer: blank shows "Walk-in".
  - Products: the first product name, plus grey "+{lines-1} more" when lines>1.
  - Total: fmt.
  - Status: a pill. `/paid|deliver/` → ok (green), `/pend|partial/` → low (amber), otherwise neutral. Blank shows "—".
- 8 rows, newest first.

#### (i) Data-quality note (:1090-1094). `.note` box with ▲, shown when any entry exists, entries separated by blank lines
- `quality.costMissing`: "**{costMissing} of {productCount} products have no cost price**, so their profit is left out. Fill them in on Product cost."
- `quality.zeroValued`: "**{zeroValued} of {salesLines} sales lines have a total of 0** — older rows recorded before prices were captured. Units are right; revenue for those months is not."
- `quality.badDates`: "{badDates} sales row(s) have an unreadable date and were skipped."

### 1.2 Server: `erpDashboardData()` (ERP.js:187-627)
No args. Reads tabs through `erpVals_` (whole used range, header row included; memoised per bundle call).

**Keys**: `thisKey` = yyyy-MM (Dhaka) of now. `todayKey` and `yesterKey` (now − 24 h) are yyyy-MM-dd. `prevKey` = thisKey shifted −1 month (`erpShiftMonth_`, :145).

**PRODUCT_MASTER** (cols 0 sku, 1 product_name, 2 category, 3 brand, 4 type, 8 cost_price, 9 sell_price; full header at Code.js:192-194):
- `productCount` counts rows with a non-blank sku.
- `cost = pm[8] || book[cat|brand|type]`, where:
  - `book = erpBookCostMap_()` (ERP.js:3154) maps lower-cased `category\u0001brand\u0001type` from COST_PRICES to landed (col G) for every row with landed > 0;
  - the dashboard key uses `category || 'Uncategorised'`, with raw brand and type.
- `costMissing++` when cost is 0.
- `prod[sku.lower] = {sku, name, cat, brand, cost, sell}`.

**SALES_LOG** (canonical header Code.js:2891-2893: 0 order_id, 1 timestamp, 2 customer_name, 3 customer_contact, 4 customer_address, 5 sku, 6 product_name, 7 quantity, 8 unit_price, 9 total, 10 payment_method, 11 payment_status, 12 delivery_status, 13 notes, 14 discount, 15 delivery_charge, 16 grand_total, 17 advance_paid, 18 due_amount, 19 customer_source). One SALES_LOG row = one invoice line, with invoice-level fields repeated on every line. For each row:
- Skip if order_id is blank. If the date cannot be parsed: `badDates++`, then skip.
- `salesLines++`. `qty = col7`, `total = col9`. If total is 0, `zeroValued++`.
- `lineCost = prod.cost>0 ? cost*qty : 0`. `costed = cost>0`.
- **Today / yesterday buckets**: units, revenue, lines and cogs are summed. The orders set adds oid **unless it starts with `RTN-`** (returns are not orders).
- `cogs90` += lineCost when the date is within the last 90×24 h.
- `dayMap` (last 31×24 h) holds revenue, units and the orders set (non-RTN).
- `mon[yyyy-MM]` holds revenue, units and the orders set (non-RTN). Return rows (negative qty/total) net off naturally.
- For the current month: `cogsMTD += lineCost`. `revenueCosted` or `revenueUncosted` += total. `topMTD[sku]` sums units and revenue, with the name taken from col6, else the product master name, else the sku.
- `lines[]` collects {id, ts, date 'd MMM', customer, product, total, status=col12 delivery_status}.

**recentOrders**:
- Group lines by order_id: lines count, summed total, product/customer/status from the **first** row seen, and ts = the max ts.
- Sort by ts desc, take 8, round the total, drop ts.
- Includes `RTN-` ids.

**months** (not used by the UI): a continuous series from the first month with sales to thisKey (guard 120), trimmed to the last 14. Each entry is {key, label "Mon 'yy", revenue, units, orders}.

**years**: one 12-slot list (Jan..Dec) for every year present in `mon`, plus the current year. Each slot: {key yyyy-MM, label Mon, revenue (rounded), units (rounded), orders}.

**days**: exactly 30 entries, `di = 29..0`, date = now − di×24 h, formatted in Dhaka. Each entry: {date, label 'd MMM', revenue, units, orders}. Missing days are zero.

**revenueFrom** (unused by UI): the first month in `months` with revenue>0.

**KPIs**:
- `revenueMTD = round(mon[thisKey].revenue)` and `revenuePrev` = the same for prevKey. These are **full calendar month totals of the previous month**, not same-period-last-month.
- `unitsMTD/unitsPrev`. `ordersMTD/ordersPrev` = distinct non-RTN order ids.
- `aov = ordersMTD ? round(revenueMTD_raw/ordersMTD) : 0`.
- `stockValue` and `stockUnits` come from STOCK_VIEW (below).
- `customers` and `newCustomers` come from CUSTOMERS.
- `todayUnits/Orders/Revenue/Lines` and `yestUnits/Orders/Revenue`.

**STOCK_VIEW** (v5 header Code.js:2360-2364: 0 sku, 1 product_name, 2 category, … 8 current_stock, … 12 reorder_level, 13 stock_status, … 17 sell_price). STOCK_VIEW is rebuilt by Code.js (:2474-2546): `current_stock = Σ TXN_LOG IN − OUT`; `available = current − reserved`; `status = OUT OF STOCK if available<=0, REORDER if <=reorderLevel (default 5), else IN STOCK`. For each STOCK_VIEW row with a sku:
- `stock = col8`, `rl = col12`, `st = col13` upper-cased.
- `value = stock × prod.sell`, using sell_price from PRODUCT_MASTER rather than STOCK_VIEW.
- Classification:
  - `OUT OF STOCK` status **or** stock<=0 → outOfStock;
  - otherwise `REORDER` status **or** (rl && stock<=rl) → reorder;
  - otherwise inStock.
- `stockValue += value`, `stockUnits += stock`.
- `byCat[cat]` uses cat = SV col2, else the product's category, else 'Uncategorised'. It accumulates value, units, skus++ and, when stock>0, either `cost += stock×prod.cost` (also into `stockCost`) or `uncosted++` when there is no cost.
- `low[]` collects rows where stock<=rl, ordered out-first then by deficit desc. It is returned as `lowStock` (top 20) and `lowStockTotal`, and is **unused by this UI**.
- `stockByCat` is sorted by cost desc, then value desc, then units desc. value and cost are rounded.

**CUSTOMERS** (Code.js:326: 0 customer_id … 8 date_added): customers = rows with a non-blank id. `newCustomers` = rows whose date_added falls in thisKey.

**WEB_ORDERS** (Code.js:3874 headers: 0 pulled_at, 1 order_date, 2 order_no, … 7 line_total, … 13 entered_in_sheet): for rows with col0 non-blank and col13 lower-cased == 'no': `webPending++` (lines), `webPendingValue += col7`, and the distinct `order_no` values give `webOrders`.

**MANAGER_QUEUE**: `queueOpen` = rows whose col6 status is non-blank and not DONE/RESOLVED/CLOSED. Not displayed.

**topProducts**: topMTD sorted by units desc, top 10, revenue rounded.

**profit** block:
- `todayRevenue`, `todayCost`, `todayGross = round(rev − cogs)`, `todayMargin = rev>0 ? round((rev−cogs)/rev×1000)/10 : 0`. Today uses **raw line totals with no invoice-discount sharing**.
- Month values come from `erpMonthGross_(thisKey)` (ERP.js:6716). On exception, the fallback is {revenue: cm.revenue, cost: cogsMTD, gross}.
- `monthMargin = revenue>0 ? round(gross/revenue×1000)/10 : 0`.
- `uncosted = round(revenueUncosted)`: raw totals of lines in the month whose product has no cost.
- `monthExpenses = erpExpenseTotal_(thisKey)`, or **null** on exception, which hides the Net profit tile.
- `monthUnpaid = erpExpenseUnpaid_(thisKey)`, or 0 on exception.

**erpMonthGross_(month)** (ERP.js:6716-6753), "same sums as the Expenses screen":
- Cost map: `pm[8] || book[cat|brand|type]`. Here the category key is **raw** (no 'Uncategorised' default).
- Per invoice in the month:
  - `gross` = Σ qty×unit_price over lines with total>0;
  - `lines` = Σ total;
  - `discount` = max(col14) (the invoice discount, which is repeated on every row).
- Per line:
  - `leftI = erpDiscLeft_(discount, gross, linesSum)`;
  - `share = linesSum>0 && leftI>0 ? leftI×(total/linesSum) : 0`;
  - revenue += `total<0 ? total : max(0, total − share)`;
  - cogs += cost×qty (negative qty on a return line subtracts cost).
- Returns {revenue, cost, gross}, all rounded.

**erpDiscLeft_(discount, gross, sum)** (ERP.js:10759): `discount>0 ? max(0, discount − max(0, gross − sum)) : 0`. This is the part of the invoice discount **not already baked into line totals**. Older invoices stored list-price line totals, so the full discount still applies. Newer invoices store post-discount line totals, so nothing more comes off.

**erpExpenseTotal_(month)** (ERP.js:7093): Σ amount of the EXPENSES rows whose month matches and that are not voided (col10 non-blank = voided). All kinds count (fixed paid, recurring, one-off). Rounded.

**erpExpenseUnpaid_(month)** (ERP.js:7100): 0 for a future month. Otherwise Σ amount over EXPENSE_ITEMS of kind fixed that are active in the month (`from<=month<=to`) and have no non-voided `fixed` EXPENSES row with that item_id.
EXPENSES columns: expense_id, recorded_at, month (text yyyy-MM), kind, category, description, amount, item_id, recorded_by, voided (ERP.js:6566). EXPENSE_ITEMS columns: item_id, kind, name, category, amount, from_month, to_month, note, set_by (:6569).

**cover** block:
- `perDay = cogs90/90`.
- `stockAtCost = round(stockCost)` (unused in UI).
- `dailyCost = round(perDay)`.
- `days = perDay>0 ? round(stockCost/perDay) : null`.
- `leadDays: 60` (hard-coded), `reorderNow = reorder`, `outOfStock`.

**cash** block (each part in its own try/catch, defaulting to 0):
- `owedByCustomers = erpDues().total` (ERP.js:5004). Reads SALES_LOG cols 0-19:
  - Rows are grouped into invoices; the legacy per-line `ORD-<ms>` ids are merged by `erpSameOrder_` (:5508): same customer|phone|grand_total with ids within 5 min of the group head.
  - `grand = max(col16)`, `onSheet = max(col17 advance_paid)`. An invoice is settled if any row's col11 payment_status == 'paid'.
  - `got = max(Σ PAYMENTS.amount for its ids, onSheet)`.
  - `due = settled ? 0 : round2(grand − got)`. Only dues > 0.5 count.
  - total = Σ due, rounded.
- `advancesHeld` = Σ positive balances from `erpCreditMap_()` (ERP.js:5542). PAYMENTS rows with a blank order_id and note containing `[acct:<key>]` are summed per key.
- `withCourier` = Σ PAYMENTS.amount (col4) where method (col5) contains `'COD (Steadfast)'` and timestamp (col3) is within the last 30 days. PAYMENTS columns: payment_id, order_id, customer, timestamp, amount, method, note, recorded_by (ERP.js:4882).
- `courierBalance = erpCourierBalance_()` (ERP.js:6316):
  - Cached in ScriptProperties `ERP_SF_BAL::<sheetId>` for 30 min.
  - Otherwise calls Steadfast `GET https://portal.packzy.com/api/v1/get_balance` (headers `api-key`, `secret-key` from ScriptProperties `ERP_SF_KEY::<id>` / `ERP_SF_SECRET::<id>`) and uses `current_balance`.
  - If that throws (for example no keys), the fallback is the website `GET https://costareen.com/wp-json/cz/v1/cod?days=1&limit=1` (header `x-cz-key`) and its `balance`.
  - Otherwise null. The null is also cached.

**alerts.courier = erpSfNeeds_()** (ERP.js:11070). Returns {review, pending, error}:
- `review` = number of COURIER_RECON rows with action (col7) == 'review'.
- `pending` = COURIER_PAYOUT_LINES rows where match (col9) == 'phone', status (col4) matches /deliver/i, and invoice_no (col8) is non-blank, and the consignment is not yet in COURIER_RECON and `erpOwedMap_()[invoice] > 0.5`.
- `error` = the last nightly Steadfast run error from ScriptProperty `ERP_SF_NIGHT::<sheetId>`.

**quality**: {productCount, costMissing, salesLines, zeroValued, badDates}.

Other returned keys: `generatedAt` ("EEE d MMM yyyy, h:mm a" Dhaka), `monthLabel`, `prevLabel` ("Mon 'yy"), `currency 'BDT'`, `thisMonth`.

### 1.3 Server: `erpDaySales(dateStr)` (ERP.js:2550-2609)
- `dateStr` must match `^\d{4}-\d{2}-\d{2}$`, otherwise it throws "Pick a date first."
- SALES_LOG rows whose Dhaka day equals dateStr are summed: units, revenue (raw totals, no discount sharing), lines, and distinct orders. **RTN- ids are counted as orders here**, unlike on the dashboard.
- byProduct is keyed by product_name (col6), else sku. invoices are keyed by oid with {customer, time 'h:mm a', units, total}.
- Returns {date, label 'EEE d MMM yyyy', units, orders, revenue, lines, top (byProduct sorted by units desc, 8), invoices (by total desc, 25)}.

### 1.4 Dashboard caveats and data quality
- **D-SEC (data exposure):** every role, including sales, loads `dash` through `erpBundle` (ErpUI.html:9918). `erpScrub_` for non-shareholders (ERP.js:4419-4436):
  - deletes `stockByCat[].cost` and `.uncosted`;
  - deletes a list of keys that **do not exist** in this payload (`profitToday`, `profitMonth`, …);
  - sets `hideProfit`.
  So the `profit`, `cash` and `cover` blocks (gross profit, expenses, money owed, courier balance) still reach the browser for sales and manager users. The screen is hidden, but the data is in memory. A rebuild should enforce this on the server.
- Cost source precedence is inconsistent:
  - dashboard, erpMonthGross_ and erpPnl use **PRODUCT_MASTER.cost_price first, then the price book**;
  - erpMoney uses the **price book first, then PRODUCT_MASTER**.
  The comments say the PRODUCT_MASTER column holds the weighted-average actual cost from receipts (ERP.js:2817-2819) and that it "has never been filled" (:201-207).
- Price-book key mismatch: `erpCostSync_` creates book rows with `'Uncategorised'` for a blank category and `'-'` for a blank brand or type (ERP.js:3028-3030). The lookups use raw blanks (only the dashboard defaults the category). So products with a blank brand or type never match a book row and stay uncosted.
- Zero-total lines (old rows before prices were captured): they count in units and orders, add 0 revenue, and their **cost is still added to COGS** (dashboard today, month, cover and erpMonthGross_), which depresses margins. The UI's quality note explains the zero totals only. No date is hard-coded; `revenueFrom` (first month with revenue) is computed but unused.
- Uncosted revenue: these lines add revenue but no cost, so gross profit is overstated by that revenue. The UI wording says they are "left out".
- Month comparison is MTD versus the **full** previous month.
- "Today" margin ignores invoice-level discounts; "Month" gross applies them.
- `cover.days` compares stock at cost with 90-day COGS/day, against a hard-coded 60-day lead time.
- The greeting uses browser time. All other dates use Dhaka time.

---

## 2. PROFITABILITY (`data-view="profit"`)

Nav: group "Money", button "Profitability" (ErpUI.html:516). Renderer `viewProfit()` (:6908-6995), wiring `wireProfit()` (:7020).

On `go('profit')` (:9471-9472): if `!MONEY`, run `loadMoney()`. **Always** set `PNL = null; PNL_ERR = null; loadPnl()`, so the P&L reloads on every visit. MONEY is cached across visits until the window chip is changed. Refresh does not clear it.

Client state: `MONEY`, `MONEY_DAYS` (default 90), `PNL`, `PNL_ERR` (:608-609, :6854).

### 2.1 Layout, top to bottom

#### (a) "Profit & loss statement" card (`pnlHtml`, :6856-6901)
- Sub: "Calendar months. The current month is so far only."
- Error: `.note.err` ✕ with PNL_ERR. Loading: "Adding up the months…".
- Table. The header's first cell is the currency (`OPT.currency || 'BDT'`). Then one column per month, oldest left and newest right: "Mon yy", plus a grey "so far" line under the current month.
- Rows, in order. `row(label, key, opt)`:
  - `minus` shows the value as `(fmt(v))` when v is truthy, else "0";
  - `strong` makes the row bold;
  - `indent` adds 22px left padding;
  - `color` turns negative values red;
  - `pct` appends "%";
  - `null` shows "—".

| Label | key | opts |
|---|---|---|
| Sales, after discounts | sales | – |
| Returns | returns | minus, indent |
| Net sales | netSales | strong |
| Cost of goods sold | cost | minus, indent |
| Gross profit | gross | strong, color |
| Gross margin | grossMargin | pct, indent (fmt rounds it to an integer) |
| Delivery charged to customers | delivery | indent |
| Courier collected more than invoiced | courierExtra | indent. **Only if any month has a nonzero courierExtra** |
| Courier collected less (written off) | courierShort | minus, indent. **Only if any month has one** |
| Courier: delivery + COD fee | courier | minus, indent |
| *one row per expense category* (alphabetical across all months) | `byCat[c] or 0` | minus, indent |
| Total operating expenses | expenses | minus |
| Net profit | net | strong, color |
| Net margin | netMargin | pct, indent |

- Footnote: "Courier cost is what Steadfast kept from its payouts, in the month it paid out." If any month has `uncosted`, add: "Some sales have no cost price, so their goods count as free: {fmt(uncosted) per month joined ' · '}. Fill them in on Product cost."

#### (b) "Product profitability" header row (:6912-6919)
- Bold text "Product profitability", then chips (`button.chip`, `data-mwin`):
  - "Last 30 days" (30)
  - "Last 90 days" (90)
  - "Last year" (365)
  - "All time" (9999)
  The chip whose value equals MONEY_DAYS gets class `on`.
- Click: `MONEY_DAYS = n; MONEY = null; repaint(); loadMoney()`.
- While `!MONEY`: "Working out what was earned… this reads every sale, so give it a moment."
- **Caveat:** if `erpMoney` fails, the error toast is "Could not work out the profit: …" (12 s), but MONEY stays null, so the loading text stays forever.

#### (c) KPI grid (`kpi()`, no tones) (:6927-6935)
1. "Sold": cur, fmt(revenue), sub "after discounts".
2. "The goods cost": cur, fmt(cost), sub "landed cost".
3. "Gross profit": cur, fmt(profit), sub "{fmt(margin)}% margin".
4. "Asleep on the shelf": cur, fmt(deadCash), sub "{fmt(deadCount)} product(s), nothing sold in {fmt(deadAfter)} days".

#### (d) Warning (if `unknownRevenue > 0`) (:6937-6942)
`.note.warn` with "!": "**{cur} {fmt(unknownRevenue)} of these sales have no buying price on record**, so their margin is left out rather than guessed. Fill the gap in the Costs screen and the figure above becomes complete."

#### (e) Rollup tables (`moneyTable`, :6998-7012). Omitted when rows are empty
- "Where the profit comes from": rows = `MONEY.brands`, first column "Brand".
- "By category": rows = `MONEY.categories`, first column "Category".
- Columns: **{label} | Units | Sold | Profit | Margin**. Profit is bold.
- Profit and Margin show "—" only when `r.unknown && !r.cost`, meaning the whole bucket is uncosted. Otherwise Margin is `marginPill(m)`:
  - ≥25 → ok (green)
  - ≥10 → low (amber)
  - otherwise out (red)
  - text "{fmt(m)}%"
- Rows are in server order: profit desc.

#### (f) "Product by product" card (:6948-6967)
- Sub: "Best earners first. Margin is blank where no buying price is known."
- Scroll-tall table: **Product | Brand | Units | Sold | Cost | Profit | Margin**.
  - Product: name (or sku) plus a grey sku line.
  - Brand: "—" if blank.
  - Cost and Profit: "—" if `p.unknown`. Profit is bold.
  - Margin: amber pill "no cost" if unknown, otherwise marginPill.
- Empty: a row spanning 7 columns, "Nothing was sold in this period."
- Up to 200 rows.

#### (g) "Not moving" card (:6970-6993)
- Sub: "On the shelf, nothing sold in {deadAfter} days. This is your money, and it is standing still."
- Empty: "Everything on the shelf has sold recently."
- Otherwise a table: **Product | Brand | On hand | Cost each | Cash in it | Last sold**.
  - "Cash in it" is bold.
  - Last sold: red pill "never" if null, otherwise "{n}d".
  - Up to 100 rows, sorted by cash tied desc.
- Footer: "All stock at cost: {cur} {fmt(stockCash)} · as of {generatedAt}".

### 2.2 Server: `erpPnl({months: 6})` (ERP.js:8306-8391)
- `n = clamp(round(months) || 6, 1, 12)`. The UI always sends 6. Months = the n calendar months ending with the current one (Dhaka).
- Cost map: `PRODUCT_MASTER.cost_price || book[raw cat|brand|type]`.
- Pass 1 over SALES_LOG lines in those months, grouped by order_id → `{month (from the first line seen), lines[], sum (Σ total of lines with total>0), gross (Σ qty×unit_price of lines with total>0), discount (max col14), grand (max col16)}`.
- Pass 2, per invoice. `isReturn = /^RTN-/`, `leftD = erpDiscLeft_(discount, gross, sum)`. For each line, with `unit = cost[sku]||0`:
  - If `total<0` or isReturn: `returns += −total`; `cost += unit×qty` (qty is negative, so cost comes back). Then skip the line.
  - Otherwise: `share = sum>0 && leftD>0 ? leftD×total/sum : 0`, `net = max(0, total − share)`, `sales += net`. Then `unit>0 ? cost += unit×qty : uncosted += net`.
  - Delivery, once per non-return invoice with grand>0: `delivery += max(0, grand − (sum − leftD))`. This is everything the customer was charged beyond the goods net of discount.
- Courier:
  - `erpSfChargesByMonth_()` (ERP.js:8894): COURIER_PAYOUTS rows (cols payout_id, created_at, paid_at, cod_collected, delivery_charges, cod_fee, paid_to_bank, parcels, synced_at, fields_seen). Month = `String(paid_at || created_at).slice(0,7)`, which must match `yyyy-MM`. The value is Σ delivery_charges + cod_fee.
  - `erpSfReconByMonth_()` (:8682): COURIER_RECON rows (consignment_id, payout_id, invoice_no, customer, expected, collected, gap, action, amount, note, at, by), bucketed by the month of `at`. `action=='extra'` → extra += amount. `'writeoff'` → short += amount.
- Expenses: `erpExpByCat_(m)` (:8394) = Σ amount by category over non-voided EXPENSES rows of the month. It returns {total, byCat (rounded)}.
- Per month:
  - `netSales = sales − returns`
  - `gross = netSales − cost`
  - `grossMargin = net>0 ? round(gross/net×1000)/10 : 0`
  - `net(profit) = gross + delivery + courierExtra − courierShort − courier − expenses`
  - `netMargin = profit/netSales` (1 dp)
  - All values are rounded. `current = (m == now)`.
- Returns `{months: [...], categories: sorted union of expense categories, generatedAt}`.
- Expense categories in use (ERP.js:6573):
  - fixed: Rent, Salaries & wages, Wi-Fi bill, Software & subscriptions, Loan instalment;
  - recurring: Utilities, SIM card bill, Marketing & advertising, Transport & delivery, Packaging, Bank & platform fees;
  - one-off: Repairs & maintenance, Equipment, Office supplies, Professional fees, Salaries & wages, Marketing & advertising, Miscellaneous.

### 2.3 Server: `erpMoney({days})` (ERP.js:5582-5742)
- `days = round(days)` if >0, else 90. `deadAfter` is always 90, because the UI never sends it. The window starts at `from = days>=9999 ? 0 : now − days×24h`. This is a rolling window, not calendar months.
- Cost map: `book[raw cat|brand|type]` **if the key exists**, else `PRODUCT_MASTER.cost_price || 0`.
- Sales lines from `from` onward:
  - Skip a line if the sku is blank, or if `qty<=0 && total>=0`. Negative return lines are kept and net off.
  - Invoice aggregates: gross (Σ qty×unit_price for total>0), lines (Σ all totals, **including negatives**, unlike erpPnl), and discount = max(col14).
- Per line:
  - `share = leftDisc × total/linesSum`;
  - `net = total<0 ? total : max(0, total − share)`;
  - `known = unitCost>0`;
  - `revenue += net`; `cost += lineCost` if known, otherwise `unknownRevenue += net` and `unknownUnits += qty`.
  - Accumulate into bySku (name and brand from the master, else the sku), byBrand (brand or 'Unknown') and byCat (cat or 'Unknown'). A bucket gets `unknown=true` if any of its lines is uncosted.
- `finish`:
  - units rounded to 2 dp; revenue and cost to integers;
  - `profit = revenue − cost`, which **includes uncosted revenue as profit**;
  - `margin = revenue>0 ? round(profit/revenue×1000)/10 : 0`.
  - Lists are sorted by profit desc.
- Dead stock:
  - Last-sold timestamp per sku over **all** SALES_LOG.
  - For STOCK_VIEW rows with stock>0: `tied = round(unitCost×stock)` and `stockCash += tied`; `since = floor(days since last sale)`, or null if never sold.
  - The row is dead if since is null or > deadAfter. Then `deadCash += tied` and a row {sku, name, brand, cat, stock, unitCost, tied, lastSoldDays} is added.
  - Sorted by tied desc.
- Returns `{days, deadAfter, revenue, cost, profit, margin, unknownRevenue, unknownUnits, products (top 200), brands, categories, dead (top 100), deadCount, deadCash, stockCash, generatedAt 'd MMM yy, h:mm a'}`.

### 2.4 Profitability caveats
- Top-line Gross profit (`MONEY.profit`) counts uncosted sales at 100 % margin. The warning says the opposite ("left out").
- The P&L ("Product cost" uses PM first) and erpMoney (book first) can disagree on cost for the same sale.
- The P&L treats every line of an `RTN-` invoice as a return, even a positive one, in which case returns gets a negative add. erpMoney and the dashboard just net negative lines.
- The P&L uses `uncosted` net sales with no cost ("goods count as free"), so gross profit is overstated by that amount; the footnote says this explicitly.
- Courier charges are bucketed by the payout's `paid_at`. If the cell is a Date object rather than text, `String(date).slice(0,7)` fails the regex and the row is silently dropped.
- All margins are displayed as integer percentages.

---

## 3. PRODUCT COST (`data-view="costs"`)

Nav: group "Goods", button "Product cost" with count badge `#cCosts` (ErpUI.html:514). The badge shows the number of rows edited but not saved (`costDirty`, :8494). Renderer `viewCosts()` (:8157-8321), wiring `wireCosts()` (:8382-8491).

Load: on `go('costs')`, if `!COSTS`, run `loadCosts()` = `erpBundle([['costs']])` (:9939, :9489). The data is cached. Refresh does not reset it.

Client state (:589-592):
- `COSTS` (the book);
- `COST_ERR`;
- `COST_EDIT = {row: {rmb?, bdt?, handling?}}`, raw strings typed, kept across repaints and background refreshes;
- `COST_FILTER = {cats: [], brands: [], q: ''}`.

### 3.1 Data source: the COST_PRICES tab (the "price book")
Header (ERP.js:3493-3499): A `category`, B `brand`, C `type`, D `buy_rmb`, E `buy_bdt`, F `handling`, G `landed_cost` (formula), H `products` (SKU count, system-written), I `typical_sell` (system-written), J `margin_%` (formula), K `updated_at`, L `note`. Settings block: N1 "EDIT THESE"; **O2 = rate (TK per RMB incl. broker)**, **O3 = default handling per unit (TK)** (seeded 0), **O4 = minimum margin %** (seeded 10).

There is one row per **category + brand + type**. Colours share a price.

Formulas written for each new row (ERP.js:3095-3104):
- Landed G: `=LET(h, IF(F="", N($O$3), N(F)), IF(N(D)>0, ROUND(N(D)*N($O$2)+h, 2), IF(N(E)>0, ROUND(N(E)+h, 2), "")))`
  So landed = rmb×rate + handling when RMB is given, else bdt + handling, else blank. A blank handling means "use the default"; an explicit 0 means zero.
- Margin J: `=IF(OR(N(G)=0, N(I)=0), "", ROUND((N(I)-N(G))/N(I)*100, 1))`, i.e. (typical_sell − landed)/typical_sell, on sell price, to 1 dp.

### 3.2 Layout, top to bottom
States:
- `COST_ERR`: `.note.err` "**Could not read the price book.**" plus the error text.
- `!COSTS`: "Loading the price book…".
- `COSTS.missingTab`: `.note.err` "**This business has no COST_PRICES tab yet.** The price book lives in a tab called COST_PRICES. It has not been set up for this sheet."

#### (a) Card "Your buying rate" (:8176-8190)
- Sub: "Your real rate including whatever the broker takes — not the market rate, which is why it is never fetched automatically. Set it once and every price below uses it. Changing it never alters stock you have already bought."
- Inputs, in a row (all `inputmode=decimal`):
  - "TK per RMB" `#ck_rate`, placeholder "e.g. 17.5", value shown only if rate>0;
  - "Handling per unit (TK)" `#ck_handling`;
  - "Minimum margin %" `#ck_margin`.
- **Save** button (primary, `#ck_saveset`):
  - While running it is disabled and reads "Saving…".
  - It calls `erpSaveCostSettings({rate, handling, minMargin})` with trimmed strings.
  - Success: `COSTS = res`, toast "Rate saved. Every price below now uses it.", repaint. Error: toast the message (12 s).
- If rate is not >0: a `.note.err` "**Set your rate first.** Nothing can be costed until the TK-per-RMB rate above is filled in."

#### (b) KPI grid (:8198-8216)
Computed client-side over **all rows**, ignoring the filter. A row counts only if landed>0, sell>0 and margin is not null. Then margin<0 → losing, else margin<minM → under.
1. "Rows priced": "{fmt(priced)} / {fmt(rows.length)}", sub "{N} still blank", or "all filled in".
2. "Losing money": fmt(losing), sub "sold below what it costs".
3. "Under {fmt(minM)}% margin": fmt(under), sub "thin, worth a look".

#### (c) Card "Buying prices" (:8236-8318)
Sub: "One row per brand and type — colours share a price, so they are not listed separately. Type the RMB price; use the taka column only for anything not bought in RMB. Leave handling blank to use the default above. Nothing is saved until you press Save changes."

Filters:
- **Category chips** (label "Category"): one per distinct `category||'Other'` over all rows, sorted alphabetically, each showing a grey count of rows. The chips are multi-select toggles (class `on`). Nothing selected means everything; there is no "All" chip.
- **Brand chips** (label "Brand"): built from rows that pass the category filter (`brand||'Other'`), with counts, sorted. Clicking any category chip **clears the brand selection** (:8408).
- **"Search type"** `#ck_q` (type=search, placeholder "e.g. ASA, PLA+, TPU, nozzle"):
  - case-insensitive substring match on `brand + ' ' + type + ' ' + category`;
  - live, repainting on every keystroke with focus and caret restored (:8415-8422).
- **"Clear filters"** button `#ck_clear`, shown only when any filter is active. It resets COST_FILTER.

Table (scroll-tall): **Brand | Type | SKUs | Buy RMB | or TK | Handling | Lands at | Sells at | Margin**.
- No rows at all: colspan 9 "The price book has no rows yet.". Filter excludes everything: "Nothing matches that filter.".
- Rows keep sheet order. A group-heading row (`tr.grp`, uppercase, muted, plane background) with the category name (or 'Other') is inserted whenever the category changes from the previous shown row. Because rows are in sheet order, a category can appear in more than one block if the sheet is not sorted.
- Cells:
  - Brand; Type (bold `nm`); SKUs = grey fmt(products).
  - **Buy RMB / or TK**: editable inputs `input.i.qty[data-ck=rmb|bdt][data-row=<sheet row>]`. The value is the unsaved edit if any, else the stored value, else blank.
  - **Handling**: an editable input whose placeholder is the default handling.
    - Blank (follows the default): tooltip "Follows the default of {dflt} TK".
    - Value set: the input gets class `pinned` (orange `--serious` border, bold) and tooltip "Set for this row only - the default does not apply here" (:8355-8365).
  - **Lands at**: fmt(landed), or grey "—" if not >0.
  - **Sells at**: fmt(sell), or "—".
  - **Margin** (`marginCell`, :8368):
    - "—" unless landed>0 and sell>0;
    - text = `round(m×10)/10 + '%'` (1 dp);
    - m<0 → red pill, title "You are selling this for less than it costs you";
    - m<minM → amber pill, title "Below your minimum margin";
    - otherwise green pill.
  - Lands at, Sells at and Margin reflect the **saved** sheet values. They do not recalculate live while typing.

Footer row:
- **Save changes** (primary, `#ck_save`).
- **Undo my edits** (`#ck_undo`): `COST_EDIT = {}`, toast "Unsaved edits dropped.", repaint.
- `#ck_dirty` text: "{n} row(s) edited, not saved yet".

Save changes logic (:8448-8483):
- For each row in COST_EDIT that still exists in COSTS.rows, send `{row, category, brand, type}` plus **only the keys actually typed** (rmb, bdt, handling, as raw strings). Rows with no typed keys are skipped.
- If nothing changed: toast "Nothing has been changed yet."
- Call `erpSaveCostRows({rows: list})`. The button shows "Saving…" while it runs.
- Success: `COSTS = res`, `COST_EDIT = {}`. If `res.notFound.length`: error toast "Saved {saved}, but could not find: {list}. Reload and try those again." (15 s). Otherwise toast "Saved {saved} price(s).".
- Edits survive filtering. Rows hidden by a filter are still saved.

### 3.3 Server: `erpCostBook()` (ERP.js:2839-2890)
- If the tab is missing, return `{ok:false, missingTab:true, rows:[], rate:0, handling:0, minMargin:0, priced:0, missing:0}`.
- Otherwise it first runs **`erpCostSync_(sh)`** (errors swallowed). The sync **writes to the sheet on every read**.
- It then reads A2:L(last). Rows are skipped if both category and type are blank. Each row becomes:
  - `{row (sheet row #), category, brand, type,`
  - `rmb/bdt/handling` via `erpCostCell_` (blank → null, else a number),
  - `landed, products, sell` via erpNum_,
  - `margin` (blank → null), and
  - `note: col L}`.
- Config is read from `O2:O4`: rate, handling, minMargin.
- `priced` = rows with landed>0. Returns `{ok, rows, rate, handling, minMargin, priced, missing, added}`.

**`erpCostSync_(sh)`** (ERP.js:3012-3092):
- Reads PRODUCT_MASTER cols 1-15. Only **active** products count: status (col 14) blank or 'active'.
- Grouping key: `[category||'Uncategorised', brand||'-', type||'-']`. Each group counts skus and collects the sell prices that are >0.
- For each key not already in the book (matched case-sensitively and exactly on the A|B|C text), it appends a row: `[cat, brand, type, '', '', handling]`, where handling = `''` (follow the default) if the category starts with "filament" (case-insensitive), else `0`. It then writes the G formula and the J formula.
- For every live key it rewrites H = skus and I = `round(mean of sell prices>0)`, or 0.
- Rows no active product uses keep their prices; H:I are set to 0 when H is not already 0.
- It flushes if anything was added or stale.
- **Note:** the sync matches case-sensitively, but saving matches case-insensitively.

### 3.4 Server: `erpSaveCostSettings({rate, handling, minMargin})` (ERP.js:2896-2917)
- Requires the tab (throws "The COST_PRICES tab is missing from this sheet.").
- Takes the script lock (15 s), else throws "Sheet is busy. Try again in a moment."
- For each of rate→O2, handling→O3, minMargin→O4:
  - a value that is `''`, null or undefined is **skipped** (so a value cannot be cleared through the UI);
  - otherwise `v = erpNum_(value)` (non-numeric text becomes 0);
  - v<0 throws "A negative value does not make sense for {key}.";
  - rate>1000 throws "That rate looks wrong ({v} TK per RMB). Check it before saving.";
  - then `setValue(v)` in column 15.
- Flushes, then returns `erpCostBook()`.

### 3.5 Server: `erpSaveCostRows({rows})` (ERP.js:2926-2997)
- An empty list returns `erpCostBook()`. Takes the script lock (20 s).
- Builds `whereIs`: lower-cased `cat|brand|type` → **first** sheet row with that key (rows are matched by name, not by row number, because rows move).
- For each item: if its key is not found, push "{brand} {type}" to `notFound` and continue.
- For each of `rmb→col D(4)`, `bdt→E(5)`, `handling→F(6)` that is **present** in the item:
  - `val = erpCostCell_` (blank → null);
  - val<0 throws "Handling cannot be negative." or "A price cannot be negative.";
  - write `''` if null, else the number.
- If anything was written: K = stamp `yyyy-MM-dd HH:mm` (Dhaka) and `saved++`.
- Flushes, then returns `erpCostBook()` plus `saved` and `notFound`.
- **Caveat:** a negative value throws partway through the loop. Rows already written stay written, and the client receives an error rather than a partial-success reply. Non-numeric text is saved as 0.

### 3.6 How the price book feeds the other screens
`erpBookCostMap_()` (ERP.js:3154) = `{lower(cat|brand|type): landed}` for landed>0. It is used by the dashboard (unit cost, stock at cost, cover), erpMonthGross_ (dashboard month gross and the Expenses screen), erpPnl and erpMoney, with the precedence differences described in 1.4 and 2.4. The comment at ERP.js:2817 says the book is the **replacement** cost (used to set prices). The actual weighted-average cost of receipts is meant to live in PRODUCT_MASTER.cost_price, which shipment receiving fills (`erpReceiveShipment`, ERP.js:3174+; it falls back to the book when no shipment total is typed).

---

## 4. External dependencies touched by these screens
| What | Where | Used by |
|---|---|---|
| Steadfast courier API `https://portal.packzy.com/api/v1/get_balance` (headers `api-key`, `secret-key`; keys per business in ScriptProperties `ERP_SF_KEY::<sheetId>`, `ERP_SF_SECRET::<sheetId>`) | ERP.js:5927, 5984, 6316 | Dashboard "Steadfast is holding" (cached 30 min in ScriptProperty `ERP_SF_BAL::<sheetId>`) |
| Website (WordPress) `https://costareen.com/wp-json/cz/v1/cod?days=1&limit=1` (header `x-cz-key` = stored sync key) | Code.js:3792, 3852 | Courier balance fallback |
| Nightly Steadfast run result (ScriptProperty `ERP_SF_NIGHT::<sheetId>`); tabs COURIER_PAYOUTS, COURIER_PAYOUT_LINES, COURIER_RECON | ERP.js:11040-11085, 8422-8447 | Dashboard courier alerts, P&L courier rows |
| PDF render service pairing (`ERP_RENDER_URL/pair`), nightly-backup trigger housekeeping | ERP.js:11441, 10981 | Side effects of every `erpBundle` call |
| `ERP_SPEED` (slow-load log), `ERP_ERRORS` (error log) hidden tabs | ERP.js:1992-1999, 4315-4330 | Diagnostics |
| AI/MCP key access: `erpDashboardData`, `erpDaySales`, `erpMoney`, `erpPnl` exposed as 'read' tools via `https://mcp.bendar.duckdns.org/mcp` | ERP.js:11607-11613 | Not part of the UI, but the same functions are reachable by AI keys |

No Drive file access, no exports, and no currency feed happen on these three screens (the rate is typed on purpose).

## 5. Sheet tabs read and written, per screen
| Screen | Reads | Writes |
|---|---|---|
| Dashboard | PRODUCT_MASTER, COST_PRICES (A:G), SALES_LOG, STOCK_VIEW, CUSTOMERS, WEB_ORDERS, MANAGER_QUEUE, EXPENSES, EXPENSE_ITEMS, PAYMENTS, COURIER_RECON, COURIER_PAYOUT_LINES | ERP_SPEED (slow loads), ScriptProperties cache |
| Day picker | SALES_LOG | – |
| Profit | PRODUCT_MASTER, COST_PRICES, SALES_LOG, STOCK_VIEW, EXPENSES, COURIER_PAYOUTS, COURIER_RECON | – |
| Product cost | COST_PRICES (A:L, O2:O4), PRODUCT_MASTER (A:O) | COST_PRICES: new rows plus formulas, H:I on every read; D/E/F/K on save; O2:O4 on settings save |
