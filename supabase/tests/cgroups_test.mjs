// cgroup-1 (owner 10 Nov 2026): one WhatsApp group per customer, made by the manager's number, welcomed by the AI
// salesperson; group messages from our team pause the AI, other groups are ignored. Made-up numbers only.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const cg = await import(pathToFileURL(path.join(fnDir, 'handlers', 'cgroups.js')));
const chm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxch.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';

const OWN = { boss1: '8801900000652', ai9: '8801900000659' };
const sent = [], made = [];
let inGroup = true;
web.on(/evo\.test/, (url, opts) => {
  const b = opts && opts.body ? JSON.parse(opts.body) : null;
  if (/fetchInstances/.test(url)) { const inst = /instanceName=([^&]+)/.exec(url)[1]; return { status: 200, body: [{ name: inst, ownerJid: OWN[inst] + '@s.whatsapp.net' }] }; }
  if (/group\/create\/boss1/.test(url)) { made.push(b); return { status: 201, body: { id: '1203630000000' + made.length + '@g.us', subject: b.subject } }; }
  if (/group\/participants/.test(url)) return { status: 200, body: { participants: (inGroup ? made[made.length - 1].participants : made[made.length - 1].participants.slice(1)).map((p) => ({ id: p + '@s.whatsapp.net' })) } };
  if (/group\/inviteCode/.test(url)) return { status: 200, body: { inviteUrl: 'https://chat.whatsapp.com/ABC123' } };
  if (/message\/send/.test(url)) { sent.push({ inst: /send\w*\/([^/?]+)/.exec(url)[1], ...b }); return { status: 201, body: { key: { id: 'W' + sent.length } } }; }
  return { status: 200, body: {} };
});
web.on(/generativelanguage\.googleapis\.com/, () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: 'জি ভাই।' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } }));

