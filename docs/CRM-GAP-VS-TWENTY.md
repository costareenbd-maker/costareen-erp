# Customers / Leads vs Twenty CRM: gap list (7 Nov 2026)

The owner asked whether to move the customer data to Twenty. The verdict was no, because the customer record is joined
to invoices, dues, the Inbox, points, courier and COD risk in 42 handler files. Instead, Twenty's good parts are built
into the ERP. This list compares Twenty's features (docs.twenty.com: Key Features, Record Pages, Views & Pipelines,
Workflows) with our code.

## Already as good or better in the ERP
| Area | Ours |
|---|---|
| Customer record joined to money | invoices, dues, statement PDF, payments, due reminders (customers.js, pages.js erpCustomerPage) |
| Merge duplicates | erpMergeCustomers + phone clean-up (fixPhones) |
| Tasks | follow-ups with a day and an outcome (custextra.js erpFollowups) |
| Insight | favourite colour/brand/product, first/last buy, spend, source (erpCustomerInsight) |
| Privacy | erase-on-request, refused while money is owed (erpCustomerErase) |
| Leads | one list fed four ways (auto from chats/comments/forms, find on maps/Google, paste a profile, import xlsx/csv); never added twice; convert to customer or supplier (leads.js) |
| Lead forms | own form pages (erpLeadForms, leadFormPage) |
| Notes and files | on customer, supplier, product, invoice (notes.js) |
| Conversations | Inbox: Messenger, Instagram, WhatsApp (several numbers), website chat, e-mail, with AI |
| Import / export | every list out as .xlsx; customers, products, suppliers in from .xlsx/.csv (excel.js) |
| Roles and log | sales / manager / shareholder / owner, channel scopes; activity log (security.js erpSecurity) |
| AI | Ask your ERP, Engine, Inbox AI |

## Missing (ordered by value for Costareen)
| # | Gap | Twenty has | Why it matters | Size |
|---|---|---|---|---|
| G1 | **One timeline on the customer page**: chats, notes, follow-ups, invoices, payments, parcels, returns in one feed, newest first | Record page timeline + tabs | Today the customer page shows invoices and payments; chats, notes and insight live elsewhere. Staff see the whole story in one place | M |
| G2 | **Leads board**: columns per stage, drag a card to move it | Kanban view | Faster daily lead work than a list | S-M |
| G3 | **Saved list views** on Customers and Leads: filters with AND/OR, sort by several fields, group, save with a name | Views | "Dhaka customers, no buy in 60 days" in one tap; feeds win-back messages (blueprint B4) | M |
| G4 | **Companies with several people**: a shop, school or print farm with its buyers | Companies + People objects | B2B buyers of filament and printers; one company's total and dues | M |
| G5 | **Custom fields per business** without code (text, number, date, choice) | Custom fields/objects | Each sold ERP company wants its own fields; today every new field is a migration | M-L |
| G6 | **Duplicate warning while typing a new customer** + a "possible duplicates" list to merge | Duplicate detection on import | Merge exists, but nothing points at duplicates. Not verified whether the save already warns | S |
| G7 | **Outgoing events** (customer made / changed, lead stage changed, order delivered) for n8n | Webhooks | Needed by the autopilot blueprint's B0 (n8n carries events) | S-M |
| G8 | **No-code rules**: when X happens, do Y | Workflows | Our automations are written in code. n8n can do this outside, so a light version is enough | M (or n8n) |
| G9 | **Bin and restore** for a deleted customer or lead | Soft delete | Not checked whether ours deletes hard | S |
| G10 | **Field-level hiding** (for example phone hidden from some staff) | Field permissions | Low today; matters when sold to bigger shops | S-M |
| G11 | **Calendar view** of follow-ups | Calendar view | Low | S |
| G12 | Gmail / calendar sync per person | Email + calendar sync | Low: 0 of 329 customers have an e-mail | M |

## Status (7 Nov 2026)
All twelve built on dev as crm-1 (see docs/CHANGES.md), owner-only. Not done inside them: merging customers with
different phones (G6), parcel delivered/returned events (G7), two-way Gmail/Calendar sync (G12: a subscribe link instead).

## Suggested order
G1 → G6 → G2 → G3 → G7 → G4 → G9 → G5 → G8 → G10 → G11 → G12.
Every one: dev first, tests, owner says "live koro". New features ship owner-only first (Only me flag).

## Not verified
- G6 and G9: the current save and delete behaviour was not read line by line.
- Twenty's API limits quoted in chat came from third-party write-ups, not from Twenty's docs.
