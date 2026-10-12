# 02 — Products & Stock (screens `products`, `stock`)

Source files (all paths relative to `scratchpad/sheet-erp/`):
- `ErpUI.html` (client SPA) — cited as `UI:<line>`
- `ERP.js` (ERP server) — cited as `ERP:<line>`
- `Code.js` (legacy sheet logic) — cited as `CODE:<line>`

Scope: the **Products** screen (catalogue, product create/edit form, filters, analytics columns), the **Stock entry** screen (Receive stock, Stock adjustment, Orders to suppliers / purchase orders, To-order plan), the shared product form used from other screens, and every server function they reach. The stock-movement history is loaded for this screen but **never rendered** (see §6.4).

---

## 0. Cross-cutting mechanics (needed to rebuild faithfully)

### 0.1 Client → server transport
- Every call goes through `srv(name, args, ok, bad)` (UI:8060), a **strict one-at-a-time queue** (`SRV_Q`, `srvPump` UI:8065). Each job calls `google.script.run.erpCall(erpToken(), name, args)` (UI:8100-8106); only `erpHello` bypasses.
- Token = `{code, device, label}`: `code` from `localStorage.erp_code`, `device` a random id persisted in `localStorage.erp_device_id`, `label` = first 60 chars of userAgent (UI:8025-8058).
- Watchdog: default 45 s (`SRV_TIMEOUT`); per-function overrides in `SRV_SLOW` (UI:8007-8022) — relevant here: `erpBundle` 120 s, `erpReorderPlan` 180 s, `erpPoCreate` 180 s then **redefined to 90 s later in the same object literal** (last key wins → 90 s), `erpPoArrive` 180 s, `erpPoDiffDecide` 120 s, `erpSelfTest` 180 s, `erpApplyReorderLevels` 180 s, `erpTool` 300 s. Timeout fires the failure handler with "The sheet did not answer within N seconds. It may be busy - press Refresh to try again."
- If a failure message matches `/Unknown action/`, a red fixed "stale page" banner is shown (UI:8083, `staleBanner` UI:9662). The bundle also returns `build`; mismatch with `ERP_BUILD='b261002-0449'` shows the same banner (UI:9672).
- Server side `erpCall(token, fn, args)` (ERP:4285): looks `fn` up in `ERP_ALLOW` (ERP:4177), authenticates, checks `erpRoleAtLeast_`, sets `ERP_SESSION`, invokes, then **scrubs** the result by role (`erpScrub_` ERP:4384). Failures are appended to tab `ERP_ERRORS` (`at, who, role, action, message, build`, trimmed by 200 rows when > 700) (ERP:4318).
- Every server function begins with `erpDoor_()` (ERP:4355) which refuses direct calls not via `erpCall` (except owner-at-keyboard or a real trigger).
- Writes take `LockService.getScriptLock()` (`tryLock` 15 s; 30 s for receive shipment; 20 s for PO create). Lock failure → "Sheet is busy. Try again in a moment."

### 0.2 Roles (ERP:3971)
`owner`(4) > `shareholder`(3) > `manager`(2) > `sales`(1). Client nav gating (`applyRole` UI:9828): `need = {dash:3, costs:3, settings:3, tools:3, profit:3, expenses:3, campaigns:2, weborders:2, stock:2}` — **Products has no minimum (sales can open it); Stock entry needs manager+**. Home screen: rank ≥ 3 → dash, else → products (UI:9861).

Server permissions relevant to this scope (ERP_ALLOW ERP:4177-4210):

| Function | Min role |
|---|---|
| erpBundle, erpCatalog, erpProduct, erpFormOptions, erpDiscontinued | sales |
| erpSaveProduct, erpSetProductStatus, erpReceiveStock, erpReceiveShipment, erpAdjustStock, erpStockHistory, erpSettingsLists, erpReorderPlan, erpPoCreate, erpPoList, erpPoArrive, erpPoLineClose, erpPoClose, erpPoDiffDecide | manager |
| erpPoSettle, erpApplyReorderLevels, erpTool, erpSelfTest, erpCostBook, erpDashboardData | shareholder |

Scrubbing (`erpScrub_` ERP:4384): roles below shareholder get `cost, cost_price, margin, profit, stockValueCost, landed` deleted from every product object in `erpCatalog`, `erpProduct`, and `erpBundle.catalog`; `sales` additionally loses `supplier`. `erpBundle.costs` is removed for < shareholder.

### 0.3 Data loading for these screens
- `loadAll(first)` (final definition UI:9912 — earlier definitions at UI:9554 are overridden by hoisting): `erpBundle(['biz'?, 'dash','catalog','lists','options'])` then `erpBundle(['customers','invoices','history','weborders'])` then `settleEmpties()`.
- `go('stock')` additionally: `loadPlan()` (`erpReorderPlan([{}])`, UI:5432) if `!PLAN && !PLAN_ERR`; `loadPo()` (`erpPoList([])`, UI:5543) if `!PO`; `loadHistory()` (`erpBundle(['history'])`) if `!HIST`. `go('products'|'stock')` → `loadLists()` (`erpBundle(['lists'])`) if `!LISTS` (UI:9481-9490).
- `erpBundle(parts)` (ERP:1944): each section in its own try/catch, returns `{ok, took:{part:ms}, errors:{part:msg}, today, build, <part>:data}`; also runs `erpBackupEnsure_()` and `erpRenderKey_()` best-effort. Uses an in-call memo (`ERP_MEMO`) so each tab is read once. If total > 2500 ms, appends a row to hidden tab `ERP_SPEED` (`at, who, parts, total_ms, took, build, steps`), trimmed by 200 when > 400 rows.
- `applyBundle` (UI:9668) sets `CAT`, `LISTS`, `HIST`, etc.; a failed section sets an empty value plus an `*_ERR` string. `settleEmpties` (UI:9716) guarantees nothing spins forever ("No response for stock movements.").
- Global **Refresh** button (`reloadBtn` UI:9610): clears D/CAT/ORDERS/CUST/WEB/HIST/LISTS and reloads; on stock view also reloads history.
- Business switch (UI:9896) resets `RECV` and `PRODUCT_FORM` (but not `ADJ`, `PONEW`, `POPICK`, `POARR`, `PO`, `PLAN`).

### 0.4 Formatting helpers
- `fmt(n)` = `Math.round(n||0).toLocaleString('en-US')` (UI:631) — every number on these screens is rounded to an integer with thousands commas.
- `esc()` HTML-escapes `& < > "`; `num(v)` = finite Number or 0.
- `toast(html, bad, ms)` default 5 s good / 7 s bad (UI:657).
- Pills (CSS UI:199-203): `.pill.ok` green (`--good`/`--good-soft`), `.pill.low` amber (`--warning`), `.pill.out` red (`--critical`), plain `.pill` grey. Light tokens: good `#16a34a`/`#e7f6ec`, warning `#d97706`/`#fdf1df`, critical `#dc2626`/`#fdeaea`, series-1 `#2f6fed`. Dark theme tokens at UI:34-44.
- `.sku` = small muted text; `.scroll.tall` = scrolling table with sticky header, max-height `clamp(300px, 100vh-300px, 1400px)` (UI:197).

---

## 1. Data model (sheet tabs touched)

### 1.1 PRODUCT_MASTER (header CODE:186; 17 columns A–Q)
| Idx | Col | Field | Notes |
|---|---|---|---|
|0|A|sku| key, matched trimmed + case-insensitive everywhere |
|1|B|product_name| |
|2|C|category| validation from SETTINGS A (allow invalid) |
|3|D|brand| SETTINGS B |
|4|E|type| SETTINGS C |
|5|F|color| SETTINGS F |
|6|G|unit| SETTINGS E, default `Piece` |
|7|H|supplier| SETTINGS D |
|8|I|cost_price| **weighted-average landed cost**, rewritten by receipts |
|9|J|sell_price| |
|10|K|margin_pct| formula `=IF(Jr>0,(Jr-Ir)/Jr*100,0)` — rewritten on every edit/create |
|11|L|reorder_level| |
|12|M|lead_time_days| |
|13|N|location_bin| |
|14|O|status| `Active`/`Discontinued` (validation strict) |
|15|P|date_added| set on create |
|16|Q|notes| |

