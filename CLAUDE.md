# Costareen web ERP — read this first

This file is for whichever model continues the work (it was written by Claude Fable 5.1 on
2026-10-03 for Claude Opus 5.5). It says what the system is, how the owner wants to be worked
with, how every change is made, and what is left. Read it fully before touching anything.
Then read `docs/CHANGES.md` (the log of every phase, newest at the bottom) and `docs/PLAN.md`.
The auto-memory file `~/.claude/projects/G--/memory/erp-redesign.md` holds the same history
in note form plus gotchas; keep appending to it after every stage.

## 1. What this is

A web ERP for Costareen (3D-printing supplies, printers, soon more electronics; Bangladesh)
at **https://erp.costareen.com**. It replaces a Google-Sheet ERP that staff still use every
day. Owner: Rahman. Later it may be sold to other businesses, so nothing may be
Costareen-specific where a setting would do.

- Database + API: Supabase project `oqzcuuytytqadqjlwdsh` (Singapore). One Edge Function
  `erp` (Deno) is the only door: `POST /functions/v1/erp {name, args, token}`.
- Page: `web/app.html` — one hand-written HTML file (string-built screens, `repaint()`),
  built into `web/index.html` by `web/build.py` and deployed to Cloudflare Pages.
- Access: no sign-in screen. A private link `https://erp.costareen.com/#k=<key>`; keys are
  hashed in `erp_access_keys`. **Every link is currently the owner** — per-person sign-in is
  the next job (see §7).
- Live business id `81e318e7-fbde-4fcc-9b9f-b0061fe29c14`. Live data is still the imported
  copy of the sheet; go-live wipes it (`deploy/start_fresh.py`, dry-run by default).

## 2. How the owner wants to be worked with (do not drift from this)

- He says "next" and expects the next stage done end to end: built, tested, deployed, checked
  live, recorded, committed, tagged — then a short report. **Do not ask questions** unless
  the stage truly cannot proceed; decide, do it, say what you decided.
- Replies: short, direct, candid, plain words (he is not a programmer). Say what was NOT
  done and what is risky. Never a yes-man. He runs a "caveman" terse style hook; code,
  commits and security notes are written normally.
- He judges by what is visible: a new ability must be a **visible button on the first
  screen**, not a sub-form. Three features existed but he could not find them until buttons
  were renamed (`+ Add / change accounts`, `Correct a balance`, `Receive / adjust due`).
- Never touch the live Google-Sheet ERP or the office VPS beyond reading. Never spend money,
  never delete real data, never run the go-live wipe without his explicit "wipe now".
- Do not nag about rotating tokens. Do not set passwords typed in chat.
- Money logic must be professional: nothing is deleted (struck out with a reason), every
  figure traceable, one net profit everywhere, closed months locked.

## 3. Where things are

```
supabase/0NN_*.sql                  migrations, applied in order by deploy.py db (latest: 041)
supabase/functions/erp/
  index.ts                          Deno entry: deps (storage, pdf, mail, createOwner...), linkOnly=true
  core.js                           erpCall: auth (key -> user) -> ERP_ALLOW role gate -> handler in ONE
                                    transaction as the user (RLS applies) -> scrub -> activity log
  allow.js                          ERP_ALLOW {name: minRole}; ERP_READS regex = calls that are reads
  jobs.js                           timers: nightly, campaigns, alerts, websync, deliveries (pg_cron)
  handlers/*.js                     one file per area; each exports HANDLERS; index.js merges them
  lib/time.js phone.js tabs.js      helpers; tabs.js = cached "sheet tab" views (salesLog etc.)
  lib/period.js pool.js             month lock (assertOpen), joint-pool helpers
supabase/tests/*_test.mjs           one suite per area, run against an embedded Postgres
web/app.html                        the page; new work is appended as blocks before </body>
web/build.py                        stamps ERP_API; ERP_OUT=index-local.html for local
deploy/deploy.py                    db | function | web | cron
deploy/start_fresh.py               go-live wipe (keeps products, customers, suppliers, cost book,
                                    expense items, money accounts, access keys)
deploy/new_access_link.py           issue an owner link by hand
docs/                               CHANGES.md (log), PLAN.md (roadmap), REVIEW-VS-ODOO.md,
                                    GOLIVE.md, ARCHITECTURE.md, REDESIGN.md
```

Handler shape: `export async function erpThing(ctx, payload)`; `ctx = {tx, sql, s, biz, now,
memo, deps}`. Use `ctx.tx` for everything inside the call. `ctx.sql` is a separate pool for
server-only tables (access keys) — never use it for business tables. Roles: sales < manager
< shareholder < owner (`roleAtLeast(ctx.s.role, 'manager')`). Errors are thrown as plain
sentences the owner can read; the page shows them as toasts.

