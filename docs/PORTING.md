# Porting a group of server functions

Read `docs/ARCHITECTURE.md` first. You are re-implementing functions of the
sheet ERP (Google Apps Script) so that the ORIGINAL page (`web/original/ErpUI.html`,
unchanged) works against Supabase. The page cannot tell the difference: same
function name, same arguments, same return shape (every key the page reads),
same error sentences, same rounding and date formats.

## Sources of truth
- Spec for your screens: `docs/spec/01..04-*.md` (cites `file:line`).
- Original code: `C:\Users\Nazir\AppData\Local\Temp\claude\G--\1d0e482a-a473-40cc-9610-d474bd3f9c04\scratchpad\sheet-erp\`
  `ERP.js`, `Code.js`, `ErpUI.html`. When the spec and the code disagree, the code wins.
- Read how the page USES each result (search ErpUI.html for `srv('erpX'`) so
  every key it reads is present.

## Where things go
- Your handlers: `supabase/functions/erp/handlers/<group>.js`, exporting
  `export const HANDLERS = { erpName: fn, ... }`. Only edit YOUR file(s).
  `handlers/index.js` already imports it.
- Signature: `async function erpX(ctx, ...args)` - args exactly as the page sends.
- Permissions are already enforced by `allow.js` (ERP_ALLOW, verbatim). Do
  in-function role checks only where the original does (e.g. "refund needs
  shareholder"): `roleAtLeast(ctx.s.role, 'shareholder')` from `../allow.js`.
- Schema changes: ONLY in your own new file `supabase/0NN_<group>.sql`
  (numbers below), idempotent (`if not exists`), RLS on any new table
  (copy the loop in 007 section 12), end with the grant lines from 007.
  Never edit 001-008.
- Bugs you fix or behaviour you deliberately change: append to
  `docs/fixes/<group>.md` (what the original did, file:line, what the web app
  does, why). Do not silently "improve" anything else.

| group | file(s) | migration |
|---|---|---|
| sales | sales.js | 010_sales.sql |
| courier | courier.js | 011_courier.sql |
| customers | customers.js | 012_customers.sql |
| stock | stock.js | 013_stock.sql |
| dashboard | dashboard.js | 014_dashboard.sql |
| expenses + web orders | expenses.js, weborders.js | 015_expenses_web.sql |
| quotes | quotes.js | 017_quotes.sql |
| settings | settings.js | 018_settings.sql |
| campaigns | campaigns.js | 019_campaigns.sql |

## The context you get (`ctx`)
- `ctx.tx` - postgres.js tagged template, inside ONE transaction, running as the
  caller (RLS applies). **Always filter by `business_id = ${ctx.biz}`** - a
  person can belong to several businesses and RLS shows all of them.
- `ctx.sql` - privileged connection. Use ONLY via `lib/ext.js` (secrets) or for
  logs. Never to read business data.
- `ctx.s` = `{ userId, name, role, roleLabel, discountCap, businessId, businessName, memberships }`.
- `ctx.now` (Date), `ctx.memo` (per-call cache), `ctx.deps` (outside world).
- A failing statement aborts the whole call (Postgres). If the original
  catches an error and carries on, wrap that part in `await ctx.tx.savepoint(async () => ...)`.
- numeric columns come back as JS numbers (db.js), timestamps as Date.

## Shared helpers - use these, never re-derive
- `lib/tabs.js` - the sheet tabs as ROWS in original column order:
  `salesLog(ctx)` (SALES_LOG, indexes in `SL`), `paymentsTab` (`PAY`),
  `customersTab` (`CU`), `returnsTab`, `courierLog`, plus `asDate`, `str`,
  `forget(ctx, 'SALES_LOG', ...)` after you write. Port loops over
  `rows[i][16]` literally. Add a reader for another tab in YOUR file the same
  way (memoised via `ctx.memo`).
- `handlers/money.js` - `paidByOrder, addPayment, syncInvoiceStatus,
  sameOrder, erpDues, outstanding, erpCustomerAccount, creditOf, creditMap,
  applyCredit, discLeft, invoiceDiscounts, lock(ctx, topic), stamp(), who(ctx)`.
- `handlers/catalog.js` - `erpCatalog(ctx)` (memoised), `ERP_DELIVERY`, `LIST_KINDS`.
- `handlers/invoice.js` - `createInvoice(ctx, payload, {webEntry, webOrderNo})`.
- `lib/time.js` - `formatDate(d, 'd MMM yyyy')` (Asia/Dhaka, Utilities.formatDate
  patterns), `todayStr, monthStr, dhakaDayStart, num (erpNum_), round2, DAY_MS`.
- `lib/phone.js` - `normalizePhone, formatBdPhone, phone11 (erpPhone11_), custKey (erpCustKey_)`.
- `lib/ext.js` - `getSecret/setSecret` (courier keys etc.), `getConfig/setConfig`
  (SETTINGS I:J), `httpFetch(ctx, url, {method, headers, body})` -> `{code,text,json}`
  (UrlFetchApp with muteHttpExceptions), files: `saveFile(ctx, folder, name, bytes, mime)`
  -> `{id,name,url}`, `findFiles`, `deleteFile`, `fileUrl`, `readFile`;
  `renderPdf(ctx, html, {footer})` -> PDF bytes.
  Drive folders map to: invoice folder -> 'invoices', ERP_Assets -> 'assets',
  Costareen_Expenses -> 'exports', ERP_Backups -> 'backups'.

## Shared names (all groups use exactly these)
- Secrets (`getSecret/setSecret`): `CZ_SYNC_KEY` (website sync key, header
  `x-cz-key`), `ERP_SF_KEY`, `ERP_SF_SECRET` (Steadfast), `ERP_EVO_URL`,
  `ERP_EVO_INSTANCE`, `ERP_EVO_KEY`, `ERP_EVO_HOOK` (WhatsApp server).
  Per business already - no `::<sheetId>` suffix.
- Config (`getConfig`): `website_api` (default `https://costareen.com/wp-json/cz/v1`),
  `business_name`, `currency`, `default_reorder`, `default_lead_time`,
  `next_invoice_num` (mirrors invoice_counters), `cost_rate`, `cost_handling`,
  `cost_min_margin` (COST_PRICES O2:O4).
- Steadfast API base: `https://portal.packzy.com/api/v1`.
- Cross-group exports (implement them if you own them; import lazily with
  `await import('./x.js')` if you use them, and treat a missing export as
  "not in the web app yet"):
  sales.js `makeInvoicePdf(ctx, invoiceNo, {corrected}) -> {id,url,name}`;
  courier.js `sfNightly(ctx)`, `sfBooked(ctx)`; customers.js `mergeCustomers(ctx, apply)`,
  `fixCustomerPhones(ctx)`; stock.js `applyReorderLevels(ctx, apply)`;
  weborders.js `pullWebOrders(ctx)`, `pushStockToWebsite(ctx, mode)`;
  campaigns.js `campaignTick(ctx)`, `waHook(ctx, body, query)`.
- New sign-in person: `await ctx.deps.createAuthUser(name)` -> uuid (an
  auth.users row with no password; the real one calls Supabase Auth admin).

## How the data maps (sheet -> tables)
- SALES_LOG -> `invoices` (one row per order id, incl. `RTN-` return notes and
  legacy `ORD-` ids) + `invoice_lines`. Order of rows = `invoices.seq`, `line_no`.
  Columns: order_id=invoice_no, timestamp=created_at, customer_*=customer_name/
  customer_phone/customer_address, payment_method, payment_status,
  delivery_status, notes=note, discount, delivery_charge, grand_total,
  advance_paid, due_amount, customer_source=source. A return writes BOTH
  `returns` rows (RETURNS tab) and an `RTN-` invoice with negative lines
  (exactly as the sheet wrote SALES_LOG). "Deleting rows" (void) = delete the
  invoice (lines cascade) and its stock_movements.
- TXN_LOG -> `stock_movements` (kind, direction, qty, unit_price, total,
  reference, supplier, operator, note, txn_no, product_name, created_at).
  Current stock = `product_stock` view. There is no STOCK_VIEW to refresh.
- PRODUCT_MASTER -> `products` (name=product_name, category, brand, type, color,
  unit, supplier, cost_price, sell_price, reorder_level, lead_time_days,
  location_bin, status, date_added, notes).
- CUSTOMERS -> `customers`; PAYMENTS -> `payments`; SETTINGS lists -> `lookups`
  (kinds: categories, brands, types, suppliers, units, colors, payment_methods);
  SETTINGS config -> `business_config`; script properties holding secrets ->
  `business_secrets` via ext.js; other tabs -> the 007 table of the same name.
- Ids the original minted (`'P' + yyMMddHHmmss`, `RTN-…`, `PO-…`) are kept as
  text columns; the uuid `id` is internal.
- Concurrency: where the original took `LockService.getScriptLock()`, call
  `await lock(ctx, '<topic>')` first.

## Tests (required)
Write `supabase/tests/<group>_test.mjs` using `harness.mjs` (read its header:
fixture, `owner/mgr/sales/shareholder`, `web.on()` fake HTTP, `files`, `pdfs`).
Seed extra data with `sql` at the top of your file. Cover: the happy path of
every function, every error sentence the page can hit, role refusals, and the
numbers on a small worked example. Run:

```
S=C:/Users/Nazir/AppData/Local/Temp/claude/G--/1d0e482a-a473-40cc-9610-d474bd3f9c04/scratchpad
cd "$S" && TEST_SCRIPT=<group>_test.mjs ERP_NODE_CWD="$S/nodetest" ./pgenv/Scripts/python G:/costareen-erp/supabase/tests/erp_server_test.py
```
Also run `TEST_SCRIPT=erp_server_test.mjs` at the end to be sure nothing shared broke.
All tests must pass before you report.

## Report back
1. Functions ported (name -> original file:line).
2. Anything NOT ported and why (e.g. needs a service that does not exist).
3. Fixes/deliberate changes (also in docs/fixes/<group>.md).
4. Exports other groups may need (e.g. a PDF builder).
5. Test count and the exact command output tail.
