// flow-3 + boss-1 (owner 10 Nov 2026): the read-back before an order is one neat message (name / phone / address on
// their own lines, items numbered); a bigger discount or a doubt goes to the manager on WhatsApp from the salesperson's
// own number, and the manager's "#R1 ..." answer is told to the customer (an agreed price is used by the order).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, check, done, deps, web, fnDir } from './harness.mjs';

const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const sp = await import(pathToFileURL(path.join(fnDir, 'handlers', 'superior.js')));
const chm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxch.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';

let script = [];
const bodies = [];
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const b = JSON.parse(opts.body); bodies.push(b);
  const next = script.shift();
  const parts = !next ? [{ text: 'OK.' }] : typeof next === 'function' ? next(b) : next;
  return { status: 200, body: { candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } } };
});
const wa = [];
web.on(/evo\.test/, (url, opts) => { if (/message\/send/.test(url)) wa.push({ url, ...JSON.parse(opts.body) }); return { status: 201, body: { key: { id: 'W' + wa.length } } }; });
web.on(/graph\.facebook\.com/, () => ({ status: 200, body: { message_id: 'm' } }));

await sql`insert into products (business_id, sku, name, category, brand, type, color, cost_price, sell_price) values (${FIX.B}, 'FIL-BOSS-1', 'Testa PLA Black 1kg', 'Filaments', 'Testa', 'PLA', 'Black', 900, 1600)`;
const pr = (await sql`select id from products where business_id = ${FIX.B} and sku = 'FIL-BOSS-1'`)[0];
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${FIX.B}, ${pr.id}, 'RECEIVE', 'IN', 50)`;
await owner('erpInboxProfile', [{ save: { name: 'Testa', style: 'vai', agent_name: 'Faujia Alvi (ফাউজিয়া আলভি)', superior_wa: '01847-800652', disc_mode: 'limit', disc_max_pct: 10, disc_min_margin: 15 } }]);
let r = await owner('erpInboxChannelSave', [{ kind: 'messenger', name: 'Page', externalId: 'PAGE5', secrets: { TOKEN: 'tok', APP_SECRET: 'sec' } }]);
const M = (await sql`select * from inbox_channels where id = ${r.result.channels[0].id}`)[0];
await sql`update inbox_channels set status = 'live' where id = ${M.id}`;
const W = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'wa_evo', 'Faujia Alvi', 'inst9', 'live', true, '{"purpose":"chat"}'::jsonb) returning *`)[0];
await asB(async (ctx) => { await chm.chSecretSet(ctx, W, 'URL', 'https://evo.test'); await chm.chSecretSet(ctx, W, 'KEY', 'k1'); });

// ---- flow-3: the summary's layout
const sum = ib.summaryText('bn', 'Rahim', '01712345678', 'House 5, Road 3, Mirpur 10, Dhaka', [{ name: 'Testa PLA Black 1kg', qty: 2, price: 1600 }, { name: 'Nozzle 0.4', qty: 1, price: 300 }], 90);
check('flow-3: name, phone, address on their own lines, items numbered, delivery, total, "confirm"',
  sum === 'নাম: Rahim\nফোন: 01712345678\nঠিকানা: House 5, Road 3, Mirpur 10, Dhaka\n\n1. Testa PLA Black 1kg × 2 — ৳3,200\n2. Nozzle 0.4 × 1 — ৳300\n\nডেলিভারি: ৳90\nমোট (ক্যাশ অন ডেলিভারি): ৳3,590\n\nসব ঠিক থাকলে "কনফার্ম" লিখুন।', sum);
check('flow-3: Banglish and English words too', /^Nam: /.test(ib.summaryText('banglish', 'A', '0', 'x', [], 0)) && /write "confirm"/.test(ib.summaryText('en', 'A', '0', 'x', [], 0)));

const reply = (history, conv) => asB(async (ctx) => ib.agentReply(ctx, conv || { id: null, channel_id: M.id }, { test: true, channel: M, contact: { name: 'Rahim Uddin', external_id: 'test' }, history }));
bodies.length = 0;
script = [[{ functionCall: { name: 'order_summary', args: { name: 'Rahim', phone: '01712345678', address: 'House 5, Road 3, Mirpur 10, Dhaka', items: [{ code: 'FIL-BOSS-1', qty: 2 }] } } }],
  [{ text: 'ঠিক আছে ভাই, একবার মিলিয়ে নিন:' }]];
