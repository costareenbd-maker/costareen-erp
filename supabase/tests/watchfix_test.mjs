// watch-2 (owner 22 Oct 2026): no "Mark fixed" - the Watchdog's night shift fixes what is safe by itself (logged as
// "fixed by itself"), turns everything that changes data into fixes the owner approves with one button (all or nothing,
// never deleting / users / keys), and the morning alert says what was fixed and what waits.
import { sql, FIX, owner, call, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-wfix-key-000000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });
const CU = (await sql`select phone, name from customers where business_id = ${B} and phone ~ '^01[0-9]{9}$' limit 1`)[0];

let r = await owner('erpWatch', []);
check('the night shift: checks and fixes at 03:00', r.ok && r.result.daily.at === '03:00' && r.result.waiting.length === 0 && r.result.fixed.length === 0, r.result && r.result.daily);
await sql`insert into engine_issues (business_id, key, area, severity, title, detail) values
  (${B}, 'timer:websync:pull', 'erp', 'high', 'Reading website orders is failing', '502'),
  (${B}, 'backup', 'erp', 'high', 'No backup for 40 hours', ''),
  (${B}, 'syscheck:M9', 'money', 'high', 'The books disagree', 'x'),
  (${B}, 'web:site', 'website', 'urgent', 'The website is down', 'ECONNREFUSED')`;
r = await owner('erpAlerts', []);
const titles = r.result.alerts.map((a) => a.title);
check('only the URGENT problem reaches the bell; high ones go to the night shift', titles.some((t) => /URGENT: The website is down/.test(t)) && !titles.some((t) => /Reading website orders/.test(t)), titles);

r = await owner('erpEngineScheduleRun', [{ id: (await owner('erpWatch', [])).result.daily.id }]);
r = await eng('erpEngineClaim', { runner: 'vps1' });
const J = r.result.job;
check('the night shift gets close_issue, fix_now and propose_fix', r.ok && r.result.agent.key === 'watchdog' && ['close_issue', 'fix_now', 'propose_fix'].every((n) => r.result.tools.some((t) => t.name === n)) && /Night shift/.test(J.ask), J);
r = await eng('erpEngineTool', { id: J.id, tool: 'watch_issues', args: {} });
check('it sees each issue with its key', r.ok && r.result.issues.some((i) => i.key === 'backup'), r.result);

r = await eng('erpEngineTool', { id: J.id, tool: 'fix_now', args: { name: 'erpRecordPayment', args: {}, why: 'x', issueKey: 'backup' } });
check('a change to data is never done without approval', r.ok && /propose_fix/.test(r.result.error), r.result);
r = await eng('erpEngineTool', { id: J.id, tool: 'fix_now', args: { name: 'erpSystemCheck', args: {}, why: 'Re-ran the books check', issueKey: 'syscheck:M9' } });
check('a safe retry runs by itself and closes its issue', r.ok && r.result.ok && (await sql`select status from engine_issues where business_id = ${B} and key = 'syscheck:M9'`)[0].status === 'resolved', r.result);
r = await eng('erpEngineTool', { id: J.id, tool: 'close_issue', args: { issueKey: 'timer:websync:pull', why: 'The website answered again at 2 AM; the last two pulls worked.' } });
check('a problem that fixed itself is closed with the reason', r.ok && r.result.closed, r.result);

r = await eng('erpEngineTool', { id: J.id, tool: 'propose_fix', args: { issueKey: 'backup', type: 'erp', title: 'x', why: 'short', payload: { steps: [{ name: 'erpUserSet', args: {}, summary: 'Change a user' }] } } });
check('a fix may never touch users, keys, deleting...', r.ok && /allowed ERP function/.test(r.result.error), r.result);
r = await eng('erpEngineTool', { id: J.id, tool: 'propose_fix', args: { issueKey: 'backup', type: 'erp', title: 'Call the customer about the backup bill', why: 'The backup stopped because the storage bill is due; a reminder call fixes it.',
  figures: [{ label: 'Hours without backup', value: '40', source: 'watch_issues' }], payload: { steps: [{ name: 'erpFollowupSave', args: { phone: CU.phone, due: '2026-10-24', note: 'Pay the storage bill' }, summary: 'Put a follow-up call on the list' }] } } });
