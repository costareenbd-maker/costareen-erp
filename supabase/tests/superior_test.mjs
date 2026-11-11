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
  ar.asked && ar.ref === 'R1' && wa.length === 1 && /inst9/.test(wa[0].url) && wa[0].number === '8801847800652' && /নং 1\b/.test(wa[0].text) && !/#R/.test(wa[0].text) && /Testa PLA Black 1kg × 20/.test(wa[0].text) && /৳1,600/.test(wa[0].text) && /৳1,350/.test(wa[0].text), wa);
check('boss-1: the chat gets a note', (await sql`select 1 from inbox_messages where conversation_id = ${vR.id} and direction = 'note' and text like '%#R1%'`).length === 1);

// a message from some other number is an ordinary chat; the manager's "#R1 1450 dewa jabe" is the answer
let h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801711999999', text: '#R1 ok' }));
check('boss-1: someone else writing "#R1" is not the manager', h === false);
wa.length = 0;
h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652@s.whatsapp.net', text: '#R1 1450 dewa jabe' }));
const ask = (await sql`select * from superior_asks where ref = 'R1'`)[0];
const vR2 = (await sql`select * from inbox_conversations where id = ${vR.id}`)[0];
check('boss-1: the manager\'s answer is saved, the price agreed for that product in that chat, the chat due now', h && ask.status === 'answered' && Number(ask.answer_price) === 1450 && vR2.boss_agreed && Number(vR2.boss_agreed['FIL-BOSS-1']) === 1450 && vR2.reply_due_at, [ask, vR2.boss_agreed]);
check('boss-1/4: the manager gets a short plain answer (no codes)', wa.length === 1 && /জি ভাই, Rahim Uddin-কে এখনই জানিয়ে দিচ্ছি/.test(wa[0].text) && !/#R/.test(wa[0].text), wa);
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

// ---- boss-2: a question the AI cannot answer goes to the manager too, and the answer comes back
wa.length = 0;
script = [[{ functionCall: { name: 'ask_team', args: { question: 'Ender 3 V3 te ei nozzle cholbe?' } } }], [{ text: 'bhai, ekhoni check kore janacchi.' }]];
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${FIX.B}, ${vR.id}, 'in', 'customer', 'text', 'Ender 3 V3 te cholbe?')`;
out = await asB(async (ctx) => ib.agentReply(ctx, (await sql`select * from inbox_conversations where id = ${vR.id}`)[0], { test: false }));
const tAsk = (await sql`select * from superior_asks where kind = 'team'`)[0];
const toMgr = wa.filter((x) => x.number === '8801847800652');
check('boss-2: ask_team: Faujia\'s WhatsApp asks the manager (#R, the customer, the question); the task is kept',
  tAsk && toMgr.length === 1 && /inst9/.test(toMgr[0].url) && new RegExp('নং ' + tAsk.ref.slice(1)).test(toMgr[0].text) && !/#R/.test(toMgr[0].text) && /জানা নেই/.test(toMgr[0].text) && /Rahim Uddin/.test(toMgr[0].text) && /Ender 3 V3/.test(toMgr[0].text) &&
  (await sql`select 1 from inbox_tasks where conversation_id = ${vR.id} and kind = 'enquiry' and status = 'open'`).length >= 1, [tAsk, wa]);
h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652', text: '#' + tAsk.ref + ' haa cholbe, 0.4 mm standard' }));
check('boss-2: the manager\'s answer to it is saved for the AI to tell', h && (await sql`select status from superior_asks where id = ${tAsk.id}`)[0].status === 'answered');
await asB(async (ctx) => sp.markRelayed(ctx, [tAsk.id]));

// ---- boss-2: every hand-over reaches the manager at once; his answer decides who takes it
wa.length = 0;
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${FIX.B}, ${vR.id}, 'in', 'customer', 'text', 'parcel bhanga ashche, taka ferot chai')`;
script = [[{ functionCall: { name: 'handover', args: { reason: 'refund', note: 'broken parcel' } } }], [{ text: 'dukkhito bhai, amar colleague ekhoni dekhchen.' }]];
await asB(async (ctx) => ib.agentReply(ctx, (await sql`select * from inbox_conversations where id = ${vR.id}`)[0], { test: false }));
const hAsk = (await sql`select * from superior_asks where kind = 'handover' order by asked_at desc limit 1`)[0];
const hMsg = wa.find((x) => x.number === '8801847800652');
check('boss-2: a hand-over goes to the manager on WhatsApp: reason, the customer\'s last words, how to answer',
  hAsk && hMsg && /🚨/.test(hMsg.text) && /Refund/.test(hMsg.text) && /taka ferot chai/.test(hMsg.text) && /আমি দেখছি/.test(hMsg.text) && (await sql`select mode from inbox_conversations where id = ${vR.id}`)[0].mode === 'human', [hAsk, wa]);
