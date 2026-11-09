// distill-ai (9 Nov 2026): the Ask-your-ERP assistant addresses the person as আপনি in its instructions, and its
// refusals (no key, the day's allowance, an empty message) come in Bangla when the person wrote Bangla and in
// English otherwise. Nothing else about the assistant changes (assistant_test.mjs still covers the tools).
import { sql, FIX, owner, mgr, check, done, deps, web } from './harness.mjs';

let lastBody = null;
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  lastBody = JSON.parse(opts.body);
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: 'ঠিক আছে।' }] } }] } };
});

// 1. no key: the refusal follows the person's language
deps.geminiKey = '';
let r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'আজকের বিক্রি?' }] }]);
check('no key, asked in Bangla: a Bangla refusal that names Settings › AI', !r.ok && /AI চালু নেই/.test(r.error) && /সেটিংস/.test(r.error), r);
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'sales today?' }] }]);
check('no key, asked in English: the English refusal as before', !r.ok && /not set up/.test(r.error), r);
deps.geminiKey = 'k';

// 2. the system text carries the আপনি rule and the প্রোডাক্ট word
r = await owner('erpAssistant', [{ messages: [{ role: 'user', text: 'কার কাছে টাকা পাওনা?' }] }]);
const sys = lastBody && ((lastBody.systemInstruction || lastBody.system_instruction || {}).parts || []).map((p) => p.text || '').join('\n');
check('the answer came through the model', r.ok && r.result.text === 'ঠিক আছে।', r);
check('the instructions say আপনি, never the familiar form, and প্রোডাক্ট', /আপনি/.test(sys) && /করুন, দিন, দেখুন/.test(sys) && /প্রোডাক্ট/.test(sys) && /never the familiar form/.test(sys), (sys || '').slice(0, 400));
check('the instructions still say to answer in the person\'s language', /language the person writes/.test(sys), '');

// 3. an empty message
r = await owner('erpAssistant', [{ messages: [{ role: 'assistant', text: 'আগের উত্তর' }] }]);
check('no question, Bangla context: "আগে কিছু লিখুন"', !r.ok && /আগে কিছু লিখুন/.test(r.error), r);
r = await owner('erpAssistant', [{ messages: [{ role: 'assistant', text: 'earlier answer' }] }]);
check('no question, English context: "Say something first"', !r.ok && /Say something first/.test(r.error), r);

// 4. the day's allowance
await sql`update business_config set value = '300' where business_id = ${FIX.B} and key like 'ai_chat:%'`;   // the row exists since step 2
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'হ্যালো' }] }]);
check('allowance used up, Bangla: says 300 questions are done for today, back tomorrow', !r.ok && /আজকের 300টা প্রশ্ন শেষ/.test(r.error) && /কাল/.test(r.error), r);
r = await mgr('erpAssistant', [{ messages: [{ role: 'user', text: 'hello' }] }]);
check('allowance used up, English: the old wording', !r.ok && /allowance/.test(r.error), r);
check('the other business is untouched', (await sql`select count(*)::int n from business_config where business_id = ${FIX.B2} and key like 'ai_chat:%'`)[0].n === 0, '');
deps.geminiKey = '';
await done();
