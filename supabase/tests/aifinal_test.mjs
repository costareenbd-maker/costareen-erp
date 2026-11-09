// final-ai (10 Nov 2026): the AI area's last pass.
//   - Ask your ERP keeps the conversation on the server per person and business (every device), clears it on request,
//     and a failed AI call ends in one plain sentence - never a status line or a stack - and does not use up a turn;
//   - Business Brain facts can be edited (the old wording is struck out with the reason, never deleted) and a struck-out
//     fact can be brought back; the struck-out list comes with the Brain;
//   - a business may hold its own AI key (used before the platform's) - the owner or a shareholder sets it, the other
//     business never sees it;
//   - the daily brief: a seeded brief comes back with its moves, one Approve runs a move, a second answer is refused,
//     the default hour is 20:00 Dhaka;
//   - the sales role reaches none of the owner's AI calls.
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done, deps, web } from './harness.mjs';

const B = FIX.B, B2 = FIX.B2;
await sql`insert into erp_app_flags (key, enabled) values ('engine', true) on conflict (key) do update set enabled = true`;

// ---------------------------------------------------------------- the chat: one conversation on every device
let mode = 'ok';
web.on(/generativelanguage\.googleapis\.com/, () => {
  if (mode === 'down') return { status: 500, body: { error: { message: 'Internal error encountered.' } } };
  if (mode === 'garbage') return { status: 200, body: 'this is not json at all {{' };
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: 'আজকের বিক্রি ৳১২,৫০০।' }] } }] } };
});
deps.geminiKey = '';
let r = await mgr('erpChatHistory', []);
check('history: empty to start, and it says no AI is set up', r.ok && Array.isArray(r.result.messages) && r.result.messages.length === 0 && r.result.ai === false, r);
deps.geminiKey = 'k';
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'আজকের বিক্রি?' }] }]);
check('the manager asks and gets the answer', r.ok && /১২,৫০০/.test(r.result.text), r);
r = await mgr('erpChatHistory', []);
check('the question and the answer are kept on the server for the manager', r.ok && r.result.messages.length === 2 && r.result.messages[0].role === 'user' && r.result.messages[1].role === 'assistant' && r.result.left === 299, r.result);
r = await sales('erpChatHistory', []);
check('another person has their own, empty conversation', r.ok && r.result.messages.length === 0, r.result);
check('the other business has no chat rows', (await sql`select count(*)::int n from business_config where business_id = ${B2} and key like 'ai_chat%'`)[0].n === 0, '');

