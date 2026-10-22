# How the systems work together (strategy, 22 Oct 2026)

Owner: "Combine the ChatGPT subscription and the ERP for the best output: lead generation, advertisement suggestions,
video making, posting and social media managing. Recall what the ERP still has to do first. Security later."
All AI agents are paused until the ERP is finished.

## 1. Who does what

| Part | Its job | Cost |
|---|---|---|
| **ERP** (erp.costareen.com) | The business brain and the record: products, stock, money, customers, chats, leads, posts, ads. Every job starts and ends here. A person approves anything that spends money or changes stock. | Supabase + Cloudflare (as now) |
| **ChatGPT** (your subscription, through OpenClaw on the office VPS) | The heavy thinker and writer: strategy, ad ideas, scripts, captions, lead research, replies to hard customer messages. | The monthly plan |
| **Gemini** (API key, free tier first) | The fast worker: easy customer replies, reading photos and voice notes, web search, pictures and voice for videos. Also the safety net when ChatGPT is down. | Free tier; pay only above it |
| **Claude** (optional API key) | Careful second opinion for long analysis and writing. | Pay as you use |
| **The render server** (office VPS) | Turns scripts, pictures and voice into finished reels and picture cards. | Already running |
| **OpenClaw agents** (later, after the ERP) | Long-running workers that the ERP gives jobs to (research, checking posts and ads), working on the ERP through its MCP door. | Same subscription |

The ERP picks the AI for each job (Settings > AI brain). If one fails, the next answers. Nothing stops.

## 2. The five workflows

### Lead generation
1. The ERP collects leads by itself: comments asking a price, chats that did not buy, unfinished landing-page orders,
   quote requests, the public reseller / supplier forms, market "wanted" posts.
2. Every week ChatGPT researches new customers and suppliers on the web (Google search) and adds them.
3. You add more with one tap: paste a LinkedIn / Facebook / Alibaba page, or (next) a "Save to ERP" button while you browse groups.
4. AI scores each lead (hot / warm / cold) and writes the first message in Bangla or English.
5. You or staff press Send (WhatsApp / Messenger). Follow-ups are reminded on the menu.
6. Biggest volume: posts on your own page like "comment PLA for today's price" - every comment becomes a lead and gets a
   private reply that moves the person to WhatsApp.

### Advertisement suggestions
1. Every morning the ERP looks at stock, margin, sales speed and what is rising.
2. ChatGPT picks what to advertise, what to clear out and what to hold, and says why.
3. It writes 3 ad versions (Bangla, Banglish, English) with the audience, budget and best time.
4. You approve one; the ERP creates the Meta ad paused, you press Start.
5. Every day AI reads the results and suggests: keep, change, pause or spend more.

### Video making
1. ChatGPT writes the reel: hook, lines, voice-over, captions (Bangla script).
2. Gemini makes product pictures in real scenes and the voice.
3. The render server puts it together as a reel (and picture cards).
4. You watch it in the ERP and approve or ask for changes.

### Posting
1. One weekly content calendar written by ChatGPT from what sells and what worked before.
2. Approved posts go out at the best time to Facebook and Instagram, and through the bridges to TikTok, YouTube,
   LinkedIn, X, Pinterest, Threads.
3. The ERP reads the numbers back and the AI learns what works for your audience.

### Social media managing
1. Comments and messages are answered by the Inbox AI: Gemini free first, ChatGPT for complaints and hard questions,
   your team for anything it is unsure of.
2. A daily report: what people asked, what sold, problems, ideas for tomorrow.
3. Creators and sponsors are tracked in Campaigns > Creators.

## 3. What the ERP still has to do (in order)

| # | Work | Why |
|---|---|---|
| 1 | Connect ChatGPT through OpenClaw (when the plan is active this week) | The main brain |
| 2 | Morning briefing + "what changed and why" on Dashboard, money and stock | You see the business in one minute |
| 3 | Lead engine: comment -> private reply -> WhatsApp -> lead; AI scoring and first messages; "Save to ERP" button | Most leads for least work |
| 4 | Ad engine: AI picks products, writes ad versions, watches results | Better spending on ads |
| 5 | Content engine: weekly calendar, reels made from scripts, best posting times, learning from results | Regular posting without effort |
| 6 | Supplier files read whole by AI (PDF, photo, sheet) with matching and total checks | Faster, fewer mistakes |
| 7 | AI stock forecast and reorder plan with reasons; supplier scores | Never out of best sellers |
| 8 | Customers: AI groups, who will buy again soon, a summary per customer | Repeat sales |
| 9 | Help that knows the screen; smarter public pages | Staff and customers helped |
| 10 | Turn the agents back on with jobs from the ERP | The office works for the ERP |

Waiting for you: activate the ChatGPT plan; OpenAI / Claude API keys (optional); posting-bridge keys (Zernio, Publora,
Upload-Post); the Meta pixel id and token; a Gmail app password for the Inbox e-mail; Walid's autosync setup.

## 4. Rules that stay
- The ERP is the single source of truth; agents and AIs read and write through it.
- AI suggests, a person approves money, stock and anything sent to many people.
- Every AI job is logged with its cost.
- Security review before the agents are switched back on (owner: later).