### 1.2 TXN_LOG (CODE:233; 13 columns) — the stock ledger
`txn_id, timestamp, sku, product_name, txn_type, direction, quantity, unit_price, total_value, reference, supplier, operator, notes`.
- `txn_type` values used: `RECEIVE, SALE, RETURN, DAMAGE, ADJUSTMENT, OPENING` (validation) **plus `ADJUST`** written by the ERP for stock-out adjustments (ERP:1365) — not in the validation list (sheet validation is "allow invalid = false", but `appendRow` from script bypasses).
- `direction` IN/OUT. Stock on hand = Σ IN − Σ OUT.
- `txn_id` = `TXN-yyyyMMdd-<random 1000-9999>` (CODE:79) — not guaranteed unique.

### 1.3 STOCK_VIEW (v5 layout, 22 columns; CODE:2358) — a materialised view rebuilt by `refreshStockView()`
`0 sku, 1 product_name, 2 category, 3 brand, 4 type, 5 color, 6 total_received, 7 total_out, 8 current_stock, 9 reserved_stock, 10 incoming_stock, 11 available_stock, 12 reorder_level, 13 stock_status, 14 low_stock_alert, 15 cost_price, 16 stock_value_cost, 17 sell_price, 18 stock_value_retail, 19 last_received, 20 last_sold, 21 status`.
(The original v3 setup header at CODE:255 has 18 columns in a different order; it is overwritten by `ensureStockViewV5_` on every refresh.)

### 1.4 SETTINGS lists (columns A–F) — dropdown sources
A categories, B brands, C types, D suppliers, E units, F colors (G payment_methods; I/J config). Seed values CODE:157-174.

### 1.5 SALES_LOG (read only here)
Used columns: 0 order_id, 1 timestamp, 5 sku, 7 quantity.

### 1.6 Purchase-order tabs (created on demand, ERP:7834-7857)
- `PURCHASE_ORDERS`: `po_id, ordered_at, sku, product, qty, received, ship_by, note, status, ordered_by, closed_at, rmb_unit, rmb_rate, supplier` — one row per line. `status` ∈ `open` | `arrived` | `closed: <reason>`. Header self-upgrades if older (ERP:7875).
- `PO_SHIPMENTS`: `po_id, shipment_no, agent, ship_by, weight_kg, shipping_bdt, arrived_on, lines, units, received_by, recorded_at`.
- `PO_DIFFS`: `diff_id, po_id, supplier, sku, product, kind, qty, rmb_unit, rmb_value, unit_bdt, status, created_at, decided_at, decided_by, settled_at, note`. `kind` ∈ `extra|wrong|short`; `status` ∈ `open|i_owe|free|returned|supplier_owes`.

### 1.7 Other tabs read
- `COST_PRICES` (price book): key cols A category, B brand, C type; **G (idx 6) = landed cost TK**; cell **O2 = usual TK/RMB rate** (O3 handling default, O4 min margin). Read by `erpBookCostMap_` (ERP:3154) — only rows with landed > 0.
- `SALES_ENTRY`, `MANAGER_QUEUE` (reserved/incoming quantities for STOCK_VIEW), `WEB_ORDERS` (pending web qty for website push).

---

## 2. Stock derivation & status rules (server)

### 2.1 `refreshStockView()` (CODE:2468)
Runs after almost every write here, and hourly if the `enableAutoDashboard` trigger is on (CODE:2881).
1. Reads PRODUCT_MASTER (≥22 cols) and TXN_LOG (13 cols).
2. Per SKU (trimmed, **case-sensitive Map key here**): `in` = Σqty where direction IN; `out` = Σqty where OUT. `lastIn` = latest timestamp of IN rows whose type is RECEIVE or OPENING; `lastOut` = latest of OUT rows with type SALE.
3. `reserved` = `getReservedStockMap_()` (CODE:2400): SALES_ENTRY rows with qty>0, no `converted_invoice`, status ∈ {pending, confirmed, reserved, approved, processing}; plus MANAGER_QUEUE rows with issue_type ∈ {reserved, manual_review, pending} and status ∈ {pending, open, approved, reserved}.
4. `incoming` = `getIncomingStockMap_()` (CODE:2443): MANAGER_QUEUE rows with issue_type `incoming` and status ∈ {pending, open, approved, ordered}. (PURCHASE_ORDERS is **not** used here.)
5. Row per PRODUCT_MASTER product:
   - `current = in − out`; `available = current − reserved`.
   - `reorderLevel = Number(PM.L) || 5` → **a stored 0 or blank becomes 5**.
   - `stock_status = available<=0 ? 'OUT OF STOCK' : available<=reorderLevel ? 'REORDER' : 'IN STOCK'`; `low_stock_alert = available<=reorderLevel ? 'YES':'NO'`.
   - `stock_value_cost = current*cost`, `stock_value_retail = current*sell`, `status = PM.O`.
6. Clears and rewrites the whole view; applies conditional formats (OUT red `#FFCDD2/#B71C1C`, REORDER yellow `#FFF9C4/#F57F17`, IN STOCK green `#C8E6C9/#1B5E20`, alert YES `#FFEBEE`).

### 2.2 `erpOnHandMap_()` (ERP:3135)
Independent on-hand from TXN_LOG (lower-cased SKU): +qty unless direction is `OUT`. Used for discontinue refusal, weighted-average cost, and "free bonus" cost correction.

### 2.3 `checkStock(sku)` (CODE:3244)
Reads STOCK_VIEW only (no recalculation): returns `currentStock` (col 8), `availableStock` (11), etc. Used by stock-out adjustments.

---

## 3. Catalogue analytics — `erpCatalog()` (ERP:649)

Returns one object per **STOCK_VIEW row** (a product in PRODUCT_MASTER but not yet in STOCK_VIEW is invisible until the next refresh). Sorted by `name` ascending (ERP:733).

Inputs:
- PRODUCT_MASTER map: name, cat, brand, type, color, unit, supplier, sell (J), `lead` (M), `status` (O, default `Active`).
- SALES_LOG: every row with a non-blank order_id and sku (no status filtering — cancelled/returned rows still count as sold). Per SKU: `all`, `d30`, `d90`, `d180`, `d365` (age in days ≤ window, age = (now − timestamp)/86400000), `last` = latest sale ms.
- STOCK_VIEW: `stock` = col 8 (current), `available` = col 11 (falls back to stock if blank), `reorder` = col 12 (already 5-defaulted), `sell` = col 17 or PM sell.

Derived fields (exact):
```js
state     = stock <= 0 ? 'out' : (rl && stock <= rl ? 'low' : 'ok');      // uses CURRENT stock, not available
rate      = d90 > 0 ? d90/90 : (d365 > 0 ? d365/365 : 0);                 // units/day
cover     = rate > 0 ? Math.round(stock / rate) : null;                    // days of stock
lead      = PM.lead > 0 ? PM.lead : 7;
safety    = Math.max(1, Math.ceil(lead * 0.5));
suggested = rate > 0 ? Math.max(1, Math.ceil(rate * (lead + safety))) : 0; // "Should be" reorder level
lastSoldDays = last ? Math.floor((now - last)/86400000) : null;
```
Output fields: `sku, name, cat, brand, color, unit, supplier, stock, available, reorder, sell, state, status, sold (lifetime, rounded), sold30, sold90, sold365, rate (3 dp), cover, lead, suggested, lastSoldDays`. (No cost field is returned, so nothing needs scrubbing except supplier for sales.)

