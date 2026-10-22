// brief-1 (owner 22 Oct 2026, Engine step 3b): the daily brief at 8 PM. Owner's rule: "everything based on the business,
// the actions strategic and massive for growth, done by AI automatically with approval, and the approval by a button."
//   - a built-in timed job (key daily-brief, 20:00 Dhaka) gives the Owner briefing agent the day; it studies sales,
//     stock, cash, dues, marketing, leads and the Watchdog's issues with the ERP's functions and the Business Brain,
//     and files the brief with brief_save: what changed and why, risks, opportunities, five big moves (Saturdays + the
//     week's big bet). The scoreboard is computed here by the ERP, never by the AI.
//   - every move = an action card: what, why with its figures, expected gain and cost in taka, risk, confidence, and a
//     ready payload. Approve runs it through the ERP's own functions (actions.js); Change sends the owner's words back
//     to the Engine for a new card; No is kept with the reason (the next briefs learn from it).
//   - a done move is measured after its window (sales of the product, dues collected) and becomes a lesson in the
//     business's memory, so the next suggestions learn what works for THIS business.
//
//   erpBrief({id | day})        a brief with its actions (the latest when none given) + the list of past briefs
//   erpBriefDecide({id, act: 'approve' | 'reject' | 'change', note})
//   erpBriefRunNow()            today's brief now (a job for the Engine)
//   erpBriefSettings({at, adCap})

import { roleAtLeast } from '../allow.js';
import { num, formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { salesLog, SL, asDate } from '../lib/tabs.js';
import { platformAdmin } from './platform.js';
import { appIsOff } from './apps.js';
import { addFact } from './brain.js';
import { runAction, ACTION_TYPES } from './actions.js';

const str = (v) => String(v == null ? '' : v).trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const R = (v) => Math.round(num(v));
const when = (t) => (t ? formatDate(new Date(t), 'd MMM, h:mm a') : '');
export const BRIEF_KEY = 'daily-brief';
export const BRIEF_ASK = 'Write today\'s business brief for the owner (it is evening; the day is nearly over). Only records from the business\'s records start count (see the Business Brain); never cite older figures.\n' +
  'Work like a team of specialists, then one decider: look at SALES (business_snapshot, sales_day for today and yesterday, month_profit, business_summary), ' +
  'STOCK (stock_low, shipments), CASH and DUES (money_accounts, dues, supplier_dues), MARKETING and LEADS (what sells, what is rising, followups), ' +
  'the WATCHDOG (watch_issues) and the market outside (web search: competitors, prices, demand in this business\'s market). Use brief_results to see what the moves the owner approved before brought.\n' +
  'Then call brief_save ONCE with:\n' +
  '- headline: one sentence, the most important thing today;\n' +
  '- changes: up to 4 {text} - what changed and WHY (name the products, customers, channels behind it);\n' +
  '- risks: up to 4 {text}; opportunities: up to 4 {text};\n' +
  '- results: one short paragraph on what the approved moves brought (from brief_results);\n' +
  '- actions: exactly 5 big, strategic moves for growth, ranked by expected gain - never small tips, never generic advice. Each {type, title, why, figures: [{label, value, source}], impactBdt, costBdt, risk (low|medium|high), confidence (0-1), payload, metric}. ' +
  'type is one of the action types listed in brief_save, with the payload it needs - fully written (ad text, post text, message text, quantities, prices) so that Approve can run it as is. ' +
  'Every figure must come from an ERP function or a cited source; the Business Brain\'s limits (ad spend, discounts) and never-do rules are binding.\n' +
  'On Saturdays add bigBet: one bigger move for the coming weeks (a product line, a channel, a customer group) with its first step as an action.\n' +
  'Finish with a two-line note.';

async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner sees the brief.');
  if (!(await platformAdmin(ctx)) && await appIsOff(ctx.deps, ctx.sql, 'engine')) throw new Error('The Engine is not open on this ERP yet.');
  await (await import('./engine.js')).markOn(ctx);
  await ensureSchedule(ctx);
}
async function ensureSchedule(ctx) {
  const at = /^\d{2}:\d{2}$/.test(str(await getConfig(ctx, 'brief_at', ''))) ? str(await getConfig(ctx, 'brief_at', '')) : '20:00';
  const ask = BRIEF_ASK + langLine(await ownerLang(ctx));
  const { nextRun } = await import('./watchdog.js');
  await ctx.tx`insert into engine_schedules (business_id, agent, title, ask, every, at_time, key, enabled, next_at, created_by)
               values (${ctx.biz}, 'briefing', 'Daily brief', ${ask}, 'daily', ${at}, ${BRIEF_KEY}, true, ${nextRun({ every: 'daily', at_time: at }, ctx.now)}, 'Brief')
               on conflict (business_id, key) where key is not null do update set ask = excluded.ask`;   // always the newest instructions
}
/** clean-1 (owner 22 Oct 2026: "all the daily brief should come in Bengali"): the language of what the AI writes FOR THE
 *  OWNER (the brief, the Watchdog's night report); texts for customers keep the customers' language. */