check('a data fix is prepared for the owner\'s button', r.ok && r.result.proposed, r.result);
r = await eng('erpEngineTool', { id: J.id, tool: 'propose_fix', args: { type: 'erp', title: 'A fix that will fail', why: 'This step has wrong arguments on purpose.',
  payload: { steps: [{ name: 'erpFollowupSave', args: { phone: CU.phone, due: '2026-10-25', note: 'first step' }, summary: 'A good first step' }, { name: 'erpFollowupSave', args: { due: 'not a date', note: '' }, summary: 'A bad second step' }] } } });
await eng('erpEngineDone', { id: J.id, ok: true, result: 'Fixed 2 problems by myself; 2 fixes wait for your OK.' });

r = await owner('erpWatch', []);
const W = r.result;
check('the owner sees: 2 fixes waiting, 2 fixed by itself, and the night\'s note', W.waiting.filter((a) => a.status === 'proposed').length === 2 && W.fixed.filter((a) => a.autoDone).length === 2 && /Fixed 2 problems/.test(W.lastNight.note), { waiting: W.waiting.length, fixed: W.fixed.map((a) => a.title) });
r = await owner('erpAlerts', []);
const t2 = r.result.alerts.map((a) => a.title);
check('the morning alert: what waits, what was fixed overnight and what is still open', t2.some((t) => /2 fixes wait for your OK/.test(t)) && t2.some((t) => /Watchdog: fixed 2, \d+ still open/.test(t)), t2);
check('honest states: the retry that closed its problem = fixed, the closed one = fixed itself', W.fixed.some((a) => a.state === 'fixed' && /books check/.test(a.title)) && W.fixed.some((a) => a.state === 'closed'), W.fixed.map((a) => a.title + ':' + a.state));
check('each problem still open says its status (a fix waits for the OK / will be fixed at the night check)', W.openIssues.some((i) => i.key === 'backup' && i.status === 'waiting_ok') && W.openIssues.some((i) => i.key === 'web:site' && i.status === 'next_check'), W.openIssues);

const good = W.waiting.find((a) => a.title.startsWith('Call the customer'));
r = await owner('erpWatchFixDecide', [{ id: good.id, act: 'approve' }]);
check('Approve: the fix runs through the ERP and closes its issue', r.ok && r.result.fixed.some((a) => a.id === good.id && a.status === 'done') &&
  (await sql`select count(*)::int n from customer_followups where business_id = ${B} and note like 'Pay the storage bill%'`)[0].n === 1 &&
  (await sql`select status from engine_issues where business_id = ${B} and key = 'backup'`)[0].status === 'resolved', r.result && r.result.fixed.find((a) => a.id === good.id));
const bad = W.waiting.find((a) => a.title === 'A fix that will fail');
r = await owner('erpWatchFixDecide', [{ id: bad.id, act: 'approve' }]);
check('a fix whose step fails is undone completely (all or nothing)', r.ok && r.result.fixed.some((a) => a.id === bad.id && a.status === 'failed') &&
  (await sql`select count(*)::int n from customer_followups where business_id = ${B} and note like 'first step%'`)[0].n === 0, r.result && r.result.fixed.find((a) => a.id === bad.id));