Note: name/cat/brand/color prefer PRODUCT_MASTER values, falling back to STOCK_VIEW copies.

---

## 4. Screen: PRODUCTS (`data-view="products"`)

Nav button UI:512 with a count badge `#cProducts` that is **always blanked** (`updateCounts` UI:9437). Page title = nav label.

### 4.1 Render (`viewProducts` UI:1103)
Loading state: `CAT === null` → "Loading products…" (centred muted).

Card 1 (one `<section><div class="card">`):

**Filter row** (five controls, in order):
| # | Label | id | Type | Options / behaviour |
|---|---|---|---|---|
|1|Search|`pq`|search input, placeholder "Name, SKU, brand or colour"|case-insensitive substring over `name+' '+sku+' '+brand+' '+color+' '+cat`; on `input` repaints table only (keeps focus) |
|2|Category|`pcat`|select|"All categories" (value "") + distinct non-empty `p.cat` from CAT, alphabetically sorted; table-only repaint |
|3|Product list|`pstatus`|select|`active` "Active products" (**default**), `discontinued` "Discontinued", `""` "All"; full repaint |
|4|Movement|`pmove`|select|see 4.2; full repaint |
|5|Availability|`pstate`|select|`""` All, `ok` In stock, `low` At reorder, `out` Out of stock; table-only repaint |

Filter state persists in memory (`pFilter`, UI:1101) across navigation within the session; default `{q:'', cat:'', state:'', status:'active', move:''}`.

**Counter row**: left "`<n> of <total> products`" (n = filtered rows, total = CAT.length); right button **"+ New product"** (`#newProduct`, primary).

**Product form** (inline card, see §5) is inserted here when `PRODUCT_FORM` is set **and has no `returnTo`**.

**Table** (`.scroll.tall`, sticky header). Columns in order:
| Header | Class | Cell |
|---|---|---|
|Product| nm | name, line break, `.sku` small: `SKU` + (` · colour` if colour) |
|Category| | `cat` or `—` |
|Brand| | `brand` or `—` |
|In stock| num | `fmt(stock)` (current stock, may be negative) |
|Sold ever| num | `fmt(sold)` |
|Sold 90d| num | `fmt(sold90)` |
|Days cover| num | `coverCell` (below) |
|Reorder at| num | `fmt(reorder)` or `—` if 0 |
|Should be| num | `suggestCell` (below) |
|Price| num | `fmt(sell)` or `.sku` "no price" |
|Status| | `stateBadge(state)` |
|(actions)| num, nowrap | buttons (below) |

No column sorting UI. Row order = **stock descending** (`(y.stock||0)-(x.stock||0)`, UI:1229), ties keep server name order.

Empty state: single row `<td colspan="10">` "No product matches that search." (note: colspan 10 although there are 12 columns).

`coverCell(p)` (UI:705):
- `rate` not > 0 → `.sku` "never sold" if `sold===0`, else "no recent sales".
- cover null → "—".
- `cover <= 7` → red pill "`N days`"; `<= 30` → amber pill; else plain "`N days`".

`suggestCell(p)` (UI:695) — "Should be":
- `rate` not > 0 → `.sku` "no sales".
- `suggested === reorder` → green pill `N`.
- `suggested > reorder` → red (`.pill.out`) "`N ↑`" (stored level too low).
- `suggested < reorder` → muted "`N ↓`" (stored level too high).

`stateBadge(st)` (UI:717): `out` → red "✕ Out of stock"; `low` → amber "▲ Reorder"; else green "✓ In stock".

Action buttons per row:
- **Add** (`data-add`) — only if `stock > 0 && sell > 0`. Calls `addToCart(sku)` (UI:2008: push `{sku,name,price:sell,qty:1,discEach:0,stock,cat}` or +1 qty if already in cart) and toasts "Added to the invoice. Open New Invoice" with a link that `go('invoice')`.
- **Edit** (`data-edit`) — always. Loads lists if missing, calls `erpProduct(sku)`; null → toast "Product not found in PRODUCT_MASTER." (error); success → `PRODUCT_FORM = p; p.isNew=false`, repaint, scroll to top. Failure toast "Could not open that product: …".
- **Reactivate** (`data-active`) — if `status` is discontinued (case-insensitive).
- **Discontinue** (`data-disc`, danger red) — only if not discontinued **and `state === 'out'`**.
  Both use `window.confirm("Mark as discontinued: <SKU>?")` / `"Bring back as active: <SKU>?"` then `erpSetProductStatus(sku, 'Discontinued'|'Active')`; success toast "**SKU** is now Status." and full reload (`CAT=null; D=null; loadAll()`); failure toast "Could not change the status: …" (10 s).

Card 2: **Diagnostics** — heading, sub "Times every part of the load and shows exactly which one is slow or failing.", button "Run diagnostics" (`#selfTestBtn`), output div `#selfTestOut`. **The button is only wired by `wireTools()` (UI:7894), which runs on the Tools view; on the Products screen the button does nothing.** (When wired, it calls `erpSelfTest` and renders a table Section / Time (ms) / Rows / Result with ✓ OK green or ✕ error red pills — UI:9943.)

### 4.2 Movement filter (`filteredProducts` UI:1189) — exact rules
Applied before status/category/availability/search:
| value | Label | Keep row when |
|---|---|---|
|`""`|All products|always|
|`urgent`|Running out (under 14 days)|`rate>0` and `cover!=null` and `cover<=14`|
|`cover30`|Under 30 days of stock|`rate>0` and `cover!=null` and `cover<=30`|
|`dead90`|Dead stock - 3 months|`stock>0` and `lastSoldDays>=90` (null lastSoldDays treated as 1e9 → included)|
|`dead180`|Dead stock - 6 months|same with 180|
|`dead365`|Dead stock - 1 year|same with 365|
|`never`|Never sold|`sold` is 0 (no stock condition)|
|`levellow`|Reorder level too LOW|`rate>0` and `suggested > reorder`|
|`levelhigh`|Reorder level too HIGH|`rate>0` and `suggested < reorder`|

Then: status filter (`status` blank treated as Active): `active` hides discontinued; `discontinued` keeps only discontinued. Category exact match. Availability `p.state === value`.

### 4.3 Role differences on Products
- Sales can open it and see every column (no cost columns exist). `supplier` scrubbed from data.
- Buttons are **not** hidden by role: sales sees New product / Edit / Discontinue, but `erpSaveProduct`/`erpSetProductStatus` are manager+ → server error "Your account does not have access to that." `erpSettingsLists` is manager+ via direct call, but the UI loads lists via `erpBundle(['lists'])` (sales-allowed), so sales still gets dropdowns.
- **Bug to be aware of:** for manager (and sales), `erpProduct` returns the record with `cost_price` deleted; the form shows Cost price 0 and on save sends `cost_price: undefined` → server `erpNum_` → **writes 0 into PRODUCT_MASTER.I**, wiping the weighted-average cost. Rebuild should not write cost when the editor cannot see it.

---

## 5. Product form (create / edit) — shared component

`blankProduct()` (UI:5096) defaults:
`{isNew:true, returnTo:null, sku:'', product_name:'', category:'', brand:'', type:'', color:'', unit:'Piece', supplier:'', cost_price:0, sell_price:0, reorder_level:5, lead_time_days:0, location_bin:'', status:'Active', opening_stock:0}`.

`productFormHtml()` (UI:5114): card with blue border (`--series-1`).
- Title: "New product" or "Edit <SKU>".
- Sub: new → "Leave the SKU blank and the sheet will generate one from category, brand, type and colour."; edit → "SKU cannot be changed — it is the key every other tab joins on."
- Fields (grid `.fields`, in order):

