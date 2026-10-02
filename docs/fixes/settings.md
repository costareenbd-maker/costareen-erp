# Settings group: fixes and deliberate changes

Files: `supabase/functions/erp/handlers/settings.js`, `supabase/018_settings.sql`,
`supabase/tests/settings_test.mjs`.

## Required fix: erpTool('prepareTemplate') can no longer wipe anything
- **Original** (ERP.js:1785, 2205-2236): `erpTool('prepareTemplate')` called
  `erpPrepareTemplate()`. That ran `deleteAllProperties()` and deleted every
  project trigger, so it removed the business registry, website sync key,
  courier keys, AI keys, render key and the nightly backup timer. `erpTool`
  only needs **shareholder**, so a shareholder could do it through Tools,
  even though `erpPrepareTemplate` itself was owner-only.
- **Web app**: both `erpTool('prepareTemplate')` and `erpPrepareTemplate()`
  change nothing. They return "Nothing to prepare: in the web app every new
  business starts empty, so nothing was removed. Stored keys, timers and
  images were left exactly as they were." `erpPrepareTemplate` returns
  `{ok, sheet:'', images:0, properties:0, triggers:0, message}`. The test
  checks that secrets and AI keys survive.
- **Why**: a new business is made empty by `create_business`; there is no
  template sheet to clean, and nothing should be able to wipe credentials.

## Tools with no sheet to act on (erpTool, ERP.js:1702-1814)
Each still returns a sentence, but an honest one; nothing is changed.
- `refreshStock` (was "Stock view recalculated."): stock is the
  `product_stock` view over the ledger, always current. Says so. The page still
  reloads the catalogue afterwards, as before.
- `refreshDashboard` (was "Dashboard tab refreshed."): no DASHBOARD tab; says
  the dashboard is worked out fresh every time.
- `sortProducts` (was "PRODUCT_MASTER sorted."): no product sheet; says screens
  list products in order themselves.
- `fixInvoiceLayout` (was "Invoice layout healed…"): invoices come from a fixed
  design; says there is no layout to break.
- `insertQr` (was "Bangla QR refreshed on the invoice…"): no INVOICE sheet;
  says each invoice takes the payment QR from the business profile.
- `fixPhones` is still done for real (customers.phone and
  invoices.customer_phone through `formatBdPhone`), same sentences.
- `previewPush`, `pushStock`, `pullOrders`, `mergeCustomers`,
  `fixCustomerPhones`, `previewReorder`, `applyReorder` call the other groups'
  exports (`pushStockToWebsite`, `pullWebOrders`, `mergeCustomers`,
  `fixCustomerPhones`, `applyReorderLevels`) by lazy import, and build the
  original sentence from their result. A missing export answers "This part is
  not in the web app yet."

## Sheet-only business functions (every business uses one web address now)
- `erpDeployBusiness` (ERP.js:3783-3895 built an Apps Script project per sheet
  through the Apps Script API): now **throws** "Every business now opens from
  the same web address, https://erp.costareen.com - choose it in the business
  list at the top. There is no separate link to build, so nothing was
  changed." It throws rather than returns because the page's success toast
  would otherwise say "link updated".
- `erpBusinessLinks`: every business the person belongs to, all with
  `url = https://erp.costareen.com`, `isHome` = the open one.
- `erpCheckBusinessSheet` (ERP.js:1679): returns `{ok, name:'', url, message}`
  explaining there are no sheets to check.
- `erpForgetBusiness` (ERP.js:2528): throws a sentence; nothing is removed
  (a business shows only to its members; leaving one is a membership change).
- `erpAccessWarning` (ERP.js:3714): always `null`. The warning existed because
  the deployment ran as its owner; here each person sees only businesses they
  are a member of (RLS + memberships).
- `erpBusinessPeople` (Drive owner/editors/viewers, ERP.js:3681): now the
  business's members: `{id, name, people:[{email (their name), role, removable}]}`.
  The page loads it but renders it nowhere (spec A4.2).

## erpCreateBusiness (ERP.js:2398-2452)
- New business via `create_business` (caller becomes owner), seeded with the
  SETTINGS lists of `setupSettings_` (Code.js:146-185) under the ERP's list
  kinds, config `business_name / currency / default_reorder /
  default_lead_time / payment_qr_file_id`, and switched to (erp_prefs).
- Logo and QR are saved to storage `assets` (`logo_<ms>`, `qr_<ms>`) and put in
  `quote_settings.profile` (`logoId`, `qrId`) and `assets`; the QR id also in
  config `payment_qr_file_id`. Bank text is kept in `businesses.bank_details`
  and as one profile bank entry (lines: bank, account name, number, branch,
  rest = extra). The original wrote these onto the INVOICE sheet.
