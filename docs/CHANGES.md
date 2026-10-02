# Deliberate changes since the web app stopped following the sheet ERP

2026-10-02
- Sign-up closed; e-mail confirmation required; passwords 10+ characters.
- The not-signed-in role has no permissions at all (021_lockdown.sql).
- Wrong staff codes are limited per internet address (20 / 15 min) as well as per device (5 / 15 min); counts forget after 15 quiet minutes.
- `sheet-sync@costareen.app` service login deleted (the sheet mirror was never built).
- Browser security headers (Content-Security-Policy etc.).
- Read-only requests run in parallel; list tables become cards on phones.

2026-10-02 — Phase 1 (app frame)
- `web/app.html` is now the page's source (forked from the patched sheet page; old build kept in `web/legacy/`). `web/build.py` only stamps the server address.
- Every `window.confirm / prompt / alert` (59 places) became an in-page dialog (`uiConfirm`, `uiPrompt`, `uiAlert`): heading + explanation, red button for risky actions, Enter / Escape, keyboard kept inside.
- Each screen has an address (`#/sales`); Back, Forward and reload stay inside the app.
- Sign-in screen: Staff / Owner tabs, "Forgot the password?", no error shown on a first visit, top bar hidden until signed in.
- Phone: bottom bar with Invoice, Sales, Customers, Products, More.
- Tools became "Maintenance" with only the six jobs that still mean something (sheet repairs removed).
- Wording: no more "sheet", tab names (SALES_LOG …) or "Drive" in what people read.
- Save-invoice summary shows what is paid now and what is due by the chosen pay mode (it used to show the whole total as due).
- "No internet connection" bar.
- Not in this phase after all: global search (comes with the invoice / customer / product pages in Phase 2-3), owner second step (Phase 5, with the Security section), removing Refresh (kept as an icon until data refreshes by itself, Phase 6).

2026-10-02 — Phase 2 (daily screens)
- New server functions (handlers/pages.js, tests/pages_test.mjs): `erpInvoice` (one invoice: lines, payments, returns, parcel, change history), `erpCustomerPage` (one customer: figures, invoices, payments, dues, advance), `erpSearch` (invoices, customers, products). All read-only, sales role and up, no cost or profit in them.
- `erpSales` takes `offset`: the Sales list pages through every invoice (100 a page) instead of stopping at the newest 100.
- Invoice page (`#/sales/<invoice no>`): everything about one sale, with Open PDF, Receive payment, Send parcel, Return, Fix details, Cancel sale. It re-reads itself after any save.
- Customer page (`#/customers/<key>`): owes / advance / bought / average, invoices, payments, with New invoice, Statement, Receive payment, Edit.
- "Receive payment" now opens on the Sales screen and the invoice page (the box used to be drawn only on Customers).
- Search box in the top bar (press `/`): type part of an invoice number, name, phone or product. Enter opens the first result.
- New invoice: customer and product search on the left, invoice lines and totals on the right (wide screens). Typing an exact SKU (or a search with one match) and pressing Enter adds it to the invoice.
- Bug fixes: a phone stored with spaces/dashes/+880 is matched again (`'\D'` inside a JS template reached Postgres as `'D'`; now `'[^0-9]'` in catalog.js, sales.js, pages.js); a sale with no address no longer wipes the customer's saved address.
- Still to do in this area: the Customers list itself is filtered in the browser and shows 300 rows at a time (search reaches everyone); database paging for it comes with Phase 6.

