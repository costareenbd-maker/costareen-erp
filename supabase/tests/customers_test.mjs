// Customers group: erpCustomers, erpSaveCustomer, erpCustomerStatement,
// erpStatementPdf, erpDueReminded, erpRecordPayment, erpMergeCustomers and
// the Tools exports fixCustomerPhones / fixPhones.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done, files, pdfs, deps, fnDir } from './harness.mjs';

const C = await import(pathToFileURL(path.join(fnDir, 'handlers', 'customers.js')));
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const DAY = 86400000;

/** Run an export directly, as the owner, the way core.js runs a handler. */
async function asOwner(fn) {
  const claims = JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' });
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${claims}, true)`;
    const ctx = { tx, sql, biz: B, now: new Date(), memo: {}, deps,
                  s: { userId: FIX.U.owner, name: 'Owner', role: 'owner', businessId: B, businessName: 'Costareen' } };
    return fn(ctx);
  });
}
const find = (list, name) => (list || []).find((c) => c.name === name);
const today = (d = new Date()) => {
  const z = new Date(d.getTime() + 6 * 3600e3);
  return z.getUTCDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][z.getUTCMonth()] + ' ' + z.getUTCFullYear();
};

// another business's customer must never show
await sql`insert into customers (business_id, name, phone) values (${FIX.B2}, 'Stranger', '01399999999')`;
await makeShareholder();

// ---------------------------------------------------------------- list
let r = await sales('erpCustomers', []);
let karim = find(r.result, 'Karim');
check('erpCustomers runs for sales, other business invisible', r.ok && !find(r.result, 'Stranger'), r);
check('no sales yet: sheet figures (orders 3, spent 4500), units 0, never bought',
  karim && karim.orders === 3 && karim.spent === 4500 && karim.units === 0 && karim.lastOrder === '' &&
  karim.daysSince === null && typeof karim.row === 'number' && karim.phone === '01712345678' && karim.address === 'Dhaka', karim);

r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678', address: 'Dhaka' },
  items: [{ sku: PLA, qty: 2 }], payMode: 'part', paidNow: 1000, paymentMethod: 'Cash' }]);
check('invoice for Karim saved (2700, 1000 paid)', r.ok && r.result.grandTotal === 2700, r);
const invK = r.result.invoiceNo;

// a return note, as the sheet wrote it: RTN- row, the customer's phone, negative qty and total
const rt = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, grand_total, payment_status)
                     values (${B}, 'RTN-T1', 'Karim', '01712345678', -1350, 'Paid') returning id`;
await sql`insert into invoice_lines (business_id, invoice_id, sku, qty, unit_price, line_total)
          values (${B}, ${rt[0].id}, ${PLA}, -1, 1350, -1350)`;

r = await sales('erpCustomers', []);
karim = find(r.result, 'Karim');
check('from the sales log: 1 order, units 2-1, spent 2700-1350 (returns included), today',
  karim && karim.orders === 1 && karim.units === 1 && karim.spent === 1350 && karim.daysSince === 0 && karim.lastOrder === today(), karim);
check('sorted by spent, highest first', r.result.every((c, i, a) => i === 0 || a[i - 1].spent >= c.spent), r.result.map((c) => c.spent));

// ---------------------------------------------------------------- save
r = await sales('erpSaveCustomer', [{ row: 0, name: 'Nasrin', phone: '0155' }]);
check('bad phone refused (phone checked first, as original)', !r.ok &&
  r.error === 'The phone number must be 11 digits starting with 01 - "0155" has 4. Correct it, or leave it empty.', r);
r = await sales('erpSaveCustomer', [{ row: 0, name: '  ', phone: '01555555555' }]);
check('name required', !r.ok && r.error === 'Customer name is required.', r);
r = await sales('erpSaveCustomer', [{ row: 0, name: 'Nasrin', phone: '1555555555', email: 'n@x.com', address: 'Uttara',
  type: 'Wholesale', status: 'VIP', source: 'Customer pickup' }]);