| Label | id | Type | Source / default | Notes |
|---|---|---|---|---|
|SKU|pf_sku|text|''|disabled on edit|
|Product name *|pf_name|text (spans 2 cols)|''|required (client + server)|
|Category|pf_cat|select|`LISTS.categories`| |
|Brand|pf_brand|select|`LISTS.brands`| |
|Type|pf_type|select|`LISTS.types`| |
|Colour|pf_color|select|`LISTS.colors`| |
|Unit|pf_unit|select|`LISTS.units`, default `Piece`| |
|Supplier|pf_sup|select|`LISTS.suppliers`| |
|Cost price|pf_cost|number min 0 step 1|0| |
|Sell price|pf_sell|number min 0 step 1|0| |
|Reorder level|pf_reorder|number min 0 step 1|5| |
|Lead time (days)|pf_lead|number min 0 step 1|0| |
|Location / bin|pf_bin|text|''| |
|Status|pf_status|select|`['Active','Discontinued']`|has a blank "—" option too|
|Opening stock|pf_open|number min 0 step 1|0|**only when new**|

- Every select is built by `opts(list, val)` (UI:5102): first option `""` "—"; a current value not in the list is appended as "`<val> (not in SETTINGS)`" selected (so `Piece` shows that suffix if SETTINGS has no `Piece`).
- Warning note (▲) when cost is 0: "Cost price is 0. Profit and margin stay switched off everywhere until it is set."
- Buttons: **Cancel** (`PRODUCT_FORM=null`, repaint) and primary **Create product** / **Save changes**; shows "Saving…" disabled while `BUSY==='product'`.
- Binding (`wireProductForm` UI:5153): text/select via `input` event; numbers via `num()`.

`saveProduct()` (UI:5174):
1. Blank name → toast "Product name is required."
2. `returnTo` branch (draft-only; nothing saved yet):
   - `'receive'` → pushes `{sku:'', isNew:true, product:<copy>, name, qty:max(1, opening_stock||1), stock:0}` into `RECV.lines`; toast "Added to this shipment. It is created when you press Receive." **(But see §6.1: receive never sends these drafts to the server.)**
   - `'pox'` → pushes into the open order's `extras` for `POX_FOR`; toast "Added to this box. It joins the product list when you add the box to stock."
   - `'po'` → pushes into `PONEW.lines` (creating `PONEW` if needed); toast "Added to the order. It joins the product list when you save the order."
   - `'invoice'` with opening_stock ≤ 0 → toast "Give it an opening stock figure, or it cannot go on an invoice yet."
3. Otherwise `erpSaveProduct(PRODUCT_FORM)`; success toast "Product created · SKU **X**" or "Saved **X**"; if `returnTo` ('invoice') → `attachNewProduct` (re-pull `erpCatalog`, add to cart / receive list, reload dashboard); else full reload. Failure: "Could not save: …" (12 s).

`quickStart(target, seed)` (UI:7928) opens the same form with `returnTo=target` and `product_name=seed`; `quickCardHtml(target)` renders it only in the matching place.

### 5.1 `erpProduct(sku)` (ERP:1190)
Linear scan of PRODUCT_MASTER (case-insensitive trimmed SKU). Returns `{row, sku, product_name, category, brand, type, color, unit, supplier, cost_price (I), sell_price (J), reorder_level (L), lead_time_days (M), location_bin (N), status (O, default 'Active')}` or null.

### 5.2 `erpSaveProduct(data)` (ERP:1225)
Validation: data required; name required ("Product name is required."); `sell_price` or `cost_price` < 0 → "Prices cannot be negative." Lock 15 s.
- **Create** (`data.isNew`): calls `addProductAPI({...})` with `unit||'Piece'`, numbers via `erpNum_`, `status||'Active'`, `opening_stock`. Error → "SKU already exists: …" or "Could not add the product.". Then `refreshStockView()`. Returns `{ok, sku, created:true}`.
- **Update**: `erpProduct(data.sku)`; not found → "Product not found: X". If changing status to Discontinued from something else → `erpRefuseDiscontinue_`. Writes columns B–J individually, rewrites K formula, L, M, N, O (`status||'Active'`, `unit||'Piece'`). Flush, `refreshStockView()`. Returns `{ok, sku, created:false}`.