// a failed AI call: one plain sentence, the turn not counted
const before = (await sql`select value from business_config where business_id = ${B} and key like 'ai_chat:%' and key not like 'ai_chat_hist%'`)[0].value;
mode = 'down';
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'who owes money?' }] }]);
check('the AI is down: a plain English sentence with Try again, no "500", no stack', !r.ok && /try again/i.test(r.error) && !/500|Internal|at /.test(r.error) && r.error.length < 160, r);
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'কার কাছে টাকা পাওনা?' }] }]);
check('...and in Bangla when the person wrote Bangla', !r.ok && /আবার চেষ্টা করুন/.test(r.error) && !/500/.test(r.error), r);
const after = (await sql`select value from business_config where business_id = ${B} and key like 'ai_chat:%' and key not like 'ai_chat_hist%'`)[0].value;
check('a failed turn is not counted against the day\'s 300', before === after, before + ' -> ' + after);
r = await mgr('erpChatHistory', []);
check('a failed turn is not written into the conversation either', r.ok && r.result.messages.length === 2, r.result.messages.length);
mode = 'garbage';
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'sales today?' }] }]);
check('an unreadable answer from the model: a plain sentence too', !r.ok && !/token|JSON|parse|\{/.test(r.error) && r.error.length < 160, r);
mode = 'ok';
r = await mgr('erpAssistant', [{ confirm: { tool: 'nothing-like-this', args: {} } }]);
check('a confirm with nothing behind it keeps its short plain refusal', !r.ok && /Nothing to confirm/.test(r.error), r);
r = await mgr('erpChatClear', []);
check('Start a new chat clears it on the server', r.ok && (await mgr('erpChatHistory', [])).result.messages.length === 0, r);

// ---------------------------------------------------------------- Business Brain: facts edited, struck out, brought back
r = await owner('erpBrainFact', [{ add: { kind: 'fact', text: 'Schools buy in January and July.' } }]);
check('the owner adds a fact', r.ok && r.result.facts.some((f) => /Schools buy/.test(f.text)), r);
const fid = r.result.facts.find((f) => /Schools buy/.test(f.text)).id;
r = await owner('erpBrainFact', [{ edit: fid, text: 'Schools buy in January, July and before Eid.' }]);
check('Edit: the new wording is in the list, the old one struck out with the reason', r.ok && r.result.facts.some((f) => /before Eid/.test(f.text)) && !r.result.facts.some((f) => f.id === fid) &&
  r.result.oldList.length === 1 && r.result.oldList[0].id === fid && /Edited by/.test(r.result.oldList[0].why) && r.result.oldFacts === 1, r.result && r.result.oldList);
check('...nothing deleted: both rows are in the table', (await sql`select count(*)::int n from engine_facts where business_id = ${B} and text ilike 'Schools buy%'`)[0].n === 2, '');
r = await owner('erpBrainFact', [{ edit: fid, text: 'anything' }]);
check('editing a struck-out fact is refused plainly', !r.ok && /not there/.test(r.error), r);
r = await owner('erpBrainFact', [{ restore: fid }]);
check('Bring back: the struck-out fact is in the list again, the struck-out list empty', r.ok && r.result.facts.some((f) => f.id === fid) && r.result.oldList.length === 0, r.result && r.result.oldList);
r = await owner('erpBrainFact', [{ restore: fid }]);
check('bringing back a fact that is not struck out is refused', !r.ok && /not struck out/.test(r.error), r);
r = await owner('erpBrainFact', [{ edit: fid, text: 'abc' }]);
check('an edit needs words', !r.ok && /Write the fact/.test(r.error), r);
r = await mgr('erpBrainFact', [{ restore: fid }]);
check('a manager does not touch the Brain', !r.ok, r);
r = await owner('erpBrainFact', [{}]);
check('an empty request is refused with the four choices', !r.ok && /Add, edit, strike out or bring back/.test(r.error), r);

// ---------------------------------------------------------------- the business's own AI key
await makeShareholder();
const isAdmin = !!((await owner('erpAiBrain', [])).result || {}).platformKeys;
r = await shareholder('erpAiBrain', []);
check('the AI models screen says whose keys they are (the platform\'s Gemini test key here)', r.ok && r.result.canSetKeys === true && r.result.providers.find((p) => p.key === 'gemini').scope === 'platform', r.result && r.result.providers);
r = await shareholder('erpAiBrainKey', [{ provider: 'openai', key: 'not-a-key' }]);
check('a key that is not an OpenAI key is refused', !r.ok && /does not look like/.test(r.error), r);
r = await shareholder('erpAiBrainKey', [{ provider: 'openai', key: 'sk-business-own-key-0000-wxyz' }]);
check('a shareholder saves this business\'s own ChatGPT key: set, scope business, last 4 shown', r.ok && r.result.providers.find((p) => p.key === 'openai').set && r.result.providers.find((p) => p.key === 'openai').scope === 'business' && r.result.providers.find((p) => p.key === 'openai').last4 === 'wxyz', r.result && r.result.providers);
check('...kept in the business\'s own secrets, not in the platform\'s', (await sql`select count(*)::int n from business_secrets where business_id = ${B} and key = 'AI_OPENAI_KEY'`)[0].n === 1 &&
  (await sql`select count(*)::int n from erp_provider_secrets where key = 'OPENAI_KEY'`)[0].n === 0, '');
check('the other business has no key', (await sql`select count(*)::int n from business_secrets where business_id = ${B2} and key like 'AI_%'`)[0].n === 0, '');
r = await shareholder('erpAiBrainKey', [{ provider: 'openai', key: '', remove: true }]);
check('Remove takes the business key away again', r.ok && !r.result.providers.find((p) => p.key === 'openai').set, r.result && r.result.providers);
r = await shareholder('erpAiBrainKey', [{ provider: 'custom', key: 'own-vps-secret-1234567890', base: 'not a url' }]);
check('a custom server address must be a URL', !r.ok && /https/.test(r.error), r);
r = await mgr('erpAiBrainKey', [{ provider: 'openai', key: 'sk-business-own-key-0000-wxyz' }]);
check('a manager cannot set keys', !r.ok, r);
check('(platform admin in this fixture: ' + isAdmin + ')', true, '');

// ---------------------------------------------------------------- the daily brief: seeded, answered once
r = await owner('erpBrief', [{}]);
check('the brief screen opens with no brief yet and the 20:00 default hour', r.ok && r.result.brief === null && r.result.schedule && r.result.schedule.at === '20:00' && r.result.schedule.enabled, r.result && r.result.schedule);
const job = (await sql`insert into engine_jobs (business_id, agent, title, ask, source, created_by, status, finished_at) values (${B}, 'briefing', 'Daily brief', 'test', 'brief', 'test', 'done', now()) returning id`)[0].id;
const day = new Date().toISOString().slice(0, 10);
const brief = (await sql`insert into engine_briefs (business_id, day, job_id, scoreboard, headline, changes, risks, opportunities, results_note)
  values (${B}, ${day}, ${job}, '{}', 'Sales up 12%, cash fine', '[{"text":"PLA sold well"}]', '[]', '[]', '') returning id`)[0].id;
const mk = (no, type, title, payload) => sql`insert into engine_actions (business_id, brief_id, job_id, no, big_bet, type, title, why, figures, impact_bdt, cost_bdt, risk, confidence, payload, metric)
  values (${B}, ${brief}, ${job}, ${no}, false, ${type}, ${title}, 'because', '[{"label":"Sales","value":"12","source":"sales_day"}]', 5000, 0, 'low', 0.8, ${sql.json(payload)}, '{"kind":"none"}') returning id`;
const a1 = (await mk(1, 'followup', 'Call Karim about the printer', { items: [{ phone: '01712345678', due: day, note: 'Ask about the printer' }] }))[0].id;
const a2 = (await mk(2, 'manual', 'Renew the domain', { todo: '1. Log in to the registrar\n2. Pay' }))[0].id;
r = await owner('erpBrief', [{}]);
check('the seeded brief comes back with its two moves, both proposed', r.ok && r.result.brief && r.result.brief.headline === 'Sales up 12%, cash fine' && r.result.actions.length === 2 && r.result.actions.every((a) => a.status === 'proposed'), r.result && r.result.actions);
r = await owner('erpBriefDecide', [{ id: a1, act: 'approve' }]);
const d1 = r.ok && r.result.actions.find((a) => a.id === a1);
check('ONE Approve runs the move (follow-up calls on the list) and records the result', r.ok && d1 && d1.status === 'done' && d1.decidedBy, d1);
check('...the follow-up really exists', (await sql`select count(*)::int n from customer_followups where business_id = ${B} and note ilike '%Ask about the printer%'`)[0].n >= 1, '');
r = await owner('erpBriefDecide', [{ id: a1, act: 'approve' }]);
check('a second tap on the same move is refused: already answered', !r.ok && /already answered/.test(r.error), r);
r = await owner('erpBriefDecide', [{ id: a2, act: 'reject', note: 'I did it last week' }]);
const d2 = r.ok && r.result.actions.find((a) => a.id === a2);
check('No keeps the move with the owner\'s reason and teaches the Brain', r.ok && d2 && d2.status === 'rejected' && d2.note === 'I did it last week' &&
  (await sql`select count(*)::int n from engine_facts where business_id = ${B} and text ilike '%said NO to the move%Renew the domain%'`)[0].n === 1, d2);
r = await owner('erpBriefDecide', [{ id: a2, act: 'change', note: 'x' }]);
check('answering an answered move another way is refused too', !r.ok, r);
r = await owner('erpBriefSettings', [{ at: '7:30' }]);
check('the brief hour is the owner\'s to change (07:30)', r.ok && r.result.schedule.at === '07:30', r.result && r.result.schedule);
r = await owner('erpBriefSettings', [{ at: '25:00' }]);
check('a wrong time is refused plainly', !r.ok && /like 20:00/.test(r.error), r);
check('the other business has no brief', (await sql`select count(*)::int n from engine_briefs where business_id = ${B2}`)[0].n === 0, '');

// ---------------------------------------------------------------- the sales role and the owner's AI
for (const name of ['erpBrief', 'erpBriefDecide', 'erpBriefRunNow', 'erpEngine', 'erpEngineAsk', 'erpWatch', 'erpBrain', 'erpBrainFact', 'erpSkills', 'erpSeo', 'erpAiBrain', 'erpAiBrainKey', 'erpBrandDesk']) {
  r = await sales(name, [{}]);
  check('sales cannot reach ' + name, !r.ok, r);
}
r = await sales('erpChatHistory', []);
check('...but sales do have the chat (their own conversation)', r.ok, r);

deps.geminiKey = '';
await done();
