# Brand Cockpit, every page (brand-13), shape brief + roadmap

Owner, 13 Nov 2026: home looks right, but Posts is still the old messy page and the other pages look generic and ugly.
"Forget the current formation; roadmap every page with impeccable and build start to end." Same world as home
(Line Map contract in `.impeccable/surfaces/web-app-html.md`). Operate mode: he works from the PC, phone second.

Assumptions (no question round; the owner said decide and build):
- Every page is drawn natively by the cockpit. The older brand-1..11 markup is never shown again (it stays in the file,
  hidden, because removing it breaks nothing but costs a risky diff; the calls it makes are reused).
- One vocabulary everywhere: line colour = network, station ring = state, black bar = what waits for him, pill tabs,
  Bangla words with Bangla digits, Latin only for names, links and the posts' own text.
- Nothing new is promised on screen that the tools cannot do. Where data is missing (clicks, visits, people), the page
  says so in one line and shows what does exist.

## Data per page (bridge, through the ERP)
| Page | Reads | Writes |
|---|---|---|
| Home | erpBrandDeskCockpit, erpBrandDeskDrafts | DraftDecide, Decide, Post (resend) |
| Posts | Cockpit (posts −7..+7, pacer items), Drafts (waiting, networks, ideas, jobs) | DraftDecide (approve/reject/manual), MakeCards/Cards, Post, Lint, Decide |
| Ideas | Drafts (core idea bank + topics + jobs), Ideas (Memos inbox), Board (Kanboard) | MakeDrafts, Idea, IdeaToBoard, Card, Move, Done |
| Media | Videos (Immich, search by meaning), Shorts | MakeShorts, Card |
| Listen | Listen (comments 80, counts by intent, clusters, channels, jobs) | ListenPull, ListenPaste, ListenIdeas, ListenChannel, ListenToLead |
| People | People (Twenty parked → empty), Listen (lead comments) | AddLead (new, straight to a business's Leads), ListenToLead, ToLeads |
| Results | Cockpit | — |
| Rules | Settings (topics, weights, cadence, public name, connectors) | Weights, Cadence, Setup (bridge key) |
| Connections | Cockpit health | — |

## Page by page

**Posts — "the departures board of the lines."** Job: clear what waits, see what goes when, write one post.
- Pill tabs: অপেক্ষায় (drafts) · সামনে (queued) · গেছে · আটকে, with counts. Default = অপেক্ষায় when any wait, else সামনে.
- অপেক্ষায়: drafts grouped by idea (one block per idea: its title + topic), inside it one ticket per network: line
  colour strip, network + language, the text editable in place, account auto-picked (chips when more than one),
  time (empty = next free slot), claim-check flags, buttons অনুমোদন দিন (primary, black) · বাদ দিন · more (ছবি বানান,
  লেখা কপি, নিজে পোস্ট করেছি + link). "এই আইডিয়ার সব অনুমোদন দিন" approves every ticket that has an account.
- সামনে / গেছে / আটকে: a departures list grouped by day (time · line badge · first line of text · state); stuck rows
  carry আবার পাঠান / এখন পাঠান / বাদ দিন inline.
- Right column on PC: "নতুন পোস্ট" composer: network chips coloured as their line, text with a per-network length
  meter (X 280, Bluesky 300, Threads 500, LinkedIn 3000, others 2200), claim check inline, time, urgent switch, Send to line.
- Empty: "সব পরিষ্কার" + the shortest way to new drafts (Ideas).

**Ideas — "from a thought to a post, one line."** Job: catch a thought, turn the good ones into drafts.
- Top: a big capture field (Enter saves to the inbox) and the platform chips used by "AI দিয়ে draft লিখুন".
- A line of four stations as the page's spine with counts: ধরা হয়েছে (Memos inbox) → ব্যাংকে (idea bank) → বোর্ডে
  (Kanboard, by step) → draft হয়েছে (waiting drafts). Clicking a station scrolls to its part.
- Idea bank grouped by topic; each topic gets its own neutral swatch from the rules' topic list (not a network colour);
  each idea: title, audience, "draft লিখুন". Journal-tag-only titles ("#journal …") are shown as from the journal, muted.
- Board as a horizontal line of the 7 steps (Idea → Repurposed) with stations on top and cards under, → next step.
- Writing state: "AI লিখছে…" bar with spinner; on done, a link to Posts › অপেক্ষায়.

**Media — "the footage shelf."** Job: find a clip, make shorts, turn a clip into an idea.
- Search by meaning as the page head (big field), chips of example searches.
- Grid of clips (16:9 thumbs, duration badge, date), on each: Shorts বানান / আইডিয়া বানান; shorts job state on the thumb.
- Empty (today: 0): a three-step "how clips get here" (phone Immich Brand album, PC folder G:\Brand-upload, then they show
  here), and Immich key status from health.

**Listen — "what the market asks."** Job: see the questions, hand the buyers to Leads, make ideas.
- Head actions: YouTube এখন পড়ুন · comment পেস্ট করুন (inline panel) · প্রশ্ন থেকে আইডিয়া.
- A 100% stacked bar of all comments by intent (question, praise, problem, price, complaint, authenticity, other),
  each segment a filter; numbers beside.
- "সবচেয়ে বেশি যা জিজ্ঞেস করে": clusters as ranked horizontal bars (mention count).
- The feed: author, channel, intent tag, AI summary in bold, the comment (2 lines, expands), likes; lead rows get
  "Leads-এ পাঠান" with the business picker; handed rows say "Leads-এ আছে".
- Channels: a compact list with subscriber count and listen on/off.

**People — "who came to you."** Job: put a person into a business's Leads.
- Two blocks: the potential buyers found by Listen (lead comments, not yet handed) with one-tap hand-over, and a form
  "কেউ যোগাযোগ করেছে" (name, phone, e-mail, customer/supplier, what they want, where from, which business) that adds
  straight to Leads (new erpBrandDeskAddLead). People in Twenty show only if Twenty is switched on again.

**Results — "what went, what came back."** Job: see output per line and per day.
- Per-day column chart for the 14-day window: stacked by state, today marked; per-network rows as horizontal bars
  (gone / queued / stuck) in the line colour; listen numbers; the honest gap line (clicks, visits).

**Rules — "the timetable."** Job: set how much of each topic each line carries, and how often.
- Public name + one line (EN/BN) at the head.
- How often: start / scale switch; per line its weekly range as a small bar.
- Topic mix: one row per platform, a 100% stacked bar (topic colours) above steppers (−5 / +5) per topic; sum shows,
  Save only when it is 100.
- Connectors with state pills; the bridge key form at the foot (set / not set).

## Order of build
1 shared parts (tabs, tickets, line badge, bars, empty, skeleton) → 2 Posts + native drafts on Home → 3 Ideas → 4 Media
→ 5 Listen → 6 People (+ server) → 7 Results → 8 Rules → 9 check PC 1440/1600 + phone 390 → 10 finish review → fixes →
11 DESIGN.md (documenter) → deploy dev → record.
