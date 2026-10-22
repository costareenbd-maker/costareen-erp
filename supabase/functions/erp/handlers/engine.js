// engine-1 (owner 22 Oct 2026): "The ERP is a screen where I see the output and give inputs; it should not work as the
// engine. The engine must be stronger." (docs/ENGINE-PLAN.md) - the ERP keeps the job queue; the Engine (a runner on
// the office VPS, deploy/vps/erp-engine) takes a job, does the work with the owner's Claude plan, the web, the
// installed skills and the ERP's own functions, and writes the answer back. A write the Engine wants to make (an
// invoice, an expense, a follow-up, a payment) comes back as a proposal; nothing is written until the owner says Yes.
//
// Owner (Command Center screen):
//   erpEngine({status})                 the agents, the latest jobs, whether the Engine is alive
//   erpEngineJob({id})                  one job in full (answer, what it did, skills used, proposals)
//   erpEngineAsk({ask, agent})          a new job
//   erpEngineCancel({id}) / erpEngineRetry({id})
//   erpEngineRate({id, rating})         thumbs up (1) / down (-1): also rates the skills the job used
//   erpEngineDecide({id, proposal, yes}) Yes / No to a proposal; Yes writes it through the ordinary function
// The Engine (an access link labelled "Engine ..." on the VPS; refused for anyone else):
//   erpEngineClaim({runner, info})      the next job with its agent, skills and the ERP functions it may use
//   erpEngineTool({id, tool, args})     one ERP function for a running job (reads; propose_* become proposals)
//   erpEngineStep({id, lines})          what it is doing, for the screen
//   erpEngineDone({id, ok, result, error, skills, brain, tokens, ms, retry})
// Timed jobs (watch-1): erpEngineScheduleSave({id, agent, title, ask, every, at, weekday, enabled, remove}),
//   erpEngineScheduleRun({id}); a schedule that is due becomes a job when the Engine next asks for work.

import { roleAtLeast } from '../allow.js';
import { formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { platformAdmin } from './platform.js';
import { appIsOff } from './apps.js';
import { TOOLS, runTool, confirmWrite } from './assistant.js';
import { watchDue, ISSUE_TOOLS, issueTool, nextRun } from './watchdog.js';

const str = (v) => String(v == null ? '' : v).trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const STALE_MIN = 20;          // a job "running" this long without news is given back to the queue
const MAX_ATTEMPTS = 3;

// The Engine's specialists (ENGINE-PLAN.md section 3). `job` is also what a skill is matched against.
export const AGENTS = {
  command: { name: 'Command Center', live: true, job: 'Any question or order from the owner: research, analysis, planning, writing, finding suppliers or customers, explaining the numbers.',
    instructions: 'You are the owner\'s chief of staff. Take the question or order, work it out fully (use the ERP functions for the business\'s own figures, the web for the outside world, and the skills that fit), and give a clear, practical answer.' },
  inbox: { name: 'Universal Inbox', job: 'Answering customers on Messenger, Instagram, WhatsApp, e-mail, website chat and comments; taking orders; handing hard ones to people.',
    instructions: 'You look after customer conversations. Be warm, short and correct about products, prices and stock (check the ERP). Never promise what the ERP does not show.' },
  leads: { name: 'Leads', job: 'Finding, scoring and researching customer and supplier leads; writing first messages and follow-ups.',
    instructions: 'You find and win customers and suppliers. Research each lead, score it hot / warm / cold with the reason, and write a first message in the right language.' },
  ads: { name: 'Ads & Market', job: 'Market trends, competitors, what to advertise, what to clear out, what new products to bring in, writing ads and reading ad results.',
    instructions: 'You decide what to advertise and what to bring in next, from the stock, margins and sales in the ERP and the market outside. Give products, reasons, audiences, budgets and ready ad text.' },
  content: { name: 'Content & Video', job: 'Weekly content plans, post captions, reel and video scripts, picture ideas, best posting times.',
    instructions: 'You plan and write content: posts, captions, reel scripts with hook, lines, voice-over and on-screen text, in Bangla, Banglish or English as fits.' },
  seo: { name: 'SEO', job: 'Search rankings, keywords, titles, descriptions and missing pages for the website, Facebook, Instagram, YouTube, TikTok and marketplaces.',
    instructions: 'You improve how the business is found. Check pages and listings, find keywords, and give exact titles, descriptions and fixes ready to paste.' },
  watchdog: { name: 'Watchdog', job: 'Finding problems: website down or slow, broken pages or checkout, ERP errors, wrong stock or money, disconnected channels, rejected ads, courier and payment issues.',
    instructions: 'You look for anything broken or wrong in the website, the ERP and the channels. Report each issue with how bad it is, the proof, and the fix.' },
  briefing: { name: 'Owner briefing', job: 'The morning page: what changed and why, risks, and today\'s five actions.',
    instructions: 'You write the owner\'s morning page: what changed since yesterday and why, the risks, and the five most useful actions for today. Short and concrete, with figures.' },
};
const agentOf = (k) => (AGENTS[str(k)] ? str(k) : 'command');

async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner gives the Engine work.');
  if (!(await platformAdmin(ctx)) && await appIsOff(ctx.deps, ctx.sql, 'engine')) throw new Error('The Engine is not open on this ERP yet.');
  await markOn(ctx);
}
/** brain-1: the Engine works for a business once its owner opens the Engine's screens (until switched off: 'engine_on' 0). */
export async function markOn(ctx) { if (!str(await getConfig(ctx, 'engine_on', ''))) await setConfig(ctx, 'engine_on', '1'); }
/** The Engine itself: an access link whose label starts with "Engine" (deploy/vps/erp-engine). */
function engineOnly(ctx) {
  if (!(ctx.s.viaKey && /^Engine\b/i.test(str(ctx.s.name)) && roleAtLeast(ctx.s.role, 'owner'))) throw new Error('Only the Engine calls this.');
}