const mk = async (name, inst, purpose, ago) => {
  const c = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings, created_at) values (${FIX.B}, 'wa_evo', ${name}, ${inst}, 'live', true, ${sql.json({ purpose })}, ${new Date(Date.now() - ago)}) returning *`)[0];
  await asB(async (ctx) => { await chm.chSecretSet(ctx, c, 'URL', 'https://evo.test'); await chm.chSecretSet(ctx, c, 'KEY', 'k'); });
  return c;
};
const BOSS = await mk('WhatsApp', 'boss1', 'collect', 3600e3), AI = await mk('Faujia Alvi', 'ai9', 'chat', 1000);
await owner('erpInboxProfile', [{ save: { name: 'Costareen', agent_name: 'Faujia Alvi (ফাউজিয়া আলভি)', superior_wa: '01900000652', style: 'vai' } }]);

// the list: a WhatsApp chat + invoiced customers; never our own numbers
const k1 = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name, gender) values (${FIX.B}, ${BOSS.id}, '8801711000001', 'Rahim Uddin', 'm') returning *`)[0];
await sql`insert into inbox_contacts (business_id, channel_id, external_id, name) values (${FIX.B}, ${BOSS.id}, '8801900000652', 'Manager')`;
await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, subtotal, grand_total) values (${FIX.B}, 'INV-CG-1', 'Mim Akter', '01712-000002', 100, 100), (${FIX.B}, 'INV-CG-2', 'Old', '01712000003', 100, 100)`;
await sql`update invoices set created_at = now() - interval '400 days' where invoice_no = 'INV-CG-2'`;
let r = await sales('erpCustomerGroups', [{ action: 'get' }]);
check('cgroup-1: sales staff cannot run customer groups', !r.ok);
r = await mgr('erpCustomerGroups', [{ action: 'fill' }]);
const phones = r.result.rows.map((x) => x.phone).sort();
check('cgroup-1: Fill takes the WhatsApp chats and the last 12 months\' invoiced customers, never our own numbers', r.ok && phones.join() === '8801711000001,8801712000002', phones);
r = await owner('erpCustomerGroups', [{ action: 'start' }]);
check('cgroup-1: Start needs the MD\'s WhatsApp first', !r.ok && /MD/.test(r.error || ''));
await owner('erpInboxProfile', [{ save: { team_wa: '01900000070' } }]);

// make one: the manager's number makes it with the customer, the MD and Faujia; Faujia welcomes them
sent.length = 0;
r = await owner('erpCustomerGroups', [{ action: 'make_one' }]);
const g1 = (await sql`select * from customer_groups where phone = '8801711000001'`)[0];
check('cgroup-1: the group is made by the manager\'s number with the customer, the MD and the AI salesperson; the customer\'s name in the subject',
  r.ok && made.length === 1 && made[0].participants.join() === '8801711000001,8801900000070,8801900000659' && made[0].subject === 'Rahim Vai (Costareen)' && g1.status === 'made' && g1.group_jid, [made, g1]);
check('cgroup-1: Faujia\'s number sends the welcome into the group (who she is, orders / invoices here)', sent.length === 1 && sent[0].inst === 'ai9' && sent[0].number === g1.group_jid && /আমি ফাউজিয়া আলভি, Costareen থেকে/.test(sent[0].text) && /invoice/.test(sent[0].text) && /ভাই/.test(sent[0].text), sent);
const gc = (await sql`select * from inbox_contacts where channel_id = ${AI.id} and external_id = ${g1.group_jid}`)[0];
check('cgroup-1: the group is a chat in the Inbox on Faujia\'s number', gc && g1.conversation_id && gc.name === 'Rahim Uddin');

// "only my contacts can add me": the invite link goes to their chat from the manager's number
inGroup = false; sent.length = 0;
r = await owner('erpCustomerGroups', [{ action: 'make_one' }]);
const g2 = (await sql`select * from customer_groups where phone = '8801712000002'`)[0];
check('cgroup-1: when the customer could not be added, the invite link goes to them from the manager\'s number', g2.status === 'invited' && sent.some((s) => s.inst === 'boss1' && s.number === '8801712000002' && /chat\.whatsapp\.com\/ABC123/.test(s.text)), sent);

// group messages
const hook = chm.readHook ? chm.readHook : null;
const evs = chm.readHook('wa_evo', { event: 'messages.upsert', data: { key: { remoteJid: g1.group_jid, participant: '8801711000001@s.whatsapp.net', id: 'G1', fromMe: false }, pushName: 'Rahim', message: { conversation: 'PLA ache?' } } });
check('cgroup-1: a group message is read with the group and the sender', evs.length === 1 && evs[0].group && evs[0].from === g1.group_jid && /8801711000001/.test(evs[0].participant), evs);
let res = await asB((ctx) => ib.ingest(ctx, AI, { ...evs[0] }));
check('cgroup-1: the customer writing in their group gets the AI (an answer is due)', res && res.dueInMs !== undefined, res);
res = await asB((ctx) => ib.ingest(ctx, AI, { type: 'message', from: g1.group_jid, group: true, participant: '8801900000070@s.whatsapp.net', name: 'Hasnat', text: 'ami dekhchi', id: 'G2' }));
const conv = (await sql`select * from inbox_conversations where id = ${g1.conversation_id}`)[0];
check('cgroup-1: our MD writing in the group pauses the AI for 15 minutes (kept as the team\'s message)', res.team && conv.mode === 'human' && conv.human_until && !conv.reply_due_at &&
  (await sql`select 1 from inbox_messages where conversation_id = ${conv.id} and author = 'team' and text = 'ami dekhchi'`).length === 1);
res = await asB((ctx) => ib.ingest(ctx, AI, { type: 'message', from: '120363999@g.us', group: true, participant: '8801555000000', text: 'supplier group', id: 'G3' }));
check('cgroup-1: any other group (a supplier\'s) is ignored - no chat', res.ignored && !(await sql`select 1 from inbox_contacts where external_id = '120363999@g.us'`).length);
res = await asB((ctx) => ib.ingest(ctx, BOSS, { type: 'message', from: g1.group_jid, group: true, participant: '8801711000001', text: 'PLA ache?', id: 'G4' }));
check('cgroup-1: the manager\'s number does not answer in the group (only Faujia\'s)', res.ignored);

// the AI in the group: told it is the customer's group; the order receipt carries the shop's note
const reply = (history) => asB(async (ctx) => ib.agentReply(ctx, { id: null, channel_id: AI.id }, { test: true, channel: AI, contact: { name: 'Rahim Uddin', external_id: g1.group_jid, gender: 'm' }, history }));
const bodies = [];
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => { bodies.push(JSON.parse(opts.body)); return { status: 200, body: { candidates: [{ content: { parts: [{ text: 'জি ভাই।' }] } }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } } }; });
await reply([{ direction: 'in', kind: 'text', text: 'PLA ache?' }]);
check('cgroup-1: the AI knows it is the customer\'s own group with our team and follows the team', /OWN WHATSAPP GROUP with our team/.test(bodies[0].systemInstruction.parts[0].text));
check('cgroup-1: the group note text (as the supplier\'s group)', /সম্মানিত গ্রাহক/.test(cg.groupNotice()) && /আলাদা ডেলিভারি চার্জ/.test(cg.groupNotice()));
check('cgroup-1: subject for a woman is "Apu", titles dropped', cg.subjectFor('Mst. Mim Akter', 'f', 'Costareen') === 'Mim Apu (Costareen)');

// the timer: off by default; on: makes one when it is time, stops after three failures
r = await asB((ctx) => cg.cgTick(ctx));
check('cgroup-1: the timer does nothing until Start', r.off);
r = await mgr('erpCustomerGroups', [{ action: 'start' }]);
check('cgroup-1: a manager cannot start it', !r.ok);
r = await owner('erpCustomerGroups', [{ action: 'start' }]);
check('cgroup-1: Start switches it on', r.ok && r.result.on, r);
r = await mgr('erpCustomerGroups', [{ action: 'skip', id: (await sql`select id from customer_groups where status = 'queued' limit 1`)[0]?.id || null }]);
check('cgroup-1: the other business has no groups', !(await sql`select 1 from customer_groups where business_id = ${FIX.B2}`).length);
done();
