# Sales group - deliberate differences

Handlers: `supabase/functions/erp/handlers/sales.js`. No migration was needed
(no `010_sales.sql`): every table already exists in 001/007/008.

1. **Return ids stay unique.** The sheet named a return `RTN-yyMMddHHmmss`
   (ERP.js:7316); two returns saved in the same second shared one id. The
   RTN- note is now an `invoices` row with a unique invoice number, so a
   second return in the same second gets `RTN-yyMMddHHmmss-2` (then `-3`...).
   Payment ids (`R<stamp>`, `X<stamp>`) are unchanged.

2. **A return of a product that no longer exists** still writes its RETURNS
   row, RTN- line and payments, but no stock movement: `stock_movements`
   needs a product (the sheet appended a TXN_LOG row with only the SKU,
   ERP.js:7336). It is still counted in `restocked`, as the original did.

3. **Invoice PDF is always the designed one.** The original drew the designed
   invoice on the render service and fell back to a plain Drive-converted
   page when that failed (ERP.js:11480-11502); the web app has one renderer
   (`renderPdf`), so there is no plain fallback, and `erpInvoiceDocHtml_` is
   not ported. The return note (ERP.js:7404) goes through the same renderer.

4. **"Old plain copy" is read from the invoice, not a Drive description.**
   `erpInvoicePdf` redrew a file whose Drive description was not
   `designed 2` (ERP.js:7465). Storage files have no description, so an
   invoice whose `invoices.pdf_designed` is false (imported invoices,
   anything not drawn by `makeInvoicePdf`) is redrawn on first open; the old
   file is deleted when the new one has a different name (a corrected copy).
   `makeInvoicePdf` sets `pdf_designed`, `pdf_path` (storage id) and `pdf_url`.

5. **Image allow-list.** `erpDocImg_` only embedded Drive ids listed in
   QUOTE_SETTINGS `assets` (ERP.js:11103) so one business could not print
   another's logo. Storage is already per business (`<business>/assets/...`),
   so the logo / QR are read straight from this business's `assets` folder by
   the id in the profile; the type is taken from the file's bytes
   (PNG/JPEG/GIF/WebP), anything else is left out. WebP is embedded as is
   (the renderer is a browser; the PNG conversion was only for Drive's converter).

6. **"No invoice folder"** cannot happen (every business has storage); the
   message is kept for the case where storage is not available at all.

7. **Website parcel-number cache** (`erpWebParcelIds_`, CacheService 600 s,
   ERP.js:4255) is a per-business in-memory Map in the Edge Function
   instance, 10 minutes. An instance lives for minutes, so at worst the
   website is asked more often; never shared between businesses. A missing
   `CZ_SYNC_KEY` or a website error leaves the numbers out, as before.

8. **Fix details keeps `invoices.customer_key` in step** with the corrected
   name/phone (the sheet had no such column). The CUSTOMERS row is still not
   touched, as in the original.

9. **Cancel also stamps `invoices.cancelled_at`.** "Cancelled" is still
   decided exactly as the original (a RETURNS reason starting
   "Invoice cancelled"); the column is only a convenience for reports.

10. **Locks.** `LockService.tryLock` + "Sheet is busy" became an advisory lock
    on (business, 'sale') - the same topic `erpCreateInvoice` uses - which
    waits instead of failing. The cancel's inner return does not re-lock, as
    `ERP_IN_CANCEL` did.

11. **Errors the original swallowed** (status sync after a return/cancel, the
    PDF after a fix, the return note) are run so that a failure cannot abort
    the transaction that recorded the return (savepoint / try-catch).
