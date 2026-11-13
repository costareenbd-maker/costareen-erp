# Brand Cockpit: Train (লেখার ধরন) + LinkedIn lane (brand-17), shape brief

Owner, 14 Nov 2026: a section where he pastes any writing he likes; the AI learns only HOW it is written, files it under
a style profile (same family -> that profile improves, different -> new profile), one style per network (decision "খ"),
one switch turns them all off. The system also scouts the most-reacted posts itself, at most twice a month, and writes
down why each style works with the numbers. Plus: make the LinkedIn plan agreed on 13 Nov live (yellow lane).
"Blueprint the design with impeccable first, then build." Same world as the rest of the cockpit (Line Map contract,
`.impeccable/surfaces/web-app-html.md`). Operate mode. He reads it on his phone first.

## 1. Job and audience
- Owner only, phone first (390 px), PC second. Short visits: paste one piece, flip a switch, copy a comment.
- Train: "make my posts sound like the writing I like, and let me undo it in one tap."
- LinkedIn: "give me today's comments ready to paste, and stop me before LinkedIn notices."

## 2. Outcome and proof
- Train success: he sees which style each network writes in now (or "মূল নিয়ম"), and every style shows proof:
  how many pieces taught it, the reaction numbers, three reasons it works, a sample post in his own facts.
- LinkedIn success: today's counters never pass the caps; each item is one copy + one "পোস্ট করেছি" tap.

## 3. Selected direction (inside Line Map)
**Train = a switchboard of the lines.** The page head is the switchboard: one row per network, its line colour strip,
and the style it rides now (a pill) or "মূল নিয়ম". Top right: the master switch "সব ধরন বন্ধ". Tapping a row scrolls to
the styles. Under it: the paste box (one big field; "কোথা থেকে / কত reaction" folded under "আরও তথ্য"). Then the
style cards, then "AI খুঁজে এনেছে" (scout suggestions), then the scout + creators panel.
- Style card: Bangla name large, English name small, one-line feel. Examples as a row of station rings (one per piece;
  filled = from a viral post with numbers). "কেন কাজ করে" three points. Sample post in a quiet quote block.
  Network chips coloured as their line: filled = this style writes that network. Rules folded ("নিয়মগুলো").
  Weak styles carry an amber ring "পুরোনো হয়ে যাচ্ছে". Retire = "সরিয়ে রাখুন" (never delete).
- Suggested card (from scout): same card with source line (platform, who, views/reactions, ×follower ratio) and two
  buttons "রাখুন" / "বাদ দিন".
- Scout panel: "এ মাসে ১/২ বার খোঁজা হয়েছে", sources with state (YouTube চালু · Facebook/LinkedIn Apify-র অপেক্ষায়),
  button "এখন খুঁজুন" (disabled at 2/2), creators list (link + on/off) and an add row.

**LinkedIn = a counter board with a queue.** Head: the kill switch (red outline; when on, the whole page is a red
banner "১৪ দিন বন্ধ, চালু হবে ২৮ নভেম্বর") and the warm-up note. Then four counters in one row: comment, reply,
connect, message, each "today / cap" as a short meter (amber near cap, red at cap). Health line: acceptance %, pending
invites, invites older than 21 days ("তুলে নিন"). Then the add form: four pill kinds, name, link, their text, "AI দিয়ে
লিখুন". Then the queue: one ticket per item (kind badge, who, their text folded, the draft editable, "কপি করে খুলুন"
primary, "পোস্ট করেছি", "আবার লিখুন", "বাদ দিন"); after a post, "পরেরটা ৯:১২-এর পর" (the suggested gap). Connect
tickets after sending move to "পাঠানো" with "গ্রহণ করেছে". With Apify: "আমার পোস্টের comment আনুন".

## 4. Scope and boundaries
- Production screens in the cockpit (#bc_root), two new rail entries: লেখার ধরন, LinkedIn (under "আরও" on phone).
- Untouched: other cockpit pages, the old desk, the live ERP. Owner-only.
- Anti-goals: no auto posting or auto commenting on LinkedIn; no sample text from other people shown as his; no
  "AI score" numbers that the data does not hold.

## 5. States and ranges
- Train: 0 styles (empty: one line + the paste box), 1-15 styles, examples 1-50 per style; reading (spinner on the
  box "ধরন পড়ছে…"), failed (plain reason), all off (switchboard rows greyed, master switch on).
- LinkedIn: 0-30 queue items; drafting, todo, failed; at cap (buttons grey "আজকের সীমা শেষ"); paused; warm-up.

## 6. Constraints and open decisions
- Bangla UI, আপনি, Bangla digits in prose, Latin in names and links; people's own text `data-noi18n`.
- Facebook/LinkedIn reading waits for his Apify token (`APIFY_TOKEN`); the page says so in one line, no nagging.
- Rules learned are stored in English (for the writer); the card shows the Bangla summary and reasons.
