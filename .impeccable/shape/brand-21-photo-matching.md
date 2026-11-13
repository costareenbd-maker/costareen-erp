# Brand Cockpit: which photo goes with which post (brand-21), shape brief

Owner, 14 Nov 2026: "I will drop many photos into the Brand album at once. How do you know which photo goes with which
post? If the concept is right and only the photo is wrong, I must be able to change it by hand. Used photos carry a tick
and say where and when they were used. Used ones should clear out by themselves after some days." Same Line Map world
(`.impeccable/surfaces/web-app-html.md`). Operate mode, phone first.

## 1. Job and audience
Owner only. Two moments: (a) on a draft, glance "is this the right picture?" and fix it in two taps; (b) on Media, see
what is fresh, what is used, and where each used picture went.

## 2. Outcome and proof
- Every draft that wants a picture shows the picture the AI chose and ONE plain line why ("অফিসে invoice হাতে; লেখায়
  invoice যাচাইয়ের কথা"). No score, no confidence number: the data does not hold one.
- A wrong pick costs two taps: "অন্য ছবি" (AI picks the next best) or "নিজে বাছুন" (the album picker).
- No pick is better than a wrong pick: when nothing fits, the slot stays empty and says so.
- A used picture is never silently reused: the picker and the album show a tick and the count; the detail lists
  network + date for every use.

## 3. Selected direction
- **How the AI knows.** Each new album picture is looked at once and gets a note: what is in it, where, his face yes/no,
  what it could prove, which pillar it suits. Picking = notes of unused pictures + the draft (hook, pillar, media plan,
  face wanted) -> best three -> the first is attached, with its reason. A second look compares the caption and the
  picture and warns when the words claim something the picture does not show.
- **On the draft card** (existing phone card): under the picture, one quiet line "AI বেছেছে: <reason>" and two small
  buttons "অন্য ছবি" / "নিজে বাছুন". When nothing fit: an amber line "মানানসই ছবি পাইনি" + "নিজে বাছুন". The reason line is
  his station label, not a card.
- **Picker and album.** Unused first. A used picture carries a filled station dot with a check (the map's "gone"
  station) and "×N". On Media, tapping a used picture opens its record under it: a short departures list (network line
  colour, date, first words of the post). The AI's note for the picture is shown there too.
- **Tidying, not deleting.** Thirty days after its last use a picture moves from the album "Brand" to the album "Brand
  used" in Immich. Nothing is deleted; moving it back puts it in play again. One control on Media: "ব্যবহারের পর সরিয়ে রাখা:
  বন্ধ / ৩০ / ৬০ / ৯০ দিন". (Owner asked for deletion; refused by his own standing rule: no data is deleted without a
  backup and his yes. Said to him plainly.)

## 4. Scope and boundaries
Draft cards on Posts, the picker everywhere it is used, the album wall on Media. Untouched: uploads, Shorts, the old desk,
live ERP. Anti-goals: no AI-made or edited pictures; no auto-pick for a post that plans a video; no picture forced into a
text-only post.

## 5. States and ranges
Album 0-300 items; notes pending ("AI দেখছে…") for new ones; pick: chosen / none fit / picking; used 0-N times; archive
setting off or N days; Immich down -> the page says so, drafts stay as they are.

## 6. Constraints
Bangla UI, আপনি; people's own words untranslated; the AI's note is stored in Bangla (one line) + English tags for
matching; only Brand-album assets can ever be attached (existing rule in media_attach).
