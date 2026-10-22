// brief-1 (owner 22 Oct 2026): the daily brief at 8 PM - the ERP's own scoreboard, five big moves filed by the Owner
// briefing agent with their figures, each answered by ONE button: Approve runs it through the ERP's own functions,
// Change sends it back to the Engine, No is remembered; done moves are measured and become lessons.
import { sql, FIX, owner, mgr, call, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-brief-key-00000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });
const P1 = (await sql`select sku, sell_price, category, brand from products where business_id = ${B} and sell_price > 100 and coalesce(status, 'Active') !~* 'discontinued' order by sku limit 1`)[0];
const CU = (await sql`select phone, name from customers where business_id = ${B} and phone ~ '^01[0-9]{9}$' limit 1`)[0];
check('(fixture: a product and a customer with a phone)', !!P1 && !!CU, { P1, CU });

// ---- the door, the 8 PM timed job, the limits
let r = await mgr('erpBrief', [{}]);
check('a manager does not see the brief', !r.ok, r);
r = await owner('erpBrief', [{}]);
check('the owner: no brief yet, the brief set daily at 20:00, ad limit 3,000', r.ok && r.result.brief === null && r.result.schedule.at === '20:00' && r.result.schedule.enabled && r.result.adCap === 3000, r.result);
r = await owner('erpBriefSettings', [{ at: '20:30', adCap: 2500 }]);
check('the owner moves it to 20:30 and sets the ad limit to 2,500', r.ok && r.result.schedule.at === '20:30' && r.result.adCap === 2500, r.result && r.result.schedule);

// ---- the Engine writes it
r = await owner('erpBriefRunNow', []);
const JB = r.result && r.result.created;
check('Brief now: a job for the Owner briefing agent', r.ok && JB, r);
r = await owner('erpBriefRunNow', []);
check('...not twice at once', !r.ok, r);
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('the briefing agent gets brief_save and brief_results', r.ok && r.result.job.id === JB && r.result.agent.key === 'briefing' && r.result.tools.some((t) => t.name === 'brief_save') && r.result.tools.some((t) => t.name === 'brief_results'), r.result && r.result.job);
const fig = [{ label: 'Sold in 30 days', value: '12', source: 'erp: business_snapshot' }];
const good = [
  { type: 'reorder', title: 'Reorder the best seller before it runs out', why: 'Sells 12 a month, 3 left', figures: fig, impactBdt: 40000, costBdt: 0, risk: 'low', confidence: 0.8, payload: { lines: [{ sku: P1.sku, qty: 20 }] }, metric: { kind: 'sales_sku', sku: P1.sku, days: 7 } },
  { type: 'price', title: 'Small price cut to move it', why: 'Slow for 60 days', figures: fig, impactBdt: 9000, costBdt: 0, risk: 'low', confidence: 0.6, payload: { sku: P1.sku, newPrice: Math.round(Number(P1.sell_price) * 0.95), reason: 'slow' }, metric: { kind: 'sales_sku', sku: P1.sku, days: 7 } },
  { type: 'followup', title: 'Call the customers who owe the most', why: 'Dues 60+ days', figures: fig, impactBdt: 50000, costBdt: 0, risk: 'low', confidence: 0.7, payload: { items: [{ phone: CU.phone, due: '2026-10-25', note: 'Ask about the due' }] }, metric: { kind: 'dues', days: 7 } },
  { type: 'whatsapp', title: 'Tell past buyers the new colours are in', why: 'They bought this line', figures: fig, impactBdt: 30000, costBdt: 0, risk: 'medium', confidence: 0.6, payload: { text: 'New colours are in stock - reply to order.', recipients: [{ phone: CU.phone, name: CU.name }, { phone: '01999999999', name: 'Stranger' }] }, metric: { kind: 'none' } },
  { type: 'task', title: 'List 20 schools to sell to', why: 'Schools buy in January', figures: fig, impactBdt: 100000, costBdt: 0, risk: 'low', confidence: 0.5, payload: { agent: 'leads', ask: 'Find 20 schools with a robotics club in Dhaka with contacts.' }, metric: { kind: 'none' } },
];
r = await eng('erpEngineTool', { id: JB, tool: 'brief_save', args: { headline: 'x', actions: good.slice(0, 2) } });
check('fewer than 3 moves is refused', r.ok && /at least 3/.test(r.result.error), r.result);
r = await eng('erpEngineTool', { id: JB, tool: 'brief_save', args: { headline: 'x', actions: good.slice(0, 4).concat([{ type: 'ad', title: 'Big ad', why: 'x', figures: fig, payload: { text: 'A long enough ad text for the test here', dailyBudget: 1000, days: 7 } }]) } });
check('an ad over the owner\'s limit is refused (7,000 > 2,500)', r.ok && /over the limit/.test(r.result.error), r.result);
r = await eng('erpEngineTool', { id: JB, tool: 'brief_save', args: { headline: 'x', actions: good.slice(0, 4).concat([{ type: 'magic', title: 'x', why: 'x', figures: fig }]) } });
check('an unknown kind of move is refused', r.ok && /known type/.test(r.result.error), r.result);
r = await eng('erpEngineTool', { id: JB, tool: 'brief_save', args: { headline: 'x', actions: good.slice(0, 4).concat([{ type: 'task', title: 'No figures', why: 'x', figures: [], payload: { ask: 'something long enough' } }]) } });
check('a move without its figures is refused', r.ok && r.result.error, r.result);
r = await eng('erpEngineTool', { id: JB, tool: 'brief_save', args: { headline: 'Sales are up 18% a day; one best seller is about to run out.', changes: [{ text: 'PLA sold more' }], risks: [{ text: 'Stock-out' }], opportunities: [{ text: 'Schools' }], results: 'First brief.', actions: good } });
check('the brief is filed with 5 moves', r.ok && r.result.filed && r.result.moves === 5, r.result);
await eng('erpEngineDone', { id: JB, ok: true, result: 'Filed.' });

