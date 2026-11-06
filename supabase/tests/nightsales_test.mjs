// night-sales (6 Nov 2026, owner D15 + D17 + D18), made-up figures only:
//   D15 a walk-in with no phone is saved as "Walk-in", no customer record, paid in full only, never sent on WhatsApp;
//   D17 a waiting order is changed under the SAME number, and only after the changed invoice went out (or plain Save
//       books it at once under that number);
//   D18 the customer's "no" (WhatsApp reply or the page's Not now) closes the waiting order by itself.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, sales, check, done, deps, web, fnDir } from './harness.mjs';

const hd = await import(pathToFileURL(path.join(fnDir, 'handlers', 'holds.js')));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.hookBase = 'https://fn.test/functions/v1/erp';

const PLA = 'FIL-SUN-PLA-BLA-001';
const stock = async () => Number((await sql`select coalesce(ps.stock, 0) s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${FIX.B} and p.sku = ${PLA}`)[0].s);
const holdRow = async (id) => (await sql`select * from order_holds where id = ${id}`)[0];
const custCount = async () => (await sql`select count(*)::int n from customers where business_id = ${FIX.B}`)[0].n;
const nextNo = async () => Number((await sql`select next_number from invoice_counters where business_id = ${FIX.B}`)[0]?.next_number || 1001);
const order = (hold, qty = 1, extra = {}) => [{ customer: { name: 'Rahim Test', phone: '01712345670', address: 'House 1, Road 2, Mirpur', source: 'Steadfast' }, items: [{ sku: PLA, qty }],
  payMode: 'cod', paidNow: 0, deliveryCharge: 100, hold, ...extra }];

