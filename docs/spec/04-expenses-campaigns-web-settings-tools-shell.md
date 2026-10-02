# Spec 04 — Expenses, Campaigns, Web orders, Settings, Tools + the global Shell

Source of truth (read-only): `sheet-erp/ErpUI.html` (UI), `ERP.js`, `Code.js`, `API.js`, `appsscript.json`.
Citations are `file:line`. `UI` = ErpUI.html. Secrets are written as `<secret>`.

Conventions used throughout the UI (apply to every screen below):
- `fmt(n)` = `Math.round(n).toLocaleString('en-US')` (UI:630). `compact()` = Cr/L/k (UI:631).
- All HTML is built as strings and re-rendered by `repaint()` (UI:9382). Every server call goes through `srv(name,args,ok,bad)` (UI:8060) → `erpCall(token, name, args)` (ERP.js:4285).
- Currency label on screens = `OPT.currency` which the server always returns as `'BDT'` (ERP.js:803); fallback `'BDT'`.
- Errors from the server are shown as a red toast (`toast(msg, true, ms)`), usually 12 000 ms.
- `window.confirm` / `window.prompt` are used as modals for most destructive actions (exact texts below).

---------------------------------------------------------------------

## PART B — THE GLOBAL SHELL

### B1. Hosting / entry points

| Entry | Behaviour | Cite |
|---|---|---|
| Sheet menu `[+] Inventory v5` → `📊 Open ERP Dashboard` | `showErp()` opens `ErpUI` as a 1800×1100 modal dialog titled "Costareen ERP" inside the spreadsheet | ERP.js:107, Code.js:3274 |
| Web app `doGet(e)` | No params → serve `ErpUI` (title "Costareen ERP", viewport meta). `?door=1` → JSON `{door:'OPEN'|'closed'}` = whether a caller with no code would pass `erpDoor_` | ERP.js:1817-1830 |
| Web app `doPost(e)` | JSON body. If `body.event` and no `body.key` → WhatsApp (Evolution) webhook (`erpWaHook_`). Otherwise AI/MCP request `{key, fn, args, confirm}` → `erpAiCall_`. Response always JSON `{ok, result}` or `{ok:false,error}` | ERP.js:11860-11871 |
| `showErpLink()` (menu "🔗 Get the ERP link (for phone)") | Modal with the deployment URL (`ScriptApp.getService().getUrl()`, fallback constant) + copy textarea | Code.js:4073-4097 |
| `appsscript.json` | timeZone `Asia/Dhaka`; webapp `executeAs: USER_DEPLOYING`, `access: MYSELF` (as committed); scopes: spreadsheets, drive, external_request, scriptapp, userinfo.email, script.projects, script.deployments | appsscript.json |
| API.js | Two orphan helpers `searchProduct_`, `recordSaleFromApi_` (unreferenced by anything; legacy). Comment in ERP.js:80 says doGet answers `?action=` as JSON API — **not implemented** any more | API.js:1-2 |

Notes for rebuild:
- Code comments repeatedly refer to a "staff link open to anyone" (ANYONE_ANONYMOUS) (ERP.js:4343). Child (per-business) deployments are forced to `{executeAs: USER_DEPLOYING, access: ANYONE_ANONYMOUS}` (ERP.js:3917-3922).
- **Because the web app executes as the deployer, `PropertiesService.getUserProperties()` is the deployer's store for everyone.** So the "per person" theme (`cz_theme`) and the active business (`cz_active_business`) are in fact shared by all users of a deployment (ERP.js:50, 2380, 2739). In Supabase: store theme per user and active business per user/session.

### B2. Layout (DOM order) — UI:482-536

1. `<script>` before paint: theme = `localStorage.cz_theme || 'dark'`; sets `html[data-theme]` to `light` or `dark` (dark is DEFAULT) (UI:487-491).
2. `#dbg` debug strip (hidden unless `?debug=1`), `#tip` tooltip, `#toast`.
3. `.app#app` (flex):
   - `.backdrop#navBackdrop` (mobile overlay)
   - `aside#side` (sticky sidebar, width 238px):
     - `.brand`: `.logo#bizMark` (first letter of business name, or `<img>` of the logo with class `has-img` 42×42 white box) + `h1#bizName` (default "Costareen") + `span.tag` "ERP".
     - `nav#nav` — group labels and 14 buttons (see B3).
     - `.sidefoot`: `span#whoami` ("<name> · <roleLabel>", hidden if no name) + `button#signoutBtn` "Sign out" (hidden by default).
   - `.main`:
     - `header.topbar` (sticky, blurred translucent): `button#menuBtn` "☰" (mobile only) · `div#pageTitle` ("Dashboard") · `div#stamp` ("loading…") · spacer · `select#bizSel` (business switcher) · `button#themeBtn` ("Dark") · `button#reloadBtn` "Refresh".
     - `div#view` (content; initially "Reading the sheet…").

### B3. Navigation — 14 tabs, order, labels, groups, badges (UI:501-521)

| # | Group header | data-view | Label | Badge element & rule | Min role to see (applyRole, UI:9834) |
|---|---|---|---|---|---|
| 1 | Overview | `dash` | Dashboard | — | shareholder (3) |
| 2 | Sell | `invoice` | New invoice | `#cCart` = number of cart lines (`CART.length`) (UI:9443) | any (sales) |
| 3 | Sell | `sales` | Sales | `#cSend` = parcels waiting to send: `SALES.waiting` if loaded, else count of `ORDERS[i].postable` (UI:6371) | any |
| 4 | Sell | `weborders` | Web orders | `#cWeb` = count of WEB orders with `!entered` (UI:9446-9450) | manager (2) |
| 5 | Sell | `quotes` | Quotations | — | any |
| 6 | Sell | `customers` | Customers | — | any |
| 7 | Sell | `campaigns` | Campaigns | — | manager |
| 8 | Goods | `products` | Products | `#cProducts` always blank (UI:9445) | any |
| 9 | Goods | `stock` | Stock entry | — | manager |
| 10 | Goods | `costs` | Product cost | `#cCosts` = number of edited-but-unsaved price-book rows (UI:8498) | shareholder |
| 11 | Money | `profit` | Profitability | — | shareholder |
| 12 | Money | `expenses` | Expenses | — | shareholder |
| 13 | System | `settings` | Settings | — | shareholder |
| 14 | System | `tools` | Tools | — | shareholder |

Each button has an 18px stroke SVG icon (exact paths in UI:503-520). Badges: pill, accent bg, white text, hidden when empty (`.count:empty{display:none}`).
Selected button: `aria-selected="true"`, accent-soft background, accent text.
Group headers (`.navgrp`) are hidden when every button under them is hidden (UI:9842-9847).

`go(view)` (UI:9453-9491):
- sets `VIEW`, toggles `aria-selected`, sets `#pageTitle` = button text with trailing digits (badge) stripped; closes mobile drawer; `scrollTo(0,0)`; `repaint()`.
- Lazy loads on entry: customers → `loadCustomers` if `!CUST||!DUES`; profit → `loadMoney`, always `loadPnl`; expenses → `loadExpenses` if `!EXP && !EXP_ERR`; sales → `loadSales`; quotes → `loadQuoteBoot`; **campaigns** → restore `CP.openMode` from `localStorage.czwa_mode`, `cpLoad()` if `!CP.aud`, `loadQuoteBoot()` if needed (for `{business}`); stock → plan/PO/history; **settings** → `loadKeyStatus()` if `!SFKEYS`, `loadSettings()` if `!SETTINGS`, `loadAdmin(false)`; **weborders** → `loadWeb()` if `!WEB`, `loadCourier()` if `!COURIER && !COURIER_ERR`; costs → `loadCosts`; products/stock → `loadLists`.
- `repaint()` dispatch table (UI:9383-9397); unknown VIEW falls back to legacy `viewOrders()`. After setting HTML it wires per-view handlers inside try/catch; a wiring exception shows toast `Screen wiring failed on "<view>": <msg>` (15 s) (UI:9434-9438). Parcel confirmation box (`#parcelbox`) is re-appended to `<body>` on every repaint if `PARCEL` is set (UI:9416-9423).

### B4. Identity, login, roles (owner vs staff)

**Roles** (ERP.js:3971-3979): `owner` rank 4 "Owner", `shareholder` 3 "Shareholder", `manager` 2 "Manager", `sales` 1 "Sales". Discount cap %: owner 100, shareholder 100, manager 10, sales 5.

**Client token** sent with every call (UI:8054): `{ code: localStorage.erp_code, device: localStorage.erp_device_id, label: navigator.userAgent.slice(0,60) }`. Device id is created once: `'d' + random36 + random36 + Date.now().toString(36)` (UI:8030-8040).

**Boot** (UI:9645 → `signIn()` UI:9808): calls `erpHello(token)` directly (the only call not routed through `erpCall`, UI:8106). Server `erpMe` (ERP.js:4131-4160):
- device locked (`erplock_<device>` script property in future) → `{ok:false, reason:'LOCKED', message:'Too many wrong codes. Try again in 15 minutes.'}`.
- `erpAuthenticate_` (ERP.js:4033-4076):
  1. **Owner, implicit**: no code AND `Session.getActiveUser().getEmail()` equals the Drive owner of the active sheet (cached 600 s in `erp_owner_<sheetId>`) → `{role:'owner', name:'Owner', implicit:true}`. On an anonymous link active user is empty → must use a code (ERP.js:4110-4123).
  2. No code → `NO_CODE`; no device → `NO_DEVICE`.
  3. Find user in `ERP_USERS` by exact `code`; none → record bad attempt (`erpbad_<device>` counter; ≥5 → `erplock_<device>` = now+15 min) → `BAD_CODE`.
  4. `locked_until` in future → `LOCKED`; role not one of 4 → `NO_ROLE`; `device_status == 'revoked'` → `REVOKED`.
  5. `erpDevCheck_` (ERP.js:4795): device row in `ERP_DEVICES` for (user_id, device_id): missing → append `[deviceId, userId, label, 'pending', now,'','','']` and throw `PENDING`; `approved` → update `last_used`, OK; `denied` → `DENIED`; `revoked` → `DEVICE_REVOKED`; else `PENDING`.
  6. Write `last_used`, reset `failed` to 0.
- Success → `{ok:true, role, roleLabel, name, implicit, discountCap}`; failure → `{ok:false, reason, message}` with messages (ERP.js:4144-4157):
  NO_CODE "Enter your code to start." · NO_DEVICE "This browser could not be identified. Try again." · BAD_CODE "That code is not recognised." · LOCKED "Too many wrong codes. Try again in 15 minutes." · REVOKED "Your access has been withdrawn." · NO_ROLE "Your access has not been set up yet. Ask the owner." · PENDING "Your request has been sent. The owner has to allow this device before you can start." · DENIED "This device was refused. Speak to the owner." · DEVICE_REVOKED "This device is no longer allowed. Speak to the owner." · OTHER_DEVICE (unused) · fallback "Could not sign you in."

**Gate screen** (UI:9742-9805) — shown when `erpHello` is not ok; sidebar and nav hidden (`display:none`):
- Card centred (max 360px): title = first business name or "Costareen"; sub "Enter your code to start."; error note (red) with `ME_MSG` if any; input `#gate_code` (`inputmode=numeric`, `maxlength=6`, placeholder `000000`, big spaced digits); button `#gate_go` "Start" (shows "Checking…" + disabled while busy); footer "Do not have a code? Ask the owner to add you in Settings."
- Submit (click or Enter): strip non-digits; `< 4` digits → "Type the code you were given."; else save code to `localStorage.erp_code`, call `erpHello`; ok → `ME=res`, `startApp()`; not ok → clear stored code, show message.
- `startApp()` shows nav/side, wires Sign out once, `applyRole()`, `loadAll(true)`.

**Sign out** (UI:9794): confirm "Sign out on this device?" → remove `erp_code`, `ME=null`, show gate. Button only visible when `!ME.implicit` (implicit owner has no code to forget).

**applyRole()** (UI:9828-9863): role default `'owner'`; hides nav buttons per B3 table; hides empty groups; `#whoami` = `name · roleLabel`; `#bizSel` visible only for rank ≥ 2 (manager+); landing view: rank ≥3 → `dash`, else `products`; if current VIEW not permitted → home.

**Server gate (authoritative)**:
- `erpCall` (ERP.js:4285-4305): `ERP_ALLOW[fn]` must exist (else `Unknown action: <fn>` — which the UI treats as "page is stale", showing the red stale banner, UI:8083); authenticate; `erpRoleAtLeast_(role, need)` else "Your account does not have access to that."; sets `ERP_SESSION`; runs via whitelist `erpFunctionTable_()` (ERP.js:4605); passes result through `erpScrub_`; any exception logged to `ERP_ERRORS`.
- `erpDoor_` (ERP.js:4355-4370) sits at the top of every server function: allowed if `ERP_SESSION` set (came through erpCall), or active user == effective user (owner on own link / sheet menus), or a real trigger (`ev.triggerUid` matches a project trigger); else "Sign in to the ERP first." `onOpen`/`onEdit` call `erpDoorTrust_()`.
- `erpScrub_` (ERP.js:4384-4447) for roles below shareholder: products lose `cost, cost_price, margin, profit, stockValueCost, landed`; sales role also loses `supplier`; `erpBusinesses` for sales trimmed to the active business only (`single:true, canAdd:false`); `erpBundle` → catalog scrubbed, dash loses `profitToday, profitMonth, profitWeek, profitAll, marginMtd, stockValueCost, potentialProfit, grossProfit`, topProducts `.profit`, stockByCat `.cost/.uncosted`, sets `dash.hideProfit=true`, and **`costs` is deleted**.
- Full `ERP_ALLOW` table: ERP.js:4177-4246 (reproduce exactly in RLS/edge-function guards). Items relevant to this spec are quoted in each screen section.