2026-10-02 — Phase 3 (goods)
- `supabase/022_product_history.sql`: table `product_changes` + a trigger on `products`. Every change of selling price, wholesale price, cost or status is written down by the database itself, with who did it.
- New server functions (handlers/goods.js, tests/goods_test.mjs, 25 checks): `erpProductPage` (one product: figures, stock ledger with running balance, 12 months of sales, latest invoices, supplier orders on the way, price/cost changes) and `erpStockCount` (a physical count: one ledger line per difference, all or nothing). Supplier is manager and up; cost, margin, stock value at cost, receipt prices and cost changes are shareholder and owner only - left out on the server, not hidden in the page.
- Product page (`#/products/<sku>`): opened by clicking a product name or a search result. Actions: Add to invoice, Edit, Receive, Adjust, Discontinue / Reactivate. It re-reads itself after any save.
- Stock entry is four tabs instead of one long page: Receive, Count & adjust, Supplier orders, To order. Ticking products under "To order" and pressing "Add to a new order" switches to Supplier orders.
- Stock count: type what is on the shelf beside what the books say; the difference shows as you type; saving corrects the books and records "counted X, books said Y".
- The Diagnostics card is gone from Products (it stays under Maintenance).
- Test harness: the stand-in `auth.uid()` no longer fails on an empty session (the real one never did).

2026-10-02 — Phase 4 (money)
- Dashboard: every attention card opens the list behind it already filtered (out of stock, To order, invoices with a due, parcels to send - new card). Top products open the product page, recent orders open the invoice. The data-quality notes and the "saved copy, updating" stamp are gone. Sales has a "To send" filter.
- Profit & loss: 6 or 12 months, Earlier / Later, Download as CSV (opens in Excel). Click a month to see it invoice by invoice (net sale, goods cost, profit) with a jump to that month's expenses. Server: `erpPnl` takes `to`; new `erpPnlMonth`.
- Expenses: a receipt (photo or PDF, up to 3 MB; phone photos are shrunk before upload) can be kept with any entry and opened later - `erpExpenseReceipt`, `erpExpenseReceiptUrl`, files under `receipts/`, column `expenses.receipt` (023). The owner can change the category lists of each section - `erpExpenseCategory`, kept in config `expense_categories`.
- Capital has two tabs: Capital and Partnership (handlers/partners.js, tests/phase4_test.mjs, 59 checks). The rules are the database's (005_partnership.sql):
  - In your own business: start a joint pool (you get an invite code), join a partner's pool with a code, see partners' stock counts (never cost or price), switch that off for your own stock, and write down sales from each other's own stock (record, other side confirms, owed side marks paid).
  - A joint pool is a business in the top menu, marked "(joint pool)". Inside it the Partnership tab shows the month: sales, profit, capital, stock at cost; per partner capital, share, sales, profit share, cash held, cash due, and who hands how much to whom. The pool's book takes capital in / out, expenses a partner paid, and cash handed over. A finished month can be closed (frozen).
  - In a pool, a partner set to "wholesale" is offered the wholesale price of a product where one is set (catalog.js).
- 023_phase4.sql: `expenses.receipt`; `create_pool_invite` no longer depends on pgcrypto being on the search path.
- Not done here: wholesale price is not yet a field on the product form (set per product in a later phase); P&L PDF export.

2026-10-02 — Phase 5 (settings and security)
- Settings is five tabs: Business (logo, defaults, add a business, a company for a partner) · People (requests, staff, devices) · Lists · Connections (AI access, WhatsApp, courier) · Security (second step, activity, backups). Connections and Security are the owner's only.
- Second step for the owner (authenticator app, Supabase TOTP): switched on under Settings → Security by scanning a QR and confirming a code. The sign-in screen then asks for the 6-digit code after the password. The server enforces it (index.ts `verifyUser`): an account with a confirmed second step is only let in by a session that passed it. If the phone is lost, the factor is removed with the admin API (`DELETE /auth/v1/admin/users/<id>/factors/<factor id>`).
- Activity log (024_security.sql `erp_activity`, core.js `logActivity`, handlers/security.js `erpSecurity`): who opened the app (once per half hour per person) and every change, in plain words, with device and internet address. Only a few safe words of what was touched are kept (invoice number, SKU, month) - never a payload. Kept 90 days. Owner only.
- A company for a partner (`erpPartnerCompany`): makes a separate business owned by the partner's own login (their e-mail), e-mails them a link to choose a password. The creator is not a member of it. The old sheet-era "Start a business for a partner" card is gone.
- Product form has a Wholesale price (optional); changes show in the product's price history.
- BUG FIXED (was live): handlers that read a secret or the kept dashboard from inside their transaction (`ctx.sql`) took a second connection from the same pool of three. Three such calls at once stopped the function for good - seen as a screen that loads forever. `ctx.sql` is now its own small pool (`deps.sqlAux`). tests/phase5_test.mjs has a check that fails without it.
- Not done here: secrets into Supabase Vault; staff session expiry / PIN; alerts to the owner (Phase 6).

