# The ERP on this computer

Everything runs here: the database, the API (the same code as the live Edge Function) and the web page.
Nothing touches Supabase or the live ERP. Two developers can each run their own copy of this folder.

## Once

Needs Python 3.12 and Node 20+ on the PATH.

    local\setup.cmd

## Every time

    local\start.cmd

It prints a line `LINK http://localhost:8793/index-local.html#k=...` - open that in the browser; that is the owner.
Only the link signs in (owner e-mail sign-in is not simulated here). Ctrl+C stops it. The data stays in `local/data`.

    local\start.cmd --fresh      throw the local database away, build it again with fresh demo data
    local\start.cmd --no-seed    first build with an empty business (no demo data)
    local\stop.cmd               stop a server left running

## What is where

| Piece | Here | Live |
|---|---|---|
| Database | embedded Postgres in `local/data` | Supabase project |
| API | `node supabase/tests/local_server.mjs` on :8794 | Edge Function `erp` |
| Page | `web/index-local.html` (built from `web/app.html` with `ERP_API=http://localhost:8794/`) on :8793 | Cloudflare Pages |
| Data | demo data written by `local/demo.mjs` - a made-up shop, nothing real | the live data |
| Mail, PDF, files | the test harness's fakes (printed / kept in memory) | Gmail SMTP, PDF service, Supabase Storage |

Supabase Auth (owner e-mail sign-in) is not simulated: the owner is the printed link.
The public pages (creator, sponsor, find, ...) work with `?api=http://localhost:8794/` added to their address.

## Confidential data

None. This folder holds no customer, supplier, price or cost of the real business: the database is built from
`demo.mjs` (made-up names, phones, products, prices). Do not copy a real export or the live backup into it.
The owner alone may load a real export on his own machine with `set ERP_SEED_DIR=<folder>` before `start.cmd`.

## Working on the code

- Server code: `supabase/functions/erp/**` - restart `start.cmd` after changing it.
- Page: `web/app.html` - `start.cmd` rebuilds `index-local.html`; while it runs, rebuild by hand with
  `cd web && set ERP_API=http://localhost:8794/&& set ERP_OUT=index-local.html&& python build.py` and reload with `?x=<n>`.
- Syntax check of the page: `node local\node\syntax.mjs web\app.html`.
- Tests: see `CLAUDE.md` section 5 (they use their own throwaway database, not `local/data`).
- New migration: add `supabase/NNN_name.sql`; `start.cmd` applies the new file on the next start.

## Going live

Unchanged: `cd deploy && source secrets.env && python deploy.py db|function|web`. The same files are deployed;
only `ERP_API` differs between the local build and the live build.
