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

## stick-6 — more action and real body physics; dashboards understood (2026-10-04)
- More action: the ninja dodges/blocks ~45% (was 72%; still never hurt), the enemy blocks 7% (was 18%), shorter guard pauses, faster decisions, longer combos, harder kicks/roundhouse/uppercut, stand-off and ambush rarer than duels.
- Real physics: a heavy hit, a throw, an arrow or a knock-out turns the body into a ragdoll (11 points joined by sticks) that tumbles, bounces off ledges and solid things (buttons, chips, fields) with sparks, a dent burst, a little shake and damage on hard bumps; when it settles on a floor he gets up from where he lies. Knock-outs stay ragdolls and fade.
- Impact: a short hit-stop (0.03–0.12 s), a slight shake of the drawing on heavy hits, star + shock lines, white kick trails.
- Dashboards: KPI tiles, the banner, the quick-action row, notes, grid cells, section titles and charts are floors too; next-door tiles at the same height count as one fighting ground, and they hop the gap between tiles instead of walking into it (the old ping-pong to the bottom floor). Nobody walks off an edge by accident any more.
- The ninja goes after a far enemy (he waits on guard only when the enemy is within ~260 px).
- Checked on a dashboard-like test page: throws, held lifts, ragdoll tumbles and get-ups, fights on tiles; no errors.

