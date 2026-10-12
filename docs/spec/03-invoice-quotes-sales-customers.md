# Spec 03 — New Invoice, Sales, Quotations, Customers

Source of truth (read-only): `sheet-erp/ErpUI.html` (UI, "UI:"), `sheet-erp/ERP.js` ("ERP:"), `sheet-erp/Code.js` ("Code:"). Line numbers cite those files. Build stamp `b261002-0449` (UI:9660, ERP:4316).

Scope: nav screens `invoice`, `sales`, `quotes`, `customers` and every server function they reach. Also the floating modals that those screens open (parcel booking, return, cancel, fix, due box, statement, invoice-done, parcel-done) and the Steadfast-money card on Sales.

**Not present in the source (do not build unless asked):** quotation → invoice conversion (no code exists; quotations never touch stock or money, ERP:9104-9122); invoice "void" from these screens (`erpVoidInvoice` exists, ERP:1624, owner-only, called only from Tools — superseded on Sales by Cancel); WhatsApp sharing of an invoice PDF (WhatsApp is only used for due reminders and statements); invoice editing of products/prices/payments (by design only Return / Receive payment / Fix details); Pathao/RedX booking. "packzy" = Steadfast's API host `https://portal.packzy.com/api/v1` (ERP:5927).

---

## 0. Cross-cutting foundations

### 0.1 Transport, auth, roles
- Every browser call goes `srv(name,args,ok,bad)` → serial queue (one call at a time) → `google.script.run.erpCall(token, name, args)` (UI:8060-8140). `erpHello` is the only call outside `erpCall`.
- Token = `{code (localStorage erp_code), device (random id in localStorage erp_device_id), label (UA first 60 chars)}` (UI:8030-8058).
- Client watchdog: 45 s default; per-function overrides `SRV_SLOW` (UI:8003-8021) e.g. `erpCreateInvoice` 240 s, `erpSales` 120 s, `erpBookParcel` 120 s, `erpSfPayouts` 240 s, `erpReturnGoods` 180 s, `erpCancelInvoice` 180 s, `erpFixInvoice` 90 s, `erpInvoicePdf` 90 s, `erpQuoteSave` 120 s, `erpStatementPdf` 120 s, `erpBundle` 120 s, `erpCustomers` 90 s. On timeout: error "The sheet did not answer within N seconds…". "Unknown action" error → red banner "The ERP was updated while this page was open…" (UI:9661-9668); also shown when `bundle.build !== ERP_BUILD`.
- Server `erpCall` (ERP:4285): look up min role in `ERP_ALLOW` (ERP:4177-4246) → authenticate → rank check → run → `erpScrub_` (removes cost/margin/profit/supplier for < shareholder; supplier also hidden for < manager) → errors logged to sheet `ERP_ERRORS` (at, who, role, action, message, build; trimmed to ≤700 rows, ERP:4317-4330).
- Roles & ranks (ERP:3971-3976): sales 1, manager 2, shareholder 3, owner 4. Owner = sheet owner signed in with Google, no code (`implicit:true`). Discount caps % (ERP:3979): owner 100, shareholder 100, manager 10, sales 5. `ME.discountCap` is sent to the client (ERP:4141).
- Nav visibility (UI:9834): `invoice`, `sales`, `quotes`, `customers` have no minimum → visible to all roles (sales included). Home after sign-in: rank ≥3 → dashboard, else `products` (UI:9861).
- Min roles relevant here (ERP_ALLOW): sales — `erpBundle, erpCatalog, erpFormOptions, erpLookupCustomer, erpCreateInvoice, erpCustomers, erpSaveCustomer, erpSales, erpInvoicePdf, erpCustomerStatement, erpStatementPdf, erpDueReminded, erpCustomerAccount, erpCustomerCredit, erpQuoteBoot, erpQuoteList, erpQuoteGet, erpQuoteSave, erpQuoteDuplicate, erpQuoteAsset, erpBrandLogo`; manager — `erpReturnPreview, erpReturnGoods, erpFixInvoice, erpCancelInvoice, erpParcelPreview, erpBookParcel, erpParcelHandled, erpParcelPutBack, erpSfPayouts, erpSfPayoutLines, erpSfConfirmMatches, erpSettleDue, erpPayReasons, erpTakeAdvance, erpQuoteSnippetsSave, erpSaveProduct (quick new product), erpDues, erpRecordPayment`; shareholder — `erpSfReconDecide, erpQuoteSettingsSave, erpQuoteProfileSave, erpQuoteAssetUpload, erpQuoteItemsImport, erpLetterheadSave, erpBrandLogoClear`.
- Note: `erpBundle(['customers','dues'])` is callable by sales and internally runs `erpDues` (manager-only by name) — so sales DO receive the dues map via bundle (ERP:1984, UI:9933).

### 0.2 Multi-business
Each business = its own spreadsheet; `erpBootstrap_` opens the active one (user property `cz_active_business`, or the child sheet id) (ERP:39-75). All tabs below are per business. Switching business clears all client state incl. CART (UI:9896-9910).

### 0.3 Load sequence
- First load `erpBundle(['biz','dash','catalog','lists','options'])` then `erpBundle(['customers','invoices','history','weborders'])` (UI:9912-9927). Each bundle part runs independently; failures come back in `errors{}` and the client shows the error in that panel instead of spinning (UI:9670-9725). Bundle also returns `today` (yyyy-MM-dd in Asia/Dhaka, ERP:3426) → `TODAY_STR`.
- `go(view)`: `customers` → `erpBundle(['customers','dues'])` if CUST or DUES missing; `sales` → `erpSales` if not loaded; `quotes` → `erpQuoteBoot` if not loaded (UI:9453-9496).

### 0.4 Data tabs (sheet → future tables)
| Tab | Columns (0-based index: name) |
|---|---|
| SALES_LOG (one row per invoice line) | 0 order_id, 1 timestamp, 2 customer_name, 3 customer_contact, 4 customer_address, 5 sku, 6 product_name, 7 quantity, 8 unit_price, 9 total (line, after line discount), 10 payment_method, 11 payment_status (Paid/Pending/Partial), 12 delivery_status (always "Processing"), 13 notes, 14 discount (invoice total discount, repeated per row), 15 delivery_charge (repeated), 16 grand_total (repeated), 17 advance_paid (=paid so far, repeated, synced), 18 due_amount (repeated, synced), 19 customer_source (= delivery method) (Code:288-290, 2022-2031) |
| TXN_LOG | txn_id, timestamp, sku, product_name, txn_type (SALE/RETURN/…), direction (IN/OUT), quantity, unit_price, total_value, reference ("Invoice: INV-…"/"Return: INV-…"), supplier (customer name on returns), operator, notes (Code:235) |
| CUSTOMERS | 0 customer_id (CUS-<ms>), 1 customer_name, 2 contact_number (text, 11 digits), 3 email, 4 address, 5 customer_type, 6 total_orders, 7 total_spent, 8 date_added, 9 notes, 10 last_order_date, 11 last_product_bought, 12 customer_source, 13 customer_status (Code:326, 1999-2006) |
| PAYMENTS (ledger, append-only) | payment_id, order_id ('' = account/advance row), customer, timestamp, amount (+ in, − out), method, note (carries tags `[payment] [reduce] [increase] [advance] [acct:KEY] [applied] [return:RTN-…] [sf:CID] [sfadj:CID] [cancel:INV]`), recorded_by (ERP:4881-4883) |
| RETURNS | return_id, returned_at, invoice_no, sku, product, qty, condition (good/damaged), value, money ("due reduced"/"refunded N"/"advance N"), customer, reason, recorded_by (ERP:7138-7140) |
| INVOICE_FIXES | fixed_at, invoice_no, field, was, now, fixed_by (ERP:7624-7625) |
| COURIER_LOG | booked_at, invoice_no, consignment_id, customer, phone, address, cod_amount, invoice_total, booked_by, note (`[by hand]` marks set-aside) (ERP:5928-5930) |
| COURIER_PAYOUTS | payout_id, created_at, paid_at, cod_collected, delivery_charges, cod_fee, paid_to_bank, parcels, synced_at, fields_seen (ERP:8422-8424) |
| COURIER_PAYOUT_LINES | payout_id, consignment_id, tracking_code, cod_amount, status, recipient_name, recipient_phone, parcel_created, invoice_no, match (exact/phone/''), delivery_charge, cod_charge (ERP:8425-8428) |
| COURIER_RECON | consignment_id, payout_id, invoice_no, customer, expected, collected, gap, action (ok/writeoff/review/kept/extra/settled), amount, note, at, by (ERP:8446-8448) |
| DUE_REMINDERS | reminded_at, customer_key, customer, phone, due, by (ERP:9051-9052) |
| QUOTATIONS | id, reference, version, status, title, customer, kind, total, currency, issue_date, created_at, updated_at, created_by, updated_by, save_key, json1..json8 (full document JSON split in 45 000-char chunks) (ERP:9124-9128) |
| QUOTE_SETTINGS | key, value(JSON). Keys: `profile`, `settings`, `letterhead`, `snippets`, `assets` (allowed Drive image ids, last 200), `seq:<PREFIX>` (counter) |
| QUOTE_ITEMS | key, name, description, kind, unit, historical_rate, product_sku, requires_review (yes/no), source, added_at, added_by (ERP:9131-9132) |
| SETTINGS | A..G lists (G = payment_methods: bKash, Bangla QR, Cash, Bank Transfer, COD by default); I/J config key/value: business_name, currency, default_reorder, default_lead_time, n8n_webhook_url, invoice_pdf_folder_id, next_invoice_num (J8 = named range INVOICE_COUNTER, default 1001), payment_qr_file_id (Code:146-186) |
| INVOICE (staging sheet, legacy) | B5 invoice no formula, E5 date, B7 name, E7 phone, B8 address, rows 11..(t-2) items (B sku, C desc formula, D qty, E unit price formula, F line discount, G line total formula), t = row whose F = "Subtotal:" (Code:3228-3239) |

In a rebuild, INVOICE staging disappears; replicate its arithmetic (§1.4).