let out = await reply([{ direction: 'in', kind: 'text', text: 'Rahim, 01712345678, House 5, Road 3, Mirpur 10, Dhaka' }]);
check('flow-3: the AI\'s read-back is ONE message, the ERP\'s neat summary under a short line', out.replies.length === 1 && /^ঠিক আছে ভাই, একবার মিলিয়ে নিন:\nনাম: Rahim\nফোন: 01712345678/.test(out.replies[0].text) && /1\. Testa PLA Black 1kg × 2 — ৳3,200/.test(out.replies[0].text), out.replies);
const sys = bodies[0].systemInstruction.parts[0].text;
check('flow-3 / boss-1: the prompt uses order_summary and ask_superior, discounts only for a bigger quantity', /call order_summary/.test(sys) && /DISCOUNTS: only for a bigger quantity/.test(sys) && /সুপিরিয়রের সাথে কথা বলে/.test(sys));

// ---- boss-1: the ask goes from the salesperson's own WhatsApp to the manager
const cR = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name) values (${FIX.B}, ${M.id}, 'PSID-B', 'Rahim Uddin') returning *`)[0];
const vR = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id) values (${FIX.B}, ${M.id}, ${cR.id}) returning *`)[0];
const ar = await asB(async (ctx) => sp.askSuperior(ctx, vR, cR, M, { question: '20 roll nile 1350 kore dewa jabe?', code: 'FIL-BOSS-1', qty: 20, wanted_price: 1350 }, await (async () => { const x = (await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')))); return (await x.catalogue(ctx)); })(), await ib.profile(ctx, false), false));
check('boss-1: the ask is sent from Faujia\'s WhatsApp to the manager with a reference, product, qty, our price and the asked price',
  ar.asked && ar.ref === 'R1' && wa.length === 1 && /inst9/.test(wa[0].url) && wa[0].number === '8801847800652' && /#R1/.test(wa[0].text) && /Testa PLA Black 1kg × 20/.test(wa[0].text) && /৳1,600/.test(wa[0].text) && /৳1,350/.test(wa[0].text), wa);
check('boss-1: the chat gets a note', (await sql`select 1 from inbox_messages where conversation_id = ${vR.id} and direction = 'note' and text like '%#R1%'`).length === 1);

// a message from some other number is an ordinary chat; the manager's "#R1 1450 dewa jabe" is the answer
let h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801711999999', text: '#R1 ok' }));
check('boss-1: someone else writing "#R1" is not the manager', h === false);
wa.length = 0;
h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652@s.whatsapp.net', text: '#R1 1450 dewa jabe' }));
const ask = (await sql`select * from superior_asks where ref = 'R1'`)[0];
const vR2 = (await sql`select * from inbox_conversations where id = ${vR.id}`)[0];
check('boss-1: the manager\'s answer is saved, the price agreed for that product in that chat, the chat due now', h && ask.status === 'answered' && Number(ask.answer_price) === 1450 && vR2.boss_agreed && Number(vR2.boss_agreed['FIL-BOSS-1']) === 1450 && vR2.reply_due_at, [ask, vR2.boss_agreed]);
check('boss-1: the manager gets a short ✅', wa.length === 1 && /✅ #R1/.test(wa[0].text));
const via = await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801847800652', text: '#R1 1450 dewa jabe', id: 'x1' }));
check('boss-1: through the normal inbound path it never becomes a customer chat', via && via.superior && !(await sql`select 1 from inbox_contacts where channel_id = ${W.id} and external_id = '8801847800652'`).length, via);

// the AI tells the customer now, although the chat ends with our "I'm checking" line
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values
  (${FIX.B}, ${vR.id}, 'in', 'customer', 'text', '20 roll nile 1350 hobe?'), (${FIX.B}, ${vR.id}, 'out', 'ai', 'text', 'ami ekhoni amar superior er sathe kotha bole janacchi bhai.')`;
bodies.length = 0;
script = [[{ text: 'bhai, 20 roll e ৳1,450 kore dite parbo. order korben?' }]];
out = await asB(async (ctx) => ib.agentReply(ctx, vR2, { test: false }));
check('boss-1: the AI relays the manager\'s answer at once (with the answer in its prompt)', bodies.length === 1 && /YOUR SUPERIOR HAS ANSWERED/.test(bodies[0].systemInstruction.parts[0].text) && /1450/.test(bodies[0].systemInstruction.parts[0].text), out);
check('boss-1: ...and the ask is marked told', (await sql`select status from superior_asks where ref = 'R1'`)[0].status === 'relayed');
check('boss-1: no manager number set: the tool says use handover', (await asB(async (ctx) => sp.askSuperior(ctx, vR, cR, M, { question: 'x' }, [], { superior_wa: '' }, false))).error.includes('handover'));
done();