export const LANGS = { bn: 'Bangla (বাংলা)', en: 'English' };
export async function ownerLang(ctx) { const v = str(await getConfig(ctx, 'ai_lang', '')); return LANGS[v] ? v : 'bn'; }   // owner: Bangla by default
export function langLine(l) { return l === 'bn' ? '\nWrite everything for the owner in Bangla (বাংলা script, plain words; product names and figures as they are). Texts meant for customers (ads, posts, messages) stay in the language the customers use.' : ''; }
export async function adCap(ctx) { const v = num(await getConfig(ctx, 'brief_ad_cap', '')); return v > 0 ? v : 3000; }

/** The day in the ERP's own figures (the AI never makes these up). */
export async function scoreboard(ctx) {
  const H = (await import('./index.js')).HANDLERS, out = {};
  const soft = async (f) => { try { return await ctx.tx.savepoint(f); } catch (_) { return null; } };
  const today = formatDate(ctx.now, 'yyyy-MM-dd'), yest = formatDate(new Date(ctx.now.getTime() - 86400e3), 'yyyy-MM-dd');
  const d0 = await soft(() => H.erpDaySales(ctx, today)), d1 = await soft(() => H.erpDaySales(ctx, yest));
  if (d0) out.today = { revenue: R(d0.revenue), orders: num(d0.orders), units: num(d0.units), profit: d0.profit === undefined ? undefined : R(d0.profit) };
  if (d1) out.yesterday = { revenue: R(d1.revenue), orders: num(d1.orders) };
  const m = await soft(() => H.erpFdDash(ctx, { months: 1 }));
  if (m) { const k = m.kpi || {}; const v = (x) => (x ? R(x.v) : undefined), p = (x) => (x ? R(x.prev) : undefined);
    out.month = { label: m.rangeLabel, revenue: v(k.revenue), revenuePrev: p(k.revenue), orders: v(k.orders), net: v(k.net), netPrev: p(k.net), stockValue: v(k.stockValue), dues: v(k.dues) };
    out.lowStock = (m.reorder || []).length; }
  const c = await soft(() => H.erpCashBook(ctx, {}));
  if (c) out.cashInHand = R(c.inHand);
  const w = await soft(async () => (await ctx.tx`select count(*)::int n from engine_issues where business_id = ${ctx.biz} and status = 'open' and severity in ('urgent', 'high')`)[0].n);
  if (w !== null) out.urgentIssues = w;
  return out;
}