// brain-1 (owner 22 Oct 2026: "this ERP is not for one business - how will the AI keep them apart?"): one Engine serves
// every business its owner owns where the Engine is on. It never follows the business open on the owner's screen:
// each job carries its business, and every call about a job switches into that business alone (its rows, its name,
// its skills, its Business Brain); the database's own rules (RLS) still apply on top.
export async function engineBusinesses(ctx) {
  return ctx.tx`select b.id, b.name from memberships m join businesses b on b.id = m.business_id
                where m.user_id = ${ctx.s.userId} and m.role = 'owner' and coalesce(m.active, true) and b.suspended_at is null and not coalesce(b.is_pool, false)
                  and exists (select 1 from business_config c where c.business_id = b.id and c.key = 'engine_on' and c.value = '1')
                order by m.created_at`;
}
/** From here on this call works inside ONE business. */
export function asBusiness(ctx, b) { ctx.biz = b.id; ctx.s = { ...ctx.s, businessId: b.id, businessName: str(b.name), role: 'owner' }; ctx.memo = {}; }
async function engineJob(ctx, id, running) {
  if (!UUID.test(str(id))) throw new Error('Which job?');
  const list = await engineBusinesses(ctx);
  const j = (await ctx.tx`select * from engine_jobs where id = ${str(id)} and business_id = any(${list.map((b) => b.id).concat([ctx.biz])})`)[0];
  const b = j && list.find((x) => x.id === j.business_id);
  if (!j || !b) throw new Error('That job is not there.');
  asBusiness(ctx, b);
  if (running && j.status !== 'running') throw new Error('That job is not running any more.');
  return j;
}

const when = (t) => (t ? formatDate(new Date(t), 'd MMM, h:mm a') : '');
function shortJob(j) {
  const props = Array.isArray(j.proposals) ? j.proposals : [];
  return { id: j.id, agent: j.agent, agentName: (AGENTS[j.agent] || AGENTS.command).name, title: str(j.title) || str(j.ask).slice(0, 90), status: j.status,
    source: j.source, created: when(j.created_at), finished: when(j.finished_at), skills: j.skills || [], rating: j.rating, brain: str(j.brain),
    waiting: props.filter((p) => p.state === 'waiting').length, error: str(j.error).slice(0, 200), seconds: Math.round((j.ms || 0) / 1000) };
}