check('sales creates a customer', r.ok && r.result.ok && r.result.updated === false && r.result.name === 'Nasrin', r);
let nas = (await sql`select * from customers where business_id = ${B} and name = 'Nasrin'`);
check('created: phone tidied, email/type/status kept, no orders, no last order, CUS- id, key',
  nas.length === 1 && nas[0].phone === '01555555555' && nas[0].email === 'n@x.com' && nas[0].type === 'Wholesale' &&
  nas[0].status === 'VIP' && nas[0].total_orders === 0 && nas[0].last_order_at === null && /^CUS-\d+$/.test(nas[0].customer_no) &&
  nas[0].customer_key === '1555555555' && nas[0].source === 'Customer pickup', nas[0]);
r = await sales('erpCustomers', []);
let n1 = find(r.result, 'Nasrin');
check('new customer listed: 0 orders, never bought', n1 && n1.orders === 0 && n1.lastOrder === '' && n1.daysSince === null && n1.id === nas[0].customer_no, n1);

r = await sales('erpSaveCustomer', [{ row: 0, name: 'Nasrin Akter', phone: '+8801555555555', address: '' }]);
nas = (await sql`select * from customers where business_id = ${B} and phone = '01555555555'`);
check('creating someone who exists: no duplicate, no order counted, details kept (fix)', r.ok && r.result.updated === true &&
  nas.length === 1 && nas[0].total_orders === 0 && nas[0].name === 'Nasrin Akter' && nas[0].address === 'Uttara' &&
  nas[0].email === 'n@x.com' && nas[0].type === 'Wholesale', nas);

r = await sales('erpSaveCustomer', [{ row: n1.row, name: 'Nasrin A.', phone: '01555555556', email: '', address: 'Banani', type: '', status: 'Returning' }]);
nas = (await sql`select * from customers where business_id = ${B} and seq = ${n1.row}`)[0];
check('edit by row: every field written, type default Retail, source default Walk-in', r.ok && r.result.updated === true &&
  r.result.name === 'Nasrin A.' && nas.name === 'Nasrin A.' && nas.phone === '01555555556' && nas.email === '' &&
  nas.address === 'Banani' && nas.type === 'Retail' && nas.source === 'Walk-in' && nas.status === 'Returning' &&
  nas.customer_key === '1555555556', nas);
r = await sales('erpSaveCustomer', [{ row: 999999, name: 'Ghost', phone: '' }]);
check('edit of a row that is gone', !r.ok && r.error === 'That customer is no longer on the list. Reload and try again.', r);
const strangerSeq = (await sql`select seq from customers where name = 'Stranger'`)[0].seq;
r = await owner('erpSaveCustomer', [{ row: Number(strangerSeq), name: 'Hijack', phone: '' }]);
check("another business's customer cannot be edited", !r.ok && (await sql`select name from customers where seq = ${strangerSeq}`)[0].name === 'Stranger', r);

// ---------------------------------------------------------------- reminders
r = await sales('erpDueReminded', [{ phone: '', name: '' }]);
check('reminder needs someone', !r.ok && r.error === 'Whose reminder?', r);
r = await sales('erpDueReminded', [{ phone: '01712345678', name: 'Karim', due: '1700.4' }]);
const rem = await sql`select * from due_reminders where business_id = ${B}`;
check('reminder written: key, name, phone, rounded due, who', r.ok && r.result.ok && rem.length === 1 &&
  rem[0].customer_key === '1712345678' && rem[0].customer === 'Karim' && rem[0].due === 1700 && rem[0].reminded_by === 'Rina', rem);
r = await mgr('erpDues', []);
check('dues show the reminder as today', r.ok && r.result.byKey['1712345678'].reminded &&
  r.result.byKey['1712345678'].reminded.days === 0 && r.result.byKey['1712345678'].reminded.by === 'Rina', r.result.byKey);
