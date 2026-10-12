# Quotations group — fixes and deliberate changes

Handlers: `supabase/functions/erp/handlers/quotes.js`. Migration: `supabase/017_quotes.sql`.

1. **Auto-number skips a reference that is already taken.**
   Original (ERP.js:9424-9437): the `seq:<PREFIX>` counter is written to the
   sheet, then the uniqueness loop may refuse the save ("The reference X is
   already used…"). The sheet write is not undone, so the next press gets the
   next number. In the web app the whole call is one transaction: the counter
   bump would roll back with the refusal and every later save would hit the
   same taken number forever. The web app therefore keeps counting until it
   finds a free `PREFIX-YEAR-NNNNN`, then stores the counter. Outcome is the
   same as the original's second press, without the refusal in between.

2. **Document storage.** `json1..json8` (45 000-char chunks) → one `doc`
   jsonb column. The limit is unchanged: more than 8 × 45 000 characters of
   JSON → "This quotation is too large to save.". jsonb does not keep key
   order (the page reads by key, so nothing changes on screen) and cannot hold
   a NUL character (`\u0000`) in a string — such a save fails with a database
   error instead of being stored.

3. **First-time business name.** Original `erpQProfile_` (ERP.js:9211) falls
   back to SETTINGS `business_name`. The web app reads config `business_name`
   and, if that is empty, the business's own name (`businesses.name`) — every
   sheet had `business_name` written at creation, a web business may not have
   the config key.

4. **Image ids.** Drive file ids → storage ids `assets/<kind>_<ms>.<ext>`
   (ext png / jpg / webp from the mime). The allow-list (`assets`, last 200)
   and the "belongs to this business" check are unchanged. The mime of a
   stored image is taken from its extension when it is read back.

5. **Unreadable upload / missing file.** Original: `Utilities.base64Decode`
   or `DriveApp.getFileById` threw their own (Google) message. Web app:
   "That image could not be read." (`erpQuoteAssetUpload` with bad base64,
   `erpQuoteAsset` when the allow-listed file is gone). `erpBrandLogo` still
   answers `{id:'', data:''}` as the original's catch did.

6. **Locks.** `erpQuoteSave` took the script lock (20 s, "Sheet is busy…");
   the web app takes advisory lock `quotes`. The profile / settings /
   letterhead / snippets / upload / logo-clear writes (no lock in the
   original, read-modify-write of one QUOTE_SETTINGS key) take lock
   `quote_settings`, and the items import takes `quote_items`, so two
   simultaneous uploads cannot lose each other's id from the allow-list.

7. **List dates.** `issueDate` in `erpQuoteList` is `yyyy-MM-dd` (the sheet
   turned the typed date into a Date cell, so the original sent a long
   `Date.toString()`; the page does not show it). `createdAt`/`updatedAt` stay
   ISO strings as before.