// ---------------------------------------------------------------- D15 walk-in without a phone
let c0 = await custCount();
let r = await sales('erpCreateInvoice', [{ customer: { name: '', phone: '', source: 'Customer pickup' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('a walk-in with no phone and no name is saved', r.ok && r.result.invoiceNo, r);
const wNo = r.ok && r.result.invoiceNo;
const wInv = wNo && (await sql`select * from invoices where business_id = ${FIX.B} and invoice_no = ${wNo}`)[0];
check('it is saved under the name "Walk-in", with no phone', wInv && wInv.customer_name === 'Walk-in' && !wInv.customer_phone, wInv && [wInv.customer_name, wInv.customer_phone]);
check('no customer record is made for it', (await custCount()) === c0 && wInv && !wInv.customer_id, [c0, await custCount()]);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Walk-in', phone: '', source: 'Customer pickup' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('the page may send the name "Walk-in" itself', r.ok && (await custCount()) === c0, r);
r = await sales('erpCreateInvoice', [{ customer: { name: '', phone: '', source: 'Customer pickup' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
check('a walk-in with no phone cannot leave a due', !r.ok && /pays in full/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ customer: { name: '', phone: '', source: 'Customer pickup' }, items: [{ sku: PLA, qty: 1 }], payMode: 'part', paidNow: 100, paymentMethod: 'Cash' }]);
check('nor pay only part', !r.ok && /pays in full/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ customer: { name: '', phone: '', source: 'Steadfast' }, items: [{ sku: PLA, qty: 1 }], payMode: 'cod' }]);
check('a courier sale still needs a name', !r.ok && /name is required/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Shopper Test', phone: '', source: 'Customer pickup' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
check('a named walk-in without a phone works as before (customer kept, due allowed)', r.ok && (await custCount()) === c0 + 1, r);
r = await sales('erpInvoiceWaSend', [{ invoiceNo: wNo, onlyPickup: true }]);
check('a "Walk-in" sale is never sent on WhatsApp', r.ok && !r.result.sent && r.result.skipped === 'no phone', r);

// ---------------------------------------------------------------- D17 change a waiting order, same number
const n0 = await nextNo();
r = await sales('erpCreateInvoice', order({ send: 'link' }, 1));
check('a waiting order is made', r.ok && r.result.held, r);
const h1 = r.result.id, no1 = r.result.holdNo, tok1 = (await holdRow(h1)).token;
check('it took one number', (await nextNo()) === n0 + 1);
await asB((ctx) => hd.holdAct(ctx, tok1, { a: 'yes' }));
check('the customer said yes to the first one', !!(await holdRow(h1)).customer_ok_at);
const s1 = await stock();

r = await sales('erpCreateInvoice', order({ send: 'wa', channelId: '00000000-0000-0000-0000-000000000000' }, 2, { holdReplaces: h1 }));
check('changed but not sent: refused, nothing changes', !r.ok && /Nothing changed/.test(r.error) && Number((await holdRow(h1)).grand_total) === 1350 + 100, r);
check('the customer\'s yes on the old one still stands', !!(await holdRow(h1)).customer_ok_at);

r = await sales('erpCreateInvoice', order({ send: 'link', days: 3 }, 2, { holdReplaces: h1 }));
check('the changed order keeps its number', r.ok && r.result.held && r.result.replaced && r.result.holdNo === no1 && r.result.id === h1, r);
const row = await holdRow(h1);
check('it now carries the new lines and total', Number(row.grand_total) === 1350 * 2 + 100 && row.snap.lines[0].qty === 2 && row.payload.items[0].qty === 2 && !('holdReplaces' in row.payload), row.snap);
check('the old version is kept in its history', (row.snap.changes || []).length === 1 && Number(row.snap.changes[0].grand) === 1450, row.snap.changes);
check('no new number was used, no second order made', (await nextNo()) === n0 + 1 && (await sql`select count(*)::int n from order_holds where business_id = ${FIX.B} and hold_no = ${no1}`)[0].n === 1);
check('the customer must say yes again to the changed invoice', !row.customer_ok_at && row.status === 'waiting', row);
check('the customer\'s link is the same and shows the change', row.token === tok1 && (await asB((ctx) => hd.holdPage(ctx, tok1))).body.order.grand === 2800);
check('nothing in the books or stock yet', (await stock()) === s1 && !(await sql`select 1 from invoices where business_id = ${FIX.B} and invoice_no = ${no1}`).length);
r = await sales('erpHolds', []);
check('the list says it was changed', r.ok && r.result.list.find((x) => x.id === h1).changed === 1, r.result && r.result.list);

// plain Save of a changed waiting order: booked now, same number
r = await sales('erpCreateInvoice', [{ ...order(undefined, 1)[0], holdReplaces: h1 }]);
check('plain Save books the changed order under the number the customer has', r.ok && r.result.invoiceNo === no1 && r.result.fromHold, r);
check('the waiting order is closed with that invoice', (await holdRow(h1)).status === 'confirmed' && (await holdRow(h1)).invoice_no === no1);
check('the stock goes down only now', (await stock()) === s1 - 1, await stock());
check('still no new number', (await nextNo()) === n0 + 1);
r = await sales('erpCreateInvoice', order({ send: 'link' }, 1, { holdReplaces: h1 }));
check('a closed order cannot be changed', !r.ok && /no longer waiting/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ ...order(undefined, 1)[0], holdReplaces: h1 }]);
check('nor saved twice', !r.ok && /no longer waiting/.test(r.error), r);

// ---------------------------------------------------------------- D18 the customer says no
r = await sales('erpCreateInvoice', order({ send: 'link' }, 1));
const h2 = r.result.id, tok2 = (await holdRow(h2)).token;
let p = await asB((ctx) => hd.holdAct(ctx, tok2, { a: 'no' }));
check('"Not now" on the page closes the order by itself', (await holdRow(h2)).status === 'cancelled' && /Not now/.test((await holdRow(h2)).closed_reason), await holdRow(h2));
check('the page tells the customer it was noted', p.body.order.state === 'said_no' && !p.body.order.canAnswer, p.body.order);
r = await sales('erpHoldConfirm', [{ id: h2 }]);
check('a declined order cannot be confirmed', !r.ok && /no longer waiting/.test(r.error), r);

const evo = [];
web.on(/wa\.test/, (url, opts) => { evo.push({ url, body: opts.body ? JSON.parse(opts.body) : null }); return { status: 201, body: { key: { id: 'OUT' + evo.length } } }; });
const ch = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'wa_evo', 'Bills test', 'inst-bt', 'live', false, ${sql.json({ purpose: 'send' })}) returning *`)[0];
await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, ${'INBOX_' + ch.id + '_URL'}, 'https://wa.test'), (${FIX.B}, ${'INBOX_' + ch.id + '_KEY'}, 'K')`;
r = await sales('erpCreateInvoice', order({ send: 'wa' }, 1));
check('a waiting order sent on WhatsApp', r.ok && r.result.sent, r);
const h3 = r.result.id;
const msg = (id, from, text) => JSON.stringify({ event: 'messages.upsert', data: { key: { remoteJid: from + '@s.whatsapp.net', fromMe: false, id }, pushName: 'Rahim', message: { conversation: text } } });
await asB(async (ctx) => ib.hookPost(ctx, ch, msg('NS1', '8801712345670', 'no problem, when will it come?'), {}));
check('a sentence that only mentions "no" changes nothing', (await holdRow(h3)).status === 'waiting');

// D17 by WhatsApp: changed and sent again - same number, the new PDF went out, then the order took the change
evo.length = 0;
r = await sales('erpCreateInvoice', order({ send: 'wa' }, 3, { holdReplaces: h3 }));
const doc = evo.find((x) => /sendMedia/.test(x.url));
check('changed and sent on WhatsApp under the same number', r.ok && r.result.replaced && r.result.sent && r.result.holdNo === (await holdRow(h3)).hold_no && doc && doc.body.fileName === 'Invoice_' + r.result.holdNo + '.pdf', r);
check('it waits with the new total, marked sent', Number((await holdRow(h3)).grand_total) === 1350 * 3 + 100 && !!(await holdRow(h3)).sent_at && (await holdRow(h3)).sent_via === 'Bills test');

await asB(async (ctx) => ib.hookPost(ctx, ch, msg('NS2', '8801712345670', 'লাগবে না'), {}));
const r3 = await holdRow(h3);
check('the customer\'s "লাগবে না" on WhatsApp closes it by itself', r3.status === 'cancelled' && !!r3.customer_no_at && /said no on WhatsApp/.test(r3.closed_reason), r3);
check('a note says so in the chat', (await sql`select count(*)::int n from inbox_messages m join inbox_conversations v on v.id = m.conversation_id where v.channel_id = ${ch.id} and m.direction = 'note' and m.text like ${'Customer said no to invoice %'}`)[0].n === 1);
check('nothing went into the books', !(await sql`select 1 from invoices where business_id = ${FIX.B} and invoice_no = ${r3.hold_no}`).length);

check('the NO words', hd.NO.test('no') && hd.NO.test('না') && hd.NO.test('Lagbe na') && hd.NO.test('বাতিল।') && !hd.NO.test('no problem') && !hd.NO.test('ok') && !hd.YES.test('না'));

done();
