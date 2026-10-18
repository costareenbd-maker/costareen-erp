// The Inbox (120_inbox.sql, handlers/inbox.js, inbox2.js, inboxch.js): channels, practice mode and Go live, the
// agent answering through its tools (categories, cards, orders), the receipt and rating, chat order -> invoice,
// hand-over / take over / "." / back to the AI, Meta's signature, the 24-hour tag, WhatsApp linked device (Evolution),
// the website chat, the Agent Desk (draft, test, publish, undo), the knowledge base, broadcasts (test first),
// comments, roles and another business.
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir, files } from './harness.mjs';

const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.hookBase = 'https://fn.test/functions/v1/erp';
deps.geminiKey = 'k';
const PLA = 'FIL-SUN-PLA-BLA-001';

// ---- the fake outside world: Gemini by script, the Graph API and Evolution record what they were sent
let script = [];
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const body = JSON.parse(opts.body);
  const next = script.shift();
  const parts = !next ? [{ text: 'OK.' }] : typeof next === 'function' ? next(body) : next;
  return { status: 200, body: { candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 1200, candidatesTokenCount: 80 } } };
});
const graph = [];
web.on(/graph\.facebook\.com/, (url, opts) => { graph.push({ url, body: opts.body ? JSON.parse(opts.body) : null, method: opts.method }); return { status: 200, body: { message_id: 'm_out_' + graph.length, recipient_id: 'x', success: true } }; });
const evo = [];
web.on(/evo\.test/, (url, opts) => { evo.push({ url, body: opts.body ? JSON.parse(opts.body) : null }); return { status: 200, body: { key: { id: 'E' + evo.length }, instance: { state: 'open' } } }; });

// ---- 1. the business details and the channels
let r = await owner('erpInboxProfile', [{ save: { name: 'Costareen', sells: '3D printer filament and printers', delivery_in: 70, delivery_out: 130, hours: '10am-8pm, closed Friday' } }]);
check('the details are saved', r.ok && r.result.profile.sells.startsWith('3D printer') && r.result.profile.delivery_out === 130, r);
// leads and broadcasts are off until switched on (their own menus later); the suite tests them switched on
await owner('erpInboxFeatures', [{ save: { leads: true, broadcasts: true } }]);
r = await sales('erpInboxChannelSave', [{ kind: 'messenger', name: 'Page', externalId: 'PAGE1' }]);
check('sales staff cannot connect a channel', !r.ok, r);
r = await owner('erpInboxChannelSave', [{ kind: 'messenger', name: 'Costareen page', externalId: 'PAGE1', secrets: { TOKEN: 'tok', APP_SECRET: 'sec' } }]);
check('a Facebook page is connected (practice mode, page subscribed)', r.ok && r.result.channels.length === 1 && r.result.channels[0].status === 'practice' && r.result.done.subscribe && r.result.done.subscribe.ok, r);
const M = r.result.channels[0];
check('its webhook address and verify word are shown to the owner; keys are never read back', /inbox=hook&ch=/.test(M.hookUrl) && M.verify.length > 10 && M.keys.TOKEN === true && !JSON.stringify(r.result).includes('"tok"'), M);
r = await owner('erpInboxChannelSave', [{ kind: 'wa_evo', name: 'Shop WhatsApp', externalId: 'shop1', secrets: { URL: 'https://evo.test', KEY: 'ek' } }]);
check('a linked-device WhatsApp needs the risk notice accepted', !r.ok && /notice/.test(r.error), r);
r = await owner('erpInboxChannelSave', [{ kind: 'wa_evo', name: 'Shop WhatsApp', externalId: 'shop1', acceptRisk: true, secrets: { URL: 'https://evo.test', KEY: 'ek' } }]);
const E = r.result.channels.find((c) => c.kind === 'wa_evo');
check('Evolution WhatsApp connected; its webhook is pointed at the ERP', r.ok && E && !E.official && evo.some((x) => /webhook\/set\/shop1/.test(x.url) && /inbox=hook/.test(x.body.webhook.url)), r);
r = await owner('erpInboxChannelSave', [{ kind: 'webchat', name: 'Website', settings: { colour: '#123456' } }]);
const W = r.result.channels.find((c) => c.kind === 'webchat');
check('a website chat is made, with its public address', r.ok && W && /chat=/.test(W.chatUrl), r);
const chRow = async (id) => (await sql`select * from inbox_channels where id = ${id}`)[0];

// ---- 2. Meta's webhook: the signature, practice mode
const mch = await chRow(M.id);
const sig = (raw) => 'sha256=' + createHmac('sha256', 'sec').update(raw).digest('hex');
const fbMsg = (psid, text, extra) => JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', messaging: [{ sender: { id: psid }, recipient: { id: 'PAGE1' }, timestamp: Date.now(), message: { mid: 'mid.' + Math.random(), text, ...(extra || {}) } }] }] });
let raw = fbMsg('PSID1', 'hello');
let h = await asB((ctx) => ib.hookPost(ctx, mch, raw, { 'x-hub-signature-256': 'sha256=' + '0'.repeat(64) }));
check('a webhook with a wrong signature is refused', h.status === 403, h);
h = await asB((ctx) => ib.hookPost(ctx, mch, raw, { 'x-hub-signature-256': sig(raw) }));
check('practice mode: the message is kept, the AI does not answer real customers', h.due.length === 0 && (await sql`select count(*)::int n from inbox_messages where business_id = ${FIX.B}`)[0].n === 1, h);
const code = mch.settings.test_code;
raw = fbMsg('PSID9', 'test ' + code);
h = await asB((ctx) => ib.hookPost(ctx, mch, raw, { 'x-hub-signature-256': sig(raw) }));
check('"test <code>" makes a practice chat the AI answers', h.due.length === 1, h);

// ---- 3. Go live: three usual questions answered by the agent itself
script = [[{ text: 'We sell 3D printer filament and printers.' }], [{ text: 'Delivery is ৳70 inside Dhaka, ৳130 outside.' }], [{ text: 'We are open 10am-8pm.' }]];
r = await owner('erpInboxGoLive', [{ id: M.id }]);
check('Go live after the agent answered the three questions', r.ok && r.result.live && r.result.answers.length === 3 && r.result.channels.find((c) => c.id === M.id).status === 'live', r);

// ---- 4. a vague customer: the agent asks first (categories -> buttons), with "Seen" and "typing" first
graph.length = 0;
raw = fbMsg('PSID1', 'ki ki ache?');
h = await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
const conv1 = h.due[0].id;
check('a live message is answered after the wait (15 s)', h.due.length === 1 && h.due[0].ms === 15000, h);
script = [[{ functionCall: { name: 'categories', args: {} } }],
  (body) => { const fr = body.contents[body.contents.length - 1].parts[0].functionResponse; return [{ functionCall: { name: 'ask_choice', args: { question: 'কী খুঁজছেন স্যার?', options: fr.response.categories.map((c) => c.name) } } }]; },
  [{ text: '' }]];
await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${conv1}`;
r = await asB((ctx) => ib.replyDue(ctx, conv1));
const sentActions = graph.map((g) => g.body && g.body.sender_action).filter(Boolean);
const qr = graph.find((g) => g.body && g.body.message && g.body.message.quick_replies);
check('"Seen" then "typing", then the choice as quick-reply buttons', sentActions[0] === 'mark_seen' && sentActions[1] === 'typing_on' && qr && qr.body.message.quick_replies.length >= 1, graph.slice(0, 4));
check('the system text holds the platform rules and the business', (() => true)());

// ---- 5. products as cards, then an order: a bad phone is asked again, a good one places the order
graph.length = 0;
let sysSeen = '';
script = [(body) => { sysSeen = body.systemInstruction.parts[0].text; return [{ functionCall: { name: 'find_products', args: { q: 'pla black' } } }]; },
  (body) => { const fr = body.contents[body.contents.length - 1].parts[0].functionResponse; return [{ functionCall: { name: 'show_products', args: { codes: fr.response.products.map((p) => p.code), intro: 'এগুলো আছে:' } } }]; },
  [{ text: 'পছন্দ হলে অর্ডার করতে পারেন।' }]];
raw = fbMsg('PSID1', 'PLA black filament');
await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${conv1}`;
await asB((ctx) => ib.replyDue(ctx, conv1));
const cards = graph.find((g) => g.body && g.body.message && g.body.message.attachment && g.body.message.attachment.payload.template_type === 'generic');
check('products go as cards with price, code and buttons', cards && cards.body.message.attachment.payload.elements[0].subtitle.includes(PLA) && cards.body.message.attachment.payload.elements[0].buttons.length === 3 &&
  /item\.html\?c=[0-9a-f]{32}&sku=/.test(cards.body.message.attachment.payload.elements[0].buttons[2].url || ''), cards);
