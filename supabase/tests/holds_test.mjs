// hold-1: an order that waits for the customer's OK (handlers/holds.js, invoice.js makeHold route, inbox.js holdReply):
// nothing touches stock / invoices until Confirm; the customer's page (Confirm / Not now); WhatsApp send and a "confirm"
// reply; Confirm makes the invoice through erpCreateInvoice; cancel; expiry; refusals.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir, pdfs } from './harness.mjs';

const hd = await import(pathToFileURL(path.join(fnDir, 'handlers', 'holds.js')));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.hookBase = 'https://fn.test/functions/v1/erp';

const PLA = 'FIL-SUN-PLA-BLA-001';
const stock = async () => Number((await sql`select coalesce(ps.stock, 0) s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${FIX.B} and p.sku = ${PLA}`)[0].s);
const invCount = async () => (await sql`select count(*)::int n from invoices where business_id = ${FIX.B}`)[0].n;
const holdRow = async (id) => (await sql`select * from order_holds where id = ${id}`)[0];
const order = (hold, qty = 2) => [{ customer: { name: 'Karim', phone: '01712345678', address: 'Mirpur 10, Dhaka', source: 'Steadfast' }, items: [{ sku: PLA, qty }],
  payMode: 'cod', paidNow: 0, deliveryCharge: 120, hold }];

const s0 = await stock(), i0 = await invCount();
const nextNo = async () => Number((await sql`select next_number from invoice_counters where business_id = ${FIX.B}`)[0]?.next_number || 1001);
const n0 = await nextNo();

// ---- 1. made and kept: nothing in the books
let r = await sales('erpCreateInvoice', order({ send: 'link', courier: true }));
check('sales staff can send an order for confirmation', r.ok && r.result.held && /^INV-\d{8}-\d{3,}$/.test(r.result.holdNo) && /hold\.html\?h=[0-9a-f]{32}/.test(r.result.link), r);
const h1 = r.result.id, no1 = r.result.holdNo;
check('it carries a real invoice number, kept for it (the counter moved on)', (await nextNo()) === n0 + 1 && no1.endsWith('-' + String(n0).padStart(3, '0')), [no1, n0, await nextNo()]);
check('the stock has not moved', (await stock()) === s0, await stock());
check('no invoice was made', (await invCount()) === i0);
const row1 = await holdRow(h1);
check('the bill the customer sees is the invoice\'s own pricing', Number(row1.grand_total) === 1350 * 2 + 120 && row1.snap.lines[0].qty === 2 && row1.book_courier === true, row1.snap);
check('it waits 7 days', Math.round((new Date(row1.expires_at) - new Date(row1.created_at)) / 86400000) === 7);
r = await sales('erpCreateInvoice', order({ send: 'link' }, 99));
check('the invoice\'s own checks refuse it (not enough stock)', !r.ok && /Not enough stock/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ ...order({ send: 'link' })[0], customer: { name: '', phone: '01712345678' } }]);
check('a customer name is needed, as on an invoice', !r.ok && /name is required/.test(r.error), r);

// ---- 2. the list
r = await sales('erpHolds', []);
check('the waiting list shows it, nothing short', r.ok && r.result.waiting === 1 && r.result.list[0].no === no1 && r.result.list[0].short.length === 0 && r.result.list[0].courier, r);

// ---- 3. the customer's page
const tok = row1.token;
let p = await asB((ctx) => hd.holdPage(ctx, tok));
check('the page shows the order, the phone half hidden', p.status === 200 && p.body.order.no === no1 && p.body.order.canAnswer && /•/.test(p.body.order.phone) && p.body.order.grand === 2820, p.body);
p = await asB((ctx) => hd.holdPage(ctx, '0'.repeat(32)));
check('a wrong link shows nothing', p.status === 404);
p = await asB((ctx) => hd.holdAct(ctx, tok, { a: 'yes' }));
check('the customer presses Confirm', p.body.order.state === 'said_yes' && !p.body.order.canAnswer && (await holdRow(h1)).customer_ok_how === 'page', p.body);
p = await asB((ctx) => hd.holdAct(ctx, tok, { a: 'no' }));
check('a second answer changes nothing', p.body.order.state === 'said_yes' && !(await holdRow(h1)).customer_no_at);
check('still nothing in the books after the customer\'s OK', (await stock()) === s0 && (await invCount()) === i0);