2026-10-02 — Phase 6 (scale and alerts)
- Measured first (local, real data and the same data x10 = 10,450 invoices). Every screen call grew from ~40 ms to ~300 ms. The cause was not the queries but row-level security: `is_member(business_id)` was called once for every row a query looked at.
- 026_rls_fast.sql: the 171 policies written as `is_member / is_manager / is_shareholder / is_owner (business_id)` now ask once per query - `business_id in (select my_business_ids('<level>'))`, and that function is built from the same four functions, so who may see what is unchanged. All 17 suites (cross-business isolation, partnership, roles) pass against it; outside access still refused. Result at x10: erpSales 300 -> 40 ms, erpCustomers 270 -> 20, erpCatalog 210 -> 30, erpPnl 290 -> 35, dashboard 350 -> 95. On today's data everything is 5-30 ms.
- lib/tabs.js: the sales log is kept in memory between calls and reused while its fingerprint (row counts + newest change, `xmin`) is unchanged; rows are frozen. A sale, an edit, a delete, a direct database change and a rolled-back save are each covered by a test.
- Customers: `erpCustomerList` filters, sorts and pages on the server (100 a page); the screen no longer downloads every customer, and they are no longer loaded at start-up.
- No Refresh button. Figures are read again when the window is come back to (after a minute away), every five minutes while open, and after every save. Nothing is redrawn under someone who is typing or has a form open.
- Alerts (handlers/alerts.js, 025_alerts.sql): a bell in the top bar for the owner and shareholders - a device waiting to be let in, a night job that failed, no backup for 36 hours, many refused actions. The owner can add a WhatsApp number; a new timer (`erp-alerts`, every 10 minutes) sends what is new, once each, through the business's own WhatsApp link.
- A staff device not used for 30 days has to be allowed again (core.js `DEVICE_IDLE_DAYS`).
- Timers (jobs.js) use the side pool for `ctx.sql` too.
- Not done: secrets into Supabase Vault; the dashboard is still worked out in JavaScript (95 ms at x10 - fine for years at this size).

