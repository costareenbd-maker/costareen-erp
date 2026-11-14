# Brand desk: ব্যবসা ও ওয়েবসাইট (brand-29), shape brief

Owner, 14 Nov 2026: the Brand desk is HIS one-stop place and his first step; each business's ERP is the second step,
reached FROM here. The desk never reads from or writes to an ERP (no mixing, nothing that could make up numbers).
Same Line Map world (`.impeccable/surfaces/web-app-html.md`), Operate mode, phone first (390), PC second. No mock
round (owner gave design authority); assumptions are marked (A).

## 1. Job and audience
Owner only, often outside on the phone, a few seconds between other things. Two questions: "are my websites alive and
growing?" and "take me to that business's ERP". He is not a programmer: no status codes, no jargon, one plain line
when something needs his hand.

## 2. Outcome and proof
- Websites first (they carry live facts), businesses second (they are doors).
- One card per site: name, a live/down dot with words (চালু / বন্ধ), today's visitors as the one big number, then
  plain numbers: yesterday, 7 days, change vs the 7 days before with an up/down arrow (no sparkline), speed score
  (mobile, Google PageSpeed), SSL days left, broken links on the home page. "কাজ লাগবে: …" appears only when something
  is wrong (down, slow > 3 s, SSL < 21 days, speed < 50, broken links > 0). Links: "সাইট খুলুন", "পরিসংখ্যান"
  (stats.costareen.com, his own Umami).
- Every number comes from the site itself or the Mac's own tools (HEAD/GET timing, ssl module, PageSpeed API, Umami).
  A number that is not there yet stays "—" with a reason, never 0.
- "এখন পরীক্ষা করুন" runs every check now; the page polls until the run ends.
- Business cards: name, his note, "ERP খুলুন" (new tab, the ERP's own login). Nothing else; no figures.
- Both lists editable in one small inline form (add / edit / remove / move up-down). (A) up/down buttons, not drag,
  because drag is poor on phone.

## 3. Selected direction
- Inside the Line Map world: white ground, ink, 1px rules, the second neutral for the form. Site cards are flat rows
  on rules (not floating shadow cards); the live dot is the only colour besides red (down / needs work) and amber
  (warning). Numbers tabular, Bangla digits.
- Today's visitors is the focal number on each site; the health facts sit as one compact definition row under it so
  the eye goes: alive? -> how many today -> anything to fix.
- Businesses are a plain list of doors with an arrow-out icon, so they read as "leave here, go there".

## 4. Scope and boundaries
Bridge: tables sites, businesses, site_checks; a 30-minute loop (+ PageSpeed and link check once a day); Umami API
for visitors when a login is given in the bridge env (UMAMI_USER / UMAMI_PASS); creates the Umami websites itself
once the login exists. ERP: four thin owner-only proxies. Page: rail entry "ব্যবসা ও সাইট". Untouched: every ERP's
data, the live ERP, every live website (tracker tags committed in the repos only; deploys need his yes).
Anti-goals: no sales/stock/profit numbers from any ERP, no made-up zero, no hero-metric dashboard, no modal.

## 5. States and ranges
Sites 0-12 (seed 4), businesses 0-12 (seed 1). Per site: never checked (first run within a minute), checking (spinner
on the button, polls), up / down, PageSpeed missing (quota / not yet today), Umami missing login ("ভিজিটর গোনা শুরু
হয়নি: Umami-র লগইন Mac-এ বসানো বাকি"), Umami ok but no visits yet ("ভিজিটর গোনা শুরু হয়নি: সাইটে tracker বসানো
বাকি"). Mac off: the page's offline state. Edit errors as Bangla toasts.

## 6. Interaction and layout
Phone: one column, cards full width, 44 px targets, the form opens inline under the list it edits. PC: sites in a
two-column grid inside the main column, businesses below. No side panel on this page.

## 7. Constraints
Bangla UI with আপনি, প্রোডাক্ট never পণ্য, no grey hint text beside labels, site and business names data-noi18n,
owner-only handlers in allow.js (reads in ERP_READS + SRV_READS), security.js words for writes, tests.