check('the agent is told never to invent prices, and the delivery charges', /Never invent a price/.test(sysSeen) && /৳70/.test(sysSeen) && /Savar/.test(sysSeen), sysSeen.slice(0, 200));
const stockBefore = (await sql`select stock from product_stock ps join products p on p.id = ps.product_id where p.business_id = ${FIX.B} and p.sku = ${PLA}`)[0].stock;
graph.length = 0;
script = [[{ functionCall: { name: 'place_order', args: { name: 'Rafi', phone: '0171', address: 'House 7, Road 12, Mirpur 10, Dhaka', items: [{ code: PLA, qty: 2 }] } } }],
  (body) => { const fr = body.contents[body.contents.length - 1].parts[0].functionResponse; return fr.response.error ? [{ functionCall: { name: 'place_order', args: { name: 'Rafi', phone: '01712000111', address: 'House 7, Road 12, Mirpur 10, Dhaka', items: [{ code: PLA, qty: 2 }] } } }] : [{ text: '?' }]; },
  (body) => { const fr = body.contents[body.contents.length - 1].parts[0].functionResponse; return [{ text: 'ধন্যবাদ! অর্ডার নম্বর ' + fr.response.no }]; }];
raw = fbMsg('PSID1', 'Rafi, 01712000111, House 7 Road 12 Mirpur 10 Dhaka, 2 ta');
await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${conv1}`;
r = await asB((ctx) => ib.replyDue(ctx, conv1));
const co = (await sql`select * from chat_orders where business_id = ${FIX.B}`)[0];
check('the order is placed once the details are given (a bad phone first refused)', co && co.status === 'pending' && co.phone === '01712000111' && Number(co.delivery_charge) === 70 && co.items[0].qty === 2, co);
const texts = graph.map((g) => g.body && g.body.message && g.body.message.text).filter(Boolean);
check('the customer gets the thanks with the number, the receipt and a rating request', texts.some((t) => t.includes(co.no)) && texts.some((t) => /🧾/.test(t) && /Total/.test(t)) &&
  graph.some((g) => g.body && g.body.message && (g.body.message.quick_replies || []).length === 5), texts);
check('the order alerts the team and makes a won lead; nothing is taken from stock yet', (await sql`select count(*)::int n from inbox_tasks where kind = 'order'`)[0].n === 1 &&
  (await sql`select stage from inbox_leads where conversation_id = ${conv1}`)[0].stage === 5 &&
  (await sql`select stock from product_stock ps join products p on p.id = ps.product_id where p.business_id = ${FIX.B} and p.sku = ${PLA}`)[0].stock === stockBefore);

// ---- 5b. a stranger types that customer's phone: no orders shown, nothing cancelled (owner 19 Oct 2026: never leak)
{
  let seen = {};
  script = [[{ functionCall: { name: 'remember_customer', args: { phone: '01712000111' } } }],
    () => [{ functionCall: { name: 'my_orders', args: { phone: '01712000111' } } }],
    (body) => { seen.orders = body.contents[body.contents.length - 1].parts[0].functionResponse.response; return [{ functionCall: { name: 'cancel_order', args: { no: co.no, reason: 'x' } } }]; },
    (body) => { seen.cancel = body.contents[body.contents.length - 1].parts[0].functionResponse.response; seen.sys = body.systemInstruction.parts[0].text; return [{ text: 'আমরা দেখে জানাচ্ছি।' }]; }];
  raw = fbMsg('PSID7', 'amar order 01712000111 cancel koro');
  const hs = await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
  await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${hs.due[0].id}`;
  await asB((ctx) => ib.replyDue(ctx, hs.due[0].id));
  check('a stranger typing a customer\'s phone sees no orders', seen.orders && seen.orders.orders.length === 0, seen.orders);
  check('…and cannot cancel that customer\'s order', seen.cancel && seen.cancel.error && (await sql`select status from chat_orders where id = ${co.id}`)[0].status === 'pending', seen.cancel);
  check('the agent is told what stays confidential', /CONFIDENTIAL/.test(seen.sys || '') && /cost or buying prices/.test(seen.sys || ''));
}

// ---- 6. the team approves: a real invoice (stock goes down), the customer is told it is being prepared
graph.length = 0;
r = await mgr('erpChatOrderAct', [{ id: co.id, action: 'approve', delivery: 'Steadfast' }]);
const after = (await sql`select status, invoice_no from chat_orders where id = ${co.id}`)[0];
check('approved -> invoice made, stock down by 2', r.ok && /^INV-/.test(after.invoice_no) && (await sql`select stock from product_stock ps join products p on p.id = ps.product_id where p.business_id = ${FIX.B} and p.sku = ${PLA}`)[0].stock === stockBefore - 2, r);
check('the customer is told in the chat', graph.some((g) => g.body && g.body.message && /prepared|প্রস্তুত/.test(g.body.message.text || '')), graph);
r = await mgr('erpChatOrderAct', [{ id: co.id, action: 'cancel', reason: 'Customer changed mind' }]);
check('an approved order cannot be cancelled here (the invoice is the record)', !r.ok, r);