### 0.5 Shared identity helpers
- **Customer key** (must match client and server): digits of phone; if ≥10 digits → last 10; else `'n:' + lower(trim(name))`. Client `custKey` returns '' for empty; server `erpCustKey_` returns `'n:'` which callers treat as "nobody" (UI:7607-7612, ERP:5155-5159).
- `normalizePhone_`: digits; if >10 keep last 10 (Code:3622-3628). Used by lookup/upsert/erpCustomers.
- `formatBdPhone_`: 10 digits starting 1 → "0"+d; 11 starting 01 → d; 13 starting 8801 → "0"+d[3:]; 12 starting 881 → "0"+d[2:]; else unchanged (Code:3739-3752).
- `erpPhone11_`: blank allowed; else formatBdPhone_ must match `^01[3-9]\d{8}$`, otherwise throws "The phone number must be 11 digits starting with 01 - "…" has N. Correct it, or leave it empty." (ERP:10818-10827). Used on invoice create (non-web), customer save, fix invoice.
- Client `phoneClean` on every `input[data-bdphone]` keystroke: strip non-digits; leading 8801 → drop "88"; starts with 1[3-9] and not 01 → prefix 0; truncate 11. Red border if invalid (UI:1548-1574). `phoneProblem`: blank OK; must match `^01[3-9]\d{8}$` else "Phone must be 11 digits starting with 01 — this one has N."
- `hasMobile(p)`: 13 digits starting 880 → last 10 …; true if 11 digits starting 01, or 10 starting 1 (UI:6187-6193). Used for "walk-in" classification.
- `waLink(phone,text)`: digits; <10 → no link; 11 starting 0 → "88"+p; 10 → "880"+p; `https://wa.me/<p>?text=<urlencoded>` (UI:7476-7482).
- Money display `fmt`: rounded, en-US thousands separators (UI:630). Currency label from `OPT.currency` = "BDT".

### 0.6 "What does an invoice owe" (used everywhere — must be identical)
For invoice id X (SALES_LOG rows with order_id = X):
- `grand = max(grand_total col16)`, `onSheet = max(advance_paid col17)`, `settled = any row status col11 == 'paid'` (case-insensitive).
- `ledger = Σ PAYMENTS.amount where order_id = X` (`erpPaidByOrder_`, ERP:4898).
- `paid = max(ledger, onSheet)`; if settled → paid = max(paid, grand) (erpOutstanding_, ERP:6071-6095). `owed = max(0, round2(grand − paid))`.
- Dues (`erpDues`, ERP:5004-5099) same but: `due = settled ? 0 : round2(grand − max(Σledger over grouped ids, onSheet))`; skip if ≤ 0.5. Legacy split orders: ids matching `^ORD-\d+$` with same customer|phone|grand within 5 minutes of the group's first id are one order (`erpSameOrder_`, ERP:5508-5532); due is carried only by the group head.
- `erpSyncInvoiceStatus_(id)` (ERP:4967-4996) after every money write: writes col17 = ledger sum, col18 = max(0, grand − ledger), col11 = Paid if due ≤0.5, Partial if ledger>0, else Pending. (Note: uses ledger only, not max with onSheet.)

---

## 1. Screen `invoice` — New invoice

Nav label "New invoice", badge `#cCart` = number of cart lines (blank when 0) (UI:505, 9441-9451).

### 1.1 Client state
`FORM = {payMode:'full', paidNow:0, phone:'', name:'', address:'', source:'', touched:false, method:'', status:'', delivery:0, advance:0, date:'', invDisc, delTouched, delAuto, zone, zoneEdit}` (UI:551-554). `CART = [{sku,name,price,qty,discEach,stock,cat}]`. `ACCT` = customer account (only kept when balance>0). On options load: `FORM.source = OPT.sources[0]` ("Customer pickup"), `FORM.method = OPT.paymentMethods[0]`, `FORM.status = OPT.paymentStatuses[0]` (UI:9683-9690). Cart survives navigation between screens (in memory only; lost on reload).

### 1.2 Layout (top to bottom) — `viewInvoice` UI:1654-1774
Loading state: "Loading invoice form…" until CAT and OPT exist.

**A. Account notes (acctPanel, UI:1619-1652)** — only if ACCT set:
- If `ACCT.credit > 0`: green note "✓ <customer> has BDT <credit> in advance with you — it will come off this invoice automatically." + if balance>0 "They also owe BDT <balance> on older invoices, which this advance does **not** touch."
  - Bug/caveat: `loadAccount` sets ACCT only when `balance > 0` (UI:1601), so a credit-only customer never sees this note.
- If balance>0: orange note "▲ <customer> already owes BDT <balance> from <count> invoice(s), oldest <invoices[0].days> days. This is not added to the invoice below — it is what they owe from before." + button **Take payment** (`#acct_take`).

**B. Card "Customer"** — sub "Type a phone number to pull an existing customer's name and address."
Fields grid:
1. Phone `#cphone` (tel, numeric, placeholder `01XXXXXXXXX`, label "Phone · 11 digits", auto-cleaned).
2. Name * `#cname` (text, placeholder "Customer name").
3. Delivery `#csource` (select, options `OPT.sources` = `ERP_DELIVERY` = Customer pickup, Steadfast courier, Pathao Instant, Uber Instant, Costareen Delivery — ERP:6469-6470, 796).
4. Date `#cdate` (date, default `FORM.date || TODAY_STR`, `max=TODAY_STR`).
5. Address `#caddr` full-width (placeholder "House, road, area — enough for a rider") + `#addrHint` (only when delivery is Steadfast: `addrHintHtml`).
6. `#custHint` area for lookup messages.

**C. Card "Add products"** — sub "Search the catalogue and click a product to put it on the invoice."; button **+ New product** (`#newProductInv`, opens inline quick product form `quickStart('invoice','')`). Search `#isearch` placeholder "Search by name, SKU or brand"; results `#iresults`; inline product form when `PRODUCT_FORM.returnTo==='invoice'` (UI:7928-7939).

**D. Card "Invoice lines"** — sub "Unit price comes from the product list. **Disc. per pc** is taken off every piece of that line; a discount on the whole invoice goes in the box below."
- Empty: "No products yet. Add one above, or from the Products tab."
- Table columns: **Product** (name, then small "SKU · N in stock"; red pill "✕ Over stock" if qty>stock) | **Price** (fmt price) | **Qty** (number input min 1 step 1) | **Disc. per pc** (number min 0 step 1; when >0 shows "<price−disc> each · −<qty*disc>") | **Line total** = max(0, qty×(price−discEach)) | button **Remove** (danger).
- Below, left column fields: **Invoice discount** `#finvdisc` ("off the whole invoice", number min 0), **Delivery charge** `#fdel` (number min 0), delivery-suggestion block (§1.5), **How was this paid?** chips: "Paid in full now" (full), "Due" (none), "Part paid" (part); if part → **Received now** `#fpaid`; **Payment method** `#fmethod` (select OPT.paymentMethods).
- Right column totals box:
  - Subtotal = Σ qty×price
  - Discount = "− itemDisc+invDisc" (or 0); if both item and invoice discounts present, an extra line "per piece X + invoice Y" and "%" (1 decimal)
  - Delivery
  - **Grand total** "BDT N" = sub − disc + delivery
  - Paid now = full → grand; part → min(paidNow, grand); none → 0
  - **This invoice due** = max(0, grand − paidNow)
  - If prior balance (ACCT.balance) > 0: "Previous balance" and **Total they owe** = prior + thisDue (never added into grand total — UI:1753-1754).
- Problems box (red) listing `cartProblems()` lines.
- Buttons right-aligned: **Clear** (`#clearInv`) and primary **Save invoice & make PDF** (`#saveInv`, disabled + "Saving…" while SAVING).

### 1.3 Behaviour (`wireInvoice` UI:1776-1969)
- Text fields bind on input; numeric ones repaint on change.
- Address typing (until the user touched the Delivery select, `FORM.touched`): non-empty address → select "Steadfast courier"; empty → "Customer pickup". Address hint redraws live. Leaving address box repaints (zone/charge may change). Changing Delivery sets `touched=true` and repaints.
- Date change: if equals today → `FORM.date=''` (server keeps =TODAY()). Future date → reset to today + toast "An invoice cannot be dated in the future."
- Pay mode chip: sets payMode; non-part resets paidNow=0.
- Name blur → repaint (clears "name required").
- **Phone blur** (UI:1886-1918): if invalid → repaint to show the problem (no lookup). Else hint "Looking up…", `loadAccount(phone, name)` (→ `erpCustomerAccount`, needs ≥10 digits or a name, UI:1597-1604) and `erpLookupCustomer(phone)`:
  - null → "New customer — they will be created on save." (ACCT cleared)
  - found → overwrite FORM.name, FORM.address, FORM.phone (formatted) — delivery is NOT copied ("how THIS order goes out is decided now"); repaint; loadAccount again; green note "Existing customer — **Name**, N previous order(s), N spent."
  - error → red note with message.
- **Product search** (`paintResults`, UI:1972-1997): empty query → "Start typing to find a product."; filter CAT excluding status `discontinued`, substring match on `name sku brand color` lowercase, max 40. Row: name; "SKU · brand · N in stock"; right: sell price bold or "no price", plus stock badge (`stateBadge`: out "✕ Out of stock", low "▲ Reorder", ok "✓ In stock"). Rows with stock ≤0 or sell ≤0 are greyed (`dis`) and not clickable. Last row always "+ Create new product “<query>”" / "Not in the product list yet" → `quickStart('invoice', query)`.
- `addToCart(sku)`: if already in cart, qty+1; else push `{price: p.sell, qty:1, discEach:0, stock:p.stock, cat:p.cat}` (UI:2008-2017).
- Qty change → `max(1, round(value))`; disc change → `max(0, value)`; Remove splices.
- Clear: empties cart and resets delivery, advance, invDisc, delTouched, delAuto, zone, zoneEdit (customer fields are NOT cleared) (UI:1953-1958).
- Save button also arms `SAVE_WANTED` on pointerdown so a repaint between press and release still saves (UI:1960-1970).
- **Take payment** (acct_take): `window.prompt("How much did <c> pay?\n\nThey owe X. It clears their oldest invoices first.", X)`; >0 → `erpSettleDue({phone,name,amount,reason:'payment',method:FORM.method||'Cash'})` → toast "Recorded. N still owed." / "Settled in full." and reload account. (Manager+ only on server; sales sees an error toast.)

### 1.4 Validation — client `cartProblems` (UI:1576-1593)
1. "Customer name is required."
2. phone problem (if any)
3. "Add at least one product."
4. per line: qty ≤0 → "<name>: quantity must be at least 1."; qty>stock → "<name>: only N in stock, M requested."; discEach>price → "<name>: discount per piece is larger than the price."
5. invDisc > sub − itemDisc → "Invoice discount is larger than the goods."
6. cap = ME.discountCap (default 100); if cap<100 and (itemDisc+invDisc) > sub×cap/100 + 0.5 → "Discount is P% of the goods. Your limit is C% — ask a manager or the owner."

Totals `cartTotals` (UI:1532-1542): `sub=Σqty·price; itemDisc=Σqty·discEach; invDisc=max(0,round(FORM.invDisc)); grand=sub−(itemDisc+invDisc)+delivery; due=grand−advance`.