// ------------------------------------------------------------------------------------------- the Engine's tools
const cleanList = (l, n) => (Array.isArray(l) ? l : []).slice(0, n).map((x) => ({ text: str(x && (x.text || x)).slice(0, 500) })).filter((x) => x.text);
function cleanAction(a, i) {
  const type = str(a && a.type);
  const figures = (Array.isArray(a.figures) ? a.figures : []).slice(0, 8).map((f) => ({ label: str(f.label).slice(0, 80), value: str(f.value).slice(0, 80), source: str(f.source).slice(0, 120) })).filter((f) => f.label && f.value);
  return { no: i + 1, type, title: str(a.title).slice(0, 160), why: str(a.why).slice(0, 1200), figures, impact: Math.max(0, R(a.impactBdt)), cost: Math.max(0, R(a.costBdt)),
    risk: ['low', 'medium', 'high'].includes(str(a.risk)) ? str(a.risk) : 'medium', confidence: Math.min(1, Math.max(0, num(a.confidence) || 0.5)),
    payload: a.payload && typeof a.payload === 'object' ? a.payload : {}, metric: a.metric && typeof a.metric === 'object' ? a.metric : {} };
}
export const BRIEF_TOOLS = [
  { name: 'brief_results', description: 'The moves the owner approved in the last 30 days: what they were, what happened when run, and the measured result (sales of the product before vs after, dues collected) where its window has passed. Also the moves he said no to, with his reason.', parameters: { type: 'OBJECT', properties: {} } },
  { name: 'brief_save', description: 'File today\'s brief (once). actions: exactly 5, each {type, title, why, figures:[{label,value,source}], impactBdt, costBdt, risk, confidence, payload, metric}. Action types and their payloads: ' +
      Object.entries(ACTION_TYPES).map(([k, t]) => k + ' - ' + t.what + ' payload ' + t.payload).join('; ') + '. metric: {kind: "sales_sku", sku, days} or {kind: "dues", days} or {kind: "none"}. bigBet (Saturdays): {text, action} with action shaped like the others.',
    parameters: { type: 'OBJECT', properties: { headline: { type: 'STRING' }, changes: { type: 'ARRAY', items: { type: 'OBJECT' } }, risks: { type: 'ARRAY', items: { type: 'OBJECT' } }, opportunities: { type: 'ARRAY', items: { type: 'OBJECT' } },
      results: { type: 'STRING' }, actions: { type: 'ARRAY', items: { type: 'OBJECT' } }, bigBet: { type: 'OBJECT' } }, required: ['headline', 'actions'] } },
  { name: 'brief_replace_action', description: 'Only for a "change this move" job: the new version of the one action, shaped like a brief_save action.', parameters: { type: 'OBJECT', properties: { action: { type: 'OBJECT' } }, required: ['action'] } },
];

