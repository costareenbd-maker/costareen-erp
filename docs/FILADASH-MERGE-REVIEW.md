# FilaDash + Costareen ERP: review and merge plan (13 Oct 2026)

Inputs: `FilaDash-ERP-package.zip` (unpacked read-only in `G:\filadash-review\src\FilaDash`) and this repository.
Owner's goal: one ERP. FilaDash's UI is the main UI; Costareen's formulas take priority; FilaDash's extra
features are brought over; then it goes live on Supabase so both developers work on it.

## 1. What each one is

| | Costareen ERP (this repo) | FilaDash package |
|---|---|---|
| State | **Live**, running Costareen's real business since Oct 2026 | **Design only**: no backend, no login, no saving; sample data regenerated on every load |
| Backend | Supabase Postgres (106 migrations) + one Deno Edge Function (`erpCall`), RLS per business | None. The spec targets FastAPI + Next.js inside prototypebd.com |
| Front end | One file `web/app.html` (~22k lines, string-built screens) | Plain HTML/CSS/JS, no build: `fd-core.js` (router, shell, components) + one file per screen (~27k lines) |
| Tests | ~100 suites against a real database | 149 Python tests of the money rules (`poc/`) |
| Data | Real (live) / demo (local) | Fictional, deterministic |

Both are framework-free JavaScript. That makes a merge practical: FilaDash's screens can be wired to our API
without a rewrite into React or Next.js.

## 2. Features side by side

**Both have** (rebuild in FilaDash's look, keep our logic): dashboard, products / stock, sales and invoices,
customers by phone, payments and dues, expenses, investors / capital, roles, audit log, backup and restore.

**Only FilaDash has** (bring over):
- Shipments with a lifecycle (Planned → Ordered → In transit → Received → Sold out), five-step landed-cost wizard,
  freight per chargeable kg (volumetric weight), extra cost lines split by weight / value / units, agent wallet.
- FIFO lots: every unit's cost comes from the shipment it arrived in.
- Holding cost: warehouse rent spread over stock by kg × days, monthly.
- Investors per lot: share of profit on the units each investor funded, month close, statements, payouts,
  read-only investor portal (secret link + code).
- Commission per seller / brand / item.
- Business units: Filament and 3D Printers as separate businesses with an owner-only merged view.
- Payments reconciliation and daily cash-up.
- "Show calculation" on every figure; editable dashboard widgets; saved views, column chooser, CSV everywhere.
- System Check (36 invariants), ERP Mind Map, Bangla owner guide, field-level visibility per role.

**Only Costareen has** (keep): Steadfast courier, WooCommerce website sync, WhatsApp campaigns, quotations,
repairs, print jobs, serial numbers / Printer Passport, the public network pages (Find stock, Print Doctor ...),
joint stock with a partner company, resellers, Creators programme, AI assistant and receive-from-file,
multi-company platform with company copies, month lock, cost book.

## 3. Formula conflicts (the owner decides each one)

| # | Area | Costareen today | FilaDash | Recommendation |
|---|---|---|---|---|
| F1 | Cost of goods | Cost book: one buying price per category / brand / type, fixed on the invoice at sale | FIFO lots: each unit carries its own shipment's landed cost | **FIFO**, fed by our receive-shipment; the cost book stays as the fallback for stock bought before lots existed |
| F2 | Investors | Capital holders with monthly or percent returns on money invested | Share of profit on the units each investor funded, per lot, month close | Keep ours for Costareen's capital; add FilaDash's per-lot model as a choice per investor |
| F3 | Warehouse rent | Ordinary expense | Holding cost spread over stock (kg × days) | Optional switch, off by default |
| F4 | Money format | `numeric(14,2)` in Postgres | Integer poisha | Keep ours: Postgres numeric is already exact; adopt FilaDash's rounding rules (largest row takes the residual) |
| F5 | One business vs units | Separate companies | Business units inside one company | Add units inside a company (Filament / Printers); keep companies as they are |

### Owner's decisions (13 Oct 2026)

- **F1 Cost of goods: FIFO with landed cost**, the way Odoo does it (Odoo offers Standard / Average / FIFO;
  FIFO + landed costs is what importers use, and per-lot investors need it). Each receive creates a lot with its
  landed cost per unit; a sale takes cost from the oldest lots first and freezes it on the invoice line. Stock that
  existed before lots gets one opening lot per product at today's cost-book value. The cost book stays as the
  fallback (e.g. selling more than the lots hold) and for price planning.
- **F2 Investors: yes**: keep our capital returns and add per-lot profit share as a choice per investor.
- **F3 Holding cost: yes, ON by default** (warehouse rent spread over stock by kg × days, monthly).
- **F5 No business units.** One business. Instead a **product-group drop-down on the dashboard**
  (All / Filament / Printers / Accessories ...): picking one shows that group's stock value, cost, sales,
  profit, dues etc. Groups come from product categories.
- **Going live:** merge and review locally first. Then deploy without touching the running ERP that staff use.
- **GitHub:** the repo has no remote yet; the owner provides the repo.

## 4. Recommended way to merge

Keep **our backend** (live, tested, already serving Costareen and PrototypeBD). Take **FilaDash's front end**
(design system, shell, components, screens) and wire it to our API, screen by screen. Bring FilaDash's extra
features in as new server functions with tests, using FilaDash's 149 tests as the check list.

Phases, each one finished, tested and shown before the next:

| Phase | Work |
|---|---|
| P0 | Shared development: a separate Supabase project `costareen-dev` (not live) loaded with the demo data, and a private GitHub repo for both developers |
| P1 | FilaDash's shell and design system around our ERP: its sidebar, top bar, light/dark themes, fonts and components; our screens keep working inside it |
| P2 | Core screens in FilaDash's design on our data: Dashboard, Orders / Sale, Customers, Inventory, Payments, Expenses |
| P3 | FilaDash's extras: Shipments + landed cost + FIFO lots, Investors per lot + portal, Commission, Business units, Analytics, System Check, Mind Map |
| P4 | Our extras moved into the new shell: courier, website, campaigns, quotations, repairs, print jobs, network pages, joint stock, creators, AI |
| P5 | Switch live: Costareen's real data moves to the merged ERP after a dry run on a copy |

The live ERP keeps running unchanged until P5.

## 5. Risks

- **Size.** FilaDash's screens assume FilaDash's data shapes (`FD.q`, lots, figures with lineage). Each screen has
  to be rewired, not just restyled. P2 and P3 are the bulk of the work.
- **Two systems in parallel** until P5: a fix made to the live ERP must also go into the merged one.
- **Money logic.** F1 and F2 change how profit is counted. They need the owner's yes before the build, and a
  side-by-side run on the same data before they replace anything live.
- FilaDash's spec was written for prototypebd.com's platform (nginx, FastAPI workers, its order tables). Those
  parts do not apply here and are left out.