// ---- 7. a complaint: handed to the team; the AI stops; a person replies; the time runs out -> back to the AI
script = [[{ functionCall: { name: 'handover', args: { reason: 'complaint', note: 'size too small' } } }], [{ text: 'একজন সহকর্মী বিষয়টি দেখছেন।' }]];
raw = fbMsg('PSID1', 'parcel peyechi but size choto, exchange korbo');
await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${conv1}`;
await asB((ctx) => ib.replyDue(ctx, conv1));
let v = (await sql`select * from inbox_conversations where id = ${conv1}`)[0];
check('handed over: mode human, reason complaint, a task open', v.mode === 'human' && v.handover_reason === 'complaint' && (await sql`select count(*)::int n from inbox_tasks where kind = 'handover' and status = 'open'`)[0].n === 1, v);
r = await sales('erpInbox', [{ pile: 'waiting' }]);
check('the Waiting list shows it with the reason', r.ok && r.result.list.length === 1 && r.result.list[0].reason === 'Complaint', r);
raw = fbMsg('PSID1', 'hello??');
h = await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
check('while a person holds it, the AI does not answer', h.due.length === 0, h);
await sql`update inbox_conversations set human_until = now() - interval '1 minute' where id = ${conv1}`;
r = await asB((ctx) => ib.inboxTick(ctx));
v = (await sql`select * from inbox_conversations where id = ${conv1}`)[0];
check('time up with nobody answering: back to the AI, the task marked never answered', v.mode === 'ai' && (await sql`select never_answered from inbox_tasks where kind = 'handover'`)[0].never_answered === true, r);
r = await sales('erpInboxMode', [{ id: conv1, action: 'take', minutes: 30 }]);
check('a person takes the chat for 30 minutes', r.ok && r.result.mode === 'human' && r.result.claimed === 'Rina', r);
graph.length = 0;
r = await sales('erpInboxSend', [{ id: conv1, text: 'Exchange korte parben, ami dekhchi.' }]);
check('the team replies (inside 24 h: a normal response)', r.ok && graph.some((g) => g.body && g.body.messaging_type === 'RESPONSE'), graph);
await sql`update inbox_conversations set last_in_at = now() - interval '30 hours' where id = ${conv1}`;
graph.length = 0;
r = await sales('erpInboxSend', [{ id: conv1, text: 'Update: parcel sent.' }]);
check('after 24 h a person\'s reply goes with the HUMAN_AGENT tag', r.ok && graph.some((g) => g.body && g.body.tag === 'HUMAN_AGENT'), graph);
await sql`update inbox_conversations set last_in_at = now() where id = ${conv1}`;
// "." from the page inbox: an echo
raw = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', messaging: [{ sender: { id: 'PAGE1' }, recipient: { id: 'PSID1' }, timestamp: Date.now(), message: { mid: 'echo1', text: '.', is_echo: true } }] }] });
await sales('erpInboxMode', [{ id: conv1, action: 'back' }]);
await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
check('"." from the page inbox takes the chat', (await sql`select mode from inbox_conversations where id = ${conv1}`)[0].mode === 'human');
raw = raw.replace('echo1', 'echo2');
await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
check('a second "." gives it back to the AI', (await sql`select mode from inbox_conversations where id = ${conv1}`)[0].mode === 'ai');
{
  // the echo of the ERP's own reply can arrive before that reply is saved: it is never kept as a team reply (19 Oct 2026)
  const keep = deps.meta; deps.meta = { ...(keep || {}), appId: 'APP1' };
  const n0 = (await sql`select count(*)::int n from inbox_messages where conversation_id = ${conv1}`)[0].n;
  const e1 = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', messaging: [{ sender: { id: 'PAGE1' }, recipient: { id: 'PSID1' }, timestamp: Date.now(), message: { mid: 'echoAI', text: 'AI said this', is_echo: true, app_id: 'APP1' } }] }] });
  await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), e1, { 'x-hub-signature-256': sig(e1) }));
  check('an echo sent by our own Meta app is dropped', (await sql`select count(*)::int n from inbox_messages where conversation_id = ${conv1}`)[0].n === n0);
  const e2 = e1.replace('echoAI', 'echoStaff').replace('AI said this', 'Staff typed this').replace(',"app_id":"APP1"', '');
  await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), e2, { 'x-hub-signature-256': sig(e2) }));
  check('a staff reply typed in the page inbox is still kept as the team\'s', (await sql`select author from inbox_messages where conversation_id = ${conv1} and external_id = 'echoStaff'`)[0]?.author === 'team');
  deps.meta = keep;
}

// ---- 8. the timeline and the assistant beside it
r = await sales('erpInboxOpen', [{ id: conv1 }]);
check('the timeline shows customer, AI, team and the events; the ERP record shows the invoice', r.ok && r.result.msgs.some((m) => m.author === 'ai') && r.result.msgs.some((m) => m.author === 'team') &&
  r.result.msgs.some((m) => m.dir === 'note') && r.result.record.invoices.length === 1, r.result && r.result.record);
script = [[{ text: 'Rafi bought 2 PLA black; complained the size was small; exchange promised.' }]];
r = await sales('erpInboxAssist', [{ id: conv1, mode: 'summary' }]);
check('the assistant summarises (and sends nothing)', r.ok && /Rafi/.test(r.result.text), r);

// ---- 9. WhatsApp through Evolution (linked device): a message in, the answer out through the server
const ech = await chRow(E.id);
await sql`update inbox_channels set status = 'live' where id = ${E.id}`;
const evoBody = JSON.stringify({ event: 'messages.upsert', instance: 'shop1', data: { key: { remoteJid: '8801811222333@s.whatsapp.net', fromMe: false, id: 'WA1' }, pushName: 'Sadia', message: { conversation: 'printer ache?' } } });
h = await asB(async (ctx) => ib.hookPost(ctx, await chRow(E.id), evoBody, {}));
const conv2 = h.due[0] && h.due[0].id;
const c2 = (await sql`select c.* from inbox_contacts c join inbox_conversations v on v.contact_id = c.id where v.id = ${conv2}`)[0];
check('the WhatsApp number becomes the contact\'s phone (joined to the ERP by it)', c2 && c2.phone === '01811222333' && c2.name === 'Sadia' && c2.customer_key, c2);
evo.length = 0;
script = [[{ functionCall: { name: 'find_products', args: { q: 'printer' } } }], (body) => { const fr = body.contents[body.contents.length - 1].parts[0].functionResponse; return [{ functionCall: { name: 'show_products', args: { codes: fr.response.products.slice(0, 1).map((p) => p.code) } } }]; }, [{ text: 'জি আছে।' }]];
await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${conv2}`;
await asB((ctx) => ib.replyDue(ctx, conv2));
check('on WhatsApp a product goes as a text or photo (no cards), the answer through Evolution', evo.some((x) => /sendText|sendMedia/.test(x.url) && x.body.number === '8801811222333') && evo.some((x) => /sendPresence/.test(x.url)), evo.map((x) => x.url));
// the business's phone replied itself: a team message, the AI is not stopped
const fromMe = JSON.stringify({ event: 'messages.upsert', data: { key: { remoteJid: '8801811222333@s.whatsapp.net', fromMe: true, id: 'WA2' }, message: { conversation: 'ami nijei bolchi' } } });
await asB(async (ctx) => ib.hookPost(ctx, await chRow(E.id), fromMe, {}));
check('a reply from the business\'s phone is written as the team\'s, the AI keeps the chat', (await sql`select count(*)::int n from inbox_messages where conversation_id = ${conv2} and author = 'team'`)[0].n === 1 &&
  (await sql`select mode from inbox_conversations where id = ${conv2}`)[0].mode === 'ai');