### 5.3 `addProductAPI(data)` (CODE:1716) — creation rules
- `sku = data.sku || generateSKU_(category, brand, type, color)` — a supplied SKU is used verbatim (trimmed by the caller, case preserved).
- Duplicate check: case-insensitive vs all PRODUCT_MASTER SKUs → `{success:false, error:'SKU already exists: X'}`.
- Appends 17 values: `[sku, name, category, brand, type, color, unit||'Piece', supplier, cost||0, sell||0, '', reorder_level || 5, lead_time_days || 7, location_bin, status||'Active', now, notes]`, then the margin formula in K. **`||` means 0 reorder → 5 and 0 lead → 7.** (So the form's default lead 0 is stored as 7.)
- If `opening_stock > 0`: TXN_LOG row `[txnId, now, sku, name, 'OPENING', 'IN', qty, cost, qty*cost, 'API - New Product', supplier, 'n8n-agent', '']`.

### 5.4 SKU generation `generateSKU_` (CODE:90)
```
catCode  = SKU_PREFIX[category] || category.substring(0,3).toUpperCase()
   SKU_PREFIX: Filaments FIL, Printers PRT, Accessories ACC, Parts PTS, Consumables CON, Tools TLS
brdCode  = BRAND_CODE[brand] || brand.substring(0,3).toUpperCase()
   BRAND_CODE: Sunlu SUN, Bambulab BAM, Creality CRE, eSUN ESN, Polymaker PLY, BIQU BIQ, Jamg He JHE
typeCode = type.replace(/[^A-Za-z0-9+]/g,'').substring(0,5).toUpperCase()
clrCode  = color.substring(0,3).toUpperCase()
prefix   = catCode-brdCode-typeCode-clrCode-
seq      = 1 + max(trailing integer of existing SKUs that startWith(prefix)), padded to 3 digits
```
e.g. `FIL-SUN-PLA+-BLA-001`. Blank parts yield empty segments (e.g. `---BLA-001`). Prefix match is case-sensitive.

### 5.5 `erpSetProductStatus(sku, status)` (ERP:1856)
Only `Active`/`Discontinued` ("Status must be Active or Discontinued."); blank SKU → "Which product?". Discontinuing calls `erpRefuseDiscontinue_`. Writes PM column O. Does **not** refresh STOCK_VIEW (its status column goes stale until the next refresh; the catalogue reads status from PM so the UI is correct).

`erpRefuseDiscontinue_(sku, name)` (ERP:1846): if `erpOnHandMap_()[sku] > 0` → error "`<name>` still has N in stock, so it cannot be discontinued yet. Sell what is left, or remove it with a stock adjustment if it is damaged or lost, then discontinue it."

Discontinued products: hidden by default on Products; excluded from the Receive search results; excluded from the To-order plan; still listed in the Adjustment dropdown and PO datalists.

---

## 6. Screen: STOCK ENTRY (`data-view="stock"`, manager+)

`viewStock()` (UI:5442). Loading: `CAT === null` → "Loading stock…". Sections in order: (1) Receive stock, (2) Stock adjustment, (3) Orders to suppliers, (4) To order.

### 6.1 Receive stock (local / ad-hoc receipts)
Heading "Receive stock"; sub: "For goods that were not on an order — a local purchase, a sample. Goods from a supplier order are checked in under **Orders to suppliers** below."
If `LISTS_ERR`: red note "Could not read the SETTINGS lists." + message.

Header fields:
| Label | id | Type | Notes |
|---|---|---|---|
|Supplier|rv_sup|text with datalist `l_sup` (LISTS.suppliers), placeholder "Supplier name"|free text|
|Shipment reference|rv_ref|text, placeholder "Invoice or shipment no."|**required by server**, not validated client-side|
|Notes|rv_notes|text| |

`recvPoBanner()` (UI:5725): only if `RECV.poId` — "Receiving against order X…" with "Not from an order" button. **`RECV.poId` is never set to a non-empty value anywhere in the UI, so this banner is dead code.**

**"What did this shipment cost?"** chips (`recvCostHtml` UI:5285), `RECV.mode`:
- `none` "Use the price book" (default)
- `rmb` "Imported — RMB": fields "Total on the supplier invoice (RMB)" (`rv_rmb`, placeholder e.g. 4800), "Rate for THIS shipment (TK per RMB)" (`rv_rate`, placeholder = price-book rate `COSTS.rate` if loaded else "e.g. 17.5"), checkbox "Make this my usual rate" (`rv_saverate`, default checked). Selecting the chip pre-fills rate from `COSTS.rate` if empty (COSTS is only loaded if the Product cost screen was visited — shareholder+).
- `bdt` "Local — taka": "Total paid for this shipment (TK)" (`rv_bdt`, placeholder e.g. 62000).

**"Shipping paid on arrival"** chips (`recvShipHtml` UI:5755), `RECV.ship.mode`: `none` None, `Sea`, `Air`, `total` "Type the total".
- Sea/Air: "Weight (kg)" (`rv_kg`; placeholder = `recvKgGuess()` "+ (filament × 1.3)" when **every** line's product category matches /filament/i → Σqty×1.3 rounded 0.1, else "kg"), "Taka per kg" (`rv_krate`, placeholder default `SHIP_RATE = {Sea:250, Air:770}`), live "Shipping" total `round(kg × (rate || SHIP_RATE[mode]))`.
- total: "Shipping paid (TK)" (`rv_shiptot`).
- `recvShipNote()` = e.g. `"sea 12 kg @ 250"` (empty for none/total).

**Add product**: label + button "+ New product" (`newProductStock` → `quickStart('receive','')`), search input `rv_search` "Search by name, SKU or brand", results box `rv_results` (`paintRecvResults` UI:6135):
- Empty query → "Start typing to find a product."
- Matches: non-discontinued, substring on `name sku brand color`, max 40; each row shows name, `SKU · N in stock`, state badge; click → add line `{sku, name, qty:1, stock}` or +1 if already listed.
- Always appended: "+ Create new product “query”" / "A SKU you have never received before" → `quickStart('receive', q)`.
- The product form renders below the search when `returnTo==='receive'`.

**Lines table** (if any): columns Product (name + SKU, or amber pill "new product — not saved yet" with row tint `grp-new`), In stock now (`—` for new), Receiving (number input min 1, on change → `max(1, round)`), Remove (danger). Buttons **Clear** (empties lines) and primary **Receive N product(s)** ("Receiving…"). Under them `recvCostSummary()` (UI:5324): if a total & units: "Shipment total **X TK** across N unit(s) — about **Y TK** each on average · at R TK/RMB. Freight and the broker are already inside this figure, so the handling default is not added again."; otherwise "Each line will be costed from the price book." (mode none) or "Enter the shipment total and each line will be costed from it."
Empty state: "No products added yet."

**Save** (UI:6078): `erpReceiveShipment({supplier, reference, notes, mode, totalRmb, rate, totalBdt, saveRate, shippingBdt: recvShipBdt(), shipNote, poId, lines: RECV.lines.map(l => ({sku:l.sku, qty:l.qty}))})`.
- **Draft new products are lost here**: only `{sku, qty}` is sent, so a new-product line (sku '') is dropped by the server filter; if it was the only line the server errors "Add at least one product with a quantity."
- Success toast "Received N unit(s) across M product(s) · shipping X spread into the cost." (10 s); `RECV` reset to `{supplier (kept), reference:'', notes:'', lines:[]}` (mode/ship/rate fields dropped → default none); reload PO, catalogue, history, dashboard, plan.
- Failure toast "Receive failed: …" (12 s).

#### `erpReceiveShipment(payload)` (ERP:3174) — the costing engine
1. Lines kept if `qty > 0` and (`sku` or `isNew`). None → "Add at least one product with a quantity."
2. `reference` required → "Enter the shipment or invoice number. It is what ties these items together as one shipment."
3. `shipping = round2(shippingBdt)`; < 0 → error.
4. Mode `rmb`: totalRmb > 0 required; rate > 0 required; rate > 1000 → "That rate looks wrong (R TK per RMB)."; `totalBdt = totalRmb × rate`. Mode `bdt`: totalBdt > 0 required. Mode `none`: totalBdt = 0.
5. Lock 30 s. Resolve lines: existing SKUs must exist ("Product not found: X"); new products need a name and a non-colliding SKU — **checked for all lines before creating anything**. New products created via `addProductAPI` with `status||'Active'` and `lead_time_days` defaulting to **60**.
6. Unit cost per line:
   ```
   key   = category|brand|type (lower-cased, raw blanks as '')
   basis = line.unitBdt || book[key] || PM cost || new-product cost_price || 0
   weight_i = basis_i × qty_i ; sumW = Σweights ; sumQty = Σqty
   shipShare_i(per unit) = shipping>0 ? (sumW>0 ? shipping×w_i/sumW : shipping×q_i/sumQty)/q_i : 0
   if totalBdt>0: unit_i = (sumW>0 ? totalBdt×w_i/sumW : totalBdt×q_i/sumQty)/q_i
   else:          unit_i = line.unitBdt || book[key] || PM cost || 0
   cost_i = round2(unit_i + (unit_i>0 || shipShare>0 ? shipShare : 0))
   ```
7. Note stamp: notes + `| RMB T @ R TK/RMB` or `| local, TK X` + `| shipping TK S (shipNote)` + `| order PO-…`.
8. Writes TXN_LOG rows `[txnId, now, sku, name, 'RECEIVE', 'IN', qty, cost_i, round2(cost_i×qty), reference, supplier, erpOperator_(), stampNote]` in one `setValues`. `erpOperator_` = active user email or `'erp'` (not the ERP person name).
9. Weighted average into PM.I for lines with cost > 0: `had = max(0, onHand before)`; `avg = (old>0 && had>0) ? (had×old + qty×cost)/(had+qty) : cost`, round 2 dp.
10. If mode rmb, rate > 0 and `saveRate` → writes rate to `COST_PRICES!O2`.
11. `erpPoReceived_(poId, lines)` (best-effort) and `refreshStockView()`.
12. Returns `{ok, reference, received: updated.length || lines.length, units, shipping, createdProducts, lines:[{sku, product, qty, unitCost, wasCost, nowCost, hadStock}], totalCost, rate, rateSaved, costed: 'shipment total'|'price book'}`.

(Legacy `erpReceiveStock` ERP:1299 — per-line `recordReceiveAPI` with zero cost, operator `n8n-agent` — is allowed by the server but **not called by the UI**.)

### 6.2 Stock adjustment
Heading "Stock adjustment"; sub "For damage, loss, found stock, or when the shelf does not match the screen — anything that is not a sale. Type how many to add or take away."
| Label | id | Type | Options/default |
|---|---|---|---|
|Product (span 2)|aj_sku|select|"Choose a product" + every CAT item (incl. discontinued) as "`name · SKU (stock)`", in server name order|
|Direction|aj_dir|select|`IN` "Stock IN (return / found)" (default), `OUT` "Stock OUT (damage / loss)"|
|Quantity|aj_qty|number min 1 step 1|1; on change `max(1, round)`|
|Reason * (span 2)|aj_reason|text, placeholder "Damaged in transit, customer return, recount…"|required|

Live line (when a product is chosen): "`<name>` currently has **N** in stock" + red " — cannot remove Q" if OUT and Q > stock.
Button "Record adjustment" ("Saving…"). Client validation: "Choose a product.", "A reason is required." (`ADJ.notes` exists but has no field.)
Success toast "Recorded IN|OUT Q · Product."; resets ADJ (keeps direction); reloads catalogue, history, dashboard, plan. Failure "Adjustment failed: …".

#### `erpAdjustStock(payload)` (ERP:1333)
Validation: sku ("Choose a product."), qty > 0 ("Quantity must be at least 1."), reason ("A reason is required for a stock adjustment."). Lock 15 s.
- **IN** → `recordReturnAPI(sku, qty, reason, notes)` (CODE:1692): TXN row `[txnId, now, sku, name, 'RETURN', 'IN', qty, 0, 0, reason, '', 'n8n-agent', notes]` (unit price 0, operator hard-coded `n8n-agent`). Error "Product not found: X".
- **OUT** → `checkStock(sku)` from STOCK_VIEW; `qty > currentStock` → "Only N in stock for Name." (uses current, not available); TXN row `[txnId, now, sku, name, 'ADJUST', 'OUT', qty, 0, 0, reason, '', <active user email>, notes]`.
- Then flush + `refreshStockView()`. Returns `{ok, txnId, product, direction, qty}`.
- No cost/average change on adjustments.

### 6.3 Orders to suppliers (purchase orders) — `poListHtml` (UI:5642)
Shown if `poCanOrder()` (role manager/shareholder/owner) or there are open orders. Heading "Orders to suppliers" + amber pill "N on the way"; button "+ New order" (`po_start`) when allowed and no draft open. Sub: "Write the order down when you place it. When a box arrives, tick the lines that match, type the number where it does not, and add it to stock. Anything short or extra stays marked until you decide what to do."
Loading: "Reading the orders…". Empty: "Nothing is on the way." `loadPo` failure silently sets `PO={orders:[]}`.

**Open questions block** (`poMattersHtml` UI:5615), above the orders:
- Differences (`PO.differences`): amber note "N thing(s) arrived that were not what was ordered. They are already in stock. Say what each one is:" — table rows: product + `SKU · PO-id`; amber pill "`Q more than ordered`" (kind extra) or "`Q not ordered at all`" (wrong) + "worth RMB X"; buttons (manager+) **Keep — I pay for it** (`pay`), **Keep — free bonus** (`free`), **Not mine — take out** (`return`), each with a confirm ("Keep it and pay the supplier for it?" / "Keep it as a free bonus? It will cost nothing, so that product's average cost comes down." / "Not yours? It will be taken out of stock again.") → `erpPoDiffDecide({diffId, decision})`.
- Supplier balances (`PO.balances`): note "৳ **Supplier** — owes you RMB X / you owe RMB X / you are even (they owe A, you owe B)" + item list "`product × qty what (RMB v, PO)`"; **Settled** button only for owner/shareholder → `window.prompt` "How? (refunded, paid, deducted from the next order …)" (blank → "Say how it was settled.") → `erpPoSettle({supplier, note})`.

**New order draft** (`poNewHtml` UI:5575; state `PONEW = {lines, rate, ship:POSHIP, note, supplier}`):
- Lines table: Product (name + SKU or amber "new product"), Quantity (number min 1), RMB each (decimal), Line RMB (`qty×rmb` 2 dp, live), Remove. Empty: "No products on this order yet."
- "Add a product from your list" (`pn_search`, datalist of all CAT as "`name · SKU`"; on change matches exact label or SKU case-insensitive; duplicate → "X is already on this order."). "+ New product" → `quickStart('po')`.
- Fields: Supplier (`pn_sup`, datalist suppliers, placeholder "Who you bought from"), "Rate you paid TK per RMB" (`pn_rate`, e.g. 17.2), "Coming by" (`pn_ship` Sea/Air; remembered in `POSHIP` for the next draft), Note (span 2, "Supplier, paid on …, agent …").
- Summary (`poSumText`): "`N piece(s) · RMB X · about BDT Y before shipping`" (Y = round(rmb×rate)).
- Cancel (confirm "Throw this order away? Nothing has been saved." if lines) / **Save order** (disabled when no lines or saving).
- Save validation: at least one qty > 0 ("Give at least one product a quantity."); if any line priced and rate ≤ 0 → "Enter the rate you paid (TK per RMB)."; confirm "Save this order? … N product(s), P pieces, RMB X" + "K line(s) have no RMB price: their cost will come from the price book instead." → `erpPoCreate({shipBy, rate, note, supplier, lines:[{sku,qty,rmbUnit} | {isNew, product, qty, rmbUnit}]})`. Success toast "Order **PO-…** saved · N piece(s) on the way · K new product(s) added to the list." (10 s).

**Feed from the To-order plan**: manager+ see a checkbox column; ticking sets `POPICK[sku] = need`; the Order cell becomes an editable qty input; "Tick all / Untick all"; "Add N ticked to a new order" pushes picked SKUs (not already on draft) into `PONEW.lines` with `rmb:''`, clears picks, scrolls to the draft.

**Each open order** (from `erpPoList`):
- Header: **PO-id** + supplier; pill ship-by; "`ordered d MMM yyyy · N days ago · RMB total @ rate`"; note; "Boxes so far: `date · no · N pc · shipping X | …`".
- Lines table: Product (name, `SKU · RMB u each`), Ordered, Still to come, Received now (number min 0, placeholder "—"), ✓ button + tag, "Will not come".
  - Lines with `left ≤ 0`: green pill "✓ all in", no inputs.
  - Tag logic (`poLineState`): nothing typed → amber "`left` short so far" only if some already received; typed = left → green "✓ matches" (row tinted `--good-soft`); typed < left → amber "`n` short"; typed > left → red "`n` extra" (row `--warning-soft`).
  - ✓ toggles between "matches" (= left) and blank.
  - Extras (not on the order): row tinted amber, red pill "not on the order" + amber "new product" or SKU; qty input, "RMB each" input, Remove.
- Controls (manager+): "Tick all as matching" (fills untouched lines with `left`), input "+ Something in the box that was not ordered" (datalist; refuses SKUs already on the order: "X is on the order — type what came on its own line."), "+ New product" (`quickStart('pox')`, form renders inside this order).
- Shipment fields: "Shipment / tracking no.", "Agent", "Weight (kg)", "TK per kg" (placeholder Sea 250 / Air 770), "Shipping paid TK" (placeholder `kg×rate (kg × rate)` or "total"; typed total overrides), "Arrived on" (date, default today, max today).
- Footer: status text "N line(s), P pc checked · S short · E extra · X not ordered" or "Tick a line when the box matches it; type the number when it does not."; buttons **Nothing more is coming** (prompt "Close PO? … Why is it not coming?", blank → "Say why.") → `erpPoClose`; primary **Add to stock** (disabled until something checked) → confirm summarising pieces, shipping ("Shipping X TK is shared into their cost." / "No shipping entered for this box."), SHORT/EXTRA/NOT ORDERED lists → `erpPoArrive({poId, lines:[{sku,qty}], extras:[…], shipment:{no, agent, by, kg, shippingBdt, date}})`. Toast "N piece(s) are in stock · shipping X shared into the cost · **D to decide** · K still to come | order PO is complete." (12 s).
- "Will not come" per line → prompt (default "supplier did not send them", shows RMB the supplier would owe) → `erpPoLineClose({poId, sku, reason})`; toast "Product: closed · supplier owes RMB X."

Client-side PO check-in state (`POARR`) is memory only; lost on reload.

#### PO server functions
- **`erpPoOpen_()`** (ERP:7893): rows with status exactly `open`; groups by po_id; per line `left = max(0, qty − received)`; order `rmb = Σ qty×rmb_unit`, `rate` from the first row, `when` "d MMM yyyy", `days` since ordered; returns only orders with `left > 0`, plus `bySku` = Σ left (used as "On the way" in the plan).
- **`erpPoList()`** (ERP:8217): `{orders (with boxes from PO_SHIPMENTS), differences (open diffs), balances}`.
- **`erpPoCreate(payload)`** (ERP:7930): role manager+ ("Your account cannot place orders."); shipBy Sea|Air ("By sea or by air?"); rate 0–1000; qty rounded, skip ≤ 0; rmb rounded 4 dp, negative → error; duplicates → "X is on the order twice."; unknown SKU → "Product not found"; new products need a name and unique SKU; priced lines require rate ("Enter the rate you paid (TK per RMB), so the prices can be turned into cost."). Lock 20 s. New products created first via `addProductAPI` with `opening_stock=0`, `lead_time_days` default 60. **ID = `PO-yyMMdd-HHmm`** (two orders saved in the same minute share an ID and merge). Rows `[id, now, sku, name, qty, 0, shipBy, note, 'open', who, '', rmb||'', rate||'', supplier]`. Refreshes STOCK_VIEW if products were created. Returns `{ok, poId, lines, created, units, rmb}`.
- **`erpPoArrive(payload)`** (ERP:8010): role manager+; order must be open. Shipping ≥ 0. Each line: must be on the order, not twice; `unitBdt = round2(rmbUnit × order.rate)`; qty > left → an `extra` difference for the excess. Extras: new products (name required, opening 0) or existing SKUs not on the order → `wrong` difference, `unitBdt = rmb × order.rate`. Then calls **`erpReceiveShipment({mode:'none', reference: shipNo || 'PO-id / d MMM yyyy', poId, lines, shippingBdt, supplier, shipNote:'agent X, N kg', notes:'priced on the order @ R TK/RMB'})`** — so costing = order RMB price × order rate (fallback price book) + shipping shared by value. Appends PO_SHIPMENTS row; writes PO_DIFFS rows `D<yyMMddHHmmss>-<n>` with `unit_bdt` = landed cost of that line, status `open`. Returns `{ok, poId, received, units, shipping, lines, stillToCome, shortLines, differences, created}`.
- **`erpPoReceived_(poId, lines)`** (ERP:8262): adds arrived qty to each open line's `received`, capped at `qty − received`; when every open line of the order is complete → status `arrived` + closed_at.
- **`erpPoLineClose`** (ERP:8103): sets line status `closed: <why>` + closed_at; writes `short` diff with status `supplier_owes`, value `left × rmbUnit`. Returns `owed`.
- **`erpPoClose`** (ERP:8230): reason required; closes every open line of the order; for each line with left > 0 writes a `short`/`supplier_owes` diff.
- **`erpPoDiffDecide({diffId, decision})`** (ERP:8130): only `open` diffs. `return` → `erpAdjustStock({sku, qty, direction:'OUT', reason:'not ordered - handed back to the supplier (PO)'})`; `free` (when unit_bdt > 0 and on-hand > 0) → `PM.I = max(0, round2((was×have − qty×unit)/have))`, note "average cost a -> b"; `pay` → nothing physical. Status → `i_owe|free|returned`, decided_at/by, note. Refreshes STOCK_VIEW unless pay.
- **`erpPoSettle({supplier, note})`** (ERP:8172): shareholder+; stamps `settled_at` and appends "settled: how" on every unsettled `supplier_owes`/`i_owe` diff of that supplier (case-insensitive); none → "Nothing is outstanding with that supplier."
- **Balances** (`erpPoMatters_` ERP:8193): per supplier (blank → "(no supplier named)"): `owesYou` = Σ rmb_value of `supplier_owes`, `youOwe` = Σ of `i_owe`, `net = owesYou − youOwe`, only unsettled.

### 6.4 Stock history (loaded, not shown)
`erpStockHistory(limit=60)` (ERP:1377) returns the last 60 TXN_LOG rows newest-first: `{id, date 'd MMM yyyy, h:mm a' (Asia/Dhaka), sku, product, type, dir, qty, ref, supplier, by}`. It is fetched on boot and on every stock write into `HIST`, and shown only as a count in the `?debug=1` strip. **No history panel exists in `viewStock()`** — the comment "for the Stock tab's history panel" is stale. Rebuild decision: either add the panel or drop the call.

### 6.5 To order (reorder plan) — `reorderPlanHtml` (UI:5360)
States: error note "Could not work out what to order." + message; loading "Working out what to order… this reads every sale, so give it a moment."
Heading "To order"; sub "How many to buy so the shelf lasts the {leadDays}-day wait for a shipment **and** the {cycleDays} days of selling after it lands. Worked out from how fast each one actually sells — not from a reorder level."
KPI tiles: **Products to order** = count, delta red "N run dry before a shipment could land" or "none run out before a shipment lands"; **What it will cost** (currency `OPT.currency`, default BDT) = totalCost, "at landed cost".
Empty: "Nothing needs ordering — every product that sells has enough on the shelf."
Table (`.scroll.tall`): [checkbox, manager+], Product (name/SKU), Brand, On hand, On the way (`coming` or —), Sells / month, Days left (`cover`: red pill "Nd" if urgent else amber pill; — if null), Order (bold `need`, or qty input when ticked), Cost (`fmt(cost)` or "no cost"), Why (muted text). Footer: "Products that have never sold are left out on purpose — restocking what nobody buys is how money ends up asleep on the shelf. As of {generatedAt}."
Note: the "What it will cost" figure is visible to managers (not scrubbed).

#### `erpReorderPlan(payload)` (ERP:6380)
```
cycle       = payload.cycleDays > 0 ? round(...) : 30     // UI always sends {} → 30
defaultLead = payload.leadDays  > 0 ? round(...) : 60
for each catalogue product (skip Discontinued; skip rate <= 0):
  lead   = p.lead > 0 ? p.lead : defaultLead     // p.lead is already ≥7 from erpCatalog, so 60 never applies in practice
  buffer = lead × 0.5
  target = rate × (lead + cycle + buffer)
  coming = Σ open PO left for this SKU
  need   = ceil(target − stock − coming);  skip if need <= 0
  unit   = price-book landed cost for category|brand|type (0 if none)
  cover  = round(stock / rate);  urgent (dry) = cover < lead
  why    = dry ? 'runs out in C days, L days before a shipment could land'
               : 'covers the L-day wait plus 30 days of selling'
sort: need desc, then cover asc (null last); return first 120 rows
returns {cycleDays, leadDays, rows, count (all), urgent, totalCost, generatedAt 'd MMM yy, h:mm a'}
```
Row fields: `sku, name, brand, cat, stock, rate (2dp), perMonth = round(rate×30), cover, lead, need, coming, unitCost, cost = round(unit×need), why, urgent, sold90, lastSoldDays`.
Reloaded after every receive/adjust/PO change.

### 6.6 Reorder-level maintenance (Tools screen, shareholder+)
Not on Products/Stock, but it writes the "Reorder at" column those screens show: Tools → "Check reorder levels against sales" (`erpTool('previewReorder')`) / "Recalculate every reorder level" (`applyReorder`, danger confirm). `erpApplyReorderLevels(apply)` (ERP:2761) sets PM.L = catalogue `suggested` for every product whose raw L differs (compares raw L, not the 5-defaulted view), returns `{changed, raised, lowered, preview (≤20: sku, name, from, to, rate, stock)}`, then refreshes STOCK_VIEW. Products with no sales get 0, which STOCK_VIEW shows as 5.

---

## 7. External integrations touching stock

- **Website (WooCommerce, `https://costareen.com/wp-json/cz/v1`)** — nothing on Products/Stock calls it. Stock reaches the site via:
  - Trigger `czSyncCycle` every 15 min (CODE:4040; enabled by menu `enableWebsiteSync`): `pullWebOrders()` then `pushStockToWebsite('apply')`.
  - Tools buttons `previewPush`/`pushStock` (`erpTool`, ERP:1739-1752).
  - `czBuildStockItems_()` (CODE:3966): per STOCK_VIEW row `qty = max(0, round(available_stock − pending web qty))`, where pending = WEB_ORDERS lines with `entered_in_sheet != 'yes'` and real SKU (CODE:3948). POST `/stock` `{mode:'dry'|'apply', zero_policy:'outofstock', items:[{sku, qty}]}` with header `x-cz-key` (Script Property `CZ_SYNC_KEY`). Response fields used: `changed_count, unchanged, missing_count, changed[]`.
  - Because the push reads STOCK_VIEW, a receive/adjust only reaches the website after `refreshStockView` (which every write here runs) **and** the next push.
- **Drive**: none in this scope. **Price book** `COST_PRICES` (see the Product cost spec) supplies landed cost and the usual rate (O2), which receive may overwrite.

---

## 8. Data-quality handling & caveats (rebuild checklist)

Handled:
- SKU matching trimmed + case-insensitive (except `refreshStockView`'s Map and `generateSKU_` prefix, which are case-sensitive).
- `erpNum_` turns blanks/non-numbers into 0; `erpDate_` accepts Dates, Sheets serials (20000-80000) and strings.
- Status blank → Active. Unit blank → Piece. Reorder 0/blank → 5 (view + create). Lead 0/blank → 7 (catalogue/create), 60 for products created from receive/PO.
- Negative on-hand clamped to 0 when averaging cost. Stock-out adjustment cannot exceed current stock. Discontinue refused while on-hand > 0 (both button and form).
- Values not in SETTINGS stay visible in dropdowns with "(not in SETTINGS)".
- Dead-stock filters require stock > 0; "Should be"/cover handle never-sold and no-recent-sales separately.
- Receive refuses the whole shipment before creating any product if a SKU would collide.

Known defects / surprises to fix or consciously reproduce:
1. Manager edit of a product **zeros cost_price** (scrubbed field saved back as 0) — §4.3.
2. Receive-screen "new product" drafts are **never sent** (`lines` mapped to `{sku, qty}`) — §6.1.
3. Receive reference is required server-side only (error after pressing Receive).
4. `RECV.poId` banner is dead code; history is loaded but never rendered; Products "Run diagnostics" is unwired.
5. Empty-table colspan 10 vs 12 columns.
6. State (`ok/low/out`) on screens uses **current** stock, STOCK_VIEW status uses **available** (current − reserved); website push uses available − pending web orders. Three different "stock" numbers.
7. "Sold" counts every SALES_LOG row regardless of cancellation/return.
8. PO IDs collide within the same minute; TXN IDs are random 4-digit per day.
9. `erpReorderPlan` default lead 60 is unreachable (catalogue already defaults lead to 7).
10. Price-book key mismatch: `erpCostSync_` writes blank category/brand/type as `Uncategorised`/`-`, while receive/plan look up with blanks as `''`, so blank-attribute products never match a book row.
11. Operator column: receive writes the Google email (or `erp`), IN adjustments write `n8n-agent`, OUT adjustments write the email — not the ERP person's name.
12. Sales role sees edit/discontinue/new buttons that the server refuses.
13. `erpSetProductStatus` does not refresh STOCK_VIEW.

---

## 9. Server function index (this scope)

| Function | File:line | Called from | Reads | Writes |
|---|---|---|---|---|
| erpBundle(parts) | ERP:1944 | loadAll/loadLists/loadHistory | via parts | ERP_SPEED (slow loads) |
| erpCatalog() | ERP:649 | bundle, attachNewProduct, plan, PO create, apply levels | PRODUCT_MASTER, SALES_LOG, STOCK_VIEW | – |
| erpSettingsLists() | ERP:1169 | bundle 'lists' | SETTINGS A–F | – |
| erpProduct(sku) | ERP:1190 | Edit button | PRODUCT_MASTER | – |
| erpSaveProduct(data) | ERP:1225 | product form | PRODUCT_MASTER | PRODUCT_MASTER, TXN_LOG (OPENING), STOCK_VIEW |
| addProductAPI(data) | CODE:1716 | save/receive/PO | PRODUCT_MASTER | PRODUCT_MASTER, TXN_LOG |
| generateSKU_ | CODE:90 | addProductAPI | PRODUCT_MASTER | – |
| erpSetProductStatus(sku,status) | ERP:1856 | Discontinue/Reactivate | PRODUCT_MASTER, TXN_LOG | PRODUCT_MASTER.O |
| erpRefuseDiscontinue_ | ERP:1846 | status/save | TXN_LOG | – |
| erpReceiveShipment(payload) | ERP:3174 | Receive, erpPoArrive | PRODUCT_MASTER, TXN_LOG, COST_PRICES | TXN_LOG, PRODUCT_MASTER.I, COST_PRICES!O2, PURCHASE_ORDERS, STOCK_VIEW |
| erpAdjustStock(payload) | ERP:1333 | Adjustment, erpPoDiffDecide | STOCK_VIEW, PRODUCT_MASTER | TXN_LOG, STOCK_VIEW |
| recordReturnAPI | CODE:1692 | adjust IN | PRODUCT_MASTER | TXN_LOG |
| checkStock | CODE:3244 | adjust OUT | STOCK_VIEW | – |
| erpStockHistory(limit) | ERP:1377 | bundle 'history' | TXN_LOG | – |
| erpReorderPlan(payload) | ERP:6380 | To order | catalogue, COST_PRICES, PRODUCT_MASTER, PURCHASE_ORDERS | – |
| erpPoList() | ERP:8217 | Orders | PURCHASE_ORDERS, PO_SHIPMENTS, PO_DIFFS | – |
| erpPoCreate | ERP:7930 | Save order | catalogue | PURCHASE_ORDERS, PRODUCT_MASTER, STOCK_VIEW |
| erpPoArrive | ERP:8010 | Add to stock | PURCHASE_ORDERS | via receive + PO_SHIPMENTS, PO_DIFFS |
| erpPoLineClose | ERP:8103 | Will not come | PURCHASE_ORDERS | PURCHASE_ORDERS, PO_DIFFS |
| erpPoClose | ERP:8230 | Nothing more is coming | PURCHASE_ORDERS | PURCHASE_ORDERS, PO_DIFFS |
| erpPoDiffDecide | ERP:8130 | difference buttons | PO_DIFFS, TXN_LOG | PO_DIFFS, TXN_LOG, PRODUCT_MASTER.I, STOCK_VIEW |
| erpPoSettle | ERP:8172 | Settled | PO_DIFFS | PO_DIFFS |
| erpPoReceived_ | ERP:8262 | receive | PURCHASE_ORDERS | PURCHASE_ORDERS |
| refreshStockView | CODE:2468 | after writes, hourly trigger | PRODUCT_MASTER, TXN_LOG, SALES_ENTRY, MANAGER_QUEUE | STOCK_VIEW |
| erpOnHandMap_ / erpBookCostMap_ | ERP:3135 / 3154 | helpers | TXN_LOG / COST_PRICES | – |
| erpSelfTest | ERP:2004 | (unwired here) | bundle | – |
| erpApplyReorderLevels | ERP:2761 | Tools | catalogue, PM.L | PM.L, STOCK_VIEW |
| pushStockToWebsite / czSyncCycle | CODE:3985 / 4040 | Tools, 15-min trigger | STOCK_VIEW, WEB_ORDERS | website |
| erpReceiveStock (legacy) | ERP:1299 | not called by UI | | TXN_LOG |
