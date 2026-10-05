# Platform blueprint: public install, protected logic, oversight, open market

Agreed with the owner 2026-10-05. Status: **blueprint, not built.** Open decisions at the end.
Read with CLAUDE.md (how stages are built) and docs/CHANGES.md (what exists).

## 1. Goals

1. Anyone can install the ERP from **one permanent link** (also as a QR code and a website button).
2. **Nobody can copy the system.** The logic and the page stay on the provider's side; a customer holds only data.
3. **Free to run** for the provider until there are many customers (Supabase free + Cloudflare free).
4. The provider sees **every company** (name, owner, activity), can **upgrade** and **announce**, and can do a
   **disclosed, logged compliance check** of a company's stock, sales and money.
5. If the provider's connection is removed, **the ERP stops** for that company.
6. An **open market**: the provider's stock is visible to every company; a company that shares its own stock
   sees everyone's.
7. The builder's name never appears to customers.

Not a goal: making imitation impossible. Someone can build a similar ERP from scratch; only the head start,
the market network and copyright law protect against that.

## 2. Architecture: brain on the provider's side, data on the customer's

```
                 the provider (free Supabase project oqzcuuytytqadqjlwdsh + Cloudflare Pages)
  ┌──────────────────────────────────────────────────────────────────────────────────────┐
  │  Page (UI)  - served from the provider's Cloudflare, on the neutral domain           │
  │  Edge Function "erp" - ALL logic; for each request: who is it, which company,        │
  │                        open that company's database, run the handler, answer          │
  │  Control tables - companies, encrypted connections, announcements, market listings,   │
  │                   compliance log, health checks                                       │
  │  Timers (cron) - one set for all companies                                            │
  └───────────────┬──────────────────────────────────────────────────────────────────────┘
                  │  the bridge: an encrypted database connection per company
  ┌───────────────▼─────────────────────┐   ┌───────────────────────────────┐
  │ Company A's own free Supabase       │   │ Company B's own free Supabase  │  ...
  │ plain tables + its files + its logins│   │                               │
  └─────────────────────────────────────┘   └───────────────────────────────┘
```

- **Today** the installer copies the whole server (Edge Function code and SQL functions) into the customer's
  project, where it can be downloaded. That ends: the customer's project gets **tables, storage and sign-in
  only**.
- **The Edge Function becomes multi-company.** A request carries the company (from the address, e.g.
  `acme.<domain>`, or `?use=<id>`). The function loads that company's connection from the control tables,
  decrypts it, and runs the same handlers as today against that database (`ctx.tx` stays the same idea).
  The provider's own business (Costareen) is simply the company whose database is the provider's own.
