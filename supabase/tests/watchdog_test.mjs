// watch-1 (owner 22 Oct 2026, Engine step 2): the Watchdog. The Engine opens the watched pages every 5 minutes and
// reports; the ERP checks itself; every problem is one issue that closes by itself when fixed; urgent / high ones reach
// the bell; the Watchdog agent's daily check-up is a timed job and may record issues; timed jobs for any agent.
import { sql, FIX, owner, mgr, call, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
const { nextRun } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'watchdog.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-watch-key-00000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });
const issue = async (like) => (await sql`select * from engine_issues where business_id = ${B} and key like ${like} order by last_seen desc limit 1`)[0];

// ---- Dhaka times
check('daily 09:00 Dhaka: asked at 11:00 Dhaka -> tomorrow 03:00 UTC', nextRun({ every: 'daily', at_time: '09:00' }, new Date('2026-10-22T05:00:00Z')).toISOString() === '2026-10-23T03:00:00.000Z', '');
check('...asked at 08:00 Dhaka -> today', nextRun({ every: 'daily', at_time: '09:00' }, new Date('2026-10-22T02:00:00Z')).toISOString() === '2026-10-22T03:00:00.000Z', '');
check('weekly Friday 10:30 from a Thursday -> the next day', nextRun({ every: 'weekly', at_time: '10:30', weekday: 5 }, new Date('2026-10-22T05:00:00Z')).toISOString() === '2026-10-23T04:30:00.000Z', '');
check('hourly -> the next full hour', nextRun({ every: 'hourly' }, new Date('2026-10-22T05:20:00Z')).toISOString() === '2026-10-22T06:00:00.000Z', '');

// ---- the screen and the door
let r = await mgr('erpWatch', []);
check('a manager does not see the Watchdog', !r.ok, r);
r = await owner('erpWatch', []);
check('the owner sees the Watchdog: nothing wrong yet, the night check set for 03:00', r.ok && r.result.counts.open === 0 && r.result.daily && r.result.daily.enabled && r.result.daily.at === '03:00', r);
r = await owner('erpWatchTargetSave', [{ url: 'shop.test/checkout', label: 'Checkout', must: 'Place order' }]);
const T = r.result && r.result.targets.find((t) => t.label === 'Checkout');
check('the owner adds a page to watch (https added), with the text that must be on it', r.ok && T && T.url === 'https://shop.test/checkout' && T.must === 'Place order', r.result && r.result.targets);
r = await owner('erpWatchTargetSave', [{ url: 'not a page' }]);
check('...a wrong address is refused', !r.ok, r);
r = await owner('erpWatchReport', [{ results: [] }]);
check('only the Engine reports checks', !r.ok && /Only the Engine/.test(r.error), r);

// ---- the Engine is handed the pages every 5 minutes
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('the claim hands the Engine the pages to open, for this business', r.ok && r.result.watches.length === 1 && r.result.watches[0].biz === B && r.result.watches[0].targets.some((t) => t.id === T.id && t.must === 'Place order'), r.result && r.result.watches);
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('...not again within 5 minutes', r.ok && r.result.watches.length === 0, r.result && r.result.watches);

// ---- a page down -> urgent issue -> the bell; seen again -> counted; fixed -> closed by itself
r = await eng('erpWatchReport', { biz: B, results: [{ id: T.id, status: 0, ms: 30000, error: 'ECONNREFUSED' }] });
let I = await issue('web:%');
check('the page is down: an urgent website issue', r.ok && I && I.severity === 'urgent' && I.area === 'website' && I.status === 'open' && /down/.test(I.title), I);
r = await owner('erpAlerts', []);
check('...it is on the bell (and so goes to WhatsApp)', r.ok && r.result.alerts.some((a) => /^URGENT: Checkout is down/.test(a.title) && a.go === 'watch'), r.result && r.result.alerts.map((a) => a.title));
await eng('erpWatchReport', { biz: B, results: [{ id: T.id, status: 503, ms: 900 }] });
I = await issue('web:%');
check('seen again: one issue, counted twice', I.seen_count === 2, I);
r = await eng('erpWatchReport', { biz: B, results: [{ id: T.id, status: 200, ms: 700, found: true, sslDays: 5 }] });
I = await issue('web:%');
const S = await issue('ssl:%');
check('the page works again: the issue closes by itself', I.status === 'resolved', I);
check('...but the certificate runs out in 5 days: a high issue', S && S.severity === 'high' && /5 days/.test(S.title), S);
r = await eng('erpWatchReport', { biz: B, results: [{ id: T.id, status: 200, ms: 9500, found: false, sslDays: 80 }] });
I = await issue('web:%');
check('the text that must be there is missing: reopened as new (high), the certificate issue closed', I.status === 'open' && I.severity === 'high' && /missing "Place order"/.test(I.title) && I.seen_count === 1 && (await issue('ssl:%')).status === 'resolved', I);
r = await owner('erpWatch', []);
const W = r.result.targets.find((t) => t.id === T.id);
check('the screen shows the page\'s last check', W.status === 200 && W.ms === 9500 && W.ok === false && W.sslDays === 80, W);

// ---- the ERP's own checks
await sql`insert into erp_errors (business_id, who, action, message) values (${B}, 'Timer', 'websync:pull', 'The website did not answer (502)')`;
r = await eng('erpWatchReport', { biz: B, results: [] });
I = await issue('timer:%');
check('a failing timer becomes an issue', I && I.key === 'timer:websync:pull' && I.severity === 'high' && /Reading website orders is failing/.test(I.title), I);
await sql`update erp_errors set at = now() - interval '30 hours' where business_id = ${B} and action = 'websync:pull'`;
await eng('erpWatchReport', { biz: B, results: [] });
check('...and closes when it works again', (await issue('timer:%')).status === 'resolved', '');
check('a round with no pages leaves the page issues as they were', (await issue('web:%')).status === 'open', '');

// ---- the owner: ignore for a time, reopen, resolve; remove a page
const wid = (await issue('web:%')).id;
r = await owner('erpWatchIssueAct', [{ id: wid, act: 'ignore', days: 3 }]);
await eng('erpWatchReport', { biz: B, results: [{ id: T.id, status: 404, ms: 300 }] });
I = await issue('web:%');
check('an ignored issue stays quiet while it is seen again', I.status === 'ignored' && I.severity === 'high', I);
r = await owner('erpAlerts', []);
check('...and is not on the bell', !r.result.alerts.some((a) => /Checkout/.test(a.title)), r.result.alerts.map((a) => a.title));
r = await owner('erpWatchIssueAct', [{ id: wid, act: 'reopen' }]);
check('the owner reopens it', r.ok && r.result.issues.find((i) => i.id === wid).status === 'open', '');
r = await owner('erpWatchRunNow', []);
check('Check now runs the ERP\'s checks at once', r.ok && r.result.lastCheck !== undefined, r);

// ---- the daily check-up (a timed job) and the agents' tools
const daily = (await owner('erpWatch', [])).result.daily;
r = await owner('erpEngineScheduleRun', [{ id: daily.id }]);
const JW = r.result && r.result.created;
check('the daily check-up can be run now', r.ok && JW, r);
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('the Engine gets it as the Watchdog, with watch_issues and report_issue', r.ok && r.result.job.id === JW && r.result.agent.key === 'watchdog' &&
  r.result.tools.some((t) => t.name === 'watch_issues') && r.result.tools.some((t) => t.name === 'report_issue') && /Night shift/.test(r.result.job.ask), r.result && r.result.job);
r = await eng('erpEngineTool', { id: JW, tool: 'watch_issues', args: {} });
check('the Watchdog reads the open issues and the pages', r.ok && r.result.issues.some((i) => /Checkout/.test(i.title)) && r.result.pages.some((p) => p.url === 'https://shop.test/checkout'), r.result);
r = await eng('erpEngineTool', { id: JW, tool: 'report_issue', args: { title: 'Product pages show no price', severity: 'high', area: 'website', detail: 'Three product pages show an empty price.', proof: 'https://shop.test/p/1', fix: 'Re-save the price field in WooCommerce.' } });
I = await issue('ai:%');
check('...and records a new problem it found (with proof and fix)', r.ok && r.result.recorded && I && I.source === 'ai' && I.job_id === JW && I.fix.startsWith('Re-save'), I);
await eng('erpWatchReport', { biz: B, results: [] });
check('the checks never close what the AI found', (await issue('ai:%')).status === 'open', '');
await eng('erpEngineDone', { id: JW, ok: true, result: '1 new problem.' });

r = await owner('erpEngineAsk', [{ ask: 'SEO check', agent: 'seo' }]);
const JS = r.result.created;
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('other agents read the issues but do not record them', r.ok && r.result.job.id === JS && r.result.tools.some((t) => t.name === 'watch_issues') && !r.result.tools.some((t) => t.name === 'report_issue'), '');
r = await eng('erpEngineTool', { id: JS, tool: 'report_issue', args: { title: 'x y z w', severity: 'low', detail: 'x' } });
check('...a report from them is refused', r.ok && /No such function/.test(r.result.error), r.result);
await eng('erpEngineDone', { id: JS, ok: true, result: 'ok' });

// ---- timed jobs for any agent
r = await owner('erpEngineScheduleSave', [{ agent: 'briefing', title: 'Morning page', ask: 'Write my morning page', every: 'daily', at: '8:30' }]);
const MS = r.result && r.result.schedules.find((s) => s.title === 'Morning page');
check('the owner sets a timed job (agent, what, when)', r.ok && MS && MS.at === '08:30' && MS.enabled && MS.next && MS.agentName === 'Owner briefing', MS);
await sql`update engine_schedules set next_at = now() - interval '1 minute' where id = ${MS.id}`;
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('when it is due it becomes a job the Engine takes', r.ok && r.result.job && r.result.job.title === 'Morning page' && r.result.agent.key === 'briefing', r.result && r.result.job);
const nxt = (await sql`select next_at from engine_schedules where id = ${MS.id}`)[0].next_at;
check('...and its next time moves on', new Date(nxt) > new Date(), nxt);
await sql`update engine_schedules set next_at = now() - interval '1 minute' where id = ${MS.id}`;
await eng('erpEngineClaim', { runner: 'vps1', peek: true });
const n = (await sql`select count(*)::int n from engine_jobs where business_id = ${B} and title = 'Morning page'`)[0].n;
check('...not twice while the last one is still running', n === 1, n);
r = await owner('erpEngineScheduleSave', [{ id: MS.id, enabled: false }]);
check('a timed job is switched off', r.ok && !r.result.schedules.find((s) => s.id === MS.id).enabled, '');
r = await owner('erpEngineScheduleSave', [{ id: daily.id, remove: true }]);
check('the built-in daily check-up is switched off, never removed', !r.ok, r);
r = await owner('erpEngineScheduleSave', [{ id: MS.id, remove: true }]);
check('the owner\'s own timed job is removed', r.ok && !r.result.schedules.some((s) => s.id === MS.id), '');

r = await owner('erpWatchTargetSave', [{ id: T.id, remove: true }]);
check('a page taken off the list closes its issue', r.ok && !r.result.targets.some((t) => t.id === T.id) && (await issue('web:%')).status === 'resolved', '');
const other = await sql`select (select count(*) from engine_issues where business_id = ${FIX.B2})::int i, (select count(*) from engine_schedules where business_id = ${FIX.B2})::int s`;
check('the other business has no issues and no timed jobs', other[0].i === 0 && other[0].s === 0, other);

await done();
