# Brand Cockpit: plan matches reality + a real results dashboard (brand-25), shape brief

Owner, 14 Nov 2026: (A) "Routine says medium, but Home and Posts show fewer Reels and Stories than planned." (B) "How do I
see how many views and how much reach each post got? A dashboard would be better." Same Line Map world
(`.impeccable/surfaces/web-app-html.md`), Operate mode, phone first (390), PC second. No mock round: the owner has
given design authority; assumptions are marked.

## 1. Job and audience
Owner only, phone in hand. (A) Open Home and see the day exactly as the routine planned it: what is written, what needs
his video, what he does by hand (Story, LinkedIn comments). (B) Open Results and learn in one glance whether anyone saw
the posts, which post did best, and which numbers simply cannot be measured.

## 2. Outcome and proof
- Home's week = routine slots of the plan in use, every one of them: filled (the draft or post), empty ("ফাঁকা ঘর"),
  empty video ("ভিডিও লাগবে"), and hand-made reminders ("Story · নিজে দিন", "কমেন্ট · নিজে দিন") as quiet small rows.
- One count line above the board for the chosen day: ঘর / লেখা তৈরি / ভিডিও লাগবে / Story নিজে. Plan vs ready, no score.
- Waiting drafts sit in slots (bridge places them, oldest first); "ফাঁকা ঘর ভরান" on Routine writes drafts for empty
  text/photo slots of the coming 7 days (max 8 per press, never automatic) and reports what still needs video.
- Results shows only measured numbers; missing = "—"; a network the API cannot read says "মাপা যায় না" with one line why.
  Today almost everything is empty (1 published post in 30 days): the empty state is the main state and must read as
  honest, not broken.

## 3. Selected direction
- **Home.** Keep the board. Reminder rows are not cards: a 1-line row with the network logo, time, "Story · নিজে দিন",
  ink-3, no fill (they are signposts, not stations). Video-empty slots are the dashed empty card with "ভিডিও লাগবে" in
  amber ink. The count line is a plain sentence row above the board (like `.bc-lede`, smaller), for the chosen day.
- **Routine.** One dark button "ফাঁকা ঘর ভরান" in the head; while running a busy line with progress ("লেখা হচ্ছে ৩/৮");
  done -> one line "৫টা ড্রাফট লেখা হলো · ভিডিও লাগবে ২টা ঘরে".
- **Results = the departures board turned into a ledger.** Period pills ৭ / ৩০ / ৯০ দিন. One row of network tiles
  (not same-size KPI cards: each tile is a network line label with its colour rule on top, followers, views, engagement
  and a change arrow; unmeasurable networks are a narrower muted tile with the reason). Then "পোস্ট ধরে": a list, each
  row carries the network line colour dot, date, first line, then the numbers in tabular columns (দেখা · রিচ · লাইক ·
  কমেন্ট · শেয়ার), "—" where not measured, and "খুলুন" link. Then "সেরা পোস্ট" (top 3 by views, only if numbers exist)
  and "বিষয় ধরে" thin bars (proof/teach/person/news) only where known. The old network-lines strip and "প্রশ্ন / লিড"
  links stay. Footer: what is not measured and why, as a short list.

## 4. Scope and boundaries
Home board + count line, Routine fill button + job line, Results rebuilt. Untouched: Posts page, drafts, live ERP,
Postiz posting. Anti-goals: no invented numbers, no zero for missing, no automatic AI writing, no charts with one point.

## 5. States and ranges
Networks 0-8; posts in period 0-200 (list paged at 20, "আরও"); numbers null/0/large (en-IN grouping, Bangla digits);
collector never ran yet ("প্রথম হিসাব ৬ ঘণ্টার মধ্যে" + time of last collection); Postiz down -> errCall; fill job:
idle / writing n/of / done / failed.

## 6. Constraints
Bangla UI, আপনি, প্রোডাক্ট; counts Bangla digits; people's own words (post text) `data-noi18n`; owner-only reads go in
ERP_READS + SRV_READS; tabular numerals; touch targets >= 44px on phone; no horizontal scroll at 375.