wa.length = 0;
h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652', text: '#' + hAsk.ref + ' ami dekhchi' }));
let vH = (await sql`select * from inbox_conversations where id = ${vR.id}`)[0];
check('boss-2: "ami dekhchi": the chat stays with a person, the AI does not answer', h && vH.mode === 'human' && !vH.reply_due_at && (await sql`select status from superior_asks where id = ${hAsk.id}`)[0].status === 'relayed' && /আপনার হাতে/.test(wa[0].text), [vH, wa]);
await asB((ctx) => ib.handOver(ctx, vH, 'complaint', 'late'));
const h2 = (await asB(async (ctx) => sp.tellHandover(ctx, vH, cR, M, await ib.profile(ctx, false), 'Complaint', 'late'))).ref;
h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652', text: '#' + h2 + ' bolo kal delivery hobe, sorry' }));
vH = (await sql`select * from inbox_conversations where id = ${vR.id}`)[0];
check('boss-2: any other answer gives the chat back to the AI, due now, to tell the customer', h && vH.mode === 'ai' && vH.reply_due_at && (await sql`select status from superior_asks where ref = ${h2}`)[0].status === 'answered', vH);

// ---- boss-2: the manager chatting to Faujia's number with nothing open gets a hint, never the sales AI
await sql`update superior_asks set status = 'relayed'`;
await sql`update superior_asks set asked_at = now() - interval '2 days'`;
wa.length = 0;
const free = await asB(async (ctx) => ib.ingest(ctx, W, { from: '8801847800652', text: 'kemon cholche?', id: 'free1' }));
check('boss-4: the manager with nothing open talks to the AI (a real answer, no customer chat)', free.superior && wa.length === 1 && wa[0].text === 'OK.' && /on WhatsApp with the shop manager/.test(bodies[bodies.length - 1].systemInstruction.parts[0].text) && /no open question/.test(bodies[bodies.length - 1].systemInstruction.parts[0].text) && !(await sql`select 1 from inbox_contacts where channel_id = ${W.id} and external_id = '8801847800652'`).length, [free, wa]);

