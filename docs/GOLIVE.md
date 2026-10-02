# Going live

The web app (https://erp.costareen.com) is finished and holds a **trial copy** of the sheet's data from the day it was imported. Staff still work in the sheet. Going live means: empty the trial copy, count the shelf, hand out access links, stop using the sheet. Nothing here touches the sheet ERP.

## Before the day

1. **Sign in as owner** and try, on the trial data: one product page, one P&L month, attach one receipt, the Partnership tab.
2. **Access links** (Settings → Security). There is no sign-in: make a link for each device you use. Keep links private - a link is full access until it is switched off.
3. **Fill in what the import could not carry** (Settings):
   - Business → logo, signature and payment QR (the old ones pointed at Google Drive).
   - Connections → Steadfast keys, website sync key, WhatsApp link.
   - Bell → your WhatsApp number for alerts.
4. **Decide the plan.** Free: the database pauses after 7 days without use and has no daily backup (the app makes its own nightly copy). Pro (USD 25 / month): never pauses, daily backups for 7 days. For a business taking money every day: Pro.
5. **Pick the day.** A morning before opening is best: the shelf has to be counted while nothing is being sold.

## The day

1. **Last sheet invoice.** Note its number (the part after the last dash, e.g. `INV-20261015-1950` → 1950). Staff stop using the sheet.
2. **Empty the trial data** (run by whoever looks after the system):
   ```
   python deploy/start_fresh.py 81e318e7-fbde-4fcc-9b9f-b0061fe29c14 --keep-lists                       # shows what goes and what stays
   python deploy/start_fresh.py 81e318e7-fbde-4fcc-9b9f-b0061fe29c14 --keep-lists --yes-delete "Costareen"
   ```
   Goes: invoices, payments, stock movements, courier bookings and payouts, expenses, web orders, logs. Stays: products with prices and costs, customers (totals cleared), lists, settings, keys, people. A copy of everything removed is written to `deploy/before-start-fresh-<time>.json` first. It is one transaction: all or nothing.
3. **Invoice numbers carry on.** If the sheet went past the number the web app holds, set the counter to the last sheet number + 1 (one SQL line: `update invoice_counters set next_number = <n> where business_id = '81e318e7-…'`).
4. **Count the shelf.** Stock entry → Count & adjust. Type what is on the shelf for every product, save. A product counted for the first time is written as **Opening stock** at its cost price. Products not counted stay at 0 and cannot be sold. Can be done in parts (category by category).
5. **Costs.** Any product with no cost price: Product cost screen. No cost = no profit figure for it.
6. **What customers owe today.** Dues did not come across (the invoices are gone). For each customer who owes: New invoice is wrong (it would move stock). Use the customer page → note the amount, and collect it in the sheet as before until those few are paid. *(If there are many, say so before the day - an "opening balance" entry can be added.)*
7. **Staff.** Settings → Security → Access links → make one link per person or device and send it to them privately. They open it once on their phone; the phone is remembered. Everyone with a link has full access (a per-person system is to come later). Install on the phone: browser menu → "Add to Home screen".
8. **First sale.** Make one real invoice, open its PDF, check the dashboard shows it.

## After

- The sheet stays as the record of everything before the day. Do not delete it.
- Joint pool with the partner: Settings → Business → "A company for a partner", then Capital → Partnership → start the pool and send the code.
- A device not used for 30 days asks to be allowed again - that is on purpose.

## If something goes wrong on the day

- Staff can go back to the sheet at once: it was never changed.
- The removed trial data is in `deploy/before-start-fresh-<time>.json`.
- Sign-in trouble for the owner (second step): the factor is deleted with the admin API and the password works alone again.
