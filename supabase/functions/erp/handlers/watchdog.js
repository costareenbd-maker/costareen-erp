// watch-1 (owner 22 Oct 2026, Engine step 2): the Watchdog - "an agent who looks for issues all over the business
// channels, including the website and the ERP". Three layers:
//   1. every 5 minutes the Engine opens the watched pages (up? slow? the text that must be there? the certificate?)
//      and reports back (erpWatchReport); the same call runs the ERP's own checks: failing timers, actions failing for
//      people, backups, the books' system check (hourly), the WhatsApp link, Engine jobs failing;
//   2. every problem is one issue (engine_issues): opened once, counted each time it is seen again, closed by itself
//      when the check passes; urgent / high ones go to the bell and the owner's WhatsApp (handlers/alerts.js);
//   3. the Watchdog agent's daily check-up (a timed job) reads the issues, looks deeper and reports new ones.
//
//   erpWatch()                                the issues, the watched pages, the daily check-up, last check
//   erpWatchTargetSave({id, url, must, label, enabled, remove})
//   erpWatchIssueAct({id, act: 'resolve' | 'ignore' | 'reopen', days})
//   erpWatchRunNow()                          the ERP's checks now; the pages at the Engine's next round
//   erpWatchReport({results})                 the Engine only: what it saw on the pages
// Also used by handlers/engine.js: watchDue (pages to check, in the claim), issueTools (watch_issues, report_issue).

import { roleAtLeast } from '../allow.js';
import { formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { platformAdmin } from './platform.js';
import { appIsOff } from './apps.js';
import { erpSystemCheck } from './insight.js';
import { erpConnStatus } from './connections.js';
import { engineBusinesses, asBusiness, markOn } from './engine.js';

const str = (v) => String(v == null ? '' : v).trim();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const SEVERITIES = ['urgent', 'high', 'medium', 'low'];
const AREAS = ['website', 'erp', 'money', 'stock', 'channels', 'engine', 'other'];
const WEB_EVERY_MS = 5 * 60000, SYS_EVERY_MS = 60 * 60000, SLOW_MS = 8000, MAX_TARGETS = 30;
const JOB_WORDS = { 'nightly:steadfast': 'The nightly Steadfast check', 'nightly:backup': 'The nightly backup', 'campaigns:tick': 'A WhatsApp campaign',
  'websync:pull': 'Reading website orders', 'websync:push': 'Sending stock to the website', 'whatsapp:hook': 'A WhatsApp reply' };
// watch-2 (owner 22 Oct 2026): "I don't want to see problems - fix them every night and tell me next morning what you
// fixed; what needs my decision waits for my approval". The night shift fixes what is safe by itself and turns the rest
// into fixes the owner approves with one button.
export const WATCH_DAILY = { key: 'watchdog-daily', agent: 'watchdog', title: 'Watchdog: night check and fixes', every: 'daily', at_time: '03:00',
  ask: 'Night shift: make sure everything the business runs on WORKS and TALKS to each other, and fix what does not - so the owner wakes up to working systems.\n' +
    'Your job is systems, not the books: the ERP itself, the website and its sync with the ERP (orders in, stock out), the courier link, WhatsApp, e-mail, the timers, the backups, the Engine. ' +
    'Do NOT report or fix data, invoices, prices, costs, stock levels or money figures - that is not the Watchdog\'s job; and ignore anything dated before the business\'s records start (see the Business Brain).\n' +
    '1) Read the open issues (watch_issues, each with its key). Open the website\'s main pages yourself (home, a product page, cart, checkout): do they load, does the shop work. Record new real system problems with report_issue.\n' +
    '2) For EACH problem find the cause with the ERP functions and the web. Then:\n' +
    '   - if it fixed itself or is not real: close_issue with the reason;\n' +
    '   - if a safe retry fixes it (a backup, a delivery check, a website test): fix_now;\n' +
    '   - anything that changes data, money, stock, prices or settings: propose_fix type "erp" with the exact steps (ERP functions and their arguments, each with a plain summary) - the owner approves it with ONE button in the morning. Always try to make it a real one-click fix: the owner does not want work handed to him;\n' +
    '   - only if it truly needs a person outside the ERP (the hosting panel, the courier merchant panel, a phone call): propose_fix type "manual" with exact numbered steps (links, what to click, what to type); type "task" only for work YOU can do next (research, writing, a plan);\n' +
    '   - never guess: if you cannot find the cause, say so in the fix\'s why.\n' +
    '3) End with the morning note for the owner, plain and short: what you fixed, what waits for his OK, and if all is well, say so in one line.' };
// what the night shift may do with no approval: retries that change no money, stock or records
export const SAFE_AUTO = ['erpBackupRun', 'erpWebsiteTest', 'erpCheckDeliveries', 'erpConnStatus', 'erpSystemCheck'];

async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner sees the Watchdog.');
  if (!(await platformAdmin(ctx)) && await appIsOff(ctx.deps, ctx.sql, 'engine')) throw new Error('The Engine is not open on this ERP yet.');
  await markOn(ctx);
}
function engineOnly(ctx) {
  if (!(ctx.s.viaKey && /^Engine\b/i.test(str(ctx.s.name)) && roleAtLeast(ctx.s.role, 'owner'))) throw new Error('Only the Engine calls this.');
}
const when = (t) => (t ? formatDate(new Date(t), 'd MMM, h:mm a') : '');
const originOf = (u) => { try { const x = new URL(str(u)); return x.protocol + '//' + x.host + '/'; } catch (_) { return ''; } };