// ---- boss-3: strategic questions to the MD, basic ones to the manager - one person each
await owner('erpInboxProfile', [{ save: { team_wa: '01681-443070' } }]);
await sql`update inbox_conversations set mode = 'ai', human_until = null where id = ${vR.id}`;
wa.length = 0;
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${FIX.B}, ${vR.id}, 'in', 'customer', 'text', 'H2D 2 week e ene dite parben?')`;
script = [[{ functionCall: { name: 'ask_team', args: { question: 'Bambu H2D 2 soptaher moddhe ene dewa jabe?', level: 'strategic' } } }], [{ text: 'bhai, ekhoni janacchi.' }]];
await asB(async (ctx) => ib.agentReply(ctx, (await sql`select * from inbox_conversations where id = ${vR.id}`)[0], { test: false }));
const sAsk = (await sql`select * from superior_asks where question like 'Bambu H2D%'`)[0];
check('boss-3: a strategic question goes to the MD only', sAsk && sAsk.sent_to === 'md' && wa.length >= 1 && wa.filter((x) => /নং \d/.test(x.text)).every((x) => x.number === '8801681443070') && /সিদ্ধান্ত/.test(wa.find((x) => x.number === '8801681443070').text), [sAsk, wa]);
wa.length = 0;
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${FIX.B}, ${vR.id}, 'in', 'customer', 'text', 'silk gold ache?')`;
script = [[{ functionCall: { name: 'ask_team', args: { question: 'Silk PLA gold ache?', level: 'basic' } } }], [{ text: 'bhai, dekhe janacchi.' }]];
await asB(async (ctx) => ib.agentReply(ctx, (await sql`select * from inbox_conversations where id = ${vR.id}`)[0], { test: false }));
const bAsk = (await sql`select * from superior_asks where question like 'Silk PLA%'`)[0];
check('boss-3: a basic question goes to the manager only', bAsk && bAsk.sent_to === 'manager' && wa.filter((x) => /নং \d/.test(x.text)).every((x) => x.number === '8801847800652'), [bAsk, wa]);
// the MD answers without a #R: it lands on his own ask, not the manager's newer one
bodies.length = 0;
script = [(b) => [{ functionCall: { name: 'answer_ask', args: { ref: sAsk.ref, answer: 'haa 2 week e ana jabe, 50% advance lagbe' } } }], [{ text: 'জি স্যার, কাস্টমারকে জানিয়ে দিচ্ছি।' }]];
wa.length = 0;
h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'haa 2 week e ana jabe, 50% advance lagbe' }));
check('boss-4: the MD sees only his own open question (the manager\'s is not in his list)', new RegExp(sAsk.ref + ':').test(bodies[0].systemInstruction.parts[0].text) && !new RegExp(bAsk.ref + ':').test(bodies[0].systemInstruction.parts[0].text) && /স্যার/.test(bodies[0].systemInstruction.parts[0].text));
check('boss-4: the MD gets the AI\'s plain answer', wa.length === 1 && wa[0].number === '8801681443070' && wa[0].text === 'জি স্যার, কাস্টমারকে জানিয়ে দিচ্ছি।', wa);
check('boss-3: the MD\'s answer without #R goes to the ask sent to him', h && (await sql`select status from superior_asks where id = ${sAsk.id}`)[0].status === 'answered' && (await sql`select status from superior_asks where id = ${bAsk.id}`)[0].status === 'open');
bodies.length = 0;
script = [[{ text: 'জি ভাই, ২ সপ্তাহের মধ্যে এনে দিতে পারবো।' }]];
await asB(async (ctx) => ib.agentReply(ctx, (await sql`select * from inbox_conversations where id = ${vR.id}`)[0], { test: false }));
const sys3 = bodies[0].systemInstruction.parts[0].text;
check('boss-3: the AI is told never to copy the note, to say it in its own polite words', /NEVER copy, quote or forward them/.test(sys3) && /50% advance lagbe/.test(sys3));
// learned: later chats get what they answered (facts), not a discount for one customer
bodies.length = 0;
await reply([{ direction: 'in', kind: 'text', text: 'H2D pre-order hoy?' }]);
const sys4 = bodies[0].systemInstruction.parts[0].text;
check('boss-3: later chats know what the manager / MD answered before', /WHAT OUR MANAGER \/ MD TOLD YOU BEFORE/.test(sys4) && /Bambu H2D 2 soptaher/.test(sys4) && /Ender 3 V3/.test(sys4) && !/20 roll nile 1350/.test(sys4.split('TOLD YOU BEFORE')[1] || ''), sys4.slice(-800));
check('boss-3: ask_team asks for a level (strategic -> MD)', /goes to our MD/.test(JSON.stringify(bodies[0].tools)));
// ---- boss-4: the MD talks to the AI like to a person: look-ups, commands, rules; the conversation is kept
wa.length = 0; bodies.length = 0;
script = [[{ functionCall: { name: 'stock', args: { q: 'PLA Black' } } }], [{ text: 'স্যার, Testa PLA Black 1kg আছে ৪৮টা, দাম ৳১,৬০০।' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'Give stock details' }));
check('boss-4: "Give stock details": the AI looks the stock up in the ERP and answers in plain words', bodies.length === 2 && /Testa PLA Black 1kg/.test(JSON.stringify(bodies[1].contents)) && /৳1,600/.test(JSON.stringify(bodies[1].contents)) && wa.length === 1 && /৪৮টা/.test(wa[0].text), [wa, JSON.stringify(bodies[1] && bodies[1].contents).slice(-600)]);
check('boss-4: the MD may see money and profit tools; the owner\'s notes and invoice-making are not there', /month_profit/.test(JSON.stringify(bodies[0].tools)) && !/my_notes/.test(JSON.stringify(bodies[0].tools)) && /propose_invoice/.test(JSON.stringify(bodies[0].tools)));
bodies.length = 0;
script = [[{ text: 'OK.' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652', text: 'aj koto sale holo?' }));
check('boss-4: the manager has no money / profit tools', !/month_profit|money_accounts/.test(JSON.stringify(bodies[0].tools)) && /sales_day/.test(JSON.stringify(bodies[0].tools)));
// the conversation is kept: the MD's next message comes with what was said before
bodies.length = 0; wa.length = 0;
const cid = String(vR.id).slice(0, 8);
script = [[{ functionCall: { name: 'recent_chats', args: { q: 'Rahim' } } }], [{ functionCall: { name: 'tell_customer', args: { chat: cid, what: 'H2D 15 tarikh e ashbe, 50% advance e booking' } } }], [{ text: 'জি স্যার, রহিম ভাইকে জানিয়ে দিচ্ছি।' }]];
await sql`update inbox_conversations set mode = 'human', claimed_name = 'x' where id = ${vR.id}`;
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'Rahim ke bolo H2D 15 tarikh e ashbe, 50% advance e booking' }));
check('boss-4: the earlier messages of this WhatsApp chat come along', /Give stock details/.test(JSON.stringify(bodies[0].contents)) && /৪৮টা/.test(JSON.stringify(bodies[0].contents)));
check('boss-4: recent_chats finds the customer and shows a chat id', /Rahim Uddin/.test(JSON.stringify(bodies[1].contents)) && new RegExp(cid).test(JSON.stringify(bodies[1].contents)));
const tell = (await sql`select * from superior_asks where kind = 'tell' order by asked_at desc limit 1`)[0];
const vT = (await sql`select * from inbox_conversations where id = ${vR.id}`)[0];
check('boss-4: "tell Rahim ...": the chat goes back to the AI, due now, with the MD\'s words to say politely', tell && tell.status === 'answered' && /15 tarikh/.test(tell.answer) && vT.mode === 'ai' && vT.reply_due_at && wa.length === 1 && /জানিয়ে দিচ্ছি/.test(wa[0].text), [tell, vT.mode]);
bodies.length = 0;
script = [[{ text: 'ভাই, H2D ১৫ তারিখে আসবে, ৫০% অ্যাডভান্সে বুকিং।' }]];
await asB(async (ctx) => ib.agentReply(ctx, vT, { test: false }));
check('boss-4: the sales AI tells it (in its own words, never copied)', /YOUR SUPERIOR HAS ANSWERED/.test(bodies[0].systemInstruction.parts[0].text) && /15 tarikh/.test(bodies[0].systemInstruction.parts[0].text));
// a standing rule -> every later customer chat
script = [[{ functionCall: { name: 'remember', args: { fact: 'Printers can be brought in within 2 weeks with a 50% advance.' } } }], [{ text: 'জি স্যার, মনে রাখলাম।' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'ekhon theke printer 2 week e ana jabe 50% advance e, sobaike bolba' }));
bodies.length = 0;
await reply([{ direction: 'in', kind: 'text', text: 'printer pre-order?' }]);
check('boss-4: "remember": the rule is in every later customer chat', /within 2 weeks with a 50% advance/.test(bodies[0].systemInstruction.parts[0].text));
// ---- boss-5: IT technician + accountant, only for the MD and the owner; every change waits for a separate yes
await owner('erpInboxProfile', [{ save: { team_wa: '01681-443070, +82 10-2151-0000' } }]);
await owner('erpCashAccountSave', [{ name: 'Testcash', kind: 'cash', opening: 5000, openingDate: '2026-01-01' }]);
await owner('erpCashAccountSave', [{ name: 'Testbank', kind: 'bank', opening: 0, openingDate: '2026-01-01' }]);
bodies.length = 0;
script = [[{ text: 'OK.' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652', text: 'cash theke bank e 1000 pathao' }));
check('boss-5: the manager has no IT / accounting tools', !/propose_transfer|it_status|propose_expense|confirm/.test(JSON.stringify(bodies[0].tools)));
bodies.length = 0;
script = [[{ text: 'OK.' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '82102151' + '0000', text: 'hello' }));
check('boss-5: the owner\'s number is known as the owner, with the IT + accountant tools', /the OWNER of the business/.test(bodies[0].systemInstruction.parts[0].text) && /propose_transfer/.test(JSON.stringify(bodies[0].tools)) && /it_status/.test(JSON.stringify(bodies[0].tools)) && /IT technician and accountant/.test(bodies[0].systemInstruction.parts[0].text));
// IT check
bodies.length = 0;
script = [[{ functionCall: { name: 'it_status', args: {} } }], [{ text: 'স্যার, সব চ্যানেল চালু আছে।' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'kichu problem ache?' }));
check('boss-5: it_status shows the channels and chats waiting', /channels/.test(JSON.stringify(bodies[1].contents)) && /chatsWaitingTooLong/.test(JSON.stringify(bodies[1].contents)), JSON.stringify(bodies[1] && bodies[1].contents.slice(-1)).slice(0, 900));
// a transfer: proposed, a confirm in the same turn is refused, the next "yes" does it
const bal = async () => (await sql`select a.name, coalesce(sum(m.amount), 0)::float + coalesce(a.opening, 0)::float b from money_accounts a left join money_moves m on m.account_id = a.id and coalesce(btrim(m.voided), '') = '' where a.business_id = ${FIX.B} and a.name in ('Testcash', 'Testbank') group by a.id, a.name, a.opening`.catch(() => []));
bodies.length = 0; wa.length = 0;
script = [[{ functionCall: { name: 'propose_transfer', args: { from: 'Testcash', to: 'Testbank', amount: 1000, note: 'bank deposit' } } }], [{ functionCall: { name: 'confirm', args: {} } }], [{ text: 'স্যার, Testcash থেকে Testbank-এ ৳1,000 পাঠাব। করব?' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'cash theke bank e 1000 pathao' }));
check('boss-5: a confirm in the same turn as the proposal is refused', /have not said yes yet/.test(JSON.stringify(bodies[2].contents)) && !(await sql`select 1 from money_moves where business_id = ${FIX.B} and kind = 'transfer' and amount = 1000`).length);
script = [[{ functionCall: { name: 'confirm', args: {} } }], [{ text: 'জি স্যার, করে দিয়েছি।' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'haa koro' }));
const mv = await sql`select * from money_moves where business_id = ${FIX.B} and kind = 'transfer' and amount = 1000`;
check('boss-5: "haa koro": the transfer is written through the cash book', mv.length === 1 && /WhatsApp/.test(mv[0].note), mv);
const act = await sql`select * from erp_activity where business_id = ${FIX.B} and action = 'whatsapp:transfer'`;
check('boss-5: ...and written to the activity log under the MD\'s name', act.length === 1 && /MD via WhatsApp/.test(act[0].who), act);
script = [[{ functionCall: { name: 'confirm', args: {} } }], [{ text: 'ok' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'haa' }));
check('boss-5: a second yes does nothing (nothing waiting)', (await sql`select 1 from money_moves where business_id = ${FIX.B} and kind = 'transfer' and amount = 1000`).length === 1);
// an expense through the assistant's proposal
script = [[{ functionCall: { name: 'propose_expense', args: { amount: 350, description: 'Test courier bill', category: 'Courier' } } }], [{ text: 'স্যার, ৳৩৫০ courier খরচ লিখব। করব?' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '82102151' + '0000', text: 'courier bill 350 lekho' }));
script = [[{ functionCall: { name: 'confirm', args: {} } }], [{ text: 'জি স্যার।' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '82102151' + '0000', text: 'ji' }));
check('boss-5: an expense: proposed, yes, written', (await sql`select 1 from expenses where business_id = ${FIX.B} and description like 'Test courier bill%'`.catch(() => [])).length === 1 &&
  (await sql`select who from erp_activity where business_id = ${FIX.B} and action = 'whatsapp:expense'`)[0].who.startsWith('Owner'));
// an IT fix: the AI off on a channel
script = [[{ functionCall: { name: 'propose_fix', args: { action: 'ai_off', channel: W.name } } }], [{ text: 'করব?' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'whatsapp e AI bondho koro' }));
script = [[{ functionCall: { name: 'confirm', args: {} } }], [{ text: 'জি স্যার।' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'yes' }));
check('boss-5: an IT fix: the AI is off on that channel after the yes', (await sql`select ai_on from inbox_channels where id = ${W.id}`)[0].ai_on === false);
await sql`update inbox_channels set ai_on = true where id = ${W.id}`;
// a code fault is written down for the developer
script = [[{ functionCall: { name: 'report_bug', args: { what: 'Invoice PDF shows the wrong date' } } }], [{ text: 'স্যার, লিখে রাখলাম।' }]];
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801681443070', text: 'invoice pdf e date vul' }));
check('boss-5: report_bug keeps a ticket for the developer', /wrong date/.test((await sql`select value from business_config where business_id = ${FIX.B} and key = 'it_tickets'`)[0]?.value || ''));

// no AI answers: an open question still takes the message as its answer; nothing open -> one plain sentence
web.on(/generativelanguage\.googleapis\.com/, () => ({ status: 500, body: { error: { message: 'down' } } }));
wa.length = 0;
h = await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652', text: 'silk gold nai, 2 din por ashbe' }));
check('boss-4: AI down: the manager\'s message still answers his open question', h && (await sql`select status from superior_asks where id = ${bAsk.id}`)[0].status === 'answered' && /জানিয়ে দিচ্ছি/.test(wa[0].text), wa);
wa.length = 0;
await asB(async (ctx) => sp.superiorInbound(ctx, W, { from: '8801847800652', text: 'hello' }));
check('boss-4: AI down, nothing open: one plain sentence, no codes', wa.length === 1 && !/#R/.test(wa[0].text) && /কয়েক মিনিট পরে/.test(wa[0].text), wa);
done();
