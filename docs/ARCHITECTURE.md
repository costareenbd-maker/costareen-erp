# Costareen ERP — web app architecture

Goal (owner, 2026-10-02): the web app must be the current Google Apps Script
ERP "copied fully, A to Z, every detail", usable from phone and any browser at
**erp.costareen.com**, sellable to subscribers. The live sheet ERP stays
untouched and in daily use until the owner switches.

The exact behaviour to copy is written down in `docs/spec/01..04-*.md`
(every screen, field, rule, message, with `file:line` into the original
source). Those specs are the contract. Where the original has a bug, the spec
says so; the rebuild fixes it and lists the fix in `docs/FIXES.md`.

## The one idea that makes an exact copy possible

The original UI (`ErpUI.html`, ~10k lines) never touches data directly. Every
screen talks to the server through **one function**, `srv(name, args, ok, bad)`,
which calls `erpCall(token, name, args)` on Apps Script. There are 127 distinct
server functions behind that door.

So the rebuild is:

```
web/index.html   = ErpUI.html, unchanged, except:
                   - srvPump() posts to the Edge Function instead of google.script.run
                   - the sign-in gate also offers owner email sign-in
                   - phone-layout + install additions (manifest, sw.js)
        |
        |  POST /functions/v1/erp   { name, args, token }
        v
supabase/functions/erp/   = erpCall re-implemented:
                   - identify the caller (staff code + approved device, or owner session)
                   - ERP_ALLOW role table, identical to ERP.js:4177-4246
                   - run the handler for `name` inside ONE database transaction,
                     as that user (SET LOCAL role authenticated + jwt claims),
                     so row-level security still decides which rows exist
                   - erpScrub_ by role (cost/profit/supplier removal), identical
                   - errors logged to erp_errors
        |
        v
Postgres (Supabase)  = one table per sheet tab, every row carries business_id,
                       RLS on every table (see 001_schema.sql conventions)
```

Screens therefore stay pixel- and word-identical; only the server side is new.

## Rules for handlers

1. Same name, same arguments, same return shape, same error sentences as the
   original function. The spec is the reference; when in doubt read the
   original in the pulled source (`sheet-erp/ERP.js`, `Code.js`).
2. Money rules that every screen shares live in ONE place
   (`handlers/money.js`): what an invoice owes, dues, customer key, discount
   split, legacy ORD- grouping. Never re-derive them per screen — the original
   drifted exactly that way (three different "stock" numbers, three return
   counts, two cost precedences).
3. Writes that the original protected with `LockService` use a Postgres
   advisory lock on (business_id, topic) inside the transaction.
4. Secrets (Steadfast, website sync key, Evolution, AI keys, render key) live
   in `business_secrets`, readable only by SECURITY DEFINER functions. Never
   returned to the browser.
5. Files that went to Google Drive go to Supabase Storage
   (`invoices`, `assets`, `exports` buckets), private, served by signed URLs.

## Sign-in

- **Staff**: unchanged experience — 6-digit code, device approval by the owner,
  5 wrong codes lock a device for 15 minutes (`erp_people`, `erp_devices`).
  Each person is also a row in `auth.users` (no password) so RLS can identify
  them; the Edge Function sets their id as the JWT subject for the transaction.
- **Owner**: Supabase email + password (replaces "the Google account that owns
  the sheet"). Same `owner` role inside the ERP.
- Roles and ranks exactly as the original: sales 1, manager 2, shareholder 3,
  owner 4; discount caps 5 / 10 / 100 / 100 %. The older enum value `staff`
  is treated as `sales`.

## Scheduled jobs (were Apps Script triggers)

| Original | Rebuild |
|---|---|
| nightly 03:00 backup + Steadfast payout sync + partner-link sync | pg_cron → Edge Function `nightly` |
| campaign tick every 10 min (10:00-20:00 Dhaka) | pg_cron → `erp` handler `erpCampaignTick` |
| website pull/push every 15 min | pg_cron → `erp` handler `czSyncCycle` |
| hourly STOCK_VIEW rebuild | not needed: stock is a view over the ledger |

## Build order

1. Schema `006_erp_core.sql` (all tabs as tables) + tests.
2. Edge Function skeleton: auth, ERP_ALLOW, scrub, transaction, `erpHello`,
   `erpBundle` parts biz/catalog/lists/options.
3. `web/index.html` from ErpUI.html with the new transport. Products screen live.
4. Invoice + Sales + Customers (daily use first).
5. Stock entry + purchase orders, Product cost, Dashboard, Profit.
6. Expenses, Web orders, Quotations, Settings, Tools, Campaigns.
7. Data import from the live sheet (read-only), then side-by-side comparison
   of every total before the owner switches.