/** The ERP page itself and the website's home page, the first time (the owner adds more: a product, the cart, the checkout). */
async function ensureDefaults(ctx) {
  // the built-in night shift always works from the newest instructions (the owner's time and switch are kept)
  const { ownerLang, langLine } = await import('./brief.js');
  const ask = WATCH_DAILY.ask + langLine(await ownerLang(ctx));
  await ctx.tx`update engine_schedules set ask = ${ask}, title = ${WATCH_DAILY.title} where business_id = ${ctx.biz} and key = ${WATCH_DAILY.key} and ask <> ${ask}`;
  if (str(await getConfig(ctx, 'watch_init', ''))) return;
  const add = async (label, url, must) => { if (url) await ctx.tx`insert into engine_watch_targets (business_id, label, url, must) values (${ctx.biz}, ${label}, ${url}, ${must}) on conflict (business_id, url) do nothing`; };
  const app = originOf(ctx.deps && ctx.deps.google && ctx.deps.google.appUrl);
  await add('The ERP', app, '');
  const site = originOf(await getConfig(ctx, 'store_url', '')) || originOf(await getConfig(ctx, 'website_api', ''));
  if (site && site !== app) await add('Website home page', site, '');
  await ctx.tx`insert into engine_schedules (business_id, agent, title, ask, every, at_time, key, enabled, next_at, created_by)
               values (${ctx.biz}, ${WATCH_DAILY.agent}, ${WATCH_DAILY.title}, ${ask}, ${WATCH_DAILY.every}, ${WATCH_DAILY.at_time}, ${WATCH_DAILY.key}, true,
                       ${nextRun({ every: 'daily', at_time: WATCH_DAILY.at_time }, ctx.now)}, 'Watchdog')
               on conflict do nothing`;
  await setConfig(ctx, 'watch_init', '1');
}

/** Next time a schedule is due, Dhaka time (UTC+6, no summer time). */
export function nextRun(s, from) {
  const t = from.getTime(), D = 6 * 3600e3;
  if (s.every === 'hourly') return new Date(Math.floor(t / 3600e3) * 3600e3 + 3600e3);
  const [hh, mm] = (/^\d{1,2}:\d{2}$/.test(str(s.at_time)) ? str(s.at_time) : '09:00').split(':').map(Number);
  const local = new Date(t + D);
  let c = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), hh, mm) - D;
  if (s.every === 'weekly') { const dow = new Date(c + D).getUTCDay(); c += ((Number(s.weekday || 0) - dow + 7) % 7) * 86400e3; if (c <= t) c += 7 * 86400e3; }
  else if (c <= t) c += 86400e3;
  return new Date(c);
}

// ------------------------------------------------------------------------------------------------------- issues
/** One problem seen now: opened, or counted again (an ignored one stays quiet until its time is up). */
export async function seeIssue(ctx, it) {
  const sev = SEVERITIES.includes(it.severity) ? it.severity : 'medium', area = AREAS.includes(it.area) ? it.area : 'other';
  await ctx.tx`insert into engine_issues (business_id, key, area, severity, title, detail, proof, fix, source, job_id)
               values (${ctx.biz}, ${str(it.key).slice(0, 200)}, ${area}, ${sev}, ${str(it.title).slice(0, 200)}, ${str(it.detail).slice(0, 1500)},
                       ${str(it.proof).slice(0, 1500)}, ${str(it.fix).slice(0, 1500)}, ${it.source || 'check'}, ${it.jobId || null})
               on conflict (business_id, key) do update set
                 last_seen = now(), seen_count = case when engine_issues.status = 'resolved' then 1 else engine_issues.seen_count + 1 end,
                 severity = excluded.severity, title = excluded.title, area = excluded.area,
                 detail = excluded.detail, proof = excluded.proof, fix = case when excluded.fix <> '' then excluded.fix else engine_issues.fix end,
                 first_seen = case when engine_issues.status = 'resolved' then now() else engine_issues.first_seen end,
                 status = case when engine_issues.status = 'ignored' and engine_issues.ignored_until > now() then 'ignored' else 'open' end,
                 resolved_at = null`;
}
/** Close (by itself) the issues of the checks that ran now and did not see them again. */
async function closeUnseen(ctx, prefixes, seen) {
  for (const p of prefixes) {
    await ctx.tx`update engine_issues set status = 'resolved', resolved_at = now()
                 where business_id = ${ctx.biz} and source = 'check' and status = 'open' and key like ${p + '%'} and not (key = any(${[...seen, '']}))`;
  }
}

