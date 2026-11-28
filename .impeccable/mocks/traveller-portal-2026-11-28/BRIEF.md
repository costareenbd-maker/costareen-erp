# Traveller portal - blueprint (28 Nov 2026)

Owner's words (28 Nov, summarised): a traveller who contacts us gets a link; no login, no app, no branding. He fills his
details and is in our system. Staff see him. Before his flight he is shown who receives, which terminal/counter, how to
exit, all details, photos later. He may "install" it and later request luggage from it. Unregistered use stays possible.
New phone: matching name + phone fills his data. Rules (owner, 28 Nov):
- Without a bag he sees ONLY his own details (name, phone, address, photo) and can edit them. Nothing else.
- Only while he holds our bag(s) he sees the useful screens: how/where to hand over, which way out, who receives.
- When our staff scan the bag on arrival the shipment completes and he is back to "own details only".
- Staff scanning a bag twice must never make the staff member the carrier. Staff assign; the traveller may scan once to
  confirm taking; if not, assignment from the admin side is enough. Only staff / authorised people mark "received".
- Must work with no or weak network at the arrival airport: what he saw in Korea stays on the phone, QR included.
- Without a bag: under his details a "Request luggage" option -> a form with the temporary facts (when going, when
  returning, how many bags, own goods mixed or not, anything outside bags such as phones/electronics). Permanent facts
  come from his profile and are not asked again.

## Mode, audience
Operate (a task on a phone), audience = travellers, many not tech-savvy, Bangla. Phone first (360-400 px), one hand,
possibly no network. No brand: neutral, quiet, trustworthy; no logo, no business name on the page.

## Decisions (made, owner may correct)
1. One permanent personal link per traveller (not per shipment). Same link: profile -> request -> active trip -> back.
2. A business "join" link (one, shareable) opens the sign-up form; after sign-up the phone keeps his personal key and
   WhatsApp sends him his personal link.
3. Trip screens open from the moment staff put him on a shipment (carrier set) until staff mark it received. (Owner
   asked earlier for 2-3 days' notice of who receives; bags are often handed at the airport.)
4. New phone: phone number + a 6-digit code sent on WhatsApp (Alvi's number), not name+phone alone (anyone who knows
   a name and number could open his page and our staff's numbers).
5. Offline: page + its code (QR maker included, no CDN) cached by a service worker on its own path (/c/); the last
   answer kept on the phone with "last updated" time; 10 s network timeout, retry button. Reminders 3 days and 1 day
   before the flight make him open it again (refreshes the copy; iOS may drop site data after ~7 days unused).
6. Meeting guide per airport (staff write once: terminal, where to meet, numbered steps to exit, up to 3 photos) +
   a per-shipment note. Shown only in the trip state.
7. Request form fields: direction (Korea->Dhaka / Dhaka->Korea / both), leaving date, return date (optional), airline +
   flight (optional), how many of our bags he can take (0-4), checked allowance kg per bag (optional), hand-carry
   phones/electronics count, own goods mixed (yes/no + how much space), note, accepts the rules (checkbox). Prefilled
   from his last request. No customs figures written on the page (sources disagree).
8. ERP: "অনুরোধ" list (new / talked / shipment made / not taken) with "Make shipment" that creates the trip with him as
   carrier; airport guides editor; scan rules hardened + tests.
9. Review fixes from 28 Nov finish review all applied (E.164 phones, rotation on carrier change no longer needed with
   personal links but carrier change ends access at once, offline, local QR, copy, contrast, focus, overflow, ERP form
   hints, a11y, share retry loop, add-team button in the warning).

## States (traveller page)
- S0 not signed up (join link): sign-up form.
- S1 signed up, no bag: my details (edit) + "লাগেজ নিতে চাই" + my requests (status).
- S2 request form.
- S3 holding our bags: who receives (faces, call, WhatsApp), where to go (guide), flight, bags with photos, QR,
  "ব্যাগ নিয়েছি" confirm (once). Offline banner when showing the saved copy.
- S4 after received: back to S1 with a thank-you line once.
- Errors: wrong/closed link, no network with no saved copy, code expired.
