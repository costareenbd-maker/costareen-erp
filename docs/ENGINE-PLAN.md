# The Engine and the ERP (owner's decision, 22 Oct 2026)

> "The ERP is a screen where I see the output and give inputs. It should not work as the engine. The engine must be
> stronger and well built." - the owner

## 1. The split

| | ERP (the screen) | Engine (the worker) |
|---|---|---|
| What | Shows results, takes your input, keeps the records (stock, money, customers, chats, leads, posts) | Thinks and works: reads, researches, writes, decides what to suggest, watches everything |
| Where | erp.costareen.com (as now) | The office VPS, running all day |
| Brains | none of its own | Claude (your plan), ChatGPT (your plan, this week), Gemini (free + API) |
| Hands | none | The ERP's functions (through the MCP door), web search and a real browser, Meta / WhatsApp, your website, Google Search Console |
| Talks to you | Command Center screen, approvals, reports | Writes every result, question and proposal into the ERP |

Rules: the Engine reads and writes only through the ERP (one source of truth). Anything that spends money, changes
stock or messages many people waits for your Yes in the ERP. Every job and its cost is logged.

## 2. How the Engine is built
- **Job queue in the ERP** (a table): every task - from you, from a schedule, or from an event (a new comment, a low
  stock, a website error) - is a job with a status. The ERP screen shows them.
- **Runner on the VPS**: picks up jobs, gives each to the right specialist agent, retries, respects plan limits,
  falls back to another brain when one is busy.
- **Specialist agents** (each has its own instructions, tools and schedule) - see section 3.
- **Memory**: the ERP data plus a knowledge store (what worked, past ads, customer history, brand rules) so the agents
  get better over time.
- **Brains per job**: the strongest for thinking and writing, the free one for quick routine work - switchable.

## 3. The Engine's agents (your list)

| Agent | Works on | Runs | You see in the ERP |
|---|---|---|---|
| **Command Center (ask anything)** | Any question or order from you: "find PETG suppliers", "why did sales drop", "make a reel for Silk PLA" | When you ask | One box to ask; answers, files, proposals to approve |
| **Universal Inbox** | Messenger, Instagram, WhatsApp, e-mail, website chat, comments: answers, takes orders, hands hard ones to people | Every minute | Inbox (already built) - now powered by the Engine |
| **Leads** | Comments, chats, forms, the web, groups you save: scores, researches, writes first messages, follows up | Every hour + weekly research | Leads screen with ready messages to send |
| **Ads & Market** | Market trends, competitors, your stock and margins: what to advertise, what to clear, **what products to bring in next**; writes ads, watches results | Every morning | Daily ad suggestions, new-product ideas, ad results with advice |
| **Content & Video** | Weekly content plan, scripts, pictures, voice, reels, posting at the best time, learning from results | Weekly plan + daily posts | Content calendar, finished reels to approve |
| **SEO** | Your website, Facebook, Instagram, YouTube, TikTok, Daraz/marketplace pages: rankings, keywords, titles, descriptions, missing pages, competitor moves | Continuously (daily checks, weekly report) | SEO board: score per channel, fixes ready to apply |
| **Watchdog (issue finder)** | Website (down, slow, broken pages, checkout, hacked files), ERP (errors, wrong stock or money, failed timers), social channels (disconnected, ad rejected), couriers, payments | Every 5-15 minutes | Issues board + alert on your phone for urgent ones |
| **Owner briefing** | Everything above | Every morning | One page: what changed and why, risks, today's 5 actions |

## 4. Order of building
1. **Engine core**: job queue in the ERP, runner on the VPS, brains (Claude plan now, ChatGPT plan this week, Gemini),
   tools (ERP functions, web search, browser), logs. Command Center screen in the ERP.
2. **Watchdog**: website + ERP + channels issue finder (protects the business first).
3. **Owner briefing** (morning page).
4. **Leads agent**.
5. **Ads & Market agent** (incl. products to bring in next).
6. **Content & Video agent**.
7. **SEO agent**.
8. **Universal Inbox** moved onto the Engine (it works today inside the ERP; moved without a break).

The office agents (Rohiz, Polok, Salman, Faujia, Nadia, Hana) stay stopped. Their good parts (instructions, contacts,
knowledge) become these Engine agents, working through the ERP.
