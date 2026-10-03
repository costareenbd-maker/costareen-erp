# Going live

The web app (https://erp.costareen.com) holds a **trial copy** of the sheet's data. Staff still
work in the sheet. Going live = empty the trial copy, set the invoice number, count the shelf,
move the staff over. The sheet is never changed and stays as the record of everything before.

Status column: ✅ done · ⏳ owner to do · 🔧 done by the system on the day.

## Before the day

| # | Step | Who | Status (3 Oct 2026) |
|---|------|-----|--------|
| 1 | **Owner password + 2-step.** Open erp.costareen.com *without* a link → "Forgot the password?" → `costareen.bd@gmail.com` → choose a password (10+ characters) → sign in → Settings → Security → turn on 2-step sign-in. Protect that Gmail account too: whoever holds it holds the ERP. | owner | ⏳ |
| 2 | **Invite every staff member**: Settings → Users → name, e-mail, role (Sales / Manager / Shareholder / Owner). Each gets an e-mail to choose a password. | owner | ⏳ none invited yet |
| 3 | **Connections** (Settings → Connections): Steadfast keys ✅ already set; **website sync key** ⏳ not set (the courier screen and website orders need it); WhatsApp link if campaigns are used. | owner | partly |
| 4 | **Business look** (Settings → Business): logo, signature, payment QR (the old ones pointed at Google Drive). Quotations → Settings: re-upload the logo/signature (live shows "That image could not be read"). | owner | ⏳ |
| 5 | **Money accounts** (Money → + Add / change accounts): Cash, Islami Bank, BRAC Bank, bKash, Steadfast exist. On the day, type each one's real **opening balance**. | owner | ✅ set up · ⏳ balances |
| 6 | **Products** worth checking: printers → product page → "Sold by serial number" + warranty months; Products → Colour families… → group the 16 suggestions. | owner | ⏳ |
| 7 | **Hosting plan.** Free: pauses after 7 days unused, no daily backup (the app keeps its own nightly copy). Pro (USD 25/month): never pauses, daily backups. Decide before staff depend on it. | owner | ⏳ "decide later" |
| 8 | **Pick the day**: a morning before opening - the shelf is counted while nothing is sold. | owner | ⏳ |

## The day (say "wipe now" to start)

1. **Last sheet invoice number** - read from the sheet (the part after the last dash). Staff stop using the sheet. 🔧
2. **Re-read the sheet's script** and port anything new (last matched: build b261003-0358, still current on 3 Oct). 🔧
3. **Empty the trial data and set the invoice counter** in one transaction (a full backup JSON is written first):
   ```
   cd deploy; source secrets.env
   python start_fresh.py 81e318e7-fbde-4fcc-9b9f-b0061fe29c14 --keep-lists --next-invoice <last+1>                          # plan only
   python start_fresh.py 81e318e7-fbde-4fcc-9b9f-b0061fe29c14 --keep-lists --next-invoice <last+1> --yes-delete "Costareen"  # does it
   ```
   Goes: invoices, payments, stock movements, courier bookings/payouts/checks, supplier bills/payments, money moves, capital book, expenses (entries), web orders, quotations, campaigns, serials, repair jobs, notes, logs.
   Stays: products (prices, costs, photos, families, serial flags), customers (totals cleared), suppliers, price book, expense set-up, shareholders list, money accounts, currencies and rates, WhatsApp opt-outs, lists, settings, users, keys. 🔧
4. **Count the shelf**: Stock entry → Count & adjust → every product's real count → Save. First count = **Opening stock** at its cost. Number printers' serials on their product pages. owner + staff
5. **Opening balances**: each money account's real balance (Money → Correct a balance). owner
6. **Old dues** ("a few"): customer page → Receive / adjust due → **Increase the due** with a note "opening due from the sheet". Supplier dues: supplier page → bill with note "opening". owner
7. **Costs**: any product without a cost → Product cost. No cost = no profit for it. owner
8. **Retire the old 6-digit codes** (Settings → People): everyone now signs in with e-mail. 🔧
9. **First sale**: one real invoice, open its PDF, check the dashboard. owner

## After

- The sheet stays as the record of everything before the day. Do not delete it.
- Joint pool with a partner: Settings → "A company for a partner", then Capital → Partnership.
- If something goes wrong on the day: staff go back to the sheet at once (never changed); the removed trial data is in `deploy/before-start-fresh-<time>.json`.
- Owner locked out: "Forgot the password?" by e-mail. 2-step lost: the factor is removed with the admin API and the password works alone again.