export async function briefTool(ctx, name, a, job) {
  if (name === 'brief_results') {
    await measure(ctx);
    const rows = await ctx.tx`select title, type, status, result, outcome, note, impact_bdt, decided_at from engine_actions where business_id = ${ctx.biz}
                              and decided_at > now() - interval '30 days' and status in ('done', 'failed', 'rejected') order by decided_at desc limit 40`;
    return { moves: rows.map((r) => ({ title: r.title, type: r.type, status: r.status, expectedBdt: R(r.impact_bdt), result: str(r.result), measured: r.outcome || null, ownerSaid: str(r.note) || undefined, decided: when(r.decided_at) })) };
  }
  if (name === 'brief_save') {
    if (job.source !== 'schedule' && job.source !== 'brief') return { error: 'Only the daily brief job files a brief.' };
    const day = formatDate(ctx.now, 'yyyy-MM-dd');
    if ((await ctx.tx`select 1 from engine_briefs where business_id = ${ctx.biz} and day = ${day} and job_id = ${job.id}`).length) return { error: 'This brief is already filed.' };
    const acts = (Array.isArray(a.actions) ? a.actions : []).slice(0, 5).map(cleanAction);
    const bad = acts.filter((x) => !ACTION_TYPES[x.type] || !x.title || !x.why || !x.figures.length);
    if (acts.length < 3 || bad.length) return { error: 'Each move needs a known type, a title, the why and its figures (' + (bad.map((x) => '#' + x.no + ' ' + (x.type || '?')).join(', ') || 'at least 3 moves') + '). Fix and call brief_save again.' };
    const cap = await adCap(ctx);
    for (const x of acts) { const e = ACTION_TYPES[x.type].check(x.payload, { cap }); if (e) return { error: 'Move #' + x.no + ' (' + x.type + '): ' + e + ' Fix and call brief_save again.' }; }
    const big = a.bigBet && a.bigBet.action ? cleanAction(a.bigBet.action, 5) : null;
    if (big && (!ACTION_TYPES[big.type] || ACTION_TYPES[big.type].check(big.payload, { cap }))) return { error: 'The big bet\'s first step needs a valid action.' };
    const sb = await scoreboard(ctx);
    // a second brief the same day replaces the first one's cards that were not answered yet
    await ctx.tx`update engine_actions set status = 'replaced' where business_id = ${ctx.biz} and status = 'proposed' and brief_id in (select id from engine_briefs where business_id = ${ctx.biz} and day = ${day})`;
    const id = (await ctx.tx`insert into engine_briefs (business_id, day, job_id, scoreboard, headline, changes, risks, opportunities, results_note)
                values (${ctx.biz}, ${day}, ${job.id}, ${ctx.tx.json(sb)}, ${str(a.headline).slice(0, 300)}, ${ctx.tx.json(cleanList(a.changes, 4))}, ${ctx.tx.json(cleanList(a.risks, 4))},
                        ${ctx.tx.json(cleanList(a.opportunities, 4))}, ${str(a.results).slice(0, 1500)})
                on conflict (business_id, day) do update set job_id = excluded.job_id, scoreboard = excluded.scoreboard, headline = excluded.headline, changes = excluded.changes,
                  risks = excluded.risks, opportunities = excluded.opportunities, results_note = excluded.results_note, created_at = now(), read_at = null
                returning id`)[0].id;
    for (const x of big ? acts.concat([{ ...big, big: true, why: str(a.bigBet.text).slice(0, 600) + (big.why ? '\n' + big.why : '') }]) : acts) {
      await ctx.tx`insert into engine_actions (business_id, brief_id, job_id, no, big_bet, type, title, why, figures, impact_bdt, cost_bdt, risk, confidence, payload, metric)
                   values (${ctx.biz}, ${id}, ${job.id}, ${x.no}, ${!!x.big}, ${x.type}, ${x.title}, ${x.why}, ${ctx.tx.json(x.figures)}, ${x.impact}, ${x.cost}, ${x.risk}, ${x.confidence},
                           ${ctx.tx.json(x.payload)}, ${ctx.tx.json(x.metric)})`;
    }
    return { filed: true, moves: acts.length + (big ? 1 : 0), note: 'The owner sees it in Menu > Daily brief and answers each move with a button.' };
  }
  if (name === 'brief_replace_action') {
    const old = (await ctx.tx`select * from engine_actions where business_id = ${ctx.biz} and job_id is not null and status = 'changing' and id = ${str(job.title).replace(/^.*\[(.+)\]$/, '$1')}`)[0];
    if (!old) return { error: 'There is no move waiting to be changed by this job.' };
    const x = cleanAction(a.action || {}, old.no - 1);
    if (!ACTION_TYPES[x.type] || !x.title || !x.why || !x.figures.length) return { error: 'The new move needs a known type, a title, the why and its figures.' };
    const e = ACTION_TYPES[x.type].check(x.payload, { cap: await adCap(ctx) }); if (e) return { error: e };
    await ctx.tx`update engine_actions set status = 'replaced' where id = ${old.id}`;
    await ctx.tx`insert into engine_actions (business_id, kind, issue_key, brief_id, job_id, no, big_bet, type, title, why, figures, impact_bdt, cost_bdt, risk, confidence, payload, metric)
                 values (${ctx.biz}, ${old.kind}, ${old.issue_key}, ${old.brief_id}, ${job.id}, ${old.no}, ${old.big_bet}, ${x.type}, ${x.title}, ${x.why}, ${ctx.tx.json(x.figures)}, ${x.impact}, ${x.cost}, ${x.risk}, ${x.confidence},
                         ${ctx.tx.json(x.payload)}, ${ctx.tx.json(x.metric)})`;
    return { replaced: true };
  }
  return null;
}