check('each dues entry carries its own name and phone (the page lists only 100 customers)', Object.values(r.result.byKey).every((b) => b.name) &&
  r.result.byKey['1712345678'].phone && /1712345678$/.test(r.result.byKey['1712345678'].phone.replace(/\D/g, '')), r.result.byKey);

// ---------------------------------------------------------------- statement
// an old invoice 400 days ago, 200 recorded on the sheet but never in the ledger
const old = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, grand_total, advance_paid,
                        payment_status, created_at) values (${B}, 'INV-OLD', 'Karim', '8801712345678', 500, 200, 'Partial',
                        now() - interval '400 days') returning id`;
await sql`insert into invoice_lines (business_id, invoice_id, sku, qty, line_total) values (${B}, ${old[0].id}, ${PLA}, 1, 500)`;
// ledger rows of every kind, against today's invoice
const kAt = (await sql`select created_at from invoices where invoice_no = ${invK}`)[0].created_at.getTime();
await sql`insert into payments (business_id, payment_no, invoice_no, customer, amount, method, note, recorded_by, paid_at) values
  (${B}, 'R1', ${invK}, 'Karim', 100, 'Returned', '[return:RTN-T1]', 'Mehedi', ${new Date(kAt + 60000)}),
  (${B}, 'X1', ${invK}, 'Karim', 50, 'Adjusted', '', 'cutover 29 Sep', ${new Date(kAt + 120000)}),
  (${B}, 'F1', ${invK}, 'Karim', -20, 'Cash', 'refund', 'Mehedi', ${new Date(kAt + 180000)})`;
r = await mgr('erpTakeAdvance', [{ phone: '01712345678', name: 'Karim', amount: 300 }]);
check('advance taken', r.ok, r);

r = await sales('erpCustomerStatement', [{ phone: '', name: '' }]);
check('statement needs someone', !r.ok && r.error === 'Whose statement?', r);
r = await sales('erpCustomerStatement', [{ phone: '01712345678', name: 'Karim', days: 90 }]);
let s = r.result;
check('statement 3 months: old invoice folded into opening 300, phone = last row (as original)', r.ok && s.opening === 300 && s.days === 90 && s.business === 'Costareen' &&
  s.customer === 'Karim' && s.phone === '8801712345678', s);
const texts = s && s.rows.map((x) => x.text);
check('rows: invoice first, then payments, labels as original', s && JSON.stringify(texts) === JSON.stringify([
  'Invoice ' + invK + ' (2 items)', 'Payment – Cash', 'Goods returned', 'Paid – records brought up to date', 'Refund – Cash']), texts);
check('running balance and closing: 300+2700-1000-100-50+20 = 1870', s && s.closing === 1870 &&
  s.rows[s.rows.length - 1].balance === 1870 && s.rows[0].debit === 2700 && s.rows[4].debit === 20 &&
  s.totalDebit === 2720 && s.totalCredit === 1150, s);
check('advance held 300; RTN- note not an invoice', s && s.advance === 300 && !texts.some((t) => /RTN-T1 \(/.test(t)), s);
check('unpaid: oldest first with days', s && s.open.length === 2 && s.open[0].id === 'INV-OLD' && s.open[0].owed === 300 &&
  s.open[0].days === 400 && s.open[1].id === invK && s.open[1].owed === 1570, s && s.open);
r = await sales('erpCustomerStatement', [{ phone: '01712345678', days: 3650 }]);
s = r.result;
check('everything: old invoice + "Paid at the time of sale" 200, opening 0', r.ok && s.opening === 0 && s.rows.length === 7 &&
  s.rows[0].text === 'Invoice INV-OLD (1 item)' && s.rows[1].text === 'Paid at the time of sale' && s.rows[1].credit === 200 &&
  s.rows[1].balance === 300 && s.closing === 1870, s);
r = await sales('erpCustomerStatement', [{ phone: '01712345678', days: 2 }]);
check('days clamped to at least 7', r.ok && r.result.days === 7, r.result && r.result.days);
r = await sales('erpCustomerStatement', [{ phone: '01712345678', days: 'junk' }]);
check('days default 90', r.ok && r.result.days === 90, r.result && r.result.days);

// legacy split sale: two ORD- ids within 5 minutes are one sale; marked Paid
const t0 = Date.now() - 20 * DAY;
for (const [id, at, q] of [['ORD-' + t0, t0, 1], ['ORD-' + (t0 + 60000), t0 + 60000, 2]]) {
  const o = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, grand_total, payment_status, created_at)
                      values (${B}, ${id}, 'Lina', '01666666666', 800, 'Paid', ${new Date(at)}) returning id`;
  await sql`insert into invoice_lines (business_id, invoice_id, sku, qty, line_total) values (${B}, ${o[0].id}, ${PLA}, ${q}, 400)`;
}
r = await sales('erpCustomerStatement', [{ phone: '01666666666', name: 'Lina' }]);
s = r.result;
check('split ORD- sale is one invoice (3 items, 800), settled by "Paid"', r.ok && s.rows.length === 2 &&
  s.rows[0].text === 'Invoice ORD-' + t0 + ' (3 items)' && s.rows[0].debit === 800 && s.rows[1].text === 'Paid at the time of sale' &&
  s.closing === 0 && s.open.length === 0, s);