// --------------------------------------------------------------------------------------------- the ERP's checks
async function erpChecks(ctx, seen) {
  const groups = [];
  const see = async (it) => { seen.add(it.key); await seeIssue(ctx, it); };
  const part = async (prefix, fn) => { try { await ctx.tx.savepoint(fn); groups.push(prefix); } catch (_) { /* a check that cannot run closes nothing */ } };

  await part('timer:', async () => {
    const rows = await ctx.sql`select action, count(*)::int n, max(at) last, (array_agg(message order by at desc))[1] msg from erp_errors
                               where business_id = ${ctx.biz} and who = 'Timer' and at > now() - interval '26 hours' and action !~ '^pub:' group by action`;
    for (const r of rows) await see({ key: 'timer:' + r.action, area: 'erp', severity: 'high', title: (JOB_WORDS[str(r.action)] || 'The timer ' + str(r.action)) + ' is failing',
      detail: str(r.msg).slice(0, 400), proof: r.n + ' time' + (r.n === 1 ? '' : 's') + ' in the last day, last ' + when(r.last), fix: 'Open the screen it belongs to and check its connection (keys, address); the Watchdog\'s daily check-up looks deeper.' });
  });
  await part('errors:', async () => {
    const rows = await ctx.sql`select action, count(*)::int n, (array_agg(message order by at desc))[1] msg from erp_errors
                               where business_id = ${ctx.biz} and who <> 'Timer' and at > now() - interval '1 hour'
                                 and message !~ '^(Your account does not have access|Sign in to the ERP|Too many wrong codes|Your sign-in has expired|Only the)'
                               group by action having count(*) >= 5`;
    for (const r of rows) await see({ key: 'errors:' + r.action, area: 'erp', severity: 'medium', title: 'An action keeps failing for people (' + str(r.action) + ')',
      detail: str(r.msg).slice(0, 400), proof: r.n + ' failures in the last hour', fix: '' });
  });
  await part('backup', async () => {
    const last = (await ctx.tx`select at from erp_backup_log where business_id = ${ctx.biz} and made > 0 order by at desc limit 1`)[0];
    if (!last) return;
    const h = Math.round((ctx.now.getTime() - new Date(last.at).getTime()) / 3600e3);
    if (h > 36) await see({ key: 'backup', area: 'erp', severity: 'high', title: 'No backup for ' + h + ' hours', detail: 'The last copy was made ' + when(last.at) + '.', proof: '', fix: 'Settings → Backups → Make a backup now; if it fails, the reason shows there.' });
  });
  // watch-3 (owner 22 Oct 2026): the Watchdog checks that everything WORKS and TALKS to each other - not the books.
  // The connections are tested once an hour (they call the outside services): the website's sync, the courier, WhatsApp.
  const lastConn = Number(await getConfig(ctx, 'watch_last_conn', '0')) || 0;
  if (ctx.now.getTime() - lastConn >= SYS_EVERY_MS || ctx.watchForce) {
    await part('conn:', async () => {
      const H = (await import('./index.js')).HANDLERS;
      const c = await erpConnStatus(ctx);
      if (c.whatsapp === 'warn') await see({ key: 'conn:whatsapp', area: 'channels', severity: 'high', title: 'WhatsApp is set up but not linked', detail: 'Alerts, campaigns and WhatsApp replies cannot go out.', proof: '', fix: 'Scan the WhatsApp QR again (Settings → Connections).' });
      if (c.website === 'on') {
        let w = null; try { w = await ctx.tx.savepoint(() => H.erpWebsiteTest(ctx)); } catch (e) { w = { ok: false, error: str(e && e.message) }; }
        if (w && !w.ok) await see({ key: 'conn:website', area: 'website', severity: 'urgent', title: 'The ERP cannot reach the website', detail: str(w.error).slice(0, 400), proof: 'Website test ' + when(ctx.now), fix: 'Orders do not come in and stock does not go out until this works.' });
      }
      if (c.courier === 'on') {
        let k = null; try { k = await ctx.tx.savepoint(() => H.erpCourierTest(ctx)); } catch (e) { k = { ok: false, error: str(e && e.message) }; }
        if (k && !k.ok) await see({ key: 'conn:courier', area: 'channels', severity: 'high', title: 'The ERP cannot reach the courier (Steadfast)', detail: str(k.error).slice(0, 400), proof: 'Courier test ' + when(ctx.now), fix: 'Parcels cannot be booked or checked until this works.' });
      }
      await setConfig(ctx, 'watch_last_conn', String(ctx.now.getTime()));
    });
  }
  // watch-3: the books are not the Watchdog's job any more - its old book issues are closed
  await part('books', async () => { await ctx.tx`update engine_issues set status = 'resolved', resolved_at = now() where business_id = ${ctx.biz} and key like 'syscheck:%' and status <> 'resolved'`; });
  await part('engine:', async () => {
    const n = (await ctx.tx`select count(*)::int n from engine_jobs where business_id = ${ctx.biz} and status = 'failed' and finished_at > now() - interval '24 hours'`)[0].n;
    if (n >= 3) await see({ key: 'engine:failing', area: 'engine', severity: 'medium', title: n + ' Engine jobs failed in the last day', detail: 'Open the Command Center, Failed, to see why.', proof: '', fix: '' });
  });
  return groups;
}