export async function erpEngine(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, st = ['queued', 'running', 'done', 'failed', 'cancelled'].includes(str(p.status)) ? str(p.status) : '';
  const rows = st ? await ctx.tx`select * from engine_jobs where business_id = ${ctx.biz} and status = ${st} order by created_at desc limit 60`
                  : await ctx.tx`select * from engine_jobs where business_id = ${ctx.biz} order by created_at desc limit 60`;
  const counts = {};
  for (const r of await ctx.tx`select status, count(*)::int n from engine_jobs where business_id = ${ctx.biz} group by status`) counts[r.status] = r.n;
  const run = (await ctx.tx`select runner, seen_at, info from engine_runners where business_id = ${ctx.biz} order by seen_at desc limit 1`)[0];
  const age = run ? (ctx.now.getTime() - new Date(run.seen_at).getTime()) / 1000 : null;
  const skills = (await ctx.tx`select count(*) filter (where enabled)::int n from engine_skills where business_id = ${ctx.biz}`)[0].n;
  return {
    agents: Object.keys(AGENTS).map((k) => ({ key: k, name: AGENTS[k].name, job: AGENTS[k].job, live: !!AGENTS[k].live })),
    jobs: rows.map(shortJob), counts, skillsOn: skills, schedules: await schedules(ctx), on: str(await getConfig(ctx, 'engine_on', '')) === '1',
    runner: run ? { alive: age < 120, seen: when(run.seen_at), secondsAgo: Math.round(age), info: run.info || {} } : { alive: false, seen: '', info: {} },
  };
}

async function jobRow(ctx, id) {
  if (!UUID.test(str(id))) throw new Error('Which job?');
  const j = (await ctx.tx`select * from engine_jobs where business_id = ${ctx.biz} and id = ${str(id)}`)[0];
  if (!j) throw new Error('That job is not there.');
  return j;
}

export async function erpEngineJob(ctx, payload) {
  await gate(ctx);
  const j = await jobRow(ctx, payload && payload.id);
  return { ...shortJob(j), ask: j.ask, result: str(j.result), steps: Array.isArray(j.steps) ? j.steps : [], proposals: Array.isArray(j.proposals) ? j.proposals : [],
    tokens: j.tokens, attempts: j.attempts, started: when(j.started_at) };
}

export async function erpEngineAsk(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, ask = str(p.ask).slice(0, 8000);
  if (ask.length < 3) throw new Error('Write what the Engine should do.');
  const waiting = (await ctx.tx`select count(*)::int n from engine_jobs where business_id = ${ctx.biz} and status = 'queued'`)[0].n;
  if (waiting >= 30) throw new Error('Thirty jobs are already waiting. Let the Engine catch up first.');
  const title = ask.split('\n')[0].slice(0, 90);
  const id = (await ctx.tx`insert into engine_jobs (business_id, agent, title, ask, source, created_by)
                           values (${ctx.biz}, ${agentOf(p.agent)}, ${title}, ${ask}, 'owner', ${str(ctx.s.name)}) returning id`)[0].id;
  const out = await erpEngine(ctx, {});
  out.created = id;
  return out;
}

/** The Engine works for this business, or not (its jobs and timed jobs wait; nothing is deleted). */
export async function erpEngineSwitch(ctx, payload) {
  await gate(ctx);
  await setConfig(ctx, 'engine_on', payload && payload.on ? '1' : '0');
  return erpEngine(ctx, {});
}

export async function erpEngineCancel(ctx, payload) {
  await gate(ctx);
  const j = await jobRow(ctx, payload && payload.id);
  if (!['queued', 'running'].includes(j.status)) throw new Error('Only a waiting or running job can be stopped.');
  await ctx.tx`update engine_jobs set status = 'cancelled', finished_at = now(), error = 'Stopped by ' || ${str(ctx.s.name)} where id = ${j.id}`;
  return erpEngine(ctx, {});
}

export async function erpEngineRetry(ctx, payload) {
  await gate(ctx);
  const j = await jobRow(ctx, payload && payload.id);
  if (!['failed', 'cancelled'].includes(j.status)) throw new Error('Only a failed or stopped job is sent again.');
  await ctx.tx`update engine_jobs set status = 'queued', error = null, attempts = 0, started_at = null, finished_at = null where id = ${j.id}`;
  return erpEngine(ctx, {});
}

export async function erpEngineRate(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, j = await jobRow(ctx, p.id);
  const rating = Number(p.rating) > 0 ? 1 : Number(p.rating) < 0 ? -1 : null;
  if (j.status !== 'done') throw new Error('Rate a job once it is done.');
  await ctx.tx`update engine_jobs set rating = ${rating} where id = ${j.id}`;
  await ctx.tx`update engine_skill_use set rating = ${rating} where business_id = ${ctx.biz} and job_id = ${j.id}`;
  return erpEngineJob(ctx, { id: j.id });
}