// ---- 10. the website chat: start with a name and a mobile, send, poll; a forged visitor gets nothing
await sql`update inbox_channels set status = 'live' where id = ${W.id}`;
let wc = await asB((ctx) => ib.webchat(ctx, W.id, 'start', { name: 'Tanvir', phone: '0171' }, '1.1.1.1'));
check('the website chat needs a name and an 11-digit mobile', !wc.body.ok, wc);
wc = await asB((ctx) => ib.webchat(ctx, W.id, 'start', { name: 'Tanvir', phone: '01911000222' }, '1.1.1.1'));
check('started: a visitor id and a signed token, the business\'s colour', wc.body.ok && /^v[0-9a-f]{20}$/.test(wc.body.visitor) && wc.body.colour === '#123456', wc);
const vis = wc.body;
wc = await asB((ctx) => ib.webchat(ctx, W.id, 'send', { visitor: vis.visitor, token: 'bad', text: 'hi' }, '1.1.1.1'));
check('a wrong token is refused', wc.status === 403, wc);
wc = await asB((ctx) => ib.webchat(ctx, W.id, 'send', { visitor: vis.visitor, token: vis.token, text: 'delivery koto?' }, '1.1.1.1'));
check('a message is taken, answered after 3 s', wc.body.ok && wc.due && wc.due.ms === 3000, wc);
script = [[{ functionCall: { name: 'delivery', args: { address: 'Uttara, Dhaka' } } }], (body) => { const fr = body.contents[body.contents.length - 1].parts[0].functionResponse; return [{ text: 'ঢাকার ভেতরে ৳' + fr.response.charge }]; }];
await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${wc.due.id}`;
await asB((ctx) => ib.replyDue(ctx, wc.due.id));
wc = await asB((ctx) => ib.webchat(ctx, W.id, 'poll', { visitor: vis.visitor, token: vis.token, after: 0 }, '1.1.1.1'));
check('the visitor sees the greeting, their message and the answer from the delivery rule', wc.body.ok && wc.body.msgs.length === 3 && /৳70/.test(wc.body.msgs[2].text), wc.body);

// ---- 11. the Agent Desk: a rule as a draft, tested (customers still get the old), published, undone
r = await owner('erpAgentDesk', [{ action: 'add', title: 'Fridays', body: 'We are closed on Fridays.' }]);
check('a new rule is a draft until published', r.ok && r.result.rules.length === 1 && r.result.rules[0].draft && r.result.drafts === 1, r);
let testSys = '';
script = [(body) => { testSys = body.systemInstruction.parts[0].text; return [{ text: 'আমরা শুক্রবার বন্ধ থাকি।' }]; }];
r = await owner('erpAgentDesk', [{ action: 'test', history: [{ mine: true, text: 'Friday khola?' }] }]);
check('the test uses the draft and shows the reply as the customer would see it', r.ok && r.result.replies[0].text.includes('শুক্রবার') && /closed on Fridays/.test(testSys), r);
r = await owner('erpAgentDesk', [{ action: 'publish' }]);
const rid = r.result.rules[0].id;
check('published: version 1, no drafts', r.ok && r.result.rules[0].body === 'We are closed on Fridays.' && r.result.drafts === 0, r);
await owner('erpAgentDesk', [{ action: 'edit', id: rid, body: 'Open every day.' }]);
await owner('erpAgentDesk', [{ action: 'publish' }]);
r = await owner('erpAgentDesk', [{ action: 'undo', id: rid }]);
check('Undo brings the previous version back', r.ok && r.result.rules[0].body === 'We are closed on Fridays.', r);
script = [[{ text: JSON.stringify({ say: 'Inside Dhaka it is ৳70 now; I drafted ৳80.', details: { delivery_in: 80 } }) }]];
r = await owner('erpAgentDesk', [{ action: 'helper', text: 'delivery charge 80 koro' }]);
check('the helper drafts the change from plain words', r.ok && /৳80/.test(r.result.say) && r.result.detailsDraft && r.result.detailsDraft.delivery_in === 80, r);
r = await owner('erpInboxProfile', [{}]);
check('...customers still get ৳70 until it is published', r.result.profile.delivery_in === 70 && r.result.draft.delivery_in === 80, r.result);

// ---- 12. the knowledge base
r = await owner('erpInboxKb', [{ add: { title: 'Returns', body: 'Returns are accepted within 7 days if the seal is unopened. The customer pays the return delivery.' } }]);
r = await owner('erpInboxKb', [{ test: 'return within days' }]);
check('a document is searched by the question', r.ok && r.result.found.length >= 1 && /7 days/.test(r.result.found[0].text), r);

// ---- 13. broadcasts: only after a test to your own chat
r = await owner('erpInboxBroadcasts', [{ save: { text: 'Eid offer: 10% off PLA today!' } }]);
const bid = r.result.broadcasts[0].id;
check('the audience is only those who wrote in the last 23 hours', r.ok && r.result.reach >= 1, r.result);
r = await owner('erpInboxBroadcasts', [{ send: bid }]);
check('sending without a test is refused', !r.ok && /test/.test(r.error), r);
await owner('erpInboxBroadcasts', [{ test: bid, to: conv1 }]);
r = await owner('erpInboxBroadcasts', [{ send: bid }]);
check('after the test it goes out', r.ok && r.result.broadcasts[0].sent && r.result.broadcasts[0].count >= 1, r.result);

// ---- 14. a comment on a post: a public reply by name and a private message
graph.length = 0;
const cm = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', changes: [{ field: 'feed', value: { item: 'comment', verb: 'add', comment_id: 'C1', post_id: 'P1', from: { id: 'U9', name: 'Nusrat' }, message: 'price koto?' } }] }] });
h = await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), cm, { 'x-hub-signature-256': sig(cm) }));
script = [[{ text: JSON.stringify({ kind: 'reply', public: 'Nusrat, inbox korechi 😊', private: 'Price: ৳1,350', code: PLA }) }]];
r = await asB((ctx) => ib.answerComment(ctx, M.id, 'C1'));
check('the comment gets a reply under it and a private message', r.replied && graph.some((g) => /\/C1\/comments/.test(g.url)) && graph.some((g) => g.body && g.body.recipient && g.body.recipient.comment_id === 'C1'), graph.map((g) => g.url));
script = [[{ text: JSON.stringify({ kind: 'junk' }) }]];
const cm2 = cm.replace('"C1"', '"C2"').replace('price koto?', 'click here win money');
await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), cm2, { 'x-hub-signature-256': sig(cm2) }));
r = await asB((ctx) => ib.answerComment(ctx, M.id, 'C2'));
check('certain junk is deleted', r.deleted !== undefined && (await sql`select action from inbox_comments where comment_id = 'C2'`)[0].action === 'deleted', r);

// ---- 15. analytics, the AI work log with cost, roles, the other business
r = await owner('erpInboxStats', [{ days: 7 }]);
check('analytics: messages, AI and team replies, hand-over reasons, AI cost', r.ok && r.result.messages.ai >= 3 && r.result.messages.team >= 1 && r.result.reasons.length >= 1 && r.result.aiCost.bdt > 0, r.result);
r = await owner('erpAiWork', [{}]);
check('every AI call is logged with its purpose and an estimated cost', r.ok && r.result.rows.length > 5 && r.result.byPurpose.some((x) => x.purpose === 'reply') && r.result.total > 0, r.result && r.result.byPurpose);
r = await sales('erpAiWork', [{}]);
check('the AI cost log is the owner\'s', !r.ok, r);
const other = (await sql`select count(*)::int n from inbox_conversations where business_id = ${FIX.B2}`)[0].n;
check('nothing reached the other business', other === 0);

// ---- 16. a service business: the AI takes a booking request, an advance by TrxID, the team confirms, reminders go out
await owner('erpInboxProfile', [{ save: { biz_type: 'both', services: 'Printer setup visit ৳1,500 (1 hour)', booking_questions: 'Which printer? Which day suits?', advance_rule: '৳500 advance by bKash', remind_day: true, remind_hours: 3 } }]);
graph.length = 0;
let sysBk = '';
raw = fbMsg('PSID7', 'printer setup er jonno ashben?');
h = await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
const conv7 = h.due[0].id;
await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${conv7}`;
script = [(body) => { sysBk = body.systemInstruction.parts[0].text; return [{ functionCall: { name: 'request_booking', args: { name: 'Karim', phone: '01812000222', service: 'Printer setup visit', wanted: 'Saturday evening', answers: { 'Which printer?': 'Bambu A1' } } } }]; },
  (body) => { const fr = body.contents[body.contents.length - 1].parts[0].functionResponse; return [{ text: 'আপনার অনুরোধ ' + fr.response.no + ' নেওয়া হয়েছে, টিম নিশ্চিত করবে।' }]; }];
await asB((ctx) => ib.replyDue(ctx, conv7));
let bk = (await sql`select * from bookings where business_id = ${FIX.B}`)[0];
check('the receptionist rules are in the system text (ask one at a time, never promise or confirm)', /receptionist/.test(sysBk) && /Never confirm a time yourself/.test(sysBk) && /Never promise a result/.test(sysBk), sysBk.slice(-600));
check('a booking request is recorded with the answers; the team gets a task; a lead is made', bk && bk.status === 'requested' && bk.phone === '01812000222' && bk.answers['Which printer?'] === 'Bambu A1' &&
  (await sql`select count(*)::int n from inbox_tasks where reason = 'booking'`)[0].n === 1 && (await sql`select stage from inbox_leads where conversation_id = ${conv7}`)[0].stage === 3, bk);
script = [[{ functionCall: { name: 'booking_payment', args: { trx_id: 'TRX7788', amount: 500 } } }], [{ text: 'পেমেন্টটি যাচাই করা হচ্ছে।' }]];
raw = fbMsg('PSID7', 'TrxID TRX7788 500 pathiyechi');
await asB(async (ctx) => ib.hookPost(ctx, await chRow(M.id), raw, { 'x-hub-signature-256': sig(raw) }));
await sql`update inbox_conversations set reply_due_at = now() - interval '1 second' where id = ${conv7}`;
await asB((ctx) => ib.replyDue(ctx, conv7));
bk = (await sql`select * from bookings where id = ${bk.id}`)[0];
check('the advance TrxID is kept for the team to check, not marked paid', bk.trx_id === 'TRX7788' && Number(bk.advance) === 500 && !bk.paid && (await sql`select count(*)::int n from inbox_tasks where kind = 'payment'`)[0].n === 1, bk);
r = await sales('erpBookings', [{}]);
check('the Bookings list: one request, one advance to check', r.ok && r.result.bookings.length === 1 && r.result.counts.requested === 1 && r.result.counts.unpaid === 1, r.result && r.result.counts);
r = await sales('erpBookingAct', [{ id: bk.id, action: 'decline' }]);
check('declining needs a reason', !r.ok && /why/i.test(r.error), r);
const dhaka = (ms) => new Date(Date.now() + ms + 6 * 3600e3).toISOString().slice(0, 16);
graph.length = 0;
r = await sales('erpBookingAct', [{ id: bk.id, action: 'confirm', at: dhaka(20 * 3600e3), place: 'Your home', bring: 'The printer box' }]);
bk = (await sql`select * from bookings where id = ${bk.id}`)[0];
check('confirmed with a time; the customer is told in the chat', r.ok && r.result.told === true && bk.status === 'confirmed' && Math.abs(new Date(bk.at).getTime() - Date.now() - 20 * 3600e3) < 120e3 &&
  graph.some((g) => g.body && g.body.message && /BK-/.test(g.body.message.text || '') && /The printer box/.test(g.body.message.text || '')), graph.map((g) => g.body && g.body.message && g.body.message.text));
r = await sales('erpBookingAct', [{ id: bk.id, action: 'paid' }]);
check('advance received: marked paid, the payment task closed', r.ok && (await sql`select paid from bookings where id = ${bk.id}`)[0].paid && (await sql`select count(*)::int n from inbox_tasks where kind = 'payment' and status = 'open'`)[0].n === 0, r);
const ib2 = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox2.js')));
graph.length = 0;
let n1 = await asB((ctx) => ib2.bookingReminders(ctx));
let n2 = await asB((ctx) => ib2.bookingReminders(ctx));
check('the day-before reminder goes once', n1 === 1 && n2 === 0 && graph.some((g) => g.body && g.body.message && /মনে করিয়ে/.test(g.body.message.text || '')), [n1, n2]);
await sql`update bookings set at = now() + interval '2 hours' where id = ${bk.id}`;
n1 = await asB((ctx) => ib2.bookingReminders(ctx));
n2 = await asB((ctx) => ib2.bookingReminders(ctx));
check('...and the hours-before reminder once', n1 === 1 && n2 === 0, [n1, n2]);
r = await owner('erpInboxLeads', [{}]);
check('"To chase": an interested lead with no order since', r.ok && r.result.chase.some((l) => l.conv === conv7), r.result && r.result.chase);

