# Brand Cockpit: comment threads instead of the critique box (brand-28), shape brief

Owner, 14 Nov 2026: brand-27's critique place is too complex ("আমি যা বুঝলাম", "ভুল বুঝেছে", quote selection,
separate মন্তব্য button). He wants what he already knows from the networks: tap "Comment" on the post, write (maybe with
a photo), send; the AI answers in the thread with the new caption; he taps to keep it; then approves as usual. Same Line
Map world (`.impeccable/surfaces/web-app-html.md`), Operate mode, phone first (390), PC second. No mock round (owner gave
design authority); assumptions are marked (A).

## 1. Job and audience
Owner only, mostly on the phone, right after reading a waiting draft. He reacts in a sentence ("প্রথম লাইনে দোকানের কথা
আনুন", "এই ছবিটা বেশি মানাবে" + a photo). He does not want to manage the AI; he wants the post fixed in front of him.

## 2. Outcome and proof
- One tap on the phone card's own Comment control opens the thread under that card; type, optional photo, send arrow.
- Within ~1 minute a reply appears in the thread: "আপনার মন্তব্যের পর নতুন caption:" + the new caption (+ the photo it
  will use). "এটাই রাখুন" (or the heart on the reply) replaces the caption (and photo) of the card above; the card
  updates in place. Approval stays the card's own "অনুমোদন দিন".
- A second comment in the same thread rewrites from the latest proposal. Nothing creates a new draft or rejects the old.
- Silent learning: every comment + the text it was about + the AI's rewrite + kept or not is studied into the lessons
  (kept = strong evidence, ignored = weak). Lessons stay on লেখার ধরন (on/off, Bangla).

## 3. Selected direction
- **The thread is the network's own comment section.** Facebook: grey rounded bubbles, name bold inside, "এখন" under;
  Instagram: no bubble, handle + text inline, heart on the right; LinkedIn: light grey box with name + "You"; YouTube:
  "@handle · time" over plain text; TikTok/Reels: grey name, text, heart with count on the right; others (X, Threads):
  generic. The AI reply is indented as a reply (smaller avatar, ink circle "AI") so it reads as an answer to him.
- **Composer like the app:** his avatar + a rounded field "মন্তব্য লিখুন…", a photo button (phone upload or Brand album),
  a send arrow (disabled until there is text). An attached photo shows as a small chip above the field with remove.
- **Typing state:** three animated dots in a reply bubble while the bridge writes (reduced motion: static dots + words).
- **Kept state:** reply shows a check "রাখা হয়েছে", heart filled; button gone.
- Items without a phone card (news card, LinkedIn ticket) get a small Comment action ("মন্তব্য" with the comment icon
  and count) that opens the same thread (generic look; LinkedIn look on LinkedIn tickets). News card: the rewrite targets
  that news story's Facebook draft (else its LinkedIn draft) and the reply names which network (A).
- Ideas, the two universal cards, Reels scripts and style samples: the same thread, his comments only, no AI reply
  (learning only).

## 4. Scope and boundaries
Bridge: columns on owner_critiques (media, draft_id, reply_text, reply_hook, reply_media, state, error, replied_at,
accepted, applied_at), rewrite job, apply route, study uses replies + accepted, retire /critique/fix. ERP: Critique
(new shape), CritiqueApply (new), Critiques (read); CritiqueFix removed. Page: threads replace critBox; quote selection,
"আমি যা বুঝলাম", "ভুল বুঝেছে" removed. Untouched: approval flow, posting, live ERP. Anti-goals: no "শুধু AI দেখবে"
label, no score, no automatic replacement without his tap, his words never translated.

## 5. States and ranges
Thread 0-10 comments (show all, oldest first). States per comment: sent → writing (dots) → done (proposal) / failed
(Bangla reason + "আবার লিখুক") / kept. Item gone (approved/rejected) → "এটাই রাখুন" disabled with "পোস্টটা আর
অপেক্ষায় নেই". Photo upload busy: spinner on the photo button. Mac off: page offline state.

## 6. Constraints
Bangla UI, আপনি, প্রোডাক্ট; counts Bangla digits; his and the AI's words `data-noi18n`; 44 px targets on phone (send,
photo, keep, heart, comment toggle); no sideways scroll at 375; owner-only handlers in allow.js, reads in ERP_READS +
SRV_READS; security.js words for writes.