// --------------------------------------------------------------------------------------------- measuring results
async function skuRevenue(ctx, sku, from, to) {
  const k = str(sku).toLowerCase(); let t = 0;
  for (const r of await salesLog(ctx)) {
    if (str(r[SL.sku]).toLowerCase() !== k) continue;
    const d = asDate(r[SL.timestamp]); if (!d || d < from || d >= to) continue;
    t += num(r[SL.total]);
  }
  return R(t);
}
/** Done moves whose window has passed: before vs after, a verdict, and a lesson for this business. */
export async function measure(ctx) {
  const rows = await ctx.tx`select * from engine_actions where business_id = ${ctx.biz} and status = 'done' and outcome is null and executed_at is not null
                            and coalesce((metric->>'kind'), 'none') <> 'none' limit 20`;
  for (const a of rows) {
    const days = Math.min(60, Math.max(1, R((a.metric || {}).days) || 7)), start = new Date(a.executed_at), end = new Date(start.getTime() + days * 86400e3);
    if (end > ctx.now) continue;
    let out = null;
    if (a.metric.kind === 'sales_sku' && str(a.metric.sku)) {
      const before = await skuRevenue(ctx, a.metric.sku, new Date(start.getTime() - days * 86400e3), start), after = await skuRevenue(ctx, a.metric.sku, start, end);
      const verdict = after > before * 1.15 + 500 ? 'worked' : after < before * 0.85 - 500 ? 'hurt' : 'no_effect';
      out = { metric: 'sales of ' + str(a.metric.sku).toUpperCase(), baseline: before, observed: after, days, verdict };
    } else out = { metric: a.metric.kind, verdict: 'unclear', days };
    out.measured_at = ctx.now.toISOString();
    await ctx.tx`update engine_actions set outcome = ${ctx.tx.json(out)} where id = ${a.id}`;
    if (out.verdict !== 'unclear') {
      await addFact(ctx, { kind: 'lesson', source: 'engine', ref: 'action:' + a.id, confidence: 0.9,
        text: 'Move "' + str(a.title).slice(0, 120) + '" (' + a.type + ') ' + (out.verdict === 'worked' ? 'worked' : out.verdict === 'hurt' ? 'hurt' : 'made no difference') +
          ': ' + out.metric + ' ' + days + ' days before ৳' + out.baseline + ', after ৳' + out.observed + ' (' + formatDate(ctx.now, 'd MMM yyyy') + ').' });
    }
  }
}