## 4. How a stage is done (the pattern every stage followed)

1. **Migration** `supabase/0NN_name.sql`: tables with `business_id`, RLS using
   `business_id in (select public.my_business_ids('member'|'manager'|'shareholder'|'owner'))`,
   `grant` to authenticated. Never a delete policy unless deliberate (books are struck out).
2. **Handler** in `handlers/<area>.js` (or a new file + import/merge in `handlers/index.js`).
   Add every new name to `allow.js` ERP_ALLOW; read-only calls also into `ERP_READS` (and
   into the page's `SRV_READS` regex — keep both in step). Add a plain-English word for
   writes to `handlers/security.js` WORDS (the activity log).
3. **Tests** `supabase/tests/<x>_test.mjs` using `harness.mjs` (`owner, mgr, sales,
   shareholder` after `makeShareholder()`, `sql`, `FIX.B/B2`, `web.on` fake HTTP, `files`).
   Test refusals and the other business staying untouched. Never delete a test to pass.
4. **Page**: append a block `<!-- plan XX: ... --><style>…</style><script>…</script>` before
   `</body>`. Extend existing screens by **wrapping** their functions
   (`var viewFooOld = viewFoo; viewFoo = function () { var h = viewFooOld(); ...return h; }`)
   or `window[name]` wrappers; wire with delegated `document.addEventListener` handlers.
   Only edit old code in place for one-line hooks (payloads, routes, nav).
5. **Check**: `node syntax.mjs` on app.html; build local; run the local server; click
   through the screen in the preview browser; run **every** test suite.
6. **Deploy** db → function → web (→ cron if timers changed); verify live with one curl.
7. **Record**: paragraph in `docs/CHANGES.md` (what, what NOT done), note in the memory
   file, `git commit` (attribution line below) and `git tag plan-XX`.
8. **Report** to the owner: what changed in his words, what is not done, what needs his hand.

Commit messages end with: `Co-Authored-By: <model name> <noreply@anthropic.com>`.

## 5. Commands (Git Bash on this Windows machine)

Scratch dirs (embedded Postgres, node test runner, local server) live in
`C:/Users/Nazir/AppData/Local/Temp/claude/G--/1d0e482a-a473-40cc-9610-d474bd3f9c04/scratchpad`
(call it `$S`). If it is gone, `supabase/tests/erp_server_test.py` explains how to recreate it.

```bash
# syntax check of the page
cd $S/nodetest && node syntax.mjs G:/costareen-erp/web/app.html

# one suite
cd $S; TEST_SCRIPT=G:/costareen-erp/supabase/tests/d6_test.mjs ERP_NODE_CWD=$S/nodetest ./pgenv/Scripts/python G:/costareen-erp/supabase/tests/erp_server_test.py
# golive_test needs IMPORT_DIR=$S/sheet-export

# every suite (prints only failures)
cd $S; for t in G:/costareen-erp/supabase/tests/*_test.mjs; do n=$(basename $t); IMP=""; [ "$n" = "golive_test.mjs" ] && IMP=$S/sheet-export; r=$(IMPORT_DIR=$IMP TEST_SCRIPT=$t ERP_NODE_CWD=$S/nodetest ./pgenv/Scripts/python G:/costareen-erp/supabase/tests/erp_server_test.py 2>&1 | grep "failure(s)\|^FAIL\|Error" | tail -4 | tr '\n' ' '); echo "$n: $r"; done | grep -v " 0 failure(s) $"

# local server with the sheet's data (background; prints LINK http://localhost:8793/index-local.html#k=...)
cd G:/costareen-erp/web && ERP_API=http://localhost:8794/ ERP_OUT=index-local.html python build.py
cd $S; LINK_ONLY=1 MODE=serve IMPORT_DIR=$S/sheet-export ERP_NODE_CWD=$S/nodetest ./pgenv/Scripts/python G:/costareen-erp/supabase/tests/erp_server_test.py
# static page server: preview_start name "erp-web" (port 8793). Open the LINK with ?x=N to beat the cache.
# to restart the local server after server-side changes: kill the PID listening on 8794, start again.

# deploy (tokens: see deploy/secrets.env — not committed)
cd G:/costareen-erp/deploy; source secrets.env; python deploy.py db; python deploy.py function; python deploy.py web
# live check
curl -s -X POST https://oqzcuuytytqadqjlwdsh.supabase.co/functions/v1/erp -H "content-type: application/json" -H "x-region: ap-southeast-1" -d '{"name":"erpHello","args":[],"token":{"key":"<owner key from secrets.env>","device":"check"}}'
```

## 6. Gotchas learned the hard way

- `ERP_BUILD` in core.js and the page must stay equal (both `b261002-1321`); do not bump one.
- postgres.js: never `'\D'` inside a template — use `'[^0-9]'`. `select (fn()).*` calls the
  function once per column — use `select * from fn()`.
- Never use the main pool (`ctx.sql`) inside a handler for business tables (deadlock).
- A select joining `products` and `product_stock` must qualify `sku` (ambiguous).
- Writing files with bash heredocs breaks on quotes/backslashes — write Python patch scripts
  with the Write tool into the scratchpad and run them; use the Edit tool for single edits.
- Date columns come back as JS Dates; pass them through `formatDate(new Date(v), 'yyyy-MM-dd')`.
- The preview browser caches `index-local.html`; open with `?x=<number>`. The static server
  on 8793 can die silently: `preview_start` with name `erp-web`.
- Local Postgres fails to init when `%TEMP%/pgtest_*` piles up: delete those dirs and rerun.
- `salesLog` rows are frozen cached arrays (never mutate). `forget(ctx, 'SALES_LOG')` after
  writing invoices; `delete ctx.memo.catalog` after changing products.
- The sheet ERP keeps changing (last matched: build `b261003-0358`). Before go-live read it
  again: `ssh root@62.171.167.199 'sudo -u admin /home/admin/.npm-global/bin/gog appscript
  content 1QHIn4EOmVwIPluuXAxVNFj85vd2E8_H4Cu-zIGdsiZ3_NeoU3p--jqOS -a costareen.bd@gmail.com -j'`
  and diff `ErpUI` against `web/legacy/original/ErpUI.html` (that copy is build 1321; the
  later UI hunks are in docs/CHANGES.md under "Caught up with the sheet ERP").

## 7. Status and what is left

Done and live (tags): phases 3–7 of the port; look-2 (side menu kept, Odoo-style lists,
themes); plan A1–A7 (cost fixed at sale, one net profit, money accounts, suppliers,
currencies + landed cost, capital with per-month investor returns and a month lock,
partnership on cash basis); B1–B3 (partner access link, one inventory screen, sell from the
pool, partner deals through real invoices); C1–C5 (row buttons, one table style, fast New
invoice, dashboard tabs, one search / "?" help / folding phone menu); D4 quotation → invoice;
D3 photos + colour families; D5 notes and files; D1 serial numbers + warranty; D2 repair
jobs; D6 Excel out / in; sheet catch-up to b261003-0358.

Left, in order:
1. **Per-person sign-in, Odoo's way** (decided with the owner 2026-10-03; he rejected
   links-only because a lost phone + PC would lock him out):
   - Every user = email + password (Supabase Auth, already in the project; the sign-in
     screen was switched off with `deps.linkOnly`, not removed). Staff too. No private links
     for people any more; machine keys (AI/MCP) stay as per-user API keys.
   - Settings → Users (owner): name, email, role (sales / manager / shareholder / owner);
     the system e-mails an invitation to set a password (`deps.sendReset`); deactivate
     (history keeps the name); sessions list per user with "end this session" and
     "sign out everywhere"; optional 2-factor (authenticator app) built in, off by default.
   - "Stay signed in" per device; forgot-password by e-mail is the recovery root.
   - Role gates in `allow.js` and the scrub are already there - switch them on by giving
     each user a real role instead of owner. Activity log shows the real name.
   - Migrate the owner's current link to his e-mail account FIRST so he is never locked
     out; partner companies use the same system (owner of their own company only).
   - Then a **platform admin panel** (Odoo's database manager) for the owner as vendor:
     businesses list / create (first owner invited by e-mail) / suspend; resend an
     owner's reset link; health (erp_errors, last activity, timers, storage). No
     "log in as" by default; if ever built, time-limited and written to that business's
     activity log. Platform admin has no role inside a customer's business.
2. **Go-live** (`docs/GOLIVE.md`): re-read the sheet, run `start_fresh.py` only on his
   "wipe now", set the invoice counter to last sheet number + 1, opening balances for money
   accounts, stock count, the few supplier dues, confirm colour families and serial flags,
   hand staff their links, sheet becomes read-only backup.
3. Only if he asks: D7 other couriers, D8 VAT, and the small leftovers listed at the end of
   the latest CHANGES.md entries (service line on invoices, job slip, photos in the price
   list PDF, "invoiced" mark on quotations, Excel on Stock/Money, P&L line for repairs).

Things live but waiting for his hand: colour families (16 suggested, not grouped), printers
not yet marked serialised, "Check deliveries now" not yet pressed against real Steadfast.

## 8. Quality bar

Every stage ships with tests (the suites are green at the last tag — keep them green), is
checked on screen (desktop and phone width), is deployed, and is written down. If something
cannot be finished properly, ship the honest smaller piece and say exactly what is missing —
never a half-feature that looks done.
