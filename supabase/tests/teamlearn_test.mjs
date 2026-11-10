// learn-1 (owner 10 Nov 2026): the AI salesperson learns how OUR team talks from the Inbox's real team replies, and the
// prompt carries it (manner only - never old prices). Made-up chats only.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const tl = await import(pathToFileURL(path.join(fnDir, 'handlers', 'teamlearn.js')));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';

const asked = [];
let answer = null;
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const b = JSON.parse(opts.body); asked.push(b);
  const sys = (b.systemInstruction && b.systemInstruction.parts[0].text) || '';
  const parts = /study how a Bangladeshi shop/.test(sys) ? [{ text: JSON.stringify(answer) }] : [{ text: 'জি ভাই।' }];
  return { status: 200, body: { candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } };
});
web.on(/graph\.facebook\.com/, () => ({ status: 200, body: { message_id: 'm' } }));

let r = await owner('erpInboxChannelSave', [{ kind: 'messenger', name: 'Page', externalId: 'PAGE9', secrets: { TOKEN: 'tok', APP_SECRET: 'sec' } }]);
const M = (await sql`select * from inbox_channels where id = ${r.result.channels[0].id}`)[0];

// too few: a plain refusal
r = await mgr('erpInboxLearn', [{ action: 'run' }]);
check('learn-1: with too few team replies it says so', !r.ok && /at least 20/.test(r.error || ''), r);

// 30 made-up chats: customer -> our person; plus the page's canned greeting and a phone number
for (let i = 0; i < 30; i++) {
  const c = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name) values (${FIX.B}, ${M.id}, ${'P' + i}, ${'C' + i}) returning *`)[0];
  const v = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id) values (${FIX.B}, ${M.id}, ${c.id}) returning *`)[0];
  const t = Date.now() - (100 - i) * 60e3;
  await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text, created_at) values
    (${FIX.B}, ${v.id}, 'out', 'team', 'text', 'Hi C boss, thanks for contacting us. Please let us know your query', ${new Date(t - 2000)}),
    (${FIX.B}, ${v.id}, 'in', 'customer', 'text', ${'bhai PLA ache? call 01711-000' + String(100 + i)}, ${new Date(t - 1000)}),
    (${FIX.B}, ${v.id}, 'out', 'team', 'text', ${'ji vai ase, kon color lagbe? ' + i}, ${new Date(t)})`;
}
const pairs = await asB((ctx) => tl.teamPairs(ctx, 300));
check('learn-1: the pairs are customer -> our person, the canned greeting left out', pairs.length === 30 && pairs.every((p) => /ji vai ase/.test(p.reply) && !/thanks for contacting/.test(p.reply)), pairs.slice(0, 2));
check('learn-1: phone numbers never reach the AI', pairs.every((p) => !/01711/.test(p.asked) && /\[phone\]/.test(p.asked)), pairs[0]);

r = await sales('erpInboxLearn', [{ action: 'run' }]);
check('learn-1: sales staff cannot run it', !r.ok);
answer = { style: 'They write short Banglish like "ji vai ase", call men vai, ask one question.', examples: [{ customer: 'PLA ache? 01711000111', team: 'ji vai ase, kon color lagbe?' }], habits: ['ask the colour next'] };
asked.length = 0;
r = await mgr('erpInboxLearn', [{ action: 'run' }]);
check('learn-1: a manager runs it: the style, examples and habits are kept, on', r.ok && r.result.learned.on && /ji vai ase/.test(r.result.learned.style) && r.result.learned.examples.length === 1 && r.result.learned.pairs === 30, r);
check('learn-1: a phone in the AI\'s example is scrubbed', /\[phone\]/.test(r.result.learned.examples[0].customer));
check('learn-1: the AI was asked for the manner, not prices', /never include|Do not include phone numbers/.test(asked[0].systemInstruction.parts[0].text) && /ji vai ase/.test(asked[0].contents[0].parts[0].text));

// the reply prompt carries it
const reply = (history) => asB(async (ctx) => ib.agentReply(ctx, { id: null, channel_id: M.id }, { test: true, channel: M, contact: { name: 'X', external_id: 'test' }, history }));
asked.length = 0;
await reply([{ direction: 'in', kind: 'text', text: 'PLA ache?' }]);
const sys = asked[0].systemInstruction.parts[0].text;
check('learn-1: the reply prompt carries how our team talks, with the real examples and the no-old-prices rule',
  /HOW OUR TEAM REALLY TALKS \(learned from 30 real chats/.test(sys) && /NEVER copy a price/.test(sys) && /REAL EXAMPLES FROM OUR TEAM/.test(sys), sys.slice(-900));
check('learn-1: the research rules are in the prompt (match length, honest urgency, anger -> team)', /MATCH THEM/.test(sys) && /never invent "only 2 left"/.test(sys) && /hand the chat to the team/.test(sys));
r = await mgr('erpInboxLearn', [{ action: 'off' }]);
asked.length = 0;
await reply([{ direction: 'in', kind: 'text', text: 'PLA ache?' }]);
check('learn-1: switched off: not in the prompt', r.ok && !r.result.learned.on && !/HOW OUR TEAM REALLY TALKS/.test(asked[0].systemInstruction.parts[0].text));
r = await sales('erpInboxLearn', [{ action: 'get' }]);
check('learn-1: sales staff cannot open it (manager+)', !r.ok);
check('learn-1: the other business learned nothing', !(await sql`select 1 from business_config where business_id = ${FIX.B2} and key = 'inbox_learned'`).length);
done();