Save (`saveInvoice`, UI:2019-2073): problems → toast; else `confirm("Save this invoice?\n\n<name>\nN product line(s), U unit(s)\nGrand total: BDT G[\nDue: BDT D]\n\nStock will be deducted and a PDF saved to Drive.")`. Note: the "Due" line uses `t.due = grand − FORM.advance` (advance always 0) — so it shows the full grand total as due whenever grand>0, regardless of pay mode (cosmetic bug).
Payload to `erpCreateInvoice`:
```
{ customer:{name,phone,address,source}, items:[{sku,qty,discEach}],
  invoiceDiscount: round(invDisc), deliveryCharge, payMode:'full'|'none'|'part',
  paidNow, advancePaid: FORM.advance (0), paymentMethod, paymentStatus: FORM.status, date: FORM.date||'' }
```
On success: reset CART, ACCT, FORM (keeps method/status; source back to sources[0]; date blank), clear search, show `invoiceDone` modal, mark D/ORDERS/HIST/PLAN/DUES stale, refetch `erpBundle(['catalog'])`. On failure toast "Could not save: …" (12 s), form kept.

### 1.5 Delivery-charge suggestion (Steadfast only) — UI:1357-1530
Constants: spool weight 1.3 kg, extra kg 20 BDT; zones: city "Inside Dhaka city" first kg 55; district "Dhaka suburbs, Gazipur, Narayanganj" 105; outside "Outside Dhaka" 135.
- Only when delivery matches /steadfast/i (`isCourier`).
- No cart → "Add the products and the charge is worked out."
- Any line whose category is not /filament/i → "This order is not only filament, so its weight is not known. Type the delivery charge yourself."
- Zone = FORM.zone (manual) or detected from address (`delZoneFind`): normalise address (lowercase, non-alnum/non-Bangla → space, gonj/gonj/gunj→ganj, mohammadpur variants, cox's bazar→coxsbazar); order of precedence: OUTSIDE names (≈110 district/town names; a match followed by road|rd|highway|lane|house|tower|market|hotel|… is ignored), Bangla outside names, DISTRICT names (savar, ashulia, gazipur, tongi, narayanganj, …), Bangla district, CITY names (≈200 Dhaka areas/universities), Bangla city, then " dhaka " → city. Full lists UI:1383-1415.
- No zone → select "Going to" (— choose — / 3 zones) and note "The address does not say where this is going. Choose it once and the charge is worked out."
- Charge: `kg = round2(spools×1.3); bill = max(1, ceil(kg)); amount = first + (bill−1)×20`. Note "N spools × 1.3 kg = X kg, billed as B kg · <zone label>".
- Display: if zone was read from address and not edited: "Going to [pill zone] read from the address (“word”) [Change]"; else a zone select. Then "Suggested **N** — note." plus button "Use N" if the user typed a different figure.
- Auto-fill rules (`delApply`): if user typed in Delivery charge (`delTouched`) never overwrite; else set FORM.delivery = suggestion (`delAuto=true`); if suggestion disappears and value was auto → reset to 0.

### 1.6 Address warning (Steadfast only) — UI:6345-6363
`addressWeak`: empty → "There is no address on this invoice."; length<12 → `Only "<a>" — a rider is unlikely to find that. Add the road, house or area.`; no place word (regex `ADDR_PLACES` list) and no digit → "No road, house or area name in this address — check the rider can find it." Shown as a yellow pill.

### 1.7 Server: `erpCreateInvoice(payload)` — ERP:841-1066 (+ Code `submitInvoiceCore_` 1077-1249)
Lock: script lock tryLock 15 s → "Another sale is saving right now. Try again in a moment."
1. Require name ("Customer name is required."), ≥1 item with sku & qty>0 ("Add at least one product.").
2. `healInvoiceLayout_()` (re-create formulas/labels, Code:2708-2802); `erpSetInvoiceDate_(inv, date)` (ERP:3399-3423): blank → E5 `=TODAY()`; must be `yyyy-mm-dd` ("The date must look like 2026-09-27."), real date ("That is not a real date: …"), not future ("An invoice cannot be dated in the future."), not >3650 days back ("That date is more than ten years ago - check it.").
3. Capacity = item rows on the INVOICE sheet (25 default) → "This invoice holds N lines; you added M."
4. Stock check against `erpCatalog()` (STOCK_VIEW current_stock col 8), aggregating duplicate SKUs: unknown → "Unknown product: SKU"; "Not enough stock for <name>: S in stock, Q requested."
5. Discounts `erpInvoiceDiscounts_` (ERP:10775-10809): per line `own = discEach>0 ? discEach×qty : item.discount` (whole-line discount used by web orders); own > gross → "<name>: the discount is larger than the price."; invoice discount `inv=round(max(0,invoiceDiscount))`, > Σnet → "The invoice discount is larger than the goods."; invoice discount is **distributed across lines in whole taka** proportionally to each line's net (floor), remainder taka handed one by one to biggest lines (never exceeding the line's net); final line discount = own + share. Gross uses catalog `sell`.
6. Discount cap (skipped for website entry): `(itemDisc+invDisc) > sub×cap/100 + 0.5` → "This discount is P% of the goods. Your limit is C% - ask a manager or the owner to save this sale."
7. Stage: B7 name; E7 phone = `erpPhone11_` (web: formatBdPhone_); B8 address; clear & write B sku, D qty, F line discount (blank if 0).
8. Totals block (t = totalStartRow): t+2 delivery charge; t+3 "advance paid" = payMode part → paidNow, none → 0, full → later, legacy → advancePaid; t+6 payment method (default Cash); t+7 status: full→Paid, part→Partial, none→Pending, legacy→paymentStatus; J(t+8) delivery source (default 'Walk-in'). Flush, sleep 400 ms. For full: t+3 = grand total read back from G(t+4).
   Sheet formulas: line total G = qty×unit − lineDisc; Subtotal G(t) = SUMPRODUCT(qty, unit) (gross); Discount G(t+1) = SUM(F); Grand G(t+4) = sub − disc + delivery; Due G(t+5) = grand − advance (Code:2738-2741).
   Unit price on sheet = PRODUCT_MASTER col J (sell_price) via VLOOKUP; description = name, or "name - colour" if colour not already in name (Code:2775-2776). (Catalog price shown on screen comes from STOCK_VIEW sell_price, fallback PRODUCT_MASTER sell — normally identical.)
9. `priorBalance = erpCustomerAccount({phone,name}).balance` read before submit.
10. Note text: `payload.note` or "Invoice submission"; if invDisc>0 append ` [discount: items X + invoice Y]` (used later to re-split discounts on the PDF).
11. `submitInvoiceCore_(true, note)` (Code:1077-1249):
    - Invoice number `freshInvoiceNo_` (Code:1062-1075): read B5 display value = `"INV-"&TEXT(NOW(),"YYYYMMDD")&"-"&TEXT(INVOICE_COUNTER,"000")` (Code:2720); if already used in SALES_LOG col A, bump counter (+1, up to 50 tries) — else "Invoice number X is already used and a free one could not be found…". **Format: `INV-YYYYMMDD-NNNN`** where date = today (save date, even if backdated) and NNN(N) = global counter (min 3 digits, never resets; default start 1001).
    - Customer name required ("Customer Name is required."); timestamp = E5 date with current time (typo guard: >1 day ahead or >3650 days back → now) (Code:1482-1494).
    - Per item row: sku must exist in STOCK_VIEW ("Product "X" not found in inventory."), stock ≥ qty ("Insufficient Stock for SKU: Only N available."); sellPrice = E (fallback STOCK_VIEW sell); lineTotal = G or max(0, qty×price − lineDisc).
    - Appends TXN_LOG rows `[TXN-yyyyMMdd-####, ts, sku, name, 'SALE','OUT', qty, price, lineTotal, 'Invoice: '+no, '', operatorEmail, '']`.
    - Appends SALES_LOG rows (one per line) with order_id = invoice no, payment_status as staged, delivery_status 'Processing', notes, discount (= total discount G(t+1)), delivery_charge, grand_total, advance_paid, due_amount, customer_source.
    - `upsertCustomer_(name, contact, address, grandTotal, productNames joined ", ", source)` (Code:2148-2232): match by last-10-digit phone, else by lowercase name when no phone. New: id `CUS-<ms>`, type Retail, orders 1, spent = grand, date_added/last_order_date now, notes "Auto-created from invoice", status VIP if spent ≥50 000 else New. Existing: overwrite name/phone/address/source, orders+1, spent+=grand, last order date/product, status VIP if spent ≥50 000 or orders ≥5 else Returning.
    - Plain PDF `saveInvoicePdfSilently_` (Code:2234-2280): exports INVOICE A1:G(t+9) as A4 portrait fit-to-page, unused item rows hidden temporarily; file `Invoice_<no>.pdf` into folder SETTINGS `invoice_pdf_folder_id` (creates "Costareen_Invoices" / "Costareen_Invoices_Fixed" if missing/broken and writes the id back).
    - `refreshStockView()`; counter +1; `resetInvoice()` (clears customer/items, delivery 0, advance 0, method Cash, status Pending, source Customer pickup, E5 =TODAY()).
12. Payment ledger: took = full→grand, part→paidNow, none→0, legacy Paid→grand else advancePaid. If took>0 append PAYMENTS `[P<yyMMddHHmmss>, no, name, now, min(took,grand), method, took≥grand ? 'paid in full at the till' : 'advance', who]`, then `erpSyncInvoiceStatus_`. (Note: a part payment > grand is capped in the ledger but `took` uncapped in thisDue math.)
13. Credit: key = custKey; owing = max(0, grand − took); if >0 and key valid → `erpApplyCredit_` (ERP:5383-5396) uses min(credit, owing): two PAYMENTS rows `C<stamp>` (+use, order=no, method 'Advance', note 'advance used [applied]') and `C<stamp>-r` (−use, order '', note `applied to <no> [acct:KEY]`); sync status.
14. thisDue = max(0, round2(grand − took − creditUsed)).
15. Designed PDF `erpInvoiceDocPdf_(no, {})` (§1.9); on success trash the plain PDF and return the designed one.
Returns `{ok, invoiceNo, pdfUrl, items, grandTotal, paidNow, creditUsed, pdfId, pdfName, source, thisDue, priorBalance, totalOwed}`.