r = await sales('erpCustomerStatement', [{ phone: '', name: 'A' }]);
check('statement by name for a walk-in (no phone)', r.ok && r.result.rows.length === 1 && r.result.rows[0].text === 'Invoice INV-1 (9 items)', r.result);

// ---------------------------------------------------------------- statement PDF
r = await sales('erpStatementPdf', [{ phone: '01712345678', name: 'Karim', days: 90 }]);
const ymd = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10);
check('PDF saved as Statement_Karim_<today>.pdf in invoices', r.ok && r.result.name === 'Statement_Karim_' + ymd + '.pdf' &&
  /^https:\/\/files\.test\//.test(r.result.url) && files.list().includes(B + '/invoices/Statement_Karim_' + ymd + '.pdf'), r);
const html = pdfs.length ? pdfs[pdfs.length - 1].html : '';
check('PDF html (on the invoice design): title, opening, rows, closing, advance, unpaid, seal', html.includes('STATEMENT') && html.includes('Costareen') &&
  /Balance brought forward<\/td><td class="r"><\/td><td class="r"><\/td><td class="r">300</.test(html) &&
  /Balance due<\/span>[\s\S]*?BDT 1,870/.test(html) && html.includes('Advance held for you: BDT 300') && html.includes('INV-OLD (300)') &&
  html.includes('Goods returned · ' + invK) && html.includes('>PAYMENT DUE<'), html.slice(0, 400));
r = await sales('erpStatementPdf', [{ phone: '01712345678', name: 'Karim', days: 365 }]);
check('same-day statement replaced, not doubled', r.ok && files.list().filter((k) => k.includes('Statement_Karim_')).length === 1, files.list());
r = await sales('erpStatementPdf', [{ phone: '01666666666', name: 'Lina O\'Neil' }]);
check('file name: odd characters become _', r.ok && r.result.name === 'Statement_Lina_' + ymd + '.pdf', r);
r = await sales('erpStatementPdf', [{}]);
check('PDF needs someone', !r.ok && r.error === 'Whose statement?', r);

// ---------------------------------------------------------------- legacy payment
r = await sales('erpRecordPayment', [{ orderId: invK, amount: 10 }]);
check('sales cannot record payments', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await mgr('erpRecordPayment', [{ amount: 10 }]);
check('which invoice?', !r.ok && r.error === 'Which invoice?', r);
r = await mgr('erpRecordPayment', [{ orderId: invK, amount: 0 }]);
check('how much?', !r.ok && r.error === 'How much was received?', r);
r = await mgr('erpRecordPayment', [{ orderId: 'INV-NOPE', amount: 5 }]);
check('unknown invoice', !r.ok && r.error === 'No invoice called INV-NOPE.', r);
r = await mgr('erpRecordPayment', [{ orderId: invK, amount: 5000 }]);
check('more than owed (ledger 1130 of 2700)', !r.ok && r.error === 'That is more than is owed. ' + invK + ' has 1570 outstanding.', r);
r = await mgr('erpRecordPayment', [{ orderId: 'ORD-' + t0, amount: 5 }]);
check('owed the one way Dues works it out: an invoice marked Paid takes no more money (no overpayment)', !r.ok && r.error === 'That invoice is already settled.', r);
r = await mgr('erpRecordPayment', [{ orderId: invK, amount: 70, method: 'bKash', note: 'counter' }]);
check('payment recorded: still owed 1500, dues returned', r.ok && r.result.ok && r.result.orderId === invK && r.result.received === 70 &&
  r.result.stillOwed === 1500 && r.result.dues && typeof r.result.dues.total === 'number', r);
const pr = await sql`select * from payments where invoice_no = ${invK} and amount = 70`;
check('PAYMENTS row: P-stamp, method, note, recorded by', pr.length === 1 && /^P\d{12}$/.test(pr[0].payment_no) &&
  pr[0].method === 'bKash' && pr[0].note === 'counter' && pr[0].recorded_by === 'Mehedi' && pr[0].customer === 'Karim', pr);
const iv = (await sql`select * from invoices where invoice_no = ${invK}`)[0];
check('invoice synced from the ledger', iv.advance_paid === 1200 && iv.due_amount === 1500 && iv.payment_status === 'Partial', iv);
await sql`insert into invoices (business_id, invoice_no, customer_name, grand_total) values (${B}, 'INV-ZERO', 'Z', 0)`;
const zi = (await sql`select id from invoices where invoice_no = 'INV-ZERO'`)[0].id;
await sql`insert into invoice_lines (business_id, invoice_id, sku, qty) values (${B}, ${zi}, ${PLA}, 1)`;
r = await mgr('erpRecordPayment', [{ orderId: 'INV-ZERO', amount: 5 }]);
check('settled invoice', !r.ok && r.error === 'That invoice is already settled.', r);

// ---------------------------------------------------------------- merge
await sql`insert into customers (business_id, customer_no, name, phone, address, email, total_orders, total_spent) values
  (${B}, 'CUS-1', 'Rafi', '1700000001', 'A', '', 2, 100)`;
await sql`insert into customers (business_id, customer_no, name, phone, address, email, total_orders, total_spent) values
  (${B}, 'CUS-2', 'Rafi Ahmed', '+8801700000001', 'Longer address', 'r@x.com', 1, 50)`;
await sql`insert into customers (business_id, customer_no, name, phone, address, email, total_orders, total_spent) values
  (${B}, 'CUS-3', 'R', '01700000001', '', 'z@x.com', 4, 25.5)`;
const dupIds = await sql`select id, customer_no from customers where customer_no in ('CUS-2','CUS-3') order by customer_no`;
await sql`insert into invoices (business_id, invoice_no, customer_name, customer_id) values (${B}, 'INV-RAFI', 'Rafi', ${dupIds[0].id})`;

r = await mgr('erpMergeCustomers', [false]);
check('merge is shareholder-only', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await shareholder('erpMergeCustomers', [false]);
check('preview: 1 group, 2 extra rows, nothing changed', r.ok && r.result.applied === false && r.result.groups === 1 &&
  r.result.removed === 2 && r.result.preview.length === 1 && r.result.preview[0].phone === '1700000001' &&
  r.result.preview[0].name === 'Rafi' && r.result.preview[0].copies === 3 &&
  (await sql`select count(*)::int as n from customers where customer_no like 'CUS-_'`)[0].n === 3, r);
r = await owner('erpMergeCustomers', [true]);
check('apply: merged 1, removed 2, backup named', r.ok && r.result.applied === true && r.result.groups === 1 && r.result.removed === 2 &&
  r.result.backup === 'CUSTOMERS_DUPLICATES_BACKUP', r);
const kept = await sql`select * from customers where business_id = ${B} and right(regexp_replace(phone, '\D', '', 'g'), 10) = '1700000001'`;
check('oldest row kept with longest name/address, first email, summed counts, 0-prefixed phone',
  kept.length === 1 && kept[0].customer_no === 'CUS-1' && kept[0].name === 'Rafi Ahmed' && kept[0].address === 'Longer address' &&
  kept[0].email === 'r@x.com' && kept[0].total_orders === 7 && kept[0].total_spent === 175.5 && kept[0].phone === '01700000001', kept);
const bak = await sql`select * from customers_duplicates_backup where business_id = ${B} order by customer_no`;
check('removed rows copied to the backup first', bak.length === 2 && bak[0].customer_no === 'CUS-2' && bak[1].customer_no === 'CUS-3' &&
  bak[0].merged_into === kept[0].id && bak[0].phone === '+8801700000001' && bak[1].total_spent === 25.5 && bak[0].backed_up_by === 'Owner', bak);
const ri = (await sql`select customer_id from invoices where invoice_no = 'INV-RAFI'`)[0];
check("an invoice of a removed row now points at the kept one", ri.customer_id === kept[0].id, ri);
r = await owner('erpMergeCustomers', [true]);
check('second run: nothing to merge', r.ok && r.result.groups === 0 && r.result.removed === 0, r);
check('other business untouched', (await sql`select count(*)::int as n from customers where business_id = ${FIX.B2}`)[0].n === 1);

// ---------------------------------------------------------------- phone tools
await sql`insert into customers (business_id, name, phone) values (${B}, 'P1', '1811112222'), (${B}, 'P2', '8801811113333'),
                                                                     (${B}, 'P3', '')`;
let fx = await asOwner((ctx) => C.fixCustomerPhones(ctx));
check('fixCustomerPhones: two numbers given their 0 back', fx.ok && fx.fixed === 2, fx);
const ps = await sql`select name, phone from customers where name in ('P1','P2') order by name`;
check('stored as 01…', ps[0].phone === '01811112222' && ps[1].phone === '01811113333', ps);
fx = await asOwner((ctx) => C.fixCustomerPhones(ctx));
check('fixCustomerPhones: second run fixes nothing', fx.fixed === 0, fx);

await sql`insert into customers (business_id, name, phone) values (${B}, 'P4', '+880 1911-112223')`;
const pi = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone) values
  (${B}, 'INV-PH', 'P5', '1911112222') returning id`;
await sql`insert into invoice_lines (business_id, invoice_id, sku, qty) values (${B}, ${pi[0].id}, ${PLA}, 1), (${B}, ${pi[0].id}, ${PLA}, 1)`;
let msg = await asOwner((ctx) => C.fixPhones(ctx));
check('fixPhones: 1 customer + 2 SALES_LOG rows of INV-PH + 1 of INV-OLD', msg === '4 phone number(s) corrected.', msg);
const ph = (await sql`select customer_phone from invoices where invoice_no = 'INV-PH'`)[0].customer_phone;
const p4 = (await sql`select phone from customers where name = 'P4'`)[0].phone;
check('invoice and customer phones tidied', ph === '01911112222' && p4 === '01911112223', [ph, p4]);
msg = await asOwner((ctx) => C.fixPhones(ctx));
check('fixPhones: nothing left', msg === 'All phone numbers already correct.', msg);
const mg = await asOwner((ctx) => C.mergeCustomers(ctx, false));
check('mergeCustomers export works for the Tools screen', mg.ok && mg.applied === false, mg);

// ---------------------------------------------------------------- bundle
r = await sales('erpBundle', [['customers', 'dues']]);
check('bundle customers part', r.ok && Array.isArray(r.result.customers) && find(r.result.customers, 'Karim') && r.result.dues, r.result && r.result.errors);

await done();
