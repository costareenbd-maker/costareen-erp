// Several WhatsApp numbers (handlers/wanumbers.js, the job gate in handlers/inbox.js ingest) and one photo per person
// (wa-avatar-2, inbox.js sameAvatar): making a number on the business's Evolution server, its webhook and QR, linked /
// not linked and the number learnt, jobs (send / collect answer nobody), removing (an ERP-made instance is deleted, the
// shop's own instance is left alone), roles, and the photo shared by phone across channels.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const { custKey } = await import(pathToFileURL(path.join(fnDir, 'lib', 'phone.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.hookBase = 'https://fn.test/functions/v1/erp';

// ---- the fake Evolution server
const evo = []; let linked = false;
web.on(/wa\.test/, (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  evo.push({ url, method: opts.method, key: opts.headers && opts.headers.apikey, body });
  if (/\/instance\/create$/.test(url)) return { status: 201, body: { instance: { instanceName: body.instanceName }, hash: 'TOK-' + body.instanceName, qrcode: { base64: 'data:image/png;base64,QRQR' } } };
  if (/connectionState/.test(url)) return { status: 200, body: { instance: { state: linked ? 'open' : 'close' } } };
  if (/fetchInstances/.test(url)) return { status: 200, body: [{ ownerJid: '8801700000009@s.whatsapp.net' }] };
  if (/fetchProfilePictureUrl/.test(url)) return { status: 200, body: {} };
  return { status: 200, body: {} };
});
const chRow = async (id) => (await sql`select * from inbox_channels where id = ${id}`)[0];

// ---- 1. no server yet
let r = await owner('erpWaNumbers', []);
check('the list opens with no number and says the server is not set', r.ok && r.result.numbers.length === 0 && r.result.serverReady === false && r.result.purposes.length === 3, r);
r = await owner('erpWaNumberAdd', [{ name: 'Bills', purpose: 'send', acceptRisk: true }]);
check('without the server a number cannot be made', !r.ok && /server is not set up/.test(r.error), r);
await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, 'WA_SERVER_URL', 'https://wa.test'), (${FIX.B}, 'WA_SERVER_KEY', 'GLOBAL')`;

// ---- 2. making numbers
r = await sales('erpWaNumberAdd', [{ name: 'Bills', purpose: 'send', acceptRisk: true }]);
check('sales staff cannot add a number', !r.ok, r);
r = await owner('erpWaNumberAdd', [{ name: 'Bills', purpose: 'send' }]);
check('the ban notice must be accepted', !r.ok && /notice/.test(r.error), r);
r = await owner('erpWaNumberAdd', [{ name: '', purpose: 'send', acceptRisk: true }]);
check('a number needs a name', !r.ok, r);
r = await owner('erpWaNumberAdd', [{ name: 'Bills', purpose: 'send', acceptRisk: true }]);
check('a number is made on the server with the main key', r.ok && evo.some((x) => /\/instance\/create$/.test(x.url) && x.key === 'GLOBAL' && /^erp-bills-/.test(x.body.instanceName)), r);
const billsId = r.result.id;
check('the QR code comes back to scan', r.result.qr === 'data:image/png;base64,QRQR', r.result.qr);
const bills = await chRow(billsId);
check('its webhook points at the ERP with the number\'s own token', r.result.hooked && evo.some((x) => /webhook\/set\/erp-bills-/.test(x.url) && x.key === 'TOK-' + bills.external_id && /inbox=hook&ch=/.test(x.body.webhook.url)));
const sec = await sql`select key, value from business_secrets where business_id = ${FIX.B} and key like ${'INBOX_' + billsId + '_%'}`;
check('the number keeps its own token, never the main key', sec.find((x) => /_KEY$/.test(x.key)).value === 'TOK-' + bills.external_id, sec);
check('a sending number has the AI off and its job saved', bills.ai_on === false && bills.settings.purpose === 'send' && bills.settings.erp_made === true && bills.status === 'live', bills);
check('the main key is never in the answer', !JSON.stringify(r.result).includes('GLOBAL'), r.result);
r = await owner('erpWaNumberAdd', [{ name: 'Support', purpose: 'chat', acceptRisk: true }]);
const supId = r.result.id;
check('a second number for customer chat, AI on', r.ok && (await chRow(supId)).ai_on === true && r.result.numbers.length === 2, r);

// ---- 3. linked or not; the number learnt
r = await mgr('erpWaNumbers', []);
check('a manager sees the numbers, not linked yet', r.ok && r.result.numbers.every((n) => !n.linked && !n.number), r);
linked = true;
r = await owner('erpWaNumbers', []);
check('once the phone is linked the number shows', r.ok && r.result.numbers.every((n) => n.linked && n.number === '+8801700000009'), r);
check('the number is kept', (await chRow(supId)).settings.number === '8801700000009');

// ---- 4. jobs: a sending number keeps messages and answers nobody
const msg = (id, from, text) => JSON.stringify({ event: 'messages.upsert', data: { key: { remoteJid: from + '@s.whatsapp.net', fromMe: false, id }, pushName: 'Nadia', message: { conversation: text } } });
let h = await asB(async (ctx) => ib.hookPost(ctx, await chRow(billsId), msg('B1', '8801999000111', 'bill pelam?'), {}));
const kept = (await sql`select count(*)::int n from inbox_messages m join inbox_conversations v on v.id = m.conversation_id where v.channel_id = ${billsId}`)[0].n;
check('a sending number keeps the message and nothing is due to answer', h.due.length === 0 && kept === 1, h);
check('and no task waits for the team', (await sql`select count(*)::int n from inbox_tasks t join inbox_conversations v on v.id = t.conversation_id where v.channel_id = ${billsId}`)[0].n === 0);
h = await asB(async (ctx) => ib.hookPost(ctx, await chRow(supId), msg('S1', '8801999000222', 'printer ache?'), {}));
check('the customer-chat number is answered as before', h.due.length === 1, h);
r = await owner('erpWaNumberSet', [{ id: supId, purpose: 'collect' }]);
check('changing the job to Collect data turns its AI off', r.ok && (await chRow(supId)).ai_on === false && r.result.numbers.find((n) => n.id === supId).purpose === 'collect', r);
r = await owner('erpWaNumberSet', [{ id: supId, purpose: 'nonsense' }]);
check('an unknown job is refused', !r.ok, r);
r = await sales('erpWaNumberSet', [{ id: supId, purpose: 'chat' }]);
check('sales staff cannot change a job', !r.ok, r);

// ---- 5. removing: an ERP-made number is deleted on the server; the shop's own instance is never touched
evo.length = 0;
r = await owner('erpWaNumberRemove', [{ id: billsId }]);
check('removing an ERP-made number logs it out and deletes it on the server', r.ok && evo.some((x) => /instance\/delete\/erp-bills-/.test(x.url) && x.method === 'DELETE') && (await chRow(billsId)).status === 'removed', evo.map((x) => x.url));
check('its secrets are wiped', (await sql`select count(*)::int n from business_secrets where business_id = ${FIX.B} and key like ${'INBOX_' + billsId + '_%'}`)[0].n === 0);
const shop = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on) values (${FIX.B}, 'wa_evo', 'Shop', 'costareen', 'live', true) returning *`)[0];
evo.length = 0;
r = await owner('erpWaNumberRemove', [{ id: shop.id }]);
check('a number the ERP did not make is only taken out of the Inbox', r.ok && !evo.some((x) => /instance\/(delete|logout)/.test(x.url)) && (await chRow(shop.id)).status === 'removed', evo.map((x) => x.url));