## stick-7 — on every page; switches in Maintenance (2026-10-04)
- The stick fight now also runs on New invoice and Quotations (owner's choice; Esc twice still hides it at once, the ⚔ button stays).
- Maintenance → "Games and stick fight" now has per-device switches: Stick fight On / Calm / Off and Blood On / Off (same as the ⚔ menu), shown to everyone who may see the games; the owner's "Who sees it" stays above.

## game-6 — Brawl: fighting-game systems from the genre (2026-10-04)
- Studied open GitHub fighters (alfredang/street-fighter-game, StreetPhyter, shadow-fight) and fighting-game design notes (input buffering, hitstun/blockstun, cancels, juggles); took the ideas, wrote our own code (their code/sprites are licensed or copyrighted).
- Input buffer: a key pressed up to 0.15 s before a move ends is kept and used once.
- Cancels: a hit that lands can go straight into the special (D, "CANCEL!") or the super (F).
- Throw (W): grab, lift over the head, hurl; can't be blocked; hold ← or → to throw that way; W at the right moment breaks a throw ("BREAK!"); the computer breaks some (more at higher levels) and throws players who keep blocking.
- Parry: ↓ pressed just before a hit (0.16 s) = no damage, the attacker staggers, +15 power, "PARRY!" with a flash and a freeze; the computer parries sometimes at higher skill.
- The computer punishes missed moves (jab/uppercut into the gap).
- Camera: follows the middle of the two fighters and zooms in up to 14% when they are close (smoothed; clamped to the arena).
- Smear frames: two ghost copies of the body on the active frames of heavy moves.
- Knock-outs are real ragdolls (12 points + sticks, fixed 1/60 s steps so slow motion stays right), with the pixel head on the neck; they tumble across the floor.
- fight.js 97 KB (29 KB downloaded). Checked on a standalone page: throw (12 damage), parry, cancel jab→special, camera zoom, ragdoll K.O. arc and landing.

## game-7 — Brawl: pixel-art muscular fighters, stickman-style moves, more physics, throw/parry sounds (2026-10-04)
- Sounds: a grab-and-heave for throws (+ whoosh and a body slam on release), a bright metallic ping for parries, a heavy slam for elbow drops and wall splats.
- Pixel art: the fighters are drawn into a canvas 2–3× smaller and scaled up with hard pixels, so the bodies match the pixel faces. Muscular bodies: deltoids, biceps, forearms, thighs and calves, broader shoulders, chest and abs lines under T-shirt/vest/tracksuit.
- New moves: ←A spinning backfist, →S running dropkick (while walking/dashing), ↓A elbow drop on a downed fighter (hits on the ground), ←↑ backflip (short invulnerability), ↑ at the floor's edge in the air = wall jump, air punch (A) → air kick (S), ↓S dive kick from the air, ↑ after an uppercut = super-jump chase for an air combo. Flips turn the body around the hips.
- Physics: every knockdown (not only K.O.) is a ragdoll that tumbles and gets up when it comes to rest; flying ragdolls can be juggled (hits re-throw them, up to 4); ragdolls slamming into the edge of the floor = WALL SPLAT.
- The computer: long flipping leaps that end in a dive kick, dropkicks at mid range, backfists, backflip dodges against big attacks, wall jumps when cornered, super-jump air combos after its uppercut, elbow drops on a downed player.
- fight.js 109 KB (32 KB downloaded). Checked on a standalone page: backfist, dropkick, pixel look and muscles in captured frames, a 40 s fight with no errors where the computer used air punch, backfist, dropkick and the player became a ragdoll 8 times and got up.
- The neutral office-erp copy did not get this upload (the PC ran out of memory twice); erp.costareen.com has it.

## game-8 — Brawl: Mortal-Kombat-style finishers and look (our own "PRINT-ALITY") (2026-10-04)
- FINISH HIM!: when a knock-out decides the match (and half the time in Endless), the loser stands dazed, the screen darkens, "FINISH HIM!" in red metal letters with a 3-key combo shown as boxes (turn green as typed) and a 3.6 s timer bar. Typed in time → a finisher; missed → normal K.O. The computer, when it wins, finishes the player about 2 in 3 times.
- Six printing finishers, chosen by the winner's special, ending in "PRINT-ALITY!": Spool Storm (spools rain and pile up over him), Resin Tomb (frozen in a green resin block that cracks and shatters), Print Over (a giant print head prints layers over him into a block), Spaghetti Wrap (filament wraps him, he is dragged away), Laser Engrave ("LOSER" engraved into the floor with a glowing laser), Pillar Launch (a mega pillar fires him into the sky; he crashes down as a ragdoll). The boss uses Spaghetti Wrap. No gore on the real faces (owner agreed).
- CRUSHER (↓+F with a full power bar): slow motion, three blows with a bone-crack sound, white flash, freeze and close zoom, "CRACK!", then a launch; the computer uses it too.
- BRUTAL!: the next heavy hit after a 5-hit combo = slow motion, big launch, sound.
- Look: night arena (dark red sky, red moon, floor fog), red pulsing screen edges when the player is low, Impact-style metal lettering for FIGHT!, K.O., NAME WINS, FINISH HIM!, PRINT-ALITY!.
- Cartoon blood (small red squares on hits), B switches it, remembered.
- Sounds: bone crack, the deep finish drone, brutal hit.
- Never stuck in slow motion (a guard returns to normal speed). fight.js 125 KB (36 KB downloaded).
- Checked on a standalone page: FINISH HIM → typed combo → Spool Storm / Spaghetti Wrap / Laser Engrave → next level or champion; a 38 s fight with no errors; captured FINISH HIM and PRINT-ALITY frames. Both web copies (erp.costareen.com and office-erp) updated.

## game-9 — Brawl: 12 finishers, six more moves (2026-10-04)
- Six more PRINT-ALITY finishers: Bed Flip (a giant print bed slides under him and flips him into the sky), Filament Lasso (whirled round on a filament line, hurled away, a twinkle in the sky), Scale 10% (shrunk to a tenth and kicked away), Calibration Cube (printed into an XYZ cube, then kicked rolling off), Support Cage (support pillars grow round him, a roof prints, the cage is lifted away), Thermal Runaway (orange glow and flames, he comes out sooty-black and falls over). Each finish picks his own special's finisher about half the time, otherwise one of the six new ones.
- New moves: → A headbutt (up close; leaves him dizzy), A during a dash = shoulder charge, ↓ S while running at him = slide tackle (low), jump close + A = flying knee (anti-air launcher), ↑ S in the air = tornado kick (four spinning hits), ↓ W = knee bash grab (three knees, then a shove).
- The computer: flying knee against a jumping player, charge/slide/dropkick at mid range, headbutts and knee bashes up close, tornado kicks at the end of its flipping leaps.
- Fixed: a slide pressed right after ↓ turned into a block-then-sweep; running is remembered for 0.3 s.
- fight.js 136 KB (39 KB downloaded). Checked on a standalone page: all 12 finishers run through FINISH HIM with no errors (frames captured for 9 of them), headbutt→dizzy, slide, knee bash, charge and tornado trigger. Both web copies updated.

## Connection limit fix (2026-10-04)
Owner saw "(EMAXCONN) max client connections reached, limit: 200" - the Supabase pooler refuses
clients past 200 when many copies of the Edge Function run at once. Fix: each copy holds at most
2 + 1 connections (was 3 + 2) and drops idle ones after 5 s (was 20 s); the server retries a
call refused this way up to 3 times (400 ms / 1 s / 2 s + jitter; it is refused while connecting,
before any work, so a retry cannot do work twice) and then says "The database is busy for a
moment"; the page waits 2.5 s and tries once more before showing anything. Timers spread so no
two start in the same minute (alerts :x2, drive :x4, sheet :x6, websync :08/:23/:38/:53,
heartbeat :29). Checked live: 60 calls at once, all answered. Not done: a bigger pooler limit
needs a paid compute size - not needed unless it comes back.

## Toast back at the bottom; e-mail setup checks the login (2026-10-04)
Messages (toasts) moved back to the bottom centre (close button kept). set_smtp.py now logs in to the
mail server before saving: a wrong Gmail password (normal password instead of an app password) is
refused on the spot with how to make an app password; spaces in the app password are removed. Gmail
was refusing the saved password (recover -> 500 "Error sending recovery email").

## Stray label tabs fixed (2026-10-04)
Clicking any table cell in phone/card view opened a "Parcel labels" tab ("No booked parcel for this invoice..."): the card view puts data-label (column heading) on every cell, and the Print label button used the same attribute. The button now uses data-plabel.

## Every home owner is a platform admin (2026-10-04)
054_home_owners_platform.sql: trigger on memberships - an owner of the home business (one whose owners include a founding platform admin) is added to platform_admins (note "home owner (054)") and removed when no longer owner. Nazir added. Founding admin rows never touched.

## Stick fight v7: written fights, a third man, natural run (2026-10-04)
When the ninja and an enemy meet on one ledge a scripted fight plays (7 two-man and 3 three-man scripts): every move lands at its set moment and the answer (block, parry, duck, lean away, take it, gut, go down, slam over the head, fly) is timed to it; new moves hook, knee, elbow, headbutt, stomp, axe kick, spinning kick, backflip, slam. Slow motion on the last blow, hit-stop, shake, whoosh on a dodge, ground hits on a downed man. Only the last blow of a script can kill. A bigger purple third man drops in (6 rounds in 10, 4-10 s in) for two-on-one; he waits his turn while others fight; when the blue one dies the purple one takes his place. Run: leaning in, bent arms pumping, trailing knee folds, stride speed follows running speed. Checked: contact sheets of a two-man and a three-man fight, 80 s of play with no error and no stuck fight. app.html loads stickfight.js?v=7.

## Set-password links (2026-10-04)
Staff could not get in: their links were never opened (tokens unused) and a used/expired link landed on a silent sign-in screen. Now: an expired or used link says so and tells them to press "Forgot the password?" (page keeps the opening address in ERP_HASH0 before anything tidies it); the set-password box says "Welcome! Choose your password" (not "owner account"), Cancel explains what next; a wrong password tells a new person to use the e-mail link or Forgot the password. The Supabase recovery e-mail now reads "Choose your password for the ERP" with a button and the one-hour / newest-e-mail rule. Tested live end to end with a throwaway account (deleted).

## Stick fight v8 + Brawl hints (2026-10-04)
Stick fight: always two blue men (one team) against the ninja - the second arrives right after the first, a replacement 2-3.5 s after one dies; three-man scripted fights come first (the ninja waits ~1.5 s for the second man), 4 new three-man scripts where both sides read each other (parry-counter-parry, an elbow behind without looking, both blues attacking in unison, a split kick into both); a runner always faces where he runs; a hit flashes red on light pages (white made him vanish). Brawl: the key list along the floor is gone; a small key hint (e.g. "-> + S", "down", "W", "down + A") shows under the player bar for ~2 s only when that move fits (enemy down, dizzy, blocking, attacking, cornered, in the air, mid range, far, power full); the sound switch moved to the bottom-right corner. fight.js?v=13, stickfight.js?v=8.

## Game under New invoice for staff (2026-10-04)
The setting was already Everyone; staff on shorter laptop screens never saw it because the game hid itself when under 150px was free below the invoice. Now it always shows below the invoice (at least 190px; scroll a little on short screens). When hidden on a device, a small "Show the game" button sits under the invoice (Maintenance, the old way back, is not open to managers/sales). Still hidden on screens under 760px wide (phones) and on an open invoice.

## Online Brawl (multi-1 + multi-2, 2026-10-04)
People of one business challenge each other. "Online N" on the game bar lists who has the ERP open (Supabase Realtime presence in a private per-business room, erpArena makes it once and keeps it in business_config arena_room); Challenge -> an invitation card on any screen (Accept / Decline, 30 s); both pick a fighter and press Ready; the challenger's browser runs the fight (fight.js net mode: the guest sends keys, the host sends the state 15 times a second plus special/super/crusher events and round/end), best of 3, no finishers online; the host writes the result (erpArenaResult, 055_arena.sql arena_matches; only a player may write, once per match); leaderboard and last results in the panel. Heartbeat every 2 s, 9 s silence or a "bye" = no contest. Needed: Realtime presence switched on (was off) and wss://*.supabase.co added to the CSP connect-src. Checked: arena_test (8), a two-copy fight over a fake 70 ms network (keys, damage, rounds, 2-0 end identical on both), Realtime round trip ~150 ms, and the whole flow live with a scripted second player (stopped before the end so no test result is kept). Not done: the cross-company arena (stage 3), phones (keyboard only).

## Phones plain + Brawl arena with other companies (multi-3, 2026-10-04)
Phones and tablets (narrower than 760px, or no mouse: hover:none / coarse pointer) get the plain ERP: no game, no "Show the game", no stick fight or its button, no online room (window.erpDesk). Arena with other companies: an owner ticks "Owners of other companies can challenge our owners" in the Online panel (erpArenaWorldSet, business_config arena_world); owners of companies with it on meet in one world room (arena_settings world_room, server-only), listed as name - company under "Other companies"; invitations show the company; the match room sits under the world room; the result goes to arena_world (server-only, both companies kept) and a world top 5 shows in the panel; staff never get the world room. 056_arena_world.sql. Tests: arena_test 18. Checked live: phone view plain; laptop view with a scripted owner of "Bot Company" (challenge both ways, decline, match opened in the world room, left as no contest; nothing saved). The switch is OFF: there is no other company on this server yet (businesses: Costareen only; company copies: none). Not done: company copies on their own Supabase servers cannot reach this world room yet - they need a join through the provider server (CONTROL_API), to be built when the first copy exists.

## Sorting everywhere (2026-10-04)
The big lists (Products, Invoices, Customers) already sorted by clicking a heading, but nothing showed it. Now: a visible "Sort by" menu with an up/down button next to New/search (numbers start highest first, words A-Z), and a faint up-down mark on every sortable heading. Every other table on a screen (suppliers, web orders, expenses, dashboard tables, ...) sorts by clicking its heading (up/down mark; numbers, BDT amounts, (bracketed) minus amounts, percentages and dates read as such); the choice is kept per screen and table on that device and comes back after a refresh. Left out on purpose: tables with typing boxes (forms), tables with grouped/merged rows, and the Profit statements (their order is the statement). Checked live on Products (by stock, both ways), Suppliers (both ways), Web orders, Profit (not sortable).

## Connections: the Website tile opens the Website card (2026-10-04)
The tile jumped to the second card mentioning "website" (Any website - open door) instead of the Website card with Live sync. Now a tile opens the card whose title starts with its name, else the first that mentions it. Checked live: Website, Courier, WhatsApp, Google Drive, AI access each open their own card. E-mail has no card on that page (the e-mail card is still to be built).

## easy-1: connections made simple (2026-10-04)
WooCommerce in one click: type the shop address, press "Connect with one click"; the shop's own WooCommerce approve page opens (wc-auth/v1/authorize, read_write), and on Approve WooCommerce POSTs the keys to ?woo=keys (wooauth.js: one-time code per business, 20 min, ck_/cs_ checked, kept as WOO_KEY/WOO_SECRET; live sync stays off); back in Settings a message says whether it worked or Approve was not pressed. Pasting keys stays as a fallback ("Prefer to paste the keys by hand?"). Steadfast: a numbered guide with an "Open Steadfast" link; Save checks the keys with Steadfast by itself. Tiles say the next step in plain words (Live / Next: switch on live sync / Next: press Connect / Next: paste 2 keys / Optional / Set up by the provider). Tests: wooauth_test 12, c1 courier g2 i3 s1 w2 green. Checked live: www.costareen.com forwards the approve link to WooCommerce's sign-in/approve page; ?woo=keys answers and refuses bad data. The approve itself was not pressed (it needs the shop's WordPress login and would make a second key). Not done: WhatsApp QR (needs a shared server - owner to choose), Google consent screen name/publish (owner, in Google).

## Go-live move from the sheet ERP (2026-10-05)
The sheet stopped (owner turned its website sync OFF). deploy/sheet_to_web.py (one-time): fresh export, the importer into a throwaway local database, merged with the live business (sheet books replace the trial copy; products by SKU and customers by key keep the web ERP ids/photos/families/serial settings; web ERP settings, connections, money accounts, website catalogue kept), checked, written as a backup file; uploaded to the business backups and brought in with the web ERP's own Restore (before-restore copy: "Costareen - backup 2026-10-04 214909.json"). Result: 1064 invoices, 1640 lines, 495 payments, 2104 stock moves, 140 products, 301 customers; stock per SKU equals the sheet for all 140 (2700 units); next invoice 1903. The sheet's COURIER_LOG (3 parcels, not read by the importer) added to courier_log. Website: preview listed the 11 changes (preview now lists them), pushed, live sync ON, order pull OK. Courier: Steadfast connected; delivery check OK. Found: website orders' parcel numbers come from the WordPress sync plugin (/cod) - the plugin key lives only in the sheet's script properties (its SETTINGS value is a placeholder), so a "Website orders' parcel numbers" key field was added next to WooCommerce (erpWebsiteSet pluginKey); owner pastes it from WordPress.

Website orders' parcel numbers: the sync plugin key is the wp_option cz_sync_shared_secret (mu-plugin cz-sheet-sync.php, no admin page) - read with wp-cli over the office-VPS hop and saved as CZ_SYNC_KEY through erpWebsiteSet pluginKey (never printed). Delivery check now runs with no errors; WooCommerce stays the main connection.

## WordPress key page + any other website (2026-10-05)
New mu-plugin wp-content/mu-plugins/cz-erp-key.php on costareen.com (separate file, nothing else changed): WordPress admin > Settings > Costareen ERP shows the cz_sync_shared_secret key (Show / Copy) and "Make a new key" (nonce, confirm). The ERP's parcel-key field now says exactly that. Website card: a 4th button "Any other website" opens the open-door card, renamed "Any other website (PHP, Laravel, Wix ...)". Source of the mu-plugin kept in the scratchpad copy only (website files are not in this repo).

## Any other website: inside the Website box + a ready PHP file (2026-10-05)
The open-door card no longer sits at the bottom of Connections: it opens inside the Website box only when "Any other website" is pressed (pressed again: closed; the button shows it is open). New "Download the PHP file": costareen-erp.php with the door address and - right after "Make a new key" - the key inside; functions erp_ping, erp_send_order, erp_stock, erp_send_products (curl, PHP 7.4+). Checked: php -l clean on the website host, erp_ping reaches the door (refuses the placeholder key as it should); live: hidden by default, opens inside the Website box, closes again.

## Audit against the sheet (2026-10-05)
Web orders showed "not entered": the importer marked the 14 orders entered but not their 32 lines (the screen reads lines). Fixed live (32 lines) and in import_sheet.py (each line keeps its own entered_in_sheet). deploy/audit_vs_sheet.py compares the live ERP with the sheet export field by field: invoices 1064 (totals, discount, delivery, advance, due, payment/delivery status, method, customer, phone, lines, units), invoice lines (sku, qty, unit price), payments 495 (sum 3,919,812), customers 301 (orders, spent, type, source, status), products 140 (cost, price, reorder, name, category, brand, colour, status), courier payout lines 574 and payouts (1,126,854 to bank), stock types, expense items, settings. Result: all equal after two fixes - INV-20260514-1080 due 16500 -> 3820 (the sheet's own rows disagree: the first line says 3820 = 16500 - 2 x 6340 bKash, the other lines 16500) and the stale business_config next_invoice_num 1884 -> 1903 (Settings reads the real counter anyway). Left as in the sheet: one stock move for spmcw031, a SKU not in the product list.

## Exports and the backup sheet show what the ERP uses (2026-10-05)
Products export: Cost is the cost the ERP uses (own cost, else the price book landed cost) + a "Cost from" column; 138 of 140 products now show their landed cost (2 have no buy price in the price book: bma1cn, bpa6gf102). Customers export: notes and added date came from columns that do not exist (notes/date_added) - now note/created_at. Price book export: landed cost, products, typical sell, margin % (as on the screen). Stock export: "Unit cost" renamed "Unit price" (sales carry the selling price). Import: a Cost equal to the price-book landed cost (as exported) is not taken as a product cost. Backup sheet: products tab gets cost_used and stock, rewritten when the price book or stock changes. Tests: excel_cost_test 5, d6 26, g3 16.

## One phone = one customer; invoice number opens the PDF (2026-10-05)
Root cause of the duplicates: an invoice with a known phone renamed the saved customer to whatever was typed. Now: createInvoice uses the saved customer's name for a known phone; upsertCustomer never renames; erpSaveCustomer (customer page) refuses a phone that is another customer's and carries a new name onto all their invoices and payments; erpFixInvoice refuses a name change for a saved customer's phone (changing the phone brings that customer's name). Data: saved names tidied (trailing , ; : and double spaces), every invoice of a saved phone carries the saved name - the typed name kept in the invoice note "[name typed: ...]" (193 invoices); payments follow; no phone has two names now (backup made first, 11:13 PM). Screen: New invoice locks the name box for a saved phone (unlocks for another phone) and says to change it on the Customers page; Sales list: the invoice number opens the PDF, the PDF button is gone; Due box invoice numbers open the PDF too. Tests: custname_test 8; customers 60, sales 109, pages 36.

## New product from Stock entry > Receive is created at once (2026-10-05)
A product added with the "new product" button inside Receive was only a draft line of the shipment, created when Receive was pressed; leaving or reloading the page without receiving lost it silently ("we entered empty spools but cannot find it" - no erpSaveProduct ever reached the server, not in the sheet either). Now it is created at once with no stock (on the product list straight away), the quantity typed in the form goes onto the shipment line, and Receive adds exactly that quantity. Checked locally: created (stock 0), found after leaving without receiving, shipment line qty 25, Receive -> stock 25.

## Full audit for silent failures (2026-10-05)
Two code reviews (page and server) plus a click-through on a local copy. Fixed:
- A save sent twice is saved once: every write from the page carries a one-time key (opKey); after a timeout the same press sends the same key and the server returns the first result (057_op_keys.sql, claimed in the same transaction in core.js; kept 3 days). Covers invoices, receiving, box arrivals, adjustments, payments and every other write. Live-checked: second call answered "replayed".
- Repair job: removing a part saved the wrong part's quantity/price (read the boxes first now); a payment first saves typed diagnosis/labour/parts.
- Money, supplier and job forms keep what was typed while saving and get it back if the save fails (formSnap/formPut); a busy click says "wait" instead of nothing.
- Supplier order / box "+ New product" is created at once (like Receive); "Will not come" clears only that product's number, not the whole box.
- Stock count typed so far is kept on the device and comes back after a reload; leaving with an unsaved invoice, shipment, order, product or repair job asks first; Clear on the invoice and on Receive asks first.
- Quotation PDF copy and due-reminder marks that failed now say so; a note typed during an upload is not erased; the quotation's own retry knows the page's words for a lost connection; the page's list of reads = the server's.
- Server: a no-phone sale no longer wipes the customer's phone; void refused when payments, a return, numbered units or a parcel hang on the invoice (cancel instead) and otherwise takes it off the customer's totals; a customer's name/phone change moves their invoices, payments and advance ([acct:key]) with them; timer jobs run as one ACTIVE owner per business (no empty backup from a switched-off owner, no double runs); entering a web order takes the sale lock first (no double invoice); Record payment and COD collected use the Dues screen's "owed" (no overpayment); product page and opening stock from a count use the price-book cost; editing an invoice's phone moves it (and its payments) to that customer.
Not changed (low): webAlignTotal does not reset a Paid status; quiet syncInvoiceStatus calls. Tests: opkey 6, audit2 7, customers 60 (legacy ledger-only payment rule replaced by the Dues rule), all 57 suites green.

## Receive without a shipment, work kept across refresh, dark mode remembered (2026-10-05)
- Receive: "Where from" (shipment / bought locally / campaign exchange / other); reference is optional and filled automatically (e.g. "Bought locally 2026-10-05 14:20"). New "New stock" column after "In stock now" and "Receiving", live while typing.
- Unsaved work (invoice cart + customer, receive, new purchase order, new job, product and customer forms) is kept per tab and brought back after a refresh / hard refresh with a toast; a second tab starts clean. Products/stock changed in one tab refresh the other open tabs within seconds without losing their cart.
- Dark mode: the device choice wins; the first-visit "look 2" code no longer forces light (it had reset the owner's saved theme whenever a fresh browser opened the ERP). Owner's saved theme set back to dark.
Not done: drafts live in this browser only (not across devices). Tests: stock 119.

## Manager: no discount limit (2026-10-05)
Manager discount cap raised from 10% to 100% (same as owner). Sales stays at 5%. Not done: per-person / per-role limits set by the owner in Settings.

## Discount limits and manager access (2026-10-05)
- Discount: sales up to 20%; manager, shareholder, owner no limit.
- Manager: Settings opens with the Lists tab only (no Business, Users, Alerts, Connections, Security; business values not sent); Product cost page opens to them (cost book, rates, handling/margin). Dashboard stays hidden.
- Fixed: erpBundle settings/costs parts are now held to their own call's role (sales could read them through the bundle before).
Not done: per-person ability switches in Settings > Users. Tests: mgr_access 11; settings, dashboard, a5, erp_server updated; all suites green.

## Abilities per person (2026-10-05)
- Settings > Users > "Abilities" (next to each non-owner's role): 12 switches on top of the role - Dashboard, Product cost, Settings lists, Profitability, Expenses, Stock and receiving, Suppliers and purchase orders, Web orders and parcels, Campaigns, Add and edit products, Returns and invoice fixes, Dues and payments - plus an own discount limit. Ticks marked "role" come from the role; "set by you" are the owner's. "Back to the role's abilities" clears them. Owners always have all.
- Server: memberships.powers (058); allow.js ERP_POWERS groups calls by ability; core gate, bundle parts, scrub, dashboard tier and the handlers' own checks follow the abilities. erpUserPowers (owner). Page: menu, Settings tabs and buttons follow ME.powers.
- Change of default: a manager now sees buying prices everywhere (product page, Excel, catalog), because "Product cost" is a manager ability. Switch it off per person if not wanted.
- Not switchable (stay with shareholder/owner): money accounts, capital, users, connections, security. Dropped a "void invoices" switch: there is no Void button on the page.
Tests: powers 33; d6/erp_server/goods/stock switch the manager's Product cost off where they test the hidden-cost view; all suites green.

## Hover on everything you can press (2026-10-05)
One CSS layer (mouse only): buttons lift with a shadow and sink when pressed; tabs, chips, phone tab bar, drop-downs, side-menu group headers, dashboard alert cards, list pager, home tiles and links light up. Keyboard focus gets a blue ring. Audit over every screen: no clickable element left without a hover (except the tab already open). Respects reduced motion.

## Stick fight v9: parkour (2026-10-05)
No more giant leaps. Moves a person can do: running hop (max 150 across, 50 up), jump to a higher edge then hang and pull up (105 up), run up a box side then hang and pull up (170 up), climb over a box edge from inside (table rows, cards), step off or lower-hang-drop (380 down). Roll after a hard landing, slide after a fast one. Route finder (quickest chain of moves) for chases; new "pursuit" scene (one runs, the other follows). New fighters drop in from the top. Nobody stays on the bottom line: they climb back up; written fights never start there. Checked by simulation on 15 screens: highest hop 52px, longest 122px, no stuck spells, no errors, about 0.3 ms a frame. Not watched live in a real browser window (the preview pane was hidden).

## Stick fight v10: grappling hook (2026-10-05)
When the ninja has no climbing route to the enemy (or only a very long one) he looks up ("!"), fires a rope with a 3-claw hook to the edge of that floor (spark on catch), climbs hand over hand (pulled fast when high), hangs, pulls over and goes straight into a flying kick. Range up to 460px / 60% of the screen height, rope must be clear of buttons, 8 s cool-down. Blue men have no hook: when they cannot reach him they wait as close as possible and point at him (at most every 4.5 s), otherwise look about or taunt. Two blue men on one ledge step apart. Checked by simulation on a bare test page (no route: hook, climb, thrown down, hook again, flying kick, fight) and on 6 real screens (hook used once, no stacking, no errors).

## Stick fight v11: the ninja senses them (2026-10-05)
Rope now reaches almost the whole screen height; with no climbing route the ninja fires it at once to their floor, or within ~1.5 s to the object that leads on to it, then free-runs. Rope down too: when they are far below with no way down he hooks the edge and slides down (he no longer waits up top for men who cannot climb back). Blue men sense him only within ~380px or after he hits them; otherwise they patrol and look around. Simulated: 680px gap, hook after 0.1 s; rope down after 0.5 s; 4 real screens no errors, ninja never still more than ~3 s.

## Installer: "could not be reached" fixed, step-by-step Supabase guide (2026-10-05)
Cause: install links open on the public copy (office-erp.pages.dev) but the server only allowed erp.costareen.com, so the browser blocked every installer call and the page blamed the internet. Now the public installer routes (?install=, ?control=) answer any address; normal calls also allow office-erp.pages.dev and a copy's own ERP_APP_URL / ERP_PUBLIC_URL. The Connect Supabase screen now walks through every step (account, e-mail confirm, organisation, no own project, Access Tokens, Generate, Never expiry, copy once, paste) with a live check of the pasted token (sbp_ vs a project key) and a "Something not working?" list (free 2-project limit). Errors now say offline / server error / no answer instead of always "check the internet". The unused install link still works. Not tested: a full install end to end (needs a real Supabase account token).

## Stick fight v11.1: the ninja senses them anywhere (2026-10-05)
Far from every enemy (over 300px) he looks about for 2-5 game seconds (about 3-7 real), shows "!" and goes: free-running, rope up or rope down. He no longer waits up high for an enemy who has not noticed him, and the duel "let him come" pause only applies to an enemy who is aware and coming. Simulated: ninja on a high ledge, unaware enemies far below: lock-on, rope down, contact; 6 real screens: never far from an enemy more than ~9 s, no errors.

## Stick fight v12: the story, the bow rope, earned moves (2026-10-05)
Opening: the ninja leans on a button smoking (ember, smoke puffs) while two blue men drop in and smash the page; after 4-5 s he flicks the cigarette away and goes. Smashing = kicks and punches on the element they stand on, leaving cracks, flying bits and a small shake - drawn on the stick layer only, the page is never touched; when that man dies his cracks mend with a sparkle. Busy smashing they notice the ninja only within ~170px; a man who is hit shouts ("!") and his mate joins. New men drop in somewhere else and smash; the ninja senses and comes (rope if needed). The rope is now shot with the bow (drawn bow, arrow with the rope trailing). Earned moves (kills counted per computer, no banner; count shown in the stick-fight menu "Moves learned x / 16"): basics from the start; round kick 3, backflip 5, slide tackle 7, flying kick 9, counter-throw 12, spin 14, slam 17, axe kick 20, rope pull 24 (bow rope into him, pulls him in, uppercut), split kick 28; written fights only use moves he has learnt. Between waves he sometimes lights up again. Simulated on 5 screens with 0 and with all moves: no errors; every new move seen.

## Sign-in e-mail first; copies reachable; builder name out of sight (2026-10-05)
- Sign-in: step 1 e-mail + Next. Never signed in: the choose-a-password e-mail goes out and the screen says "Check your e-mail" with "I have set my password - sign in", "Send the e-mail again", "Use another e-mail". Has a password: step 2 password (e-mail shown, Change). No account: says so. The e-mail is remembered: next visit opens on the password. Forgot goes through the server. Public route ?signin=check|forgot (handlers/signin.js, tests signin 7). Note: step 1 reveals whether an e-mail has an account here (accepted for clarity).
- Company copies: their server answers any page address (calls carry their own sign-in, never cookies) - the copy at erp.rmabidur.com could not sign in because its server only allowed erp.costareen.com. E-mailed links (set / reset password) now come back to the copy's own address instead of erp.costareen.com. A copy has no default website (was costareen.com).
- Builder name: removed from visible text (WooCommerce approve screen shows the business name, plugin texts say "ERP", PHP kit erp-connect.php, Brawl title, placeholders, comments in page/service worker); home-screen icons now a neutral box instead of "C". Still in the page code: our domains inside two technical address checks (only visible to someone reading the source).

## Stick fight: fewer, fainter cracks (2026-10-05)
Half the smash blows leave no mark; a mark has 2-3 short lines (was 3-5 long), fainter, at most two per element and 12 on the page; each fades by itself after ~3.5 s (still mends at once when its maker dies). Fewer flying bits.

## Stick fight v13: weapons and the sniper (2026-10-05)
Rage (hidden) rises with smashing near him (+3), hits he takes (+10), close fighting (+3/s); falls when nobody is near, by 15 per kill, and an angry spell ends after ~15 s. Angry + learnt: katana combo (down, up, lunge; blade arc). Medium range with a clear line: bow, or two pistols (alternating hands, tracers, 70% hits). Long range same level when angry: rifle burst (80%). Far or high above: sniper - walks to a spot with a clear line if needed, kneels, red line settles on the head, one sure shot; Blood on: head flies off and bounces, short neck fountain; Blood off: hat flies, he drops. Sniper at most one kill in five. Earned: katana 4, pistols 10, rifle 18, sniper 22 (menu total now 20). Calm mode: no guns. Simulated on 4 screens with all weapons learnt: every weapon used, headshot works, no guns in Calm, no errors.

## Stick fight v14: the drama (2026-10-05)
Waves of 3-5 men, then a 9-12 s break: he walks to a smashed spot and mends it (crouch, sparkle), then lights up - the lighter needs 2-3 tries; a smoke never passes 10 s and the next wave cuts it short; a man near him gets the cigarette flicked in his face; a man who reaches him can kick it out of his mouth (straight to the katana). Every 10th man is a purple boss (bigger, 160 hp) with a shield that stops fists, arrows and bullets from the front; three katana hits or a throw break it; against it the ninja picks the katana or a throw. A hit can knock the katana away: it spins and lands; he rolls to grab it back (or draws a spare after 6 s). The last man of a wave goes down in slow motion with the screen dimmed round him. Thrown, the ninja may catch an edge with one hand and pull up. Simulated on 6 screens: all events seen, no errors.

## Stage 1a: the bridge - every company runs on the provider's server (2026-10-05)
Plan: docs/PLATFORM-BLUEPRINT.md. A company's Supabase now holds only tables, storage and sign-in; the provider's Edge Function runs its ERP over a database connection whose URL and service key are sealed (AES-GCM, ERP_BRIDGE_KEY in the function secrets and deploy/secrets.env) in erp_tenants (059, control-only: never copied to companies). index.ts: projectParts() builds sign-in/files/e-mail/login parts for any project; a request with x-erp-tenant (page) or ?t= (callbacks) runs the same ERP code with that company's parts (tenantSource caches them 5 min); locked/disconnected companies get a plain message. Timers run the provider's business then every active company; the nightly run also checks every connection (disconnected = locked). Installer: steps project, wait, keys, db (control-only files skipped), storage, bridge (fresh database password via the Management API, sealed), finish (business + owner made over the bridge); no server code, secrets or timers go into the company's project any more. erpInstallBridge moved the existing test copy "example": answered over the bridge, then its timers and server code were removed (its old server now 404). Page: sends x-erp-tenant; picks up a moved company's new address by itself. Checked live: own ERP unchanged (141 products); example: sign-in check and a signed-in owner session (business, lists, theme) through the bridge (temporary test key deleted). Not yet: lock screen design, health check in Platform (1c), compliance view (1d), database functions still in company databases (1e). Tests: bridge 11, i1 rewritten for the bridge (28), all 61 suites green.

## Stage 1b: the permanent install link, terms, brand, automatic company addresses (2026-10-06)
https://erp.3dowala.com/start (3dowala.com moved to the provider's Cloudflare; erp CNAME -> office-erp.pages.dev; Pages custom domain active). /start and the bare erp.3dowala.com open the install wizard with code "open": no invite needed (personal invite links still work). Every new owner must tick the terms (version 2026-10, 8 plain clauses incl. the provider connection, the logged compliance view, no copying); version, time and sign-up address kept on erp_installs (060, control-only). Limits on the open link: 3 sign-ups an hour per address, 30 a day in all. No e-mail confirmation and no bot check: an install needs the company's own Supabase token, and the owner proves the e-mail by setting a password from their own project's e-mail (the provider's auth e-mails say "Costareen ERP" and its sign-up is off). Brand (erp_brand: name "3D Owala ERP", sponsor line, colour, logo) shown on install pages and under every company's sign-in; edited in Platform. Platform: Install link card with the link, a QR code (PNG/SVG download, qrcode-generator from jsdelivr), and a copy-paste website button. Free address: the installer makes <company>.3dowala.com by itself (DNS record + Pages domain, -2 for a taken name, reserved names) and waits for the certificate. Function secrets: ERP_PUBLIC_URL=https://erp.3dowala.com/, ERP_CF_TOKEN, ERP_FREE_ZONE(_ID). Checked live: /start -> wizard with brand and terms; brand and caps routes; own ERP unchanged. Not done: a real end-to-end install from /start (needs a fresh Supabase token); the terms need a lawyer's review before wide sharing; Turnstile bot check (add if spam appears). Tests: signup 15, i1/i3 updated; all 62 suites green.

## Stage 1c: Platform health, announcements, lock screen (2026-10-06)
Company list: for companies on the provider's server the State column shows the connection (connected / connection lost with why), when it was checked, and a Check now button (erpInstallHealth); the check also reads the usage figures over the bridge (copyStats: businesses, users, invoices 30d, errors 7d, last activity) into erp_installs.stats, so the list is filled without the old hourly check-in. The health check runs every hour (with the deliveries timer) and nightly. Announcements (061 erp_news, control-only): Platform card to post (news / important, 3/7/30 days or until ended) and end; every company's ERP shows live ones in a bar at the top (closable per device), read from the public ?install=news. Lock screen: any call answered "locked" (switched off, or connection lost) covers the company's ERP with a lock card: the reason, "your data is safe, nothing deleted", Try again. Update all already existed. Checked live on the test company: switched off -> locked with the reason, on again -> opens; Check now -> connected with figures. Tests: news 11; all 63 suites green.

## Stage 1d: compliance view and the verified provider key (2026-10-06)
Platform > Compliance check (handlers/compliance.js): pick a company on the provider's server, what (stock / invoices / payments / money movements = payments in + expenses out + transfers/corrections) and a period, and a reason (10+ characters, the company sees it); a read-only table (up to 1,000 rows). Each view is written into every business of that company as an activity-log entry "Provider (compliance check) - <what> - reason: <reason>" and into the provider's own erp_compliance_log (062, control-only), listed under "Your recent checks". A switched-off company can be checked; its ERP stays locked (tenantSource get(id, {any:true}); locked parts are not cached). Company side, Settings > Security (owner, bridged companies only): "Provider key - verified" with a fingerprint derived from the secrets the provider holds for it (SHA-256 of service key + database URL), what the connection is for, the database logins with any unknown one flagged in red, and every provider check with its reason. Activity words: "Provider compliance check (read only)". Checked live: a stock check on the test company appeared in its own activity log with the reason. Tests: compliance 19; all 64 suites green.

## Stage 1e: dead database logic out, page minified, address lock (2026-10-05)
063_drop_legacy.sql drops the 11 database functions nothing calls any more (create_invoice, next_invoice_no, void_invoice, receive_stock, pool_receive_stock, adjust_stock, sheet_products/stock/sales/movements/customers) by name, without cascade; applied to the provider's database and, through Update, to the test company. 45 functions remain in public: row-security helpers, triggers, dhaka_date, mark_dirty, are_partners and the pool/partner functions the server still calls - moving those out is a bigger separate refactor (NOT done). Legacy supabase/tests/test_partnership.py moved to tests/legacy (not run). deploy/minify.mjs (esbuild in deploy/.tools, gitignored): deploy.py web minifies only the published copy (index.html script/style blocks, HTML comments outside them, games/*.js); source stays readable. Page 1.43 MB -> 1.18 MB. Address lock: a company's calls (x-erp-tenant) are answered only from https pages on the provider's addresses, *.3dowala.com, the *.pages.dev projects, or the company's own domain; any other page (including localhost) gets 403 "not licensed at this address" and the page shows a lock card. Calls with no Origin (servers, timers) still pass but need a valid sign-in. Honest limit: Origin stops copies of the page in a browser, not a determined person with their own script and a valid sign-in. Tests: all 64 suites green. Checked live: evil origin 403, erp.3dowala.com 200, own ERP unchanged, page minified on both Pages projects.

## Stage 2: open market (2026-10-05)
New Market screen (Goods > Market, every role). "Find stock": search + category over the central list; each row shows product, brand/colour/unit, "In stock" or "Low" (never the number), price or "Ask", "Supplier · <city>" (never a name) and how long ago it was updated. Visibility: every business sees the provider's own listings (source 'self', unlabelled); a business that shares its own stock also sees every other sharing business; nobody sees their own; a switched-off company's listings and sellers not refreshed for 3 days are hidden. "What I share" (owner): switch "Share my stock on the market", city (required), per-product tick with "My price" / "Ask", "Tick all in stock" / "Untick all", Save (lists at once). Company database: 064_market_shares.sql (market_shares; switch and city in business_config). Provider database: 065_market_listings.sql (control-only erp_market_listings: name, category, brand, colour, unit, band, price, city - never cost, SKU, stock number, customers or sales). The websync timer (every 15 min) re-lists every sharing business, for the provider and every company on the bridge; sold-out products drop off, stock ≤ reorder level (min 2) shows "Low". deps.control = the provider's pool in both. Old stand-alone copies (own server) are refused politely. Terms 2026-10.2: new section 9 "The market" incl. "the platform operator may also list stock there". NOT done: ordering / contacting a seller (Stage 3), photos in listings, Bangla words for the new screen. Tests: market 23.

## Stage 3: deals between ERPs on the market (2026-10-05)
Market gets a third button, Requests (red count on it and on the Market menu item = things waiting for this business; refreshed on opening and every 10 min). Flow: Find stock > Request (qty, phone, note) -> the seller sees the buyer's business name, city and phone under "Asked of me" -> Give price (price each, delivery, valid days, phone, note; also creates/updates a Draft quotation in the seller's own Quotations, id = request id) -> the buyer now sees the seller's name and phone, Accept price (refused once expired) -> seller Make invoice (a normal unpaid sale at the agreed price via createInvoice partnerDeal, customer = buyer business, source "Market"; stock goes down) -> buyer Receive into stock (choose own product or "New product"; booked as a local purchase at price + delivery share, owed to the seller under Suppliers) -> Rate supplier (1-5 stars; average shows on that seller's listings). Seller can Decline / buyer Cancel with a reason before the invoice. Pricing, accepting, invoicing, receiving, rating: manager+; asking and cancelling: any staff. Limits: 50 requests a day per business, one open request per product. 066_market_requests.sql (control-only). Found while checking: the provider's DB pool has only 2 connections, so market calls holding a transaction could lock up under parallel use - the market now has its own small pool (deps.control = ctlSql); test fires 8 calls at once. NOT done: messages/chat between the two sides, payment through the market (paid as with any supplier), seller rating the buyer, photos. Tests: market3 32.

## Stage 4: wanted board, low-stock hints, price guide, shared names (2026-10-05)
Market gets "Wanted board" (between Find stock and Requests): a manager/owner posts what they need (item, qty, open for N days, phone, note); others see it as "Buyer · city" and press "I have it" (choose own in-stock product, price, delivery, valid days, phone, note) - that creates a market request already priced (+ a quotation in the supplier's Quotations), which the poster finds under Requests and continues as a normal deal; the post counts its offers; Close; expired/closed posts leave the board; one open offer per supplier per post; 30 open posts per business. Find stock shows "Running low on your shelf - on the market now" (own products at or below reorder level, min 2, that match a visible listing; with seller count and lowest price; click = search). What I share has a "Market price" column (range and number of sellers for the same product, only from listings this business may see). Product names: the New/Edit product name field suggests names already on the market and fills brand/category when still empty and the business has that choice. Matching = same words in any order, sizes (1kg, 175mm) ignored, "+" kept (PLA ≠ PLA+, Black ≠ Twinkling Black). 067_market_wanted.sql (control-only; requests.wanted_id). NOT done: a central curated catalogue (names come from what sellers list), wanted posts with photos, notifications by SMS/e-mail. Tests: market4 22.

## Invoice designs (2026-10-06)
Settings > Invoice design (manager+): 6 designs - Wave (original), Modern, Minimal, Classic, Bold, Receipt 80 mm; main and dark colour, letters (sans/serif/rounded/mono), title (INVOICE / CASH MEMO ...), show/hide bank accounts, payment QR, signature, phone, delivery; thank-you line, terms, a payment QR just for invoices (or the quotation one), company details and logo (shared with quotations); live preview of the latest real invoice, "Sample PDF", Reset. handlers/invoicedesign.js (erpInvoiceDesign, erpInvoiceDesignSave, erpInvoicePreview, erpInvoiceSamplePdf, erpInvoiceQrUpload), tests invoicedesign 23. Fixed: invoice/quotation images were read from the wrong folder, so the logo and QR never appeared on invoices - they do now (checked on a live sample PDF). Live design left on Wave (unchanged look) until the owner picks one. Started in the second account session, finished here. Also: market3/market4 tests made independent of the time of day (Dhaka vs test-server date).

## Invoice: type the selling price, the discount fills in (2026-10-06)
The Price on each invoice line is now a box: type the price you are selling at (e.g. 1,600 for a 1,700 item); on leaving the box Disc. per pc becomes 100 and the price goes back to 1,700. Page only - the invoice is saved and printed as before (price 1,700, discount 100). Above the normal price is refused with a message. Discount limits per person still apply on saving.

## Quotations: type the price, the discount per piece fills in (2026-10-06)
Quotation lines now have a discount per piece (item.off; amount = qty x (rate - off); totals on server and page count it; a whole-quotation discount comes after). In the Rate box type the price you are giving: on leaving the box a lower price becomes "-100 each" under the box and the rate goes back; a higher price simply changes the rate (quotes have free prices). The x removes the discount. The customer's quotation shows the rate, "- 100 each" and the amount. Quotation -> invoice uses the price after the discount. Tests: quoteoff 3, quotes 79.

## Invoice layout: full A4, 5 rows, PAID/DUE stamp, big amount at the bottom; design moved to Invoices (2026-10-06)
Every A4 design (Wave, Modern, Minimal, Classic, Bold) now fills the A4 page with the money part at its foot, shows at least 5 item rows (empty ones under the sold ones; 6 items = 6 rows ...), a rubber-stamp PAID (green) / PARTLY PAID (amber) / DUE (red) in the top corner, and the big amount as a bar near the bottom ("Total" in the main colour, or a red "Amount due"). Option "The big amount: at the top" brings back the old corner amount (no stamp, no bar). Logo size small/medium/large and logo side left/right (Classic stays centred). The 80 mm receipt is unchanged. The design screen moved from Settings to Invoices > "Invoice design" tab (managers and up). Live design is still Wave, so current invoices now get the new layout. Checked as real A4 PDFs with 1, 2, 3, 4, 7 and 14 items in every design (1 page up to 4 items with a large logo; 14 items flow to page 2) and a live sample PDF. Tests: ivdlayout 28, invoicedesign 23.

## Quotation looks (2026-10-06)
Quotations had three look names but only Signature had its own styling. Now five real looks, the same family as the invoice designs: Signature (original), Modern band (stored as Executive), Minimal, Classic (centred serif letterhead, boxed table), Bold (dark header, reference in a colour box). Chosen per quotation with picture cards under "Signatory & look" (live preview), default for new quotations in Quotations > Settings > "Look for new quotations". Colours, letters and size as before; text on the main colour turns dark on light colours. The saved PDF uses the same look (all page styles go into it). Server accepts Classic and Bold. Not done: the invoice-only extras (5 rows, stamp, logo size/side) on quotations.

## Round seals on invoices; customer statement on the invoice design (2026-10-06)
Invoices: the top corner is clean again (no stamp, no amount); a round rubber-stamp seal drawn in SVG - green PAID with THANK YOU around it, red PAYMENT DUE with stars (also for part paid) - sits tilted, a little see-through (multiply) half over the big amount bar near the bottom, which is now paper-coloured with a coloured edge so the seal shows; every figure stays readable. With "big amount at the top" the seal sits on the totals. Customer statement PDF (Customers > statement) now uses the business's invoice design: same header, colours, footer and seal (PAID when the balance is nil, PAYMENT DUE otherwise); lines Date / Details / Charged / Paid / Balance (at least 5 rows), totals Brought forward / Charged / Total / Paid in this period / Balance, a "Balance due" (or "Balance: Nothing due") bar, advance and unpaid invoices noted. Receipt design falls back to Modern for statements. Tests: ivdlayout 34, customers 60, sales 109 (old top-band checks moved to the bottom bar); goods_test made independent of the time of day.

## Brand logo up to 250 KB (2026-10-06)
Platform > Brand logo limit raised from 150 KB to 250 KB (page check and server check).

## Seal over the amount; QR says Bangla QR (2026-10-06)
The PAID / PAYMENT DUE seal now sits over the big amount itself (right side of the bar), see-through (opacity .62, multiply) so the figure reads under it. The words under the payment QR default to "Bangla QR" with "Scan with any bank app, bKash, Nagad or Rocket" (an old saved "Scan to pay" counts as the default); own words still possible in Invoice design.

## Seal a bit darker (2026-10-06)
PAID / PAYMENT DUE seal: opacity .62 -> .8, fewer worn holes. Amount still reads under it.

## game-10 — Brawl: make your own fighter from a photo; stick fight: men come in by themselves (2026-10-06)
- New fighter "Bajpakhi Bablu" (owner's photo, made with the grabCut script like the first nine; Hot Nozzle Dash).
- "+ My fighter" on the Brawl bar (any user who sees the game). Choose a photo -> the browser finds the head (the person against the background: top of the hair, widest row above the neck; skin colour as backup on busy backgrounds), cuts the background (flood from the edges, Lab colours, edges stop it, the middle of the face is never cut), 28x34 pixels, 12 colours, dark outline - web/games/facepix.js, loaded only when the window opens. No AI; the photo never leaves the device, only the pixel head is saved. The user can drag / resize the box (wheel or corner) and slide "Background cut" (less keeps a white cap or light hair).
- Random tough-guy name (dice for another, or type one), random special (+ its super), colour and abilities: speed, power, health, defence, 1-9 each, always 20 in all (4 % per point: walk speed, damage dealt, life, damage taken). Shown on the choose screen and in How to play. Old fighters count as 5/5/5/5.
- Server: erpFighterMine (one per person, a new photo replaces it; owner can tick "someone else" to add others without limit), erpFighterRemove (own, or any for the owner); fighters now carry an id and the maker (never sent to the page, only "mine"); limit 24 -> 60; abilities checked (1-9, sum 20). erpFightersSet keeps makers by id. fighter2_test (19).
- One own fighter now plays with the plain ones (before, fewer than 2 meant only the faceless three).
- Stick fight v19: nobody is flung in or dropped from the sky. The next man sprints in along the floor from off the screen (now and then a front flip, double flip, aerial or dive roll on the way in), or runs in at the height of a top near the edge and dives onto it (a tuck flip half the time), or slides down a rope from the top onto a top; then free-runs up to the ninja. Simulated 10 minutes: 24 entries of 8 kinds, none left off screen, no big upward leap, no errors.
- Weak spot (said to the owner): the in-browser cut-out is rough on busy backgrounds (trees, rooms); a plain wall or sky works best. Bangla words for the new window not added yet.

## joint-1 — Joint stock, step 1: the switch and the page (2026-10-06)
Blueprint: docs/JOINT-POOL-BLUEPRINT.md; build notes: docs/JOINT-BUILD-NOTES.md.
- Off for every company. Platform > Businesses has a "Joint stock: on/off" button per company (erpPlatformJoint; server-only table joint_flags, joint_enabled()). Switched ON for Costareen live. A company in a pool cannot be switched off. erpPoolCreate / erpPoolJoin refuse while off.
- New menu item Goods > Joint stock (owners all tabs, managers Stock only, sales staff none), opened from inside the company - nobody switches business. Selector at the top when there is more than one pool. Tabs: Overview, Stock, Money, Month end, Settings.
- Set-up on the page: make the partner's company (own link, own books; the provider's switch is turned on for it in the same step), start a joint stock (invite code), or join with a code.
- Stock tab: add / change a joint product (retail, wholesale, floor price, cost), receive stock (who paid; cost becomes the average), correct a count (valued at cost = the pool's loss or gain; reason required).
- Money tab = the pool's book (capital, expenses, cash handed over, strike out with a reason). Month end = partners table and who pays whom. Settings = price tiers, invite code, slow-payer days (45 by default, 7-180).
- Server: handlers/joint.js, lib/system.js (asSystem: a window with row-level security off inside the same transaction, used after the handler's own checks - staff are not members of the pool). 068_joint.sql also adds products.floor_price, invoice_lines.pool_id, joint_sales for the next steps.
- Tests: joint1_test (41). All suites green. Checked on screen as both companies (set-up, product, receive, capital, all tabs).
- Not done yet: selling (step 2), money split / returns (step 3), floor enforcement, 45-day rule, both-owner Agree, statement PDF, dashboard card (step 4). The old Capital > Partnership tab is still there until step 4.

## joint-2 / joint-3 / joint-4 — Joint stock: selling, the books, month end (2026-10-06)
- **Mixed invoices.** Joint products are in the New invoice search with a "Joint" tag, beside the company's own; one invoice can mix them. The invoice is the seller's own (number, header, customer, due). Sales staff and managers of either company can sell joint stock; they see name, price, floor and count - never cost. The customer's paper shows nothing of the pool.
- **How it is kept.** A joint line in the seller's books: `invoice_lines.pool_id`, code = pool code + `~Jxxxx` (stripped wherever a person or the customer sees it), cost = its price, so the seller's own profit is untouched (a note under Profitability says how much of the sales was joint). For each pool on the invoice the server makes the pool's own copy (createInvoice `opts.mirror`): pool stock out, pool cost, pool number, sold_by = the seller, customer shown as "<company> · <invoice no>" - the partner never sees the other's customers. Link: `joint_sales`.
- **Money** (money.js syncInvoiceStatus -> joint.js syncJoint): real money on the seller's invoice x joint part / what is still billed = what the pool has, written in the pool as a payment "Joint", received by the seller. Adjustments and returns are not money. Part payments split by share; a refund takes the pool's part back.
- **Floor price:** staff are refused below it (per piece and through an invoice discount); an owner may, and the shortfall is flagged (`joint_sales.below_floor`, 069) on the Sales tab, Month end and the statement.
- **Returns / cancel:** the goods go back on the pool's shelf, the pool gets a return note of its own (dated today, at the pool's cost), its money follows. An invoice with joint stock cannot be removed (void) - cancel it.
- **Month end** (070): returns reduce the pool's sales (the old sum did not); slow-payer rule - a joint sale unpaid after N days (45, changeable 7-180) counts as held by the company that sold it; a month closes only when BOTH owners pressed "I agree" (`pool_month_agreed`; a yes can be taken back until the other agrees); statement PDF (erpJointStatementPdf).
- **Page:** Joint stock > Sales tab (every joint sale: who, what, paid, not paid, late, under floor), Month end (late money, flags, Agree, PDF), dashboard card for owners (one line per pool: profit, your share, you pay / you get), Profitability note. The old "Selling from: Joint pool" switch is gone. Capital > Partnership shows only where joint stock is on, renamed "Partner's own stock" (deals from each other's private shelf).
- Tests: joint2_test (44), joint3_test (21); phase4 unchanged and green.
- Not done: serial-numbered joint products (not sold with serials); a joint line on a quotation or a web order; Bangla words for the new screens; a nightly re-check of the pool's share for courier payouts whose sync failed silently (the share is recomputed on the next payment or return of that invoice); stock corrections do not need the partner's approval (he sees them); VAT treatment not verified - ask a VAT consultant if either company is registered.

## joint-5 — simpler words (2026-10-06)
Card 1 now says it IS the partner's ERP (made here because a joint stock needs both companies on the same server). Price tiers (retail / wholesale) are gone from the joint screens: one selling price and a floor price per product; any lower price is typed on the invoice, never below the floor. The tier setting still exists underneath (erpPoolTier), unused.

## sf-retry — Steadfast night check: their server hiccups (2026-10-06)
The dashboard said "last night's Steadfast check failed - HTTP 502". 502 = Steadfast's own gateway was down for a moment at 3:00 AM; keys and connection were fine (the connection test passes). The note stayed until the next night. Now: reading calls to Steadfast are tried 3 times (2.5 s, 5 s) on 5xx / no answer; a booking is never repeated (could book twice); a 5xx says plainly "Steadfast's server was down ... their side, not your settings"; opening Courier money and reading it without trouble clears last night's warning (and the kept dashboard). Ran the missed check live: nothing new from Steadfast, warning gone. courier_test 118.

## joint-x — Joint stock with a partner on his OWN Supabase (2026-10-06)
Owner's decision: every company keeps its own Supabase; the joint pools live in the provider's database (shared space, like the market). Costareen keeps the one-step path; a partner company copy on the bridge sells joint stock across databases.
- His sale: the pool's copy is written first in the provider's database (marked pending), his invoice in his own; if his save fails the copy is taken out at once (new after-save / on-failure hooks in core.js); when it succeeds the copy is confirmed. His money share and returns reach the pool right after his save. A nightly + hourly check (jointReconcile) confirms or removes anything left pending after a crash, re-works the money of his joint sales (90 days) and writes returns the pool missed. Pending sales stay out of the month-end sums.
- He joins with the invite code; in the provider's database a stand-in row (no login, no members) stands for his company. Only provider-side companies start pools.
- Platform > Company copies: "Joint stock: on/off" per copy (erp_tenants.joint, 076). Joint stock page card 1 = "Make an install link for them" (partner installs his own ERP); a partner on his own database sees only the join card.
- Also fixed: company copies on the bridge could not make PDFs or reach the internet through deps (a comment in index.ts swallowed fetch and renderPdf since Stage 2).
- Tests: joint4_test (45) with a second database as the partner's; all 75 suites green. Deployed db (075, 076), function, web, release.
- Not done / limits: a partner on his own database cannot START a pool (asks his provider-side partner for a code); two partners who are both company copies would need one of them to start it - not possible yet. Not clicked through on screen with a real second copy (needs a real install); the flow is covered by joint4_test. Bangla words not added.

## stage-n1 — warranty rules, phone-camera scanning, the Printer Passport register, the customer page (2026-10-06)
Stage 1 of `docs/NETWORK-BLUEPRINT.md` (N0 + N1). All of it is for the printers and other serial-numbered machines a business sells.
- **Warranty rules** (Products > Warranty rules, manager and up): one rule per category, with a brand or for any brand: sold by serial number or not, months of warranty, whether the warranty moves with the machine when resold. A new product of that kind takes the rule by itself (New product, Excel import); "Apply to existing" puts it on the products already there; "Set serial & warranty" works on the ticked products of the list. `077_warranty_rules.sql` (`warranty_rules`, `products.warranty_transferable`).
- **Scan with the phone camera**: a camera button beside every place a serial number is typed - numbering stock, receiving a purchase, picking the unit on an invoice, a return, a repair job, the one search. Android Chrome uses the browser's own reader; iPhone and other browsers load the bundled ZXing reader (`web/vendor/zxing.min.js`, Apache-2.0) only when the camera opens. `_headers` now allows the camera for the page itself.
- **Printer Passport register** (provider control tables, `078_passports.sql`): every sale with a serial number writes the unit's passport by itself - seller, product, sale month, warranty, level "verified"; a return marks it returned; a warranty change and a repair job (came in / went back) go on the record. The buyer and the job number are never public. Public check page **erp.3dowala.com/check?s=&lt;serial&gt;** (`web/check.html`, Bangla and English, its own scan button) reads the function's `?pub=check` route (GET only, 60 checks an hour per address). The owner chooses whether the shop's name shows or only "Supplier · city" (the Market city). "Publish every sold serial to the register" writes the sales made before today. Two sellers claiming one serial: both records say disputed.
- **Warranty card**: a printable A6 card (product, serial, sold, warranty, the check QR, the shop) from the invoice page and from a product's sold list.
- **Customer page**: a second QR "My orders & warranty" on every invoice design (a switch in the design screen) opens **erp.costareen.com/my?t=&lt;token&gt;** (`web/my.html`): his invoices with paid and due, the parcel's status (Steadfast, the newest three), the invoice PDF, his warranties with check links, reorder on WhatsApp. The token is derived from the provider's secret and only its hash is stored (`erp_customer_links`), so every invoice of one customer carries the same link; "Customer's page link" (copy / WhatsApp) on the invoice page and the customer page. Companies on the bridge get their pages at erp.3dowala.com/my.
- Tests: `warranty_test` (25), `passport_test` (40). `sw.js` v3: only the app itself is kept for offline opening, never the public pages. `deploy.py web` publishes `check.html`, `my.html` and `vendor/` (Cloudflare Pages serves /check and /my from them by itself; a `_redirects` rule for that made a redirect loop).
- Not done: registration by a buyer who bought outside the system (stage N2), Lite accounts, points, Print Doctor, Colour Finder; the scanner was tested by code only, not on a real iPhone; the two public pages carry the server's address in their HTML (a company hosting its own copy later would need it stamped in); Bangla words only on the two public pages; the check address stays plain until the public name is chosen.

## auto-update — company copies follow every release by themselves (2026-10-06)
The provider deploys once (`deploy.py all` = db + function + web + release); the hourly timer (updateAll, in the deliveries job on the provider server only) brings every company copy to the newest release: new database files, and for pre-bridge copies the server and timers. A copy whose update stopped with an error (refused token) is left for the Platform screen, where the button still works. i2_test +3.

## stage-n2 — the buyer whose seller is outside the system: self-registration, the confirm link, Lite sellers (2026-10-06)
Stage N2 of `docs/NETWORK-BLUEPRINT.md` (section 5). Public, no sign-in, on the same check page.
- **Register it yourself**: when a serial is not in the register, the owner registers the printer on erp.3dowala.com/check - model, month of purchase, the warranty he was promised, who sold it (name, mobile, city), his own name and mobile, a photo of the invoice and of the serial sticker (shrunk on the phone before upload), and a plain-words consent line (Personal Data Protection Ordinance 2025). The passport exists at once as **declared** (grey). He gets an **owner link** (status, send again, remove everything) and a **confirm link** with a ready WhatsApp message for his seller - he sends it himself, so nobody is spammed.
- **The seller confirms** on erp.3dowala.com/confirm: sees the claim and the photos, types the shop's name, mobile and city (a **Lite seller** record kept on the provider's side; the first name given for a number stays, a stranger cannot rename a shop) and presses *Yes, we sold it*, *Yes, but correct the details* (month, months) or *No, not ours*. Confirmed: the passport turns **confirmed** (green), named or "Supplier · city" as the seller chooses. The seller gets his own page (erp.3dowala.com/lite): every unit he confirmed, a printable digital warranty card for each, his city / e-mail / name switch.
- The check page: verified and confirmed records first, a declaration never makes a "disputed" mark, "the seller named says this sale is not theirs" when rejected; the history shows registered / confirmed / not ours. A serial a seller's ERP already wrote cannot be declared; one declaration per serial; a verified sale written later sits above the declaration.
- Limits per address: 5 registrations, 10 answers an hour. Photos: JPEG/PNG/WebP, 1.5 MB each, checked by their bytes, stored under public/passports/<id>/ in the provider's bucket, deleted with the registration.
- Platform admin: a *Public register* card on the Platform screen - registrations with proof links and *Remove* (abuse only), Lite sellers with *Block / Unblock* (`erpPlatformRegister`, `erpPlatformRegisterRemove`, `erpPlatformLiteBlock`).
- `079_passports_public.sql` (control-only): claim / proof / links / consent columns on `erp_passports`, three new event kinds, `erp_lite_sellers`. Code: `handlers/publicreg.js`; `passport.js` pubRoute now takes POST. Pages: `web/check.html` (form + owner view), `web/confirm.html`, `web/lite.html`. Tests: `register_test` (49).
- Not done: no identity check on the seller - whoever opens the confirm link can answer as any shop (the buyer chooses whom he sends it to; the admin can remove abuse); no SMS or e-mail (costs money) - the links are the only way in, so the pages say "save this link"; the Lite page has no orders inbox or shop page yet (blueprint section 4); transfer of a used printer and repair notes by a shop are later stages; Bangla only on the public pages.

## stage-n3 — Print Doctor: pictures, causes and fixes in two languages; settings, monsoon, power; members' cases (2026-10-06)
Stage N3 of `docs/NETWORK-BLUEPRINT.md`. Public page **erp.3dowala.com/doctor** (`web/doctor.html`, content in `web/doctor-data.js`).
- **24 problems** with a drawn picture each, in Bangla and English: what it looks like, then "check these in order" (ticks are kept on the phone), material notes, when to ask the seller (with a link to the Printer Passport). Written for here: humidity first, cheap filament, load shedding. Search and category chips; `?q=` from the Repairs screen, `?p=` opens a problem.
- **Tested settings**: starting ranges per material (PLA, PLA+, PETG, ABS/ASA, TPU, Nylon, CF) with drying times; **Monsoon guide** (how wet filament shows, drying that works, storage, buying); **Power cuts & UPS**: resume-after-power-loss, flickers, IPS/UPS sizing with a small calculator (printer class × hours → Wh, Ah at 12 V, VA).
- **Community parts** (`handlers/doctor.js`, `080_doctor.sql`, control-only): "Did this help?" votes (one per address per problem per day, shown as "helped N people"); **Send your case** (story, printer, material, photo shrunk on the phone, first name, optional contact, consent line) - the sender gets a case link where the guide's answer appears; **Share your settings** (pending until a guide approves; others press "works for me too", one per address); tips published under a problem with the member's first name.
- The platform admin is the first guide: Platform screen > **Print Doctor** card - answer a case, tick *Publish* to make it a tip, approve or remove shared settings, remove tips. Repairs screen: a **Print Doctor** button under "What is wrong" opens the page searched for that problem. The check page and the customer page link to it.
- Tests: `doctor_test` (42). Rate limits per address: 5 cases, 5 settings an hour; 120 reads.
- Not done: volunteer guides (only the platform admin answers for now); photos of real failed prints (drawings are used - no copyrighted pictures); "which UPS to buy" product links; the ERP does not yet log which Print Doctor problem a repair job matched; Bangla wording was written by the model, not yet read by a native speaker - the owner should skim it; open-content licence for the guides still the owner's decision.

## joint-privacy — owner's check for back doors (2026-10-06)
Audit of every path a partner can use: none reaches the company's own invoices, customers, products, money or settings (remote partners: only pool tables through ctx.deps.control, every query scoped to pools found by the partner's own stand-in row; market / passport / public register / doctor read only their own control tables). Closed three soft spots: (1) 082: pool_partners.share_stock default false and switched off everywhere (partners could see each other's own stock COUNTS); (2) only the partner who started a pool makes or sees invite codes (a joined partner could have let a third company in); (3) the hidden "make their company" action is platform-admin only. joint2_test +6, phase4 opts in to sharing explicitly. 79/79 suites green. Deployed (db 082, function, web, release).

## stage-n4 — print-business kit: jobs on a board with their true cost, printers, spools, the quote calculator, your own quote link (2026-10-06)
Stage N4 of `docs/NETWORK-BLUEPRINT.md` (section 4). New side-menu item **Print jobs** (Sales group), for a business that prints for customers.
- **Jobs**: a board Queued → Printing → Finishing → Ready → Delivered (or Failed / Cancelled). "+ New job": what is printed, customer, printer, the opened spool (or the filament), planned grams and hours, labour minutes, extras, price; the **cost shows as you type** (filament by the gram from the spool's own cost, machine time at the printer's hour rate, labour, packaging) with a **suggested price** (failure allowance + margin). "Print done" asks the actual grams, hours and wasted grams - they leave the spool then and the **true cost** replaces the plan; corrections give grams back. Finished jobs: a list with cost, price and profit (failed jobs count in the cost).
- **Printers**: name, model, serial, what it cost, life in hours, watts, maintenance per hour → its rate per hour (wear + electricity + maintenance).
- **Spools**: "Open a spool" takes one unit off the shelf (stock movement "Opened for printing") and tracks grams left; set the grams after weighing; a spool that runs short is finished with a note.
- **Rates** (manager): taka per kWh, labour per hour, failure allowance %, margin %, packaging per job.
- **Your quote link** (Requests tab): erp.3dowala.com/quote?b=… - the customer writes material, colour, quantity, a description or a link to the file, name and mobile, with a consent line (`web/quote.html`, Bangla/English). It lands in the inbox; *Quote* a price (with a note) or *Decline*; the customer sees it on his request link and presses Accept; *Make a job* puts it on the board with the price and the customer. On/off switch and an intro text. Copy / share on WhatsApp.
- `081_print_kit.sql` (company database: printers, filament_spools, print_jobs, print_requests), `handlers/printkit.js`, public routes `?pub=printquote` / `?pub=printreq` (run as the business's owner, bridged companies through their tenant), limits 5 requests an hour per address. Tests: `printkit_test` (50).
- Not done: no file upload on the quote page (the customer gives a link or sends the file on WhatsApp - uploads of 50 MB STL files need a different path); no invoice is made from a job (type the invoice number on the job; a service line on invoices is still a leftover); no "which printer is free" planning or time estimates from the slicer; the product form has no "grams per spool" field (asked when the spool is opened, default 1000); Bangla only on the public quote page.

## stage-n5 — Find stock: the market goes public for shops that want it; shop pages, orders, "tell me when it is back" (2026-10-06)
Stage N5 of `docs/NETWORK-BLUEPRINT.md` (section 4.1). Public page **erp.3dowala.com/find** (`web/find.html`, Bangla/English).
- **Search**: a product, brand or colour → which shops have it now ("In stock" / "Running low"), the price or "ask", the city, updated when; brand / colour / category chips. Nothing of a shop is shown until its owner switches it on.
- **The shop's switch** (Market > What I share): "Show my shop and the ticked products to everyone" (the same products already shared on the trade market, now with the shop's name, city and phone), "Take orders from the public page", a line for buyers (delivery areas, charges, hours), the shop's own page link (copy / share on WhatsApp). The shop row and the listings refresh together (on save and every 15 minutes).
- **Shop page** `find?s=<shop>`: profile, WhatsApp, its listings; pick quantities and **order** (name, mobile, address, note, consent) → the order lands under the shop's **Web orders** like a website order (number FS-…, payment "to arrange", the note in the address line); the customer gets the order number and a WhatsApp link to the shop. Prices "ask" → "the shop tells you the total".
- **Tell me when it is back**: a product nobody has in stock → the buyer leaves a number with consent; every shop that lists that product sees it under Market > What I share > **Waiting buyers**, with a one-tap WhatsApp message and "Told them". Expires after 60 days.
- `083_find_stock.sql` (control-only: `erp_market_shops`, `erp_stock_alerts`), `handlers/findstock.js`, `market.js` (shop row, public switches, waiting buyers), public routes `?pub=find|shop|order|alert`. The market listings carry no SKU, cost or stock number (unchanged); an order goes by product name and the shop's matcher resolves it. Limits per address: 120 searches, 10 orders, 10 alerts an hour. Tests: `find_test` (31); market suites unchanged.
- Not done: no e-mail or SMS to waiting buyers (no mail service; the shop messages them); no photos on the public listings; no ratings on the public shop page yet (the market's ratings exist between businesses); no map or distance; "Help me choose" / Colour Finder are N5b.

## stage-n1b — community base: the ideas board, the public updates page, guides and credits (2026-10-06)
Stage N1b of `docs/NETWORK-BLUEPRINT.md` (section 4.5: what makes "made with its community" true). Public page **erp.3dowala.com/ideas** (`web/ideas.html`, Bangla/English), linked from the check, doctor and find pages.
- **Ideas board**: anyone proposes (title, what and why, first name, optional contact, consent); anyone votes once per idea; every idea shows where it stands - new / planned / **being built** / done / not for now - and the team's reply. Being-built first, then planned, new, done, declined; most voted first inside a group.
- **Updates page**: what changed, newest first, in plain words, with the credit ("from an idea by Sumon"). Writing an update from an idea marks the idea done and credits its author; "also announce inside every ERP" posts it as an announcement too (the existing `erp_news`).
- **Credits**: the guides (name, what they check, since) with a badge, and the contributors: ideas taken up, Print Doctor cases published, settings approved - counted from what is already on the platform.
- Platform screen > **Community** card: answer ideas and set their state, remove abuse, write updates, take them down, add or retire guides. `084_community.sql` (control-only: `erp_ideas`, `erp_idea_votes`, `erp_updates`, `erp_guides`), `handlers/community.js`, routes `?pub=ideas|idea|ideavote`. Limits per address: 5 ideas, 60 votes an hour. Tests: `community_test` (28).
- Not done: guides have no login of their own yet (the admin checks everything; guides are names on the credits page); no e-mail to an idea's author when it is answered (the board shows the reply); points for contributions are counts, not a scheme; the open-content licence for guides is still the owner's decision.

## stage-n5b — Colour Finder and "Help me choose": closest filament colours in stock, which filament, which printer (2026-10-06)
Stage N5b of `docs/NETWORK-BLUEPRINT.md` (section 4.1). Public page **erp.3dowala.com/choose** (`web/choose.html`, Bangla/English), linked from the other public pages.
- **Colour Finder**: open the camera with a plain white paper beside the thing (the paper tells the phone what white is in that light), press Match - or tap two points on a photo, or pick a colour. The three closest filament colours that shops list publicly, each "very close / close / roughly" (CIEDE2000 distance, `web/colour-math.js`, written from the published formula and checked against its test pairs), with the shops that have them, in stock or running low, price or ask, a link to the shop page; none in stock → the closest that is, and "tell me when it is back". It always says closest, never exact; finishes (silk, matte, glitter) are marked roughly.
- **Swatches**: a shop sets the true colour of each colour name it uses (Market > What I share > Colour swatches, a colour picker per name; `erpMarketSave({colours})`, kept in `business_config market_colours`, carried on the listing as `color_hex`). Without a swatch a general value for the name is used (`web/colour-data.js`: ~36 colour groups, English and Bangla names) and the match is capped at "close".
- **Which filament**: what you print (decorative, functional, flexible, outdoors, heat, stiff and light), open or enclosed printer, direct or bowden, experience → the material with the reason, a second choice, honest notes (TPU on bowden, PETG outdoors, hardened nozzle for CF), a link to the starting settings, and what shops have in stock of it.
- **Which printer**: budget band and main use → the class to look at with the reason (small bed vs 300 mm, enclosed for ABS, AMS for multi-colour, two small printers for a business), the China-version note, the Passport reminder, and printers shops have in stock.
- `085_colour.sql` (control-only: `color_hex` on the listings - still no SKU, cost or stock number), `market.js`, `findstock.js` (hex on the public rows), `web/colour-math.js`, `web/colour-data.js`. Tests: `colour_test` (27: CIEDE2000 pairs, dictionary, swatches through to the public page).
- Not done: the printed match card in parcels (a white paper does the same for now); colour values measured by a device (shops pick with the picker, from a photo of the spool); no printer-model database (classes only); the pickers' advice is the model's writing, not yet read by a native speaker in Bangla.

## stage-n6 — keep-customers kit: points and levels, refill reminders, the delivery-history check (2026-10-06)
Stage N6 of `docs/NETWORK-BLUEPRINT.md` (section 4). Inside the ERP, per business; the customer sees his side on his own page.
- **Points**: every paid invoice earns points (rate per 100 taka; the invoice's points follow what was really paid for goods kept - a refund or a return takes them back; idempotent). Levels Bronze / Silver / Gold from lifetime points with a perk line the owner writes. Managers give **bonus** points (a photo review, a friend brought) or **redeem** them (the discount itself is given on the invoice as today; points never move money by themselves). Customer page: points, level, progress to the next level, ledger; Customers > **Points rules** for the numbers and the switch, and **Count past invoices** (once, idempotent) so levels mean something from day one.
- **Refill reminders**: from each customer's own rhythm on consumables (filament, resin): who is likely to be running out now. Customers > **Refill reminders**: "Ready" (agreed) with a one-tap WhatsApp message and *Sent*; "Ask first" with a message that asks. Consent is recorded (who, when, how); the customer can switch it on or off on his own page (/my), which also shows when he usually buys again.
- **Delivery-history check**: this business's own parcels for the number - delivered, returned, pending - as a plain word on the invoice page, the customer page and every web order: *New customer* / *N delivered* / *watch (1 return)* / *Risky (N returned)* with advice (confirm on WhatsApp, ask an advance). Own data only; no cross-network checker.
- `086_loyalty.sql` (company database: `customer_points`, `customer_consent`, `reminder_log`), `handlers/loyalty.js`, hook in `money.js` after a payment status change, `passport.js` (points and the switch on the customer page, `?pub=my` POST), `my.html`. Tests: `loyalty_test` (30).
- Not done: reminders go out by hand (one tap), not automatically; no referral codes; no "your colour is back" from here (Find stock's waiting list does that); the COD check uses only this business's parcels; points are not shown on the invoice PDF yet.

## restock — waiting orders: the rest from the market, then one parcel (2026-10-06)
Owner's question: a customer wants more than the shelf has; how does the ERP get the rest from the nationwide stock and deliver? Built the "restock" way (the market sends to the shop, the shop sends one parcel; COD and the shop's name as usual). New invoice: an own line short of stock shows "Not enough on your shelf ... Find the rest on the market"; a window lists, per short product, the shops whose market listing is the same product (words match, sizes ignored: the market's own rule), in stock first, same city, cheapest; "Ask and keep the order waiting" sends one normal market request per product (note "For a customer order (name)") and keeps the whole order as a waiting order (restock_orders, 088). Waiting orders card on New invoice: each request's state with its button (Accept price / It arrived - put on shelf, which is the market's own Receive onto the shop's own product), Cancel (closes requests not yet invoiced); when everything is on the shelf: "Make the invoice" fills the invoice (customer, items) and saving closes the waiting order (createInvoice payload.restockId). Dashboard: "N waiting orders are ready to send". Nothing is reserved while waiting (if the other goods are sold meanwhile it shows short again). handlers/restock.js uses the market's existing calls (no change to market.js). restock_test (21); 85/85 suites green; clicked through locally as buyer and seller (found and fixed: the typed phone was lost when sending).
Not done: direct-to-customer delivery from the other shop (dropship) - the courier label would show that shop's name and COD cannot go to the seller; the "it arrived" step stays a button (the other shop's courier status is in its own ERP).

## stage-n7 — Get it printed: the public board of print jobs (2026-10-06)
Stage N7 of `docs/NETWORK-BLUEPRINT.md` (section 4.1). Public page **erp.3dowala.com/print** (`web/print.html`, Bangla/English), linked from the other public pages. The platform is only the board: it holds no money, and the provider's own business neither prints nor passes jobs - it simply never offers.
- **The buyer**: drops an STL or OBJ (3MF, STEP, ZIP, a photo or PDF of a sketch also go through, without an estimate). The file is read **in his browser**: volume by signed tetrahedra (the numpy-stl / admesh formula), surface, bounding box → grams (solid shell of about 1.2 mm on the surface + infill inside, PLA 1.24 / PETG 1.27 / ABS 1.04 / TPU 1.21 g/cm³, +8% waste), hours (~18 g/h), and a **fair price range** (1.3× to 2.2× of grams×1.2 Tk + hours×8 Tk + 50 Tk), with an infill slider, per piece and for all pieces; "saved in inches?" and "bigger than 250 mm" hints. He fills material, colour, how many, notes or a link, city, name, mobile, and a plain consent line, and posts. The file goes **straight into storage** with a one-time signed upload address (`storage.signUpload`, `public/printjobs/<job>/`); the post gets a job number GP-… and a job link `/print?t=` (the only way back; farms never see his name or number until he chooses one).
- **The farm** (any business with the Print jobs kit): Print jobs > **Jobs board** - open jobs with city, what, the browser estimate, the file link, how many offers; **Offer a price** (whole job, days, a note; offering again replaces; Withdraw). It appears as its public shop name when Find stock is on, else "Farm · city". **Given to you**: the jobs whose buyer chose it, with his name, number and file; **Make a job** → a normal print job (planned grams and hours from the estimate × pieces, the agreed price, the file link in the notes); when that job is **delivered** the board job is done.
- **The buyer's link**: the offers with each farm's **rating** (★ average and count of rated jobs; "new farm" before any), price, days, note; **Choose this farm** → the farm's name, address, phone (call / WhatsApp) and "pay the farm directly"; **Close this job** while open; after delivery **How was the farm?** (1–5 stars + words, shown on that farm's future offers). The rating also shows on the farm's Find stock shop page (`shop.rating`).
- Rate limits per address (start 10/h, post 10/h, view 60/h, actions 30/h); file types and 40 MB checked at the start; consent recorded with time and address. `087_print_board.sql` (control-only: `erp_print_board`, `erp_board_offers`, `erp_farm_ratings`), `handlers/printboard.js`, `passport.js` (route `?pub=printjob`), `printkit.js` (delivered → board done), `findstock.js` (rating on the shop page), `index.ts` (`storage.signUpload`), `allow.js`/`security.js`, `web/app.html` (Jobs board tab, wrappers PKB*), `deploy.py`. `printboard_test.mjs` (34).
- Not done: no notice to the buyer when an offer arrives (he comes back to his link; no SMS/e-mail service); no notice to farms of new jobs (they look at the board); jobs that were started but never posted are not cleaned up yet (status `uploading`, no file link to anyone); no dispute path - the platform is a board, buyer and farm settle between themselves; no map or distance, farms sort by their own eye; the estimate is a browser guess, not a slicer, and says so.

## stage-n8 — Design desk and repair-part requests: a sketch becomes a file, then a print (2026-10-06)
Stage N8 of `docs/NETWORK-BLUEPRINT.md` (section 4.1). Public page **erp.3dowala.com/design** (`web/design.html`, Bangla/English), linked from the other public pages and from "Get it printed" ("No file yet? Ask the design desk"). The platform holds no money; designers need no ERP.
- **The buyer**: picks the kind - a new design, a **repair part** (copy a broken or missing part), a personalised thing - gives a title, a description, measurements, deadline, a budget hint, a photo or sketch (JPG, PNG, PDF or a model file, straight into storage with a signed upload) or a link, city, name, mobile and a plain consent line → request DR-… with a request link (the only way back). Designers see the city, the pictures and the words - not the name or number.
- **Designers join the desk** with name, mobile, city, skills, portfolio link and consent (one number once) and get a **desk link** that is their account (like the Lite sellers of N2) plus a **public profile** `design?p=<name>` (rating, jobs done, finished work). On the desk: open requests, **Offer a price** (price, days, note; change, withdraw), **Your jobs** with the buyer's contact, the change notes, and **Deliver the file** (STL, 3MF, OBJ, STEP, F3D, SCAD, ZIP, PDF, signed upload under the request); edit profile, hide from the front page.
- **The buyer's link**: the offers with each designer's rating, skills, portfolio and profile; **Choose** → both get each other's number (call / WhatsApp); the delivered file with the designer's note → **Download**, **Accept the file**, or **Ask for changes** (a note; the request goes back to the designer, who delivers again); after accepting, **rate** 1–5 (on the designer's future offers and profile) and **Get it printed with this file**: `/print?from=<request token>` - the server copies the delivered file into the new board job (no re-upload), the browser reads it only for the estimate; name and city prefilled.
- **Repairs screen**: beside the Print Doctor button, **"Need a printed part? Ask the design desk"** opens the desk with the job's problem text prefilled as a repair-part request (`?kind=repair&what=`).
- **Platform screen** > Design desk card: counts, the designers (phone, portfolio, rating, block / unblock, **New link** when a designer lost his), the requests (remove abuse).
- Rate limits per address; files and sizes checked at the start (15 MB sketch, 40 MB delivered file); consents recorded with time and address. `089_design_desk.sql` (control-only: `erp_designers`, `erp_design_requests`, `erp_design_offers`, `erp_designer_ratings`), `handlers/designdesk.js`, `passport.js` (route `?pub=design`), `printboard.js` (`from`), `allow.js`/`security.js`, `web/app.html` (wrapper viewPlatformK8), `web/print.html`, `deploy.py`. `designdesk_test.mjs` (45).
- Not done: no notice to the buyer when an offer or a file arrives, none to designers of new requests (no SMS/e-mail; they come back to their links); no designer login recovery except the admin's "New link"; no escrow or dispute path (buyer and designer settle between themselves); the licensed catalogue with a royalty per print (blueprint N10) is not started; no preview of STL files on the page (download only).

## Installer: one address for everyone + Supabase "too many requests" waited out (2026-10-06, tag install-free-1)

- **No own-domain choice at install any more** (owner's decision: as easy as possible, every copy on the provider's domain). The "Your website" field and the CNAME / "Use this address" screens are gone. The build's last step makes `<company>.<provider zone>` (e.g. `friend-co.3dowala.com`) by itself - Cloudflare DNS record + Pages address - and the page shows it while its certificate is made (1-10 min), with "Skip - open it on the temporary link". The install route `?install=domain` is removed; `caps` now also says the zone. The platform's own "Web address" button (owner only) still sets a custom address later.
- **Supabase 429 / 502 / 503 / 504**: every Management API call (installer + bridge) retries up to 3 times with backoff (Retry-After honoured, max 20 s); if Supabase still says slow down, the step stays "installing" with a plain note and the page carries on by itself - never "failed". (A partner hit `429 ThrottlerException` at database file 39 of 65.)
- Tests: `i1` (429 six times waited out; the address made at the end; own domain refused), `i3` (route gone, domainSet still works for the platform), `signup`, `bridge`.
- Not done: no way for a company to pick its own sub-name (it is taken from the company name, `-2` when used).
- Follow-up (tag install-free-2): the Platform screen's **Web address** button, left empty, gives a copy the free `<company>.<zone>` address (used to move PrototypeBD off its never-finished `erp.prototypebd.com`). The hourly timer (`deliveries` job) now also checks addresses still being made (`domainsAll`) and, once ready, switches the copy's sign-in links and ERP_APP_URL - the install page no longer has to stay open. The install page now paces its steps (1.5 s apart, 20 s after a slow-down) so Supabase is not hit in bursts.

## stage-n9 — Sell without stock: resellers, drop-shipped under their name, commission settled monthly (2026-10-06)
Stage N9 of `docs/NETWORK-BLUEPRINT.md` (section 4.3). Between two businesses on the platform; no public page. Commission-agent bookkeeping (IFRS 15, the same rule as the joint pool's "seller as agent"): the owner of the goods books the sale and the cost; the reseller books only his commission. The platform holds no money.
- **The supplier** (Market > What I share > **Resellers**): "Sell through resellers" with a discount % off the shelf price, a phone and a line of terms. The ticked (market-shared) products become the **reseller catalogue** with the exact reseller price and the suggested selling price (refreshed with the market every 15 minutes and on every visit). Requests to join: approve (with a reseller's own % if wanted), decline, pause. **Reseller orders**: Accept & invoice → a normal invoice in the supplier's own books to the reseller's customer at the reseller's prices (stock out, the supplier's cost fixed on the line, cash on delivery, source "Reseller", the note names the order and the commission); **Packing slip** PDF in the reseller's name (his name, phone, address; the customer; the lines at his prices; "pay on delivery"; never the supplier's name) for the parcel; **Book parcel** from the invoice as usual (the courier note names the reseller). Order states follow the invoice: parcel booked, delivered and paid, returned, voided. **Commission statements** by month of delivery per reseller: delivered-and-paid orders earn their margin, returns earn nothing; **Pay** books an expense "Reseller commission – <reseller> – <month>" and marks the statement paid.
- **The reseller** (new **Resell** screen, Sales group): Suppliers (who sells through resellers, %, terms, products; Ask to join with a line about the shop; state), Sell (choose the supplier; products with stock band, "you pay", suggested price; quantity and **your own price**; customer name, mobile, address; delivery charge the customer pays; live summary: customer pays / you pay the supplier / your margin; Place the order), Orders (state, consignment, cancel while waiting), My commission (month, supplier, orders, commission, paid, **Received**).
- Rules: a price below the reseller price is refused; an out-of-stock product cannot be ordered; only an approved (not paused) reseller orders; the supplier's invoice carries the reseller's prices line by line (`createInvoice` option `resale.unitPrices`, cash on delivery allowed without a courier source name). `090_resellers.sql` (control-only: `erp_reseller_programmes`, `erp_reseller_links`, `erp_reseller_catalog`, `erp_reseller_orders`, `erp_reseller_settlements`), `handlers/resellers.js`, `jobs.js` (websync → `resellerRefresh`), `invoice.js`, `allow.js`/`security.js`, `web/app.html` (view `resell`, wrapper `mkMineHtmlR9`). `resellers_test.mjs` (47: programme, join, catalogue, order rules, the invoice and its cost, slip, parcel, delivered → statement, returned, pay → expense, received, timer refresh, pause, own %, off).
- Not done: the reseller's commission is not yet a line in his own profit report (the ERP has no "other income" entry; he sees it on the Resell screen and notes it by hand); the courier label still shows the supplier's merchant name (Steadfast does not take a sender name per parcel - the slip inside and the courier note carry the reseller's name); prepaid orders (customer pays the reseller first) are not supported - cash on delivery to the supplier only; no partial returns on a reseller order (a returned parcel earns nothing); no automatic reminders when a month's commission is due.

## Fix: a company on the provider's server is never platform admin (tag padmin-fix, 7 Oct 2026)

Found while checking PrototypeBD's copy: its owner saw the **Platform** screen. The installer puts a copy's owner
into that copy's own `platform_admins` (right for a copy on its own server), but on the bridge every admin check read
the company's database while several provider screens read the provider's control tables - so a bridged company's owner
could see and moderate the ideas board, design desk (designers' contacts), Print Doctor cases, the public register and
Lite sellers. Now one rule, `platformAdmin(ctx)` in `handlers/platform.js`: false when `deps.install.bridged`; every
admin check (community, compliance, designdesk, doctor, installer, publicreg, joint, platform) and the `platform` flag
in erpHello (core.js) use it. Test `padmin_test.mjs` (18). Also checked: PrototypeBD's database never held any
product, customer or invoice (nothing saved, nothing deleted) - the "data that disappeared" was not in his books.
- Not done: no check whether he actually opened those screens (reads are not logged); a copy on its OWN server still
  makes its owner admin of that copy (intended).

## Fix: file lists from Storage (backup screen showed 0 files) - tag storage-list-fix, 7 Oct 2026

Backups ran every night (3.9 MB JSON in `erp-files/<biz>/backups/`), but Settings showed "0 files" and the keep-14
pruning never removed anything: `storage.find` in index.ts passed `search: ' - backup '` and Supabase Storage now
matches `search` against the START of the name. Removed `search`; the code already filters by `includes(part)`.
Same path served invoice PDF and quotation-asset lookups by part of the name. Live: 7 files listed with links.
Not done: no test (storage is a live HTTP service, not in the harness).

## Fix: public-page refusals no longer show as failed timers (tag alerts-pub-fix, 7 Oct 2026)

`/quote` refusing a visitor while "Taking requests" is off runs as the owner (`pub:quote`), so its error landed in
erp_errors as who='Timer' and the Alerts bell showed a daily red "pub:quote failed". `erpAlerts` now skips `pub:*`
actions. Test in phase6_test. Also checked and NOT changed: cost at sale is already frozen from the price book for
every line since 5 Oct (0 zero-cost lines on 5-6 Oct); earlier zeros are history and the reports fall back to today's
book cost for them. Live payments do flip invoice status (INV-1911 Partial); the 453 "Pending though paid" are all
imported rows - the owner's data, left alone.

## Apps page (tag apps-1, 7 Oct 2026)

Decided with the owner 7 Oct: the menu was 24 items and nobody could find the switches. Now a **core menu** (Dashboard,
Apps, New invoice, Sales, Customers, Products, Stock entry, Money, Settings) and an **Apps** screen (second item, and on
the phone bar in place of Products) listing every other ability as a tile: name, one line, where its settings live,
Open. Two switches on a tile: **On for everyone** (platform admin only; off = the app leaves every company's menu and
its public page answers "This page is not open yet.") and **In my menu** (a company's owner; off = out of this
company's menu, still opens from Apps, nothing deleted). Public pages (Find stock, Colour finder, Printer Passport,
Customer page, Print Doctor, Get it printed, Print quote, Design desk, Ideas) are tiles that open in a new tab and have
only the provider's switch; Colour finder follows Find stock (same data). Joint stock keeps its per-company provider
flag; Platform is not an app.
`091_apps.sql` (control-only `erp_app_flags`), `handlers/apps.js` (`erpApps`, `erpAppSet`, `appsState` for erpHello,
`appOff` for the public router), `core.js` (erpHello carries `apps: {off, hidden}` so the menu is right on first
paint), `passport.js` (gate at the top of `pubRoute`), `web/app.html` (nav button, tab bar, block "Apps page":
wrappers on `applyRole`, `routeAllowed`, `repaint`, `go`; a hidden app's nav button carries `data-apphidden` so its
route stays open). `apps_test.mjs` (21).
- Not done: the company-type question at setup (defaults per type), the public front page and the share card, the
  plain-word renames, Bangla on the tiles. Old routes all still work. Provider flags live on the provider's database
  only; a copy on its own server has no provider switch (everything on).

## Apps page, corrected (tag apps-2, 7 Oct 2026)

The owner's correction: the Apps page is for the **network features** only, not every ERP screen. Tiles now: For
customers (Find stock, Colour finder, Printer Passport, Customer page, Print Doctor, Get it printed, Print quote, Design
desk, Ideas) and Between shops (Market, Resell, Print jobs, Joint stock). **Open** goes to the screen inside the ERP
where the feature is run and set up (Market → What I share, Print jobs → Requests, ...); **Public page ↗** opens what a
customer sees. Design desk and Ideas are run from Platform: a company's tile has only the public page. The ordinary
screens (Web orders, Quotations, Repairs, Campaigns, Suppliers, Product cost, Profitability, Expenses, Capital,
Maintenance) are back in the menu as before. Which menu screens a company shows is now a **Menu card under Settings →
Business** (owner; tick/untick; the main screens are not listed). Same `apps_hidden` list, same `erpAppSet` scope
'mine'; `erpApps` also returns `menu`. The provider's switch stays on the Apps tiles only. **Resell switched off for
everyone** on the owner's word (he switches it on from Apps when he needs it). `apps_test.mjs` (24).

## Apps page: owners see everything, staff menu, "Switch on for everyone" (tag apps-3, 7 Oct 2026)

Owner's two corrections. (1) The hidden list is for **staff only**: an owner always sees every screen (page: the
`applyRole` wrapper skips the hidden list for role owner). The tick is now "Staff see it", on the tiles and in the
Settings → Business → Menu card; its text says what a person may DO is set under Users (the hidden list is a menu
matter, not a server refusal - the role gates are). (2) An app the provider switched off shows the provider a
**"Switch on for everyone"** button, on its tile and in the Menu card row (`data-apon`), instead of a locked box.
Page only; no server change.

## Edit menu bar: everyone / only owners / off, per screen (tag apps-4, 7 Oct 2026)

The owner's rule: for every screen he decides three ways - **Everyone** (him and his staff), **Only owners** (he uses
it, staff do not see it), **Off** (nobody in his business, until he switches it back) - and only an owner may change
it. Settings → Business → **Edit menu bar**: a table, one row per screen, a three-button choice (`apModeSeg`,
`.seg`). The same choice sits on the Apps tiles of Market, Resell, Print jobs and Joint stock. An app the provider
switched off shows the provider a "Switch on for everyone" button in that row. Stored as `business_config`
'apps_menu' = {key: mode}; the old 'apps_hidden' list reads as 'owner' and is retired on the first save.
`erpAppSet {key, mode, scope:'mine'}` (the old `on` still means everyone / only owners); erpHello carries
`apps: {off, hidden, gone}`. `apps_test.mjs` (28). Staff cannot change it (server: owner only).

## Apps = the special features only (tag apps-6, 7 Oct 2026)

Owner: Market, Resell, Print jobs and Joint stock are menu screens, not apps. They leave the Apps page (which now
holds the 9 public features: Find stock, Colour finder, Printer Passport, Customer page, Print Doctor, Get it printed,
Print quote, Design desk, Ideas) and are managed only in Settings → Business → Edit menu bar. On his word, live:
Customer page, Get it printed, Print quote, Design desk, Ideas switched off for everyone ("not open for customers yet");
Print jobs Off in Costareen's menu bar. apps_test (28).

## Apps as app icons, one screen per app, Feedback (tag apps-7, 7 Oct 2026)

Owner: design first, app icons like a phone's home screen, in the ERP's own look. The Apps screen is now a grid of
icons (`.ap-home`, 62 px rounded squares in the menu's --app colours, name under; a red dot = off for everyone).
Tapping one opens **the app's own screen** (`#/app/<key>`, view 'app'): icon, name, what it does, the company's
settings link, **Open the page ↗**, and for the provider the switch On for everyone / Off; a **Share** card with the
public address, its QR (`erpAppQr`, SVG, download + copy); and - provider only - the management panel **moved here from
Platform**: Passport register (`pregCard`), Print Doctor cases (`pdocCard`), Ideas (`pcomCard`), Design desk
(`pdesCard`). Platform shows a one-line "Moved to Apps" card instead. The four loaders repaint on the app screen too.
**Feedback** (new app, `092_feedback.sql` control-only `erp_feedback`): anyone signed in to any ERP sends a problem /
complaint / idea / praise with an optional contact (`erpFeedbackSend`), sees what their business sent and the
provider's answer (`erpFeedback`); the provider's inbox with counts, a status (new / looking / fixed / not planned) and
a reply per report (`erpFeedbackSet`); a **Report a problem** button in the side menu's foot opens it from any screen.
Companies never see each other's reports. `apps_test.mjs` (38).
- Not done: a public "report a problem" form on the customer pages (not open to customers yet); Bangla on the app
  screens; e-mail/WhatsApp notice to the provider when feedback arrives.

## Receive stock from a file (tag receive-file-1, 8 Oct 2026)

Stock entry → Receive stock → **From a file**: a supplier's packing list, proforma or order sheet (PDF, .xlsx, .csv)
becomes lines on the receive form. The browser reads the file (spreadsheets with the page's own reader; PDFs with
pdf.js from cdn.jsdelivr.net, loaded on demand, no worker - the CSP allows that script source); the server
(`handlers/receivefile.js`, `erpReceiveMatch`) finds the heading row and the columns (code / name words / qty /
price / currency) or, for a PDF, rebuilds records from the lines (a supplier code, the name wrapped over lines, the
quantity on a numbers line), then matches every line: 1. a remembered alias, 2. our own SKU, 3. the words - brand
(from the supplier, the file name - 拓竹 = Bambu Lab - or the row), filament type (PLA Basic / Matte / PLA+ / PETG /
ABS / ASA / TPU ...) and colour, scored against every product's name and colour. Below the bar it is a **new product**
with a suggested name ("Sunlu TPU Grey"), never a silent guess. The review card: file text, our product (a list of
the closest, or search), qty, unit price, confidence pill, Skip; **Add to the receive list** fills the form (quantities
merge into existing lines, new products as drafts, the file's money total as the shipment total in its currency, the
file name as the reference) - nothing enters stock until Receive. Confirmed matches are remembered per business
(`093_product_aliases.sql`, `erpReceiveLearn`), so the next file from the same supplier matches at once. Tuned on the
owner's four samples (docs/samples: Polymaker packing list PDF - 33 lines, 1,170 units; Bambu order sheet - 73 lines,
66 matched by words; Polymaker proforma; a photo of a Sunlu price list typed as a table). `receivefile_test.mjs` (26).
- Not done: photos / scanned PDFs (no text inside - needs an AI key; Settings → Connections → AI is for AI clients,
  not a model); per-line cost into the cost book (the shipment total is used, as the form always did); Bangla.

## Photos of supplier documents: on-device OCR first, the provider's AI reader second (tag ocr-1, 8 Oct 2026)

"From a file or photo" now takes a JPEG/PNG (or the phone camera) and a scanned PDF. **1. On the device:** Tesseract
(self-hosted in `web/vendor/tess/`, 8.6 MB cached after first use; the CSP gained `'wasm-unsafe-eval'`) reads the
picture - enlarged to ~2,400 px, greyed, contrast-stretched, page mode 6 - and the lines go to `erpReceiveMatch` as
text (`reader: 'ocr'`); the text reader now also makes one record per "words + numbers" line (a table off a photo),
and strips table rules and OCR noise. The card says "Read on this device (N% sure). Nothing was sent anywhere." **2. The
provider's AI reader:** a button "Read it better" (shown always after a photo, also when the OCR found nothing) sends
the shrunk JPEG plus the OCR text as a hint to `erpReceiveRead` → Gemini (`gemini-2.0-flash`, the PROVIDER's key
`ERP_GEMINI_KEY` on the function, reaching every company's deps) → JSON lines → the same matcher. 40 reads per
business per day (`business_config ai_reads:<day>`), plain sentences for no key / 429 / nothing found; the card says
"Read by the provider's AI reader · N reads left today". Tested on the owner's Sunlu price-list photo (800 px): the
OCR alone gets ~25% and two right matches - the AI path is the real reader for such photos. `receivefile_test.mjs`
(32, Gemini faked with `web.on`).
- Not done: the key is not set yet (owner to give it: `python deploy.py secrets ERP_GEMINI_KEY=...`); no per-company
  key override; Chinese columns ignored; a "which reader was used" note on the stock movement.

## AI reader live; spool-or-refill tie-breaker (tag ocr-2, 8 Oct 2026)

The owner's Gemini key is on the function (`ERP_GEMINI_KEY`). Models, in order: `gemini-flash-lite-latest` (4 s on the
sample photo), `gemini-2.5-flash` (20 s), `gemini-2.5-flash-lite`; 40 s cap each (`gemini-flash-latest` hung, `2.0-flash`
is retired - names change, so a list). Live on the Sunlu price-list photo: 35 of 35 rows, every quantity and price,
9.5 s. The matcher now breaks the tie between the same colour on a spool and as a refill ("PLA+2.0 (diskless) Black" →
the Refill product, "PLA+ Black" → the spool: `isRefill`, ±0.06), treats transparent/translucent as colours, and when
every word of a row was a type word ("PLA wood / Wood") takes the last plain word as the colour. `receivefile_test.mjs`
(37).

## Platform → AI reader key, set from the ERP (tag ai-key-1, 8 Oct 2026)

The owner asked where the Gemini key lives and to be able to change it himself. A card on the Platform screen (provider
only): status (Set · …last 4 · "set from here on <date>" / "the server's own key" / Not set), a field to paste a new
key, **Save** (used from the next read), **Remove** (back to the server's key or none), **Test the key** (one tiny
request to Google, says which model answered or that Google refused the key). Stored in `094_provider_secrets.sql`
(control-only `erp_provider_secrets`), sealed with ERP_BRIDGE_KEY (`sealJSON`); the key is never shown back. The
reader (`erpReceiveRead`) uses the stored key first, else the function's `ERP_GEMINI_KEY`. Handlers `erpAiReader`,
`erpAiReaderSet`, `erpAiReaderTest` in receivefile.js, platform admin only. `receivefile_test.mjs` (46).

## One receive list; unknown lines set up as products with suggested boxes (tag one-list-1, 8 Oct 2026)

Owner: two lists was wrong. A file or photo now puts its lines **straight into the receive table**, beside the rows
added by hand. Three row states: **green** (sure, remembered or our SKU - a normal row, with "from file: … · 48 RMB
· 99% match" under the name), **amber** ("which one?": a dropdown of the closest products or search, **Keep this**),
**red** ("not in your products": **Set up product**, or pick an existing one). The Receive button is locked while any
row is amber or red and says "N row(s) need a choice"; a "Show only those" filter (on by itself when a file brought
more than 8 rows) hides the settled ones. Quantities merge into rows already there; the file's money total and name
fill the shipment total and the reference as before. Choices (keep, pick, set up) are remembered as aliases.
**Set up product** opens the ordinary New product form on the receive tab, **pre-filled by `erpProductSuggest`**: name
in the owner's pattern ("Sunlu PLA+ Klein Blue"), brand, type, category, unit, supplier, reorder level and lead time
taken from the most common values among the siblings (same brand and type, else brand, else all), sell price = the
siblings' usual one, cost = the file price when it is in taka, a SKU in the owner's pattern (brand initial + type
letters + colour initials + next running number, checked free). A note above the form says how many siblings the
suggestion came from; every box is editable; on Create the new product takes the red row's place with the file's
quantity. The old review card is gone; the small "From the file" card only reports counts and offers the AI reader
after a photo. `receivefile_test.mjs` (51).

## Joint stock: "Start it" failed live (tag joint-fix, 8 Oct 2026)

`function gen_random_bytes(integer) does not exist`: 075 had rewritten `create_pool_invite` with gen_random_bytes,
which on Supabase lives in the "extensions" schema a `search_path = public` function cannot see (023 had already
moved it to gen_random_uuid once). `095_pool_invite_fix.sql` restores the uuid-based code. The local test database
has pgcrypto in public, so the suites never saw it - a live-only failure.

## Joint stock: where the goods are (tag joint-held-1, 8 Oct 2026)

Owner's case: 1,000 kg imported, 700 on his shelf, 300 on the partner's; the partner gets a big order and collects
250 more from him; both sell. The pool now keeps **whose shelf** every unit is on, separate from who paid for it.
`096_pool_held.sql`: `stock_movements.held_by` (the partner business), enum value `MOVE`, backfill (receipts on the
payer's shelf, sales off the seller's). Receive stock asks **Received at** (default: who paid); a mirror sale leaves
the seller's shelf (`held_by = opts.mirror.seller` in invoice.js); a mirror return comes back to it; Correct a count
asks **Whose shelf was counted**; new **Move between shelves** (`erpJointMove`: an OUT from one shelf and an IN to the
other, same note, refused above what the shelf holds, owners only). A seller who sells more than his shelf holds is
not refused: the shortfall is written as moved from the partner holding most, note "Moved on sale INV-…"
(`ensureHeld` in `mirrorJointSale`). The Stock tab shows a column per partner ("At Costareen · At PrototypeBD"),
red when negative. Ownership and profit unchanged (by money). `joint5_test.mjs` (15: the owner's scenario end to
end, the automatic move, a refused move, a count on one shelf, a return to the seller's shelf).
- Not done: a per-shelf stock count screen (Count & adjust works per shelf via the form); the seller's own screen
  does not yet show "you hold N of this" on New invoice; the partner's remote (own-database) copy gets the same
  through the pool's database - not tried against a live remote pool (none exists yet).

## Master catalogue, kept by the server (tag catalogue-1, 8 Oct 2026)

Owner: many shops will enter the same physical thing differently; nobody should have to learn an SKU; the back end
does it all. `097_catalogue.sql` (control-only): `erp_catalog_items` (one per brand|line|colour|size|variant, a shown
name "Bambu Lab PLA Basic Jade White 1 kg (refill)"), `erp_catalog_links` (every listed product → item, how key / ai
/ admin, the name seen), `erp_catalog_log`. `handlers/catalogue.js`: `catalogSync` runs after every market refresh
(by the words only) and each night (the unsure names to the AI reader in batches of 40, one answer per name, cached by
the link). Words = the receive-file matcher (`brandOf`, `typeOf`, `colourOf`, `isRefill`, now exported) + `sizeOf`;
a filament with no size written counts as the 1 kg spool; "Bambu Lab" / "BBL" / 拓竹 are Bambu Lab. A name with no
brand stays unlinked (shown under the shop's own name). A listing whose name changed is looked at again; a link the
provider made by hand ('admin') is never overwritten. Find stock groups by item (`findstock.js` joins the links) and
shows the catalogue's name. Platform → **Catalogue** card: counts, Run now, the not-yet-linked list, items with shop
counts and Rename, the log of what was decided. `catalogue_test.mjs` (16).
- Not done: the Market screen inside the ERP still groups by name (Find stock does by item); barcodes/GTIN; a shop
  seeing "your product is listed as <item>"; merging two items by hand (rename only).

## Catalogue: every product, folded card (tag catalogue-2, 8 Oct 2026)

Owner: "why only 95 of my 141?" - the catalogue read the market listing, which carries only products with stock. Now
`098_catalogue_products.sql` (control-only `erp_catalog_products`): the market refresh also writes every active
product of a sharing company, in or out of stock, and the catalogue reads that feed (Find stock still shows only what
is on the shelf). And the Platform → Catalogue card is **folded by default**: one line "Catalogue · N items · M
products linked · all linked / K waiting · Open ▸", remembered per device (`cz_catl_open`).

## Catalogue: unshared products too (tag catalogue-3, 8 Oct 2026)

The feed carried only the products ticked for the market (96). Now every active product of a company that is on the
market goes into `erp_catalog_products`, shared or not; the listing is unchanged. Live: 141 of 141 Costareen products
linked, 134 items; the catalogue shows the owner's own duplicates (two "Sunlu PLA+ Red", three Klein Blue/Oak/Silver
variants) as one item each.

## Ask your ERP - the chat inside the ERP (tag assistant-1, 8 Oct 2026)

Owner: a user should get everything through a chat, with only their credentials - no WhatsApp, no number from
anyone. New menu item **Ask your ERP** (core, after Apps; `#/chat`): a chat screen, Bangla or English, with quick
chips ("Sales today?", "Who owes money?"...). `handlers/assistant.js` (`erpAssistant`): Gemini with function calling
over a small set of the ERP's own functions - find_products, customer, sales_day, dues, invoice, invoice_pdf,
month_profit, help (a built-in where-things-are guide), propose_invoice. Reads run at once through the ordinary
handlers, so the role gate (`callAllowed`) applies exactly as on the screens ("Not allowed for your role" goes back to
the model, which says so). A write never runs from the model: propose_invoice returns a **proposal** (summary, total,
stock warnings) the page shows with **Yes, make it / No**; Yes calls `erpCreateInvoice` through the same gate, notes
"(via chat)", and returns the PDF link. Cash on delivery goes out by Steadfast unless the person named another way.
The provider's key (the one the photo reader uses), the model list with 40-s caps, 300 turns per business per day
(`ai_chat:<day>`), conversation kept on the device (`cz_chat`, last 40). Every call is logged "Used the chat
assistant". `assistant_test.mjs` (9, Gemini faked by script).
- Not done: push notifications; more writes (receive stock, payments) - invoices only for now; voice; the chat on
  the phone's bottom bar (it is under More).

## What to push next - the first "Only me" feature (tag push-1, 8 Oct 2026)

Owner's rule from today: new things are built for him alone; later he may open any of them to everyone. Mechanism:
an app in `handlers/apps.js` marked `labs: true` sits in an **Only me** group on the Apps page. It is off for every
company until a flag row `enabled=true` exists (provider switch on the app's own screen, "Switch on for everyone");
the platform admin always sees it. Bridged companies and staff never see it while off.

The feature: a card **What to push next** at the top of Campaigns (`handlers/push.js`, `erpPushList`), rules not AI,
every row says why. Four lists from the shop's own sales and stock: **Advertise now** (sold in 90 days, at least
30 days of cover, margin at or above 15%); **Clear out with an offer** (nothing sold for 60 days and at least BDT 2,000
on the shelf; the offer is cost + 10% rounded up, or 15% off when there is no cost; money tied up totalled); **Rising**
(last 30 days at least 1.5x the 30 before); **Not now - reorder first** (selling but under 14 days of cover). Cost comes
from the cost book, falling back to the product's own cost. Rules editable by the owner (`erpPushRulesSave`,
business_config `push_rules`). Tick rows and **Start a campaign with the ticked ones** opens the New campaign form with
the name and message pre-filled (product, price, offer price and % off, stock left). `push_test.mjs` (17).
- Not done: no product photos in the message; offer prices are advice only (nothing changes the sell price); no
  seasonal or website-traffic signals; lists capped at 25 rows each.

## Advertisement tab on Campaigns (tag ads-1, 8 Oct 2026)

Owner: the push card was the wrong shape - he wants advice on what to advertise and how, for Facebook, Marketplace,
the website, not a WhatsApp send list. New tab **Campaigns > Advertisement** (owner-only through the same "push" app
flag; the card moved off the Campaigns list): **This week** - a seven-day rhythm (product post, reel, tip, offer post,
bundle, customer prints, product list) with the product for each day picked from the lists and a **Write it** button;
**What to advertise** - the four lists (advertise / clear out with an offer / rising / reorder first), each row with
**Write a post**; a draft box with channel chips (Facebook post, Reel shot list, Offer post, Bundle, Marketplace
listing, Story, Website banner; stars mark the fit), a plain template written on the device from the product's own
figures, **Improve with AI** (`erpAdDraft`, Gemini on the provider's key, English / Bangla / Banglish, facts only,
owner notes sent along; counts against the 300-a-day AI allowance) and **Copy**; **Product list for customers** -
every in-stock product with price by category, one click to copy (for a pinned post or anyone asking for the full
list); **Playbook** - eleven points from Bangladesh f-commerce practice and 3D-printing sellers abroad (price in every
post, one product per post, reels of timelapses, "only N left" with a deadline then stop, Marketplace for the top 10,
weekly pinned list, bundles over deep discounts, customer prints, seasonal timing, fast inbox replies, help in groups).
"Send the ticked ones to customers" stays as the secondary button. push_test.mjs now 22.
- Not done: no photos attached to drafts (copy text, add the product photo yourself); no posting to Facebook from the
  ERP (would need a Meta app review); no ad-spend or reach figures; rules for the week plan are fixed (one post a day).

## Creators - influencer sponsorships for a brand (tag creators-1, 8 Oct 2026)

Owner (from his "Influencer reports for resellers" chat, 6 Oct): Polymaker approved sponsoring three creators (Rana,
Robin, Setu) with filament through Costareen as reseller and asked for a simple record per collaboration - creator,
SKU and quantity, link, date, performance, enquiries and sales. He chose the ERP over a Google Sheet, owner-only.
New tab **Campaigns > Creators** (second "Only me" app, key `creators`; `handlers/creators.js`, migration 099:
erp_creators / erp_creator_ships / erp_creator_posts / erp_creator_projects, owner RLS). Per creator: terms (videos
and posts a month, rolls per video, filament kind, code, trial end, status active / paused / stopped, notes);
**Filament given** (date, SKU from stock fills name and retail value, or typed by hand); **Videos and posts** (date,
platform, type, link, product, views, likes, comments, shares, enquiries; update the numbers later); **Projects for
the brand** (team, project, competition, material, quantity; new / sent / approved / declined). Month arrows.
Summary per creator and month: rolls and value, videos + posts against the agreement ("Behind: 1 of 2 videos" or "On
track"), views, engagement rate, enquiries, orders and revenue from invoices whose note carries the creator's code,
filament value per 1,000 views. **Report for the brand** - the month's report text in the shape Polymaker asked for,
copy and e-mail. **Brief for the creator** - a one-page brief from the terms (what they get, what they deliver, tag
the brand, link the store, code, the claims rule, the 30-day numbers, trial and review; projects line for creators
with student teams), copy and send. `creators_test.mjs` (22).
- Not done: no reminders to creators or to the owner (the Behind pill is the reminder); no automatic views from
  YouTube or Facebook (typed in); sales counted only by the code in the invoice note (type "code SETU10" in the
  note at sale time) - website coupons are not read; no photos or files attached.

## Creator portal: creator pages, sponsor dashboard, YouTube numbers (tag portal-1, 8 Oct 2026)

Owner: "I do nothing" - the creators fill their own forms, the brand sees everything live, every step trackable;
professional look with both logos. Built on the Creators tracker (handlers/creatorportal.js, migrations 100 + 101):
- **Creator's page** `web/creator.html` (`?pub=creator&t=…`, one permanent link per creator from Campaigns >
  Creators > the creator > **Creator's link**, with QR). Header: shop logo × brand logo (Polymaker's from
  `web/brand/`). The unit is a **project**: Request filament for the next video (pick from what is in stock, rolls,
  one line about the video) → the owner approves / declines with a note → **Handed over** writes the filament line and
  value → the creator pastes the video / post links into that project (YouTube: platform and type guessed, numbers
  fetched by the ERP, **verified**, cannot be typed over; other platforms: typed, **reported**, "Update" later) → the
  project closes; the next request is allowed only when the last project has its link (owner can raise
  `open_limit`). Shows the agreement, this month's count, rules for every post. Paused / stopped creators cannot request.
- **Sponsor's page** `web/sponsor.html` (`?pub=sponsor&t=…`, one permanent read-only link per brand from **Brand's
  live link**): programme totals, per creator KPIs (rolls and value, content and verified count, views, engagement,
  enquiries, orders by code, filament per 1,000 views), six-month bars (views, rolls), every project with its links,
  numbers, source and timestamps, filament lines with when they were recorded, proposed student projects. CSV
  download, Print / PDF.
- **ERP**: Creator requests card on top of Creators (Approve with rolls + note / Decline / Handed over), Projects
  section per creator, **Activity** (the audit trail: who, what, when, creator's address), **YouTube key** (business
  setting `youtube_key`), **Fetch YouTube numbers now**; nightly job fetches every YouTube link older than 20 h.
  Posts show verified / by the creator. `creatorportal_test.mjs` (29, YouTube faked).
- Not done: stock is not moved when filament is handed over (adjust stock as before); no WhatsApp / push message to
  the creator on approval (he sees it on his page); no screenshot upload for reported numbers; Facebook / Instagram /
  TikTok numbers stay reported; the owner must paste a YouTube Data API key once for verified numbers.

## Creator accounts: creators join by themselves, neutral link, owner reviews (tag accounts-1, 8 Oct 2026)

Owner: no company name in the link; the creator fills everything himself (name, e-mail, phone, then a profile);
he logs in; the owner sees the data and sets active / trial / terms; "super professional, e-mail must work".
- **Join link** `https://erp.3dowala.com/creator?p=<10-letter code>` (Campaigns > Creators > **Join link for
  creators**, with QR): the programme's front page (shop logo x brand logo, three steps), **Join** with name, e-mail,
  phone. A Supabase Auth login is made (confirmed, no password) and the **Choose your password** e-mail goes out through
  the project's Gmail SMTP - the same path the ERP's own sign-in uses (200/hour; tested live on the owner's own
  address, `recovery_sent_at` confirmed). The e-mail template was made neutral ("Choose your password", no "ERP"),
  and `erp.3dowala.com/**` + `prototypebd.3dowala.com/**` were added to the Auth redirect allow-list.
- **Sign in** at `erp.3dowala.com/creator`: e-mail + password (Supabase `token?grant_type=password`), session kept on
  the device with refresh; **Forgot the password?** sends a new link (same answer for unknown e-mails). The old
  token links (`?t=`) still work.
- **Profile** (required before anything else for self-joined creators): channel / page / group names, platforms
  (chips), followers per platform, links, what he makes, city, audience, WhatsApp, filament wanted. Editable later;
  every save is an event.
- **Review**: a self-joined creator is `applied`; his page says "Application received"; he cannot request until the
  owner opens him (Creators card shows **Applied - review**, the detail screen shows everything he typed with the
  times; **Edit** sets brand, terms, trial, code, open-limit, **Active**). Hand-added creators: **Send him a login**
  by e-mail (`erpCreatorInvite`). `erpCreatorSave` now changes only the fields it is sent (the owner's form never
  wipes the creator's own profile). `creatorportal_test.mjs` now 50.
- Not done: no e-mail to the creator when approved (he sees it on his page); no e-mail to the owner when someone
  joins (the Applied badge is the signal); one creator per e-mail across the provider; the sender name of the e-mail
  is still "Costareen ERP" (Supabase SMTP sender).

## Creator pages on a name-free host (tag accounts-2, 8 Oct 2026)

Owner: no "3dowala" in the link either. The creator and sponsor pages now live on their own Cloudflare Pages
project **creatorsdesk** (`https://creatorsdesk.pages.dev/creator`, `/sponsor`; root redirects to /creator; only
those two pages, the brand logos, the icons and `_headers` are published there - `deploy.py web` does it). Function
secret `ERP_CREATOR_URL` tells `pageUrl()` where the pages are (falls back to the neutral public address); the host
is in CORS (`OWN_ORIGINS` + the pages.dev rule) and in the Supabase Auth redirect allow-list. The first name tried,
`creator-desk`, got a suffixed subdomain (`creator-desk-55l`, the plain one is someone else's site) and was deleted.

## Reset the creator programme after a trial run (tag accounts-3, 8 Oct 2026)

Owner wants to try the whole flow himself first, then wipe it and send the real links. Campaigns > Creators >
**Reset the programme…** (type RESET): `erpCreatorReset` deletes every creator, request, filament line, post,
project, activity line and link of the business, removes the creators' Supabase logins (never one that is also an
ERP member), and makes a new join code so a test link shared anywhere stops working. Stock and invoices untouched.
Tests: 7 more in `creatorportal_test.mjs` (59).

## Creator profile per channel (tag accounts-4, 8 Oct 2026)

Owner (screenshot): the profile fields overlapped - channel names, platforms, followers and links asked the same
thing three ways; Facebook profile was missing; filament preference is pointless (he picks filament per request);
too small on a monitor. Now: tick a platform (YouTube, Facebook page, Facebook group, Facebook profile, Instagram,
TikTok) and its own block appears - name, subscribers / followers / members / friends, link (https:// required).
Stored as JSON (`erp_creators.channels`, migration 103); the one-line strings the ERP and the sponsor page show
(handle, platforms, followers, links) are derived from it. Filament field gone from the profile. On a monitor
(>= 900 px) the page is wider (1040 px), type 17 px, channel blocks two abreast; phones unchanged. 60 tests.