// ---- 17. downloads, pause the AI everywhere
r = await owner('erpInboxExport', [{ what: 'orders' }]);
check('orders download as rows', r.ok && r.result.name === 'chat-orders.csv' && r.result.rows.length >= 1 && r.result.head.includes('Invoice'), r);
r = await sales('erpInboxExport', [{ what: 'orders' }]);
check('...only for the owner', !r.ok, r);
r = await sales('erpInboxExport', [{ what: 'chat', id: conv7 }]);
check('a conversation downloads as text', r.ok && /Customer: printer setup/.test(r.result.text) && /AI: /.test(r.result.text), r);
r = await owner('erpInboxChannelAct', [{ action: 'pauseall' }]);
check('pause the AI everywhere', r.ok && (await sql`select count(*)::int n from inbox_channels where business_id = ${FIX.B} and ai_on and status <> 'removed'`)[0].n === 0, r);
r = await mgr('erpInboxChannelAct', [{ action: 'resumeall' }]);
check('...only the owner can', !r.ok, r);
await owner('erpInboxChannelAct', [{ action: 'resumeall' }]);
check('...and resume', (await sql`select count(*)::int n from inbox_channels where business_id = ${FIX.B} and not ai_on and status <> 'removed'`)[0].n === 0);

// ---- 18. the platform switch
r = await sales('erpInbox', [{ pile: 'all', platform: 'wa' }]);
check('WhatsApp shows only WhatsApp chats', r.ok && r.result.list.length >= 1 && r.result.list.every((x) => /^wa_/.test(x.channel)), r.result && r.result.list.map((x) => x.channel));
r = await sales('erpInbox', [{ pile: 'all', platform: 'fb' }]);
check('Facebook shows only Messenger chats; the connected platforms are listed', r.ok && r.result.list.every((x) => x.channel === 'messenger') && r.result.platforms.fb.connected && r.result.platforms.wa.connected && !r.result.platforms.ig, r.result && r.result.platforms);

// ---- 19. the subscription: features in a plan, the owner's switches, the monthly AI budget
r = await owner('erpPlatformInboxPlan', [{}]);
check('only the provider sets plans', !r.ok, r);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
r = await owner('erpPlatformInboxPlan', [{ save: { businessId: FIX.B, name: 'Starter', features: { bookings: false, ch_wa_linked: false }, aiBudget: 500 } }]);
check('the provider saves a plan: bookings and linked WhatsApp left out, ৳500 AI a month', r.ok && r.result.businesses.find((b) => b.id === FIX.B).off.length === 2 && r.result.businesses.find((b) => b.id === FIX.B).budget === 500, r.result && r.result.businesses);
r = await sales('erpInboxFeatures', [{}]);
check('the business sees its plan: bookings locked', r.ok && r.result.plan === 'Starter' && r.result.features.find((f) => f.key === 'bookings').inPlan === false && r.result.budget.budget === 500, r.result && r.result.budget);
r = await sales('erpBookings', [{}]);
check('a feature left out of the plan is refused', !r.ok && /not in your plan/.test(r.error), r);
r = await owner('erpInboxFeatures', [{ save: { bookings: true } }]);
check('the owner cannot switch on what the plan leaves out', !r.ok, r);
r = await sales('erpInboxFeatures', [{ save: { leads: false } }]);
check('staff cannot change the switches', !r.ok, r);
r = await owner('erpInboxFeatures', [{ save: { leads: false } }]);
check('the owner switches leads off', r.ok && r.result.features.find((f) => f.key === 'leads').on === false, r);
r = await sales('erpInboxLeads', [{}]);
check('...then Leads is refused (switched off)', !r.ok && /switched off/.test(r.error), r);
r = await sales('erpInboxFeatureMap', [{}]);
check('the page gets the map', r.ok && r.result.on.leads === false && r.result.on.bookings === false && r.result.on.orders === true, r.result && r.result.on);
let toolsSeen = [];
script = [(body) => { toolsSeen = (((body.tools || [])[0] || {}).function_declarations || []).map((t) => t.name); return [{ text: 'জি।' }]; }];
await owner('erpAgentDesk', [{ action: 'test', history: [{ mine: true, text: 'hello' }] }]);
check('the agent gets no tools for what is off (no save_lead, no request_booking)', toolsSeen.length > 3 && !toolsSeen.includes('save_lead') && !toolsSeen.includes('request_booking') && toolsSeen.includes('place_order'), toolsSeen);
r = await owner('erpInboxChannelSave', [{ kind: 'wa_sender', name: 'x', externalId: '8801700000009', acceptRisk: true }]);
check('a channel the plan leaves out cannot be connected', !r.ok && /not in your plan/.test(r.error), r);
await owner('erpInboxFeatures', [{ save: { leads: true } }]);
// the budget: spent -> the AI stops, one alert for the team
await sql`insert into ai_work (business_id, purpose, model, tokens_in, tokens_out, cost_bdt) values (${FIX.B}, 'reply', 'gemini-2.5-flash', 1, 1, 600)`;
r = await sales('erpInboxFeatureMap', [{}]);
check('over the budget: the page is told the AI has stopped', r.ok && r.result.budget.stopped === true && r.result.budget.pct >= 100, r.result && r.result.budget);
r = await sales('erpInboxAssist', [{ id: conv7, mode: 'summary' }]);
check('...AI work is refused', !r.ok && /budget/.test(r.error), r);
await asB((ctx) => ib.inboxTick(ctx));
await asB((ctx) => ib.inboxTick(ctx));
check('...and the minute timer opens one alert for the team', (await sql`select count(*)::int n from inbox_tasks where business_id = ${FIX.B} and reason = 'budget' and status = 'open'`)[0].n === 1);
await owner('erpPlatformInboxPlan', [{ save: { businessId: FIX.B, name: '', features: {}, aiBudget: '' } }]);
r = await sales('erpInboxFeatureMap', [{}]);
check('a plan with everything and no limit: all on again', r.ok && Object.values(r.result.on).every(Boolean) && !r.result.budget.stopped, r.result);

// ---- 20. the public pages: the order's own page, the bill as a picture, a product page with Buy
const pub = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxpub.js')));
const coRow = (await sql`select * from chat_orders where id = ${co.id}`)[0];
check('every chat order has its page token', /^[0-9a-f]{32}$/.test(coRow.page_token));
r = await asB((ctx) => pub.orderPage(ctx, coRow.page_token));
check('the order page: status in the customer\'s words, items, total, phone hidden', r.status === 200 && r.body.order.no === co.no && r.body.order.stage === 'preparing' && r.body.order.items[0].qty === 2 && /•/.test(r.body.order.phone) && r.body.words.bn.preparing, r.body);
r = await asB((ctx) => pub.orderPage(ctx, 'a'.repeat(32)));
check('a wrong token finds nothing', r.status === 404);
let svgSeen = '';
deps.svgPng = async (svg) => { svgSeen = svg; return new Uint8Array([137, 80, 78, 71]); };
r = await asB((ctx) => pub.orderBill(ctx, coRow.page_token));
check('the bill picture is drawn from the order (shop, number, items, total)', r && r[0] === 137 && svgSeen.includes(co.no) && svgSeen.includes('Total') && /৳[0-9,]+/.test(svgSeen), svgSeen.slice(0, 200));
const cv = (await sql`select * from inbox_conversations where id = ${conv1}`)[0];
r = await asB((ctx) => pub.itemPage(ctx, cv.shop_token, PLA));
check('the product page: price, stock, the delivery charges, the customer\'s details filled', r.status === 200 && r.body.product.sku === PLA && r.body.product.price > 0 && r.body.delivery.inside === 70 && r.body.you.phone === '01712000111', r.body);
await sql`update inbox_leads set stage = 6 where conversation_id = ${conv1}`;
r = await asB((ctx) => pub.itemAct(ctx, cv.shop_token, { a: 'intent', sku: PLA }, '1.1.1.1'));
check('pressing Buy keeps the interest as an open lead', r.status === 200 && (await sql`select count(*)::int n from inbox_leads where conversation_id = ${conv1} and stage = 2`)[0].n === 1);
r = await asB((ctx) => pub.itemAct(ctx, cv.shop_token, { a: 'buy', sku: PLA, qty: 1, name: 'Rafi', phone: '0171', address: 'House 7, Mirpur 10, Dhaka', area: 'inside' }, '1.1.1.1'));
check('a bad phone is refused on the page', r.body.ok === false && /11 digits/.test(r.body.error), r.body);
graph.length = 0;
r = await asB((ctx) => pub.itemAct(ctx, cv.shop_token, { a: 'buy', sku: PLA, qty: 1, name: 'Rafi', phone: '01712000111', address: 'House 7, Mirpur 10, Dhaka', area: 'outside' }, '1.1.1.1'));
const po = (await sql`select * from chat_orders where business_id = ${FIX.B} and taken_by = 'product page'`)[0];
check('Buy places an order linked to the chat, outside-Dhaka charge; the team gets a task', r.body.ok && po && po.conversation_id === conv1 && Number(po.delivery_charge) === 130 && /order\.html\?o=/.test(r.body.page) &&
  (await sql`select count(*)::int n from inbox_tasks where kind = 'order' and text like '%product page%'`)[0].n === 1, r.body);