2026-10-02 — Phase 7 (go-live, prepared)
- `deploy/start_fresh.py`: empties one business's trial data in one transaction after writing a copy to disk. Without `--yes-delete "<name>"` it only lists what would go and what would stay. `--keep-lists` keeps products, customers (totals cleared), cost book and expense set-up. The invoice counter is left alone.
- `tests/golive_test.mjs` (26 checks, needs IMPORT_DIR): the same wipe on a copy of the real data, then every screen on empty books, opening stock, first invoice.
- Stock count: a product counted for the first time is written as OPENING stock at its cost price ("Opening stock <date>"), not as an adjustment.
- `docs/GOLIVE.md`: the day, step by step.
- Not run on live: the wipe itself (waits for the owner's day), Supabase plan.
- Known gap: customers' unpaid amounts at go-live have no "opening balance" entry yet.

2026-10-03 — Sign-in removed: access by private link (owner's decision; a different per-person system is to replace it later)
- No sign-in screen. A device gets in by opening `https://erp.costareen.com/#k=<key>` once; the key is kept on the device and taken out of the address bar at once. Without a key the page says "Private system" and the server answers nothing.
- 027_access_keys.sql `erp_access_keys`: only a SHA-256 of each key is stored; server-only table. A key acts as the owner (everyone who gets in has full access). core.js `authenticate`: key first; with `deps.linkOnly` (set in index.ts) staff codes and owner e-mail sessions open nothing. Wrong keys are limited per internet address (20 in 15 minutes).
- Settings → Security → Access links (handlers/access.js): make a link per person or device (shown once), see when each was last used, switch one off (stops at once). The link a device is using cannot switch itself off. The activity log names the link.
- Settings lost the People tab and the second-step card (codes, devices and the authenticator are not in use). The code for them is still there, switched off.
- "Sign out" is "Forget device".
- tests/access_test.mjs (26). First key for the owner made with a one-off script; a lost link is replaced the same way (insert a new hash).
- First full run of the live site signed in (through the link): dashboard, product page, sales, invoice page, P&L, customers, partnership, security all open.

2026-10-03 — Look 2 (Odoo-style), step 1: the shell
- Owner asked for the look and way of working of Odoo. Patterns are followed; no Odoo code, icons, logo or name is used.
- Home screen (`#/home`, the landing page): a grid of apps - Dashboard, Sales, Contacts, Inventory, Accounting, Settings - with a count badge. `APPS` in web/app.html maps each app to the existing screens.
- Top bar: apps button, the open app's name, its screens as a menu (New invoice / Invoices / Web orders / Quotations …), search, business, bell, account menu (name, theme, Forget device). The side menu and the phone bottom bar are gone (hidden; the old nav element is still what roles and routes read).
- Breadcrumb row under the bar: `Invoices / INV-…`; the first part goes back to the list. The "← All …" links are hidden.
- Colours and shapes: purple primary, teal links, flat cards, 4-6 px corners, grey table headers, underline tabs. Light theme is the starting theme (once; the person's own choice holds after).
- All of it is one block at the very end of web/app.html ("look 2 - step 1"); the screens underneath are unchanged.
- Next steps: list view (search facets, group by, select + bulk), form view (status bar, smart buttons, tabs, notes), kanban, graph / pivot.

2026-10-03 — Look 2, step 1b and step 2
- 1b: the apps button opens a drop-down over the screen instead of replacing it; the app opens on the Dashboard (Products for staff below shareholder).
- 2: the list view, as in Odoo, for Invoices, Products and Customers.
  - Server: `handlers/listview.js` `erpListView({model, search, filters, groupBy, group, order, offset, limit, exportAll})` (read, role per list). Each model declares its search fields, filters (grouped in sets: "or" inside a set, "and" between sets), group-bys, columns and totals. Money columns / filters only for manager and up (customers' "Owes"), supplier group only for manager and up. `erpSales({all:true})` gives every invoice (no outside call) for it. tests/listview_test.mjs (31).
  - Page: search box that turns typing into facets ("Search Customer for: …", arrows + Enter, Backspace removes the last facet); ▼ menu with Filters, Group by and Favourites (saved per device); click a column to sort; groups fold open with their counts and totals; tick boxes with "select all N", Export (CSV) and, for products, Discontinue / Reactivate; pager 80 a page; totals row; a row opens its record page. Phone: fewer columns, menu stacked.
  - Kept around the lists: Invoices - the due box, "Waiting for Steadfast", Steadfast money; Customers - the account box, the customer form, "Customers who owe" / advances; Products - the product form ("New").
  - Gone from the list rows: the per-row buttons (Add, Edit, Return, Fix, Cancel, Statement, Due …) - each is on the record page that the row opens.


2026-10-03 — Look 2: side menu back
- Owner: the apps button and top menus made getting around harder; colours, icons and the rest are liked. The side menu is the navigation again (always on screen; drawer + bottom bar on phones, as before), in the new look: each screen has a coloured icon tile in its app's colour. Apps button, app name, top menus and the apps drop-down are hidden (code kept). Purple top bar keeps search, business, bell, account menu. Breadcrumb row and the list views stay.

2026-10-03 — Theme library
- Account menu → Themes…: 12 ready-made themes (Plum, Ocean, Forest, Teal, Indigo, Royal, Rose, Crimson, Sunset, Gold, Slate, Midnight), "my own colours" (main colour + link colour), and Light / Dark. A theme is two colours; top bar, buttons, selected menu line, soft tints and the dark variant are worked out from them (`:root[data-pal]`, `--pal`, `--pal2`), and the text on the main colour turns dark when the colour is light.
- Kept per person: `erp_prefs.look` (028_look.sql), `erpSetLook`, returned by `erpBusinesses`; also in localStorage `cz_look` so it is there before the server answers. The server accepts only a theme name or `custom|#rrggbb|#rrggbb`.

2026-10-03 — Plan A1 and A2 (profit is right)
- **A1 - the cost of a sale is fixed on the day of the sale.** `invoice_lines.unit_cost` is written when the line is saved (the product's own cost, or the price book's where it has none) and every profit figure reads the line (`soldCost` in handlers/dashboard.js; the sales log carries it as `SL.unit_cost`). A later shipment or a price-book change no longer moves a month that is over. A return takes the cost of the sale it returns. A line sold when no cost was known falls back to today's cost until one exists. `erpFreezeSaleCosts` (owner) writes today's cost on lines made before this - run once on live: 1,588 of 1,591 lines, figures unchanged. 029_sale_cost.sql, tests/a1_test.mjs (16).
- **A2 - one net profit.** `pnlFor(ctx, months)` is the only place a month's profit is worked out: sales - returns - cost + delivery charged +/- courier differences - what the courier kept - expenses. Profitability, Expenses (now shows the delivery-and-courier part between gross and net; export has the lines too), Dashboard (`profit.monthNet`) and Capital (shareholders' earned profit, month close) all read it. Before, Expenses and Capital used gross less expenses. tests/a2_test.mjs (8). On live the September figure on Expenses/Capital moved from 300,219 to 301,224 (delivery charged), now equal to the P&L.

2026-10-03 — Plan A3 (money accounts)
- New screen **Money** (side menu, under Money): the accounts the owner makes - cash, banks, wallets, the courier holding collected cash - each with what it holds, and the statement of any one of them with a running balance. Accounts are added, renamed, given an opening balance and retired freely (a retired one keeps its history; it must be empty first).
- Nothing is entered twice. `payments`, `expenses`, `capital_book` and `courier_payouts` each got `account_id`, written when the row is made; a statement is read from those rows. `money_moves` holds only transfers between accounts and corrections after a count (030_money_accounts.sql). handlers/cash.js; tests/a3_test.mjs (43).
- Where money goes by itself: each payment method is mapped to an account, expenses have a usual account, courier payouts a usual bank (config `money_rules`). The map decides NEW rows only; a row already written keeps its account, and one row is moved with "Wrong account" (owner, logged). What is not money - Adjusted, Returned, Advance - touches no account. A refund leaves the account; a struck-out expense gives the money back; an investor's return is counted once.
- "Waiting for an account": courier payouts with no bank yet, and payments taken by a method that has no account - in no balance until placed.
- Move money (transfer, both sides), Count / correct (the book follows the count, with the reason), strike out - never delete.
- Expenses: "Paid from". Capital: "Account" in place of "How".
- Fixed on the way: courier payout dates left by the import as spreadsheet serial numbers were unreadable, so courier fees were missing from the P&L (`looseDate` in lib/time.js).
- Go-live wipe keeps the accounts and empties their movements.

2026-10-03 — Plan C1 (row buttons back)
- The list rows carry their most-used actions again, one click: Invoices - Pay (when something is due), Return, PDF; Products - Add (to the invoice being written), Edit; Customers - Invoice, Pay (when they owe), Statement, Edit. A click elsewhere on the row still opens its page. Hidden on phones (the row opens the page there). Server rows carry a small `act` object for this (handlers/listview.js).