// ------------------------------------------------------------------------------------------------- the screen
export function actionOut(a) {
  return { id: a.id, no: a.no, bigBet: a.big_bet, kind: a.kind, issueKey: str(a.issue_key), autoDone: !!a.auto, job: a.job_id, type: a.type, typeName: (ACTION_TYPES[a.type] || {}).name || a.type, title: a.title, why: a.why, figures: a.figures || [], impact: R(a.impact_bdt), cost: R(a.cost_bdt),
    risk: a.risk, confidence: Math.round(num(a.confidence) * 100), payload: a.payload || {}, status: a.status, decidedBy: str(a.decided_by), decided: when(a.decided_at), note: str(a.note), result: str(a.result),
    outcome: a.outcome || null, auto: !!(ACTION_TYPES[a.type] || {}).auto };
}
export async function erpBrief(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  let b = null;
  if (UUID.test(str(p.id))) b = (await ctx.tx`select * from engine_briefs where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
  else if (/^\d{4}-\d{2}-\d{2}$/.test(str(p.day))) b = (await ctx.tx`select * from engine_briefs where business_id = ${ctx.biz} and day = ${str(p.day)}`)[0];
  else b = (await ctx.tx`select * from engine_briefs where business_id = ${ctx.biz} order by day desc limit 1`)[0];
  if (b && !b.read_at) await ctx.tx`update engine_briefs set read_at = now() where id = ${b.id}`;
  const actions = b ? (await ctx.tx`select * from engine_actions where business_id = ${ctx.biz} and brief_id = ${b.id} and status <> 'replaced' order by big_bet, no, created_at desc`).map(actionOut) : [];
  const list = (await ctx.tx`select b.id, b.day, b.headline, (select count(*)::int from engine_actions a where a.brief_id = b.id and a.status = 'proposed') waiting
                             from engine_briefs b where b.business_id = ${ctx.biz} order by b.day desc limit 30`).map((x) => ({ id: x.id, day: formatDate(new Date(x.day), 'yyyy-MM-dd'), label: formatDate(new Date(x.day), 'EEE d MMM'), headline: x.headline, waiting: x.waiting }));
  const sch = (await ctx.tx`select s.id, s.at_time, s.enabled, s.next_at, j.status job_status, j.id job_id from engine_schedules s left join engine_jobs j on j.id = s.last_job where s.business_id = ${ctx.biz} and s.key = ${BRIEF_KEY}`)[0];
  const stats = (await ctx.tx`select count(*) filter (where status = 'done')::int done, count(*) filter (where status = 'rejected')::int no, count(*) filter (where outcome->>'verdict' = 'worked')::int worked,
                              coalesce(sum(case when outcome->>'verdict' = 'worked' then (outcome->>'observed')::numeric - (outcome->>'baseline')::numeric end), 0) gained
                              from engine_actions where business_id = ${ctx.biz} and created_at > now() - interval '30 days'`)[0];
  return {
    brief: b ? { id: b.id, day: formatDate(new Date(b.day), 'EEEE d MMMM yyyy'), headline: b.headline, scoreboard: b.scoreboard || {}, changes: b.changes || [], risks: b.risks || [], opportunities: b.opportunities || [], results: b.results_note, made: when(b.created_at) } : null,
    actions, briefs: list, adCap: await adCap(ctx), lang: await ownerLang(ctx),
    schedule: sch ? { id: sch.id, at: sch.at_time, enabled: sch.enabled, next: when(sch.next_at), lastStatus: sch.job_status || '', lastJob: sch.job_id } : null,
    stats: { done: stats.done, no: stats.no, worked: stats.worked, gained: R(stats.gained) },
  };
}

export async function erpBriefDecide(ctx, payload) {
  await gate(ctx);
  const a = await decideAction(ctx, payload);
  return erpBrief(ctx, a.brief_id ? { id: a.brief_id } : {});
}
/** One button on a move or a fix: approve (runs it), change (the owner's words back to the Engine), reject (remembered). */
export async function decideAction(ctx, payload) {
  const p = payload || {};
  if (!UUID.test(str(p.id))) throw new Error('Which move?');
  const a = (await ctx.tx`select * from engine_actions where business_id = ${ctx.biz} and id = ${str(p.id)} for update`)[0];
  if (!a) throw new Error('That move is not there.');
  if (a.status !== 'proposed') throw new Error('That move was already answered.');
  const act = str(p.act), note = str(p.note).slice(0, 600);
  if (act === 'reject') {
    await ctx.tx`update engine_actions set status = 'rejected', decided_by = ${str(ctx.s.name)}, decided_at = now(), note = ${note || null} where id = ${a.id}`;
    await addFact(ctx, { kind: 'event', source: 'rating', ref: 'action:' + a.id, confidence: 1, text: 'The owner said NO to the move "' + str(a.title).slice(0, 140) + '" (' + a.type + ')' + (note ? ': ' + note : '') + ' (' + formatDate(ctx.now, 'd MMM yyyy') + ').' });
  } else if (act === 'change') {
    if (note.length < 3) throw new Error('Write what to change.');
    const job = (await ctx.tx`insert into engine_jobs (business_id, agent, title, ask, source, created_by)
      values (${ctx.biz}, ${a.kind === 'watch' ? 'watchdog' : 'briefing'}, ${'Change a move [' + a.id + ']'}, ${'The owner wants this move changed: "' + note + '".\nThe move: ' + JSON.stringify({ type: a.type, title: a.title, why: a.why, figures: a.figures, impactBdt: num(a.impact_bdt), costBdt: num(a.cost_bdt), payload: a.payload, metric: a.metric }) +
        '\nMake the new version with the ERP functions you need, then call brief_replace_action once.'}, 'brief', ${str(ctx.s.name)}) returning id`)[0].id;
    await ctx.tx`update engine_actions set status = 'changing', job_id = ${job}, decided_by = ${str(ctx.s.name)}, decided_at = now(), note = ${note} where id = ${a.id}`;
  } else if (act === 'approve') {
    await ctx.tx`update engine_actions set status = 'running', decided_by = ${str(ctx.s.name)}, decided_at = now() where id = ${a.id}`;
    let r;
    try { r = await ctx.tx.savepoint(() => runAction(ctx, a, { cap: adCap })); }
    catch (e) { r = { ok: false, text: str((e && e.message) || e) }; }
    await ctx.tx`update engine_actions set status = ${r.ok ? 'done' : 'failed'}, result = ${str(r.text).slice(0, 1500)}, executed_at = ${r.ok ? ctx.now : null},
                   outcome = ${r.jobId ? ctx.tx.json({ jobId: r.jobId }) : null} where id = ${a.id}`;
    // a Watchdog fix that ran closes its issue (the checks reopen it if the problem is still there)
    if (r.ok && a.issue_key) await ctx.tx`update engine_issues set status = 'resolved', resolved_at = now() where business_id = ${ctx.biz} and key = ${a.issue_key} and status = 'open'`;
  } else throw new Error('Approve, change or no?');
  return a;
}

export async function erpBriefRunNow(ctx) {
  await gate(ctx);
  const busy = (await ctx.tx`select 1 from engine_jobs where business_id = ${ctx.biz} and agent = 'briefing' and title = 'Daily brief' and status in ('queued', 'running')`)[0];
  if (busy) throw new Error('A brief is already being written.');
  const id = (await ctx.tx`insert into engine_jobs (business_id, agent, title, ask, source, created_by) values (${ctx.biz}, 'briefing', 'Daily brief', ${BRIEF_ASK + langLine(await ownerLang(ctx))}, 'brief', ${str(ctx.s.name)}) returning id`)[0].id;
  const out = await erpBrief(ctx, {});
  out.created = id;
  return out;
}

export async function erpBriefSettings(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (p.lang !== undefined) { if (!LANGS[str(p.lang)]) throw new Error('Bangla or English?'); await setConfig(ctx, 'ai_lang', str(p.lang)); await ensureSchedule(ctx); }
  if (p.adCap !== undefined) { const v = R(p.adCap); if (!(v >= 0 && v <= 1000000)) throw new Error('Type the most one ad may spend, in taka.'); await setConfig(ctx, 'brief_ad_cap', String(v)); }
  if (p.at !== undefined) {
    if (!/^([01]?\d|2[0-3]):[0-5]\d$/.test(str(p.at))) throw new Error('Type a time like 20:00.');
    const at = str(p.at).padStart(5, '0');
    await setConfig(ctx, 'brief_at', at);
    const { nextRun } = await import('./watchdog.js');
    await ctx.tx`update engine_schedules set at_time = ${at}, next_at = ${nextRun({ every: 'daily', at_time: at }, ctx.now)}, enabled = ${p.enabled !== false} where business_id = ${ctx.biz} and key = ${BRIEF_KEY}`;
  }
  return erpBrief(ctx, {});
}

export const HANDLERS = { erpBrief, erpBriefDecide, erpBriefRunNow, erpBriefSettings };