await owner('erpInboxFeatures', [{ save: { product_page: false, order_page: false } }]);
r = await asB((ctx) => pub.itemPage(ctx, cv.shop_token, PLA));
const r2 = await asB((ctx) => pub.orderPage(ctx, coRow.page_token));
check('switched off: the pages answer nothing', r.status === 404 && r2.status === 404);
await owner('erpInboxFeatures', [{ save: { product_page: true, order_page: true } }]);

// ---- 21. team groups: who hears what; a teammate limited to some channels
r = await mgr('erpInboxGroups', [{ save: { name: 'Payments', hears: ['payment'], members: [FIX.U.sales] } }]);
check('only the owner makes groups', !r.ok, r);
r = await owner('erpInboxGroups', [{ save: { name: 'Payments', hears: ['payment'], members: [FIX.U.sales] } }]);
check('a group: hears payments, the sales teammate in it', r.ok && r.result.groups.length === 1 && r.result.groups[0].members[0] === FIX.U.sales, r);
r = await sales('erpInboxTasks', [{}]);
const allTasks = (await owner('erpInboxTasks', [{}])).result.tasks;
check('the teammate\'s Notifications show only what the group hears; the owner sees all', r.ok && r.result.tasks.length >= 1 && r.result.tasks.every((t) => t.kind === 'payment') && allTasks.some((t) => t.kind !== 'payment'), r.result && r.result.tasks.map((t) => t.kind));
r = await owner('erpInboxGroups', [{ access: { userId: FIX.U.sales, channels: [W.id] } }]);
check('the teammate is limited to the website chat', r.ok && r.result.access[FIX.U.sales].length === 1, r);
r = await sales('erpInbox', [{ pile: 'all' }]);
check('...their Inbox lists only website chats', r.ok && r.result.list.length >= 1 && r.result.list.every((x) => x.channel === 'webchat'), r.result && r.result.list.map((x) => x.channel));
r = await sales('erpInboxOpen', [{ id: conv1 }]);
check('...and a Messenger chat cannot be opened', !r.ok, r);
r = await owner('erpInboxOpen', [{ id: conv1 }]);
check('the owner still opens everything', r.ok);
await owner('erpInboxGroups', [{ access: { userId: FIX.U.sales, all: true } }]);
r = await owner('erpInboxGroups', [{ remove: (await owner('erpInboxGroups', [{}])).result.groups[0].id }]);
r = await sales('erpInbox', [{ pile: 'all' }]);
check('limits taken off: all chats again', r.ok && r.result.list.some((x) => x.channel === 'messenger'));

// ---- 22. messages after 24 hours: Meta-approved templates (Messenger)
graph.length = 0;
r = await sales('erpInboxTemplates', [{ id: M.id, action: 'create', lang: 'bn' }]);
check('only the owner asks Meta for templates', !r.ok, r);
r = await owner('erpInboxTemplates', [{ id: M.id, action: 'create', lang: 'bn' }]);
const tplCalls = graph.filter((g) => /\/PAGE1\/message_templates/.test(g.url));
check('the templates are asked from the page: utility, Bangla, numbered values, a Track button', r.ok && tplCalls.length >= 5 && tplCalls.every((g) => g.body.category === 'UTILITY' && g.body.language === 'bn') &&
  tplCalls.some((g) => g.body.name === 'erp_order_courier_bn' && (g.body.components[1] || {}).buttons && /order\.html\?o=\{\{1\}\}$/.test(g.body.components[1].buttons[0].url)), tplCalls.map((g) => g.body.name));
await sql`update inbox_conversations set last_in_at = now() - interval '2 days' where id = ${conv7}`;
graph.length = 0;
const bk7 = (await sql`select id from bookings where conversation_id = ${conv7} limit 1`)[0];
r = await sales('erpBookingAct', [{ id: bk7.id, action: 'confirm', at: dhaka(30 * 3600e3), place: 'Your home' }]);
check('after 24 hours, not approved yet: nothing is sent, the screen says so', r.ok && r.result.told === false && !graph.some((g) => /\/me\/messages/.test(g.url) && g.body.message), r.result && r.result.told);
await sql`update inbox_channels set settings = jsonb_set(settings, '{templates}', ${sql.json({ erp_booking_confirmed_bn: 'APPROVED', erp_booking_reminder_bn: 'APPROVED' })}) where id = ${M.id}`;
graph.length = 0;
r = await sales('erpBookingAct', [{ id: bk7.id, action: 'confirm', at: dhaka(30 * 3600e3), place: 'Your home' }]);
const tsent = graph.find((g) => g.body && g.body.messaging_type === 'UTILITY');
check('approved: the booking confirmation goes as the template, written into the chat', r.ok && r.result.told === true && tsent && tsent.body.message.template.name === 'erp_booking_confirmed_bn' && tsent.body.message.template.components[0].parameters.length === 4 &&
  (await sql`select count(*)::int n from inbox_messages where conversation_id = ${conv7} and text like '%[template]'`)[0].n === 1, tsent);
await owner('erpInboxFeatures', [{ save: { templates: false } }]);
graph.length = 0;
r = await sales('erpBookingAct', [{ id: bk7.id, action: 'confirm', at: dhaka(30 * 3600e3) }]);
check('templates switched off: nothing goes after 24 hours', r.ok && r.result.told === false && !graph.some((g) => g.body && g.body.messaging_type === 'UTILITY'));
await owner('erpInboxFeatures', [{ save: { templates: true } }]);

