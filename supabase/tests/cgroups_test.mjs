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
check('cgroup-2: the MANAGER\'s number greets the group (why it is open), kept as the team\'s message', sent.length === 1 && sent[0].inst === 'boss1' && sent[0].number === g1.group_jid && /ম্যানেজার/.test(sent[0].text) && / ভাই/.test(sent[0].text), sent);
const gc = (await sql`select * from inbox_contacts where channel_id = ${AI.id} and external_id = ${g1.group_jid}`)[0];
check('cgroup-1: the group is a chat in the Inbox on Faujia\'s number', gc && g1.conversation_id && gc.name === 'Rahim Uddin');

// "only my contacts can add me": the invite link goes to their chat from the manager's number
inGroup = false; sent.length = 0;
r = await owner('erpCustomerGroups', [{ action: 'make_one' }]);
const g2 = (await sql`select * from customer_groups where phone = '8801712000002'`)[0];
check('cgroup-1: when the customer could not be added, the invite link goes to them from Alvi\'s number (mgr-quiet-1)', g2.status === 'invited' && sent.some((s) => s.inst === 'ai9' && s.number === '8801712000002' && /chat\.whatsapp\.com\/ABC123/.test(s.text)) && !sent.some((s) => s.inst === 'boss1' && s.number === '8801712000002'), sent);

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
// ---- cgroup-2: never the owner; only after a purchase; the manager greets, then the invoice
await owner('erpInboxProfile', [{ save: { team_wa: '01900000070, +82 10-0000-1111', cg_welcome: 'আসসালামু আলাইকুম{salute}\nআমি মেহেদী (test).', cg_welcome_buy: 'আসসালামু আলাইকুম{salute}\nধন্যবাদ (test). নিচে ইনভয়েস।' } }]);
r = await owner('erpCustomerGroups', [{ action: 'after_purchase' }]);
check('cgroup-2: "after purchase" mode is set (on, since now)', r.ok && r.result.on && r.result.mode === 'purchase' && r.result.since, r);
const prof = await asB(async (ctx) => ib.profile(ctx, false));
let t2 = await asB(async (ctx) => cg.purchaseTick(ctx, prof, true));
check('cgroup-2: no purchase since - no group (the old list is not worked)', t2.waiting === 'no new buyer', t2);
await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, subtotal, grand_total) values (${FIX.B}, 'INV-CG-9', 'Karim Hasan', '01713-000009', 500, 500)`;
made.length = 0; sent.length = 0; inGroup = true;
t2 = await asB(async (ctx) => cg.purchaseTick(ctx, prof, true));
const g9 = (await sql`select * from customer_groups where phone = '8801713000009'`)[0];
check('cgroup-2: a buyer gets a group: the customer, the MD and Alvi - NOT the owner\'s number', t2.made && made.length === 1 && made[0].participants.join() === '8801713000009,8801900000070,8801900000659' && g9.source === 'purchase' && g9.invoice_no === 'INV-CG-9', [t2, made, g9]);
check('cgroup-2: the manager greets with the purchase text', sent.length >= 1 && sent[0].inst === 'boss1' && sent[0].number === g9.group_jid && /ধন্যবাদ \(test\)/.test(sent[0].text), sent);
check('cgroup-2: the greeting is in the group\'s Inbox chat as the team\'s message', g9 && (await sql`select 1 from inbox_messages where conversation_id = ${g9.conversation_id} and author = 'team' and text like '%ধন্যবাদ (test)%'`).length === 1);
check('cgroup-2: no invoice PDF stored here: a note says send it by hand (never a crash)', g9 && (await sql`select 1 from inbox_messages where conversation_id = ${g9.conversation_id} and direction = 'note' and text like '%INV-CG-9%'`).length === 1);
t2 = await asB(async (ctx) => cg.purchaseTick(ctx, prof, true));
check('cgroup-2: the same buyer is not grouped twice', t2.waiting === 'no new buyer' && made.length === 1, t2);
// greet the groups made before, once
sent.length = 0;
r = await owner('erpCustomerGroups', [{ action: 'greet_all' }]);
const greeted = sent.filter((x) => x.inst === 'boss1' && /মেহেদী \(test\)/.test(x.text));
check('cgroup-2: greet_all: the manager\'s greeting once in every group made before', r.ok && greeted.length >= 1 && greeted.every((x) => /@g\.us$/.test(x.number)), [r.result && r.result.note, sent]);
sent.length = 0;
r = await owner('erpCustomerGroups', [{ action: 'greet_all' }]);
check('cgroup-2: greet_all again sends nothing new', r.ok && !sent.length, sent);
check('cgroup-2: no salute when the gender is unknown', cg.managerWelcome({ cg_welcome: 'আসসালামু আলাইকুম{salute}' }, null, false) === 'আসসালামু আলাইকুম' && cg.managerWelcome({ cg_welcome: 'হাই{salute}' }, 'f', false) === 'হাই আপু');
// ---- mgr-quiet-1: the manager's number sends nothing automatic - Alvi does; a person may still press Send on it
const sp = await import(pathToFileURL(path.join(fnDir, 'handlers', 'superior.js')));
const kB = (await sql`select * from inbox_contacts where channel_id = ${BOSS.id} and external_id = '8801711000001'`)[0];
const vB = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id) values (${FIX.B}, ${BOSS.id}, ${kB.id}) on conflict (contact_id) do update set channel_id = excluded.channel_id returning *`)[0];
for (const author of ['system', 'ai', 'team']) {
  sent.length = 0;
  const rr = await asB(async (ctx) => ib.deliver(ctx, BOSS, vB, kB, { kind: 'text', text: 'auto ' + author }, { author, userName: 'Timer' }));
  check('mgr-quiet-1: an automatic message (' + author + ') on the manager\'s number goes from Alvi\'s number instead', rr.ok && sent.length === 1 && sent[0].inst === 'ai9' && sent[0].number === '8801711000001' && sent[0].text === 'auto ' + author, [rr, sent]);
}
check('mgr-quiet-1: the manager\'s chat gets a note that Alvi sent it', (await sql`select count(*)::int n from inbox_messages where conversation_id = ${vB.id} and direction = 'note' and text like '%sends nothing automatic%'`)[0].n === 3);
check('mgr-quiet-1: ...and the message is in Alvi\'s chat with that person', (await sql`select 1 from inbox_messages m join inbox_conversations v on v.id = m.conversation_id join inbox_contacts c on c.id = v.contact_id where c.channel_id = ${AI.id} and c.external_id = '8801711000001' and m.text = 'auto system'`).length === 1);
sent.length = 0;
r = await owner('erpInboxSend', [{ id: vB.id, text: 'Mehedi nije likhche' }]);
check('mgr-quiet-1: a person pressing Send on the manager\'s chat still sends from the manager\'s number', r.ok && sent.length === 1 && sent[0].inst === 'boss1' && sent[0].text === 'Mehedi nije likhche', [r.error, sent]);
sent.length = 0;
const hq = await asB(async (ctx) => sp.superiorInbound(ctx, BOSS, { from: '8801900000070', text: 'aj sale koto?' }));
check('mgr-quiet-1: the MD writing to the manager\'s number gets no automatic answer from it', hq === true && !sent.length, sent);
done();
