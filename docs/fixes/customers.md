# Customers group - deliberate differences

1. **"New customer" for someone who already exists no longer counts an order.**
   Original: `erpSaveCustomer` create path (ERP.js:1494) called
   `upsertCustomer_(name, phone, address, 0, '', source)` (Code.js:2148), which on a
   phone/name match added 1 to `total_orders`, set `last_order_date` to now,
   recomputed the status (Returning/VIP), overwrote the address with whatever was
   typed (even blank) and dropped email/type/status. Web app: on a match it only
   fills in what was typed (name; phone, address, email, type, status, source when
   given), keeps the order count, spend, last order and status history, and
   answers `updated: true` (toast "Saved <name>.").
   Why: spec 03 §6 lists it as a known bug; the form says "Created with no orders
   attached".

2. **A brand-new customer is created with no orders.** Original: upsertCustomer_
   wrote `total_orders = 1`, `last_order_date = now`, note "Auto-created from
   invoice" and type Retail / status New regardless of the form, so a customer
   added by hand showed "1 order, today". Web app: orders 0, spent 0, no last
   order, empty note, and the form's email, type (default Retail) and status
   (default New) are saved. Why: same form promise as above.

3. **Edit by row checks the row is this business's customer.** Original wrote to
   whatever sheet row number it was given (ERP.js:1483). Web app: `row` is the
   customer's write-order number (`customers.seq`, a number as the page needs:
   it does `Number(data-cedit)`); an unknown row (or another business's) is
   refused with "That customer is no longer on the list. Reload and try again."
   The edit also keeps `customers.customer_key` in step with the new phone/name.

4. **erpCustomers lists every customer row.** Original skipped CUSTOMERS rows with
   a blank customer_id (ERP.js:1432) - those were blank sheet rows. In the
   database every row is a real customer, so rows imported without a
   `customer_no` are listed too (`id` is then '').

5. **Merge duplicates keeps invoices pointing at the kept customer.** Original
   (ERP.js:2622) deleted the duplicate rows; the sheet had no links to them. In
   the database `invoices.customer_id` would be set to null by the delete, so the
   merge first moves those invoices to the kept row. Removed rows are copied to
   the table `customers_duplicates_backup` (with `merged_into`, `backed_up_by`)
   instead of a sheet tab; the result still names `CUSTOMERS_DUPLICATES_BACKUP`.

6. **fixPhones counts invoice lines.** erpTool('fixPhones') (ERP.js:1718) counted
   changed cells in CUSTOMERS.contact_number and SALES_LOG.customer_contact (one
   per invoice line). The web app keeps the phone once per invoice, and counts
   each changed invoice as its number of lines (at least 1), so the message
   matches what the sheet would have said.

Kept as in the original (not fixed, noted for the record):
- `erpRecordPayment` (ERP.js:4912) judges "settled" / "owed" from the PAYMENTS
  ledger only (not the sheet's paid column or a Paid status), unlike erpDues.
- `erpCustomers` units/spent include return notes (RTN-, negative), spec 03 §6.
- The statement's phone/name are taken from the LAST matching sales row.
- The statement's business name is the business's name (was the spreadsheet name).
