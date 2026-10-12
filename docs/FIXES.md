# Deliberate differences from the sheet ERP

The web app copies the sheet ERP exactly, except where the original had a bug.
Each group lists its fixes in `docs/fixes/<group>.md`. Core fixes:

1. **Dashboard money no longer reaches staff browsers.** The original scrub deleted
   key names the dashboard no longer used (ERP.js:4384), so profit/cash/cover
   still reached sales and manager roles. Fixed in the dashboard handler.
2. **Theme and active business are per person.** The original stored them in the
   deployer's user properties, shared by everyone on the link (ERP.js:50, 2380).
3. **Unported-but-allowed actions** answer "This part is not in the web app yet"
   instead of "Unknown action" (which shows the page's stale-page banner).
4. **Owner sign-in** is email + password (was: the Google account owning the sheet).
5. **Products created on the Receive screen are no longer lost.** The page sent only
   `{sku, qty}` for each line (ErpUI.html:6086), so a new product added during
   receiving was dropped. `web/build_ui.py` patch 5 sends the draft too.
6. **Downloads use the ERP's own file links** (signed storage links), not Google
   Drive download URLs (ErpUI.html:6843, 7292) - build_ui.py patch 6.
7. **erpRebuildDues is not ported.** No screen calls it, and in the original it
   rewrote every invoice's paid figure from the PAYMENTS ledger alone, which would
   turn old cash sales (paid before the ledger existed) into debts. Calling it
   answers "This part is not in the web app yet."

## Following the sheet ERP when it changes (done for build b261002-1321, 2026-10-02)
1. Pull the live source: office VPS `/opt/czpush/payload.json` (check the staff link serves the same `ERP_BUILD`).
2. `diff` ERP.js / ErpUI.html against the copy the web app was built from (`web/original/ErpUI.html`; the previous page is kept as `web/original/ErpUI.<build>.html`).
3. Server changes -> port into `supabase/functions/erp/handlers/*` (new tabs -> a new `0NN_*.sql`), add to `allow.js` (ERP_ALLOW and ERP_READS are verbatim copies), bump `ERP_BUILD` in `core.js` and `handlers/bundle.js`.
4. Replace `web/original/ErpUI.html`, run `web/build_ui.py` (a patch that no longer matches stops the build), run every `supabase/tests/*_test.mjs`.
5. `deploy.py db`, `deploy.py function`, `deploy.py web`.

Build b261002-1321 added: the Capital screen (handlers/capital.js, 020_capital.sql) and the
kept dashboard (erpDashReady_ -> table erp_dash_cache, one copy per business and sight level;
any call not in ERP_READS, and every timer, throws it away).
Difference from the sheet: the kept copy is per sight level ('full' / 'staff'), because here the
dashboard is built differently for staff - the sheet kept one copy and scrubbed it afterwards.
