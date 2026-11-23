# Plan slot lights (lights-1) — design brief

Owner, 24 Nov 2026: "the time boxes on the Plan grid should show their status at a glance — green = fine, yellow =
warning, red = not fine. Hover (PC) or tap (phone) opens a small pop-up right at the box, like a folder tooltip, saying
why. From there I should go straight to that slot's plan: if it needs my video, suggest topics from my ideas, drafts,
voice-journal notes and comments."

Mode: **Operate** (a task surface he scans every day). Precision over expression; the desk's Line Map world stays.

## Status → light (one rule, used by the chip, the row below and the pop-up)

| Slot state (plan.week) | Light | Title in pop-up | Why |
|---|---|---|---|
| gone | green, filled, check | গেছে | posted |
| ready (fit ok) | green, filled | যাবে | written, approved, goes by itself |
| write, video by AI | green, outline (on track) | রাতে AI লিখবে / AI ভিডিও বানাবে | nothing needed from him |
| review | yellow; **red** when < 3 h or past | আপনার অনুমোদন বাকি | text waits for his OK |
| fit below plan (not gone) | yellow | প্ল্যানের সাথে মেলে না | n/m research rules met |
| video by him (face / own) | yellow; **red** when < 48 h or past | আপনার ভিডিও আসেনি | AI does not make this one |
| missed | red | ফাঁকা গেছে | what was missing (video / text) |
| hand, later | grey | আপনি নিজে দেবেন / পরের ধাপে খুলবে | reminder only |

Red is reserved for "act now"; the time rule keeps the grid from turning red with slots weeks away.
Colour is never alone: the title, aria-label and legend say the state; posted keeps its check mark.

## Pop-up (anchored, not a centre dialog)
- PC: opens on hover after 200 ms, stays while the pointer is on the chip or the pop-up; click pins it. Phone: tap.
  Esc, outside tap or the × closes it. Placed under the chip (above when no room), arrow pointing at the chip,
  max 340 px wide; on a phone it spans the screen minus 16 px gutters, still directly under the chip.
- Content: light + title · one meta line (network, day time, format, series) · the why in one or two sentences ·
  the planned topic / hook when there is one · one primary action, one quiet secondary.
- Primary action by state: video by him → **বিষয় বাছুন** (topic step) · review → **পোস্ট দেখে অনুমোদন দিন** ·
  fit → **প্ল্যান মিল দেখুন** · missed → **বিষয় বাছুন** · green with a draft → **পোস্ট দেখুন**.
  Secondary: **পুরো প্ল্যান** (the existing slot / fit sheet).

## Topic step (inside the same pop-up, a back arrow returns)
Ranked suggestions for this slot, max 6, in the slot's language first:
1. his voice-journal ideas not yet done (আপনার ভয়েস নোট)
2. what the 60-day plan put in this slot (প্ল্যানে যা আছে)
3. what commenters ask most (কমেন্টে যা জানতে চায়, with the count)
4. idea bank (আইডিয়া ব্যাংক) and journal notes (জার্নাল)
Each row: title, source tag, one button **লেখান** (AI writes the post + script for THIS network) — comment rows open
Listening instead. Nothing is published; drafts land in Posts for his review as today.

## Look
Desk tokens (ink, shelf, rule, 12 px radius, Hind Siliguri). Lights: green #1F8A4C, amber #E0A100, red #D93A26 on
soft tints; dark theme tints re-mixed on #1B1D22. Chip size and grid untouched (no layout shift). Legend under the grid
becomes the light legend. Motion: 120 ms fade/raise, none under reduced motion.

## Checks before release
PC 1440 + phone 390, light + dark, Bangla + English desk; hover, click, keyboard (focus opens, Esc closes); no
overflow; pop-up never off-screen; no console errors; 30-day zoom (count cells) keeps its own look.

## Review round 1 (impeccable finish review, 24 Nov) - applied
- Red only for what can still be done: a slot whose time passed TODAY is red "ফাঁকা যাচ্ছে"; an earlier day's empty slot
  is a muted "x" (red outline, no fill, ink-3 text) with no topic action.
- Yellow has its own triangle (chip, legend, pop-up); the legend shows the marks the grid really uses (check, dot, ring,
  triangle, diamond, hollow diamond, dashed ring).
- The arrow is back: the pop-up's inner part scrolls, the outer box holds the arrow; the footer (note + পুরো প্ল্যান) is sticky.
- Topic step: at most 2 commenter questions, ranked by words shared with the slot (series, idea, pillar); every row has
  "লেখান" (comment rows send the question as text), "কমেন্ট দেখুন" is a small link. Brief changed accordingly.
- Deadline as a tag beside the title; "আপনার ভিডিও বাকি (মুখ দেখিয়ে)"; no hard-coded night time.
- Phone: 44 px buttons, chip hit area +6 px top/bottom without layout shift, the bottom tab bar is kept clear.