r = await owner('erpBrief', [{}]);
const BR = r.result || {};
const act = (t) => BR.actions.find((a) => a.type === t);
check('the owner sees the brief: headline, the ERP\'s own scoreboard, changes / risks / opportunities, 5 moves waiting', r.ok && BR.brief.headline.startsWith('Sales are up') && BR.brief.scoreboard.month && BR.brief.changes.length === 1 && BR.actions.length === 5 && BR.actions.every((a) => a.status === 'proposed'), BR.brief && BR.brief.scoreboard);
check('...each move with its figures, gain and type', act('reorder').figures[0].source === 'erp: business_snapshot' && act('reorder').impact === 40000 && act('reorder').typeName === 'Supplier order (planned)', act('reorder'));

// ---- one button each
r = await owner('erpBriefDecide', [{ id: act('reorder').id, act: 'approve' }]);
check('Approve a reorder: a planned supplier order is made (nothing paid)', r.ok && r.result.actions.find((a) => a.type === 'reorder').status === 'done', r.result && r.result.actions.find((a) => a.type === 'reorder'));
check('...it is in the supplier orders', (await sql`select count(*)::int n from po_lines where business_id = ${B} and lower(sku) = lower(${P1.sku}) and qty = 20`)[0].n >= 1, '');
r = await owner('erpBriefDecide', [{ id: act('reorder').id, act: 'approve' }]);
check('...answered once only', !r.ok, r);
r = await owner('erpBriefDecide', [{ id: act('price').id, act: 'approve' }]);
const np = (await sql`select sell_price, category, brand from products where business_id = ${B} and sku = ${P1.sku}`)[0];
check('Approve a 5% price cut: the price changes, nothing else does', r.ok && Number(np.sell_price) === Math.round(Number(P1.sell_price) * 0.95) && np.category === P1.category && np.brand === P1.brand, np);
r = await owner('erpBriefDecide', [{ id: act('followup').id, act: 'approve' }]);
check('Approve follow-ups: the calls are on the list', r.ok && (await sql`select count(*)::int n from customer_followups where business_id = ${B} and note like '%approved move%'`)[0].n === 1, r.result && r.result.actions.find((a) => a.type === 'followup'));
r = await owner('erpBriefDecide', [{ id: act('whatsapp').id, act: 'approve' }]);
const wa = r.result && r.result.actions.find((a) => a.type === 'whatsapp');
check('Approve a WhatsApp message with no WhatsApp linked: it fails with the reason, nothing half sent', r.ok && wa.status === 'failed' && /WhatsApp/.test(wa.result), wa && { status: wa.status, result: wa.result });
r = await owner('erpBriefDecide', [{ id: act('task').id, act: 'approve' }]);
check('Approve work for the Engine: it becomes a Leads job', r.ok && (await sql`select count(*)::int n from engine_jobs where business_id = ${B} and agent = 'leads' and title = 'List 20 schools to sell to'`)[0].n === 1, '');
await sql`update engine_jobs set status = 'cancelled' where business_id = ${B} and agent = 'leads'`;   // out of the way of the next claims

// ---- No, Change, a failure, a cut over the limit
const J2 = (await owner('erpBriefRunNow', [])).result.created;
await eng('erpEngineClaim', { runner: 'vps1' });
r = await eng('erpEngineTool', { id: J2, tool: 'brief_save', args: { headline: 'Second', actions: [
  { type: 'price', title: 'Deep cut', why: 'x', figures: fig, payload: { sku: P1.sku, newPrice: Math.round(Number(P1.sell_price) * 0.5) } },
  { type: 'post', title: 'Post the offer', why: 'x', figures: fig, payload: { text: 'Big offer this week on filament - order now!' } },
  { type: 'task', title: 'Think about bundles', why: 'x', figures: fig, payload: { ask: 'Design three bundles from slow stock.' } }] } });
