# Handover — 7 October 2026 (read after CLAUDE.md, before any work)

Written so the next session starts cold and loses nothing. Order of reading: `CLAUDE.md` (how the owner
wants to be worked with, how a stage is done, commands) → this file → `docs/CHANGES.md` (newest at the bottom)
→ `docs/NETWORK-BLUEPRINT.md` only when a network stage is touched. The auto-memory file
`~/.claude/projects/G--/memory/erp-growth-research.md` holds the same in note form plus gotchas.

## 1. Where things stand (checked live on 6–7 Oct, as the owner, through the API)

**The business is live on it.** Costareen's staff work in erp.costareen.com every day since early October:
invoices daily (latest INV-20261006-1913), 39 orders / ৳520k in October, 302 customers, 141 products,
৳4.4M stock. Users: 2 owners (Rahman via access link, Nazir), 1 manager (Mehedi: invoices, payments),
1 shareholder (never signed in). WooCommerce live (orders in, stock out), Steadfast live (parcels booked
from invoices, deliveries checked), e-mail and Drive on, WhatsApp/AI off. All 8 timers green. The old
Google Sheet still receives a copy (erp-sheet timer). **No go-live wipe happened and none is wanted now:
the imported data IS the live data.** Never wipe.

Partner: PrototypeBD (walid Mafuj) installed at prototypebd.3dowala.com (own Supabase, bridged). Example
company at erp.rmabidur.com. Release on the provider: `stage-n9` (+ page fix 53f6e05).

Every blueprint stage N0–N9 is built, tested, deployed, tagged (`stage-n1` … `stage-n9`); CHANGES.md has a
paragraph per stage. Public pages on erp.3dowala.com all answer: /check /my /doctor /find /choose /print
/design /ideas /quote /confirm /lite. **Nobody outside uses them yet.**

## 2. What is wrong in the live books (owner told 7 Oct; his call what to do first)

1. **Expenses = 0** in Aug, Sep, Oct → "net profit" is gross profit. Staff do not enter expenses.
2. **Cash book not set up**: opening balances 0, Steadfast account −৳1.23M, 35 payments unassigned to an
   account, 12 courier payouts unassigned. The Money screen total (−৳1.19M) is meaningless until fixed.
3. **May–June**: sales 0 but cost ৳782k/৳817k (imported months with units, no prices) → gross −৳1.6M in
   Profitability. Hide months before July or price them.
4. **Courier reconciliation never used**: 12 payouts pulled, 59 lines matched by phone only, 12 unmatched,
   nothing settled.
5. **Dues ৳438k**: ৳231k from "Samiul Haque Rakin [walid]" = the PrototypeBD partner buying on plain
   credit; the joint pool was never created (invite used, pools 0). Owner decides: pool or credit customer.
6. Data: 626 imported sales lines with zero value, 2 products without cost, 46 out of stock, 64 below
   reorder, 7 dead items. Capital book empty. Month lock never used. No 2FA on any owner.
7. **Backup**: timer runs, 0 files, no folder URL — unverified. Check `erpBackupStatus` / Drive.
8. Points on but 0 members ("Count past invoices" never pressed), 0 consents. Colour swatches 0 of 60.
   Families 0 of 141. Printers not marked serialised. Find stock public OFF, resellers OFF, print quote OFF
   (Costareen does not print — correct).

## 3. Open work, in the order the owner was offered it

1. **Unfinished page fix (first thing):** the Customers screen's "Points rules" / "Refill reminders"
   buttons sit ~2,400 px down (in the list bar, under the whole dues block). Commit 53f6e05 tried to move
   them beside the top "Excel" button (`lpButtons()` / `lpPanels()` in the stage-N6 block of `web/app.html`,
   selector `#view [data-xlopen="customers"]`), deployed web, but live the selector did not match (the
   Excel button is rendered by the XL wrapper; find its real attributes in the DOM) — the buttons are still
   at the bottom. Fix the selector, rebuild, `deploy.py web`, check live at phone width.
2. Owner could not find switches: they are all on Market > "What I share" (trade sharing, Find stock
   public + orders, Waiting buyers, Colour swatches, Resellers card); Customers > Points rules / Refill
   reminders; Print jobs > **Requests** tab > "Taking requests" (not Rates); Products > Warranty rules;
   Settings > Connections. A **public-page switchboard** on the Platform screen (on / off / "coming soon"
   per page) was offered — half a day — not started.
3. Books: expenses habit or an import; cash book opening balances + assign the 35 payments and 12 payouts;
   decide the partner (pool vs credit); hide/price May–June; verify backup; 2FA for owners.
4. Not built: an "other income" entry (reseller commission is not in a reseller's P&L); SMS / e-mail /
   WhatsApp notices for the network pages; VAT; other couriers; service line on invoices; name-sign maker;
   makers directory; N10 (licensed catalogue with royalty, sponsor programme, hosted ERP) — owner's call.
5. Owner decisions still open: one public name (pages carry no company name), open-content licence for
   the guides, Bangla text never read by a native speaker.

## 4. Branches, numbers, the other session

- `main` = tag `stage-n9` + 53f6e05 (page fix) and everything the peer session did (`install-free-1/2`,
  `cors-zone-1`, 7e88671); peer branch `joint-x` is level with main. Deploy only from a tree that contains
  both. **Next free migration number: 091.** `joint-x` is both a tag and a branch: use `refs/heads/joint-x`.
- The peer Claude session ("ERP system for business", worktree in its scratchpad, local API server on
  port 8794) owns installer / bridge / joint / restock; it messaged before every deploy. If it is gone, its
  work is all on `joint-x` = `main`; nothing is pending from it.
- `deploy.py release` names the release by `git describe` → tag before `release`; then update the example
  copy (`erpInstallUpdate {"id":"f7dc979f-1561-415e-bfc8-ad2d554a688f"}` until `"done":true`).
- Tests: 87 suites, all green at 53f6e05 (`supabase/tests/*_test.mjs`; loop command in CLAUDE.md §5).