// ---- 4. Confirm makes the invoice
r = await sales('erpHoldConfirm', [{ id: h1 }]);
check('Confirm puts the same invoice (same number) in the books', r.ok && /\S/.test(r.result.invoiceNo) && r.result.invoiceNo === no1 && r.result.bookCourier === true, r);
const invNo = r.result.invoiceNo;
check('the stock goes down only now', (await stock()) === s0 - 2, await stock());
const inv = (await sql`select * from invoices where business_id = ${FIX.B} and invoice_no = ${invNo}`)[0];
check('the invoice is as it was sent: nothing added to its note, same total', inv && !/ORD-|confirmed/i.test(String(inv.note)) && Number(inv.grand_total) === 2820 && inv.payment_method === 'COD', inv && inv.note);
check('confirming used no new number', (await nextNo()) === n0 + 1);
check('the order is closed with its invoice', (await holdRow(h1)).status === 'confirmed' && (await holdRow(h1)).invoice_no === invNo);
r = await sales('erpHoldConfirm', [{ id: h1 }]);
check('it cannot be confirmed twice', !r.ok && /already invoice/.test(r.error), r);

// ---- 5. cancel
r = await sales('erpCreateInvoice', order({ send: 'link' }, 1));
const h2 = r.result.id;
const no2 = r.result.holdNo;
check('the next one gets the next invoice number', no2.endsWith('-' + String(n0 + 1).padStart(3, '0')), no2);
r = await sales('erpHoldCancel', [{ id: h2, reason: 'Customer changed mind' }]);
check('a waiting order can be cancelled', r.ok && (await holdRow(h2)).status === 'cancelled' && /Customer changed mind/.test((await holdRow(h2)).closed_reason), r);
r = await sales('erpHoldConfirm', [{ id: h2 }]);
check('a cancelled order cannot be confirmed', !r.ok && /no longer waiting/.test(r.error), r);
const tok2 = (await holdRow(h2)).token;
p = await asB((ctx) => hd.holdAct(ctx, tok2, { a: 'yes' }));
check('a declined invoice leaves nothing in the books', !(await sql`select 1 from invoices where business_id = ${FIX.B} and invoice_no = ${no2}`).length);
check('its page says cancelled and takes no answer', p.body.order.state === 'cancelled' && !(await holdRow(h2)).customer_ok_at, p.body);

