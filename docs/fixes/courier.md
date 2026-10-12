# Courier (Steadfast) - fixes and deliberate changes

Handlers: `supabase/functions/erp/handlers/courier.js`. Migration: `supabase/011_courier.sql`.

1. **Parcel booking is serialised.** `erpBookParcel` (ERP.js:6128) took no lock, so two
   clicks or two devices could both pass the "already has a parcel" check and book two
   parcels with Steadfast. The web app takes an advisory lock `courier` before the check;
   the second request waits, then gets "…Booking it again would send two." The same lock
   guards `erpParcelHandled` / `erpParcelPutBack` (ERP.js:6482, 6516). Why: a double
   booking sends a second rider and costs a delivery charge.

2. **Locks wait instead of failing.** The original's `LockService.getScriptLock()` with
   `tryLock(30000)` / `tryLock(20000)` (ERP.js:8713, 8656, 8911) said "Sheet is busy. Try
   again in a moment." after the timeout. The web app uses Postgres advisory locks
   `courier` + `payments` (the same `payments` topic money.js uses, so Steadfast payments
   and till payments do not interleave). They wait; the sentence is no longer produced.

3. **All or nothing.** In the sheet, a payout sync that failed half way (e.g. Steadfast
   failing on the third payout's detail) left the first two payouts' rows written. The
   web app runs each call in one transaction, so a failed `erpSfPayouts` writes nothing and
   the next open starts again cleanly. The nightly run (`sfNightly`) runs the work in a
   savepoint, so a failure rolls back only that work and the error note is still stored.

4. **Steadfast unreachable.** UrlFetchApp threw its own exception text when the host could
   not be reached. `lib/ext.js httpFetch` returns code 0 instead; `sfCall` turns that into
   "Could not reach Steadfast: <reason>". Every other sentence is the original's.

5. **Nightly is per business.** `erpSfNightly_` (ERP.js:11037) looped over every business
   sheet and stored `ERP_SF_NIGHT::<sheetId>`. `sfNightly(ctx)` does the current business
   and stores the same JSON note in `business_config` key `sf_night`; the scheduler calls it
   once per business. As in the original, a business without keys is skipped and gets no
   note.

6. **Storage of what was script properties.** Balance cache `ERP_SF_BAL::<sheetId>` ->
   `business_config` `sf_balance_cache` (`{at, v}` JSON, 30 minutes, unchanged rule).
   Keys `ERP_SF_KEY::<sheetId>` / `ERP_SF_SECRET::<sheetId>` -> `business_secrets`
   `ERP_SF_KEY` / `ERP_SF_SECRET`, read only through the privileged connection.

7. **Timestamps from Steadfast.** A parcel's `created_at` without a time zone
   ("2026-10-01 10:00:00") was read by Apps Script's `new Date()` in the script time zone
   (Asia/Dhaka). The Edge Function runs in UTC, so such text is read as Dhaka time
   explicitly; a bare date stays UTC midnight, as V8 reads it. Not a behaviour change - it
   keeps the phone-match "invoice no later than parcel + 1 day" rule (ERP.js:8551) the same.

8. **Blank cells.** `erpSfPick_` returned `''` for a parcel without a delivery / COD fee
   field; the table stores NULL and `erpSfPayoutLines` still returns `null` for it, as the
   page expects.

9. **A Steadfast error entry that is null** (`errors: {field: null}`) made the original
   throw a TypeError while building the message; it now reads "field: ".

Row order: `011_courier.sql` adds a write-order `seq` to `courier_log`, `courier_payouts`,
`courier_payout_lines`, `courier_recon` (as 008 did for the other tabs), because the sheet
rules depend on row order (payouts newest first, the first phone line of an invoice wins,
the 60 newest "did not match" rows). courier.js reads `courier_log` ordered by `seq`.