// --------------------------------------------------------------------------------------------------- the pages
/** In the Engine's claim: the pages to open when 5 minutes have passed (or the owner pressed Check now). */
export async function watchDue(ctx) {
  await ensureDefaults(ctx);
  const last = Number(await getConfig(ctx, 'watch_last_web', '0')) || 0, now = str(await getConfig(ctx, 'watch_now', ''));
  if (!now && ctx.now.getTime() - last < WEB_EVERY_MS) return null;
  await setConfig(ctx, 'watch_last_web', String(ctx.now.getTime()));
  if (now) await setConfig(ctx, 'watch_now', '');
  const t = await ctx.tx`select id, url, must from engine_watch_targets where business_id = ${ctx.biz} and enabled order by created_at limit ${MAX_TARGETS}`;
  return { targets: t.map((x) => ({ id: x.id, url: x.url, must: x.must })) };
}

function webIssues(t, r) {
  const name = str(t.label) || t.url, out = [];
  if (r.error || !(r.status > 0) || r.status >= 500) out.push({ severity: 'urgent', title: name + ' is down', detail: r.error ? str(r.error) : 'It answered ' + r.status + '.', fix: 'Check the hosting / server; the Watchdog opens it again in 5 minutes.' });
  else if (r.status >= 400) out.push({ severity: 'high', title: name + ' answers ' + r.status, detail: 'The page cannot be opened by visitors.', fix: 'Check that the address still exists (moved or deleted page, a plugin, a redirect).' });
  else if (t.must && r.found === false) out.push({ severity: 'high', title: name + ' is missing "' + t.must + '"', detail: 'The page opens but the text that must be there is not.', fix: 'Open the page: something on it is broken or empty (a plugin, the theme, out of stock everywhere).' });
  else if (r.ms > SLOW_MS) out.push({ severity: 'medium', title: name + ' is slow (' + Math.round(r.ms / 100) / 10 + ' s)', detail: 'Visitors leave when a page takes more than 3 seconds.', fix: 'A caching plugin, smaller photos, or a faster host.' });
  return out;
}

export async function erpWatchReport(ctx, payload) {
  engineOnly(ctx);
  // brain-1: the report is for one business the Engine works for (the one named, never the screen's)
  const b = (await engineBusinesses(ctx)).find((x) => x.id === str(payload && payload.biz));
  if (!b) throw new Error('That business is not one the Engine works for.');
  asBusiness(ctx, b);
  const results = (Array.isArray(payload && payload.results) ? payload.results : []).slice(0, MAX_TARGETS);
  const seen = new Set(), prefixes = [];
  const targets = await ctx.tx`select * from engine_watch_targets where business_id = ${ctx.biz}`;
  const ssl = {};
  for (const r of results) {
    const t = targets.find((x) => x.id === str(r.id)); if (!t) continue;
    const status = Math.round(Number(r.status) || 0), ms = Math.max(0, Math.round(Number(r.ms) || 0));
    const sslDays = r.sslDays === null || r.sslDays === undefined || r.sslDays === '' ? null : Math.round(Number(r.sslDays));
    const res = { status, ms, error: str(r.error).slice(0, 300), found: r.found === undefined ? null : !!r.found };
    const bad = webIssues(t, res);
    await ctx.tx`update engine_watch_targets set last_at = now(), last_status = ${status || null}, last_ms = ${ms}, last_ok = ${!bad.length}, last_error = ${res.error || null}, ssl_days = ${sslDays} where id = ${t.id}`;
    prefixes.push('web:' + t.id);
    for (const b of bad) { const key = 'web:' + t.id; seen.add(key); await seeIssue(ctx, { key, area: 'website', ...b, proof: (status ? 'HTTP ' + status : 'no answer') + ' · ' + ms + ' ms · ' + when(ctx.now) + ' · ' + t.url }); }
    let host = ''; try { host = new URL(t.url).host; } catch (_) { host = ''; }
    if (host && sslDays !== null) ssl[host] = Math.min(ssl[host] === undefined ? 9999 : ssl[host], sslDays);
  }
  prefixes.push('ssl:');
  for (const [host, days] of Object.entries(ssl)) {
    if (days < 14) { const key = 'ssl:' + host; seen.add(key); await seeIssue(ctx, { key, area: 'website', severity: days < 3 ? 'urgent' : 'high', title: 'The security certificate of ' + host + (days < 0 ? ' has expired' : ' runs out in ' + days + ' day' + (days === 1 ? '' : 's')),
      detail: 'Browsers will show visitors a warning and block the site.', proof: '', fix: 'Renew it at the hosting (or switch on automatic renewal, e.g. Let\'s Encrypt / Cloudflare).' }); }
  }
  if (!Object.keys(ssl).length) prefixes.pop();   // no certificate read this round: leave those issues as they are
  for (const g of await erpChecks(ctx, seen)) prefixes.push(g);
  await closeUnseen(ctx, prefixes, seen);
  await setConfig(ctx, 'watch_last_check', String(ctx.now.getTime()));
  const open = (await ctx.tx`select count(*)::int n from engine_issues where business_id = ${ctx.biz} and status = 'open'`)[0].n;
  return { ok: true, open };
}