export async function erpEngineDecide(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, j = await jobRow(ctx, p.id);
  const list = Array.isArray(j.proposals) ? j.proposals.map((x) => ({ ...x })) : [];
  const it = list.find((x) => x.id === str(p.proposal));
  if (!it) throw new Error('That proposal is not there.');
  if (it.state !== 'waiting') throw new Error('That was already answered.');
  if (p.yes) {
    const r = await confirmWrite(ctx, { tool: it.tool, args: it.args });
    it.state = 'done'; it.outcome = str(r && r.text).replace(/\(via chat\)/g, '').slice(0, 300); if (r && r.pdf) it.pdf = r.pdf;
  } else { it.state = 'no'; it.outcome = 'You said no.'; }
  it.by = str(ctx.s.name); it.at = ctx.now.toISOString();
  await ctx.tx`update engine_jobs set proposals = ${ctx.tx.json(list)} where id = ${j.id}`;
  return erpEngineJob(ctx, { id: j.id });
}

// ---------------------------------------------------------------------------------------------- the Engine's side

/** The ERP functions the Engine may use: the chat assistant's (reads at once, propose_* need the owner's Yes). */
export const ENGINE_TOOLS = TOOLS.filter((t) => t.name !== 'open_screen');
/** watch-1: every agent reads the Watchdog's issues; the Watchdog (and the Command Center) may record new ones. */
const toolsFor = (agent) => ENGINE_TOOLS.concat(ISSUE_TOOLS.filter((t) => t.name === 'watch_issues' || agent === 'watchdog' || agent === 'command'));

// ----------------------------------------------------------------------------------------------------- timed jobs
const EVERY = ['hourly', 'daily', 'weekly'];
async function schedules(ctx) {
  const rows = await ctx.tx`select s.*, j.status job_status from engine_schedules s left join engine_jobs j on j.id = s.last_job
                            where s.business_id = ${ctx.biz} order by s.created_at`;
  return rows.map((r) => ({ id: r.id, agent: r.agent, agentName: (AGENTS[r.agent] || AGENTS.command).name, title: r.title, ask: r.ask, every: r.every, at: r.at_time, weekday: r.weekday,
    enabled: r.enabled, next: r.enabled ? when(r.next_at) : '', lastRun: when(r.last_run), lastJob: r.last_job, lastStatus: r.job_status || '', builtIn: !!r.key }));
}
/** Due schedules become jobs (once each: not while the last one is still waiting or running). */
async function dueSchedules(ctx) {
  const due = await ctx.tx`select s.*, j.status job_status from engine_schedules s left join engine_jobs j on j.id = s.last_job
                           where s.business_id = ${ctx.biz} and s.enabled and s.next_at <= now() for update of s skip locked`;
  for (const s of due) {
    let job = s.last_job;
    if (!['queued', 'running'].includes(s.job_status)) {
      job = (await ctx.tx`insert into engine_jobs (business_id, agent, title, ask, source, created_by)
                          values (${ctx.biz}, ${agentOf(s.agent)}, ${s.title}, ${s.ask}, 'schedule', ${'Timed: ' + s.title}) returning id`)[0].id;
    }
    await ctx.tx`update engine_schedules set next_at = ${nextRun(s, ctx.now)}, last_job = ${job}, last_run = now() where id = ${s.id}`;
  }
}
export async function erpEngineScheduleSave(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = str(p.id);
  if (id && !UUID.test(id)) throw new Error('Which timed job?');
  const old = id ? (await ctx.tx`select * from engine_schedules where business_id = ${ctx.biz} and id = ${id}`)[0] : null;
  if (id && !old) throw new Error('That timed job is not there.');
  if (old && p.remove) {
    if (old.key) throw new Error('A built-in timed job is switched off, not removed.');
    await ctx.tx`delete from engine_schedules where id = ${old.id}`;
    return erpEngine(ctx, {});
  }
  const v = { agent: agentOf(p.agent !== undefined ? p.agent : old && old.agent), title: str(p.title !== undefined ? p.title : old && old.title).slice(0, 90),
    ask: str(p.ask !== undefined ? p.ask : old && old.ask).slice(0, 8000), every: EVERY.includes(str(p.every)) ? str(p.every) : (old ? old.every : 'daily'),
    at_time: /^([01]?\d|2[0-3]):[0-5]\d$/.test(str(p.at)) ? str(p.at).padStart(5, '0') : (old ? old.at_time : '09:00'),
    weekday: p.weekday !== undefined ? Math.min(6, Math.max(0, Math.round(Number(p.weekday) || 0))) : (old ? old.weekday : 0),
    enabled: p.enabled !== undefined ? !!p.enabled : (old ? old.enabled : true) };
  if (v.ask.length < 3) throw new Error('Write what the agent should do each time.');
  if (!v.title) v.title = v.ask.split('\n')[0].slice(0, 90);
  const next = nextRun(v, ctx.now);
  if (old) {
    await ctx.tx`update engine_schedules set agent = ${v.agent}, title = ${v.title}, ask = ${v.ask}, every = ${v.every}, at_time = ${v.at_time}, weekday = ${v.weekday},
                   enabled = ${v.enabled}, next_at = ${next} where id = ${old.id}`;
  } else {
    if ((await ctx.tx`select count(*)::int n from engine_schedules where business_id = ${ctx.biz}`)[0].n >= 40) throw new Error('Forty timed jobs is the limit.');
    await ctx.tx`insert into engine_schedules (business_id, agent, title, ask, every, at_time, weekday, enabled, next_at, created_by)
                 values (${ctx.biz}, ${v.agent}, ${v.title}, ${v.ask}, ${v.every}, ${v.at_time}, ${v.weekday}, ${v.enabled}, ${next}, ${str(ctx.s.name)})`;
  }
  return erpEngine(ctx, {});
}
export async function erpEngineScheduleRun(ctx, payload) {
  await gate(ctx);
  const id = str(payload && payload.id);
  const s = UUID.test(id) ? (await ctx.tx`select * from engine_schedules where business_id = ${ctx.biz} and id = ${id}`)[0] : null;
  if (!s) throw new Error('That timed job is not there.');
  const job = (await ctx.tx`insert into engine_jobs (business_id, agent, title, ask, source, created_by)
                            values (${ctx.biz}, ${agentOf(s.agent)}, ${s.title}, ${s.ask}, 'schedule', ${str(ctx.s.name)}) returning id`)[0].id;
  await ctx.tx`update engine_schedules set last_job = ${job}, last_run = now() where id = ${s.id}`;
  const out = await erpEngine(ctx, {});
  out.created = job;
  return out;
}

