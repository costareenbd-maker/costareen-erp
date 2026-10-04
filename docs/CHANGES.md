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

2026-10-03 — Plan A4 (suppliers, and what is owed to them)
- New screen **Suppliers** (side menu, Goods): everyone the business buys from - names already used on products, orders and stock appear without any typing - with what is owed to each, and the total owed. A supplier's page: details (country, currency, phone / WeChat, note, what was owed at the start), products from them, orders on the way, and the account line by line with the balance after each.
- A shipment received with the supplier named on it adds a bill for the goods (not the freight): from the shipment total, or line by line at the order's prices when a supplier order is ticked off. A bill can also be typed in. A payment comes out of a money account (required once accounts exist), may carry the amount in their currency and how it was sent; paying more than is owed is an advance. Struck out, never deleted - a struck-out payment gives the money back to its account.
- A rename follows through products, stock movements, orders, bills, payments and the suppliers list.
- 031_suppliers.sql (suppliers, supplier_bills, supplier_payments), handlers/suppliers.js, tests/a4_test.mjs (25). Money statements show "Paid to supplier …". Managers see suppliers; paying and bills are shareholder and up; striking out is the owner's.

2026-10-03 — Plan A5 (currencies and landed cost)
- **Currencies** card on Product cost: every currency the business buys in, its rate in taka, and each earlier rate by date. RMB and USD are offered from the start; any other is added there. The old single "TK per RMB" box is gone (RMB is one of the currencies; the old setting is kept in step).
- Price book: each row has a price and the currency it was quoted in (TK, RMB, USD, ...). A new rate changes what the book lands at; stock already bought keeps its cost.
- Receive stock: "Imported — foreign money" takes any currency with the rate of THAT shipment (a rate far from the usual one is refused). "Other costs of this shipment" (customs duty, C&F agent, local transport, ...) are each written down and spread into the unit cost with the freight. Goods, shipping and each other cost can name the money account that paid (shareholder and up); the account statement says what it paid for. The supplier is billed for the goods only, in the foreign amount and taka.
- 032_currencies.sql (currencies, currency_rates, shipment_costs, cost_book.buy_amount/buy_cur), handlers/currency.js, tests/a5_test.mjs (27).
- Not done yet: a separate buying price per product per supplier.

2026-10-03 — Plan A6 (capital corrections)
- **Investor return, month by month.** Each month's return is worked out on the money the investor had in during THAT month (a percentage day by day, so money added on the 16th earns from the 16th; a fixed monthly amount is the amount). Adding or taking back money no longer rewrites earlier months. It falls due when the month ends; the running month shows as "this month so far".
- **A cost of the month it fell due in.** Profit and loss, Expenses, Dashboard and Capital all carry the return in the month it was earned ("Investor returns"). Paying it only settles what is owed - it is no longer a second expense on the day of payment (and still moves the money account).
- **No profit without an owner.** The "stays with the business" wording is gone: shares under 100% show a warning, and a month cannot be closed until the shares make 100%.
- **A closed month closes the whole books.** Nothing can be dated into a closed month or any month before it, nor struck out of it: sales, expenses, capital lines, supplier bills and payments, transfers. Voiding an invoice of a closed month is refused (cancel it instead - the goods come back today). The owner can reopen the latest closed month, with a reason.
- 033_book_lock.sql (books_locked_through(), delete policy for reopening), lib/period.js, handlers/returns.js, erpCapitalReopen, tests/a6_test.mjs (28).

2026-10-03 — Plan A7 (partnership corrections)
- **Settlement on money received.** A partner "holds" the cash actually taken from customers, by whoever took it (payments.received_by, set inside a pool) - not the invoices raised. A sale on credit is profit, but nobody's cash: "Customers still owe" is shown and shared by the capital ratio, like the stock. Returned goods, adjustments and credit moved about are not money.
- **One set of books for the pool's costs.** Inside a pool the normal Expenses screen takes no entries and points to the pool's book; the pool's Profitability, Dashboard and Expenses totals read their expenses from that book, so they agree with the settlement.
- **Lines are struck out, never removed.** A reason is required; the line stays, crossed through, with who and why, for every partner.
- **Capital inside a pool** shows only Partnership: no second shareholder/investor system there.
- 034_partnership_fix.sql (pool_settlement rewritten, received_by trigger, pool_ledger.voided_*), lib/pool.js; phase4_test.mjs now 75.

2026-10-03 — Plan B1 + B2 (the partner gets in; one inventory screen)
- **B1.** "A company for a partner" (Settings) now hands back the partner's own private access link, shown once. It opens THEIR login and company only - nothing of the creator's business. E-mail is optional (the sign-in screen is off). The partner makes further links for their own devices under Settings > Access links, and joins the pool with the invite code as before.
- **B2.** Products has a switch **Mine · Joint pool · Partner's · All, side by side** (only when the business is in a pool). Counts only for what is not ours; a partner who stopped sharing, and staff who are not in the pool, are told why a column is empty. Handler erpSharedStock (manager and up).
- Tests: phase5_test (37), phase4_test (80).