// ---- 6. one person, one photo: a Messenger contact with the same phone shows the WhatsApp photo
const key = custKey('01999000222', 'Nadia');
const wa = (await sql`select k.* from inbox_contacts k join inbox_conversations v on v.contact_id = k.id where v.channel_id = ${supId}`)[0];
await sql`update inbox_contacts set avatar = 'file:avatar-x.jpg', customer_key = ${key} where id = ${wa.id}`;
const fb = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status) values (${FIX.B}, 'messenger', 'Page', 'PAGEX', 'live') returning *`)[0];
const fbc = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name, customer_key) values (${FIX.B}, ${fb.id}, 'PSIDX', 'Nadia FB', ${key}) returning *`)[0];
await sql`insert into inbox_conversations (business_id, channel_id, contact_id, interest, last_at, last_text) values (${FIX.B}, ${fb.id}, ${fbc.id}, 'cold', now(), 'hi')`;
r = await owner('erpInbox', [{ pile: 'open' }]);
const row = r.ok && r.result.list.find((x) => x.name === 'Nadia FB');
check('the Messenger chat shows the WhatsApp photo of the same phone', row && /avatar-x\.jpg/.test(row.avatar), row);
const other = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name) values (${FIX.B}, ${fb.id}, 'PSIDY', 'Stranger') returning *`)[0];
await sql`insert into inbox_conversations (business_id, channel_id, contact_id, interest, last_at, last_text) values (${FIX.B}, ${fb.id}, ${other.id}, 'cold', now(), 'yo')`;
r = await owner('erpInbox', [{ pile: 'open' }]);
const row2 = r.ok && r.result.list.find((x) => x.name === 'Stranger');
check('someone with no phone match gets no borrowed photo', row2 && !row2.avatar, row2);

done();