export async function erpEngineClaim(ctx, payload) {
  engineOnly(ctx);
  const p = payload || {}, runner = str(p.runner).slice(0, 60) || 'engine';
  const info = p.info && typeof p.info === 'object' ? JSON.parse(JSON.stringify(p.info).slice(0, 2000)) : {};
  const list = await engineBusinesses(ctx), watches = [];
  for (const b of list) {
    asBusiness(ctx, b);
    await ctx.tx`insert into engine_runners (business_id, runner, seen_at, info) values (${ctx.biz}, ${runner}, now(), ${ctx.tx.json(info)})
                 on conflict (business_id, runner) do update set seen_at = now(), info = excluded.info`;
    // a job whose runner went quiet goes back to the queue (or fails after three tries)
    await ctx.tx`update engine_jobs set status = case when attempts >= ${MAX_ATTEMPTS} then 'failed' else 'queued' end,
                   error = case when attempts >= ${MAX_ATTEMPTS} then 'The Engine stopped answering on this job three times.' else error end,
                   finished_at = case when attempts >= ${MAX_ATTEMPTS} then now() else null end
                 where business_id = ${ctx.biz} and status = 'running' and started_at < now() - make_interval(mins => ${STALE_MIN})`;
    // watch-1: timed jobs that are due join the queue; the pages to check when 5 minutes have passed
    try { await ctx.tx.savepoint(() => dueSchedules(ctx)); } catch (_) { /* the queue still works */ }
    try { const w = await ctx.tx.savepoint(() => watchDue(ctx)); if (w) watches.push({ biz: b.id, targets: w.targets }); } catch (_) { /* next round */ }
  }
  if (p.peek || !list.length) return { job: null, watches, businesses: list.length };
  const j = (await ctx.tx`select * from engine_jobs where business_id = any(${list.map((b) => b.id)}) and status = 'queued' order by created_at limit 1 for update skip locked`)[0];
  if (!j) return { job: null, watches, businesses: list.length };
  asBusiness(ctx, list.find((b) => b.id === j.business_id));
  await ctx.tx`update engine_jobs set status = 'running', attempts = attempts + 1, started_at = now(), brain = null where id = ${j.id}`;
  const agent = AGENTS[j.agent] || AGENTS.command;
  // the Command Center may use every switched-on skill; a specialist only the ones given to it
  const skills = await ctx.tx`select slug, name, description, files from engine_skills where business_id = ${ctx.biz} and enabled
                               and (${j.agent === 'command'} or ${j.agent} = any(agents)) order by name`;
  return {
    job: { id: j.id, agent: j.agent, ask: j.ask, title: j.title, attempt: j.attempts + 1 },
    agent: { key: j.agent, name: agent.name, instructions: agent.instructions },
    business: { id: ctx.biz, name: str(ctx.s.businessName), today: formatDate(ctx.now, 'yyyy-MM-dd') },
    skills: skills.map((s) => ({ slug: s.slug, name: s.name, description: s.description, files: s.files || {} })),
    tools: toolsFor(j.agent), watches,
  };
}