- **Connections:** the company's pooled Postgres URL (Supavisor, transaction mode) is stored encrypted
  (AES-GCM, master key only in the function's secrets). Connections are reused inside a running function.
- **Sign-in stays in the company's project** (their users, their passwords). The page signs in against
  their Supabase Auth; the function checks the token against that project's public signing keys.
- **Files** stay in the company's storage; the function hands out short-lived links.
- **Database functions:** the SQL functions the installer puts in a company's database today
  (`create_business`, `erp_set_member`, `my_business_ids`, triggers, ...) are reviewed: logic moves into the
  function; only what the tables need to stay consistent remains. The company's database then shows plain
  tables only.
- **Upgrades become instant:** the logic and page are central, so every company runs the newest version the
  moment it is deployed. "Update" only means applying new table changes, which the provider does over the
  same bridge. "Update all" = one button.

## 3. Install: one permanent link

- `https://<domain>/start` - never changes. **QR code** of it (PNG and SVG, downloadable in Platform).
  **Website button**: a copy-paste link snippet.
- Steps: company name, owner name, e-mail, **agree to the terms** (checkbox, with a link to them) →
  free bot check (Cloudflare Turnstile) → **e-mail confirmation** → connect Supabase (token or Supabase
  sign-in) → the installer makes their project with **tables, storage and sign-in only**, makes the owner
  login, stores the encrypted connection → the owner gets the set-a-password e-mail → the ERP opens at
  `<company>.<domain>`.
- The one-time invite codes go; the provider can still send a personal link.
- **The Supabase step stays the hardest part for shop owners.** It gets a step-by-step guide (done) and,
  later, the hosted Quick-start plan (Stage 5) removes it.

## 4. The provider's view (Platform)

- **Companies:** name, owner, e-mail, city, sign-up date, last active, counts (products, invoices this
  month), connection health, version of their tables.
- **Announcements:** write a message (info / warning, optional end date) → it shows in every company's ERP.
- **Update all:** apply pending table changes to every company; per-company result.
- **Lock / unlock** a company by hand (with a reason that the company sees).

## 5. Compliance check (disclosed, logged)

- The terms accepted at sign-up say the provider may view stock, sales and money records to check for
  illegal use or when the law requires it.
- **Compliance view** in Platform: pick a company, type a reason, see its stock, invoices, payments and money
  accounts **read-only**.
- Every view is written to **the company's own activity log** ("Provider viewed Money - reason: ...") and to
  the provider's audit list. No silent access.

## 6. The lock

- A health check (hourly, and on every request) tests the bridge. If the connection or the provider's key no
  longer works, the company is marked **disconnected** and its ERP shows only: "Provider connection removed
  - reconnect to keep using the ERP." Their data stays in their own Supabase (theirs to keep).
- Because the page and logic live on the provider's side, a disconnected company has no working ERP; copying
  the page does not help (it only talks to the provider's server, and refuses to run on other addresses).

## 7. Security page: the provider key

- Shown honestly: **"Provider key - verified ✓ (connection, updates, compliance checks)"**, with a fingerprint
  the provider's server signs, so it cannot be faked.
- Every other key the ERP knows (AI keys, access links) is listed; anything unknown is shown in red.

## 8. Open market (Stage 2)

- **Visibility rule:**

  | Company's "Share my stock" | Sees | Its stock is seen by others |
  |---|---|---|
  | off | the provider's stock only (unlabelled) | no |
  | on  | the provider's stock + every sharing company, in one list | yes |

- Sharing per product; quantity as "in stock / low", price or "ask"; seller shown as "Supplier · <city>"
  until a deal. The provider's own listings look the same as any other seller's.
- **How:** the provider already has the bridge, so a timer reads shared products from each sharing company
  every 15 minutes into a central **market listings** table (only the shared fields). A **Market** tab in every
  ERP searches it; each listing shows "updated N min ago". A **Request** button (Stage 3) sends an inquiry.
- Terms state that the platform operator may also list stock.

## 9. Protection against copying

1. Logic on the provider's server (section 2) - the main protection.
2. Page locked to the provider's addresses, built minified and hard to read.
3. Hidden markers in the code to prove a copy came from the provider.
4. Licence terms at sign-up; software registered with the Bangladesh Copyright Office (owner's task).

## 10. Cost and limits (free plans)

- Provider's Supabase free: ~500,000 function calls and 5 GB traffic a month → roughly **5-10 busy shops**
  (estimate; to be measured on the live ERP before launch). Database today 29 MB, files 20 MB.
- Customers' data and files: in their own free projects (500 MB database, 1 GB files each).
- Next step when needed: Supabase Pro ($25/month: ~2 million calls, 250 GB) → hundreds of shops.
- Risk: **free Supabase projects pause after a week without activity.** The hourly health check queries every
  company, which counts as activity; to be confirmed during Stage 1.
- Later move of all companies into one paid project (hosted plan): one script per company copies tables,
  files and logins; a few minutes of downtime each.

## 11. Stages

| Stage | What | Done when |
|---|---|---|
| 1a | Multi-company function + bridge (encrypted connections), company chosen by address, sign-in checked against the company's project; existing copy "example" and Costareen moved onto it; installer stops copying code | tests for two companies side by side; the live copy works through the bridge |
| 1b | Permanent /start link, QR, website snippet, terms checkbox, Turnstile, e-mail confirm | a new company installs from the QR end to end |
| 1c | Platform: companies list, announcements, Update all, lock/unlock, health check + disconnected lock | lock tested by removing the key on a test copy |
| 1d | Compliance view with reasons + logs in both places; Security page provider key verified | logged view visible in the company's ERP |
| 1e | Database functions moved out of company databases; page minified + address lock | a company's database shows plain tables only |
| 2 | Open market: share switch (business + per product), listings timer, Market tab | provider stock visible to all, shared stock to sharers |
| 3 | Request → quotation → invoice between ERPs, ratings | a deal between two test companies |
| 4 | Shared product catalogue, low-stock market hints, price guide, wanted board | - |
| 5 | Hosted Quick-start plan (no Supabase step) | - |

Every stage: tests, local check, deploy, CHANGES.md entry, commit and tag (CLAUDE.md §4).

## 12. Open decisions

1. **The domain** for the permanent link and company addresses (the owner has one, 3D-printing related).
2. Stage 1 alone first, or Stage 1 + 2 together.
3. Market terms wording: "the platform operator may also list stock" (without naming the provider) - OK?
4. Provider key label as in section 7 - OK?

## 13. Owner's tasks outside the build

- A lawyer for the terms of use and privacy notice (Bangladesh).
- Registering the software with the Bangladesh Copyright Office.
- Pointing the domain's DNS to Cloudflare when asked.
