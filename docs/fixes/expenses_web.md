# Expenses + website orders: fixes and deliberate changes

Group files: `supabase/functions/erp/handlers/expenses.js`, `handlers/weborders.js`,
migration `supabase/015_expenses_web.sql`, tests `supabase/tests/expenses_web_test.mjs`.
Spec: `docs/spec/04-*.md` parts A1 and A3, spec 03 §5 item 11.

## 1. A website line with no SKU is no longer added again on every pull
- **Original:** `pullWebOrders` (Code.js:3905-3945) stores a line without a SKU as
  `'(no sku)'` but checks for duplicates with the key `order|''`. The stored row reads back as
  `order|(no sku)`, so the check never matches and the same line was appended again on every
  15-minute cycle.
- **Web app:** the duplicate key uses `'(no sku)'` for a blank SKU too, so the line is
  stored once.

## 2. The Excel export is built directly, not through a temporary Google Sheet
- **Original:** `erpExpenseExport` (ERP.js:7020-7084) wrote a temporary spreadsheet, exported
  it as xlsx through docs.google.com and saved it in the Drive folder `Costareen_Expenses`.
- **Web app:** the same two sheets (Summary, Entries), the same rows, bold title at 14 pt,
  row 13 bold, column widths 280/130 px, bold frozen header on Entries - written as an .xlsx
  by a small pure-JS writer (`buildXlsx` in expenses.js; works in Deno and Node). Saved in
  the `exports` storage folder as `<business> expenses <yyyy-MM>.xlsx`; an older file of the
  same name is replaced. Returns `{ok, name, id, url, month}`. `<business>` is the business
  name (was: the spreadsheet's file name).
- **Needs a page change (not in this group's files):** the page builds the download link as
  `https://drive.google.com/uc?export=download&id=<id>` (ErpUI.html:6843). In the web app
  that link must use `r.url` instead.

## 3. The month's gross uses the shared cost rule
- `erpMonthGross_` (ERP.js:6716-6753) is the dashboard's `monthGross` (dashboard.js), which
  already carries dashboard fixes 2 and 3 (product cost first, then the price book; one
  price-book key where blank category/brand/type read as 'Uncategorised' / '-' / '-').
  expenses.js re-exports it. For products with all three fields filled the numbers are the
  original's exactly.

## 4. Website order dates keep the website's own text
- **Original:** `created` was written into a sheet cell; the screen showed its first 16
  characters (ERP.js:1518). If Sheets had turned the text into a date the screen showed
  `Wed Sep 30 2026 ` instead.
- **Web app:** the text is kept as sent (`web_orders.order_date_text`), so the screen
  always shows e.g. `2026-09-30 14:22`; a parsed copy goes in `order_date`.

## 5. Small, invisible differences
- Writers wait on a database lock instead of giving up after 10-15 s, so `pullWebOrders` /
  `pushStockToWebsite` never return `{ok:false, error:'busy'}` and "Sheet is busy" is not
  said.
- `erpExpWrite_`'s "The entry did not reach the sheet" check is gone: an insert either
  succeeds or the whole call fails.
- Entering and linking a website order also fill `web_orders.invoice_id` (and linking sets
  `invoices.web_order_no`); the `WEB-<no>` note stays the tie every function reads.
- `erpEnterWebOrder` returns `pdfUrl` from sales.js `makeInvoicePdf` when it exists; a failed
  PDF does not undo the sale (the original's `saveInvoicePdfSilently_` was silent too).

## Role notes (kept verbatim, documented)
- `erpExpenseVoid` is owner-only (ERP_ALLOW, ERP.js:4223-4226); shareholders see the
  "Strike out" button but are refused with "Your account does not have access to that."
- The Web orders screen is manager+, but its "Check the website for new orders" button calls
  `erpTool('pullOrders')`, which needs shareholder. A manager gets the refusal toast
  "Could not check the website: Your account does not have access to that." (as the original).
