# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

- **Shop staff on a phone (sales role).** Standing at the counter or on the floor of a Bangladeshi 3D-printing supplies
  shop, one hand free: make an invoice, look up stock or a customer, take a payment, scan a serial or an invoice. Fast,
  interrupted, often on a mid-range Android over a mobile network.
- **Staff / manager at a computer.** Longer desk sessions: receive shipments (Stock entry), supplier orders, money and
  cash book, reports, product cost, settings.
- **The owner (Rahman), on both.** Not a programmer. Decides and approves; reads profit, dues, stock value and the
  dashboard; works from the shop PC and from his phone outside. Judges a feature by what is visible on the first screen.
- **Partner company / shareholders.** Joint stock with a partner business (pool, month-end settlement, who pays whom);
  shareholders see nearly everything except users, keys and connections.

Confirmed by the owner, 30 Oct 2026.

## Product Purpose

A web ERP that replaced Costareen's Google-Sheet ERP and now runs the business live at erp.costareen.com: sales and
invoices, stock and lots with landed cost, suppliers and shipments, money accounts and cash, capital and investor
returns, expenses, commission, joint stock with a partner company, repairs, website/courier sync, and an AI assistant.
Success: staff do the day's work quickly without errors; the owner trusts every figure (one net profit everywhere,
nothing deleted, every number traceable, closed months locked).

## Positioning

Built for a Bangladeshi trading shop's real day rather than a generic ERP: Bangla-first wording in the words shop staff
actually say, cash-on-delivery and courier (Steadfast) flows, BDT and import landed cost, joint stock shared between two
companies, and AI that reads invoices and executes after one approval. Owner's decision (30 Oct 2026): it will be sold
to other businesses, so design for that **now** - nothing Costareen-specific where a per-business setting would do; each
business brings its own name, logo and colours.

## Operating Context

- Multi-business: one login can hold several businesses (e.g. Costareen, Oliareen) and switches between them; each
  business has its own menu settings (screens Off / Only owners) and roles (sales < manager < shareholder < owner).
- Phone and desktop are both primary: phone bottom tab bar + folding menu; desktop side menu. Must work at 375 px with
  no sideways scroll.
- Two developers work on it; dev ERP (demo data) at costareen-erp-dev.pages.dev, live at erp.costareen.com.
- Printed documents (invoices, quotations, price lists) are part of the product and keep their own look.
- New features ship owner-only first ("Only me" app flag), then open up.

## Capabilities and Constraints

- One hand-written page (`web/app.html`, string-built screens, `repaint()`), FilaDash design system with a switchable
  "Clean" look (default since 29 Oct 2026; the old "Current" look is kept until the owner says delete). Light and dark.
- Money logic is professional: nothing deleted (struck out with a reason), every figure traceable, month lock.
- Owner rules for the UI: a new ability is a visible button on the first screen, not a sub-form; no grey hint text
  beside form labels (use a "?" help button); plain refusals; people's own words (messages, comments) are never
  translated; no flashes on reload.
- Terms in Bangla follow `docs/research/bangla-audit.md` (কাস্টমার, সাপ্লায়ার, প্রোডাক্ট, ইনভয়েস, স্টক ...).

## Brand Commitments

- Product today: "Costareen ERP" for Costareen; for other businesses the business's own name and logo lead (per-business
  branding, not Costareen's).
- Voice: short, direct, plain words; verb-first buttons; no AI-sounding words.

## Evidence on Hand

- Live business data (Costareen) and demo data on dev; `docs/CHANGES.md` (every stage), `docs/PLAN.md`,
  `docs/research/bangla-audit.md`, `docs/JOINT-POOL-BLUEPRINT.md`.
- No customer testimonials, case studies or third-party benchmarks exist; do not invent them.

## Product Principles

1. Speed at the counter beats completeness: the common job (invoice, stock look-up, payment) is one or two taps.
2. Every figure is trustworthy and traceable; the UI never hides how a number was reached.
3. Visible first: if a feature matters, it is a button on the first screen in plain words.
4. Bangla-first for staff, English alongside; one word per idea everywhere.
5. Any business can own it: no Costareen-only assumptions in screens that a setting could cover.

## Accessibility & Inclusion

- Bangla script must stay large and legible (Bangla glyphs need more size and line height than Latin).
- One-handed phone use: touch targets reachable and at least 44 px; no sideways scroll at 375 px.
- Readable contrast in light and dark (contrast scan of every screen, 29 Oct 2026).