- The sheet-copy safety check (`erpAssertClean_`) does not apply: nothing is
  copied, the business starts as empty rows.
- **Partner emails are only recorded** (config `partner_emails`), never sent
  or given access - there is no Drive sharing. The result keeps the original
  shape `{ok,id,name,url,invited:[],couldNot:[],warning}`; `warning` explains
  that nobody was let in and that each partner is added under Staff (own code,
  sees that business only). Without emails `warning` is `null`.
- Images over 2 MB are refused server side too ("That image is over 2 MB.
  Please use a smaller one."); an unreadable image is skipped as before.

## Staff and devices (ERP.js:4473-4600, 4795-4860)
- A person is an `auth.users` row (via `ctx.deps.createAuthUser`) +
  `erp_people` (home business = this one) + a membership here with the chosen
  role. `id` in every result is the person's user id (the `U<stamp>` id is
  kept in `person_no`).
- Shareholders may add manager/sales people. Memberships are owner-write only
  under RLS, so 018 adds `erp_add_member()` (security definer) that allows a
  shareholder exactly that: only for a person this business added, owner and
  shareholder roles only by the owner, never changing an existing membership.
- Codes are unique across all businesses (unique index). A random code that
  collides is retried silently. A chosen code that is taken now answers
  "That code is already in use. Leave it blank for a new one." (the original
  could hand two people the same code). The page never sends a chosen code.
- `erpRevokePerson`: status `revoked`, code removed; the membership stays (so
  the row still shows, as in the original).
- `erpResetCode`: forgets all of the person's devices (they ask again), clears
  failed count and lock; `newCode` gives a fresh code.
- `erpApproveDevice` (legacy single-device column): approves the person's
  newest waiting device.
- Device decisions (`erpDevDecide_` changed the FIRST row with that device id):
  the same device id can belong to two people (shop tablet), so allow/refuse
  change the waiting row and remove changes the allowed row, of a person of
  this business only.
- `status` per person: revoked / pending (a device waits) / approved / the last
  device's status / "no device yet" - the meaning of ERP_USERS.device_status.

## Lists and config (ERP.js:2023-2190)
- Lists live in `lookups`; add/remove rewrite the whole kind sorted as before
  (case-insensitive duplicates disappear, as rewriting the column did).
- System values: rows that the sheet always had and that still mean something
  are shown with their defaults even when never saved (`business_name` =
  business name, `currency` BDT, `default_reorder` 5, `default_lead_time` 7,
  `next_invoice_num` = the live invoice counter). `n8n_webhook_url` and
  `invoice_pdf_folder_id` only show when stored (no n8n / Drive folder in the
  web app). `website_sync_key` shows as "stored privately" when the
  `CZ_SYNC_KEY` secret is set. `cost_rate / cost_handling / cost_min_margin`
  (COST_PRICES cells, not SETTINGS rows) are not listed.
- `erpConfigSet('next_invoice_num', v)` moves `invoice_counters.next_number`;
  a value that is not a whole number is refused ("next_invoice_num must be a
  whole number, e.g. 1001.") because the counter is an integer column.

## Backups (ERP.js:10885-11030)
- A backup is one JSON file with every row of this business (every public
  table with `business_id`, the business row, its people without codes and
  their devices; never `business_secrets`), saved as
  `<name> - backup yyyy-MM-dd HHmm.json` in storage `backups`. Newest 14 kept;
  other files in the folder are never touched. Recorded in `erp_backup_log`
  (was the ERP_BK_LAST property).
- Status keeps the page's shape. `folderUrl` is `''` (no Drive folder, the
  button hides), `links` is `null` (no partner links), `timer` is true only
  when a nightly backup ran in the last 36 hours - an honest stand-in for
  "the trigger exists", since the timer is now a pg_cron job outside the app.
- A second backup while one runs: "A backup is already running. Try again in a
  minute." (pg_try_advisory_xact_lock instead of LockService).
- `backupNow(ctx, 'night')` is exported for the nightly job.

## AI keys (ERP.js:11600-11720)
- Stored per business in `erp_ai_keys` (owner-only RLS): `id` k+12 hex, sha-256
  of the key, role, enabled. Key text `czai_` + 48 hex from
  `crypto.getRandomValues` (was two UUIDs, which are partly fixed digits).
  Max 20, names unique case-insensitively, events in `erp_ai_log`.

## Self-test (ERP.js:2004)
- Same rows `[{part, ms, error, size}]`, run through the ported `erpBundle`.
