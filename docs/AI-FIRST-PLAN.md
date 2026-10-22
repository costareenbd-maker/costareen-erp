# AI-first ERP plan (owner's rule, 22 Oct 2026)

> "I rely on GPT. My business is the priority, tokens are not. Make every menu and tab AI-friendly for the best possible
> output; the AI should use skills and go online by itself; I must be able to switch the LLM. Keep this in mind for
> everything we build." - the owner, 22 Oct 2026

## Rules for every feature from now on
1. **AI first, rules as the fallback.** Ask "what would the strongest model do here, with our data, tools and the web?"
   Hand-written formulas stay only as a fast guard rail or when no AI is set up.
2. **One door:** every AI call goes through `supabase/functions/erp/lib/ai.js` (`ai()`, `aiTools()`), never a direct
   provider call. The provider and model come from Settings > AI brain (per kind of work); "auto" = the strongest model.
3. **Same powers everywhere:** ERP data as tools, web search, photos / PDFs / voice, JSON answers.
4. **Plug-in design:** ERP -> any AI (OpenAI, Anthropic, Gemini APIs, or the owner's VPS gateway - OpenClaw / OmniRoute
   speaking the OpenAI style = the "Own server" provider); agents (OpenClaw, Claude, Hermes) -> ERP through the MCP door;
   ERP -> agents for long jobs. Always keep a paid API key as the fallback behind a subscription-login gateway.
5. **AI proposes, a person confirms** anything that moves money or stock; every AI call is logged (`ai_work`).
6. Quality knobs are turned up, not down: the strongest model, more context, worked examples, a check pass where a
   mistake is costly.

## Audit (22 Oct 2026) - where the ERP stood
- AI only through Google Gemini, cheapest model first (`flash-lite`), 22 call sites; 7 of them bypassed the cost log;
  web search in one place (Leads); no OpenAI / Anthropic code. (Inventory: the AI call-site audit in this session.)
- Selling side: AI in the Inbox agent and social content; Dashboard, Analytics, Navigator, Sales, Customers, campaign
  targeting, What to push next, landing pages, quotes, print pricing and the public pages run on fixed formulas,
  keyword matching and canned text.
- Goods / money / system side: AI in 3 places (photo reader, catalogue naming, Ask your ERP); reorder plan, costs,
  P&L, cash, alerts, system check, help are fixed formulas with no commentary. Defaults disagree (lead time 7 vs 60
  days; dead stock 90 vs 60+90 vs 90/180/365).

## Stages
| Stage | What | Status |
|---|---|---|
| **AI-1** | `lib/ai.js`: OpenAI (Responses), Anthropic (Messages), Gemini, own OpenAI-compatible server; per-task routing, strongest model first, fallback across providers, tools, web search, photos/PDFs/audio, JSON, deadlines; every old Gemini call routed through it; Settings > AI brain (keys, who does what, test, models, 30-day use) | built 22 Oct |
| AI-2 | VPS plug-in: OpenClaw / OmniRoute as the "Own server" (owner sets up the gateway); MCP door widened so agents work on the ERP with the same role rules; ERP hands long jobs (lead research, supplier hunts) to an agent and takes the result back | next |
| AI-3 | Owner briefing: a nightly / morning AI digest (what changed and why, risks, today's 5 actions); commentary on Dashboard, P&L, cash, balance sheet; System check and Navigator explain causes and fixes | |
| AI-4 | Documents: supplier PDF / photo / sheet read whole by a vision model with the catalogue as context (header, lines, matched SKU with reasons, total check) - rules become the fallback; expense receipts read; product datasheets and brand pages -> product fields (web) | |
| AI-5 | Selling: Inbox meaning-based knowledge search, chats ranked by value/urgency, AI landing-page copy and booking texts; New invoice from a pasted chat; upsell; quotation lines / terms / letters; repair diagnosis from Print Doctor; print quote replies | |
| AI-6 | Stock & buying: AI demand forecast (seasons, stock-outs, promotions) and an explained reorder plan; lead times learned from real POs; supplier scorecards and PO / chase e-mails; selling-price advice with web prices; families and names cleaned | |
| AI-7 | Marketing: What to push next by AI; campaign audience and per-customer messages; ad audience / budget proposals and copy; best posting times; creator reports | |
| AI-8 | Leads: intent classification of comments / chats (replaces the keyword regex), lead scoring, first-message drafts, a supplier-hunt research agent | |
| AI-9 | Customers: AI segments, churn and refill prediction, a customer summary on every profile | |
| AI-10 | Help and public pages: AI help that knows the screen; Print Doctor reading the customer's photo; meaning-based Find stock; Colour finder advice | |

Each stage follows CLAUDE.md section 4 (tests, dev ERP, live, CHANGES.md, tag) and the "Only me" rule for new screens.