**Known gaps to preserve or fix (document, do not silently change):**
- `loadAll` requests `dash` and `weborders` in `erpBundle` for every role (bundle needs only `sales`), so a Sales user receives dashboard figures (minus scrubbed keys) and all website orders even though those tabs are hidden.
- `erpTool` requires shareholder; the Web-orders button "Check the website for new orders" calls `erpTool('pullOrders')`, so a **Manager** (who can see Web orders) is refused.
- `erpExpenseVoid` requires **owner**; shareholders see the "Strike out" button but are refused.
- `erpTool('prepareTemplate')` is reachable by a shareholder (it calls `erpPrepareTemplate` internally, bypassing that function's owner-only entry) and it **deletes ALL script properties and ALL triggers of the project** (ERP.js:2205-2236) — i.e. the business registry, website key, courier keys, AI keys, backup timer. Danger.
- `erpCanAdd_` checks `Session.getEffectiveUser()` (the deployer) against the home sheet owner/editors (ERP.js:2333-2355), so in the deployed app it is effectively always true; the server still requires owner for `erpCreateBusiness/erpDeployBusiness`.

### B5. Business switcher (multi-business)

- Registry: script property `cz_businesses` = JSON `[{id, name}]`; default `[{id: ERP_HOME_ID, name:'Costareen'}]` (ERP.js:2256-2266). Active business: user property `cz_active_business` (ERP.js:2254).
- `erpBootstrap_()` (ERP.js:39-74) binds the active spreadsheet for each call: child deployment (`ERP_CHILD_SHEET_ID` defined in generated `BusinessConfig` file) → that sheet only; else active id (or first registry entry / home); if it cannot be opened, the first openable one; none → "You do not have access to any business sheet yet. Ask the owner to share one with you."
- `erpBusinesses()` (ERP.js:2298-2330) → `{businesses:[{id,name}], active, canAdd, single?, theme}`. Child link → single business, `canAdd:false, single:true`. Managers (session with code and role < shareholder) only see businesses whose `ERP_USERS` contains their code with a role (`erpCodeBelongsTo_`, ERP.js:2281).
- UI `applyBusinesses(b)` (UI:9875-9894): fills `#bizSel` with options (selected = active); if `canAdd` appends `+ Add a business…` (`__new`); empty → "No business shared with you"; sets `#bizName`, brand letter, loads logo (`brandLoad`), applies `b.theme`.
- Change handler (UI:9596-9608): `__new` → load businesses, `go('settings')`, toast "Add the new business at the bottom of Settings."; otherwise `switchBusiness(id)` → `erpSetBusiness(id)` (manager+; ERP.js:2357: must be in registry, openable, and for coded managers belong to them; writes user property) → toast "Switched to **<name>**.", clears D/CAT/CUST/ORDERS/LISTS/HIST/WEB/SETTINGS/OPT/CART/RECV/forms, `loadAll()`. On error toast + `loadBusinesses()`.

### B6. Data loading, bundling, the call queue

**srv queue** (UI:8003-8114): strictly one call at a time (`SRV_Q`, `SRV_BUSY`), `srvPump()` shifts the next job, starts a watchdog timer; timeout per function = `SRV_SLOW[name]` or 45 000 ms. Timeout message: "The sheet did not answer within N seconds. It may be busy - press Refresh to try again." Success/failure handler exceptions → toast "Display error: …". Error with `Unknown action` → stale banner.
`SRV_SLOW` (ms): erpPoCreate 90000 (declared twice; last wins), erpPoArrive 180000, erpPoDiffDecide 120000, erpBackupRun 300000, erpBackupStatus 90000, erpCourier 120000, erpBookParcel 120000, erpBookedParcels 180000, erpCourierTest 60000, erpBundle 120000, erpAdmin 90000, erpCustomers 90000, erpMergeCustomers 300000, erpTool 300000, erpDeployBusiness 300000, erpCreateBusiness 300000, erpSelfTest 180000, erpApplyReorderLevels 180000, erpMoney 180000, erpReorderPlan 180000, erpExpenses 120000, erpExpenseExport 180000, erpSales 120000, erpFixInvoice 90000, erpCancelInvoice 180000, erpPnl 180000, erpSfPayouts 240000, erpStatementPdf 120000, erpQuoteSave 120000, erpQuoteAssetUpload 120000, erpCampaignAudience 120000, erpCampaignCreate 120000, erpEvoSendBatch 330000, erpEvoUpload 120000, erpProductListShare 120000, erpWaProductPdf 120000, erpReturnGoods 180000, erpInvoicePdf 90000, erpReturnPreview 90000, erpCreateInvoice 240000, erpEnterWebOrder 240000, erpVoidInvoice 180000 (UI:8007-8021).

**erpBundle(parts)** (ERP.js:1944-2001) — one execution returning many sections:
- Side effects first: `erpBackupEnsure_()` (≤ every 6 h) and `erpRenderKey_()` (pair with PDF renderer), both swallowed on error.
- Default parts: dash, catalog, lists, customers, invoices, history, weborders. Supported parts → functions: `biz`→erpBusinesses, `dash`→erpDashboardData, `catalog`→erpCatalog, `lists`→erpSettingsLists, `options`→erpFormOptions, `customers`→erpCustomers, `invoices`→erpRecentInvoices(60), `history`→erpStockHistory(60), `weborders`→erpWebOrders, `dues`→erpDues, `settings`→erpSettingsFull, `costs`→erpCostBook (last two read without memo).
- Output `{ok, took:{part:ms}, errors:{part:msg}, today:'yyyy-MM-dd' (Dhaka), build:'b261002-0449', total, <part>:data}`; each part wrapped in try/catch (failure → `null` + `errors[part]`).
- `ERP_MEMO` caches each tab's `getValues()` for the duration of the bundle (ERP.js:157-179).
- If total > 2500 ms → append row to hidden tab `ERP_SPEED` `[at, who, parts, total_ms, took(JSON), build, steps(JSON)]`, trimmed (delete 200 rows when > 400) (ERP.js:1992-1999).

**UI loaders** (UI:9912-9940, the later definitions win):
- `loadAll(first)`: shows "Loading…"; call 1 `erpBundle([ 'biz' (first only), 'dash','catalog','lists','options'])` → `applyBusinesses(b.biz)`, `applyBundle(b)`; then call 2 `erpBundle(['customers','invoices','history','weborders'])` → `applyBundle`, `settleEmpties()`. Failures → `bundleFail`.
- Single-section loaders: `loadOrders`(invoices), `loadCustomers`(customers+dues), `loadHistory`, `loadWeb`(weborders), `loadLists`, `loadSettings`(settings), `loadCosts`, `srvOpt`(options).
- `applyBundle(b)` (UI:9670-9713): build mismatch → stale banner; assigns D/CAT/LISTS/OPT (and defaults FORM.source/method/status to the first options)/CUST/ORDERS/HIST/WEB/SETTINGS/TODAY_STR/COSTS/DUES; per-section error assignment so nothing spins forever; dash error → toast "Dashboard: …"; `updateCounts()`, `repaint()`. Stamp text: `as of <generatedAt> · <monthLabel> to date`.
- `settleEmpties()` turns remaining nulls into `[]`/`{}` with messages "No response for customers." / invoices / stock movements.
- `bundleFail(e)`: settleEmpties + toast "Could not load from the sheet: <msg> Retry" (link `#tRetry` → loadAll) 20 s.

**Stale build banner** (UI:9660-9668): fixed red bar at top: "The ERP was updated while this page was open. Close this tab and open the ERP again (or press Ctrl+Shift+R) before you do anything else." Triggered when `bundle.build !== ERP_BUILD` ('b261002-0449', same constant ERP.js:4316) or an `Unknown action` error.

**Refresh button** (UI:9610-9616): nulls D, CAT, ORDERS, CUST, WEB, HIST, LISTS → repaint → `loadAll()`; also reloads customers/history/orders if that view is open.

### B7. Theme / dark mode
- CSS variables (UI:22-44). Light: plane #f4f6f9, surface #fff, ink #0f172a, ink-2 #334155, muted #64748b, grid #e8ebf1, baseline #cbd2dc, ring #e3e7ee, field #fff, series-1 #2f6fed / soft #e6eefc, good #16a34a / soft #e7f6ec, warning #d97706 / soft #fdf1df, serious #ea580c, critical #dc2626 / soft #fdeaea, up #15803d. Dark: plane #0b0e14, surface #141822, ink #f1f5f9, ink-2 #cbd5e1, muted #8b96a8, grid #232a37, baseline #343d4d, ring #252c3a, field #0f1319, series-1 #5b8def / #1a2c52, good #22c55e / #10301d, warning #f59e0b / #3a2a0b, serious #fb923c, critical #ef4444 / #3d1515, up #4ade80. Font Inter 400-800 (Google Fonts), 14px/1.45.
- Default dark. `applyTheme(t)` (UI:9625): sets `data-theme`, button label = the OTHER mode ("Light" when dark), saves `localStorage.cz_theme`. Click → toggle, `erpSetTheme(now)` (sales+; saves user property `cz_theme`, ERP.js:2737) and repaint. Server theme returned in `erpBusinesses().theme` overrides on load (`erpGetTheme`, default 'dark').
- In dark mode toast and tooltip invert to light background (UI:292-294).

### B8. Toasts, tooltips, notes, empty/loading states
- `toast(html, bad, ms)` (UI:664-671): single `#toast` element, bottom-centre, dark pill with 4px left border green (ok) or red (bad); default 5000 ms (ok) / 7000 ms (bad); HTML allowed (links). Mobile: full width at bottom with 12px gutters.
- Tooltip: elements with `data-tip` HTML get a following tooltip (`bindTips`, UI:656).
- `.note` (left border warning) variants `.err` (critical), `.ok` (good), `.warn`. `.empty` muted centred text; `.loading` centred 70px padding text.
- Pills: `.pill` (neutral), `.ok` green, `.low` amber, `.out` red.

### B9. Mobile behaviour (UI:296-326)
- ≤960px: sidebar becomes off-canvas fixed drawer (left −258px → 0 when `.app.navopen`), `☰` menu button visible, backdrop click closes; topbar padding 8/14; view padding 14.
- ≤640px: stamp hidden; cards padding 14 radius 12; KPI value 23px; buttons min-height 42; inputs font 16px min-height 44 (no iOS zoom); toast full-width; biz select max 120px; page title ellipsis.
- Navigation (`go`) always closes the drawer.

### B10. Print
- Global `@media print { #side, .topbar { display:none } }` (UI:327).
- Quotation/letter printing: separate `#qz_print` container; print CSS hides everything else and prints A4 pages (UI:428-436, 3005, 3588) — specified in the Quotations spec.

### B11. Global search & keyboard shortcuts
- **No global search exists.** Searches are per screen only.
- **No keyboard shortcuts.** Only Enter handlers: gate code (UI:9788), Settings list "Add" inputs (UI:9330), quotation list search (UI:3021), Sales search (UI:4787).

### B12. Debug strip (`?debug=1`) — UI:7943-7998
Polls every 500 ms. Shown only if URL has `debug=1` AND (a call has run > 12 s OR last message is an error). Content: `queue <job> running Ns | waiting N | busy`, `data cat:N lists:ok cust:N inv:N hist:N web:N`, `done` list of last 6 calls with seconds, and last error line.

### B13. Self-test / diagnostics
- UI `runSelfTest()` (UI:9943-9965): toast "Running diagnostics…" → `erpSelfTest()` → table into `#selfTestOut`: columns **Section | Time (ms, right) | Rows (right) | Result** (✓ OK green pill / ✕ <error> red pill). Failure → red note.
- Button `#selfTestBtn` "Run diagnostics" lives in a "Diagnostics" card at the bottom of the **Products** view (UI:1181-1184), but it is only wired inside `wireTools()` (UI:7894), which runs only on the Tools view where the button does not exist → **the button currently does nothing** (bug).
- Server `erpSelfTest()` (shareholder, ERP.js:2004-2020): runs `erpBundle(['dash','catalog','lists','options','customers','invoices','history','weborders'])` and returns `[{part, ms, error, size}]` (size = array length or 1).

### B14. Brand / logo (shell part)
- Sidebar logo is the business's quotation-profile logo. `brandLoad(bizId)` (UI:2456): reads cached `localStorage['cz_brand::<bizId>'] = {id, src}`, paints, then `erpBrandLogo({have:id})` (sales+, ERP.js:10842): returns `{id:'',data:''}` if none; `{id, data:null, trim}` if browser already has it; else `{id, data:'data:<mime>;base64,…', trim}` (only if id is in `QUOTE_SETTINGS.assets`). New data → `imgTrim(..,160)` small copy cached. If owner/shareholder and no trimmed copy exists (`trim:false`) the browser crops the logo (700px) and uploads `erpQuoteAssetUpload({kind:'logoTrim'})` (UI:2474-2484).
- Without logo → first letter of business name, uppercase (UI:2436).

### B15. Triggers / scheduled jobs (all time-based, project-wide)

| Handler | Schedule | Created by | Does | Cite |
|---|---|---|---|---|
| `erpNightlyBackup` | daily 03:00 Asia/Dhaka (trigger id in prop `ERP_BK_DAILY`) | `erpBackupTimer_(true)` via `erpBackupEnsure_` (first bundle every 6 h) or "Back up now" | (1) delete the one-off catch-up trigger if `ERP_BK_ONCE`; (2) `erpBackupNow_('night')`; (3) `erpSfNightly_()` (Steadfast payouts sync for every business with keys; note stored in `ERP_SF_NIGHT::<sheetId>`); (4) `erpChildrenSync_()` (redeploy partner links whose code stamp differs) | ERP.js:10945-10974 |
| `erpNightlyBackup` (one-off) | `after(60 s)` | `erpBackupEnsure_` if last backup > 36 h and no `ERP_BK_ONCE` | catch-up backup | ERP.js:10981-10997 |
| `erpCampaignTick` | every 10 min | `erpSpreadTimer_(true)` when a spread campaign is started/resumed/retried; deleted when nothing is waiting anywhere | sends spread WhatsApp campaigns (see A2.6) | ERP.js:10460-10525 |
| `czSyncCycle` | every 15 min | sheet menu "Turn automatic sync ON" (`enableWebsiteSync`) | `pullWebOrders()` then `pushStockToWebsite('apply')` | Code.js:4040-4067 |
| `refreshStockView` | hourly | menu "Enable Auto Refresh (hourly)" (`enableAutoDashboard`) | rebuild STOCK_VIEW | Code.js:2876-2882 |
| `refreshDashboard` | (retired) | — | any such trigger is deleted by `erpBackupEnsure_` | ERP.js:10986-10990 |
| `onOpen` / `onEdit` | simple triggers | — | build sheet menu; ENTRY_FORM smart detection | Code.js:3274, 505 |

Supabase equivalents: pg_cron jobs / scheduled edge functions for backup (pg_dump/export), Steadfast payout sync, campaign tick (10 min, Dhaka 10:00-20:00), website pull/push (15 min).

### B16. AI / MCP access (doPost)
- Keys stored in script property `ERP_AI_KEYS` as JSON list `{id:'k'+12hex, name, role, hash: SHA-256(key), on, created(ms), lastUsed(ms)}`; key text format `czai_` + 48 hex, shown once (ERP.js:11682-11701). Max 20 keys; unique names (case-insensitive).
- Request `{key, fn, args, confirm}` (ERP.js:11776-11853): key must match `/^czai_[0-9a-f]{48}$/` and a stored hash; must be `on`; role valid. `lastUsed` updated at most every 10 min. `fn==='whoami'` → `{name, role, roleLabel, discountCap, can:[fn…]}`.
- Allowed functions `ERP_AI_TOOLS` (ERP.js:11610-11622): read: erpDashboardData, erpCatalog, erpProduct, erpToday, erpDaySales, erpSales, erpCustomers, erpLookupCustomer, erpCustomerAccount, erpDues, erpMoney, erpPnl, erpReorderPlan, erpPoList, erpWebOrders, erpSfPayouts, erpBookedParcels, erpParcelPreview, erpStockHistory, erpExpenses, erpInvoicePdf. write: erpCreateInvoice, erpSaveCustomer, erpReceiveStock, erpSettleDue, erpTakeAdvance, erpExpenseAdd, erpEnterWebOrder, erpBookParcel, erpAdjustStock (owner). Needed role = tool's 3rd word or `ERP_ALLOW[fn]`; `erpSettleDue` with reason ≠ 'payment' needs owner.
- Writes are two-phase: first call (no confirm) → `erpAiPreview_` → `{needsConfirm:true, confirm:<ticket>, preview, say:'Nothing has been done yet…'}`; ticket stored in CacheService `aic_<ticket>` = SHA-256(id|fn|args) for 600 s; second call with matching ticket runs it. Mismatch/expired → error.
- Runs with `ERP_SESSION = {role, name:'AI: <name>', userId:'ai:<id>', ai:true}`; output scrubbed by role; every call logged to hidden tab `ERP_AI_LOG` `[at, key, role, action, result, detail]` (trim 1000 rows when > 3000).
- MCP address shown to the owner: `https://mcp.bendar.duckdns.org/mcp` (ERP.js:11607). (The MCP server itself is external; it posts to this doPost.)
- Invoice PDF renderer (same host): `POST https://mcp.bendar.duckdns.org/render/pair {secret}` once (stored in script prop `ERP_RENDER_KEY`; refusal cached 1 h `erp_render_nopair`), then `POST /render/pdf {html, footer}` with header `X-Render-Key: <secret>` (ERP.js:11433-11467).

---------------------------------------------------------------------

## PART A1 — EXPENSES (`data-view="expenses"`)

Role: nav visible for shareholder+ (UI:9834). Server: `erpExpenses`, `erpExpenseAdd`, `erpExpenseItemSave`, `erpExpenseItemEnd`, `erpExpenseFixedPay`, `erpExpenseRecurringSet`, `erpExpenseExport` = shareholder; `erpExpenseVoid` = **owner** (ERP.js:4223-4226).

State: `EXP` (month payload), `EXP_MONTH` ('' = current), `EXP_ERR`. Load: `loadExpenses()` → `erpExpenses({month: EXP_MONTH})` (UI:6718).

### A1.1 Layout (UI:6551-6708)
States: error → red note "Could not read the expenses.<br>msg"; not loaded → "Reading the expenses…".

1. **Month bar** (row): `#ex_prev` "← Earlier" (small) · bold month label (`e.label`, e.g. "October 2026", min-width 150, centred) · `#ex_next` "Later →" (disabled when `e.isCurrent`) · spacer · `#ex_xls` "Download as Excel".
2. **Missing warning** (if `e.missing>0`): amber note "**N recurring bill(s) not entered for <label>.** The totals below leave it/them out until you type the amount."
3. **KPI grid** (5 tiles, currency prefix):
   - "Fixed" = `e.fixed` — "the same every month"
   - "Recurring" = `e.recurring` — "every month, amount changes"
   - "One-off" = `e.oneoffTotal` — "only this month"
   - "Total expenses" = `e.total` — "1st to last day of <label>"
   - "Net profit" = `e.net` — sub: (if negative red "a loss · ") "gross <e.gross> less expenses paid" + (if `fixedUnpaid>0`) " · <fixedUnpaid> still to pay".
4. **Card "1 · Fixed expenses"** — sub: "Same item, same amount. Set once; it waits here every month. When you have actually paid one, press **Paid** — only then does it count as an expense and go in the book, with that day's date. Use Change amount when it really rises; the months already gone keep the old figure."
   - Empty: "No fixed expenses yet — add the rent and the salaries below."
   - Table columns: **#** (`no`, 1-based) · **Expense** (name) · **Category** · **Each month** (right, bold amount = paid amount if paid else item amount) · **Since** (`from` month, muted, "—") · **Paid** (future month: "not due yet"; paid: green pill "✓ Paid" + muted `paidWhen`; else amber "Not paid") · actions (not for future months): if paid "Undo paid" else primary "Paid"; then "Change amount", "Stop".
   - Under table (not future): "BDT <fixedPaid> paid · **BDT <fixedUnpaid> still to pay**" + (if unpaid>0) " — not counted in the profit until you press Paid. With it, <label> would stand at BDT <netAfterUnpaid>."
   - Add row: `#fx_name` "New fixed expense" (placeholder "Shop rent, a salary…") · `#fx_cat` select from `categories.fixed` · `#fx_amt` "Each month" (inputmode decimal, placeholder 0) · `#fx_add` "Add".
5. **Card "2 · Recurring expenses"** — sub: "Same item every month, different amount — the electricity bill. The line is here every month by itself; type only that month's amount in its box."
   - Empty: "No recurring bills yet — add electricity, ads and the like below."
   - Columns: **#** · **Expense** · **Category** · **<label>** (right; not future: input 120px right-aligned `data-rcamt=<id>` prefilled with entered amount) · status (green "entered" + muted `when` / amber "not entered") · actions (not future: primary "Save" or "Correct" if already entered; always "Stop").
   - Add row: `#rc_name` "New recurring expense" (placeholder "Electricity bill, Facebook ads…") · `#rc_cat` from `categories.recurring` · (not future) `#rc_amt` "<label> amount" · `#rc_add` "Add".
6. **Card "3 · One-off expenses"** — sub "Anything that was not planned. The date and time are recorded by themselves." Form hidden for future months: `#ex_what` "What for" (placeholder "Printer repair, packing tape…") · `#ex_cat` from `categories.oneoff` · `#ex_amt` "Amount" · `#ex_add` "Add".
7. **Card "Everything recorded in <label>"** — sub "Newest first. Every entry stays here with the time it was recorded. A fixed expense appears here on the day it is marked paid."
   - Empty: "Nothing paid or recorded for <label> yet."
   - Table (scroll tall, sticky head): **Recorded** (when "d MMM, h:mm a", nowrap) · **What for** (description; if voided adds muted line with void text) · **Category** · **Kind** (fixed → green pill "fixed"; recurring → neutral pill "recurring"; else plain "one-off") · **Amount** (right, bold) · action "Strike out" (only if not voided and kind ≠ fixed).
   - Voided rows: opacity .5 + line-through.
   - Footer: "By category: <name> <amount> · …" (sorted desc).

Category lists (server constant `ERP_EXP_CATS`, ERP.js:6573-6581):
- fixed: Rent, Salaries & wages, Wi-Fi bill, Software & subscriptions, Loan instalment
- recurring: Utilities, SIM card bill, Marketing & advertising, Transport & delivery, Packaging, Bank & platform fees
- oneoff: Repairs & maintenance, Equipment, Office supplies, Professional fees, Salaries & wages, Marketing & advertising, Miscellaneous

### A1.2 Actions (UI:6728-6848) — every save returns the whole month (`show(msg)` sets EXP, clears `D` so the dashboard reloads, toasts msg 8 s)
| Control | Client validation | Call | Success toast |
|---|---|---|---|
| ← / → | — | `EXP_MONTH = shiftMonth(EXP.month, ∓1)`; reload | — |
| One-off Add | what required "Say what it was for."; amount>0 "Enter an amount." | `erpExpenseAdd({month, category, description, amount})` | "Recorded." |
| Fixed Add | name "Give it a name."; amount>0 "Enter the monthly amount." | `erpExpenseItemSave({kind:'fixed', name, category, amount, fromMonth: month, viewMonth: month})` | "Added. It will be recorded every month from <label>." |
| Recurring Add | name required | `erpExpenseItemSave({kind:'recurring', name, category, amount: rc_amt or 0, fromMonth, viewMonth})` | "Added. It will be on the list every month - just type that month's amount." |
| Recurring Save/Correct | amount>0 "Type the amount for <name>." | `erpExpenseRecurringSet({itemId, amount, month})` | "<name>: <amt> recorded for <label>." |
| Change amount | prompt "New monthly amount for "<name>".\n\nIt applies from <label> onward. Earlier months keep the old figure." (default current); must be >0 "That is not an amount." | `erpExpenseItemSave({id, kind:'fixed', name, amount, fromMonth: month, viewMonth: month})` | "<name> is <amt> from <label>." |
| Paid | confirm "Mark "<name>" as paid for <label>?\n\nBDT <amt> goes into the book with the date of today." | `erpExpenseFixedPay({id, month})` | "<name> marked as paid." |
| Undo paid | confirm ""<name>" was not paid after all?\n\nIts entry in the book is struck out, and it shows as not paid again." | `erpExpenseFixedPay({id, month, undo:true})` | "<name> is back to not paid." |
| Stop | confirm "Stop "<name>"?\n\nIt will not appear for <label> or after. Earlier months are left as they were." | `erpExpenseItemEnd({id, fromMonth: month})` | "<name> stopped." |
| Strike out | prompt "Why is this entry being struck out?\n\nIt stays on the page, crossed through, with your reason."; empty → "A reason is needed." | `erpExpenseVoid({id, reason})` | "Struck out." |
| Download as Excel | button → "Building the file…" | `erpExpenseExport({month})` | toast 30 s: link `https://drive.google.com/uc?export=download&id=<id>` "**Save <name>**" + " · a copy is also kept in Drive" |

### A1.3 Server rules (ERP.js:6565-7109)
Tabs:
- `EXPENSES` cols: `expense_id, recorded_at, month, kind, category, description, amount, item_id, recorded_by, voided` (month column forced to text format).
- `EXPENSE_ITEMS` cols: `item_id, kind, name, category, amount, from_month, to_month, note, set_by`.
- Months are `yyyy-MM` text; `erpMonthText_` converts a Date back to text (ERP.js:6613).
- IDs: `erpExpNewId_(tag)` = tag + `yyMMddHHmmss` + `-` + 3 random digits; tags E (entry), F (fixed item), R (recurring item).
- Item active in month m iff `(!from || m >= from) && (!to || m <= to)` (ERP.js:6645).
- `erpExpWrite_` appends then re-reads last row's id; mismatch → "The entry did not reach the sheet. Nothing was saved - try again."
- "Who" = `erpWhoIsThis_()` = session name or Google email or 'erp'.

`erpExpenses({month})` (ERP.js:6756-6830): month defaults to current (Dhaka). Returns:
`{month, label:'<FullMonth> <yyyy>', isCurrent, isFuture, fixedItems[], recurringItems[], oneoff[], all[], missing, categories, byCategory[{name,amount}], fixed, fixedPaid, fixedUnpaid, recurring, oneoffTotal, total, revenue, goodsCost, gross, net, netAfterUnpaid}`.
- recurringItems: `{id, no, name, category, since, amount (entered row amount or null), when}`; `missing` counts active recurring items without a non-voided entry when month ≤ now.
- fixedItems: `{id, no, name, category, amount (paid row amount or item amount), since, paid, paidWhen, paidBy}`; `fixedUnpaid` sums item amounts of unpaid fixed items when month ≤ now.
- Sums over non-voided rows by kind (unknown kinds count as oneoff); `total = fixed+recurring+oneoff` (rounded); `byCategory` sorted desc.
- `all` = all rows of the month (incl. voided) sorted by recorded_at desc.
- `net = gross − total`; `netAfterUnpaid = gross − total − fixedUnpaid`.
- `erpMonthGross_(month)` (ERP.js:6716-6753): cost per SKU = PRODUCT_MASTER `cost_price` (col I) or the price-book landed cost keyed by category|brand|type (`erpBookCostMap_`); for every SALES_LOG line in month (by timestamp, Dhaka): per invoice collect `lines` (sum of line totals), `discount` (max of col O), `gross` (Σ qty×unit_price where total>0). Revenue per line = negative totals as-is, else `max(0, total − share)` where `share = discLeft × total/lines` and `discLeft = max(0, discount − max(0, gross − lines))` (`erpDiscLeft_`, ERP.js:10759). COGS = Σ cost×qty. Returns `{revenue, cost, gross}` rounded.

Write functions:
- `erpExpenseAdd` — amount>0 ("How much was spent?"), description ("What was it for? A few words is enough."), month ≤ now ("That month has not begun yet."); appends `[id, now, month, 'oneoff', category||'Miscellaneous', what, round2(amount), '', who, '']`.
- `erpExpenseRecurringSet` — item must exist and be recurring and active; month ≤ now; every existing non-voided entry for that item in the month gets `voided = 'replaced <d MMM yy> by <who>: was <amount>'`; then append a new `recurring` row with `item_id`.
- `erpExpenseFixedPay` — month ≤ now; item must be fixed & active ("That fixed expense is not on the list for this month."). Undo: voids the paid row with `'struck out <date> by <who>: marked paid by mistake'` ("It is not marked as paid." if none). Pay: refuse if already paid ("<name> is already marked as paid for this month."); append `[id, now, month, 'fixed', category, name, item.amount, item.id, who, '']`.
- `erpExpenseItemSave` — kind fixed|recurring; name required ("What is this expense called?"); fixed needs amount>0 ("How much is it each month?"); from = fromMonth or now.
  - Change (`payload.id`): only fixed ("Only a fixed expense has a set amount to change."). If `from <= old.from` → overwrite amount in place; else set old `to_month = from−1` and append new item `[F…, 'fixed', name, category, amount, from, '', 'was <old>', who]`. Then `erpStrikePosted_(id, from, 'the amount was changed from <from>')` voids that item's fixed rows in months ≥ from.
  - New: refuse duplicate open name in same kind (`"<name>" is already on the list.`); append item (`amount` blank for recurring); a recurring item created with amount>0 and from ≤ now also writes that month's entry. Returns month = viewMonth.
- `erpExpenseItemEnd` — sets `to_month = fromMonth − 1`; for fixed, strikes posted rows from that month ('the expense was stopped from <m>').
- `erpExpenseVoid` (owner) — id & reason required ("Say why it is being struck out, so the books can be read later."); refuses already voided ("That entry is already struck out.") and fixed ("A fixed expense is changed or stopped from its own line, not struck out."); writes `'struck out <d MMM yy> by <who>: <why>'`.
- `erpExpenseExport` (ERP.js:7020-7084): builds a temp spreadsheet "Expenses <month>": sheet **Summary** rows: `<biz> - expenses`, label, blank, `Sold (after discounts)`=revenue, `The goods cost`, `Gross profit`, blank, `Fixed expenses`, `Recurring expenses`, `One-off expenses`, `Total expenses`, blank, `NET PROFIT` (row 13 bold), blank, `By category` + one row per category, and if missing `N recurring bill(s) had no figure entered`; title bold 14pt; col widths 280/130. Sheet **Entries**: header `Recorded, Kind, Category, What for, Amount, Recorded by, Struck out` (oldest first; kind 'one-off'), bold, frozen. Exports xlsx via `https://docs.google.com/spreadsheets/d/<id>/export?format=xlsx` with OAuth bearer; saves into Drive folder **Costareen_Expenses** as `<biz> expenses <yyyy-MM>.xlsx` (older same-name files trashed); temp sheet trashed. Returns `{ok, name, id, url, month}`.
- Dashboard dependency: `erpExpenseTotal_(month)` (all non-voided) and `erpExpenseUnpaid_` feed dashboard Net profit (ERP.js:563-567, 7093-7109); P&L uses `erpExpByCat_` (ERP.js:8394).

---------------------------------------------------------------------

## PART A2 — CAMPAIGNS (`data-view="campaigns"`) — WhatsApp marketing

There is **no Facebook / ads integration**. Campaigns = WhatsApp messages to customers/leads, either opened by hand (wa.me / WhatsApp app / Web) or sent automatically through the owner's own **Evolution API** server.

Role: nav visible manager+. Server allow (ERP.js:4218-4240): manager — erpCampaignAudience, erpCampaignCreate, erpCampaignGet, erpCampaignList, erpCampaignMark, erpCampaignOptOut, erpWaProductPdf, erpEvoStatus, erpProductListShare, erpShareFile, erpEvoUpload, erpEvoCampaignStart, erpEvoSendBatch, erpLeadsAdd, erpLeadRemove, erpCampaignPause, erpCampMsgSave, erpCampGroupSave, erpLeadSave, erpCampaignRetry, erpEvoSendTest; owner — erpEvoSetup, erpEvoQr, erpEvoLogout, erpEvoStopHook. Owner-only buttons are hidden in UI for non-owners (`ME.role === 'owner'`).

### A2.0 Client state `CP` (UI:3606-3620)
`aud` (audience payload), `err`, `list`, `camp` (opened campaign), `openMode` ('app'|'web'|'phone', persisted `localStorage.czwa_mode`), `f` filters `{q:'', last:'', pattern:'', due:'', cats:[], minSpent:'', skipRecent:'7', who:'cust'}`, `picked{key:true}`, `name`, `msg` default:
```
Assalamu alaikum {name},

{business} has fresh stock this month — please see the attached product list.

Reply here to order. Thank you!
```
`prod {cats:[], stockOnly:true, prices:true, max:80}`, `attach {src:'pdf'|'none'|'sheet'|'file', file:null}`, `tab` ('list'|'new'|'contacts'|'messages'), `step` 1-4, `when` ('spread'|'date'|'now'|'hand'), `startOn`, `ctab` ('leads'|'groups'|'stopped'), `leadQ`, `editLead`, `msgEdit`, `connOpen`, `testPhone` (localStorage `czcp_testphone`), `lead1 {name, code:'+880', phone}`, `leadText`, `leadSrc`, `leadRes`, `leadBusy`. Draft persisted in `localStorage.czcp_draft` = `{name,msg,att,f,picked (≤2500 keys),when,startOn,step,at}`; cleared when nothing picked, default msg and no name (UI:3743-3761).
`WA {busy, prog, sent, failed}`; `EVO {status, qr, qrTimer}`.
Load `cpLoad()` (UI:3621): `erpCampaignAudience` → `CP.aud`; `erpCampaignList` → `CP.list`; `erpEvoStatus` → `EVO.status` (once).

Business name for `{business}` = quotation profile name, else business switcher name (UI:3627).

### A2.1 Screen frame (UI:3776-3822)
- Error → red note; no audience → "Reading customers…".
- **Top row**: chip tabs `Campaigns` | `+ New campaign` | `Contacts` | `Messages` (`.chip.on` for current when no campaign opened) and on the right a WhatsApp status chip (button `#cp_conn`):
  - not loaded: neutral "WhatsApp: checking…"; connected: green "✓ WhatsApp linked" (+ " · STOP on" if stopHook); configured: amber "WhatsApp: no number linked"; else neutral "WhatsApp: not set up". Click toggles the connection card.
- **Connection card** (`cpConnHtml`, UI:3790-3815): title "WhatsApp connection".
  - connected: green pill "✓ Linked · <instance>" + (owner) "Manage" → go settings; sub "Your Evolution server is logged in to WhatsApp, so campaigns can be sent automatically. Sending by hand from your own phone needs no setup at all."; STOP row: green "✓ A reply of STOP takes that person off by itself" + (owner) "Turn off", or amber "STOP replies are not being watched" + (owner) primary "Turn on automatic STOP" (`#cp_stophook` → `erpEvoStopHook({off})`, toast "On. A reply of STOP now takes that person off the list." / "Off.").
  - configured but not linked: amber "Server set up · no number linked" + (owner) primary "Link a WhatsApp number (QR code)" (`#cp_link` → `evoLinkStart()`); QR image 260×260 with "On the phone: WhatsApp → Linked devices → Link a device → scan. The code refreshes by itself."
  - not set up: neutral "Not set up" + (owner) "Set up in Settings"; sub "Automatic sending needs your Evolution server (Settings → WhatsApp). Until then, send by hand: the ERP opens each chat with the message typed and you press send."
- Body: opened campaign → queue view; else per tab.

### A2.2 Tab "Campaigns" (list) (UI:3825-3851)
- KPI row: "Sent this month" (`stats.sentMonth`, accent) "messages that went out"; "Sending now" (count of spread campaigns with waiting>0 and not paused; tone good if >0) sub red "<n> paused" or "campaign(s) working by themselves"; "Failed this month" (tone bad if >0) "did not go through"; "Asked to stop" (`stats.stopped`) "never messaged again".
- Card header "Campaigns" + primary "+ New campaign".
- Draft note (if `czcp_draft`): "**A campaign you did not finish: <name>**<br><n> people chosen · stopped at step <s> of 4" + "Continue" (restores draft, tab new) / "Discard".
- `CP.list` null → "Reading campaigns…"; empty → "No campaign yet. Press + New campaign."
- Table: **Campaign** (name + muted "<created> · <by>") · **Status** pill from `cpStatus` (UI:3764): no waiting → "Done" green; spread: paused → "Paused" red; startOn > today → "Starts <date>" amber; else "Sending" green; non-spread: auto (EVO/API) → "Stopped part-way" amber, else "By hand" amber · **Progress**: green bar width = done/total, text "<sent> sent · <failed> failed · <skipped> skipped · <waiting> waiting of <total>" (zero parts omitted) · actions "Open" (primary if waiting) → `erpCampaignGet({id})` sets `CP.camp`; "Duplicate".
- Server `erpCampaignList` (ERP.js:9816-9832): counts per campaign from CAMPAIGN_SENDS statuses; returns newest first, max 50: `{id, name, by, spread, paused, startOn, created:'d MMM yyyy', auto: message starts 'API:' or 'EVO:', counts:{waiting,sent,skipped,failed}}`.

### A2.3 Tab "+ New campaign" — 4-step wizard (UI:3854-3985)
Stepper buttons `1 Who · 2 Message · 3 When · 4 Review` (done steps show ✓; jumping forward validates earlier steps and stops at the first problem with a toast). Footer: "← Back", problem text (right, muted), primary "Next: <name> →" (disabled if problem). Draft saved on every step change/pick.

Step problems `cpStepProblem` (UI:3854):
1. no picked → "Choose at least one person."
2. empty msg → "Write the message."; rendered sample > 4000 chars → "The message is too long. Move the product list to the attachment."; attach file chosen but none uploaded → "Attach the file, or choose another attachment."
3. `date` and startOn not > today → "Choose a date after today."; not hand and WhatsApp not connected → "WhatsApp is not linked, so only "by hand" can be used."; `now` with any lead picked → "Leads are never sent all at once. Choose another way."

**Step 1 "Who gets it"** (UI:3876-3907): sub "Only people with a mobile number. Anyone who asked to stop is never included."
- Chips: Customers / Leads (<n non-opted leads>) / Both (`f.who` = cust|lead|both); when not "cust" a small "Add leads…" → Contacts tab.
- "Saved groups:" chips (click = apply group filters and pick everyone matching; toast "<group>: N people chosen.").
- Filters row: `#cp_q` "Name, phone or source" (on change); `#cp_last` "Last purchase": Anyone / In the last month (in30) / In the last 3 months (in90) / Not in 2 months (out60) / Not in 6 months (out180) / Never bought (never); `#cp_pat` "Buying": Anyone / Bought once / Repeat buyers; `#cp_due` "Due": Anyone / No due / Has a due; `#cp_min` "Spent at least" (numeric, 110px); `#cp_rec` "Skip messaged in": Don't skip / last 3 days / last 7 days (default) / last 30 days.
- Category chips "Bought <category>" (multi-select; any-of).
- Count row: "**N chosen** · M match the filters", primary "Choose all M", "Clear", spacer, "Save these filters as a group" (prompt "Name for this group (the filters are saved, so it always holds whoever fits):" → `erpCampGroupSave({name, filter: CP.f})`, toast "Group saved.").
- Table (first 400 rows; note "Showing 400 — narrow the filters to see the rest (Choose all still takes every match)."): checkbox · **Person** (name or "—", "lead" pill, muted phone (+ source for leads), red due badge `.bal.owed` if due>0) · **Orders** · **Spent** · **Last bought** ("N days ago"/"—") · **Last messaged** ("never"/"N days ago").
- Filter logic `cpFiltered` (UI:3632-3651): exclude opted-out; who; q matches name+phone+source; last: never → orders==0; inN → daysSince ≤ N; outN → daysSince > N (null excluded for both); once → orders==1; repeat → orders≥2; due yes/no; minSpent; cats any-of; skipRecent → exclude lastMessagedDays < N.

**Step 2 "The message"** (UI:3909-3940): two columns.
- Left: (if saved messages) select "Start from a saved message" (confirm "Replace what is written with "<name>"?" if custom text exists; also sets attachment and name if empty); `#cp_name` "Campaign name (for your list)" placeholder "October stock list"; `#cp_msg` textarea 9 rows; help "{name} = the person's name · {business} = your business name · *bold* works in WhatsApp · {products} writes the list into the text"; button "Save this message for next time" (prompt name → `erpCampMsgSave({name, text, attach})`, toast "Saved.").
- "Attachment" chips: Nothing / Product list — PDF / Product list — Google Sheet / My own file.
  - PDF/Sheet: category chips (none = all), checkboxes "Only what is in stock" (default on), "Show prices" (default on); sub "<n> product(s) · no category chosen = every category · made fresh from today's stock when it is sent".
  - My own file: `<input type=file accept=pdf,png,jpeg>`, ≤10 MB ("That file is over 10 MB."); upload → toast "Uploading…" → `erpEvoUpload({mime,name,data})` → `CP.attach.file = {fileId,name,mime}`, toast "Attached."; shows "Attached: <name>" or "PDF, PNG or JPEG, up to 10 MB."
- Right: "How <sample> will see it" — green WhatsApp bubble with rendered text (first picked person, else "Karim") + attachment line "📎 <label>" (+ " — sent as a link" for sheet); char counter or warning note if > 4000.
- Rendering `cpMessageFor(c, template, products)`: replace `{name}` (trimmed), `{business}`, `{products}`; then `' ,'`→`','` and `'Assalamu alaikum ,'`→`'Assalamu alaikum,'` (UI:3674). `{products}` text (UI:3653): non-discontinued, stock>0 if stockOnly, category filter; grouped by category sorted, `*Category*` heading then `• <name> — ৳<price>` (price if prices on and sell>0), blank line between, max 80 products.

**Step 3 "When and how"** (UI:3942-3956): if not linked, amber note "WhatsApp is not linked, so the ERP cannot send by itself. Press the WhatsApp chip at the top to link a number — or send by hand." Four radio cards:
- "Spread through today [advised]" — "Sends by itself, a few at a time, between 10 am and 8 pm — about one every <gap> minutes. You can close the page. What does not fit today carries on tomorrow." gap = clamp(4..60, round((to−from)×60/n)). Disabled if not linked.
- "Start on a date" — "The same, but it begins on the day you choose." + date input (min today) when selected. Disabled if not linked.
- "All at once, now" — "One person every 8 seconds (about <ceil(n×8/60)> minutes). Keep the page open." + " Not available: leads are chosen." or " The fastest, and the riskiest for the number." Disabled if not linked or leads chosen.
- "By hand, from my own WhatsApp" — "The ERP opens each chat with the message typed; you press send. About 5 seconds each. No risk to the number."
- If leads chosen: "<n> lead(s) chosen: at most 30 a day, never twice in 7 days, and each message tells them how to stop."

**Step 4 "Check, then start"** (UI:3965-3985): summary list: Campaign (name or "Campaign <today>"), Who ("<c> customer(s) + <l> lead(s)" / "customers", "<n> people"), When (`cpWhenWords`), Attachment. Problems (steps 1-3) as red note. If not hand: amber warning `EVO_WARN`:
> "If your Evolution server is connected by scanning a QR code (WhatsApp Web), this is not an official WhatsApp connection. WhatsApp can restrict or ban that number, especially for offers sent to many people. Use a second number, not the one you chat with customers on." (UI:4431)

"Send a test first": `#cp_testphone` (placeholder "01XXXXXXXXX or +82…", remembered) + "Send test" (disabled unless linked and not busy). Validation `^01[3-9]\d{8}$` or `^\+[1-9]\d{7,14}$` else "Type your own number first: 11 digits starting with 01, or + and the country code for a number abroad." Resolves attachment in `evo` mode and calls `erpEvoSendTest({phone, text (+ lead footer if first picked is a lead), attach})` → toast "Test sent to <ph>. Look at your phone."
Right: bubble "The message — as <first person> gets it" (+ "\n\nReply STOP to stop these messages." if lead). Progress note `WA.prog`. Big primary button: "Start: N by hand" / "Send to N now" / "Schedule for <date>" / "Start sending to N".

Start (UI:4294-4328):
- **hand**: confirm "Start "<name>" for N people?\n\nYou will open each chat and press send yourself." → resolve attachment as a link (`hand` mode) → `erpCampaignCreate({name, message: cpWithLink(msg, res), recipients:[{key,name,phone}]})` → open queue view, clear draft. (`cpWithLink` appends `\n\n📎 <linkName>:\n<url>`.)
- **spread/date/now**: confirm with `EVO_WARN` ("Schedule "<name>" for <date>, N people?" / "Start sending "<name>" to N people, spread through the day?" / "Send "<name>" to N people now, all at once?") → resolve attachment (`evo` mode: real file) → text = message rendered with `{name}` kept literal → `erpEvoCampaignStart({name, text, attach, recipients, spread: when!=='now', startOn})`. If result has `spread` → open queue, toast "Scheduled. It starts by itself on <date>." / "Started. It sends by itself; you can close this page." Else (now) → `campRun('erpEvoSendBatch', id)` loop: batches of `max:25` (server caps at 20) until `left==0` or `stopped`; progress "Sent N · failed M · L left"; errors toasted 15 s.
- Attachment resolution `cpResolveAttach(mode)` (UI:3710-3726): none → {}; own file → evo: `{file}`; hand: `erpShareFile({fileId})` → link; pdf+evo → `erpWaProductPdf(opts)` → file; otherwise `erpProductListShare({cats, prices, stockOnly, kind})` → link.

### A2.4 Opened campaign — queue views
**By-hand queue** (`cpQueueHtml`, UI:4065-4093) (message not starting with `API:`/`EVO:`):
- Header: name, "Export", "← All campaigns". Sub "By hand · <sent> sent · <skipped> skipped · <waiting> waiting · started <created>". Progress bar.
- "Open chats in:" chips: WhatsApp app on this computer (`whatsapp://send?phone=<wa>&text=`) / WhatsApp Web (`https://web.whatsapp.com/send?phone=<wa>&text=`) / Phone (wa.me) (`https://wa.me/<wa>?text=`) (UI:3679-3684).
- "Next" card for the first waiting recipient: name/phone, bubble with rendered message (`{products}` rendered from current catalog), buttons: link "1 · Open <name> in WhatsApp" (target `czwa`), primary "2 · Sent ✓ — next" (`data-cpmark=sent`), "Skip", "Asked to stop". When none waiting: green note "Everyone in this campaign has been done."
- List of all recipients: name/phone, pill sent/skipped/waiting + "<at> · <by>", "Put back" (→ waiting) for non-waiting.
- Marking is optimistic (updates locally with `at:'now'`), then `erpCampaignMark({id,key,status})`; failure toast "Could not record that: …".

**Automatic queue** (`waQueueHtml`, UI:4095-4125):
- Header buttons: Duplicate, Export, Refresh (`erpCampaignGet`), ← All campaigns. Sub "Sent through your WhatsApp server · started <created> · <by>". KPIs Sent (good), Waiting (accent if >0), Failed (bad if >0), Skipped ("asked to stop, or messaged lately"). Progress bar; progress note.
- If spread and waiting: paused → red note "**Paused.** <why> Nothing more is sent until you press Resume." else green "**Sending by itself**, a few at a time between 10 am and 8 pm. Last sent <last>. / The first ones go within about ten minutes, inside those hours. Leads: at most 30 a day. You can close this page." (future start: "**Scheduled for <date>.** It then sends …"). Button Pause/Resume → `erpCampaignPause({id, pause})`.
- Non-spread with waiting: primary "Send to the N still waiting" (confirm "Send to everyone still waiting?" → campRun). Failed>0: "Try the N failed again" → `erpCampaignRetry({id})` toast "Put back in the queue."
- Rows: name (+ lead pill), phone, status pill (sent + at / failed red / skipped / waiting) + reason text (part of `by` after " · ").

**Export** (UI:4141-4152): client CSV `Name,Phone,Status,When,Note` (phone as `="<phone>"`), BOM, file `<campaign name sanitized>.csv`; toast "Saved as a spreadsheet file (CSV)."
**Duplicate** (UI:4128-4139): `erpCampaignGet` → fresh draft: message (EVO JSON text extracted; trailing "📎 …: url" removed), name "<name> (again)", attachment none, picks recipients still on lists and not opted out, `who:'both'`, `skipRecent:''`, step 1; toast "Copied. X of Y people are still on your lists. Choose the attachment again in step 2."

### A2.5 Tab "Contacts" (UI:3988-4040) — sub-chips Leads (n) / Groups (n) / Asked to stop (n)
- **Leads**: sub "People who asked about something and have not bought yet. Only people who talked to you. They are messaged slowly — at most 30 a day, never twice in 7 days — and every message tells them how to stop. When a lead buys, they become a customer by themselves."
  - "Add a lead": `#cp_l1name` Name (max 80, placeholder "Karim Ahmed"), `#cp_l1code` Country code (default +880, digits only with +), `#cp_l1phone` Phone number (digits only, max 16, placeholder 01712345678), `#cp_leadsrc` "Where they came from" (max 60, "Facebook, phone call…"), primary "Add". Help: "In Bangladesh: leave the code as +880 and type the 11 digits starting with 0. Abroad: change the code (Korea +82, India +91, UK +44…) and type the number." Client check for +880: must be `^01[3-9]\d{8}$` (10 digits starting 1 gets a 0) else "A Bangladeshi number is 11 digits starting with 01. This one has N." → `erpLeadsAdd({one:{name, phone, code}, source})`, toast "<name> added to leads.", reload audience.
  - `<details>` "Paste many at once": "One per line: a number, or a name and a number. A number abroad starts with + and its country code. "Where they came from" above is used for all of them." textarea (placeholder lines "Karim 01712345678 / 01898765432 / Mr Kim +821012345678") + "Add all to leads" → `erpLeadsAdd({text, source})`. Result note: "N added." + skipped lines with reasons (first 30); textarea keeps only the skipped lines.
  - Search `#cp_leadq` + "x of y". Table (≤400): Name · Phone · Where from · Last messaged · actions Edit (inline name/source inputs, Save → `erpLeadSave({key,name,source})`), "Asked to stop", "Remove" (confirm "Take <name> off the leads list?" → `erpLeadRemove({key})`). Empty: "No lead matches that." / "No leads yet. Paste numbers above."
- **Groups**: sub "A group is a saved set of filters, so it always holds whoever fits today. Make one in New campaign → Who → "Save these filters as a group"." List: name + "<n> people fit today" (computed client-side by applying filter), "New campaign to them" (fresh draft, apply group, step 1), "Delete" (confirm "Delete the group "<name>"? The people stay; only the saved filters go." → `erpCampGroupSave({id, remove:true})`). Empty "No groups saved yet."
- **Asked to stop**: sub "These people are never in a campaign. A reply of STOP puts someone here by itself" + (". " or " once automatic STOP is switched on (WhatsApp chip, top right)."). Rows: name (+lead), phone · reason, button "They want messages again" → `erpCampaignOptOut({key, undo:true})`. Empty "Nobody has asked to stop."
- "Asked to stop" (any list): confirm "<name> asked not to get messages?\n\nThey will never be in a campaign again unless you take them off this list." → `erpCampaignOptOut({key, name, phone})`; local: waiting recipients → skipped, customer `optedOut='asked to stop'`, unpick; toast "Noted. No more messages to <name>."

### A2.6 Tab "Messages" (saved messages) (UI:4043-4062)
Header "Saved messages" + primary "+ New message"; sub "Messages you send more than once. Pick one in New campaign → Message." Editor: Name (max 80, "Monthly stock list"), Attachment select (Nothing / Product list — PDF / Product list — Google Sheet), Message textarea 7 rows, help text, Cancel / Save (name required "Give it a name."; text required "Write the message.") → `erpCampMsgSave(e)`. List rows: name + first 120 chars, "Use" (load into wizard; step 2 if people already picked else 1; toast "Message loaded." / "Message loaded. Now choose who gets it."), "Edit", "Delete" (confirm → `erpCampMsgSave({id, remove:true})`). Empty "Nothing saved yet."

### A2.7 Server business rules (ERP.js:9640-10640)
Tabs (auto-created with bold frozen header):
- `CAMPAIGNS`: `campaign_id, created_at, created_by, name, message, recipients` — id `CMP-yyMMdd-HHmmss`; message = plain text (hand) or `EVO:` + JSON `{evo:true, text, attach:{fileId,name,mime}|null}`; recipients = count.
- `CAMPAIGN_SENDS`: `campaign_id, customer_key, customer, phone, status (waiting|sent|skipped|failed), updated_at, by` (by may be "<who> · <messageId>" or "<who> · <failure reason>"); key & phone columns text.
- `CAMPAIGN_OPTOUT`: `customer_key, customer, phone, opted_out_at, reason, by`.
- `CAMPAIGN_MESSAGES`: `message_id (MSG-+10hex), name, text, attach, updated_at, by`.
- `CAMPAIGN_GROUPS`: `group_id (GRP-+10hex), name, filter (JSON of q,last,pattern,due,minSpent,skipRecent,who (each ≤80 chars), cats ≤30), updated_at, by`.
- `CAMPAIGN_LEADS`: `lead_key, name, phone, source, note, added_at, by`.
- Spread state: script property `ERP_CMP_STATE` = JSON `{<campaignId>: {from:10, to:20, paused, why, fails, last(ms), start:'yyyy-MM-dd'|''}}`, max 60 entries (oldest ids dropped).

Keys and phones:
- `erpCustKey_(phone,name)` = last 10 digits if ≥10 digits else `'n:'+lowercase name` (ERP.js:5155). Lead key `erpLeadKey_` = `'i'+digits` for `+`-numbers (foreign) else customer key (ERP.js:10333).
- `erpWaNumber_` (ERP.js:9676): `+` and not 880 → digits if `^[1-9]\d{7,14}$`; else normalise 13-digit 880…/12-digit 88…/10-digit 1… to 11-digit `01[3-9]XXXXXXXX` → return `'88'+d`; else ''.
- `erpAnyPhone_(text, code)` stores `01XXXXXXXXX` (via `erpPhone11_`, error "The phone number must be 11 digits starting with 01 - …") or `+<cc><number>`; handles `00` prefix and non-880 country code (strips leading zeros) (ERP.js:10342).

`erpCampaignAudience()` (ERP.js:9687-9756): manager+. Builds from CUSTOMERS (name col B, phone col C) — only with valid WhatsApp number, de-duplicated by key; per key from SALES_LOG (skip RTN- ids and `n:` keys): `cats` (PRODUCT_MASTER category of each SKU), distinct `orders`, `spent` Σ line totals (col J), last purchase → `daysSince`; `optedOut` reason; `lastMessagedDays` from latest `sent` in CAMPAIGN_SENDS; `due` from `erpDues().byKey`. Sorted by spent desc; then leads not already customers/buyers (`lead:true, source, note`, zeros). Also `stats {sentMonth, failedMonth (this Dhaka month by updated_at), stopped (# opt-outs)}`, `saved {messages, groups}`, `leadDaily:30, leadRestDays:7, spreadFrom:10, spreadTo:20`, `categories` (distinct sorted).

`erpCampaignCreate` (ERP.js:9759-9793): name ≤120 (default "Campaign d MMM yyyy"); message required, ≤20000; recipients filtered: need key, valid WA, unique, not opted out; none → "Choose at least one customer with a mobile number."; >2000 → "At most 2,000 customers in one campaign."; script lock 20 s; writes campaign row and one `waiting` row per recipient; returns `erpCampaignGet`.

`erpCampaignGet` → `{id, name, message, created:'d MMM yyyy, h:mm a', by, spread:{from,to,paused,why,leadDaily,start,last}|null, recipients:[{key,name,phone,wa,status,at,by,lead?}]}` (lead flag only for spread campaigns).

`erpCampaignMark` — status ∈ sent|skipped|waiting; writes status, now, who.
`erpCampaignOptOut` — undo deletes all opt-out rows for key; else appends opt-out (reason default 'asked to stop', ≤200) and sets all `waiting` sends of that key to `skipped`.
`erpCampKeep_`/`erpCampMsgSave`/`erpCampGroupSave` — names ≤80, unique case-insensitive ("There is already one called X." / "…a group called X."), max 100 each, remove by id; message text ≤4000 ("The message is over 4,000 characters."); saved attach only none|pdf|sheet.
`erpLeadsAdd` — ≤500 lines; one-mode errors thrown; per line regex `/[+0-9][0-9 ()\-]{7,}/` for phone, rest = name; skip reasons: "no phone number in it", "not an 11-digit mobile number, nor a number with a country code (+…)", "already a customer", "already a lead"; returns `{added, skipped:[{line, why}]}`. `erpLeadSave` updates name (≤80), source (≤60), note (≤200). `erpLeadRemove` deletes row.
`erpCampaignRetry` — failed → waiting; none → "Nobody in this campaign has failed."; resets spread pause/fails and ensures timer.
`erpWaProductPdf` — HTML (Arial 11px) title = profile name, "Available products · d MMMM yyyy", per category `<h3>` + bordered table rows name (+ price right, 90px); converted to PDF in Drive folder **ERP_Assets** named `<biz> - available products yyyy-MM-dd.pdf`; returns `{fileId, url, name, products}`.
`erpProductListShare` — kind pdf → above PDF shared "anyone with link, view", url `https://drive.google.com/file/d/<id>/view`; kind sheet → new spreadsheet "<biz> - available products yyyy-MM-dd", tab "Products", header `Category, Product, Brand, Price (BDT)` (price column deleted when prices off), sorted by category+name, moved into ERP_Assets, shared anyone-with-link view.
`erpShareFile` — sets anyone-with-link view on an uploaded file.
`erpEvoUpload` — mime pdf/png/jpeg only ("Attach a PDF, PNG or JPEG."), ≤10 MB, saved in ERP_Assets.

**Evolution API integration** (ERP.js:10068-10200):
- Config per business (script properties keyed by sheet id): `ERP_EVO_URL::<id>`, `ERP_EVO_INSTANCE::<id>`, `ERP_EVO_KEY::<id>` (= `<secret>`), `ERP_EVO_HOOK::<id>` (= `<secret>` webhook word).
- Call: `UrlFetch(<url><path>/<instance>)`, header `apikey: <secret>`, JSON body, returns `{code, json, text(300)}`.
- Endpoints: `GET /instance/connectionState/{inst}` (state 'open' = connected; 401/403 "The server refused the API key."; 404 "The server has no instance called "<inst>"."; other "The server answered N."; reachable but not open → `needsLink:true`, error "The server is set up, but no WhatsApp number is linked to it yet."; exception "The server could not be reached: …"); `GET /instance/connect/{inst}` → `base64` QR (prefixed `data:image/png;base64,` if needed); `DELETE /instance/logout/{inst}`; `POST /message/sendText/{inst}` `{number: wa, text}`; `POST /message/sendMedia/{inst}` `{number, mediatype:'image'|'document', mimetype, caption:text, media:<base64>, fileName}`; `POST /webhook/set/{inst}` `{webhook:{enabled, url: <public exec URL>?hook=<secret>, byEvents:false, base64:false, events:['MESSAGES_UPSERT']}}`.
- `erpEvoStatus` → `{configured, url, instance, hasKey, state, stopHook, connected, needsLink?, error?}` (never the key).
- `erpEvoCampaignStart` (ERP.js:10175): needs config; text ≤4000; startOn `yyyy-MM-dd` not in past; spread = payload.spread OR any lead recipient OR startOn; creates campaign with `EVO:` JSON; if spread stores state `{from:10,to:20,paused:false,why:'',fails:0,last:0,start}` and ensures timer.
- `erpEvoSendBatch` — refuses spread campaigns ("This campaign sends itself through the day. Pause or resume it instead."); `erpEvoSendCore_(id, 20, who, false)`.
- `erpEvoSendCore_` (ERP.js:10222-10299): requires connected; loads attachment bytes from Drive once; script lock (timer 5 s → returns `{busy:true}`; manual 20 s → "Another batch is still sending. Wait a moment."); counts leads sent today and last time per lead; for each waiting row (up to max): opted out or no WA → skipped; lead messaged within 7 days → skipped "<who> · messaged in the last 7 days"; lead daily cap 30 reached → left waiting (`leadHeld++`); sleep 8000 ms between sends; text = template with `{name}` replaced and `' ,'` fixed; leads get footer "\n\nReply STOP to stop these messages." if absent; send; 200/201 → sent (by = who · messageId); else failed (by = who · reason ≤200), first 5 errors collected; stop immediately on code 0/401/403/≥500 or reason matching closed|disconnect|logged out|not connected. Manual run with nothing sent and leads held → stopped + "Today's 30 leads have been messaged. The rest wait for tomorrow." Returns `{sent, failed, left, errors, stopped, trail (consecutive failures at end), leadHeld}`.
- `erpCampaignTick` (timer, ERP.js:10494-10525): if no campaign has waiting → delete timer. For each spread, not-paused campaign with waiting, when Dhaka hour ∈ [from, to) and today ≥ start: min gap = min(60, (to−hour)×60/waiting) minutes (skip if last send < 90% of that); n = min(3, max(1, ceil(waiting / ticksLeft))) with ticksLeft = floor((to−hour)×60/10); send; consecutive-failure counter `fails` carried across ticks; `stopped` → pause with why "Stopped by itself: <reason>"; fails ≥3 → pause "Stopped by itself: N messages in a row failed. Last: …"; update `last`.
- `erpCampaignPause` — sets paused, why "Paused by <who>." / '', fails 0; resume ensures timer.
- STOP webhook `erpWaHook_` (ERP.js:10532-10555): requires `?hook=` equal to stored word; event `messages.upsert`; ignore fromMe, groups/status (jid must end `@s.whatsapp.net`); text (conversation or extendedTextMessage.text, lower-cased, trailing `.!` and spaces stripped) ∈ {stop, unsubscribe, stop it, বন্ধ, বন্ধ করুন}; derive key (BD → customer key; foreign → 'i'+digits); if not already opted out, call `erpCampaignOptOut` as session `{role:'manager', name:'WhatsApp reply'}` with reason 'replied STOP'.
- `erpEvoStopHook` — owner only; refused on child links ("This is set up on the main business only for now."); off → webhook disabled + property deleted; on → random 64-hex word, webhook set, property saved.
- NOTE: spread state, timer and webhook are project-wide while CAMPAIGN_SENDS is per sheet; the timer runs against the bound (home) sheet, so automatic spread sending effectively only works for the home business.

---------------------------------------------------------------------

## PART A3 — WEB ORDERS (`data-view="weborders"`)

Role: nav manager+. Server allow: erpWebOrders, erpEnterWebOrder, erpMarkWebOrderEntered, erpWebOrderInvoices, erpCourier, erpLinkWebOrder = manager; erpTool = shareholder (see gap B4).

### A3.1 Layout (UI:7712-7748, courier panel UI:6210-6281)
`WEB` null → "Loading website orders…". Section contains:

**1. Courier card** (first, because it changes by itself) — states: `COURIER_ERR` → red note "**Could not read the courier.**<br>msg"; loading → card with "Asking the courier about recent parcels…".
- Title "Courier"; sub "Website orders of the last <days> days, as Steadfast reports them. Nothing here is marked paid yet."
- KPIs: "Collected for you" (`collected`) "delivered - Steadfast is holding this"; "Still moving" (`waiting`) "booked, not yet delivered"; "Came back" (`lost`) "returned or cancelled".
- Sub: "Where each parcel is. An invoice is marked paid when Steadfast pays it out — that is checked parcel by parcel under **Sales → Steadfast money**."
- Empty: "No website orders in this period."
- Table: **Order** (orderNo + muted consignment) · **When** (yyyy-MM-dd) · **Customer** (name or "—" + muted payment method) · **To collect** (right; COD → amount, else muted "paid online") · **Courier says** (pill: tone ok→green, bad→red, else amber; text courierLabel) · **In this ERP** (invoiceNo muted, or link cell).
- Link cell (`courierLinkCell`): no suggestions & not handled → amber "not entered". Otherwise amber pill "by hand — not linked" / "not entered" + (suggestions) select options "<id> · <when> · <customer> · <total>" + "another invoice…" (value '') or (no suggestions) text input "Invoice no." + button "Link". Click: if value empty → prompt "Invoice number for website order <no>:"; amount-gap note if COD differs from invoice total by > 0.5: "\n\nNote: the courier collected X but the invoice total is Y. Only the invoice total can be marked paid; the rest (usually delivery charge) stays outside the invoice."; confirm "Tie website order <no> to invoice <inv>?\n\nNothing on the invoice changes except a note saying it is this website order.<gap>" → `erpLinkWebOrder({orderNo, invoiceNo})` → toast "Order <no> is now tied to <inv>." reload courier.
- Footer: "Delivered means the rider collected the money, not that it has reached your account — Steadfast settles later. As of <generatedAt>."

**2. Card "Website orders"** — sub "<pending> of <total> not yet entered into the sheet. Entering one creates a real invoice and deducts stock."
- Button `#wo_pull` "Check the website for new orders" ("Checking…" disabled while `BUSY==='pull'`) → `erpTool('pullOrders')` → toast with the server sentence; reload WEB. Error "Could not check the website: …".
- Empty: "No website orders pulled yet."
- Table (scroll tall): **Order** ("#<no>") · **Date** (first 16 chars of order_date) · **Customer** (name or "—" + muted phone) · **Items** (lines "<product> ×<qty>" joined by `<br>`, 12.5px) · **Order total** (right) · **Payment** (raw text or "—") · **State** (green "✓ Entered" / red "✕ Not entered") · actions (only when not entered): "Enter as invoice" ("Working…" while busy) and "Already entered".
- Sort: newest `date` first (string compare).

### A3.2 Actions
- **Enter as invoice**: confirm "Enter website order #<no> as an invoice?\n\nStock will be deducted and a PDF created." → `erpEnterWebOrder(no)` → toast 15 s "Order #<no> entered as **<invoiceNo>** · Open PDF" (link `pdfUrl`) → reset WEB/CAT/D/ORDERS, `loadWeb()`, `loadAll()`. Error toast "Could not enter the order: …".
- **Already entered** → modal `webHandledBox(no)` (UI:7756-7806): fixed overlay (click outside closes), card max 520: "Order #<no> — which invoice is it?" then "Looking for the invoice…" → `erpWebOrderInvoices({orderNo})`. If already linked → close + toast "Order #<no> is already tied to <inv>." Else body: sub "<customer> · <phone> · <total>. Tying it to its invoice is what lets Steadfast's payout mark that invoice paid." + radio list of suggestions ("**<id>** <when> · <customer> · <total>", first checked) or note "No invoice with this phone number was found near that date."; radio "Another invoice:" + input `#wh_other` (placeholder `INV-YYYYMMDD-0000`, focusing it selects the radio); radio "There is no invoice — it was cancelled or never sold". Buttons Cancel / primary Save.
  - none → confirm "Tick order #<no> off with no invoice?\n\nNothing is sold and no stock moves." → `erpMarkWebOrderEntered(no)` → toast "Order #<no> ticked off — no invoice."
  - invoice (picked or typed; empty → "Choose the invoice, or type its number.") → `erpLinkWebOrder({orderNo, invoiceNo})` → toast "Order #<no> is tied to <inv>." Both reload web + courier.

### A3.3 Server rules
**WEB_ORDERS tab** (Code.js:3873-3900): `pulled_at, order_date, order_no, status, sku, product, qty, line_total, customer, phone, address, payment, order_total, entered_in_sheet (No|Yes validation), manager_note`; one row per order line; phone column text; tab colour #0B6E4F, header #2C3E50.

`erpWebOrders()` (ERP.js:1507-1542): groups rows by `order_no` → `{no, date (order_date first 16 chars), status, customer, phone, address, payment, orderTotal, entered (any line 'yes'), lines:[{sku, product, qty, lineTotal, row}]}`; sorted by date desc.

`pullWebOrders()` (Code.js:3905-3945): script lock 10 s ("busy"); `GET https://costareen.com/wp-json/cz/v1/orders?limit=100&since=<UTC ISO, now−7 days>` with header `x-cz-key: <secret>`; response `{items:[{number, created, status, sku, product, qty, line_total, customer, phone, address, payment, total}]}`; de-dup key `order_no|sku` against existing rows; appends `[now, created, number, status, sku||'(no sku)', product, qty, line_total, customer, formatBdPhone_(phone), address, payment, total, 'No', '']`. Returns `{ok, fetched, added}` → erpTool sentence "Checked N order line(s), added M new row(s)."

`erpEnterWebOrder(no)` (ERP.js:1550-1612): refuses unknown/entered; matches each line SKU (case-insensitive) to catalog — unknown → "These SKUs are not in PRODUCT_MASTER: … Add them first, then enter the order."; per line discount = `max(0, round(sell×qty − line_total))`; `deliveryCharge = max(0, round2(orderTotal − Σ line_total))` (delivery + COD fee); payment via `erpWebPayment_` (ERP.js:5759): /cash on delivery|\bcod\b/ → COD/Pending; /eps|card|visa|master|amex|nagad qr|bangla ?qr|online/ → "Bangla QR"/Paid; /bkash/ → bKash/Pending; /rocket|nagad/ → raw/Pending; /bank/ → "Bank Transfer"/Pending; /cash/ → Cash/Paid; else raw (or Cash)/Pending. Calls `erpCreateInvoice({customer:{name, phone, address, source:'Website order'}, items, deliveryCharge, advancePaid:0, paymentMethod, paymentStatus, note:'WEB-<no>'})` with `ERP_WEB_ENTRY=true` (skips the role discount cap and the strict 11-digit phone check, ERP.js:897-910). Then sets `entered_in_sheet='Yes'` on all its rows. Returns `{ok, invoiceNo, pdfUrl, orderNo}`.

`erpMarkWebOrderEntered(no)` (ERP.js:1900-1925): lock; sets 'Yes' on all rows of the order; "Order <no> not found." if none.

`erpWebOrderInvoices({orderNo})` (ERP.js:11505-11528): builds `loose` map of invoices from SALES_LOG (skip RTN-): `{id, at, when, customer, phone10, total = max grand_total (col Q), linked if note has WEB-}`; `linked` = invoice whose note contains `WEB-<no>`. Suggestions `erpLinkGuess_` (ERP.js:10652): same last-10-digit phone, not linked, invoice date within [order −2 days, order +14 days], nearest first, max 5.

`erpLinkWebOrder({orderNo, invoiceNo})` (ERP.js:10682-10744): lock; order no without spaces; refuse if order already tied to another invoice or invoice tied to another order; on every SALES_LOG row of the invoice prepend `WEB-<no> ` to notes (col N); log one row to `INVOICE_FIXES` `[fixed_at, invoice_no, 'website order', was, now, fixed_by]`; set WEB_ORDERS rows of the order to 'Yes'. Returns `{ok, orderNo, invoiceNo, rows, already}`.

`erpCourier({days:30})` (ERP.js:5817-5900): `GET https://costareen.com/wp-json/cz/v1/cod?days=<d>&limit=200` (x-cz-key) → `{orders:[{order_no, date, customer, phone, method, total, cod_amount, consignment, courier}]}`. Courier words (ERP.js:5799): delivered "Delivered" ok collected; partial_delivered "Part delivered" warn collected; in_review "With the courier" info; pending "Waiting pickup" info; hold "On hold" warn; cancelled "Cancelled" bad; returned "Came back" bad; unknown "Courier says unknown" warn; anything else → word itself or "Not booked" (tone warn if consignment else info). Totals: collected Σ cod of collected; lost Σ cod of cancelled/returned; waiting Σ cod of others with a consignment. Per order: `isCod` from method regex, `invoiceNo` (SALES_LOG note `WEB-<no>`), `handled` (no invoice but WEB_ORDERS ticked Yes), `suggest` via `erpLinkGuess_`. `generatedAt` 'd MMM yy, h:mm a'. Website unreachable → "Could not reach the website: …".

Website stock push (Tools; also 15-min cycle): `POST /stock` `{mode:'dry'|'apply', zero_policy:'outofstock', items:[{sku, qty}]}` where qty = max(0, round(STOCK_VIEW.available_stock (col L) − un-entered WEB_ORDERS qty for that SKU)) (Code.js:3966-4001). Response fields used: `changed[{sku,from,to,status_to}], changed_count, unchanged, missing_count`. Also `GET /ping` → `{site}` at setup.
Auth for all `cz/v1` calls: header `x-cz-key: <secret>` from script property `CZ_SYNC_KEY` (moved there from SETTINGS `website_sync_key` by menu "Setup Website Sync", which then writes "(stored privately)" into the cell) (Code.js:3791-3868).

---------------------------------------------------------------------

## PART A4 — SETTINGS (`data-view="settings"`)

Role: nav shareholder+. On entry: `loadKeyStatus()` (`erpCourierKeyStatus`, manager), `loadSettings()` (bundle `settings` → `erpSettingsFull`, shareholder), `loadAdmin(false)` (`erpAdmin`, shareholder; only once per page unless forced).
States: `SET_ERR` → red note "**Could not read the SETTINGS tab.**<br>…"; not loaded → "Loading settings…".

### A4.1 Section order (UI:8884-9038)
1. **Business logo** card (all who reach Settings; upload only owner/shareholder) (UI:2485-2525): sub "One logo for **this business**. It shows in the menu, on invoices, quotations and letterheads. Another business keeps its own." Shows 84×84 logo or "No logo yet — the first letter of the name is shown instead."; `label.btn` "Upload logo"/"Change logo" with hidden file input (png/jpeg/webp); "Remove" (if logo); note "PNG, JPEG or WebP, up to 1 MB. Empty border around the logo is cut off for you."
   - Upload: >1 MB → "That image is over 1 MB. Use a smaller one."; toast "Saving the logo…" → `erpQuoteAssetUpload({kind:'logo', mime, data})` (shareholder; ERP.js:9522: mime png/jpeg/webp, ≤1 MB, file in Drive `ERP_Assets` named `<kind>_<ms>`, profile.logoId set, logoTrimId cleared, id appended to `assets` list (last 200), saved in QUOTE_SETTINGS) → updates quote boot/profile, brand cache, uploads trimmed copy; toast "Logo saved. It is now used in the menu, invoices, quotations and letterheads."
   - Remove: confirm "Remove the logo of this business? Saved quotations keep the logo they were made with." → `erpBrandLogoClear()` (shareholder; clears logoId & logoTrimId) → toast "Logo removed."
2. **Info note** (▲): "These are the lists the rest of the system reads from — the same SETTINGS tab in the sheet. Removing a value only stops it being offered from now on; products already using it keep their own text."
3. **Owner-only cards** (`ME.role === 'owner'`):
   a. **Backups** (UI:9156-9203) — loads `erpBackupStatus()` (owner) on first render ("Checking the backups…"). Sub "A full copy of the business sheet is saved every night at 3 AM into a Drive folder called **ERP_Backups**. The newest <keep=14> are kept. Nothing is ever restored automatically: to go back, open a copy and take what you need from it." Error → red note. Row: pill "✓ Nightly timer on" (green) / "✕ Nightly timer missing" (red); pill "Last copy: <lastAt>" (amber if stale: no copy or > 36 h; else green) or "No copy made yet"; "<count> kept"; button "Back up now" ("Copying…") → `erpBackupRun()` (owner; ensures timer; `erpBackupNow_('by hand')`; busy → "A backup is already running. Try again in a minute."; none made → "The backup could not be made: …") toast "Backup made."; link button "Open the folder". Failed list red note "Could not copy: …". Partner links line: "Partner links: N business(es) have their own link. They are brought up to today's code every night — updated <when>: a, b / — all up to date as of <when>." + red note "**A partner link could not be updated** and is running older code:<br>…" for failures. Up to 6 newest backups: name + when + "Open".
      Server: `erpBackupNow_` copies every registry sheet (or the child sheet) with name `<name> - backup yyyy-MM-dd HHmm`, description `erp-backup:<sourceId>`; keeps newest 14 per source (older trashed); records `ERP_BK_LAST` `{at, why, made, failed}`. `erpBackupStatus` → `{timer, keep, count, folderUrl, links: erpChildSyncInfo_(), lastAt, lastAgeHours, lastFailed, files[≤6]{name,when,url}}`.
   b. **AI access** (UI:9080-9153) — loads `erpAiKeys()` (owner). Sub "Let an assistant (Claude, your office agents) ask the ERP questions and work in it. Each one gets its own key, and the key can do exactly what a person in that role can do. Anything that changes the books is asked for twice. Staff codes, courier keys and settings are closed to every key. Switch a key off here and it stops at once." Fresh key note (once): "**The key for <name> — shown this once.** Copy it now and paste it where the assistant asks for it. It is not kept here and cannot be shown again; if it is lost, remove the key and make a new one." readonly monospace input + "Copy" + "I have saved it". Form: `#ai_name` "Who or what will use it" (max 40, placeholder "e.g. Rahman on Claude, Polok, Shop assistant") + `#ai_role` "It may do what a … can" (roles reversed: Sales (default) … Owner) + "Make a key" (name required "Give the key a name first.") → `erpAiKeyCreate({name, role})`. List: name + pill on/off + "<roleLabel> · made <created> · last used <lastUsed>|never used" + "Switch off"/"Switch on" (`erpAiKeySet({id, on})`) + "Remove" (confirm "Remove the key for <name>?\n\nWhatever uses it stops working at once. This cannot be undone - you would make a new key." → `erpAiKeySet({id, remove:true})`). Empty "No keys yet. Nothing outside this screen can reach the ERP." Line "Address to give the assistant: **<address>**". `<details>` "What the assistants have been doing (last N)": table When | Key | Action | Result (≤25 newest from ERP_AI_LOG).
   c. **WhatsApp (Evolution API server)** (`evoSettingsHtml`, UI:4434-4495) — status from `erpEvoStatus` (fetched once on wiring). Sub "Your own Evolution API server, for sending campaigns from a number logged in there. Kept for **this business** only; the API key is never shown again." Amber warning `EVO_WARN`. Status note: connected green "Connected: instance **<inst>** is logged in." / needsLink "**Server connected. One step left:** press **Link a WhatsApp number (QR code)** below and scan it with the phone." / error red. Fields: `#evo_url` "Server address" (placeholder https://wa.yourdomain.com), `#evo_inst` "Instance name", `#evo_key` "API key" (password; placeholder "•••••••• already set" or "from your Evolution server"). Buttons: "Disconnect" (if configured; confirm "Disconnect the Evolution server for this business?" → `erpEvoSetup({clear:true})`), "Link a WhatsApp number (QR code)" (configured & not connected → `evoLinkStart`: polls `erpEvoQr()` every 15 s up to 20 times while on the same view; connected → refresh status, toast "WhatsApp linked."), "Log the number out" (connected; confirm "Log this WhatsApp number out of the server? Campaigns cannot be sent until it is linked again." → `erpEvoLogout`), primary "Save and test" → `erpEvoSetup({url, instance, key})` (owner; URL must match `^https?://host(/path)?$` "The server address should look like https://wa.example.com"; instance `^[\w.-]{1,80}$` "The instance name: letters, numbers, - _ . only."; blank fields keep old values; trailing slashes stripped) → toast "WhatsApp connected." / "Saved. Now press Link a WhatsApp number and scan the QR code." / error. QR 260×260 with "On the phone with the **second** number: WhatsApp → Linked devices → Link a device, then scan. The code refreshes by itself."
   d. **Courier (Steadfast)** (UI:8903-8919, 9040-9076): sub "These keys belong to **<business>** alone. Another business gets its own; nothing is shared, and a copy of this system starts with none." Inputs `#sf_key` "API key", `#sf_sec` "Secret key" (password, placeholder "•••••••• already set" or "paste from your Steadfast account"); "Save" (both required "Both keys are needed." → `erpCourierSetKeys({apiKey, apiSecret})` (owner) → clears inputs, reloads status, toast "Courier keys saved for this business."), "Test" ("Asking…" → `erpCourierTest()` (owner) → `GET https://portal.packzy.com/api/v1/get_balance` with headers `api-key: <secret>`, `secret-key: <secret>`; ok when `status==200` → toast "Steadfast answered — the keys work."; else error text). Note "Saved keys are never shown again — type them once more to change them." Keys stored in script properties `ERP_SF_KEY::<sheetId>` / `ERP_SF_SECRET::<sheetId>`; `erpCourierKeyStatus` returns only `{hasKey, hasSecret, business}`.
4. **System values** card: sub "Stored in SETTINGS columns I and J. Credentials are not shown or editable here." Table **Setting | Value | (Save)**: secret keys (`website_sync_key`, `n8n_webhook_url`) show muted "stored privately" and no button; others an input `cfg_<i>` + "Save" → `erpConfigSet(key, value)` (shareholder; refuses secrets "That value is a credential and is not editable from here."; "Setting not found: <k>") toast "Saved **<key>**." Known keys: `business_name, currency, default_reorder, default_lead_time, n8n_webhook_url, invoice_pdf_folder_id, next_invoice_num` (+ `website_sync_key`, `payment_qr_file_id`, `erp_script_id`, `erp_link`, `erp_code_stamp`, `erp_code_at` when present).
5. **Device requests** (`viewRequests`, owner/shareholder, only when `DEVS.pending` non-empty) (UI:8530-8559): card with serious-orange border "<n> asking to use the ERP"; sub "Someone entered their code on a device you have not allowed before. Check the name and the device look right, then let them in. Nothing works for them until you do." Table Who (name + phone) | Role | Device (label e.g. "Android · Chrome") | Asked (d MMM, HH:mm) | primary "Let in" (`erpAllowDevice(id)`) + danger "Refuse" (`erpDenyDevice(id)`). Toasts "Allowed. They can start now." / "Refused.".
6. **Staff** (`viewStaff`, owner/shareholder) (UI:8614-8688): sub "Each person gets their own code, locked to the phone they use it on. You allow that phone the first time. They never see the sheet — only the screens their role permits." Error/loading states. New-code note (shown once): "**<name>** can now be given this code: <6 digits big> Send it to them. When they type it in, their phone appears below and you allow it." + "Done". Table **Name** (+phone) | **Role** | **Code** (right, spaced digits or —) | **Devices** (per device: label + pill allowed/waiting/refused/revoked + last used + "Remove" (approved; confirm "Stop this device working?\n\nThey can ask again from it later." → `erpRevokeDevice`) / "Let in" (pending)) | **Last used** | "Revoke" (if not revoked; confirm "Revoke this person?\n\nTheir code stops working straight away." → `erpRevokePerson(id)`, toast "Revoked."). Empty: "Nobody added yet — only you can use this ERP." Add form: `#st_name` "Name *" (placeholder "e.g. Rahim"), `#st_phone` "Phone (label only)" (01XXXXXXXXX), `#st_role` "Role" (roles list; shareholders cannot choose owner/shareholder; label "<Label> · max N% discount" for caps < 100), "Add person" (name required "Type their name.") → `erpAddPerson({name, phone, role})` → shows NEWCODE.
   Server: `ERP_USERS` hidden tab cols `user_id, name, phone, role, code, device_id, device_status, device_label, last_used, created, failed, locked_until, note`; `erpAddPerson` id `U`+yyMMddHHmmss; code = given 6 digits or random 100000-999999 unique; only owner may create owner/shareholder; `erpRevokePerson` sets device_status 'revoked' and blanks code (only owner can revoke an owner); `erpResetCode({id,newCode})` clears device fields (+ new code) — wired in UI (`data-newphone`) but no button renders it; `erpApproveDevice` (legacy single-device column) wired (`data-allow`) but not rendered. `ERP_DEVICES` hidden tab cols `device_id, user_id, label, status (pending|approved|denied|revoked), requested_at, decided_at, last_used, note`; `erpDevDecide_` updates the first row matching the device_id only. `erpPeople()` → `{people[{id,name,phone,role,roleLabel,code,status,devices[],lastUsed,note}], pending, roles[{id,label,cap}], iAm}`. `erpDevices()` → `{pending (newest first), approved, other}`.
7. **Links** (`viewLinks`; hidden if `BIZ.single` or `!BIZ.canAdd`) (UI:8793-8882): sub "Each business can have its own link, tied to its own sheet. A link made here opens that business and can reach no other — which is how a partner gets an ERP without getting yours. Making it again updates the same link with the latest version." Table **Business** (name + "(this one)") | **Its own link** ("the link you are using now" / link (first 46 chars…) / "no link yet") | "Create link"/"Update link" (confirm "Build this business its own ERP link?\n\nIt takes about half a minute." → `erpDeployBusiness(id)` (owner) → toast "**<name>** link updated / has its own link now · open it" 20 s) + "Copy" (clipboard → "Link copied." else prompt "Copy this link:"). Empty "No other businesses yet." Note: "Making a link takes about half a minute — it builds that business its own copy of this ERP. Do it again after any change here and that business gets the new version too."
   Server `erpDeployBusinessCore_` (ERP.js:3821-3895) via Apps Script REST API `https://script.googleapis.com/v1` with `Authorization: Bearer <OAuth token>`: create bound project (`POST /projects {title:'<sheet> ERP', parentId: sheetId}`, id saved to config `erp_script_id`) if none; `PUT /projects/<id>/content` with this project's files (manifest rewritten to `executeAs USER_DEPLOYING, access ANYONE_ANONYMOUS`) + generated `BusinessConfig.gs` (`ERP_CHILD_SHEET_ID`, `ERP_CHILD_NAME`); `POST /versions`; update existing deployment whose description starts with "ERP" or create; write `erp_link`, `erp_code_stamp` (MD5 of all files, first 16 hex), `erp_code_at` into that sheet's SETTINGS config. Error "The Apps Script API is switched off for this account. Open script.google.com/home/usersettings, turn on "Google Apps Script API", then try again." `erpBusinessLinks()` → `{businesses[{id,name,url,isHome}], canAdd}`.
8. **Add a business to this ERP** (if `!BIZ || BIZ.canAdd`) (UI:8945-8971): sub "Another business of **yours**. Same link and same staff — it just appears in the dropdown at the top. Nobody outside your team is given access." Fields: `#nb2_name` "Business name *" (placeholder "e.g. ProtoReen"), `#nb2_logo` "Logo" (image, preview), `#nb2_qr` "Payment QR (bKash / bank)" (image, preview), `#nb2_bank` "Bank / payment details" (textarea 4; placeholder "Bank name, account name, account number, branch"). Images ≤2 MB ("That image is over 2 MB. Please use a smaller one."). Note about starting empty and own logo/bank/QR. "Create business" ("Creating…") → name required → confirm "Create "<name>"?" → `erpCreateBusiness(NEWBIZ)` → toast "**<name>** created. Switching to it…" → reset caches, `loadBusinesses(loadAll)`. Output div `#nb2_out`.
9. **Start a business for a partner** (same condition) (UI:8974-9006): sub "For a joint venture — a business run by someone outside your team. Built exactly the same way, but the people you name here become editors of **that sheet only**. They never see this business, and you stay the owner until you hand it over from Drive." Fields: name, logo, QR, 4 partner emails (`pb_e1..e4`, placeholders partner@example.com / second partner / third partner / accountant or staff), bank textarea. Note "Their sheet is built empty and checked against this one before anybody is let in — if anything of yours were in it, it would be thrown away instead of shared. Their invoices carry their own logo, bank details and QR." "Create and share": name required; at least one email ("Name at least one partner, or use "Add a business to this ERP" instead."); confirm "Create "<name>" and give <emails> editor access to it?\n\nThey will not be able to see this business." → `erpCreateBusiness({name, bank, logo, qr, emails})` → `#pb_out` note "**<name>** created. Editor access given to … Could not add: … Open their sheet" + (warning) "**Do not send them the ERP link yet.** <warning>"; toast "**<name>** created and shared."
   Server `erpCreateBusiness` (owner; ERP.js:2398-2452): name unique in registry; `erpEmails_` validates emails (`That does not look like an email address: …`); `SpreadsheetApp.create('<name> - ERP')`; `erpBuildBusiness_` runs all setup builders (SETTINGS, PRODUCT_MASTER, TXN_LOG, STOCK_VIEW, SALES_LOG, CUSTOMERS, ENTRY_FORM, INVOICE, BATCH_RECEIVE, DASHBOARD, WEB_ORDERS, named ranges, invoice heal, COST_PRICES with N1:O4 settings) and `erpSetIdentity_` (business_name, blank `n8n_webhook_url, website_sync_key, invoice_pdf_folder_id, payment_qr_file_id`, INVOICE!C2 = name), deletes "Sheet1"; `erpBrandBusiness_` writes bank lines under the totals block, logo image at A1 (150×60), QR saved to Drive + `payment_qr_file_id` + image (160×160); `erpAssertClean_` refuses (and trashes) if any data tab has rows, or any cell equals a home customer name/phone, SKU or invoice no (> 4 chars), or a must-be-blank config is set; adds editors; registers and activates; returns `{ok,id,name,url,invited,couldNot,warning: erpAccessWarning()}` (warning text when the app runs as its owner: "This ERP is currently set to run as its owner, so anyone you give the link to would see every business in the switcher — not just their own. Sharing the SHEET is safe; sharing the ERP LINK is not, until the deployment is changed to run as the person using it.").
10. **Drop-down lists** (bottom) (UI:9014-9036): heading "Drop-down lists", sub "What the product and invoice forms offer to choose from." Grid of equal cards (height 320, chips scroll inside) for 7 lists with labels: Categories "Product groups, e.g. Filaments"; Brands "Manufacturers you stock"; Types "Material or model, e.g. PLA+"; Colours "Used in product names and SKUs"; Units "Roll, Piece, Set…"; Suppliers "Who you buy from"; Payment methods "Offered on every invoice". Each: "<n> item(s)", chips with "×", or "Nothing here yet."; add input "Add to <label lowercase>" + "Add" (Enter also adds).
    - Add: empty → "Type a value first." → `erpLookupAdd(kind, v)` (shareholder; lock; duplicate (case-insensitive) → `"<v>" is already in that list.`; sorted case-insensitive and the whole column rewritten from row 2) → toast "Added **<v>** to <kind>." → refresh `lists`+`options` bundle.
    - Remove ×: `erpLookupUsage(kind, val)` (count of PRODUCT_MASTER rows using it: categories C, brands D, types E, colors F, units G, suppliers H; payment methods → 0) → confirm "Remove "<val>" from <kind>?" + (n>0) "\n\nN product(s) currently use it. They keep their own text - it just stops being offered in the dropdowns." → `erpLookupRemove(kind, val)` (rewrites column; "not in that list" error) → toast "Removed **<val>**."
    - SETTINGS columns: A categories, B brands, C types, D suppliers, E units, F colors, G payment_methods; I config_key, J config_value (ERP.js:2035). `erpSettingsFull` returns `{lists:{…de-duplicated}, config:[{key, value ('' if secret), secret, row}]}`.

### A4.2 erpAdmin bundle (ERP.js:4685-4697)
`{ok, staff: erpPeople(), devices: erpDevices(), links: erpBusinessLinks(), people: erpBusinessPeople(activeId) (Drive owner/editors/viewers — loaded but not rendered anywhere), warning: erpAccessWarning()}` with per-part `…Error` strings. UI keeps `STAFF, DEVS, LINKS, PEOPLE` (UI:8699-8719).

---------------------------------------------------------------------

## PART A5 — TOOLS (`data-view="tools"`)

Role: nav shareholder+; server `erpTool` shareholder.

### A5.1 Layout (UI:7858-7891)
Card "Maintenance", sub "The same actions as the sheet menu. Each one reports what it did." Table **Action | What it does | (Run)**; button "Run" (class `danger` for dangerous ones), "Running…" + disabled while `BUSY==='tool'+id`.

| id | Name | Description | Danger |
|---|---|---|---|
| refreshStock | Recalculate stock view | Rebuilds STOCK_VIEW from TXN_LOG. | |
| sortProducts | Sort PRODUCT_MASTER | Sorts the product list into order. | |
| fixInvoiceLayout | Heal the invoice layout | Restores missing invoice formulas. Erases nothing. | |
| insertQr | Refresh the Bangla QR | Re-places the payment QR using the small 100 KB copy. | |
| previewPush | Preview website stock push | Shows what would change on the website. Changes nothing. | |
| pushStock | Push stock to the website | Updates live website stock levels now. | yes |
| pullOrders | Pull website orders | Fetches new orders into WEB_ORDERS. | |
| previewReorder | Check reorder levels against sales | Reports how many levels disagree with what the sales rate says. Changes nothing. | |
| applyReorder | Recalculate every reorder level | Replaces the typed-in levels with ones worked out from each product's own sales rate and lead time. | yes |
| mergeCustomers | Merge duplicate customers | Joins rows that share a phone number into one. Removed rows are copied to a backup tab first. | yes |
| prepareTemplate | Prepare this sheet (new copies only) | Removes every floating image, stored credential and inherited trigger. Run this inside a NEW copy, never here. | yes |

Click: dangerous → confirm "<name>\n\n<desc>\n\nContinue?" → `erpTool(id)` → toast (10 s) with the returned sentence; `refreshStock` → reload CAT/D (loadAll); `pullOrders` → reload WEB. Error toast 12 s.

### A5.2 Server `erpTool(action)` (ERP.js:1702-1814) — returns a sentence
- `refreshStock` → `refreshStockView()` → "Stock view recalculated." STOCK_VIEW rebuilt (Code.js:2468-2546): for each PRODUCT_MASTER SKU: in = Σ TXN qty with direction IN; out = Σ OUT; current = in − out; reserved from SALES_ENTRY (status pending/confirmed/reserved/approved/processing, not converted) + MANAGER_QUEUE (issue_type reserved/manual_review/pending & status pending/open/approved/reserved); incoming from MANAGER_QUEUE (issue_type incoming & status pending/open/approved/ordered); available = current − reserved; reorder = PM col L or 5; status OUT OF STOCK (avail ≤0) / REORDER (avail ≤ reorder) / IN STOCK; low_stock_alert YES/NO; values at cost and retail; last_received (RECEIVE/OPENING), last_sold (SALE); status (PM col O). Rewrites 22 columns + conditional formatting.
- `refreshDashboard` (not in UI list) → "Dashboard tab refreshed."
- `sortProducts` → sort PM rows by category, brand, type, color → "PRODUCT_MASTER sorted."
- `fixPhones` (not in UI) → normalise CUSTOMERS col C and SALES_LOG col D with `formatBdPhone_` → "N phone number(s) corrected." / "All phone numbers already correct."
- `previewPush` → `pushStockToWebsite('dry')` → "Preview only, nothing changed. Sent N products · would change X · already correct Y · not found on the website Z."
- `pushStock` → apply → "Website stock updated. Sent N · updated X · already correct Y · not found Z."
- `pullOrders` → "Checked N order line(s), added M new row(s)." (failure "Pull failed: …").
- `fixInvoiceLayout` → `healInvoiceLayout_()` → "Invoice layout healed (nothing was erased)."
- `insertQr` → removes images anchored in col A at/after totalStartRow+6 on INVOICE, inserts Drive file `BANGLA_QR_FILE_ID` (fallback old id) at row totalStartRow+9, 160×160 → "Bangla QR refreshed on the invoice (now the ~100 KB copy)." (error "The QR image in Drive is not accessible from this account.")
- `prepareTemplate` → `erpPrepareTemplate()` → "Prepared "<sheet>": removed N image(s), M stored credential(s) and K inherited trigger(s)." (see B4 danger).
- `mergeCustomers` → `erpMergeCustomers(true)` (ERP.js:2622-2715): group CUSTOMERS by `normalizePhone_` (last 10 digits); oldest row kept; longest name/address, first email, summed total_orders/total_spent, phone formatted; duplicates copied to `CUSTOMERS_DUPLICATES_BACKUP` (same header) then deleted bottom-up → "Merged N duplicated customer(s), removed M extra row(s). The removed rows were copied to CUSTOMERS_DUPLICATES_BACKUP first."
- `fixCustomerPhones` (not in UI) → "N phone number(s) given back their leading 0."
- `previewReorder` / `applyReorder` → `erpApplyReorderLevels(false|true)` (ERP.js:2761-2801): suggested level per SKU from `erpCatalog` = rate × (lead + safety) where rate = sold90/90 else sold365/365, lead = PM lead_time_days or 7, safety = max(1, ceil(lead×0.5)), result max(1, ceil(...)) or 0 if never sells (ERP.js:717-727); writes PM col L and refreshes STOCK_VIEW → "N product(s) would change (X raised, Y lowered). Nothing has been written." / "Reorder levels recalculated from sales: N changed (X raised, Y lowered)."
- Unknown → "Unknown action: <a>".

Self-test (Run diagnostics) is described in B13 (button actually lives on Products and is not wired).

---------------------------------------------------------------------

## PART C — ALL SHEET TABS AND COLUMNS THE SYSTEM RELIES ON

(Per business spreadsheet. Hidden = created hidden by code.)

| Tab | Columns (in order) | Notes / cite |
|---|---|---|
| SETTINGS | A categories · B brands · C types · D suppliers · E units · F colors · G payment_methods · (H blank) · I config_key · J config_value | Code.js:146-185; config keys listed in A4 §4; invoice counter in J8 |
| PRODUCT_MASTER | sku, product_name, category, brand, type, color, unit, supplier, cost_price, sell_price, margin_pct, reorder_level (L), lead_time_days (M), location_bin, status (O: Active/Discontinued), date_added, notes, + v4: image_link, supplier_sku, barcode, min_selling_price, warranty_note | Code.js:192, 2010 |
| TXN_LOG | txn_id, timestamp, sku, product_name, txn_type (RECEIVE/SALE/RETURN/DAMAGE/ADJUSTMENT/OPENING), direction (IN/OUT), quantity, unit_price, total_value, reference ("Invoice: <no>"), supplier, operator, notes | Code.js:235 |
| STOCK_VIEW | sku, product_name, category, brand, type, color, total_received, total_out, current_stock, reserved_stock, incoming_stock, available_stock, reorder_level, stock_status, low_stock_alert, cost_price, stock_value_cost, sell_price, stock_value_retail, last_received, last_sold, status | Code.js:2358 (v5) |
| SALES_LOG | order_id, timestamp, customer_name, customer_contact, customer_address, sku, product_name, quantity, unit_price, total, payment_method, payment_status, delivery_status, notes (N: `WEB-<order>` tie), discount (O), delivery_charge, grand_total (Q), advance_paid, due_amount, customer_source | Code.js:2889-2893 canonical |
| CUSTOMERS | customer_id, customer_name, contact_number, email, address, customer_type, total_orders, total_spent, date_added, notes, + v4: last_order_date, last_product_bought, customer_source, customer_status | Code.js:326, 1999 |
| CUSTOMERS_DUPLICATES_BACKUP | copy of CUSTOMERS header | ERP.js:2668 |
| WEB_ORDERS | pulled_at, order_date, order_no, status, sku, product, qty, line_total, customer, phone, address, payment, order_total, entered_in_sheet (No/Yes), manager_note | Code.js:3873 |
| SALES_ENTRY | entry_id, timestamp, source, customer_name, customer_contact, customer_address, requested_item, sku, quantity, payment_method, payment_status, delivery_status, status, priority, notes, assigned_to, converted_invoice | Code.js:2314 |
| MANAGER_QUEUE | queue_id, timestamp, source, customer_name, customer_contact, requested_item, sku, quantity, issue_type, issue_detail, available_stock, status, priority, manager_note, resolved_at, converted_invoice | Code.js:2336 |
| INVOICE, ENTRY_FORM, BATCH_RECEIVE, DASHBOARD | sheet-form tabs (cell layouts), not tables | Code.js:340-505, 914 |
| COST_PRICES | category, brand, type, buy_rmb, buy_bdt, handling, landed_cost, products, typical_sell, margin_%, updated_at, note; N1:O4 = EDIT THESE / RMB rate / default handling / minimum margin % | ERP.js:3493-3500 |
| ERP_USERS (hidden) | user_id, name, phone, role, code, device_id, device_status, device_label, last_used, created, failed, locked_until, note | ERP.js:3966 |
| ERP_DEVICES (hidden) | device_id, user_id, label, status, requested_at, decided_at, last_used, note | ERP.js:4726 |
| ERP_ERRORS | at, who, role, action, message, build (trim 200 when > 700) | ERP.js:4315-4330 |
| ERP_SPEED (hidden) | at, who, parts, total_ms, took, build, (steps) | ERP.js:1995 |
| ERP_AI_LOG (hidden) | at, key, role, action, result, detail | ERP.js:11648 |
| PAYMENTS | payment_id, order_id, customer, timestamp, amount, method, note, recorded_by | ERP.js:4882 |
| COURIER_LOG | booked_at, invoice_no, consignment_id, customer, phone, address, cod_amount, invoice_total, booked_by, note | ERP.js:5929 |
| EXPENSES | expense_id, recorded_at, month, kind, category, description, amount, item_id, recorded_by, voided | ERP.js:6566 |
| EXPENSE_ITEMS | item_id, kind, name, category, amount, from_month, to_month, note, set_by | ERP.js:6569 |
| RETURNS | return_id, returned_at, invoice_no, sku, product, qty, condition, value, money, customer, reason, recorded_by | ERP.js:7139 |
| INVOICE_FIXES | fixed_at, invoice_no, field, was, now, fixed_by | ERP.js:7625 |
| PURCHASE_ORDERS | po_id, ordered_at, sku, product, qty, received, ship_by, note, status, ordered_by, closed_at, rmb_unit, rmb_rate, supplier | ERP.js:7835 |
| PO_SHIPMENTS | po_id, shipment_no, agent, ship_by, weight_kg, shipping_bdt, arrived_on, lines, units, received_by, recorded_at | ERP.js:7853 |
| PO_DIFFS | diff_id, po_id, supplier, sku, product, kind, qty, rmb_unit, rmb_value, unit_bdt, status, created_at, decided_at, decided_by, settled_at, note | ERP.js:7856 |
| COURIER_PAYOUTS | payout_id, created_at, paid_at, cod_collected, delivery_charges, cod_fee, paid_to_bank, parcels, synced_at, fields_seen | ERP.js:8423 |
| COURIER_PAYOUT_LINES | payout_id, consignment_id, tracking_code, cod_amount, status, recipient_name, recipient_phone, parcel_created, invoice_no, match, delivery_charge, cod_charge | ERP.js:8426 |
| COURIER_RECON | consignment_id, payout_id, invoice_no, customer, expected, collected, gap, action, amount, note, at, by | ERP.js:8447 |
| DUE_REMINDERS | reminded_at, customer_key, customer, phone, due, by | ERP.js:9052 |
| QUOTATIONS | id, reference, version, status, title, customer, kind, total, currency, issue_date, created_at, updated_at, created_by, updated_by, save_key, json1…json8 | ERP.js:9125 |
| QUOTE_SETTINGS | key, value (JSON) — keys incl. `profile` {name,address,email,phone,website,footer,signer,designation,logoId,signatureId,qrId,banks,logoTrimId}, `settings`, `assets` (allowed Drive ids, last 200) | ERP.js:9162-9225 |
| QUOTE_ITEMS | key, name, description, kind, unit, historical_rate, product_sku, requires_review, source, added_at, added_by | ERP.js:9131 |
| CAMPAIGNS / CAMPAIGN_SENDS / CAMPAIGN_OPTOUT / CAMPAIGN_MESSAGES / CAMPAIGN_GROUPS / CAMPAIGN_LEADS | see A2.7 | ERP.js:9648-9653, 9888-9891, 10321-10322 |

**Script properties** (project-wide): `cz_businesses` (registry), `ERP_HOME_SHEET_ID` (optional), `CZ_SYNC_KEY` (<secret>), `ERP_SF_KEY::<sheet>`, `ERP_SF_SECRET::<sheet>` (<secret>), `ERP_SF_BAL::<sheet>` (balance cache 30 min), `ERP_SF_NIGHT::<sheet>`, `ERP_EVO_URL/INSTANCE/KEY/HOOK::<sheet>`, `ERP_CMP_STATE`, `ERP_BK_LAST`, `ERP_BK_DAILY`, `ERP_BK_ONCE`, `ERP_CHILD_SYNC`, `ERP_AI_KEYS`, `ERP_RENDER_KEY` (<secret>), `erpbad_<device>`, `erplock_<device>`. **User properties** (deployer's): `cz_active_business`, `cz_theme`. **CacheService**: `erp_owner_<sheet>` 600 s, `erp_canadd_<email>` 600 s, `cz_web_cids` 600 s, `erp_bk_checked` 6 h, `erp_render_nopair` 1 h, `aic_<ticket>` 600 s. **Browser localStorage**: `cz_theme`, `erp_device_id`, `erp_code`, `cz_brand::<bizId>`, `czcp_draft`, `czcp_testphone`, `czwa_mode`, quotation drafts `czq:<biz>:<name>:v1` (sessionStorage `czl:` for letters).

**Drive folders**: `ERP_Backups` (nightly copies), `Costareen_Expenses` (xlsx exports), `ERP_Assets` (logos, QR, signatures, product-list PDFs/sheets, campaign uploads), invoice PDF folder (config `invoice_pdf_folder_id`).

---------------------------------------------------------------------

## PART D — SERVER FUNCTIONS USED BY THIS SPEC (with min role)

Shell: erpHello (no gate), erpCall (gate), erpBundle (sales), erpBusinesses (sales), erpSetBusiness (manager), erpSetTheme/erpGetTheme (sales), erpToday (sales), erpSelfTest (shareholder), erpBrandLogo (sales), erpQuoteAssetUpload (shareholder), erpBrandLogoClear (shareholder), doGet, doPost → erpAiCall_ / erpWaHook_, timers erpNightlyBackup, erpCampaignTick, czSyncCycle, refreshStockView.
Expenses: erpExpenses, erpExpenseAdd, erpExpenseItemSave, erpExpenseItemEnd, erpExpenseFixedPay, erpExpenseRecurringSet, erpExpenseExport (shareholder); erpExpenseVoid (owner).
Campaigns: erpCampaignAudience, erpCampaignList, erpCampaignGet, erpCampaignCreate, erpCampaignMark, erpCampaignOptOut, erpCampaignRetry, erpCampaignPause, erpCampMsgSave, erpCampGroupSave, erpLeadsAdd, erpLeadSave, erpLeadRemove, erpWaProductPdf, erpProductListShare, erpShareFile, erpEvoUpload, erpEvoStatus, erpEvoCampaignStart, erpEvoSendBatch, erpEvoSendTest (manager); erpEvoSetup, erpEvoQr, erpEvoLogout, erpEvoStopHook (owner).
Web orders: erpWebOrders, erpEnterWebOrder (→ erpCreateInvoice), erpMarkWebOrderEntered, erpWebOrderInvoices, erpLinkWebOrder, erpCourier (manager); erpTool('pullOrders') (shareholder).
Settings: erpSettingsFull, erpLookupAdd, erpLookupRemove, erpLookupUsage, erpConfigSet, erpAdmin (erpPeople, erpDevices, erpBusinessLinks, erpBusinessPeople, erpAccessWarning), erpAddPerson, erpRevokePerson, erpAllowDevice, erpDenyDevice, erpRevokeDevice (shareholder); erpCourierKeyStatus, erpEvoStatus (manager); erpCourierSetKeys, erpCourierTest, erpBackupStatus, erpBackupRun, erpAiKeys, erpAiKeyCreate, erpAiKeySet, erpEvoSetup/Qr/Logout, erpCreateBusiness, erpDeployBusiness (owner).
Tools: erpTool (shareholder) → refreshStockView, refreshDashboard, autoSortProducts, healInvoiceLayout_, insertQr inline, pushStockToWebsite, pullWebOrders, erpApplyReorderLevels, erpMergeCustomers, erpFixCustomerPhones, erpPrepareTemplate.