### 1.8 Invoice-done modal (`invoiceDone`, UI:7286-7331)
Fixed overlay, no auto-close: big ✓, "Invoice INV-…", "BDT grand · **N still due**" or "· paid", "A copy is already saved in Drive. This stays open until you close it." Buttons: **Save to this computer** (`https://drive.google.com/uc?export=download&id=<pdfId>`), **Open PDF** (pdfUrl), **Send parcel** (only if source is Steadfast → closes and opens parcel box §2.6), **Next invoice** (close).

### 1.9 Invoice PDF (designed) — ERP:11098-11502
Data `erpInvoiceDocData_(no)` (ERP:11119-11154) from SALES_LOG: head (customer, phone, address, date, method, source); lines (sku, product, qty, price (fallback total/qty), total, gross=qty×price); disc=max col14, delivery=max col15, grand=max col16, note.
- `inside = max(0, gross−sum)`; `totalDisc = inside + erpDiscLeft_(disc,gross,sum)` (discount not already inside line totals; ERP:10759-10763). Split into itemDisc/invDisc using note tag `[discount: items X + invoice Y]` if it sums within 1. If grand missing → gross − totalDisc + delivery; delivery inferred if missing. `perLine` (show per-line discount column) only if totalDisc>0.5 and invDisc=0 and inside>0.5. Paid/due from `erpOutstanding_`.
- Business identity from quotation profile `erpQProfile_` (name, address, phone, email, website, footer, banks, logoId/logoTrimId, qrId) and look from quotation settings (accent default #dda51c, dark #303030, currency).

**Designed version (preferred)** `erpInvoiceArtParts_` (ERP:11300-11431), rendered by an external headless-browser service `https://mcp.bendar.duckdns.org/render` (`/pair` once to share a secret stored in script property ERP_RENDER_KEY, then `/pdf` with header X-Render-Key, body `{html, footer}`; reject non-PDF or <2000 bytes) (ERP:11433-11467):
- A4, margins 13mm top (0 on first page) / 31 mm bottom (repeated footer), font Inter/Noto Sans Bengali/Arial 10.5pt.
- Top band 43 mm: SVG "sweep" of 5 layered accent tints (accent at 0/35/62/84/93 % toward white); logo (27 mm tall at 16 mm,8 mm); "INVOICE" 38pt light; business name bold in dark colour; right top: "BDT <due>" + "Total due" — or "BDT <grand>" + "Paid in full" when nothing due (text white if accent is dark, else dark).
- Two-column block: left key/values Invoice no., Date (d MMMM yyyy), Payment (method), Delivery (source); right "From" business name + address; red stamp "CORRECTED COPY · d MMM yyyy" when corrected.
- "Bill To" customer (or "Walk-in customer") + phone; right "Deliver To" address if any.
- Items table: # | Item Description | Qty | Price | [Discount if perLine: −off] | Total (line total if perLine else gross). Header repeats on page break; rows don't split.
- Bottom: left "Payment Details" up to 3 bank cards (bank name, A/C name, A/C number, Branch, Note) + Bangla QR image 25 mm with caption "Bangla QR / any bank app, bKash, Nagad or Rocket"; right summary table: Subtotal (gross); if invDisc: "Item discounts −" (if any) + "Invoice discount −", else "Discount −" if any; Delivery if any; **Total BDT grand** (dark/tint row); Paid; Due — red "BDT due" or green "Nothing due".
- Note line: profile footer or "Thank you for your order."
- Page footer (every page, 31 mm): wave in tint/dark with white icons: phone (first 2 numbers split on , or /), globe (email, website), pin (address line 1, rest).
- Saved as `Invoice_<no>.pdf` (corrected: `Invoice_<no>_corrected_yyMMdd-HHmm.pdf`) in invoice folder, Drive description "designed 2".

**Plain fallback** `erpInvoiceDocHtml_` (ERP:11157-11255), HTML→PDF via Drive converter: 7 px accent bar; logo 84 px; business name 23 px dark; address/contact/website; right "INVOICE", number (gold #8a691b), "Date: …", optional red "Corrected copy · date"; divider; "BILLED TO" name/phone/address; right "Payment: method", "Delivery: source"; items table (#, ITEM+sku, QTY, PRICE, [DISCOUNT], AMOUNT) with dark header; totals (Subtotal, discount rows, Delivery, accent rule, **Total BDT**, Paid, **Due** red if >0); "PAYMENT DETAILS" bank cells (gold border) + Bangla QR 118 px "Scan with any bank app, bKash, Nagad or Rocket"; footer line. If an image breaks conversion, retried with `noImages`. WebP images converted to PNG for this path.
- Images only served if their Drive id is in QUOTE_SETTINGS `assets` (per-business allow list) (ERP:11103-11116).
- Legacy QR: the old sheet invoice used SETTINGS `payment_qr_file_id` (Costareen-only hard-coded fallback ids; never another business's QR) (Code:3472-3506). Hard-coded old bank block text BRAC Bank / A/C 2080773020001 etc. exists only on the legacy sheet layout (Code:3441-3451).

### 1.10 Quick new product from invoice
Inline product form (spec 02). Saving with `returnTo:'invoice'` calls `attachNewProduct` → `erpCatalog` → `addToCart(sku)` (UI:5246-5265). Caveat: a new product has 0 stock, so the line immediately shows "Over stock"; `erpSaveProduct` needs manager role, so sales cannot use this.

### 1.11 Role differences on this screen
Same UI for everyone. Discount cap enforced client + server (sales 5 %, manager 10 %). "Take payment" works only for manager+. Quick new product manager+.

---

## 2. Screen `sales` — Sales (every invoice)

Nav label "Sales"; badge `#cSend` = number of invoices waiting to be sent by Steadfast (`SALES.waiting`, fallback count of ORDERS.postable) (UI:6371-6378).

### 2.1 Layout — `viewSales` UI:4507-4574
Order on screen:
1. **Waiting for Steadfast** card (only if `SALES.toSend` non-empty; thick orange border) (UI:4585-4608): title + pill count; sub "These orders go by courier and have not been entered with Steadfast yet. Oldest first. Once sent, an order leaves this box and stays in the list below." Table: Invoice | Date | Customer (+phone) | Address (or red pill "no address") | Rider collects ("BDT N" bold, or "nothing — paid") | buttons **Send parcel** (primary) + **Already handled**. Not affected by search/filter.
2. **Sales** card: sub "Every invoice. Click the invoice number to open its PDF." Search input `#sl_q` placeholder "Invoice number, name or phone" + **Search** button (Enter also searches). Filter chips: All, Sent by courier, With a due, With returns (`all|sent|due|returned`; server also supports `tosend`).
   - Error: "Could not read the sales." + message. Loading: "Reading the sales…".
   - Summary line: "N invoice(s) · sold BDT X[ · returned Y][ · **Z due**][ · showing the newest S — search to find older ones]".
   - Empty: "No invoice matches."
   - Table columns: **Invoice** (button = invoice id; opens PDF) | **Date** (d MMM yyyy) | **Customer** (name or —, phone small) | **Units** | **Total** | **Returned** (pill "all back" or "q of units back" + "− value", else —) | **Net** bold | **Due** (red pill amount, or green pill "paid") | **Delivery** (method or —, then parcel cell) | actions.
   - Parcel cell (`salesParcelHtml` UI:4611-4622): consignment → green pill "✓ Sent[ by website]" + big copyable consignment number with caption "write on the parcel" (click copies); set aside → pill "Set aside" + **Put back** if by hand; website order with no number → "website books it · no parcel number yet"; postable → orange pill "waiting to be sent ↑".
   - Actions cell (mgr = manager/shareholder/owner): cancelled → red pill "Cancelled"; else for mgr: all returned → disabled "All returned", else **Return** + (**Cancel sale** only if nothing returned and no consignment). Then if due: **Receive payment** (mgr and has phone) else green pill "✓ Paid". Then **Fix details** (mgr, not cancelled).
3. **Steadfast money** card (manager+ only) §2.9.

### 2.2 Server `erpSales({q, filter, limit:100})` — ERP:7485-7608
- limit clamp 20..300 (default 100). Aggregate SALES_LOG by order_id excluding `RTN-` ids: first row gives date (d MMM yyyy), customer, phone, method (col10), delivery (col19), address, note (col13); sum units/lines/line totals; grand = max col16; onSheet = max col17; settled if any status Paid.
- Group legacy split ORD ids; `got = max(Σledger over group, group.onSheet)`; `due = (settled or not group head) ? 0 : max(0, round2(grand − got))`; grand falls back to Σ line totals.
- Parcels: `booked = erpSfBooked_()` (COURIER_LOG by invoice). `fromSite = note starts WEB-`. **Postable** = not booked AND not fromSite AND delivery /steadfast/i AND timestamp ≥ 30 Sep 2026 (`ERP_PARCEL_FROM`, ERP:6301). Postable invoices always go to `toSend` (with collect = due) regardless of search/filter; `waiting` count.
- Search: substring of `id customer phone` lowercased. Filters: due → due>0.5; returned → has RETURNS; tosend → postable; sent → booked or fromSite.
- Totals over matched rows: sold Σgrand, returned Σreturn value, due Σdue. Rows (≤ limit): `{id,date,customer,phone,units,total,returned,returnedQty,net (0 if cancelled else total−returned),due,delivery,method,allBack (returnedQty ≥ units>0),cancelled (any RETURNS reason starts "Invoice cancelled"),address,consignment,handled,byHand,canSend,courier,fromSite}`.
- Website-order consignment numbers fetched from the website API `czFetch_('GET','/cod?days=45&limit=200')`, cached 10 min (ERP:4255-4274), matched via `WEB-<orderNo>` in notes.
- Sorted newest first; toSend reversed to oldest first.

### 2.3 Open PDF (`erpInvoicePdf`) — ERP:7437-7478, UI:4792-4810
Toast "Finding the PDF for X…". Server searches invoice folder for newest file whose title contains `Invoice_<no>` (incl. corrected copies) and return notes `Return_*<no>*`. If none → generate designed PDF now (`made:true`); if folder missing → "No invoice folder is set up for this business.". If the found file's description ≠ "designed 2" (old plain PDF) → regenerate designed (keeps corrected flag) and trash the old; if regeneration yields only a plain one, trash that and keep the original. Client toast (30 s) with links "**Open <name>**" · each return note; none → error "No PDF was saved for this invoice.".

### 2.4 Return goods — modal (UI:4834-5034) / `erpReturnPreview` + `erpReturnGoods` (ERP:7216-7382)
Preview: refuses `RTN-` ids ("That is a return, not a sale."), unknown invoice. Lines from `erpInvoiceLines_` (ERP:7177-7213): per SKU aggregate qty and total; invoice discount not already inside lines (`erpDiscLeft_`) shared by line value → `unit = (lineTotal − share)/qty` (effective price paid). Returns `{customer, phone, lines:[{sku,product,sold,returned,left,unit}], grand, paid, owed, returnedValue, canRefund (shareholder+), hasAccount (customer key valid)}`.
Modal "Return against INV-…": loading "Reading the invoice…"; sub "<customer|Walk-in> · phone · invoice BDT grand · paid P · **owes O**. The invoice itself is not changed; the return is recorded beside it." Table: Product(+sku) | Sold | Already back (—) | Coming back now (number 0..left, "of N"; or "all returned") | Condition select ("Good — back to stock" / "Damaged — not restocked") | Each (unit). Totals: "Value of what is coming back BDT v"; "Comes off what is owed − offDue" (offDue=min(value, owed)); "Already paid by the customer excess" (excess = value − offDue, shown if >0.5). If excess>0.5: chips "Keep as advance for the next order" (disabled if no account) / "Refund it now" (disabled unless shareholder+) with explanatory subs; refund → "Refunded by" method select. Reason input "Why did it come back?" (placeholder "Wrong colour, faulty, customer refused the parcel…"). Buttons Close / **Record the return** (disabled until units>0).
Client validation: units>0 ("Enter how many came back."), reason ("Say why it came back."), money choice when excess>0.5. Payload `{invoiceNo, lines:[{sku,qty,condition}], money: excess>0.5 ? choice : 'due', method, reason}`.
Server (lock 20 s unless inside cancel; manager+): reason required; each qty ≤ left ("Only N of P can still come back on INV (S sold, R already returned)."); unknown sku "X is not on invoice". worth = round2(unit×qty). offDue/excess as above; excess>0.5 requires refund|advance; refund needs shareholder+ ("Only the owner or a shareholder can hand money back…"); advance needs customer key ("An advance needs a customer name or phone…"). Return id `RTN-yyMMddHHmmss`. Writes:
1. RETURNS rows per line (money word "due reduced" / "refunded X" / "advance X").
2. TXN_LOG RETURN IN rows for good items only (unit price 0, reference "Return: INV", supplier col = customer, notes "RTN-… - reason").
3. SALES_LOG negative rows: order_id RTN-…, product "+ (returned)"/"(returned damaged)", qty −q for good, 0 for damaged; unit; total −worth; method; status Paid; notes "return of INV - reason"; zeros for discount/delivery/grand/advance/due; source.
4. PAYMENTS: `R<stamp>` +value method "Returned" note "goods returned [return:RTN]" on the invoice; refund → `R<stamp>-o` −excess with chosen method "refund paid out"; advance → `R<stamp>-m` −excess "Advance" "moved to advance" + `R<stamp>-a` +excess on account (order '') "from return of INV [advance] [acct:KEY]".
5. Sync status; refresh stock view if restocked.
6. Return note PDF `Return_<RTN>_<INV>.pdf` (HTML→PDF; business = spreadsheet name; table Product/Qty/Condition/Value; total; "Taken off what was owed"/"Refunded…"/"Kept as advance…") (ERP:7404-7434).
Done modal "Return recorded": RTN id · against INV; units & value; restocked; damaged count; "N taken off what was owed"; bold "Hand back BDT X to the customer"; "N kept as advance for the next order"; buttons "Open the return note", Done (UI:5007-5034). Then refetch catalog, reload sales.

### 2.5 Cancel sale — modal (UI:4636-4710) / `erpCancelInvoice` (ERP:7723-7817)
Shown only for mgr, not cancelled, nothing returned, no consignment. Modal "Cancel INV": "<customer|Walk-in>. Everything on it comes back into stock, the delivery charge is dropped, and the sale stays on the list marked cancelled. Nothing is deleted." Fields: The goods (Back on the shelf / Damaged — write off); Why (required, placeholder "Customer changed their mind, entered by mistake…"). If paid>0.5 (paid = total − due from the row): chips Keep as advance / Refund it now (disabled unless owner/shareholder; note "Only the owner or a shareholder can hand money back."); refund → "Refunded by" method. Buttons "Keep the sale" / red "Cancel the sale".
Server (manager+, lock 20 s): reason required; refuses if any return exists ("…already has goods returned against it. Return the rest with the Return button instead of cancelling.") or a Steadfast consignment exists ("A parcel (CID) is already booked… Cancel it with Steadfast first; when it comes back, take it in with Return."). goods = Σ unit×qty; delivery = max(0, grand − goods); paid from erpOutstanding_. paid>0.5 → needs refund|advance (+ role/ key checks as return). Calls `erpReturnGoods` for all lines (condition all good or all damaged, money = paid > delivery+0.5 ? choice : 'due', reason "Invoice cancelled - <reason>"). Then delivery: PAYMENTS `X<stamp>` +delivery "Adjusted" "delivery charge cancelled [cancel:INV]"; back2 = min(paid, delivery); refund → `X-o` −back2; else `X-m` −back2 Advance + `X-a` +back2 on account. Sync. Returns `{returnId, units, restocked, goods, delivery, paid, refund, advance, pdfUrl}`. Toast "**INV cancelled.** N unit(s) back in stock|, written off · **hand back BDT X** · Y kept as advance · return note" (20 s).
Cancelled detection afterwards: RETURNS reason starting "Invoice cancelled".

### 2.6 Parcel booking (Steadfast) — `parcelBox` UI:6380-6534, ERP:6098-6208
Opened from Waiting box "Send parcel" or invoice-done "Send parcel". Modal "Send parcel · INV": loading "Reading the invoice…"; error note + Close.
Preview `erpParcelPreview` returns `{customer, phone, address, total (grand), received (paid), collect (owed), missing[] ('customer name', 'phone number' if <10 digits, 'address'), ready, alreadyBooked (CID), hasKeys}`.
Form: Deliver to (name), Phone, Address (editable one-off override; sub "Change these for a one-off delivery — the parcel goes where this says, and the customer's saved address is left alone."). KPIs: "The rider collects BDT collect" (cash on delivery / nothing — already paid); "Invoice BDT total · received already received". Warnings: no keys ("This business has no courier keys yet. Settings → Courier."), already booked, weak address, missing fields (red). Buttons **Send to Steadfast** (disabled if no keys or already booked) / Cancel.
`erpBookParcel({invoiceNo, expect: collect, name, phone, address})` (manager+): rejects already booked ("…Booking it again would send two."), missing fields, amount drift >0.5 ("The amount changed while you were looking: this parcel would collect X, not Y. Open it again."), empty name/address, phone <10 digits. Phone sent as "0"+last 10 digits. POST `/create_order` with headers `api-key`, `secret-key` (keys per business in script properties `ERP_SF_KEY::<sheetId>`, `ERP_SF_SECRET::<sheetId>`) body `{invoice, recipient_name, recipient_phone, recipient_address, cod_amount: collect, note}`. Non-200/no consignment → "Steadfast would not take it. <field: msg>". 401/403 → "Steadfast refused the keys…". Appends COURIER_LOG (note "sent to a one-off address." if changed). Returns `{consignment, collect, total, customer, address, changed}`.
Done modal "Parcel booked with Steadfast": "Write this number on the parcel", big consignment id (click/“Copy number” copies to clipboard), customer · invoice, "Rider collects **BDT X**[ · sent to a one-off address]. The number stays on the sale, under Sales → Sent. This stays open until you close it." (UI:7254-7284).

**Already handled** (UI:6465-6488 → `erpParcelHandled`, ERP:6482-6507): prompt "Set INV aside.\n\nIf it was booked by hand with Steadfast, type the consignment number so it is still tracked. Otherwise leave this empty."; cancel → nothing. Server appends COURIER_LOG with cid (spaces stripped), cod = cid ? owed : 0, note "booked outside the ERP. " / "no parcel needed. " + "[by hand]". Refuses if already in COURIER_LOG ("…is already off the list."). Toast "INV is tracked under consignment X." / "INV set aside. Nothing was sent to the courier."
**Put back** (`erpParcelPutBack`, ERP:6516-6531): only `[by hand]` rows; deletes that COURIER_LOG row; real bookings refused ("…Cancel it in their portal first."). Toast "INV is back on the to-send list."

### 2.7 Fix details — modal (UI:4713-4767) / `erpFixInvoice` (ERP:7627-7701)
"Fix details on INV": sub "Only who it is for, where it goes and how. Products, prices and payments are not changed here — use Return or Receive payment. Every change is recorded. The saved PDF is not rewritten." Fields Name, Phone (bdphone), Address, Delivery select (OPT.sources; disabled if consignment exists, with note "A parcel (CID) is already booked, so the delivery method is fixed. A changed address or phone does not reach Steadfast — tell them yourself."). Client checks phone if changed. Server (manager+, lock 15 s): compares against first SALES_LOG row; phone → erpPhone11_; empty name refused; delivery must be in ERP_DELIVERY; delivery change with consignment refused. Writes new values into ALL rows of the invoice (cols 3,4,5,20), logs INVOICE_FIXES, generates corrected PDF (`Invoice_<no>_corrected_…`). Warning if booked: "The parcel CID was booked with the old details. Tell Steadfast about the change yourself - this does not reach them." Client toast "INV corrected: customer, phone… Corrected PDF" or "Nothing was different."; CUSTOMERS sheet is NOT updated.

### 2.8 Receive payment
Sales row button → `openDueBox(phone, name)` — renders the Due box (§4.4) at the top of the **Sales** view (dueBoxHtml is only drawn by viewCustomers; on Sales, `wireDueBox` is wired but `viewSales` does not include `dueBoxHtml()` — **caveat: on the Sales screen the due box state is set but not rendered** until the user goes to Customers). Rebuild should show the account box as a modal.

### 2.9 Steadfast money card (manager+ only) — UI:2092-2261, ERP:8422-8902
Collapsed by default: title "Steadfast money", **Open/Close**, sub "Every payout Steadfast made, parcel by parcel, and what they are still holding. Checked against your invoices by itself every night — the dashboard tells you only when you are needed."
Open → `erpSfPayouts({})` (loading "Asking Steadfast… the first time reads every payout, give it a minute."; noKeys → "Enter the Steadfast keys in Settings → Courier first.").
Server `erpSfPayoutsCore_` (lock 30 s):
1. Sync: GET `/payments?page=1..30` (stop when <10); for each new payout with status_label "paid": GET `/payments/<id>`; lines matched to invoice: exact via COURIER_LOG consignment or website order consignments (`/cod?days=120`), else by recipient phone → latest invoice for that customer key created ≤ parcel date+1 day ("phone"). Store COURIER_PAYOUTS (amount, due_bills=delivery, charges=COD fee, total=paid to bank) and lines (delivery_charge/cod_charge picked from whichever field exists).
2. Auto-record exact & delivered lines not yet in COURIER_RECON (`erpSfRecordPaid_`, ERP:8596-8647): expected = invoice owed + anything already tagged `[sf:CID]`; add = min(expected, got) − had → PAYMENTS `S<stamp>-k` "COD (Steadfast)" note "paid out by Steadfast in <payout> [payment] [sf:CID]". gap = expected − got: |gap|≤0.5 ok; 0<gap≤200 (`ERP_SF_AUTO_WRITEOFF`) → PAYMENTS `A…` "Adjusted" "[reduce] [sfadj:CID]" action writeoff; gap>200 → review; gap<0 → extra (delivery income, invoice untouched); expected≤0.5 & got>0.5 → settled. Log COURIER_RECON.
3. Phone matches where COD equals owed (±0.5), one per invoice → auto-recorded too.
4. Return: payouts (newest first, with `charged` = Σ delivery charges on the matched invoices), coming (unpaid payouts), pending phone matches still owing, waiting (booked parcels not in any payout), totals, balance (`/get_balance`, cached 30 min; fallback website), waitingCod, recon summary, night run info, autoRecorded/amount.
UI when open: KPIs "Steadfast holds now" (their figure or —), "Of which ERP parcels" (waitingCod, "N parcel(s) not paid out yet"), "Paid to your bank" (N payouts), "Courier took" (delivery + COD fee, with % of collected); "Last checked by itself: …" (+ error); recon notes: red review table (Invoice+CID | Customer | Invoice expected | Steadfast collected | Short | **Write off** / **Customer still owes**) and summary "N delivered parcel(s) checked…" with expandable "Show the ones that did not match"; "N invoice(s) marked paid from Steadfast's payout record"; coming payouts; yellow pending table with checkboxes (pre-checked) + **Mark the ticked ones paid** (`erpSfConfirmMatches`); details "Parcels the ERP booked, not in any payout yet"; payouts table: Payout (button expands lines via `erpSfPayoutLines`) | Paid | Parcels | Collected | Delivery (+ "you charged X · short/over Y", red if short) | COD fee | To bank | Matched ("x exact · y by phone · z unknown"). Expanded lines: CID | customer/phone | status | COD | invoice (exact/by phone or "no invoice found") | verdict pill (`sfpCheckPill`: ✓ matches / N less — written off / N more — delivery income / N less — your decision / N still due / closed earlier / not checked) | delivery · fee.
`erpSfReconDecide({consignment, decision:'writeoff'|'keep'})` — shareholder+ (managers see the buttons but are refused): writeoff → PAYMENTS Adjusted min(owed, gap) "[reduce] [sfadj:CID]"; updates COURIER_RECON row to writeoff/kept. Nightly job `erpSfNightly_` runs the same core for every business with keys (ERP:11037-11053).

### 2.10 Role differences on Sales
- sales role: sees list, search, filters, PDF links, parcel cells; no Return/Cancel/Fix/Receive payment buttons; Waiting box shows Send/Already handled buttons but the server refuses (manager+). No Steadfast money card.
- manager: all buttons; refund options disabled; recon decide refused server-side.
- shareholder/owner: everything incl. refunds and recon decisions.

---

## 3. Screen `quotes` — Quotations

Sub-tabs (chips) in order: `new` (label = open quotation's number or "New quotation"), `dash` "Dashboard", `conditions` "Conditions library", `letter` "Letterhead documents", `settings` "Settings" (only if `canSettings` = shareholder+) (UI:2663-2682). Right side state text: "Saving…" / "Unsaved changes · kept in this browser only" / "Saved to the server". Warning if no business name: "No business name is set for quotations yet. Add it under **Settings** before issuing one." (or "Ask the owner to set it up.").
Boot `erpQuoteBoot` → `{profile, settings, letterhead, snippets, savedItems, today, canSettings, canSnippets (manager+)}` (ERP:9244-9262). Loading "Opening quotations…", error note. Default sub-tab `dash`. Assets (logo/signature/QR) fetched as data URLs via `erpQuoteAsset({id})` — only ids listed in QUOTE_SETTINGS.assets (ERP:9548-9556).
**No quotation→invoice conversion exists.**

### 3.1 Data model (quote JSON)
`{id (uuid), number, kind: Products|Services|Mixed, title, customer, contact, email, phone, address, date, validUntil, currency, items:[{id, sku, name, description, kind: Product|Service, qty, unit, rate, amount}], discountType: Percent|Fixed, discount, vat (%), shipping, advance (%), terms, notes, showBank, showSignature, useSignature, bankIds[], theme: Signature|Executive|Minimal, accent, dark, font, fontSize: Comfortable|Compact, autoNumber, status: Draft|Ready, company (identity snapshot), createdAt, updatedAt, totals, version}`.
New defaults (`qzNew`, UI:2325-2334): kind Mixed, date = today, validUntil = today + settings.validDays (default 15), currency from settings (BDT), discountType Percent, numbers 0, terms = mixedTerms, showBank & showSignature true, useSignature false, bankIds = all profile banks, theme/accent/dark/font/fontSize/autoNumber from settings, status Draft.
Totals (identical client UI:2292-2301 / server ERP:9135-9148): `R(x)=round((x+EPS)*100)/100`; subtotal = R(Σ R(qty×rate)); discount = R(min(subtotal, Percent ? subtotal×d/100 : d)); tax = R((subtotal−discount)×vat/100); total = R(subtotal−discount+tax+shipping); advance = R(total×advance%/100); balance = R(total−advance). Money format "BDT 1,23,456.00" (en-IN, 2 decimals).

### 3.2 Dashboard sub-tab (UI:2690-2720; `erpQuoteList`, ERP:9278-9298)
KPIs: Quotations (total), Draft, Ready. Filters: Search `#qz_q` (placeholder "Reference, customer or title"; Enter applies), Status select All/Draft/Ready, **Refresh**, **+ New quotation**. Empty: "No quotations yet." + button, or "No quotation matches.". Table: Reference | Customer · title ("General quotation" when no customer) | Status (green pill if Ready) | Amount (qzMoney total currency) | Created (yyyy-mm-dd hh:mm) | Updated | **Open** / **Duplicate**. Paging 100 per page (Previous/Next + "a–b of N"). Server sorts by updatedAt desc; counts draft = everything not Ready.
- New: confirms if dirty ("The open quotation has unsaved changes. Start a new one anyway?").
- Open → `erpQuoteGet({id})` (version from row); confirm if dirty.
- Duplicate → `erpQuoteDuplicate` (ERP:9459-9467): new uuid, number '', dates from today, status Draft, version 0, autoNumber from settings, company null; client marks dirty, toast "A copy, not yet saved. It will get its own number when you save."

### 3.3 Editor (`new`) — 4 steps + live A4 preview (UI:2731-2832)
Banner if restored from browser: "Unsaved changes were brought back from this browser. They are not on the server until you save. [Discard them]".
Step chips "1 · Details", "2 · Items", "3 · Terms", "4 · Review"; footer "Step s of 4", ← Back, **Save draft**, Continue →.
1. **Details**: "What are you quoting?" three cards Products (Equipment & materials), Services (Work & deliverables), Mixed (A little of both). Changing kind swaps terms to the new kind's default only if the terms still equal the old kind's default; Products/Services force all items' kind. Fields: Project title (wide, placeholder "e.g. 3D printing equipment"), Customer name, Contact person, Email, Phone, Address (textarea 2 rows) — all optional; Issue date; Valid until; Quotation number (only when autoNumber false). Changing issue date pushes validUntil to date+validDays if it would be earlier.
2. **Items**: sub "Pick from the product list or type anything. Rate and description can be changed here without touching the product list." "Add from products" datalist input (non-discontinued catalog "name · SKU" + saved items "name · saved item") → adds item {sku, name, kind Product, unit 'unit', rate = catalog sell}; saved item → name/description/kind/unit, rate 0 and hint "last quoted N — type today's rate". **+ Blank item** (kind/unit Service/'project' for Services else Product/'unit', qty 1, rate 0). Max 150 items. Rows: # | name input (+hint, collapsible description textarea "≡") | Kind select (Mixed only) | Qty | Unit | Rate | Amount | ↑ move up / ✕ remove. Empty "No items yet." Total line.
3. **Terms & money**: Discount (select % / Amount + value), VAT %, Delivery / additional charge, Advance requested %, Terms & conditions (textarea 7), Additional notes (3, optional). "Insert from the conditions library:" buttons per snippet (appends on new line). "Payment accounts": no banks → "No bank accounts in the business profile — add them in Settings."; else checkbox "Show payment details" + one checkbox per bank ("Bank · number"; disabled once saved with a company snapshot — "Accounts were fixed when this quotation was saved."). "Signatory & look": checkboxes "Show the signatory block", "Include the signature image"; theme chips Signature/Executive/Minimal; accent & second colour pickers; font select (Arial, Georgia, Times New Roman, Verdana, Trebuchet MS, Tahoma); size Comfortable/Compact.
4. **Review**: readiness errors (red list) or "✓ Ready to issue. N item(s), total **X**."; if saved identity: "Business details on this quotation were taken yyyy-mm-dd. [ ] Use today's business details on the next save"; buttons **Save draft**, **Mark ready & open PDF** (disabled with errors); hint "PDF opens the print window: choose **Save as PDF**, paper A4, margins None, and tick “Background graphics”. The text stays selectable."
Readiness (client UI:2310-2320, server ERP:9359-9367): title required; ≥1 item; every item name & qty>0; validUntil ≥ date; number required when not autoNumber; percent ≤100 (client); business name set (client).
Every edit: dirty=true, a Ready quote reverts to Draft, saved to localStorage key `czq:<bizId>:<userName>:v1` (UI:2337-2342, 2951-2958).

### 3.4 Live preview / PDF (UI:2526-2660, 2999-3006, CSS UI:362-475)
Pages 794×1123 px (A4 @96dpi), scaled to the preview width; blocks paginated: header & footer repeated each page; table head repeated when items continue; a section label or table head is never left alone at a page bottom; footer page number "i / n"; caption "n pages · A4 · <theme>".
- Header: logo (auto-trimmed of empty border client-side via canvas, `imgTrim`), business name ("Business name not set"), address, "email · phone", website; right "QUOTATION", number or "DRAFT · NUMBER ON SAVE", "Issued: date / Valid through: date".
- Customer block: "PREPARED FOR" (if any customer field), customer h3, contact/email/phone/address lines, project title h2 ("Your project title"), tag "<kind> quotation".
- Items: "ITEM / DESCRIPTION | QTY | RATE | AMOUNT"; rows "01. name", description, kind; qty + unit; rate; amount. Empty: "Your products and services will appear here."
- Totals: Subtotal; Discount (x%) −; VAT (x%); Delivery / additional charge; **Total amount**; Advance (x%) and Remaining balance.
- "TERMS & CONDITIONS" and "ADDITIONAL NOTES" as paragraphs (long lines split at ~480 chars).
- "PAYMENT DETAILS" bank cards (A/C Name, A/C Number, Branch, extra) for selected banks (saved quote: all snapshot banks) + "Bangla QR" card with QR image and "Scan with any bank app, bKash, Nagad or Rocket" (when showBank and profile qrId).
- Signature block (if showSignature): signature image (if useSignature), rule, signer (or business name), designation.
- Footer: profile footer text + page number.
- Themes: Signature (dark triangle top-left, accent wedges), Executive (dark header band), Minimal (CSS UI:411-428). CSS vars --quote-accent, --quote-dark, --quote-font; Compact 13px vs 14px.
- PDF = browser print of a hidden `#qz_print` container with print CSS (only that container visible, page breaks per page); document title "<number> - <title>". No server PDF for quotations.

### 3.5 Save — `erpQuoteSave({quote, expectedVersion, saveKey, refreshIdentity})` (UI:2961-2996, ERP:9389-9456)
Client: strips item hints; fresh `saveKey` uuid per press; retries up to 2 times on timeout/network/busy errors with the same key; edits made during save keep the local copy dirty ("Saved as X. You kept typing, so save again to keep the latest changes."). Success toast "Saved · X" or "Ready · X"; Ready → opens print. Failure toast message (CONFLICT prefix stripped) + "Your changes are still here and kept in this browser."
Server (sales+, lock 20 s): `erpQNormalise_` validation (ERP:9316-9357): string length caps (id 64, number 60, title/customer/contact/email/phone 300, address 1200, terms 12000, notes 4000, item name 300, description 1200, unit 300, sku 80), dates real `yyyy-mm-dd`, currency ∈ BDT/USD/EUR/GBP/INR, discount 0..1e9 (percent ≤100), VAT 0..100, shipping 0..1e9, advance 0..100, ≤150 items, qty/rate 0..1e9, validUntil ≥ date, colours `#rrggbb`, theme/font whitelists. Ready requires readiness. Idempotency: same id + same save_key → returns stored doc (`repeated`). Optimistic concurrency: stored version must equal expectedVersion else "CONFLICT: this quotation was changed by someone else (<updated_by>) after you opened it. Your copy is kept here - reopen it to see theirs."
- Company snapshot taken on first save, when asked (`refreshIdentity`), or if missing (`erpQCompanySnapshot_`: requires business name; selected banks only, all if none selected; takenAt).
- **Numbering**: number given once, never changed. If autoNumber or blank: counter `seq:<prefix>` in QUOTE_SETTINGS +1 → `<PREFIX>-<issue year>-<5-digit>` e.g. `QUO-2026-00001` (counter is per prefix, not per year). Hand-typed numbers must be unique (case-insensitive) → "The reference X is already used by another quotation."
- createdAt kept; updatedAt now; totals recomputed server-side; version+1; JSON split over 8×45 000 chars ("This quotation is too large to save."). Row upsert.

### 3.6 Conditions library (UI:2852-2869, 3120-3139; ERP:9586-9597)
"Reusable terms. Insert them into a quotation on the Terms step; inserting never replaces what is already written." Each snippet: Title, Text (read-only unless manager+), buttons Copy (clipboard), "Insert into the open quotation" (if one is open; appends), Remove (manager+). "+ Add a condition", **Save the library** (manager+). Server: ≤200, title required ("Every condition needs a title."), text ≤12000.

### 3.7 Settings sub-tab (shareholder+) (UI:2871-2948, 3141-3210)
- **Business profile** ("Used on every new quotation of this business. Quotations already saved keep the details they were made with."): Business name, Address, Email, Phone, Website, Footer text, Authorised signatory, Signatory title; logo preview ("The logo is set once for the whole business, in Settings."); signature upload/remove; Bangla QR upload/remove ("No Bangla QR — only the bank accounts are shown."); Bank accounts list (Bank name, Account name, Account number, Branch, Note; Remove this account; + Add a bank account); **Save the profile** → `erpQuoteProfileSave` (name required; ≤12 banks, dropping empty ones; ids kept; clearQr/clearSignature/clearLogo flags) (ERP:9497-9519). Uploads → `erpQuoteAssetUpload({kind: logo|signature|qr|logoTrim, mime png/jpeg/webp, data base64})` ≤1 MB, stored as new Drive file in folder "ERP_Assets", id added to allowed `assets` list (last 200), profile updated (logo resets logoTrimId; the browser then uploads a trimmed PNG as `logoTrim`, owner/shareholder only) (ERP:9522-9545, UI:2474-2484).
- **Quotation defaults** ("Apply to quotations made from now on."): Reference prefix (`^[A-Za-z0-9-]{1,15}$`), Valid for (days 0..365), Currency (BDT/USD/EUR/GBP/INR), Numbering checkbox "Number automatically (PREFIX-YEAR-00001)", Look (theme), Colours, Font, Text size, Default terms — products / services / mixed. **Save the defaults** → `erpQuoteSettingsSave({settings, expectedVersion})` with version check ("CONFLICT: settings were changed by someone else…"). Defaults ERP:9227-9229.
- **Letterhead design**: style cards Signature (Dark corner, accent wedge) / Band (Header on a solid band) / Minimal (Serif name, thin rule) / Centered (Logo above the name); colours; font; logo side left/right; **Save the letterhead** → `erpLetterheadSave` (versioned).
- **Items from the old quotation app**: 5 hard-coded legacy items (UI:2283-2289; e.g. "Bambu Lab H2D Combo AMS 2 Pro" last quoted 380000) with checkbox (disabled if already saved), kind·unit, "last quoted N", match status ("saved" / "same as product SKU" / "not in the product list"); **Save the ticked items** → `erpQuoteItemsImport` (upsert by key or name into QUOTE_ITEMS, requires_review yes) (ERP:9605-9630). Import-once migration; the rebuild may seed instead.

### 3.8 Letterhead documents sub-tab (UI:3213-3619)
Client-only: upload .docx (≤10 MB; .doc refused with save-as instructions), parsed in browser with fflate + mammoth from jsDelivr; sanitised to a whitelist of tags (P, H1-6, B/STRONG, I/EM, U, S, SUB/SUP, BR, tables, lists, BLOCKQUOTE, IMG data: only, SPAN); zip-bomb guard (40 MB / 1500 parts); image sizes restored from document.xml extents; warnings listed. Preview paginated A4 with business header (logo, name, address, contact) and footer (footer text/name + page number) using the letterhead design; body text size 13–16. Buttons **PDF** (browser print) and **Download Word (.docx)** (built client-side with docx@9.6.0: header with logo 52 px + name, address/contact lines, accent rule; footer "footer · page"; A4 margins), **Clear**. Kept in sessionStorage `czl:<biz>:<user>:v1`. Nothing uploaded to the server.

### 3.9 Roles on Quotations
All roles create/save/duplicate quotations; manager+ edits conditions library; shareholder+ sees Settings sub-tab (profile, defaults, letterhead, legacy import, uploads).

---

## 4. Screen `customers` — Customers

Nav "Customers". Loads `erpBundle(['customers','dues'])` (UI:9930-9934). Loading "Loading customers…".

### 4.1 Layout (UI:7039-7134), top to bottom
1. **Due box** (account of one customer, if open) §4.4.
2. Filter card:
   - Search customers `#cq` (placeholder "Name, phone or address"; filters live on each keystroke over `name phone address`).
   - Last purchase `#clapse`: Everyone | Not bought in 1 month (30) | 2 months (60) | 3 months (90) | 6 months (180) | 1 year (365) | Never bought anything (never). Lapse N keeps customers with daysSince ≥ N and excludes never-bought; "never" keeps only daysSince null.
   - Buying pattern `#corders`: Everyone | Bought only once (orders==1) | Repeat buyers (2+).
   - Contact `#ccontact`: Everyone | Has a phone number (hasMobile) | Walk-in (no number).
   - Sort by `#csort`: Most spent (default) | Most units bought | Gone longest (daysSince desc, never-bought last) | Bought most recently (daysSince asc, never last).
   - **+ New customer** → inline form (§4.3).
3. **Customers who owe** card (red border) — `custMoneyBoxes` (UI:7408-7473): heading with total badge; chips "Oldest first" (default; oldest desc then due desc) / "Largest first"; sub "N customer(s). Remind, then record the payment when it comes." Table: Customer (+phone) | Owes (red badge) | Invoices | Oldest ("N days"/"today") | Last reminded (pill "d MMM · today/Nd ago", green if <3 days; "never" orange) | **WhatsApp** (link with prefilled due message; also logs reminder) · **Statement** · **Receive payment**.
   Built from `DUES.byKey`; name/phone from the customer list when the key matches, else from key (`n:` name or "0"+10 digits).
4. **Paid in advance** card (green border): total badge; "N customer(s) · money held for goods not yet delivered"; table Customer | In advance | **Statement** · **Open account**.
5. **All customers** card: "N of M customers". Table columns: **Customer** (name or — + balance badges: red owed amount with tooltip "Owed to you: BDT X across N unpaid invoice(s), oldest D days", green advance amount; second line phone or orange pill "walk-in" + raw phone) | **Address** | **Orders** | **Units** | **Spent** | **Last order** (d MMM yyyy + "today"/"N days ago", or red pill "never bought") | actions **Invoice**, **Statement** (if mobile or name), **Due**, **Edit**. Max 300 rows ("Showing the first 300 — narrow the search to see more."). Error row "Could not read CUSTOMERS." Empty "No customer matches that."
Note: customers in the owe list who are not in CUSTOMERS still appear in the owe list.

### 4.2 Server `erpCustomers()` (ERP:1405-1466)
Aggregates SALES_LOG by key (normalizePhone_ of contact or `n:`+lower name): units Σqty (returns' negative qty included), spent Σ line totals (returns' negative totals included), distinct non-RTN order ids, last date. For each CUSTOMERS row with an id: orders/units/spent from aggregation if present else sheet columns (units 0); lastOrder from aggregation else last_order_date col10; daysSince floor days (≥0). Returns `{row, id, name, phone, email, address, type, orders, units, spent, lastOrder ('d MMM yyyy'), daysSince, source, status}` sorted by spent desc.

### 4.3 New / edit customer form (UI:7614-7664; `erpSaveCustomer` ERP:1470-1502)
Card title "New customer" / "Edit <name>"; sub "Created with no orders attached. Selling to them updates the totals automatically." / "Order count and spend are maintained by the sales flow and are not editable here." Fields: Name * | Phone (bdphone) | Email | Address (span 2) | Type (— / Retail, Wholesale, Corporate, Walk-in; default Retail) | Status (— / New, Returning, VIP, Inactive; default New). Buttons Cancel / "Create customer" | "Save changes" ("Saving…").
Client: name required, phone valid. New form also carries `source = OPT.sources[0]` ("Customer pickup") — not shown.
Server (sales+, lock 15 s): name required; phone erpPhone11_. Edit by sheet row number: writes name, phone (text), email, address, type, source (col 13, default 'Walk-in'), status (col 14). New: `upsertCustomer_(name, phone, address, 0, '', source)` — dedupes by phone/name (if found: orders +1! and overwrites — caveat: creating a "new" customer that already exists increments its order count); email/type/status are NOT saved on create (always Retail/New or VIP if spent≥50000). Toast "Created/Saved **name**." then reload.

### 4.4 Due box (customer account) — UI:7143-7212, 7333-7388
Opened from Due / Receive payment / Open account. Card titled customer name; "Reading their account…". KPIs "Owed to you BDT balance · N unpaid invoice(s)", "Held in advance BDT credit · for goods not yet delivered". Table Invoice | When (d MMM yy) | Total | Owed | Age (`dueAge`: ≥60 red pill, ≥30 orange pill, else grey "Nd"), or "No unpaid invoices." Form: What happened (from `erpPayReasons` by role: Payment received [manager+], Reduce the due [shareholder+], Increase the due [shareholder+]; plus always "Advance received (for goods not yet given)"), Amount, Method (payment methods), Note ("why — required unless money came in"), **Save**, **Close**. Explanatory text (UI:7200-7209).
- `erpCustomerAccount({phone,name})` (ERP:5165-5191): filters dues invoices by customer key, oldest first; `{customer, phone, balance (rounded), credit, invoices, count}`.
- `erpSettleDue` (ERP:5201-5283): reason aliases (discount/writeoff/correct/return→reduce, reverse→increase); role per reason; amount>0; note required for non-money reasons; amount ≤ owed+0.5 ("That is more than is owed. The balance is N."); allocates oldest invoice first, one PAYMENTS row per invoice `P<stamp>-k` (method chosen, or "Adjusted" for reduce) note "<note> [reason]"; sync statuses; returns balance & dues. Increase → `erpUndoPayment_` (ERP:5418-5490): negative rows `U<stamp>-k` "Undone" "<note> [increase]" against the most recently paid invoices, capped at recorded payments.
- `erpTakeAdvance` (ERP:5342-5375, manager+): PAYMENTS `A<stamp>` order '' amount, method, note "<note> [advance] [acct:KEY]". Credit = Σ amounts of rows with no order id tagged `[acct:KEY]` (ERP:5319-5335). Credit is consumed only by the next invoice (§1.7 step 13).
- Toast "Saved." and the box reloads.

### 4.5 Statement modal (UI:7494-7577; ERP:8916-9040)
"Statement · <customer|phone>", period chips 3 months (90, default) / 1 year (365) / Everything (3650). Sub "from to to · phone". Table Date | Details (+ref) | Charged | Paid | Balance, first row "Balance brought forward" (opening). Totals "Balance due BDT closing", "Advance held". "Unpaid: INV owed (Nd) · …". Buttons Close, **Save as PDF**, **Send on WhatsApp** (wa.me with text: "Assalamu alaikum <name>,\n\nYour statement with <business> (from – to):\n<date  text  +debit  −credit>…\n\nBalance due: BDT X[\nAdvance held for you: BDT Y]\n\nThank you.").
Server: key required ("Whose statement?"); days clamp 7..3650. Entries: one debit per invoice (grouped legacy ids) "Invoice X (N items)" = grand; PAYMENTS rows for those invoices labelled: Returned → "Goods returned"; Adjusted with recorded_by containing "cutover" → "Paid – records brought up to date"; Adjusted → "Adjustment"; Advance → "Paid from advance" (+) / "Moved to advance" (−); Undone → "Payment taken back"; other + → "Payment – method", − → "Refund – method" (positive = credit column, negative = debit). Plus synthetic "Paid at the time of sale" credit = (settled ? grand : onSheet) − ledger when >0.5. Sorted by date then debit first; running balance; entries before the window fold into opening. Advance = Σ account rows `[acct:KEY]`. `open` = unpaid invoices with days. Business name = spreadsheet name.
PDF `erpStatementPdf`: HTML→PDF "Statement of account" table, saved to invoice folder as `Statement_<name>_yyyy-MM-dd.pdf` (same-day file replaced; error if no folder). Toast link "Open <name> · saved in Drive".

### 4.6 WhatsApp due reminder (UI:7484-7491, 7566-7576; ERP:9054-9086)
Message: "Assalamu alaikum <name>,\n\nThis is <business (first business in BIZ list, default 'Costareen')>. Your balance with us is BDT <due>[ across N invoices][, the oldest from D days ago].\n\nPlease pay at your convenience by bKash, Bangla QR or cash. If you have already paid, please let us know so we can update our records.\n\nThank you." Clicking opens wa.me in a new tab and calls `erpDueReminded({phone,name,due})` → DUE_REMINDERS row; badge updated to "today".

### 4.7 Invoice button
Prefills FORM name/phone/address (delivery not copied) and navigates to New invoice (no lookup or account fetch is triggered) (UI:7694-7706).

### 4.8 Roles on Customers
All roles see lists, badges, owe/advance boxes (dues via bundle), statements, WhatsApp, create/edit customers. Due box reasons: sales gets none from server (call refused → falls back to default list containing only "Payment received") and Save is refused server-side; managers can record payments and advances; shareholder+ can reduce/increase dues.

---

## 5. Data-quality caveats handled (must preserve)
1. Phone spellings (01…, 1…, 880…, +880…, spaces/dashes) unified by last-10-digit key everywhere; staff entry forced to 11 digits; website orders keep their phone (formatBdPhone_ only).
2. Leading-zero loss: phone cells forced to text (Code:2212, 3583).
3. Legacy split invoices `ORD-<ms>` (one id per line each carrying the full grand total) grouped within 5 min (ERP:5508).
4. Two records of payment (ledger vs SALES_LOG advance_paid/status) → take the larger, never the sum; "Paid" status on sheet = fully settled (ERP:5045-5048, 6088-6090).
5. Invoice discount stored either inside line totals (new) or not (old) → `erpDiscLeft_` avoids double counting (ERP:10759).
6. Invoice number collision after a failed save → counter bumped until free (Code:1062).
7. Backdated invoices: E5 typed date, typo guard, resets to =TODAY() after save (Code:1482-1520).
8. Courier payouts: courier figure is authoritative; small shortfalls ≤200 auto written off, larger need owner; extras = delivery income; each consignment checked once.
9. Invoices before 30 Sep 2026 never offered for parcel booking.
10. Old plain PDFs silently re-rendered in the new design on first open.
11. Website orders: delivery charge = order total − Σ line totals; line discount = list − website line total; payment method mapped by `erpWebPayment_` (ERP:5759-5779); note `WEB-<no>`; discount cap skipped.
12. Business isolation: QR/logo/bank never shown for another business (asset allow-list, per-sheet keys).
13. Customer with debt and credit at the same time — kept separate; credit only spent on the next invoice.

## 6. Known quirks in the source (decide whether to replicate)
- Save confirm "Due" line ignores pay mode (UI:2030).
- Credit-only customers never get the advance note on New invoice (UI:1601).
- Receive payment on Sales sets the due box but Sales view doesn't render it (UI:4813-4815 vs 4507).
- `erpSaveCustomer` create path increments orders of an existing match and drops email/type/status.
- Fix details doesn't update CUSTOMERS.
- Quotation numbering counter is per prefix across years (year in the reference is the issue date's year).
- Steadfast recon buttons visible to managers but shareholder-only on the server.
- `erpCustomers` units/spent include return rows (negative) because returns carry the customer phone.

## 7. External dependencies
- Google Drive: invoice folder (SETTINGS `invoice_pdf_folder_id`), "ERP_Assets" image folder, download link `drive.google.com/uc?export=download&id=`.
- Google Sheets PDF export (legacy plain invoice), Drive HTML→PDF converter (fallback invoice, return note, statement).
- Render service `https://mcp.bendar.duckdns.org/render` (`/pair`, `/pdf`) for the designed invoice.
- Steadfast API `https://portal.packzy.com/api/v1`: `/create_order`, `/status_by_cid/<cid>`, `/get_balance`, `/payments?page=n`, `/payments/<id>`.
- Website (WooCommerce sync bridge) `czFetch_` `/cod?days=…&limit=…` for website-order consignments and balance fallback.
- WhatsApp click-to-chat `https://wa.me/<880…>?text=…` (no API sending in these screens).
- CDN (letterhead only): fflate 0.8.2, mammoth 1.12.0, docx 9.6.0 via cdn.jsdelivr.net.

## 8. Server function index (this spec)
erpBundle, erpCatalog, erpFormOptions, erpToday, erpLookupCustomer, erpCustomerAccount, erpCreateInvoice (+ submitInvoiceCore_, healInvoiceLayout_, freshInvoiceNo_, upsertCustomer_, saveInvoicePdfSilently_, exportInvoiceCompactPdf_, erpInvoiceDiscounts_, erpApplyCredit_, erpInvoiceDocPdf_), erpSettleDue (+ erpUndoPayment_), erpTakeAdvance, erpPayReasons, erpDues, erpSyncInvoiceStatus_, erpSales, erpInvoicePdf, erpReturnPreview, erpReturnGoods (+ erpReturnNotePdf_), erpCancelInvoice, erpFixInvoice (+ erpInvoiceCopyPdf_), erpParcelPreview, erpBookParcel, erpParcelHandled, erpParcelPutBack, erpSfPayouts (+ erpSfPayoutsCore_, erpSfPayoutSync_, erpSfRecordPaid_), erpSfPayoutLines, erpSfConfirmMatches, erpSfReconDecide, erpCustomers, erpSaveCustomer, erpCustomerStatement, erpStatementPdf, erpDueReminded, erpQuoteBoot, erpQuoteList, erpQuoteGet, erpQuoteSave, erpQuoteDuplicate, erpQuoteAsset, erpQuoteAssetUpload, erpQuoteProfileSave, erpQuoteSettingsSave, erpLetterheadSave, erpQuoteSnippetsSave, erpQuoteItemsImport, erpBrandLogo, erpBrandLogoClear, erpSaveProduct (quick add, spec 02).