// ------------------------------------------------------------------------------------------------- the screen
export async function erpWatch(ctx) {
  await gate(ctx);
  await ensureDefaults(ctx);
  await ctx.tx`update engine_issues set status = 'open' where business_id = ${ctx.biz} and status = 'ignored' and ignored_until <= now()`;
  const rows = await ctx.tx`select * from engine_issues where business_id = ${ctx.biz} and (status <> 'resolved' or resolved_at > now() - interval '7 days')
                            order by case status when 'open' then 0 when 'ignored' then 1 else 2 end,
                                     case severity when 'urgent' then 0 when 'high' then 1 when 'medium' then 2 else 3 end, last_seen desc limit 200`;
  const issues = rows.map((i) => ({ id: i.id, key: i.key, area: i.area, severity: i.severity, title: i.title, detail: i.detail, proof: i.proof, fix: i.fix, source: i.source, status: i.status,
    first: when(i.first_seen), last: when(i.last_seen), count: i.seen_count, resolved: when(i.resolved_at), ignoredUntil: when(i.ignored_until), jobId: i.job_id }));
  const counts = { open: 0, urgent: 0, high: 0, medium: 0, low: 0 };
  for (const i of issues) if (i.status === 'open') { counts.open++; counts[i.severity]++; }
  const targets = (await ctx.tx`select * from engine_watch_targets where business_id = ${ctx.biz} order by created_at`).map((t) => ({ id: t.id, label: t.label, url: t.url, must: t.must, enabled: t.enabled,
    lastAt: when(t.last_at), status: t.last_status, ms: t.last_ms, ok: t.last_ok, error: str(t.last_error), sslDays: t.ssl_days }));
  const daily = (await ctx.tx`select s.*, j.status job_status, j.id job_id from engine_schedules s left join engine_jobs j on j.id = s.last_job
                              where s.business_id = ${ctx.biz} and s.key = ${WATCH_DAILY.key}`)[0];
  const { actionOut } = await import('./brief.js');
  const waiting = (await ctx.tx`select * from engine_actions where business_id = ${ctx.biz} and kind = 'watch' and status in ('proposed', 'changing', 'running') order by created_at desc limit 30`).map(actionOut);
  // watch-4 (owner 22 Oct 2026: "it does not say if the problem is fixed or not, or that it is still working"):
  // a fix is FIXED only when its problem is closed afterwards; tried-but-still-open, working, done, failed are said as such
  const issueState = {};
  for (const r of await ctx.tx`select key, status from engine_issues where business_id = ${ctx.biz}`) issueState[r.key] = r.status;
  const fixRows = await ctx.tx`select * from engine_actions where business_id = ${ctx.biz} and kind = 'watch' and status in ('done', 'failed', 'rejected') and decided_at > now() - interval '7 days' order by decided_at desc limit 40`;
  const jobIds = fixRows.map((a) => a.outcome && a.outcome.jobId).filter(Boolean);
  const jobs = {};
  if (jobIds.length) for (const j of await ctx.tx`select id, status, result, error from engine_jobs where business_id = ${ctx.biz} and id = any(${jobIds})`) jobs[j.id] = j;
  const fixed = fixRows.map((a) => {
    const o = actionOut(a), j = a.outcome && a.outcome.jobId ? jobs[a.outcome.jobId] : null, is = a.issue_key ? issueState[a.issue_key] : null;
    let state;
    if (a.status === 'rejected') state = 'no';
    else if (a.status === 'failed') state = 'failed';
    else if (a.type === 'note') state = 'closed';
    else if (a.type === 'manual') state = 'you';
    else if (j) state = j.status === 'queued' || j.status === 'running' ? 'working' : j.status === 'done' ? 'answered' : 'failed';
    else if (is === 'open') state = 'still';
    else state = 'fixed';
    return { ...o, state, jobId: j ? j.id : null };
  });
  const openIssues = (await ctx.tx`select key, title, severity from engine_issues where business_id = ${ctx.biz} and status = 'open' order by first_seen`).map((i) => {
    const w = (waiting || []).find((x) => x.issueKey === i.key && x.status === 'proposed');
    const tried = fixed.find((x) => x.issueKey === i.key && x.state === 'still');
    return { key: i.key, title: i.title, severity: i.severity, status: w ? (w.type === 'manual' ? 'needs_you' : 'waiting_ok') : tried ? 'tried' : 'next_check' };
  });
  const wj = (await ctx.tx`select id, status, steps, started_at from engine_jobs where business_id = ${ctx.biz} and agent = 'watchdog' and status in ('queued', 'running') order by created_at desc limit 1`)[0];
  const working = wj ? { status: wj.status, step: Array.isArray(wj.steps) && wj.steps.length ? str(wj.steps[wj.steps.length - 1].t).slice(0, 160) : '', since: when(wj.started_at) } : null;
  const night = (await ctx.tx`select id, status, result, finished_at from engine_jobs where business_id = ${ctx.biz} and agent = 'watchdog' and status in ('done', 'failed') order by finished_at desc nulls last limit 1`)[0];
  const lastCheck = Number(await getConfig(ctx, 'watch_last_check', '0')) || 0;
  const run = (await ctx.tx`select seen_at from engine_runners where business_id = ${ctx.biz} order by seen_at desc limit 1`)[0];
  return { waiting, fixed, openIssues, working, lastNight: night ? { id: night.id, status: night.status, when: when(night.finished_at), note: str(night.result).slice(0, 1500) } : null,
    issues, counts, targets, lastCheck: lastCheck ? when(new Date(lastCheck)) : '', minutesAgo: lastCheck ? Math.round((ctx.now.getTime() - lastCheck) / 60000) : null,
    engineAlive: !!run && ctx.now.getTime() - new Date(run.seen_at).getTime() < 120000,
    daily: daily ? { id: daily.id, enabled: daily.enabled, at: daily.at_time, next: when(daily.next_at), lastRun: when(daily.last_run), lastJob: daily.job_id, lastStatus: daily.job_status || '' } : null };
}