2026-10-03 — Plan B3 (one invoice, any stock)
- **Sell from the joint pool without switching business.** New invoice has "Selling from: My stock / Joint pool" (shown to pool members only). A pool sale is the pool's in every way - stock, tier price, invoice number, books - made by the person as the pool member they are; the money taken counts as held by them in the settlement. One invoice comes from one stock (no mixing on one paper). erpCreateInvoice `from`, erpPoolCatalog.
- **A partner's item moves the stock.** A partner deal can name the product code. The stock owner's books then carry it as a real invoice to "<Partner> (partner)" at the agreed price: stock out, cost, revenue, a due. It is made when the stock owner acts (records it, or confirms the other side's request). "Paid" receives the money on that invoice. A deal whose stock has left cannot be withdrawn - cancel the invoice first.
- 035_partner_deal_stock.sql (partner_deals.sku, invoice_no, partner_deal_note()). Fixed on the way: nothing. Tests: phase4_test (95).
- Not done: the selling side has no automatic purchase/sale lines for the partner's item in its own books (it sells something it never stocked); it records its customer sale and the cost by hand.

2026-10-03 — Plan C2 (one table style everywhere)
- Every table on the older screens (Stock, Expenses, Capital, Money, Suppliers, Product cost, Web orders, Quotations, Settings...) now has the look of the new lists: shaded header in normal case, same row height, row highlight, framed, group rows like the list's groups, sticky header in long tables. Style only (one CSS block "plan C2" at the end of app.html) - no screen logic changed. Phone card layout untouched.
- Not done: the older screens do not get the new list's search box / filters / group-by / favourites; that needs a server list model per screen.

2026-10-03 — Plan C3 (New invoice: faster, fits a phone)
- A bar that stays at the bottom of the screen: products and units, grand total, what is due, the first thing still missing, and **Save invoice** - no scrolling to the end to see the total or to save. On a phone it sits just above the bottom menu.
- Quantity keys (− / +) around every quantity box. Remove is a small ✕.
- Customer takes two lines instead of five (phone + name, delivery + date, address). On a phone the help lines are hidden and fields sit two to a row.
- Ctrl+Enter saves. Typing a code and pressing Enter (already there) now also works when selling from a joint pool.
- Layout only: every field, rule and id is as before (one block "plan C3" at the end of app.html).
- Not done: product photos in the search (products have no photos stored).

2026-10-03 — Plan C4 (dashboard trimmed)
- The dashboard keeps what needs doing, today and the month so far (with its two charts) in sight. Stock and cash, Top products / Stock health and Recent orders sit behind three tabs under them; the chosen tab is remembered on the device. Nothing was removed and no figure changed (block "plan C4" at the end of app.html).

2026-10-03 — Plan C5 (small things)
- **One search.** On a list screen (Sales, Products, Customers) the top search offers "Filter this list for …" first; Enter applies it to the list. The other results (open an invoice, customer or product) are still there to click.
- **Short help.** An explanation longer than a line is cut to one line with a "?" beside it; "?" opens and closes it, and it stays open while you are on that screen.
- **Phone menu.** The menu's groups fold (tap the group name). Overview and Sell start open, the group you are in is always open, the choice is remembered on the device.
- One block "plan C5" at the end of app.html; nothing else changed. Track C complete.

2026-10-03 — Plan D4 (quotation → invoice)
- **Invoice** button on every quotation in the list, and **Make invoice** on the open quotation. One click puts it on the New invoice screen: customer name, phone and address; each product at the quoted rate (as a discount per piece under the price list); the quotation's discount; its delivery charge. Then check and Save - the invoice notes which quotation it came from.
- It says plainly what could not be carried: lines that are not products in the list (services, free-text items), lines quoted above the price list (the invoice uses the price list), and VAT (invoices here have no VAT line).
- Page only (block "plan D4"); createInvoice already took a note.

2026-10-03 — Plan D3, first half (product photos)
- A **Photo** card on every product's page: add, change, remove (manager and up). The picture is made smaller in the browser before it is sent (full picture up to 1200 px kept in storage; a tiny square one kept with the product for lists).
- The small picture shows in the Products list, in the product search on New invoice, and in Receive stock's search. Tapping the photo on the product page opens the full picture.
- 036_product_photos.sql (products.photo, products.thumb), goods.js erpProductPhoto / erpProductPhotoUrl / erpProductThumbs, tests/d3_test.mjs (13).
- Not done yet: photos in the price-list PDF; colour variants (second half of D3).

2026-10-03 — Plan D3, second half (colour families)
- A **family** is a label shared by the colours of one product. Each colour stays its own product (code, stock, cost, history), so nothing recorded before changes and "Take apart" undoes it fully.
- Products → **Colour families…** (manager and up): suggests groups from category + brand + type, names can be edited, nothing is written until "Group the ticked ones" is confirmed. Existing families are listed with "Take apart".
- New invoice search shows a family as ONE row (colours, total stock, price); tap it and pick the colour (stock beside each, sold-out greyed). The Products list can be grouped by family.
- 037_product_family.sql (products.family), goods.js erpFamilies / erpFamilyApply / erpFamilyClear, catalogue + list carry `family`; tests/d3_test.mjs (24).
- Live: nothing grouped yet - 16 families are suggested (124 of 138 products) and wait for the owner's confirmation.

2026-10-03 — Plan D5 (notes and files on every record)
- A **Notes and files** card at the foot of every product, customer, supplier and invoice page: write a note, attach a photo or a PDF (photos are made smaller first; PDF up to 3 MB). Each line shows who wrote it and when. A manager can strike a line out with a reason - it stays readable, crossed through.
- Supplier notes are for managers and up, like the supplier pages themselves.
- 038_record_notes.sql (record_notes), handlers/notes.js (erpNotes, erpNoteAdd, erpNoteVoid, erpNoteFileUrl), tests/d5_test.mjs (19).
- Not done: an automatic "who changed what" history per record (the Security activity log is per business, not per record); notes on a shipment (shipments have no page of their own - use the supplier's page).
- Go-live wipe empties record_notes with the rest of the books.

2026-10-03 — Owner feedback: things that existed but could not be found
- Money: "Set up" is now **+ Add / change accounts** (primary button) and "Count / correct" is **Correct a balance**. Nothing else changed: adding a bank, wallet or gateway, renaming, retiring and the payment-method map were already there.
- Dues: the button "Receive payment" is now **Receive / adjust due** (it always opened the box that also reduces or increases a due, with a reason; shareholder and up).
- Sheet ERP cross-check (read only): the live sheet is at build b261003-0358; the web app was cloned from b261002-1321. Difference: Steadfast Express (delivery method, 105 first kg, same-day Dhaka city only), a consignment number typed on the invoice or added later from Sales (erpExpressLink), "Check deliveries now" + hourly check that clears the due when a parcel is delivered (erpCheckDeliveries), dashboard line for parcels that came back. NOT yet in the web app.

2026-10-03 — Caught up with the sheet ERP (build b261003-0358)
- **Steadfast Express** in the delivery list: same day, Dhaka city only, 105 TK first kilo; outside the city the form says so. It is booked by hand in Steadfast's panel, so it is not offered "Send parcel".
- **Consignment number on the invoice**: a box on New invoice (Express, or a courier parcel already booked in the panel), or "Add consignment number" on the invoice's page later. One parcel, one invoice. (erpExpressLink)
- **Check deliveries now** on Sales (manager and up) and an **hourly** check: a parcel the courier says is delivered has its payment recorded ("COD (Steadfast)", still with Steadfast until the payout) and the due cleared. Parcels that came back or were part delivered are listed for a person and counted on the dashboard. Website orders are followed through the website; an invoice typed by hand for a website order is first brought up to what the website charged. Every round is written to delivery_checks. (erpCheckDeliveries, job "deliveries", 039_delivery_checks.sql)
- tests/s1_test.mjs (22). Timer erp-deliveries installed on the live project.

2026-10-03 — Plan D1 (serial numbers and warranty)
- Product page → **Serial numbers and warranty**: "Sold by serial number" and the warranty in months. The warranty can be changed any time; it applies to sales from then on - units already sold keep what they were sold with.
- Numbers come in with the shipment (Receive stock shows a box per serialised product) or are added on the product page, never more than the units on the shelf; duplicates are refused by name.
- New invoice: a serialised product shows a serial picker per unit and the warranty for this sale (prefilled with the product's; a special deal can type another). The sale cannot save without naming the units (unless none is numbered yet). The invoice page and the PDF show S/N and "warranty until".
- Returns name the unit coming back (or, when the whole line comes back, every unit); damaged ones are marked. Cancelling an invoice brings its units back.
- Look up any serial from the top search or the product page: who bought it, when, warranty left. A shareholder can change one sold unit's warranty with a reason.
- 040_serials.sql (products.serialised, warranty_months; table serials), handlers/serials.js, hooks in invoice.js / sales.js / stock.js / pages.js; tests/d1_test.mjs (34).
- Not done: a warranty "end date" typed directly at the sale (months only); serials on the quotation; the go-live wipe clears the serials table with the rest (products keep their flags).

2026-10-03 — Plan D2 (repair / service jobs)
- New screen **Repairs** (Sell): a machine comes in (serial number first - one sold here fills in the machine, the customer and whether it is under warranty), the problem, what it came with. Job numbers JOB-yymmdd-nn.
- On the job: diagnosis, parts (searched from the product list; they leave the shelf when put on and come back when taken off; under warranty they are priced at 0 unless typed), labour, the charge = labour + parts. Status: received → diagnosed → waiting for parts → repaired → returned to customer; cancel (manager) puts every part back.
- Money: receive payments on the job (manager and up; they land in the money account by payment method); the due stays on the job. Repair income and the parts used go into the profit and loss (and the Expenses screen's net) in the month the machine was returned.
- 041_service_jobs.sql, handlers/repairs.js (erpJobs, erpJob, erpJobOpen, erpJobSave, erpJobPay, serviceFor), tests/d2_test.mjs (23).
- Not done: a job slip / receipt to print for the customer; jobs on the customer's page; the P&L screen shows repair income inside the net only (no line of its own yet); the go-live wipe clears jobs.

2026-10-03 — Plan D6 (Excel out, spreadsheet in)
- An **Excel** button on Products, Customers, Invoices, Suppliers and Repairs (manager and up) opens one panel: export any list as .xlsx (products, customers, invoices, suppliers, serial numbers, repair jobs, 90 days of stock movements, the price book for shareholders); import products, customers or suppliers from an .xlsx or .csv.
- Import reads the file in the browser (an .xlsx is unzipped and parsed there, no library), matches columns by their headings loosely ("Sell price", "Price", "sell_price"...), shows what would be added, changed, refused and skipped, and writes only after "Yes". Stock figures in a file are never applied (use Stock count). A manager's file cannot change cost (shareholder and up can). The same customer twice in a file: the later row wins.
- handlers/excel.js (erpExport, erpImport), tests/d6_test.mjs (26). The xlsx writer is the one Expenses already had.
- Not done: importing stock counts, invoices or payments from a file (on purpose - those are movements, not lists); Excel buttons on the older non-list screens (Stock, Money) - their data exports from the panel anyway.

2026-10-03 — Per-person sign-in (Odoo's way)
- Sign-in by **e-mail + password** is the door again for everyone (Supabase Auth; the screen existed and was switched off). "Forgot the password?" e-mails a link to choose a new one - the recovery root when a phone or PC is lost. "Have an access link?" keeps the old link way as a fallback; existing links still open.
- Settings → **Users** (owner): everyone in the business with role, last sign-in, devices. **Invite** by name + e-mail + role: a login is made (or an existing one found) and an e-mail to choose a password is sent; "Resend e-mail". Change a role from the list. **Switch off** a user: signed out everywhere at once, nothing opens for them, history keeps the name; switch on again. Nobody can switch off or demote themselves; the last owner cannot be removed. Sessions per user with "End" and "Sign out everywhere".
- Roles now mean what they say for every login: sales / manager / shareholder / owner, enforced by the server (allow.js) and by the database (RLS sees only active memberships).
- 2-step sign-in (authenticator app) was already under Settings → Security; the Users list shows who has it on.
- 042_users.sql (memberships.active, member_role/is_member on active only, erp_add_member for e-mail logins, erp_set_member), handlers/users.js, index.ts linkOnly=false, tests/u1_test.mjs (28).
- Live: the only login is the owner (costareen.bd@gmail.com). Staff still have no logins - invite them under Users before go-live. Old 6-digit code logins (Settings → People) remain for the transition and are to be retired at go-live.
- Not done: the platform admin panel (next); automatic e-mail when a role changes; a session's access token stays valid up to an hour after "End".

2026-10-03 — Platform admin panel (Odoo's database manager)
- New screen **Platform** (System, shown only to platform admins): every business on the system with its owner(s) and their last sign-in, active users, last activity, invoices in 30 days, errors in 7 days (click for the list), storage used; the timers with their last run.
- **A new business** with its first owner (e-mailed a link to choose a password; an existing login is reused); its lists start with the usual values. **Suspend / Resume** a business with a reason: nobody in it can open anything ("This business has been suspended…"); the business you are working in cannot be suspended from inside it. **Send reset** e-mails an owner a password link - the admin never sees passwords.
- A platform admin has no role inside a customer's business. Every platform action is written to that business's own activity log (who: "Platform admin: …"), in the same transaction (platform_log()).
- 043_platform.sql (platform_admins - server-only, seeded with costareen.bd@gmail.com; businesses.suspended_at/reason; platform_log()), handlers/platform.js, core.js (suspended businesses refused, erpHello says platform), tests/p1_test.mjs (25). Local trial server makes the local owner a platform admin.
- Found on live while checking: 14 × "That image could not be read." on Quotations (a logo/signature the imported quotation settings point to is not in storage - re-upload under Quotations > Settings, or ignore), 9 × "Website sync key not set" (the web ERP has no website key yet - set it at go-live). The nightly timer shows "not run yet" only because the timers were re-installed today.
- Not done: billing / plans (table-ready later), "log in as" (deliberately not built).

2026-10-03 — Go-live preparation (nothing deleted)
- Dry run of the wipe on live: 19 tables would empty (1,045 invoices, 2,041 stock movements, 481 payments...), products / customers / price book / money accounts / settings stay. Keep-list extended: currencies + rates and WhatsApp opt-outs always stay; shareholders list and saved quotation items stay with --keep-lists.
- `start_fresh.py --next-invoice <n>` sets the invoice counter in the same transaction as the wipe. Today: sheet's latest invoice INV-20261002-1890, web counter 1884.
- Sheet script re-read: still build b261003-0358 - nothing new to port.
- docs/GOLIVE.md rewritten for the e-mail sign-in system, with a status column of what is done and what is the owner's.

2026-10-03 — Customers: the red "Customers who owe" box now sits at the top of the screen, above the customer list (owner's request).

2026-10-03 — No money lost: the Sales "Unpaid and at risk" box and money alerts
- **Sales screen, top**: "Unpaid and at risk" - owed in all, over 30 days, over 60 days, delivered but Steadfast has not paid, came back but goods not taken back. Tabs: Unpaid (every unpaid invoice, age-coloured, WhatsApp reminder and Receive / adjust due on each), Courier not paid, Came back, Website orders. Green "nothing at risk" when that is so. Managers and up.
- **Money alerts** in the bell (managers now see the bell too, but only the money alerts meant for them; system alerts stay with shareholders and the owner): a due turning 7/30/60 days old; a due reduced or increased by hand (who, how much, why); an invoice cancelled or deleted; a sale below cost; a big discount; a money account found short when counted; a parcel delivered but not paid out after N days; a parcel back but its goods not taken back after N days; stock written off over N taka; a website order not entered after N hours.
- **Settings → Alerts** (owner; shareholders read): each alert on/off, its threshold, who sees it (owner / shareholders / managers too), WhatsApp yes/no. WhatsApp alerts can go to up to three numbers (set in the bell). Things that happened are told once; things still open stay in the bell until fixed.
- handlers/risk.js (erpRisks, erpAlertRules, erpAlertRulesSave, moneyAlerts), alerts.js (money alerts first, role-filtered; up to 3 numbers), tests/r1_test.mjs (33); phase6_test updated for the new rule (managers get money alerts, never system ones).
- Not done yet: supplier bills falling due (bills have no due date), the 9 am WhatsApp summary, automatic reminders to customers (round 2).

2026-10-03 — Settings → Connections: one place for every outside service
- At the top of Connections: a status card for each service - Website, Courier (Steadfast), WhatsApp, E-mail sending, Google Drive, AI access - green works, amber needs a step, grey not connected.
- New **Website** card: the sync address and key (the key is never shown back), **Test connection** (asks the website's /ping), **Remove the key**, and a **Live sync** switch. The website sync now stays **off** until switched on here, even with a key saved (the timer only syncs switched-on businesses), so it can be set up before go-live without the sheet and the ERP both pushing stock.
- E-mail: `deploy/set_smtp.py` sends invitations and password resets through a real mail service (e.g. Gmail with an app password, ~500 a day) instead of Supabase's built-in mailer (a few an hour); the card then shows it.
- handlers/connections.js (erpConnections, erpWebsiteSet, erpWebsiteTest, erpWebsiteSync), jobs.js websync gated by website_sync_on, tests/c1_test.mjs (14), jobs_test updated.
- Fixed before shipping: Save read the typed key after the screen was redrawn, so the key was lost.
- Not done: Google Drive (next step), a standard WooCommerce / Shopify connection for shops without the plugin.

2026-10-03 — Google Drive copies
- Settings → Connections → **Google Drive**: "Connect Google Drive" sends the owner to Google to allow access (permission drive.file: the ERP sees only the files and folders it makes, nothing else in the Drive). Then every invoice, return, statement, quotation PDF, expense receipt, Excel export, note file and the nightly backup is also copied into the owner's Drive: "ERP - <business> / Invoices / 2026-10", Returns, Quotations, Expense receipts, Excel exports, Notes and files, Backups. The card shows the account, copied / waiting / failed, the last problem, "Open the Drive folder", "Copy older files too" and "Disconnect" (which also tells Google to forget the permission).
- Copies go through a queue and a 10-minute timer (job "drive"), so a slow or broken Google never slows or fails a sale; a file that cannot go is retried and the reason shown. If the permission is withdrawn in Google, the card says so.
- A quotation made Ready is now also kept as a PDF on the server (erpQuotePdfSave), so it can be copied too.
- 044_drive.sql (drive_queue), handlers/google.js, saveFile queues the file, index.ts answers Google's redirect (GET ?google=back), tests/g2_test.mjs (27).
- To switch on (once per system): create a Google OAuth app and run `deploy/set_google.py` (steps inside), then each owner presses Connect. Not done until then: nothing is copied on live yet.

2026-10-03 — Live backup sheet, and going back to a backup
- Settings → Connections → **Live backup sheet** (owner; needs Google Drive connected): "Make the backup sheet" creates one Google Sheet in the business's Drive folder with a "Read me" tab and one tab per list (invoices first, then lines, payments, stock movements, customers, products, expenses, money, suppliers, capital, serials, repairs...). A 10-minute timer (job "sheet", cron erp-sheet) rewrites only the tabs whose content changed (fingerprint per list), at most ten per run, so edits and cancellations show, not only new rows. Numbers stay numbers, phone numbers and codes stay text. Secrets, access keys, AI keys, caches and logs never go into it. Card: Open the sheet, Write changes now, Stop updating it, last written, tabs with row counts, the last Google problem said plainly (e.g. the sheet was deleted in Google).
- The sheet is a read-only copy: changing it changes nothing in the ERP. A two-way sheet was not built on purpose - two places that both accept edits is how money gets lost.
- Settings → Security → Backups: every kept copy now has **Go back to this copy**. It shows, list by list, what is here now against what the copy holds, then asks the owner to type the business name. Before anything is touched, today is copied ("before restore"), so a restore can itself be undone. All or nothing (one transaction); numbering carries on after the restored rows. Users, sign-in, keys, secrets, devices and the logs are never taken from the copy. Checked on the full trial data locally.
- Backup file names now carry seconds (yyyy-MM-dd HHmmss) and never overwrite one another.
- handlers/sheet.js (erpSheet, erpSheetCreate, erpSheetStop, erpSheetSyncNow, sheetTick), handlers/restore.js (erpRestorePreview, erpRestore), tests/g3_test.mjs (16), tests/g4_test.mjs (16), settings_test updated.
- Not done: nothing is written to a sheet on live until Google is set up (deploy/set_google.py) and the owner presses Connect and Make the backup sheet.

2026-10-03 — Any website: the open door, and matching products whose SKUs differ
- Settings → Connections → **Any website — open door** (owner): "Make the website key" (shown once, kept only as a hash; a new key stops the old one; Remove shuts the door), the last time the website called, and a "For the website's programmer" part with the four calls and a ready PHP example. Full guide: docs/WEBSITE-API.md.
- The door (no sign-in, header x-shop-key) at `.../functions/v1/erp?shop=`: `ping`, `stock` (every active product's qty less website orders not entered yet, cancelled ones not held), `order` (one order; sent twice = kept once; sent again with status cancelled updates it), `products` (the website's own list, so it can be matched before the first order). Orders land in Web orders like the plugin's and are entered by a person as before. Browser JavaScript cannot call it (no CORS) - on purpose, the key belongs on the website's server.
- **Match website products** box at the top of Web orders (manager+): every website item that matches nothing, waiting orders first, with the three closest products suggested by words and letters ("Bambu Lab" finds "Bambulab"; a different size like 1kg/3kg is held back). One click links it for good; or type our SKU. Same SKU (capitals/spaces ignored) and same barcode (also a barcode in the website's SKU field) match by themselves. Items with no SKU are remembered by name. Links can be undone. Nothing is ever matched by a guess.
- Linked items: website orders enter as our product; stock goes out under our SKU AND the website's SKU (the WordPress plugin push too). Entering an unmatched order now says which items to match.
- Found on the trial data: 9 website items (real costareen.com orders) already match nothing, e.g. CZ04434 "SUNLU PETG SKYBLUE", the Bambu A1 / P1S printers, two Polymaker colours - Rahman can link them in the new box.
- 045_shop_links.sql (web_product_links, web_catalog), lib/match.js, handlers/shop.js, weborders.js (addWebLines, stockItems, matching in enter/pending), jobs.js exports asBusiness/owners, index.ts route ?shop=, tests/w1_test.mjs (34).
- Not done: Shopify and WooCommerce-without-plugin connectors (they would sit on this door), automatic stock push to such sites (they poll ?shop=stock).

2026-10-03 — WooCommerce and Shopify without the plugin
- Settings → Connections → Website now has three kinds: **Costareen plugin** (as before), **WooCommerce** (shop address + consumer key/secret from WooCommerce → Settings → Advanced → REST API, Read/Write) and **Shopify** (shop address - the admin.shopify.com/store/<name> address is understood too - + a custom app's Admin API token with read_orders, read_products, write_inventory, read_locations). Where-the-keys-are steps are on the card. Keys are stored as secrets and never shown back. Changing the kind switches the live sync off.
- New buttons once keys are saved: **Test connection**, **Check for orders now**, **Preview stock changes** - all usable before the live sync is switched on.
- Orders: the last 7 days' new or changed orders every 15 minutes (Woo modified_after, Shopify updated_at_min), into Web orders like the plugin's: name, BD phone, address, payment words, per-line totals after discounts (Shopify discount allocations), cancellations picked up.
- Stock: every shop item (Woo simple products and variations, Shopify variants) matched to a product (link > same SKU > barcode) gets our stock less website orders not entered yet. Woo: batch updates, stock keeping switched on for that item. Shopify: set at the first active location, only "Track quantity" items, 60 changes per run (rate limit; the rest next run). Items that match nothing are never touched. The shop's product list is kept, so its unmatched items show in Match website products before any order.
- handlers/stores.js (storePull, storePush, storeTest), weborders pull/push dispatch on website_kind, connections.js kind/store_url/keys, jobs websync for any kind with keys, httpFetch returns the Link header, tests/w2_test.mjs (23).
- Not done / limits: Shopify stores with several locations get stock at the first one only (setting shopify_location exists, no screen yet); Woo product pages past 3000 products are not read; no webhooks (15-minute polling).

2026-10-04 — tidy-1: how it is paid, delivery types, COD collected, parcel labels, new business from the dropdown
- **How was this paid?** is one question with four answers: **Paid now** (+ "Paid by"; COD is not offered as a method), **Cash on delivery** (only for a Courier or Own-rider delivery; optional advance now with its own method, e.g. 100 by bKash; the rest is collected by the courier/rider), **Part paid** (received now + paid by; 0 = Due, everything = Paid), **Due** (no method). The status always follows the money really received. Confirm box and the save bar say it ("cash on delivery 1,825"). The server enforces the same rule for every way an invoice is made: the New invoice form (also quotation -> invoice, joint-pool sales), website orders (COD website order -> COD invoice; paid online -> paid; else due) and partner deals (due, no method).
- Old invoices are not rewritten; on screens a payment method on an invoice with nothing paid is shown as nothing (465 "Cash" with nothing paid in the trial data).
- **Delivery options** are the business's own list now (Settings → Lists → Delivery options), each with a type: Pickup / Courier / Own rider (Costareen's usual list with types guessed until changed). Cash on delivery is offered only for Courier and Own rider. Before, the list was hard-wired.
- **Delivered & collected** for cash on delivery the ERP does not follow (Pathao, own rider, Steadfast without a number): on the invoice page and in Sales → Unpaid and at risk → **With the courier**: "Delivered — cash came" (Cash to the shop) or "Delivered — courier holds it" (method "COD (<delivery>)", map it to the courier's money account). Steadfast parcels with a consignment number still clear themselves on delivery.
- Cash on delivery not yet collected is no longer "customer owes" (not in Unpaid, no "owes for 7 days" alert); it has its own figure and tab, and a new alert "A cash-on-delivery sale still not collected" after 14 days (Settings → Alerts).
- **Courier field**: Steadfast courier asks "Already booked in Steadfast?" No/Yes (Yes shows the number box); Steadfast Express shows the box (optional). The long explanation under the box is gone.
- **Parcel labels**: "Print label" right after booking, "Print parcel label" on a booked invoice, "Print today's labels" in Sales. Shop name/phone, customer, phone, address, COLLECT amount (or PAID), invoice, items, consignment number with a Code 128 barcode. A4 sheet of six now; "Sticker 100×75 mm" for a label printer later (remembered per computer).
- **New business** only from the dropdown at the top: a small window (name, currency, optional logo) → created and switched to. "Add a business of your own" and "A company for a partner" are gone from Settings (joint pools untouched).
- Fixed on the way: the invoice form's currency was hard-wired to BDT; it is the business's own now.
- lib/delivery.js, handlers/cod.js (erpCodCollected), catalog.js (erpDeliveryOptions/Save, currency), courier.js erpParcelLabels, invoice.js payment rule, risk.js (isCodDue, cod_waiting), tabs.js display, weborders/partners, settings.js currency; tests t1_test.mjs (25); sales_test and r1_test updated for the deliberate changes.
- Not done: the barcode is checked for structure, not yet with a real scanner; Pathao/RedX booking from the ERP (only "Delivered & collected" by hand).

2026-10-04 — tidy-2: explanations behind "?"
- One rule for every screen (and windows opened over it): a long explanation under a card title or a field is hidden; a small "?" next to the title or field name shows it (tap again to hide; it stays open while you move around until the page is reloaded). Text that carries figures (counts, money) stays as one line, the rest behind the same "?". Long hints inside field names ("saved - type a new one only to change it") move behind the field's "?". Long plain information notes shrink to one line.
- Never hidden: amber and red notes (warnings, errors), anything with a button, link or field inside, empty-list messages, tables, toasts, and the questions in confirm boxes.
- Replaces plan C5's one-line "?" (same place, now hides fully).
- Checked on Dashboard, New invoice, Sales, Web orders, Money, Products and every Settings tab: no long explanation left on screen.
- Not done: the texts themselves were not rewritten shorter; that comes with the Bangla stage (each phrase is touched then anyway).

2026-10-04 — lang-1: English / বাংলা per person
- A **বাংলা / EN** button in the top bar (next to refresh). Each person's choice is kept with their login (046_lang.sql erp_prefs.lang, erpSetLang, returned by erpBusinesses), so it follows them to every device; the device remembers it too for a fast start.
- In Bangla: the menu, screen titles, buttons, field names, table headings, choices (e.g. এখনই পরিশোধ / ক্যাশ অন ডেলিভারি / আংশিক পরিশোধ / বাকি), empty-list messages, the "?" explanations shown so far, placeholders and hover hints - about 610 phrases and 26 patterns with numbers ("3 days ago" -> "3 দিন আগে"). Font Hind Siliguri. Digits stay English (money is easier to check).
- Not translated, on purpose: product, brand, colour, category, unit, payment-method and delivery names, customer data, month names - they are the business's own words. A drop-down option keeps its English value, so what is saved never changes with the language.
- Done as a dictionary applied to whatever is drawn, so the existing screens did not have to be rewritten; new words are added to the dictionary.
- Checked locally: menu, New invoice (saved a COD invoice in Bangla), Sales, Customers, Products, Web orders, Stock, Expenses, Money, Quotations, Repairs, Suppliers, Profit - no screen phrase left in English except data. tests/l1_test.mjs (5).
- Not yet (lang-2): the confirm-box questions, toasts and the server's own messages (errors, "Saved ... "), Settings long texts, PDFs/invoices for customers (a business setting), and the owner's review of shop words.

2026-10-04 — lang-2: Bangla for messages, confirm boxes and customer invoices
- Every message the page or the server can show was pulled out of the code (887 lines: 577 fixed, 297 with moving parts such as names and amounts) and given Bangla. Confirm boxes are translated line by line; a message inside a message is translated too ("সেভ হয়নি: Sunlu PLA Black-এর যথেষ্ট স্টক নেই: স্টকে 0, চাওয়া হয়েছে 1।"). Names, products and amounts inside stay as written.
- কাস্টমার -> গ্রাহক everywhere (owner's word).
- **Customer documents** (Settings → Business, owner): English or বাংলা for the invoice PDF the customer receives - labels only (ইনভয়েস, ক্রেতা, পণ্যের বিবরণ, সাবটোটাল, মোট বাকি, পেমেন্টের তথ্য, "আপনার অর্ডারের জন্য ধন্যবাদ।"); product names, customer data and figures stay as typed. The PDF server has Noto Sans Bengali. lib/doclang.js, erpDocLang.
- tests: l1_test (8).
- Not done: quotation PDFs, statements and the price-list PDF are still English (next if wanted); a few long explanations behind "?" that contain numbers are still English; a handful of messages assembled in unusual ways may still show English - send a screenshot and the line is added.

2026-10-04 — lang-3: the business's own Bangla words
- The Bangla was written by the AI (no ready-made ERP dictionary fits shop Bangla), so the business can correct it: Settings → Lists → **Bangla words** (manager or owner): every phrase with the built-in Bangla and a "Your word" box; search; "Download for review" (CSV for Excel, staff mark their words) and "Upload corrections". Own words win everywhere for everyone in the business at once ({1}, {2} stand for names and amounts). Kept in business_config bn_words (erpBnWords / erpBnWordsSet, logged as a change). Empty = back to the built-in word.
- Fixed on the way: the screen translated before the business's words were loaded; it now waits for them.
- tests l1 (12).

2026-10-04 — installer-1: a company builds its own copy in its own Supabase account; the provider keeps control
- **Release**: `deploy.py release` keeps this version's server files, database steps, storage and timers in erp_releases on the provider's system. Every install is built from the newest one.
- **Install link** (Platform → Company copies → "+ Install link for a company"): single use, 14 days. The company opens `erp.costareen.com/#/install/<code>`: company name, owner name and e-mail, and a Supabase access token from its own free account (steps on the page). The ERP then builds itself there, one short step at a time while the page is open: project (Singapore) → wait until it runs → keys → 47 database files → file storage → private settings (who it is, where its provider is, the PDF service, its own timer key) → the ERP server → timers → the company's business and owner login (e-mailed to choose a password; the owner is the platform admin of their own copy). "Open my ERP" then opens THEIR copy on that device (#/use/<id>; #/use/main goes back).
- **Control**: every copy checks in every hour (job heartbeat): version, users, invoices in 30 days, errors in 7 days. Platform → Company copies lists them (running / not heard from / switched off / install failed, with the step and Supabase's own words). **Switch off** (a reason is required and shown to them) stops the copy within the hour - nobody in it can open anything, their data stays theirs; **Switch on** reopens it. If the provider cannot be reached, a copy keeps working on the last answer. A copy never installs others. A failed install says why (e.g. the free plan's 2-project limit) and can carry on from the failed step.
- Checked against Supabase itself (on the provider's account, with a throwaway function deleted afterwards): organisations, project status, keys, and uploading a multi-file server all work as the installer uses them. Not yet checked for real: creating a whole new project end to end - the first real install (the friendly company) is that test.
- 047_installs.sql (erp_releases, erp_installs, erp_install_invites, erp_control), handlers/installer.js, lib/control.js, core.js refuses a switched-off copy, jobs.js heartbeat, cron erp-heartbeat, index.ts routes ?install= / ?control=, page: install wizard, #/use/, Platform → Company copies; tests/i1_test.mjs (25).
- Not yet (installer-2/3): pushing a new release to existing copies (Update), their own web address, "Connect Supabase" one-click sign-in instead of pasting a token, deleting a copy.

2026-10-04 — installer-2: updates for company copies, their own web address
- **Update**: Platform → Company copies shows each copy's version against the newest release; **Update to <release>** (one copy) or **Update every copy** runs, one short step at a time: the database files that copy has not had yet (nothing twice), then its server, then its timers with a fresh key and its new version. Nothing happens when a copy is already on the newest. The release is the one already running on Costareen's own ERP (deploy order: own system first, then `deploy.py release`, then Update).
- If the company's Supabase token was removed or expired, the update stops and says so; **New Supabase token** takes the one they send (checked against their project first) and the update carries on.
- **Own web address**: **Web address** on a copy (e.g. erp.theirshop.com). The company adds a CNAME to costareen-erp.pages.dev, the provider runs `python deploy.py domains` once; opening that address then opens their own copy (the page asks the provider which copy lives there; a switched-off copy still opens its sign-in page, which says why). The tab title shows the company's name.
- 048_install_updates.sql, installer.js (erpInstallUpdate, erpInstallToken, erpInstallDomain, ?install=host), deploy.py domains, tests/i2_test.mjs (19).
- Not done: "Connect Supabase" one-click sign-in (needs an OAuth app registered by the provider at Supabase); the sign-in page does not show the company's logo yet; deleting a copy (the company deletes its Supabase project itself).

2026-10-04 — installer-3: guided set-up, "Connect Supabase", the company's own website address, no provider name
- The install link now opens a **guided set-up in 5 screens** with a step bar: 1 Your company (name, owner, owner e-mail, "your website, if you have one") → 2 Connect Supabase → 3 Build (progress, "Try again" on a failure) → 4 Your address → 5 Ready (password e-mail, "Open my ERP", the address to keep). It remembers where it was if the page is closed or reloaded.
- **Connect Supabase** (one click, OAuth with PKCE): Supabase's own sign-in/sign-up opens, "Authorize", and the person is back on the same screen. The connection renews itself (also for later updates). Until the provider registers the OAuth app (deploy/set_installer.py) the screen guides the token paste instead (buttons straight to Supabase's sign-up and Access Tokens pages).
- **Their own website address**: with a website (e.g. xyzenterprise.com) the ERP opens on erp.xyzenterprise.com (the word "erp" can be changed: office, manage...). The screen shows the one CNAME record to add with Copy buttons and where to add it (cPanel, Namecheap, GoDaddy, Cloudflare, BD hosting), then checks by itself every 20 s: waiting for the record → record found, securing → ready; with the Cloudflare key set, the address is switched on automatically; their website and e-mail are untouched. Without a website: a free neutral address. The copy's own links (alerts) use its address once ready.
- **No provider name**: install links and copies without their own address use a neutral page (office-erp.pages.dev, same app); a customer's record points there; titles say "<Business> ERP"; "Costareen plugin" -> "WordPress plugin"; the built-in delivery list says "Own delivery"; message links use the copy's own address. Costareen's own business keeps its website address and "Costareen Delivery" (050 writes them down as its own settings first). Opened on the neutral address without a link, the page shows nobody's ERP.
- 049_install_oauth.sql, 050_keep_own_defaults.sql, installer.js (oauthStart/oauthBack/tokenOf, domainSet/domainCheck, caps), deploy.py web also publishes office-erp, deploy/set_installer.py, tests/i3_test.mjs (19).
- Needs the owner (at connection time): run `python deploy/set_installer.py` - it sets the neutral address and asks (hidden) for a Cloudflare token with only "Pages: Edit" and for the Supabase OAuth app's id/secret (steps inside). Not checked for real: Supabase's OAuth screens and a real customer domain - the first real install is that test.

2026-10-04 — tidy-3: explanations hide fully
- The "?" rule now hides every how-to text whole (from 40 characters), also those with bold words - before, text with bold words or numbers stayed on one line (e.g. "Invoice lines", "Receive stock"). Only a short status line with figures (under 120 characters, e.g. "3 of 14 not yet entered") stays, on one line. State notes ("Connect Google Drive first") and warnings stay visible.
- Swept every screen (Dashboard, New invoice with lines, Sales and an invoice page, Stock with Receive / Count / Supplier orders / To order, Products, Customers and a customer page, Profit, Expenses, Capital, Money, Suppliers, Repairs, Quotations and the editor, Campaigns, Web orders, Product cost, Maintenance, Platform, every Settings tab): no how-to text left on screen.

2026-10-04 — tidy-4: switching business, one way to add one, Maintenance table
- Switching business left boxes of the previous one on screen (Unpaid and at risk, money alerts, connections, backup sheet, website matching, delivery list, documents language, and more): everything that belongs to a business is now cleared on the switch and read again for the new one; its own Bangla words too. (The server always sent the right business; the page kept old copies.)
- "A new business" (business name + owner name + e-mail) is gone from Platform: a business of your own is added from the dropdown at the top (switchable, same login); another company gets its own ERP (Platform → Company copies → install link).
- Maintenance: short descriptions in table cells stay as they are (the "?" broke the table).
- Checked: a second business added from the dropdown has its own (empty) website connection and kind, courier keys, WhatsApp, Google Drive and backup sheet, website door key, customer documents language, delivery list, invoices, money and risk figures - it behaves as a separate business; only the login and the switch are shared.

2026-10-04 — db-pool-1: the database ran out of connection slots
- Seen live: "remaining connection slots are reserved for roles with the SUPERUSER attribute". Every running copy of the server opened its own direct database connections (up to 5), and the timers start several copies at once; on the free plan the slots run out and calls fail. The server now goes through Supabase's connection pooler (transaction mode, port 6543; secret ERP_POOL_HOST) - same user and password, nothing else changes. Checked live: calls answer, and the server holds no direct connections any more. The installer sets the pooler host for every company copy too.

2026-10-04 — tidy-5: messages, website products, service buttons, Connections tiles, greeting, delete a business
- **Messages** now appear at the top centre; a problem stays until its ✕ is pressed, good news fades. The ✕ on a red note in a screen (e.g. "Customer name is required.") closes it.
- **Greeting** follows Dhaka's clock (it said "Good morning" late at night on a device set to another time).
- **Website products to match** is behind a button at the top of Web orders ("Website products to match (7)" / "Hide"). No more percentage guesses: each website product has **Add to ERP** (name and SKU from the website, you give category and prices; the same SKU then matches by itself) or **Link** to one of your SKUs (with search). Prices may differ: linking only ties stock; a website order keeps the website's price.
- **Status buttons** on pages that need an outside service: Web orders (Website), Sales (Courier), Campaigns (WhatsApp) - green connected, grey not; pressing one opens the same set-up as Settings in a window over the page (owner; others are told to ask the owner). Web orders no longer shows the red "Could not read the courier" when the website is not connected.
- **Connections tiles**: small and all the same size: dot, name, one word (Connected / Not connected / Needs a step); "?" shows the detail; pressing a tile goes to its card.
- **Delete a business** (Settings → Business → Your businesses, owner, not the one you are working in, not your last): type its name; a full copy is made first (kept 90 days in the ERP, and copied to Google Drive when connected), then all its records are cleared. **Deleted businesses → Restore** brings it back with all its records (staff and connections are set up again). 051_deleted_businesses.sql, handlers/bizdelete.js (restore.js putBack shared), tests/d9_test.mjs (18).
- erpConnStatus (states only, for everyone).

2026-10-04 — Dashboard: a past day shows its gross profit
- Picking another day on the Dashboard now shows Revenue, Orders, Units sold and **Gross profit** with its margin (shareholder and owner, the same rule as today's card), worked out the same way as today's (each line's cost at the time of the sale). Others still see the average order. tests/d10_test.mjs.

2026-10-04 — ui-6: account menu, a sidebar that folds to icons, the business's background photo
- Backup of the design before this: git tag `design-before-ui6` (go back with `git checkout design-before-ui6 -- web/app.html`, build and deploy web).
- **Account menu** (photo or initial, top right): your photo (tap to change; made small in the browser), name, e-mail, role and business; **Appearance** Light / Auto (follows the phone or computer) / Dark in one place; **Language** English / বাংলা (the quick button in the top bar stays); **Background photo** On / Off for yourself (when the business has one); Colour theme…; **My account** (name, photo, password change for e-mail sign-in, 2-step sign-in, sign out on every device); Help & shortcuts; **Sign out** (replaces "Forget device"). On a phone it opens as a sheet from the bottom.
- **Sidebar folds to icons**: the « / » button at the top next to the business name; folded, each icon shows its name when pointed at and the counts (e.g. Web orders 14) stay on the icons; each device remembers its choice; phones keep their slide-in menu.
- **Background photo** (Settings → Business, owner or manager): a photo for the business behind the screens. Cards, tables and forms stay solid so text is always readable; the photo shows around them under a soft layer in the page's own colour (Subtle / Medium / Strong), lightly blurred; titles over it get a shadow. Made small in the browser (≤ 1600 px). Each person can switch it off for themselves.
- 052_look_photos.sql (profiles.avatar, erp_prefs.bg_off), shell.js erpProfile/erpProfileSave/erpBg/erpBgSave/erpBgOff, erpSetTheme takes "auto"; tests/u6_test.mjs.

2026-10-04 — ui-6b: no flicker of explanations, language in one place, background photo from the account menu
- Long explanations showed for a moment on loading or redrawing a screen, then hid behind "?" (the hiding ran on a 30 ms timer, after the screen was drawn). It now runs before the screen is drawn: they never show.
- Language is only in the account menu now (the top-bar বাংলা button is gone).
- The background photo can be added or changed from the account menu ("Add a background photo" / "Change background photo", owner and manager), as well as in Settings → Business.
- ui-6c: the old account menu ("Themes… / Switch to Light / Forget device") showed for a moment after a reload until the new one was built; the new menu is now built as the page loads and the old one is never drawn. The Themes window no longer has its own light/dark switch (Appearance in the account menu is the one place).
- Platform: "Timers" became **Automatic jobs** in plain words (Nightly backup - every night at 3:00 AM..., Money alerts, WhatsApp campaigns, Delivered parcels, Copies to Google Drive, Live backup sheet, Website sync, Check-in of company copies), with "✓ worked / ✕ failed / not run yet" and when it last ran; the technical name shows when pointed at.
- Errors counter (Platform): the two noisy sources are gone - a quotation picture never uploaded is simply not shown (was 26 "That image could not be read" in 7 days), and Web orders no longer asks the website courier report when no website is connected (was 16). What stays counted is a real fault or a refused sign-in.

2026-10-04 — owner safety: recovery checklist, emergency link, two owners agree
- **Settings → Security → Recovery** (owner): four checks with a red ✕ / green ✓ and a button for each - a second owner e-mail (Invite), 2-step sign-in (Turn on), an **emergency link** (Make it: a full-access link shown once, to print or keep in a password manager; a new one stops the old one), backups in Google Drive (Connect). "You cannot be locked out" when all four are green. The last resort is the Supabase account itself.
- **Two owners agree**: switching off an owner, or lowering an owner's role, no longer happens at once. Both owners - the one asking and the one concerned - get a one-time link in their own e-mail (the login system's own sign-in link, so opening it proves the mailbox); each opens it, sees what is asked and agrees or refuses. Only when both agree is the change made; one refusal stops it; it lapses after 48 hours. Waiting changes show under Settings → Users (the asker can cancel). One owner can never use the other's link; nobody switches themselves off; the last owner is never removed.
- Until the owner's own mail service is set up (deploy/set_smtp.py, which now also sets this e-mail's text), Supabase's free plan sends the link with its standard "sign-in link" wording; the link works the same and the ERP shows the full change.
- Found on the way: company copies did not get their login e-mail address set (password e-mails would have pointed at Supabase's default); the installer now sets it (their own page, ?use=<id>, and their own address once ready), and the page understands ?use=<id>.
- 053_owner_safety.sql, handlers/owners.js, users.js (owner changes), index.ts sendMagic; tests/o1_test.mjs (17), u1_test updated for the deliberate change.
- The background photo has one place now: the Themes window (account menu → "Theme & background…"): add or change, remove, how strong (owner and manager), and "for me" show or hide (everyone). Removed from the account menu and from Settings → Business.
- The background photo is kept on the device and shown at once; the server sends it again only when it changed (a version per photo). The page shell was already cached by the app's service worker; business data always comes fresh.
- Found: the site's security rules (web/_headers) allowed only the provider's own Supabase server, so a company copy's page could not have talked to its own server; now any *.supabase.co.
- tidy-6: no rows of their own above pages: on Web orders the website state and "Website products to match" sit in the Website orders box next to "Check the website for new orders"; on Sales the courier state sits in the existing button row; Campaigns already had a WhatsApp state pill (the extra one is gone) and that pill now opens the set-up.

## tidy-7 — page buttons in the title bar; no browser autofill in key boxes (2026-10-04)
- The rows of buttons a page started with (Excel; Sales: courier chip, Print today's labels, Check deliveries now; Products: Colour families…) now sit at the right of the page's title bar (#o_cp) on every page, via one step after each repaint (`titleActions`). Moved as DOM nodes, so their click handlers keep working. Phone width: they wrap under the title.
- Key/password boxes inside the ERP get `autocomplete="new-password"`, other card text boxes `off` (sign-in screen untouched). WhatsApp instance/key boxes have their own names so Chrome stops putting the owner's e-mail and saved password there. Chrome may still offer a "suggested password" on key boxes; harmless.
- WhatsApp QR: already built — after "Save and test" succeeds against a running Evolution server, "Link a WhatsApp number (QR code)" shows the QR (refreshes until scanned in WhatsApp → Linked devices).
- Not done: nothing else on this list.
- tidy-7b: every title-bar button/chip is one size (34px, 13px text, same corners). Web orders now follows the same rule: Check the website for new orders, Website products to match, Website chip sit in the title bar instead of inside the box.
- tidy-7c: Web orders: Check the website for new orders + Website products to match back inside the Website orders box, right side of its heading; only the Website chip stays in the title bar.

## tidy-8 — no box that appears and vanishes on Web orders (2026-10-04)
- The Courier box on Web orders was drawn before the connection status arrived, then removed when the website turned out not connected (a flash on every reload). It now waits for the status and shows only when the website is connected AND Steadfast reports parcels (or an error); an all-zero box is not drawn. Kept, not removed: once the website is live it is the only place showing each website parcel's courier state.

## game-1 — "Print Run" under New invoice (2026-10-04)
- A small symbolic runner in the empty space under New invoice: a print head on the bed lays a filament line; jump blobs and spaghetti, duck gantry bars (after layer 50), catch spools (+20 layers). Score in layers, speed shown as 50→300 mm/s, best kept per device (localStorage). Canvas, thin lines in the theme's colours, no assets.
- Never in the way: sits after #view (repaints don't touch it), takes half of the free height (max 260 px), hides itself under 110 px or below 760 px wide. Keys reach it only while the canvas has focus; any key, click or tap outside pauses it; tab hidden pauses it. ✕ hides it on that device; Settings → Business brings it back.
- Owner decides who sees it: erpGame / erpGameSet (business_config game_who = owner | all | none, default owner). Test g1 (7 checks).
- No internet (browser 'offline' event): a window at the bottom says nothing typed is lost and, if allowed, holds the game; 'online' removes it.
- Not done: leaderboard across staff (deliberately); phone play (hidden there).

## game-2 — Print Run in colour, filament runout, more print faults; a game switcher (2026-10-04)
- Colour spools (red, blue, green, yellow, orange, white, purple; rare Silk gold +50, rare Rainbow = layers count double for 5 s). Grabbing one changes the filament: the line printed from there on is that colour, so the bed shows a striped multi-colour print. Same colour in a row: ×2, ×3 points.
- Filament runout: a bar empties over ~24 s; every spool refills it; empty = "Filament ran out at layer N". Spools come more often when it runs low.
- New faults unlock by layer: stringing (50, duck), gantry (80, duck), warped corner (100, jump), loose screw rolling at you (150), binder clip (220, hold jump for a higher one), thermal runaway flame that flickers on/off (300, pass while off).
- Game over shows "Your print": the whole run as a colour bar. Colourful head (brass nozzle, red heater, filament in the current colour), amber bed sheet, faint plate grid.
- A bar above the canvas with game tabs (only Print Run now; GAME_LIST takes more) and ✕. Wider gap under the invoice (36 px).
- Checked with a scripted player: 40 s, every obstacle type cleared, colours changed 8 times, runout ends the game.

## tidy-9 — Defaults in plain words; game setting moved (2026-10-04)
- Settings → Business → Defaults: each known value has a plain name with its explanation behind "?" (Business name, Currency, Reorder level for new products, Supplier delivery days, Google Drive folder for invoice PDFs, Next invoice number, Website address for orders). Values the system keeps for itself (courier caches, delivery/money rules saved by their own screens, anything unknown) are folded under "Values the system keeps for itself — for support only", still editable there.
- "Game under New invoice" moved from Settings → Business to the bottom of Maintenance.

## tidy-10 — system values locked, undo on Defaults; no flame in the game (2026-10-04)
- "Values the system keeps for itself": read-only. "Change…" warns (can break invoices, deliveries or money; only if support asks) before the box opens.
- Every Defaults save (plain ones too) can be undone: an Undo button in the row and in the "Saved" toast puts back the value from before, while the page is open. "Nothing changed" when the value is the same.
- Print Run: the thermal-runaway flame is removed (too hard to time). The drawing code stays unused.

## game-3 — Costareen Brawl (fighting game, 2nd tab) (2026-10-04)
- New tab "Brawl" in the game strip. One player against the computer: choose a fighter, beat the others one by one (each level the computer reacts faster, blocks more, hits harder), last level the Spaghetti Monster (160 HP). Best level kept per device.
- Keys (only while the canvas has focus): ← → move, ↑ jump, ↓ block, A punch, S kick, D special, hold F to power up (aura), F when full = Print Blast (layered-filament beam, 30 damage).
- Specials: Filament Whip, Spool Throw, Hot Nozzle Dash, Resin Splash (slowing puddle), Layer Wall (blocks shots), Support Pillars, Laser Engraver, Heated Bed Slam (shockwave), Speed Print 300 (flurry).
- 9 fighters from photos of staff who agreed (owner confirmed): pixel heads 28×34, 9–13 colours, made with a script (grabCut background cut, outline). Names: Rafiq, Sabbir, Tanvir, Jubayer, Nayeem, Shakil, Arif, Rakib, Imran.
- Privacy: the faces are NOT in any public file. They are in the business's own data (business_config 'fighters'), read with erpFighters (any member) and saved with erpFightersSet (owner, every field checked). Other businesses / the neutral copy get three plain faceless fighters.
- The game code is web/games/fight.js (30 KB), fetched only when the Brawl tab first opens; deploy.py now publishes web/games; _headers no-cache for /games/*.
- Fixed on the way: the account menu read LANG before it existed at page load (ReferenceError on every load since ui-6), which skipped the photo/background reload after switching business and the saved "auto" theme.
- Tests: g1 +6 checks (fighters read/save/refusals). Scripted play: lost → retry, two level wins, supers on both sides, every special lands.
- Not done: "Add a fighter" upload in Maintenance (fighters are loaded by script for now); 2-player; sounds.

## game-4 — Brawl v2: how to play, real moves, fight effects (2026-10-04)
- "How to play" button in the game bar (both games): a window over the game with every key and each fighter's special move; it pauses the game.
- First fight starts with a lesson (punch, 3-hit combo, kick, block, jump, special, power up, Print Blast) - steps in any order, Esc skips, remembered per device; nobody can be knocked out during it.
- Bodies are now skeletons (torso, bending arms and legs, fists, boots) tweened between key poses: idle breathing, walk cycle, jab → cross → uppercut combo (presses are buffered, even during the hit freeze), kick, ↓+S sweep, flying kick, block, hit recoil, knockdown + get-up (short invulnerability), double-tap dash, win pose.
- Effects: hit freeze, screen shake, impact ring + star + sparks, POW/BAM/THUD words, damage numbers, punch trails, dust on landing/dashes, afterimages on dashes and flurries, glowing power aura with rising sparks, slow-motion K.O. with flash, health bars with a draining "ghost", segmented power bar with MAX, face portraits, a workshop background (shelves, printers with moving nozzles and blinking lights, spools, wooden floor).
- Specials redrawn: whip with glow, spinning spool with trail, fire dash, resin blob + bubbling puddle, layer wall printed by a moving nozzle, support pillars printed layer by layer, laser with glow, slam shockwave, Print Blast as a scrolling stripe beam with a charging ball of filament.
- The computer is gentler at level 1 (damage ×0.75) and rises 8% per level; combos, sweeps, jump-ins and jumping over sweeps at higher levels.
- Checked with captured frames (kick, blast, combo, pillars) and a scripted lesson run.

## game-5 — Brawl v3: smarter computer, rounds, supers, sound, endless (2026-10-04)
- The computer reads your attacks (reaction time and accuracy rise with the level and the Easy/Normal/Hard choice): blocks, jumps over sweeps and spools, steps back from big moves, jabs through slow moves, punishes after a block, breaks combos with 25 power ("BREAK!"), escapes corners when low, keeps distance if it has a ranged special, sweeps when you block high, and remembers if you spam kicks.
- Rounds: best of 3 per level, 60 s timer (time up: more health wins), round dots, "PERFECT!".
- Each fighter has his own super (F at MAX) with a dark-screen banner: Whip Storm, Spool Storm, Inferno Rush, Resin Flood, Wall Crush, Mega Pillar, Laser Sweep, Earthquake, Speed Print 1000; the boss: Spaghetti Storm.
- Brutal (cartoon, no blood): juggles in the air, wall splat off the floor edge, dizzy stars after 3 heavy hits, sweat drops, floor cracks, camera zoom on heavy hits, slow-motion "FINISH!", combo counter.
- Better bodies: thick shaded limbs, broad-shouldered torso, fists, shoes, belt; outfits T-shirt, panjabi, vest, tracksuit, suit with tie.
- Taunts before each fight (Banglish), shown on the select screen too.
- Sound made in code (no files): hits, blocks, whooshes, jumps, super, K.O. bell, round jingle and a low beat while fighting; off by default, M or the speaker turns it on.
- Endless mode (select screen: Story / Endless): one round each, health carries over (+35), the boss every 6th fight, damage keeps rising; best streak kept per device. Champion screen with confetti.
- fight.js 87 KB (26 KB downloaded), still only when the Brawl tab opens.
- Checked: all 9 supers deal damage (scripted), level-5 computer beat a button-mashing script, endless streak and health carry-over, sound on/off without errors, captured frames.

## stick-1 — stick fight across the ERP pages (2026-10-04)
- A red ninja (headband, sword, shuriken) fights black stickmen all day on the outlines of the page, in the style of the Terkoiz "Shock" videos the owner showed. Own code (ideas from GitHub stickman projects: bone skeleton, verlet ragdolls, enemy waves), web/games/stickfight.js, 30 KB, loaded only when it is on.
- Floors = top lines of cards, buttons, the save bar, list views, chips, the game strip, the title-bar buttons; walls = sides of tall boxes (not the narrow gap between two boxes). They never fly: jumps are real arcs to ledges they can reach, wall cling + wall jump, drop off edges, ride along on scroll; floors re-read on scroll, resize and every 0.5 s.
- Moves: punch, kick, uppercut, roundhouse, sword slash (crescent), flying kick, shuriken, block, taunt; knockback off ledges, tumbles; knocked-out fighters become ragdolls that tumble down the boxes and fade; new enemies appear in smoke.
- Blood (cartoon): red drops that land on the ledges as splats and fade after ~9 s; switchable. Stickmen are faceless.
- Keeps clear of the mouse (a ~190 px circle: they flip or run to a ledge outside it) and of the field being typed in.
- Never on New invoice or Quotations (button hidden there too), never while a dialog/popup/print preview is open, when the tab is hidden, or below 900 px. Esc twice hides it at once; the ⚔ button (bottom right) brings it back and offers On / Calm / Off and Blood on/off, remembered per person. The owner's Maintenance switch (who sees the games) covers it too.
- Checked on a test page and in the ERP (Sales, Customers, Products): fights, deaths/ragdolls, blood decals, off on New invoice, cursor circle empty after 1 s, Esc-twice hide, button restore. Not checked: real mouse use and how distracting it is over a full day.

## stick-2 — one ninja against one at a time, throws, long leaps (2026-10-04)
- Owner's changes: no white outline; the hero is light yellow (darker yellow in the light theme) with a red headband, the enemies blue; no sword, no shuriken, no health bar.
- One against one: the yellow ninja can never be beaten (no damage; he blocks or slips away from ~90% of attacks and counters, escapes ~95% of grabs). Only one blue fighter at a time; when he is knocked out the next leaps in from the far side of the screen across the buttons.
- The blue ones find him anywhere: a route of long jumps between ledges (breadth-first over which ledge can reach which, up to 640 px across and 300 px up) is worked out on every look. They use the same moves: jab-cross-uppercut chains, kicks, roundhouse, sweep, flying kick, block, grab.
- Grabs and throws: the thrower lifts and hurls the other one; a flung body spins and bounces off the sides and undersides of buttons and boxes (with a dent burst and damage) and off the tops when falling fast, then lands and gets up. Knock-outs become ragdolls that bounce the same way.
- Long ninja leaps (flips and afterimages on long ones); the ninja sometimes hides crouched at the end of a ledge and ambushes with a flying kick, and after a good exchange often leaps far away so the fight moves across the whole page. Fixed: a fighter landing on the very tip of a button kept falling off and "landing" again.
- Checked on a test page: in 40 s both visited 12-13 areas of the screen, 2 knock-outs, all moves including throws and hides seen, the ninja never lost health.

## stick-3 — calmer, muted colours, no getting stuck (2026-10-04)
- 30% slower overall; muted colours: the ninja mustard yellow (#c9a43a, darker in the light theme) with a dark-red headband, the enemies deep navy.
- The next enemy comes from a random side (left / right / dropping in from the top), not always opposite the ninja.
- Table rows are floors too (lists are mostly rows), so they no longer keep falling off the narrow Paid/Due pills.
- A planned jump lands on the ledge it aimed for instead of the first one it passes (stacked rows used to stop every jump one row down).
- Anyone at the bottom of the screen leaps back up after 0.7 s; anyone who cannot get closer for 3.5 s vanishes in smoke and reappears near the other (ninja style).
- Blood cut to about a third, smaller splats that fade in 5 s; a little light-blue sweat flies off on some hits.
- Checked on a Sales-like test page (18 rows, pills, Pay buttons): together on the same ledge ~75% of the time, 19 areas visited in 40 s, enemies entered from the top and the right.

## stick-4 — a fight with a story: scenes, hidden health, chase, bow, parkour, searching (2026-10-04)
- A "director" picks the scene, never the same twice in a row: duel (guard stance, step in, an exchange, sometimes a step back), stand-off (circling at arm's length, taunts), ambush (the ninja hides at a ledge end; the enemy searches: slow steps, turns, hand over the eyes, a "?"), breather (both pant, wipe sweat), chase, retreat.
- Hidden health: the enemy, when beaten down (<24 of 70), runs away across the ledges once per life and the ninja chases; cornered he may turn and fight back. The ninja has hidden stamina (he can now be hit about 1 in 4 but never hurt for real); worn out he runs off, pants until recovered, the enemy hunts him, then he comes back.
- Bow: in 1 chase in 3, when the runner is 180-620 px away, the ninja draws a bow and shoots up to 3 arrows in real arcs (aimed with a little lead and spread); a hit knocks the enemy down, misses stick in ledges and box sides for 3 s.
- Parkour instead of constant jumping: walk off an edge to drop to a ledge below, a quick vault (no flip) to a ledge just above, flips only over long gaps, a roll after a hard landing; the ninja waits on guard for the enemy to come in duels; very few random flying kicks.
- Throws are slower and clear: lift over the head, a beat, then the hurl (grab reach 30, more grabs).
- Kept from the last round as the owner decided: less blood + sweat, the smoke vanish when stuck.
- Checked on a Sales-like test page: all scenes appear, a full sequence seen (enemy leaps in, grab and throw, breather, chase along the bottom, the enemy turns and fights back), forced bow shot and searching pose captured, no errors.

## stick-5 — the whole page, edge margins, looking before leaping, no vanish (2026-10-04)
- Floors everywhere: the side menu buttons, the top bar (search, business picker, buttons), tabs, segment buttons and fields join the boxes, rows and buttons.
- About an inch (96 px) kept clear at the left, right and bottom: floors are cut to it, fighters and ragdolls bounce off it, a last-resort floor sits an inch above the bottom and anyone landing there leaps back up within ~0.3 s towards the enemy. No limit at the top.
- Solid things are only buttons, chips, pills and fields (not the big boxes or rows they stand inside). Every jump checks its arc first; if a solid thing is in the way it tries a higher (capped) arc, a lower one, or another landing spot on the ledge; if none is clear it picks another ledge. Thrown bodies, ragdolls and arrows only hit solid things.
- Pursuit: the shortest chain of jumps first; if that is blocked, any reachable ledge that brings him closer with a clear arc (both fighters).
- Always towards the enemy: the ninja's retreat removed; hiding only at the end of his own ledge facing the enemy; shorter landing slides and rolls (and rolls face the enemy); the mouse-escape prefers ledges towards the enemy.
- The smoke vanish is off (owner's request); a stuck fighter takes another route or looks around.
- Light theme uses lively colours (amber-yellow ninja, bright blue enemy, red headband); the dark theme keeps the muted ones.
- Checked on a test page with side menu + top bar + rows (light theme): 0 margin violations in 40 s, a quarter of the time spent on the side menu/top bar, almost no passes through buttons.
