// end-1 (owner 11 Nov 2026): "thanks" -> our goodbye -> "of course" / a like gets no answer; a Messenger name Meta's
// profile call refuses is taken from the page's own conversation, and asked again on a later message. Made-up people only.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, check, done, deps, web, fnDir } from './harness.mjs';

const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const chm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxch.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';

let profileOk = false, convName = 'Karim Hasan';
web.on(/graph\.facebook\.com/, (url) => {
  if (/\/conversations\?/.test(url)) return convName ? { status: 200, body: { data: [{ participants: { data: [{ id: 'PAGE9', name: 'Shop' }, { id: 'PSID1', name: convName }] } }] } } : { status: 200, body: { data: [] } };
  if (/PSID\d\?fields=/.test(url)) return profileOk ? { status: 200, body: { first_name: 'Rafi', last_name: 'Ahmed' } } : { status: 400, body: { error: { message: 'no profile' } } };
  return { status: 200, body: { message_id: 'm1', success: true } };
});
web.on(/generativelanguage\.googleapis\.com/, () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'ভালো থাকবেন ভাই।' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } }));

const ch = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on) values (${FIX.B}, 'messenger', 'Page', 'PAGE9', 'live', true) returning *`)[0];
await asB((ctx) => chm.chSecretSet(ctx, ch, 'TOKEN', 'tok'));
await owner('erpInboxProfile', [{ save: { name: 'Costareen' } }]);

// --- names
let res = await asB((ctx) => ib.ingest(ctx, ch, { type: 'message', from: 'PSID1', text: 'PLA ache?', id: 'a1' }));
let c = (await sql`select * from inbox_contacts where channel_id = ${ch.id} and external_id = 'PSID1'`)[0];
check('end-1: Meta refuses the profile - the name comes from the page\'s conversation', c && c.name === 'Karim Hasan', c);
convName = '';
await asB((ctx) => ib.ingest(ctx, ch, { type: 'message', from: 'PSID2', text: 'hi', id: 'b1' }));
c = (await sql`select * from inbox_contacts where external_id = 'PSID2'`)[0];
check('end-1: no name anywhere - the contact stays nameless', c && !c.name, c);
profileOk = true;
await asB((ctx) => ib.ingest(ctx, ch, { type: 'message', from: 'PSID2', text: 'dam koto?', id: 'b2' }));
c = (await sql`select * from inbox_contacts where external_id = 'PSID2'`)[0];
check('end-1: a later message asks Meta again and keeps the name', c.name === 'Rafi Ahmed', c);

// --- closers
check('end-1: closers are known', ['thanks', 'of course', 'ok vai', 'ধন্যবাদ', 'ঠিক আছে ভাই', '👍', '', 'Thank you!', 'জি আচ্ছা'].every((t) => ib.isCloser(t)));
check('end-1: real questions are not closers', !['ok, 2 ta dao', 'thanks, delivery koto?', 'PLA ache?', 'confirm', 'nibo'].some((t) => ib.isCloser(t)));

const conv = (await sql`select v.* from inbox_conversations v join inbox_contacts c on c.id = v.contact_id where c.external_id = 'PSID1'`)[0];
const say = async (text, id) => { await sql`update inbox_conversations set reply_due_at = null where id = ${conv.id}`; return asB((ctx) => ib.ingest(ctx, ch, { type: 'message', from: 'PSID1', text, id })); };
const ours = async (text) => { await sql`update inbox_conversations set reply_due_at = null where id = ${conv.id}`; await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text, created_at) values (${FIX.B}, ${conv.id}, 'out', 'ai', 'text', ${text}, now() + interval '1 second')`; };

await ours('জি ভাই, ১ কেজি ৳১,৪৫০। কোন কালার নিবেন?');
res = await say('thanks', 'c1');
check('end-1: "thanks" after a normal answer still gets one goodbye', res.dueInMs !== undefined && !res.closed, res);
await ours("You're welcome, bhai! Let me know if you need anything else.");
await new Promise((r) => setTimeout(r, 1100));
res = await say('of course', 'c2');
check('end-1: "of course" after our goodbye gets no answer', res.closed && res.dueInMs === undefined, res);
res = await say('', 'c3');
check('end-1: a like after our goodbye gets no answer', res.closed, res);
res = await say('ar ekta kotha, PETG ache?', 'c4');
check('end-1: a real new question after the goodbye is answered', res.dueInMs !== undefined && !res.closed, res);
await ours('আর কিছু লাগলে জানাবেন?');
await new Promise((r) => setTimeout(r, 1100));
res = await say('ok', 'c5');
check('end-1: "ok" to a question of ours is answered', res.dueInMs !== undefined, res);

// --- the prompt tells the AI to say goodbye and stop
const bodies = [];
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => { bodies.push(JSON.parse(opts.body)); return { status: 200, body: { candidates: [{ content: { parts: [{ text: 'ভালো থাকবেন ভাই।' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } }; });
await asB((ctx) => ib.agentReply(ctx, { id: null, channel_id: ch.id }, { test: true, channel: ch, contact: { name: 'Karim Hasan' }, history: [{ direction: 'in', kind: 'text', text: 'thanks' }] }));
check('end-1: the AI is told to say one short goodbye and stop', bodies.length && /ENDING THE CHAT - only when the chat is really finished/.test(bodies[0].systemInstruction.parts[0].text) && /THANKS IS NOT GOODBYE/.test(bodies[0].systemInstruction.parts[0].text));
done();