export async function erpEngineTool(ctx, payload) {
  engineOnly(ctx);
  const p = payload || {}, j = await engineJob(ctx, p.id, true), tool = str(p.tool);
  if (!toolsFor(j.agent).some((t) => t.name === tool)) return { error: 'No such function.' };
  if (ISSUE_TOOLS.some((t) => t.name === tool)) return issueTool(ctx, tool, p.args && typeof p.args === 'object' ? p.args : {}, j);
  const out = await runTool(ctx, tool, p.args && typeof p.args === 'object' ? p.args : {});
  if (out && out.proposal) {
    const list = Array.isArray(j.proposals) ? j.proposals : [];
    if (list.length >= 20) return { error: 'Twenty proposals is the limit for one job.' };
    const id = 'p' + (list.length + 1);
    list.push({ id, tool: out.proposal.tool, args: out.proposal.args, summary: out.proposal.summary, warnings: out.proposal.warnings || [], state: 'waiting' });
    await ctx.tx`update engine_jobs set proposals = ${ctx.tx.json(list)} where id = ${j.id}`;
    return { prepared: true, waitingForOwner: true, summary: out.proposal.summary, warnings: out.proposal.warnings || [] };
  }
  return out;
}

export async function erpEngineStep(ctx, payload) {
  engineOnly(ctx);
  const p = payload || {}, j = await engineJob(ctx, p.id, true);
  const add = (Array.isArray(p.lines) ? p.lines : [p.line]).map((l) => str(l).slice(0, 240)).filter(Boolean).slice(0, 20);
  if (!add.length) return { ok: true };
  const steps = (Array.isArray(j.steps) ? j.steps : []).concat(add.map((t) => ({ t, at: ctx.now.toISOString() }))).slice(-80);
  await ctx.tx`update engine_jobs set steps = ${ctx.tx.json(steps)}, brain = coalesce(${str(p.brain) || null}, brain) where id = ${j.id}`;
  return { ok: true, cancelled: false };
}

export async function erpEngineDone(ctx, payload) {
  engineOnly(ctx);
  const p = payload || {}, j = await engineJob(ctx, p.id);
  if (j.status !== 'running') return { ok: true, ignored: true };   // stopped by the owner meanwhile
  const used = [...new Set((Array.isArray(p.skills) ? p.skills : []).map(str).filter(Boolean))].slice(0, 30);
  const known = used.length ? (await ctx.tx`select slug from engine_skills where business_id = ${ctx.biz} and slug = any(${used})`).map((r) => r.slug) : [];
  const tokens = Math.max(0, Math.round(Number(p.tokens) || 0)), ms = Math.max(0, Math.round(Number(p.ms) || 0));
  if (!p.ok && p.retry && j.attempts < MAX_ATTEMPTS) {
    await ctx.tx`update engine_jobs set status = 'queued', error = ${str(p.error).slice(0, 500) || null}, started_at = null where id = ${j.id}`;
    return { ok: true, requeued: true };
  }
  await ctx.tx`update engine_jobs set status = ${p.ok ? 'done' : 'failed'}, result = ${p.ok ? str(p.result).slice(0, 60000) : null},
                 error = ${p.ok ? null : str(p.error).slice(0, 500) || 'The Engine could not finish this job.'}, skills = ${known},
                 brain = ${str(p.brain).slice(0, 60) || null}, tokens = ${tokens}, ms = ${ms}, finished_at = now() where id = ${j.id}`;
  for (const slug of known) await ctx.tx`insert into engine_skill_use (business_id, skill_slug, job_id, agent, ok) values (${ctx.biz}, ${slug}, ${j.id}, ${j.agent}, ${!!p.ok})`;
  return { ok: true };
}

export const HANDLERS = { erpEngine, erpEngineJob, erpEngineAsk, erpEngineCancel, erpEngineRetry, erpEngineRate, erpEngineDecide, erpEngineScheduleSave, erpEngineScheduleRun, erpEngineSwitch,
  erpEngineClaim, erpEngineTool, erpEngineStep, erpEngineDone };
