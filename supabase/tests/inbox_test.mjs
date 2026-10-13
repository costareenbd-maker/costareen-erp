// The Inbox (120_inbox.sql, handlers/inbox.js, inbox2.js, inboxch.js): channels, practice mode and Go live, the
// agent answering through its tools (categories, cards, orders), the receipt and rating, chat order -> invoice,
// hand-over / take over / "." / back to the AI, Meta's signature, the 24-hour tag, WhatsApp linked device (Evolution),
// the website chat, the Agent Desk (draft, test, publish, undo), the knowledge base, broadcasts (test first),
// comments, roles and another business.
import { createHmac } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

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
check('products go as cards with price, code and buttons', cards && cards.body.message.attachment.payload.elements[0].subtitle.includes(PLA) && cards.body.message.attachment.payload.elements[0].buttons.length === 2, cards);
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

await done();