export async function erpWatchTargetSave(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (p.id && !UUID.test(str(p.id))) throw new Error('Which page?');
  if (p.id && p.remove) {
    await ctx.tx`delete from engine_watch_targets where business_id = ${ctx.biz} and id = ${str(p.id)}`;
    await ctx.tx`update engine_issues set status = 'resolved', resolved_at = now() where business_id = ${ctx.biz} and key = ${'web:' + str(p.id)} and status <> 'resolved'`;
    return erpWatch(ctx);
  }
  let url = str(p.url);
  if (url && !/^https?:\/\//i.test(url)) url = 'https://' + url;
  try { const u = new URL(url); if (!/^https?:$/.test(u.protocol) || !u.hostname.includes('.')) throw new Error('x'); } catch (_) { throw new Error('Type the page address, like https://yourshop.com/checkout'); }
  const label = str(p.label).slice(0, 60), must = str(p.must).slice(0, 120), enabled = p.enabled !== false;
  if (p.id) await ctx.tx`update engine_watch_targets set url = ${url}, label = ${label}, must = ${must}, enabled = ${enabled} where business_id = ${ctx.biz} and id = ${str(p.id)}`;
  else {
    if ((await ctx.tx`select count(*)::int n from engine_watch_targets where business_id = ${ctx.biz}`)[0].n >= MAX_TARGETS) throw new Error(MAX_TARGETS + ' pages is the limit.');
    await ctx.tx`insert into engine_watch_targets (business_id, label, url, must, enabled) values (${ctx.biz}, ${label}, ${url}, ${must}, ${enabled})
                 on conflict (business_id, url) do update set label = excluded.label, must = excluded.must, enabled = excluded.enabled`;
  }
  await setConfig(ctx, 'watch_now', '1');
  return erpWatch(ctx);
}

export async function erpWatchIssueAct(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (!UUID.test(str(p.id))) throw new Error('Which issue?');
  const act = str(p.act);
  if (act === 'resolve') await ctx.tx`update engine_issues set status = 'resolved', resolved_at = now() where business_id = ${ctx.biz} and id = ${str(p.id)}`;
  else if (act === 'ignore') {
    const days = Math.min(90, Math.max(1, Math.round(Number(p.days) || 7)));
    await ctx.tx`update engine_issues set status = 'ignored', ignored_until = now() + make_interval(days => ${days}) where business_id = ${ctx.biz} and id = ${str(p.id)}`;
  } else if (act === 'reopen') await ctx.tx`update engine_issues set status = 'open', resolved_at = null, ignored_until = null where business_id = ${ctx.biz} and id = ${str(p.id)}`;
  else throw new Error('Resolve, ignore or reopen?');
  return erpWatch(ctx);
}

export async function erpWatchRunNow(ctx) {
  await gate(ctx);
  await ensureDefaults(ctx);
  const seen = new Set();
  ctx.watchForce = true;
  const groups = await erpChecks(ctx, seen);
  await closeUnseen(ctx, groups, seen);
  await setConfig(ctx, 'watch_now', '1');   // the pages: at the Engine's next round (within 20 seconds)
  await setConfig(ctx, 'watch_last_check', String(ctx.now.getTime()));
  return erpWatch(ctx);
}

// ------------------------------------------------------------------------------------------ the agents' tools
export const ISSUE_TOOLS = [
  { name: 'watch_issues', description: 'The Watchdog\'s issues: open problems found on the website, the ERP, money, stock and channels, with proof, when first and last seen; and the watched pages with their last check.', parameters: { type: 'OBJECT', properties: { all: { type: 'BOOLEAN', description: 'also the ones resolved in the last 7 days' } } } },
  { name: 'close_issue', description: 'Close an issue that fixed itself or is not a real problem (give its key and why). The checks reopen it if it comes back.', parameters: { type: 'OBJECT', properties: { issueKey: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['issueKey', 'why'] } },
  { name: 'fix_now', description: 'A safe retry the night shift may run with no approval: ' + SAFE_AUTO.join(', ') + '. Give the issue key it fixes and why.', parameters: { type: 'OBJECT', properties: { name: { type: 'STRING' }, args: { type: 'OBJECT' }, issueKey: { type: 'STRING' }, why: { type: 'STRING' } }, required: ['name', 'why'] } },
  { name: 'propose_fix', description: 'A fix that waits for the owner\'s one button. type "erp" with payload {steps: [{name, args, summary}]} (ERP functions run in order, all or nothing; never deleting, users, keys or connections), or type "task" with payload {ask} for work outside the ERP, or any brief move type. Give the issue key, a plain title, why (cause found, with figures) and figures [{label, value, source}].',
    parameters: { type: 'OBJECT', properties: { issueKey: { type: 'STRING' }, type: { type: 'STRING' }, title: { type: 'STRING' }, why: { type: 'STRING' }, figures: { type: 'ARRAY', items: { type: 'OBJECT' } }, payload: { type: 'OBJECT' } }, required: ['type', 'title', 'why', 'payload'] } },
  { name: 'report_issue', description: 'Record a real problem you found (one per problem). severity: urgent (money lost or customers blocked now) | high | medium | low. area: website | erp | money | stock | channels | engine | other. Give the proof (what you saw, where) and the exact fix.',
    parameters: { type: 'OBJECT', properties: { title: { type: 'STRING' }, severity: { type: 'STRING' }, area: { type: 'STRING' }, detail: { type: 'STRING' }, proof: { type: 'STRING' }, fix: { type: 'STRING' } }, required: ['title', 'severity', 'detail'] } },
];
export async function issueTool(ctx, name, a, job) {
  if (name === 'watch_issues') {
    const w = await erpWatch(ctx);
    return { counts: w.counts, lastCheck: w.lastCheck, issues: w.issues.filter((i) => a.all || i.status === 'open').slice(0, 60).map((i) => ({ key: i.key, title: i.title, severity: i.severity, area: i.area, status: i.status, detail: i.detail, proof: i.proof, fix: i.fix, first: i.first, last: i.last, timesSeen: i.count })),
      pages: w.targets.map((t) => ({ page: t.label || t.url, url: t.url, mustContain: t.must, lastStatus: t.status, ms: t.ms, ok: t.ok, error: t.error, certificateDaysLeft: t.sslDays })) };
  }
  if (name === 'close_issue') {
    if (job.agent !== 'watchdog' && job.agent !== 'command') return { error: 'Only the Watchdog closes issues.' };
    const i = (await ctx.tx`update engine_issues set status = 'resolved', resolved_at = now() where business_id = ${ctx.biz} and key = ${str(a.issueKey)} and status <> 'resolved' returning title`)[0];
    if (!i) return { error: 'No open issue with that key.' };
    await logFix(ctx, job, { title: 'Closed: ' + i.title, result: str(a.why).slice(0, 600), issueKey: a.issueKey, type: 'note', status: 'done' });
    return { closed: true };
  }
  if (name === 'fix_now') {
    if (job.agent !== 'watchdog') return { error: 'Only the Watchdog runs fixes.' };
    const fn = str(a.name);
    if (!SAFE_AUTO.includes(fn)) return { error: 'Not a safe retry - use propose_fix so the owner approves it.' };
    let ok = true, text = '';
    try { const H = (await import('./index.js')).HANDLERS; await ctx.tx.savepoint(() => H[fn](ctx, a.args || {})); text = 'Done.'; } catch (e) { ok = false; text = str(e && e.message).slice(0, 300); }
    if (ok && str(a.issueKey)) await ctx.tx`update engine_issues set status = 'resolved', resolved_at = now() where business_id = ${ctx.biz} and key = ${str(a.issueKey)} and status = 'open'`;
    await logFix(ctx, job, { title: str(a.why).slice(0, 160) || fn, result: (ok ? 'Fixed by itself: ' : 'Tried, did not work: ') + fn + (text && text !== 'Done.' ? ' - ' + text : ''), issueKey: a.issueKey, type: 'erp', status: ok ? 'done' : 'failed', payload: { steps: [{ name: fn, args: a.args || {}, summary: str(a.why) }] } });
    return { ok, text };
  }
  if (name === 'propose_fix') {
    if (job.agent !== 'watchdog' && job.agent !== 'command') return { error: 'Only the Watchdog proposes fixes.' };
    const { ACTION_TYPES, adCapOf } = await import('./actions.js');
    const type = str(a.type), t = ACTION_TYPES[type];
    if (!t) return { error: 'Unknown fix type. Use erp (steps), task, or a brief move type.' };
    const err = t.check(a.payload || {}, { cap: await adCapOf(ctx) }); if (err) return { error: err };
    if (str(a.title).length < 4 || str(a.why).length < 10) return { error: 'Give the fix a plain title and the why (the cause you found).' };
    const key = str(a.issueKey) || null;
    if (key) await ctx.tx`update engine_actions set status = 'replaced' where business_id = ${ctx.biz} and kind = 'watch' and status = 'proposed' and issue_key = ${key}`;
    const figures = (Array.isArray(a.figures) ? a.figures : []).slice(0, 8).map((f) => ({ label: str(f.label).slice(0, 80), value: str(f.value).slice(0, 80), source: str(f.source).slice(0, 120) })).filter((f) => f.label && f.value);
    await ctx.tx`insert into engine_actions (business_id, kind, issue_key, job_id, no, type, title, why, figures, payload, status)
                 values (${ctx.biz}, 'watch', ${key}, ${job.id}, 1, ${type}, ${str(a.title).slice(0, 160)}, ${str(a.why).slice(0, 1500)}, ${ctx.tx.json(figures)}, ${ctx.tx.json(a.payload || {})}, 'proposed')`;
    return { proposed: true, note: 'It waits for the owner\'s one button on the Watchdog screen.' };
  }
  if (name === 'report_issue') {
    const title = str(a.title).slice(0, 160);
    if (title.length < 4) return { error: 'Give the problem a title.' };
    const n = (await ctx.tx`select count(*)::int n from engine_issues where business_id = ${ctx.biz} and source = 'ai' and job_id = ${job.id}`)[0].n;
    if (n >= 15) return { error: 'Fifteen issues from one check-up is the limit; put the rest in the report.' };
    const key = 'ai:' + title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
    await seeIssue(ctx, { key, area: str(a.area), severity: str(a.severity), title, detail: a.detail, proof: a.proof, fix: a.fix, source: 'ai', jobId: job.id });
    return { recorded: true, title };
  }
  return null;
}

/** A fix done (or closed) by the night shift, for the owner's "fixed by itself" list. */
async function logFix(ctx, job, f) {
  await ctx.tx`insert into engine_actions (business_id, kind, issue_key, job_id, no, type, title, why, payload, status, auto, result, decided_by, decided_at, executed_at)
               values (${ctx.biz}, 'watch', ${str(f.issueKey) || null}, ${job.id}, 1, ${f.type}, ${str(f.title).slice(0, 160)}, '', ${ctx.tx.json(f.payload || {})}, ${f.status}, true, ${str(f.result).slice(0, 1500)},
                       'Watchdog (by itself)', now(), ${f.status === 'done' ? ctx.now : null})`;
}

/** The bell and the owner's WhatsApp (handlers/alerts.js): only what is URGENT (the rest is fixed or waits as a fix),
 *  the fixes waiting for his OK, the morning note of what was fixed overnight, and a quiet Engine with work waiting. */
export async function watchAlerts(ctx) {
  const out = [], day = formatDate(ctx.now, 'yyyy-MM-dd');
  const wait = (await ctx.tx`select count(*)::int n from engine_actions where business_id = ${ctx.biz} and kind = 'watch' and status = 'proposed'`)[0].n;
  if (wait) out.push({ key: 'watchfix:' + day + ':' + wait, level: 'warn', title: wait + (wait === 1 ? ' fix waits' : ' fixes wait') + ' for your OK', detail: 'The Watchdog found the cause and prepared the fix - one button each.', go: 'watch' });
  const fixed = (await ctx.tx`select count(*)::int n from engine_actions where business_id = ${ctx.biz} and kind = 'watch' and auto and status = 'done' and decided_at > now() - interval '18 hours'`)[0].n;
  const still = (await ctx.tx`select count(*)::int n from engine_issues where business_id = ${ctx.biz} and status = 'open'`)[0].n;
  if (fixed || still) out.push({ key: 'watchdone:' + day + ':' + fixed + ':' + still, level: 'warn', title: 'Watchdog: ' + (fixed ? 'fixed ' + fixed : 'nothing fixed') + (still ? ', ' + still + ' still open' : ', all good'), detail: still ? 'See what is still open and why.' : 'Nothing for you to do.', go: 'watch' });
  const rows = await ctx.tx`select id, title, detail, severity, first_seen from engine_issues where business_id = ${ctx.biz} and status = 'open' and severity = 'urgent' order by first_seen desc limit 10`;
  for (const i of rows) out.push({ key: 'watch:' + i.id + ':' + new Date(i.first_seen).getTime(), level: 'bad', title: (i.severity === 'urgent' ? 'URGENT: ' : '') + i.title, detail: str(i.detail).slice(0, 160), go: 'watch' });
  const q = (await ctx.tx`select count(*)::int n, min(created_at) oldest from engine_jobs where business_id = ${ctx.biz} and status = 'queued'`)[0];
  const run = (await ctx.tx`select max(seen_at) seen from engine_runners where business_id = ${ctx.biz}`)[0];
  if (q.n && run && run.seen && ctx.now.getTime() - new Date(run.seen).getTime() > 15 * 60000) {
    out.push({ key: 'engine-down:' + formatDate(new Date(run.seen), 'yyyy-MM-dd-HH'), level: 'bad', title: 'The Engine has stopped', detail: q.n + ' job' + (q.n === 1 ? '' : 's') + ' waiting; last seen ' + when(run.seen) + '.', go: 'engine' });
  }
  return out;
}

/** The owner's one button on a fix (Approve runs it; Change sends his words back to the Watchdog; No is remembered). */
export async function erpWatchFixDecide(ctx, payload) {
  await gate(ctx);
  const { decideAction } = await import('./brief.js');
  await decideAction(ctx, payload);
  return erpWatch(ctx);
}

export const HANDLERS = { erpWatch, erpWatchTargetSave, erpWatchIssueAct, erpWatchRunNow, erpWatchReport, erpWatchFixDecide };
