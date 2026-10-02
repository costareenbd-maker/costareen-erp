# Campaigns (WhatsApp) - deliberate differences from the sheet ERP

Handlers: `supabase/functions/erp/handlers/campaigns.js`. Schema: `supabase/019_campaigns.sql`.

1. **Spread state is per campaign, so per business.** The original kept the
   state of every self-sending ("spread") campaign in ONE project-wide script
   property `ERP_CMP_STATE` (ERP.js:10450-10456), while the campaign rows lived
   in each business's own sheet, and the 10-minute timer ran against the bound
   (home) sheet only (ERP.js:10494). So spread / scheduled / lead campaigns only
   really worked for the home business. The web app keeps the state in
   `campaigns.spread` (jsonb, same keys `from,to,paused,why,fails,last,start`)
   and `campaignTick(ctx)` runs per business (the scheduler calls it for each
   business returned by `spreadBusinesses(sql)`).

2. **No 60-campaign cap on spread state.** `erpCmpStateSave_` (ERP.js:10453)
   dropped the oldest entries past 60 to keep the script property small; a
   dropped campaign silently stopped being "spread" (lost its pause state, its
   lead flags, and could then be blasted with "Send to the N still waiting").
   There is no size limit now, so nothing is dropped.

3. **A manual batch is at most 12 people, not 20.** `ERP_EVO_BATCH = 20`
   (ERP.js:10069) fit 20 x 8 s inside Apps Script's 6 minutes. An Edge
   Function has a ~150 s wall limit, so the batch is 12 (11 gaps x 8 s = 88 s
   plus the sends). The 8-second gap is unchanged. The page already loops
   until nobody is left (`campRun`, UI:4498), so the person sees no difference
   except more, shorter rounds. Also: a whole batch is one database
   transaction, so its rows become visible when it finishes; the cap keeps it
   well inside the limit so a timeout cannot roll back rows for messages that
   were really sent.

4. **Campaign ids cannot collide.** `CMP-yyMMdd-HHmmss` (ERP.js:9782) gave two
   campaigns started in the same second the same id, merging their recipient
   lists. A second one in the same second now gets `-2`, `-3`, ...

5. **"Google Sheet" product list is a CSV file.** `erpProductListShare` with
   `kind: 'sheet'` made a new Google Sheet shared by link (ERP.js:10598-10626).
   There is no Google Sheet any more: it writes a CSV (UTF-8 with BOM, opens
   in Excel / Google Sheets) with the same header `Category, Product, Brand,
   Price (BDT)` (price column left out when prices are off), the same rows and
   sort, into the `assets` storage folder, and returns the same shape
   `{kind:'sheet', fileId, name, products, url}` where `url` is a link to the
   file. The page's chip still says "Product list — Google Sheet"; that label
   is in the unchanged page.

6. **Files and links.** Drive files become Storage files in `assets`
   (`saveFile`); "anyone with the link" becomes the storage link (`fileUrl`).
   `erpShareFile` / sending an attachment only accept files in `assets`
   (a `fileId` naming another folder, e.g. backups or invoices, is refused
   with "That file is no longer there.") - the original would share any Drive
   file id it was given. Uploads (`erpEvoUpload`) are stored under a unique
   tagged name so two uploads called `Brochure.pdf` do not overwrite each
   other (Drive kept both); the page is still told the name as uploaded.
   The product-list PDF is rendered by the PDF service (`renderPdf`) from the
   same HTML; one per day per business, a re-run replaces that day's file.

7. **STOP webhook address.** The original pointed Evolution at the Apps
   Script `/exec` URL (`ERP_PUBLIC_EXEC_URL`, ERP.js:10329) and refused child
   links ("This is set up on the main business only for now.", ERP.js:10562).
   Every business is its own here, so there is no such refusal; the hook URL is
   `<SUPABASE_URL>/functions/v1/erp?biz=<business id>&hook=<secret word>`
   (`ctx.deps.hookBase` overrides the base). The word is still checked against
   the business's `ERP_EVO_HOOK` secret, so a forged `biz` gets nowhere.

8. **Locks.** The script lock becomes a Postgres advisory lock on
   (business, 'campaign'), shared by campaign creation and sending, as before:
   the timer gives up at once (`busy`), a person waits up to 20 s ("Another
   batch is still sending. Wait a moment." / "Sheet is busy. Try again in a
   moment."). It is per business now (was project-wide).

9. **Unchanged on purpose** (noted so nobody "fixes" them by accident):
   `erpLeadSave` writes the note blank when the page does not send one
   (ERP.js:9967); opting out sets waiting sends to `skipped` without touching
   their time or "by" (ERP.js:9874); lead keys that look like numbers are
   listed in numeric order (JavaScript object key order, as in Apps Script).