// ---- 6. WhatsApp: sent from the "Sending only" number, and the customer's "confirm" reply
const evo = [];
web.on(/wa\.test/, (url, opts) => { evo.push({ url, body: opts.body ? JSON.parse(opts.body) : null }); return { status: 201, body: { key: { id: 'OUT' + evo.length } } }; });
const mk = async (name, purpose) => {
  const c = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'wa_evo', ${name}, ${'inst-' + name}, 'live', false, ${sql.json({ purpose })}) returning *`)[0];
  await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, ${'INBOX_' + c.id + '_URL'}, 'https://wa.test'), (${FIX.B}, ${'INBOX_' + c.id + '_KEY'}, 'K')`;
  return c;
};
const chat = await mk('Support', 'chat'), bills = await mk('Bills', 'send');
r = await sales('erpCreateInvoice', order({ send: 'wa' }, 1));
const h3 = r.result.id, no3 = r.result.holdNo;
check('sent on WhatsApp from the Sending-only number', r.ok && r.result.sent && r.result.via === 'Bills' && evo.some((x) => /inst-Bills/.test(x.url) && x.body.number === '8801712345678' && /hold\.html\?h=/.test(JSON.stringify(x.body))), r.result.sendError || evo.map((x) => x.url));
const sentDoc = evo.find((x) => /sendMedia\/inst-Bills/.test(x.url));
check('the customer gets the PDF (a document, not a picture)', sentDoc && sentDoc.body.mediatype === 'document' && sentDoc.body.mimetype === 'application/pdf' && sentDoc.body.fileName === 'Invoice_' + no3 + '.pdf' && sentDoc.body.media.length > 4 && /hold\.html\?h=/.test(sentDoc.body.caption), sentDoc && { ...sentDoc.body, media: '…' });
const ph = pdfs[pdfs.length - 1];
check('the PDF is the real invoice: its number, the invoice design, nothing about an order', ph && ph.html.includes(no3) && /INVOICE/.test(ph.html) && !/ORDER|Order no\./.test(ph.html), ph && ph.html.slice(0, 300));
const pg = await asB(async (ctx) => hd.holdPage(ctx, (await sql`select token from order_holds where hold_no = ${no3} and business_id = ${FIX.B}`)[0].token));
check('the page has a Download the PDF link', /inbox=holdpdf&h=[0-9a-f]{32}/.test(pg.body.pdf), pg.body.pdf);
const pf = await asB(async (ctx) => hd.holdPdf(ctx, (await sql`select token from order_holds where hold_no = ${no3} and business_id = ${FIX.B}`)[0].token));
check('the PDF link gives the file', pf && pf.length > 0, pf && pf.length);
check('the message is in the Inbox and the order marked sent', (await sql`select count(*)::int n from inbox_messages m join inbox_conversations v on v.id = m.conversation_id where v.channel_id = ${bills.id} and m.direction = 'out'`)[0].n === 1 && (await holdRow(h3)).sent_via === 'Bills');
r = await sales('erpHoldSend', [{ id: h3, channelId: chat.id }]);
check('sent again from another number', r.ok && r.result.via === 'Support', r);
const msg = (id, from, text) => JSON.stringify({ event: 'messages.upsert', data: { key: { remoteJid: from + '@s.whatsapp.net', fromMe: false, id }, pushName: 'Karim', message: { conversation: text } } });
await asB(async (ctx) => ib.hookPost(ctx, bills, msg('IN1', '8801712345678', 'printer kobe pabo?'), {}));
check('an ordinary message does not confirm', !(await holdRow(h3)).customer_ok_at);
await asB(async (ctx) => ib.hookPost(ctx, bills, msg('IN2', '8801999000111', 'confirm'), {}));
check('someone else\'s "confirm" does not confirm it', !(await holdRow(h3)).customer_ok_at);
await asB(async (ctx) => ib.hookPost(ctx, bills, msg('IN3', '8801712345678', 'Confirm ✅'), {}));
check('the customer\'s "Confirm" on WhatsApp marks it (even on the Sending-only number)', (await holdRow(h3)).customer_ok_how === 'whatsapp');
check('a note says so in the chat', (await sql`select count(*)::int n from inbox_messages m join inbox_conversations v on v.id = m.conversation_id where v.channel_id = ${bills.id} and m.direction = 'note' and m.text like ${'Customer confirmed invoice ' + no3 + '%'}`)[0].n === 1);
check('and the stock is still untouched', (await stock()) === s0 - 2);
r = await sales('erpHolds', []);
check('a "said yes" order comes first in the list', r.ok && r.result.list[0].id === h3 && r.result.list[0].customerOkHow === 'whatsapp' && r.result.saidYes === 1, r.result.list.map((x) => x.no));
r = await mgr('erpHoldConfirm', [{ id: h3 }]);
check('a manager confirms it, under the number it was sent with', r.ok && r.result.invoiceNo === no3 && (await holdRow(h3)).customer_ok_how === 'whatsapp', r);

// ---- 7. stock gone before Confirm; expiry
r = await sales('erpCreateInvoice', order({ send: 'link' }, 4));
const h4 = r.result.id;
await sales('erpCreateInvoice', [{ customer: { name: 'Walk in', phone: '01811111111' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full' }]);
r = await sales('erpHolds', []);
check('the list warns when the stock is no longer there', r.result.list.find((x) => x.id === h4).short.length === 1, r.result.list.find((x) => x.id === h4));
r = await sales('erpHoldConfirm', [{ id: h4 }]);
check('Confirm is refused by the invoice\'s stock check, nothing written', !r.ok && /Not enough stock/.test(r.error) && (await holdRow(h4)).status === 'waiting', r);
await sql`update order_holds set expires_at = now() - interval '1 hour' where id = ${h4}`;
const ex = await asB((ctx) => hd.expireHolds(ctx));
check('the nightly job closes it', ex.expired === 1 && (await holdRow(h4)).status === 'expired', ex);

// ---- 8. the other business sees none of it
check('owner of B sees B\'s orders only', (await owner('erpHolds', [{ pile: 'closed' }])).result.list.every((x) => /^INV-/.test(x.no)));
check('the YES words', hd.YES.test('ok') && hd.YES.test('হ্যাঁ') && hd.YES.test('ঠিক আছে') && !hd.YES.test('ok but change the colour') && !hd.YES.test('confirm korbo kal'));

done();
