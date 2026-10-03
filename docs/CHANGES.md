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