// Change: the owner's words go back to the Watchdog
r = await owner('erpEngineScheduleRun', [{ id: W.daily.id }]);
r = await eng('erpEngineClaim', { runner: 'vps1' });
const J2 = r.result.job;
await eng('erpEngineTool', { id: J2.id, tool: 'propose_fix', args: { type: 'task', title: 'Ask the host to restart the website', why: 'The website refuses connections since 1 AM.', payload: { ask: 'Write the message to the hosting support.' } } });
await eng('erpEngineDone', { id: J2.id, ok: true, result: 'One fix waits.' });
const tk = (await owner('erpWatch', [])).result.waiting.find((a) => a.status === 'proposed');
r = await owner('erpWatchFixDecide', [{ id: tk.id, act: 'change', note: 'Write it in Bangla and call them instead' }]);
check('Change: the fix waits while the Watchdog redoes it', r.ok && r.result.waiting.some((a) => a.id === tk.id && a.status === 'changing'), '');
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('...the Watchdog gets his words and brief_replace_action', r.ok && r.result.agent.key === 'watchdog' && /Bangla and call them/.test(r.result.job.ask) && r.result.tools.some((t) => t.name === 'brief_replace_action'), r.result.job);
r = await eng('erpEngineTool', { id: r.result.job.id, tool: 'brief_replace_action', args: { action: { type: 'task', title: 'Call the host (script in Bangla)', why: 'Same cause.', figures: [{ label: 'Down since', value: '1 AM', source: 'watch_issues' }], payload: { ask: 'Write a Bangla call script for the hosting support.' } } } });
check('...the new fix replaces it, still a Watchdog fix', r.ok && r.result.replaced && (await owner('erpWatch', [])).result.waiting.some((a) => a.title === 'Call the host (script in Bangla)' && a.kind === 'watch' && a.status === 'proposed'), r.result);
// a retry that did not cure the problem is said as such; an approved Engine task is "working" until its job ends
await sql`insert into engine_issues (business_id, key, area, severity, title) values (${B}, 'conn:courier', 'channels', 'high', 'The ERP cannot reach the courier')`;
r = await owner('erpEngineScheduleRun', [{ id: W.daily.id }]);
r = await eng('erpEngineClaim', { runner: 'vps1' });
const J3 = r.result.job;
await eng('erpEngineTool', { id: J3.id, tool: 'fix_now', args: { name: 'erpSystemCheck', args: {}, why: 'Retry the courier link', issueKey: 'conn:courier' } });
await sql`update engine_issues set status = 'open', resolved_at = null where business_id = ${B} and key = 'conn:courier'`;   // the next check found it again
await eng('erpEngineStep', { id: J3.id, lines: ['ERP: fix now erpSystemCheck'] });
r = await owner('erpWatch', []);
check('the screen shows the night shift working now, with what it is doing', r.ok && r.result.working && r.result.working.status === 'running' && /fix now/.test(r.result.working.step), r.result.working);
check('a retry whose problem came back = "tried - still not working"', r.result.fixed.some((a) => a.title === 'Retry the courier link' && a.state === 'still') && r.result.openIssues.some((i) => i.key === 'conn:courier' && i.status === 'tried'), r.result.fixed.map((a) => a.title + ':' + a.state));
await eng('erpEngineTool', { id: J3.id, tool: 'propose_fix', args: { type: 'task', title: 'Write the courier support message', why: 'The courier refuses the key since last night.', payload: { ask: 'Write the message to Steadfast support.' } } });
await eng('erpEngineDone', { id: J3.id, ok: true, result: 'ok' });
const tsk = (await owner('erpWatch', [])).result.waiting.find((a) => a.title === 'Write the courier support message');
r = await owner('erpWatchFixDecide', [{ id: tsk.id, act: 'approve' }]);
const tf = r.result.fixed.find((a) => a.id === tsk.id);
check('an approved Engine task shows "working on it" until its answer is ready', tf && tf.state === 'working' && tf.jobId, tf);
await sql`update engine_jobs set status = 'done', result = 'Dear Steadfast...' where id = ${tf.jobId}`;
r = await owner('erpWatch', []);
check('...then "done - see the answer"', r.result.fixed.find((a) => a.id === tsk.id).state === 'answered', '');
check('the other business has no fixes', (await sql`select count(*)::int n from engine_actions where business_id = ${FIX.B2}`)[0].n === 0, '');

await done();