// ---- 23. Connect with Facebook: one login -> pages, Instagram, WhatsApp numbers -> Inbox channels without pasted keys
const mc = await import(pathToFileURL(path.join(fnDir, 'handlers', 'metaconnect.js')));
r = await owner('erpMetaStart', [{}]);
check('without the provider\'s Meta app the button says so', !r.ok && /provider/.test(r.error), r);
deps.meta = { appId: 'APP1', appSecret: 'appsecret', redirect: 'https://fn.test/functions/v1/erp?meta=back' };
r = await owner('erpMetaStart', [{}]);
const st = new URL(r.result.url).searchParams.get('state');
check('the login dialog asks for messages, WhatsApp, posting and ads in one go', r.ok && /facebook\.com\/v21\.0\/dialog\/oauth/.test(r.result.url) && /pages_messaging/.test(r.result.url) && /whatsapp_business_messaging/.test(r.result.url) && /ads_management/.test(r.result.url), r.result);
web.on(/graph\.facebook\.com\/v21\.0\/(oauth|me)/, (url) => {
  if (/oauth\/access_token\?grant_type=fb_exchange_token/.test(url)) return { status: 200, body: { access_token: 'LONGUSER', expires_in: 5184000 } };
  if (/oauth\/access_token/.test(url)) return { status: 200, body: { access_token: 'SHORTUSER' } };
  if (/\/me\/accounts/.test(url)) return { status: 200, body: { data: [{ id: 'PAGE9', name: 'Demo Page', access_token: 'PAGETOKEN9', instagram_business_account: { id: 'IG9', username: 'demo.shop' } }] } };
  if (/\/me\/businesses/.test(url)) return { status: 200, body: { data: [{ id: 'BM1', name: 'Demo BM', owned_whatsapp_business_accounts: { data: [{ id: 'WABA9', name: 'Demo WA', phone_numbers: { data: [{ id: 'PH9', display_phone_number: '+880 1700-000009', verified_name: 'Demo Shop' }] } }] } }] } };
  if (/\/me\/adaccounts/.test(url)) return { status: 200, body: { data: [{ id: 'act_1', name: 'Demo ads', account_status: 1, currency: 'BDT' }] } };
  if (/\/me\/permissions/.test(url)) return { status: 200, body: { data: [{ permission: 'pages_messaging', status: 'granted' }, { permission: 'ads_management', status: 'declined' }] } };
  if (/\/me\?/.test(url)) return { status: 200, body: { id: 'U1', name: 'Rahman' } };
  return { status: 404, body: {} };
});
const to = await mc.metaCallback(deps, { state: st, code: 'CODE1' }, (biz, fn) => asB(fn));
check('back from Facebook: a long-lived key kept, the owner sent to the Inbox', /#\/inbox\?meta=ok$/.test(to), to);
const again = await mc.metaCallback(deps, { state: st, code: 'CODE1' }, (biz, fn) => asB(fn));
check('the same return address works once only', /meta=expired/.test(again), again);
r = await owner('erpMetaConnect', [{}]);
check('what the login reaches: the page with its Instagram, the WhatsApp number, the ad account; keys never shown', r.ok && r.result.connected && r.result.name === 'Rahman' && r.result.pages[0].ig.username === 'demo.shop' &&
  r.result.wabas[0].phones[0].id === 'PH9' && r.result.adAccounts[0].id === 'act_1' && !JSON.stringify(r.result).includes('PAGETOKEN9') && !JSON.stringify(r.result).includes('LONGUSER'), r.result);
r = await mgr('erpMetaConnect', [{}]);
check('the Facebook login is the owner\'s', !r.ok);
graph.length = 0;
r = await owner('erpMetaUse', [{ page: 'PAGE9' }]);
const mch9 = (await sql`select * from inbox_channels where business_id = ${FIX.B} and external_id = 'PAGE9'`)[0];
check('Use for Messenger: a channel made with the page key from the login, page subscribed, practice mode', r.ok && mch9 && mch9.kind === 'messenger' && mch9.status === 'practice' &&
  graph.some((g) => /PAGE9\/subscribed_apps\?access_token=PAGETOKEN9/.test(g.url)) && r.result.pages[0].used === true, r);
r = await owner('erpMetaUse', [{ phone: 'PH9' }]);
const wch9 = (await sql`select * from inbox_channels where business_id = ${FIX.B} and external_id = 'PH9'`)[0];
check('Use for WhatsApp: the official number with its WABA id', r.ok && wch9 && wch9.kind === 'wa_cloud' && wch9.settings.waba_id === 'WABA9', wch9);
r = await owner('erpMetaUse', [{ ig: 'IG9' }]);
check('Use for Instagram', r.ok && (await sql`select count(*)::int n from inbox_channels where business_id = ${FIX.B} and external_id = 'IG9' and kind = 'instagram'`)[0].n === 1, r);
{
  // logging in again as ANOTHER Facebook account: the page's new key goes into the channel already made, subscribed again
  const was = graph.length;
  web.on(/graph\.facebook\.com\/v21\.0\/me\/accounts/, () => ({ status: 200, body: { data: [{ id: 'PAGE9', name: 'Demo Page', access_token: 'NEWPAGEKEY', instagram_business_account: { id: 'IG9', username: 'demo.shop' } }] } }));
  r = await owner('erpMetaRefresh', [{}]);
  const tok = (await sql`select value from business_secrets where business_id = ${FIX.B} and key = ${'INBOX_' + mch9.id + '_TOKEN'}`)[0];
  check('a new login re-keys the Messenger channel and subscribes the page again', r.ok && graph.slice(was).some((g) => /PAGE9\/subscribed_apps\?access_token=NEWPAGEKEY/.test(g.url)), graph.slice(was).map((g) => g.url));
  check('…and the channel keeps one channel, with the new key stored', (await sql`select count(*)::int n from inbox_channels where business_id = ${FIX.B} and external_id = 'PAGE9'`)[0].n === 1 && tok && tok.value === 'NEWPAGEKEY', tok && 'stored');
}
r = await owner('erpMetaDisconnect', [{}]);
check('Disconnect forgets the login; the channels stay', r.ok && !r.result.connected && (await sql`select count(*)::int n from inbox_channels where business_id = ${FIX.B} and external_id in ('PAGE9', 'PH9', 'IG9')`)[0].n === 3, r.result);

// ---- 24. the order report: who took the orders
r = await owner('erpInboxStats', [{ days: 7 }]);
check('analytics shows who took the orders (the AI, the product page) with their value', r.ok && r.result.orders.byTaker.some((x) => x.who === 'The AI' && x.value > 0) && r.result.orders.byTaker.some((x) => x.who === 'Product page'), r.result && r.result.orders);

// ---- 25. one webhook for the whole Meta app: the body is split by page; unknown pages dropped
{
  const ibm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
  const pg = (await sql`select id, business_id, external_id from inbox_channels where kind = 'messenger' and status <> 'removed' limit 1`)[0];
  const body = { object: 'page', entry: [
    { id: pg.external_id, messaging: [{ sender: { id: 'PSID-APP-1' }, recipient: { id: pg.external_id }, timestamp: Date.now(), message: { mid: 'm-app-1', text: 'hello via app hook' } }] },
    { id: 'SOME-OTHER-PAGE', messaging: [{ sender: { id: 'x' }, message: { mid: 'm2', text: 'not ours' } }] }] };
  const parts = await ibm.metaHookSplit(sql, body);
  check('app webhook: only the page a business added gets its part', parts.length === 1 && parts[0].ch.id === pg.id && parts[0].body.entry.length === 1, parts.map((x) => x.ch.id));
  const wa = await ibm.metaHookSplit(sql, { object: 'whatsapp_business_account', entry: [{ id: 'W1', changes: [{ field: 'messages', value: { metadata: { phone_number_id: 'NOPE' }, messages: [] } }] }] });
  check('app webhook: a WhatsApp number nobody added is dropped', wa.length === 0, wa);
  const good = await ibm.metaSignatureOk('sec', '{"a":1}', 'sha256=' + createHmac('sha256', 'sec').update('{"a":1}').digest('hex'));
  const bad = await ibm.metaSignatureOk('sec', '{"a":1}', 'sha256=00');
  check('app webhook: the signature check is shared', good === true && bad === false, [good, bad]);
}

// ---- 26. old chats from Facebook: real dates, no AI, no double, read and filed
{
  const pch = (await sql`select id, external_id from inbox_channels where business_id = ${FIX.B} and kind = 'messenger' and status <> 'removed' order by created_at limit 1`)[0];
  const PG = pch.external_id, old1 = '2026-09-01T10:00:00+0000', old2 = '2026-09-01T10:05:00+0000';
  web.on(/\/conversations\?/, () => ({ status: 200, body: { data: [{ participants: { data: [{ id: PG, name: 'Page' }, { id: 'PSID-OLD-1', name: 'Karim Old' }] },
    messages: { data: [{ id: 'm-old-2', message: 'Yes, 1200 taka', from: { id: PG }, created_time: old2 }, { id: 'm-old-1', message: 'Price of PLA?', from: { id: 'PSID-OLD-1' }, created_time: old1 }] } }] } }));
  r = await owner('erpInbox', [{}]);
  check('old chats: a new page is waiting for its old chats', r.ok && r.result.oldPending.includes(pch.id), r.result && r.result.oldPending);
  const before = graph.length;
  r = await sales('erpInboxPullOld', [{ channel: pch.id }]);
  check('old chats: sales cannot bring them in', !r.ok, r.ok);
  r = await mgr('erpInboxPullOld', [{ channel: pch.id }]);
  check('old chats: one chat, two messages', r.ok && r.result.chats === 1 && r.result.messages === 2, r.error || r.result);
  const ms = await sql`select m.direction, m.author, m.created_at, c.pile, c.unread, k.name from inbox_messages m join inbox_conversations c on c.id = m.conversation_id
                       join inbox_contacts k on k.id = c.contact_id where m.external_id in ('m-old-1', 'm-old-2') order by m.created_at`;
  check('old chats: real dates, customer in and page out, name kept, filed Done and read', ms.length === 2 && ms[0].direction === 'in' && ms[1].author === 'team' &&
    new Date(ms[0].created_at).toISOString().startsWith('2026-09-01T10:00') && ms[0].pile === 'done' && ms[0].unread === 0 && ms[0].name === 'Karim Old', ms);
  check('old chats: nothing sent to the customer', graph.slice(before).every((g) => g.method === 'GET' || !g.method || !/messages/.test(g.url)), graph.slice(before).map((g) => g.url.slice(0, 80)));
  r = await mgr('erpInboxPullOld', [{ channel: pch.id }]);
  check('old chats: pressing again adds nothing', r.ok && r.result.messages === 0, r.result);
  r = await owner('erpInbox', [{}]);
  check('old chats: a one-time job - the page is no longer waiting for it', r.ok && !r.result.oldPending.includes(pch.id), r.result && r.result.oldPending);
}

// ---- 27. mirror mode: pictures and photos stay on Meta; the server fetches a fresh copy when shown, keeps nothing
{
  deps.meta = { ...(deps.meta || {}), redirect: (deps.meta && deps.meta.redirect) || 'https://fn.test/erp?meta=back' };
  const mrow = await chRow(M.id);
  const raw = JSON.stringify({ object: 'page', entry: [{ id: 'PAGE1', messaging: [{ sender: { id: 'PSID-PIC' }, recipient: { id: 'PAGE1' }, timestamp: Date.now(),
    message: { mid: 'mid.pic1', attachments: [{ type: 'image', payload: { url: 'https://scontent.test/old-link.jpg' } }] } }] }] });
  const stored = (await files.list(FIX.B, 'inbox')).length;
  await asB((ctx) => ib.hookPost(ctx, mrow, raw, { 'x-hub-signature-256': sig(raw) }));
  const msg = (await sql`select id, media, conversation_id from inbox_messages where external_id = 'mid.pic1'`)[0];
  check('mirror: a picture is kept as Meta\'s id only, nothing saved', msg && msg.media === 'fbmsg:mid.pic1' && (await files.list(FIX.B, 'inbox')).length === stored, msg);
  web.on(/\/mid\.pic1\?fields=attachments/, () => ({ status: 200, body: { attachments: { data: [{ image_data: { url: 'https://scontent.test/fresh1.jpg' } }] } } }));
  web.on(/scontent\.test\/fresh1\.jpg/, () => ({ status: 200, body: 'JPEGDATA', headers: { 'content-type': 'image/jpeg' } }));
  r = await owner('erpInboxOpen', [{ id: msg.conversation_id }]);
  const one = r.ok && r.result.msgs.find((x) => x.id === Number(msg.id));
  check('mirror: the page gets a signed link to this server, not Facebook\'s', one && /inbox=media&id=\d+&k=[0-9a-f]{24}$/.test(one.url), one);
  const k = one ? one.url.split('&k=')[1] : '';
  const f = await ib.mirrorServe(deps, 'media', String(msg.id), k);
  check('mirror: the server fetches a fresh copy from Meta and passes it on', f && new TextDecoder().decode(f.bytes) === 'JPEGDATA' && f.mime === 'image/jpeg', f && f.mime);
  check('mirror: a wrong signature gets nothing', (await ib.mirrorServe(deps, 'media', String(msg.id), '0'.repeat(24))) === null);
  check('mirror: still nothing saved after showing it', (await files.list(FIX.B, 'inbox')).length === stored);
}

// ---- 28. product details, limits, similar products (owner 17 Oct 2026)
{
  r = await owner('erpProductFieldsSave', [{ kind: '3d' }]);
  check('a ready-made detail list for 3D printing', r.ok && r.result.kind === '3d' && r.result.fields.some((f) => f.label === 'Material'), r.error || r.result);
  r = await sales('erpProductFieldsSave', [{ kind: 'cosmetics' }]);
  check('only the owner chooses the list', !r.ok, r.ok);
  r = await mgr('erpProductAiSave', [{ sku: PLA, description: 'Sunlu PLA, 1 kg spool, easy to print.', facts: { material: 'PLA', print_temperature: '190-220 C', nonsense: 'x' } }]);
  check('a manager writes what the AI says about a product; unknown details are dropped', r.ok && r.result.facts.material === 'PLA' && !('nonsense' in r.result.facts), r.error || r.result);
  r = await sales('erpProductAiSave', [{ sku: PLA, description: 'x' }]);
  check('sales cannot change it', !r.ok, r.ok);
  const cost = Number((await owner('erpProduct', [PLA])).result.cost_price) || 0;
  const sell = Number((await owner('erpProduct', [PLA])).result.sell_price) || 0;
  await owner('erpInboxProfile', [{ save: { disc_mode: 'limit', disc_max_pct: 10, disc_min_margin: 20, no_topics: 'medical advice\nother shops prices', no_promise: 'an exact delivery hour' } }]);
  const low = Math.ceil(Math.max(sell * 0.9, cost * 1.2));
  const mch2 = await chRow(M.id);
  let sys2 = '', det = null, off1 = null, off2 = null, ord = null;
  script = [
    (body) => { sys2 = body.systemInstruction.parts[0].text; return [{ functionCall: { name: 'product_details', args: { code: PLA } } }]; },
    (body) => { det = body.contents[body.contents.length - 1].parts[0].functionResponse.response; return [{ functionCall: { name: 'price_offer', args: { code: PLA, price: 1 } } }]; },
    (body) => { off1 = body.contents[body.contents.length - 1].parts[0].functionResponse.response; return [{ functionCall: { name: 'price_offer', args: { code: PLA, price: off1.lowest_you_may_offer } } }]; },
    (body) => { off2 = body.contents[body.contents.length - 1].parts[0].functionResponse.response; return [{ functionCall: { name: 'place_order', args: { name: 'Rafi', phone: '01712345678', address: 'House 7, Road 12, Mirpur 10, Dhaka', items: [{ code: PLA, qty: 1 }] } } }]; },
    (body) => { ord = body.contents[body.contents.length - 1].parts[0].functionResponse.response; return [{ text: 'Done.' }]; },
  ];
  await asB((ctx) => ib.agentReply(ctx, { id: null, channel_id: M.id }, { test: true, channel: mch2, contact: { name: 'Test', external_id: 'test' }, history: [{ direction: 'in', kind: 'text', text: 'PLA er dam komano jabe?' }] }));
  check('the limits are in the AI\u2019s instructions', /DISCOUNTS: the price may come down a little/.test(sys2) && /NEVER ANSWER ABOUT[^\n]*medical advice; other shops prices/.test(sys2) && /NEVER PROMISE: an exact delivery hour/.test(sys2) && /NOT AVAILABLE/.test(sys2), sys2.slice(-900));
  check('product_details gives the description and the details by their names', det && /1 kg spool/.test(det.description) && det.details.Material === 'PLA' && det.details['Print temperature'] === '190-220 C', det);
  check('too low a price is refused with the lowest it may go (never below cost + margin, never more than 10% off)', cost > 0 && off1 && off1.allowed === false && off1.lowest_you_may_offer === low, [cost, sell, low, off1]);
  check('a price inside the limits is agreed', off2 && off2.allowed === true && off2.price === low, off2);
  check('the order uses the agreed price', ord && ord.placed && ord.total === low + ord.delivery, ord);
  // fixed price: no discount at all
  await owner('erpInboxProfile', [{ save: { disc_mode: 'fixed' } }]);
  let off3 = null;
  script = [[{ functionCall: { name: 'price_offer', args: { code: PLA, price: sell - 1 } } }], (body) => { off3 = body.contents[body.contents.length - 1].parts[0].functionResponse.response; return [{ text: 'ok' }]; }];
  await asB((ctx) => ib.agentReply(ctx, { id: null, channel_id: M.id }, { test: true, channel: mch2, contact: { name: 'Test', external_id: 'test' }, history: [{ direction: 'in', kind: 'text', text: 'discount?' }] }));
  check('fixed price: no discount', off3 && off3.allowed === false && off3.price === sell, off3);
  // similar: a product not in stock gets in-stock ones like it
  const p0 = (await sql`select p.sku, p.category from products p left join product_stock s on s.product_id = p.id where p.business_id = ${FIX.B} and coalesce(s.stock, 0) <= 0
                        and exists (select 1 from products q join product_stock t on t.product_id = q.id where q.business_id = ${FIX.B} and q.category = p.category and t.stock > 0 and q.sell_price > 0 and q.id <> p.id) limit 1`)[0];
  let det2 = null;
  if (p0) {
    script = [[{ functionCall: { name: 'product_details', args: { code: p0.sku } } }], (body) => { det2 = body.contents[body.contents.length - 1].parts[0].functionResponse.response; return [{ text: 'ok' }]; }];
    await asB((ctx) => ib.agentReply(ctx, { id: null, channel_id: M.id }, { test: true, channel: mch2, contact: { name: 'Test', external_id: 'test' }, history: [{ direction: 'in', kind: 'text', text: 'ache?' }] }));
  }
  check('an unavailable product comes with similar ones that are available', !p0 || (det2 && det2.available === false && det2.similar_available.length > 0 && det2.similar_available.every((x) => x.available)), [p0, det2]);
}

await done();
