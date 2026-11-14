# Brand Cockpit: "আপনার মন্তব্য" - the owner critiques, the system learns (brand-27), shape brief

Owner, 14 Nov 2026: on every piece of writing (every post draft, every idea) keep a box where he writes his own
critique after reading it; the system studies these critiques from time to time and corrects itself, so it slowly
writes like him. Personal work; it must behave like him. Same Line Map world (`.impeccable/surfaces/web-app-html.md`),
Operate mode, phone first (390), PC second. No mock round: the owner gave design authority; assumptions are marked.

## 1. Job and audience
Owner only, mostly on the phone, right after reading a draft. He is reacting, not filling a form: a sentence or two in
his own words ("এত বড় শুরু না, প্রথম লাইনেই দোকানের কথা"). Later, on a calm moment, he checks what the system has
learned and switches off a lesson that is wrong.

## 2. Outcome and proof
- A critique costs one tap to open, typing, one tap to save. On a draft a second button rewrites it now in his
  direction ("মন্তব্য দিয়ে আবার লিখুন"); the new version replaces the old one in the waiting list, like answering the
  AI's questions does today.
- Earlier critiques of the same item show above the box (date + his words), so he never repeats himself.
- Proof it learns: on the লেখার ধরন page, "আপনার মন্তব্য থেকে শেখা" lists each lesson as one plain Bangla line, how many
  of his critiques it came from, and an on/off switch. Every writer (posts, news, LinkedIn, Reels, style samples) obeys
  the switched-on lessons over the general playbook, never over facts or the silent rules.
- Study runs by itself (5 new critiques, or once a day when anything is new) and from "এখন শিখুন".

## 3. Selected direction
- **The box is a quiet margin note, not a form.** A ghost button "মন্তব্য" (with a small count when earlier critiques
  exist) sits at the end of each item's action row. Open: a thin rule, the earlier critiques as a short list in his
  words (`data-noi18n`), a 3-line textarea, then "সেভ করুন" (dark) and, on drafts only, "মন্তব্য দিয়ে আবার লিখুন".
  No colour of its own (ink + shelf), so it never competes with Approve.
- **Where:** every draft card on Posts; every idea card in the idea bank; the two universal cards ("ছবি থেকে পোস্ট",
  "আইডিয়া থেকে পোস্ট") carry a general note about how posts from a photo / an idea come out; each news card (about its
  posts); the Reels script; every LinkedIn ticket; each style's sample.
- **Lessons live on লেখার ধরন**, not a new rail entry: the page is already "how the system writes", the rail has 12
  entries, and lessons are writing rules like the styles. It is the first block under the network board, because it
  is his own voice and outranks borrowed styles. Rows, not cards: lesson line, "৩টা মন্তব্য থেকে", switch. Switched-off
  lessons fold away. Under it, "সাম্প্রতিক মন্তব্য": the last 10 critiques with what they were about and whether they
  are learned yet.

## 4. Scope and boundaries
Bridge (2 tables, routes, study job + loop, lessons in every writer prompt, prompt_version bump), 4 ERP handlers,
the page boxes + lessons block, stand-alone desk rebuild. Untouched: live ERP, posting, approval flow. Anti-goals: no
score or "AI accuracy" meter, no automatic rewrite without his tap, critiques never translated, the system never
invents a lesson he did not give evidence for, his switched-off lesson never comes back on by itself.

## 5. States and ranges
Critiques per item 0-10 (show the last 3, "আরও" not needed at this size); 0-500 overall. Lessons 0-25 active.
Empty (main state at first): one line telling him where the "মন্তব্য" button is and that 5 notes start learning.
Saving: spinner in the button; rewrite: the existing "আবার লেখা হচ্ছে" job bar. Study: idle / studying (spinner line) /
failed (Bangla reason) / done (toast with how many lessons changed). Mac off: the page's existing offline state.

## 6. Constraints
Bangla UI, আপনি, প্রোডাক্ট; counts in Bangla digits; his words `data-noi18n`; no grey hint text beside labels (the
textarea has an aria-label and a placeholder only); 44 px targets on phone; no horizontal scroll at 375; owner-only
reads in ERP_READS + SRV_READS.