check('(second brief filed)', r.ok && r.result.filed, r);
await eng('erpEngineDone', { id: J2, ok: true, result: 'ok' });
r = await owner('erpBrief', [{}]);
const B2a = r.result.actions;
check('a second brief the same day replaces the first brief\'s unanswered moves only (answered ones stay)', B2a.filter((a) => a.status === 'proposed').length === 3 && r.result.brief.headline === 'Second' && B2a.some((a) => a.status === 'done'), B2a.map((a) => a.title + ':' + a.status));
r = await owner('erpBriefDecide', [{ id: B2a.find((a) => a.status === 'proposed' && a.type === 'price').id, act: 'approve' }]);
const cut = r.result.actions.find((a) => a.title === 'Deep cut');
check('a 50% cut is refused when approved (over the 10% the AI may cut) - nothing changed', cut.status === 'failed' && /more than the 10%/.test(cut.result) && Number((await sql`select sell_price from products where business_id = ${B} and sku = ${P1.sku}`)[0].sell_price) === Number(np.sell_price), cut);
r = await owner('erpBriefDecide', [{ id: B2a.find((a) => a.status === 'proposed' && a.type === 'post').id, act: 'approve' }]);
const post = r.result.actions.find((a) => a.title === 'Post the offer');
check('a post with no Facebook connected fails with the reason (nothing half done)', r.ok && post.status === 'failed' && /could not be published/.test(post.result), post);
r = await owner('erpBriefDecide', [{ id: B2a.find((a) => a.status === 'proposed' && a.type === 'task').id, act: 'reject', note: 'We tried bundles last year' }]);
check('No: kept with the reason, and remembered for the next briefs', r.ok && r.result.actions.find((a) => a.title === 'Think about bundles').status === 'rejected' &&
  (await sql`select count(*)::int n from engine_facts where business_id = ${B} and text like '%said NO%bundles%We tried bundles last year%'`)[0].n === 1, '');
const J3 = (await owner('erpBriefRunNow', [])).result.created;
await eng('erpEngineClaim', { runner: 'vps1' });
await eng('erpEngineTool', { id: J3, tool: 'brief_save', args: { headline: 'Third', actions: good.slice(2, 5) } });
await eng('erpEngineDone', { id: J3, ok: true, result: 'ok' });
const tk = (await owner('erpBrief', [{}])).result.actions.find((a) => a.type === 'task');
r = await owner('erpBriefDecide', [{ id: tk.id, act: 'change', note: 'Make it colleges, not schools' }]);
check('Change: the move waits while the Engine redoes it', r.ok && r.result.actions.find((a) => a.id === tk.id).status === 'changing', '');
r = await eng('erpEngineClaim', { runner: 'vps1' });
const JC = r.result.job.id;
check('...the Engine gets the owner\'s words and the move', /colleges, not schools/.test(r.result.job.ask) && r.result.tools.some((t) => t.name === 'brief_replace_action'), r.result.job);
r = await eng('erpEngineTool', { id: JC, tool: 'brief_replace_action', args: { action: { type: 'task', title: 'List 20 colleges to sell to', why: 'Colleges buy in bulk', figures: fig, payload: { agent: 'leads', ask: 'Find 20 colleges in Dhaka with a robotics lab.' } } } });
await eng('erpEngineDone', { id: JC, ok: true, result: 'Changed.' });
r = await owner('erpBrief', [{}]);
check('...the new version waits for the owner\'s button', r.ok && r.result.actions.some((a) => a.title === 'List 20 colleges to sell to' && a.status === 'proposed') && !r.result.actions.some((a) => a.id === tk.id), r.result.actions.map((a) => a.title + ':' + a.status));

// ---- measured results become lessons
const rid = act('reorder').id;
await sql`update engine_actions set executed_at = now() - interval '8 days' where id = ${rid}`;
const JR = (await owner('erpBriefRunNow', [])).result.created;
await eng('erpEngineClaim', { runner: 'vps1' });
r = await eng('erpEngineTool', { id: JR, tool: 'brief_results', args: {} });
const m = r.result.moves.find((x) => x.title === 'Reorder the best seller before it runs out');
check('a move whose window has passed is measured (before vs after) for the briefing agent', r.ok && m && m.measured && ['worked', 'no_effect', 'hurt'].includes(m.measured.verdict) && m.measured.days === 7, m);
check('...and becomes a lesson in the business\'s memory', (await sql`select count(*)::int n from engine_facts where business_id = ${B} and kind = 'lesson' and text like 'Move "Reorder the best seller%'`)[0].n === 1, '');
check('...the owner\'s No is there too', r.result.moves.some((x) => x.status === 'rejected' && x.ownerSaid === 'We tried bundles last year'), '');
r = await eng('erpEngineTool', { id: JR, tool: 'brief_save', args: { headline: 'y', actions: good } });
await eng('erpEngineDone', { id: JR, ok: true, result: 'ok' });
r = await owner('erpEngineAsk', [{ ask: 'not a brief', agent: 'seo' }]);
const JS = r.result.created; await eng('erpEngineClaim', { runner: 'vps1' });
r = await eng('erpEngineTool', { id: JS, tool: 'brief_save', args: { headline: 'z', actions: good } });
check('only the briefing agent files briefs', r.ok && /No such function/.test(r.result.error), r.result);
check('the other business has no briefs', (await sql`select count(*)::int n from engine_briefs where business_id = ${FIX.B2}`)[0].n === 0, '');

await done();
