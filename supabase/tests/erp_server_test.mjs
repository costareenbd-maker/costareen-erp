// Node side of erp_server_test.py: drives erpCall exactly as the page will.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(path.join(process.env.ERP_NODE_CWD || process.cwd(), 'package.json'));
const postgres = require('postgres');
const fnDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'functions', 'erp');
const { connect } = await import(pathToFileURL(path.join(fnDir, 'db.js')));
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));

const FIX = JSON.parse(process.env.FIX);
const sql = connect(postgres, process.env.DB_URL);
// Owner sessions: the test stands in for Supabase Auth with "Bearer owner:<uuid>".
const H = await import('./harness.mjs');
const deps = { ...H.deps, sql, verifyUser: async (h) => (/^Bearer owner:(.+)$/.exec(h) || [])[1] || null };

let fails = 0;
function check(label, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra !== undefined && !ok ? '  [' + JSON.stringify(extra).slice(0, 300) + ']' : ''));
  if (!ok) fails++;
}
const owner = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + FIX.U.owner });
const mgr = (name, args) => erpCall(deps, { name, args, token: { code: '111111', device: 'dev-mgr' } });
const sales = (name, args) => erpCall(deps, { name, args, token: { code: '222222', device: 'dev-sales' } });

// ---- sign-in ----
let r = await erpCall(deps, { name: 'erpHello', token: {} });
check('no code, no session -> NO_CODE', r.ok && r.result.ok === false && r.result.reason === 'NO_CODE', r);
r = await erpCall(deps, { name: 'erpHello', authHeader: 'Bearer owner:' + FIX.U.owner });
check('owner session -> owner, implicit', r.result.ok && r.result.role === 'owner' && r.result.implicit && r.result.discountCap === 100, r);
r = await erpCall(deps, { name: 'erpHello', token: { code: '111111', device: 'dev-mgr' } });
check('manager code -> manager, cap 10', r.result.ok && r.result.role === 'manager' && r.result.discountCap === 10 && r.result.name === 'Mehedi', r);
r = await erpCall(deps, { name: 'erpHello', token: { code: '222222', device: 'new-phone', label: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' } });
check('new device -> PENDING', r.result.reason === 'PENDING', r);
const dev = await sql`select label, status from erp_devices where device_id = 'new-phone'`;
check('device request recorded with label', dev[0] && dev[0].status === 'pending' && dev[0].label === 'Android · Chrome', dev);
for (let i = 0; i < 5; i++) await erpCall(deps, { name: 'erpHello', token: { code: '999999', device: 'thief' } });
r = await erpCall(deps, { name: 'erpHello', token: { code: '111111', device: 'thief' } });
check('5 wrong codes lock the device', r.result.reason === 'LOCKED', r);

// ---- the door ----
r = await sales('erpNoSuchThing', []);
check('unknown action', !r.ok && /^Unknown action: erpNoSuchThing/.test(r.error), r);
r = await sales('erpSettingsLists', []);
check('sales refused a manager action', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await erpCall(deps, { name: 'erpToday', token: { code: '999999', device: 'x2' } });
check('bad code refused', !r.ok && r.error === 'That code is not recognised.', r);
const errs = await sql`select count(*)::int as n from erp_errors`;
check('refusals are logged', errs[0].n >= 2, errs);

// ---- shell ----
r = await mgr('erpToday', []);
check('erpToday yyyy-MM-dd', r.ok && /^\d{4}-\d{2}-\d{2}$/.test(r.result), r);
await mgr('erpSetTheme', ['light']);
r = await mgr('erpGetTheme', []);
check('theme is per person', r.result === 'light' && (await owner('erpGetTheme', [])).result === 'dark', r);
r = await owner('erpBusinesses', []);
check('owner sees own business only (RLS + memberships)', r.ok && r.result.businesses.length === 1 && r.result.active === FIX.B && r.result.canAdd === true, r);

// ---- catalogue ----
r = await sales('erpCatalog', []);
const cat = r.result || [];
const pla = cat.find((p) => p.sku === 'FIL-SUN-PLA-BLA-001');
check('catalog only this business', r.ok && cat.length === 2 && !cat.find((p) => p.sku === 'X-OTHER'), r);
check('stock from ledger (20 in, 13 out = 7)', pla && pla.stock === 7, pla);
check('sold = lines minus good returns, sku case-insensitive (9+4-2)', pla && pla.sold === 11, pla);
check('sold90 = 9-2', pla && pla.sold90 === 7, pla);
check('reorder 0 shows as 5 (STOCK_VIEW rule); 7 > 5 is ok', pla && pla.reorder === 5 && pla.state === 'ok', pla);
check('rate/cover/suggested', pla && pla.rate === Math.round(7 / 90 * 1000) / 1000 && pla.cover === 90 && pla.lead === 7 && pla.suggested === 1, pla);
check('lastSoldDays from the return (5 days)', pla && pla.lastSoldDays === 5, pla);
check('sales role: supplier scrubbed', pla && !('supplier' in pla), pla);
r = await mgr('erpCatalog', []);
check('manager keeps supplier', r.result.find((p) => p.sku === 'FIL-SUN-PLA-BLA-001').supplier === 'Sunlu Direct');
check('sorted by name', cat[0].name === 'Bambu A1');

r = await mgr('erpProduct', ['fil-sun-pla-bla-001']);
check('manager: product found case-insensitive, cost scrubbed', r.ok && r.result.product_name === 'Sunlu PLA Black' && !('cost_price' in r.result), r);
r = await owner('erpProduct', ['FIL-SUN-PLA-BLA-001']);
check('owner sees cost', r.result.cost_price === 900, r);
r = await owner('erpProduct', ['X-OTHER']);
check("another business's product is invisible", r.ok && r.result === null, r);

r = await mgr('erpSettingsLists', []);
check('lists: de-duplicated case-insensitively, sorted', r.ok && JSON.stringify(r.result.brands) === '["Bambulab","Sunlu"]' && r.result.categories.length === 2, r);
r = await sales('erpFormOptions', []);
check('form options', r.ok && r.result.paymentMethods.includes('bKash') && r.result.sources[0] === 'Customer pickup' && r.result.currency === 'BDT', r);

r = await sales('erpLookupCustomer', ['+8801712345678']);
check('customer lookup by last 10 digits', r.ok && r.result && r.result.name === 'Karim' && r.result.phone === '01712345678' && r.result.spent === 4500, r);
r = await sales('erpLookupCustomer', ['01999999999']);
check('unknown customer -> null', r.ok && r.result === null, r);

// ---- bundle ----
r = await sales('erpBundle', [['biz', 'dash', 'catalog', 'lists', 'options']]);
check('bundle runs', r.ok && r.result.build === 'b261002-1321' && /^\d{4}-/.test(r.result.today), r);
check('bundle: every part answers on its own (data or its own error)', ['biz','dash','catalog','lists','options'].every((p) => r.result[p] !== undefined && (r.result[p] !== null || r.result.errors[p])) && r.result.catalog.length === 2, r.result.errors);
check('bundle: catalog scrubbed for sales', !('supplier' in r.result.catalog[0]));
check('bundle: lists reach sales via bundle (as original)', r.result.lists && r.result.lists.brands.length === 2);

// ---- new invoice ----
const PLA = 'FIL-SUN-PLA-BLA-001';
const stockOf = async (sku) => (await sales('erpCatalog', [])).result.find((p) => p.sku === sku).stock;
const cust = async (phone) => (await sql`select * from customers where business_id = ${FIX.B} and phone = ${phone}`)[0];

r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678', address: 'Dhaka', source: 'Customer pickup' },
  items: [{ sku: PLA, qty: 2, discEach: 0 }], invoiceDiscount: 0, deliveryCharge: 0, payMode: 'full', paidNow: 0,
  paymentMethod: 'bKash', paymentStatus: 'Pending', date: '' }]);
check('sale has its PDF', r.ok && /^Invoice_INV-\d{8}-1001\.pdf$/.test(r.result.pdfName) && /^https:\/\/files\.test\//.test(r.result.pdfUrl), r.result);
check('sale saved, paid in full', r.ok && r.result.grandTotal === 2700 && r.result.thisDue === 0 && r.result.paidNow === 2700, r);
check('invoice number INV-<today>-1001', r.ok && /^INV-\d{8}-1001$/.test(r.result.invoiceNo), r.result && r.result.invoiceNo);
const inv1 = r.result.invoiceNo;
check('stock went down 7 -> 5', (await stockOf(PLA)) === 5);
let row = (await sql`select * from invoices where invoice_no = ${inv1}`)[0];
check('invoice row: Paid, advance = grand, due 0', row.payment_status === 'Paid' && row.advance_paid === 2700 && row.due_amount === 0, row);
const pay1 = await sql`select * from payments where invoice_no = ${inv1}`;
check('one payment, "paid in full at the till", bKash', pay1.length === 1 && pay1[0].amount === 2700 && pay1[0].note === 'paid in full at the till' && pay1[0].method === 'bKash', pay1);
let c = await cust('01712345678');
check('existing customer updated: orders 4, spent +2700, Returning', c.total_orders === 4 && c.total_spent === 7200.4 && c.status === 'Returning', c);
const mv = await sql`select * from stock_movements where reference = ${'Invoice: ' + inv1}`;
check('stock movement SALE OUT with txn no and operator', mv.length === 1 && mv[0].kind === 'SALE' && /^TXN-\d{8}-\d{4}$/.test(mv[0].txn_no) && mv[0].operator === 'Rina', mv);

r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }], invoiceDiscount: 200, payMode: 'full' }]);
check('sales capped at 5%', !r.ok && r.error === 'This discount is 7.4% of the goods. Your limit is 5% - ask a manager or the owner to save this sale.', r);

r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '1811111111', address: 'Mirpur', source: 'Steadfast courier' },
  items: [{ sku: PLA, qty: 1, discEach: 40 }], invoiceDiscount: 90, deliveryCharge: 60, payMode: 'part', paidNow: 500, paymentMethod: 'Cash' }]);
check('part paid: grand 1280, due 780', r.ok && r.result.grandTotal === 1280 && r.result.thisDue === 780 && r.result.priorBalance === 0, r);
check('next number 1002', r.ok && /-1002$/.test(r.result.invoiceNo), r.result);
const inv2 = r.result.invoiceNo;
row = (await sql`select * from invoices where invoice_no = ${inv2}`)[0];
check('partial: status, discount 130 inside the line, note tag, phone tidied', row.payment_status === 'Partial' && row.discount === 130 &&
  row.note === 'Invoice submission [discount: items 40 + invoice 90]' && row.customer_phone === '01811111111' && row.source === 'Steadfast courier', row);
const ln = (await sql`select * from invoice_lines where invoice_id = ${row.id}`)[0];
check('line: unit 1350, discount 130, total 1220, cost snapshot 900', ln.unit_price === 1350 && ln.discount === 130 && ln.line_total === 1220 && ln.unit_cost === 900, ln);
c = await cust('01811111111');
check('new customer created: New, Retail, key', c && c.status === 'New' && c.type === 'Retail' && c.total_orders === 1 && c.customer_key === '1811111111', c);

r = await mgr('erpDues', []);
check('dues: Rahim owes 780', r.ok && r.result.total === 780 && r.result.count === 1 && r.result.byKey['1811111111'].due === 780, r.result);

r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01811111111' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
check('unpaid: prior balance 780, total owed 2130', r.ok && r.result.priorBalance === 780 && r.result.thisDue === 1350 && r.result.totalOwed === 2130, r);

r = await mgr('erpCustomerAccount', [{ phone: '01811111111', name: 'Rahim' }]);
check('account: balance 2130, oldest first', r.ok && r.result.balance === 2130 && r.result.count === 2 && r.result.invoices[0].id === inv2, r.result);

r = await mgr('erpSettleDue', [{ phone: '01811111111', name: 'Rahim', amount: 1000, reason: 'payment', method: 'Cash' }]);
check('payment clears the oldest invoice first', r.ok && r.result.balance === 1130 && r.result.applied[0].id === inv2 && r.result.applied[0].applied === 780 && r.result.applied[1].applied === 220, r.result);
row = (await sql`select * from invoices where invoice_no = ${inv2}`)[0];
check('first invoice now Paid', row.payment_status === 'Paid' && row.due_amount === 0, row);
r = await mgr('erpSettleDue', [{ phone: '01811111111', name: 'Rahim', amount: 5000 }]);
check('cannot settle more than owed', !r.ok && r.error === 'That is more than is owed. The balance is 1130.', r);
r = await mgr('erpSettleDue', [{ phone: '01811111111', name: 'Rahim', amount: 10, reason: 'reduce', note: 'x' }]);
check('manager cannot reduce a due', !r.ok && /^Reduce the due is not something your account can do/.test(r.error), r);
r = await owner('erpSettleDue', [{ phone: '01811111111', name: 'Rahim', amount: 10, reason: 'discount' }]);
check('reduce needs a note (alias discount)', !r.ok && /needs a note/.test(r.error), r);
r = await owner('erpSettleDue', [{ phone: '01811111111', name: 'Rahim', amount: 110, reason: 'increase', note: 'bounced' }]);
check('increase takes back the newest payment', r.ok && r.result.balance === 1240, r.result);
r = await sales('erpSettleDue', [{ phone: '01811111111', amount: 1 }]);
check('sales cannot take payments', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await mgr('erpPayReasons', []);
check('manager reasons: payment only', r.ok && r.result.length === 1 && r.result[0].id === 'payment', r.result);

r = await mgr('erpTakeAdvance', [{ phone: '01922222222', name: 'Salma', amount: 1000, method: 'bKash' }]);
check('advance taken: credit 1000', r.ok && r.result.credit === 1000, r);
r = await mgr('erpDues', []);
check('advance shows in byKey credit', r.result.byKey['1922222222'] && r.result.byKey['1922222222'].credit === 1000 && r.result.byKey['1922222222'].due === 0, r.result.byKey);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Salma', phone: '01922222222' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
check('advance spent on the next invoice', r.ok && r.result.creditUsed === 1000 && r.result.thisDue === 350, r);
r = await mgr('erpCustomerCredit', [{ phone: '01922222222' }]);
check('credit used up', r.ok && r.result.credit === 0, r);

r = await mgr('erpCreateInvoice', [{ customer: { name: 'X', phone: '' }, items: [{ sku: PLA, qty: 100 }], payMode: 'none' }]);
check('not enough stock', !r.ok && /^Not enough stock for Sunlu PLA Black: \d+ in stock, 100 requested\.$/.test(r.error), r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'X', phone: '0171' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
check('bad phone refused', !r.ok && r.error === 'The phone number must be 11 digits starting with 01 - "0171" has 4. Correct it, or leave it empty.', r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'X' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none', date: '2999-01-01' }]);
check('future date refused', !r.ok && r.error === 'An invoice cannot be dated in the future.', r);
const before = await stockOf(PLA);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Walk' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', date: '2026-01-15' }]);
row = r.ok && (await sql`select created_at, source from invoices where invoice_no = ${r.result.invoiceNo}`)[0];
check('backdated: logged on that Dhaka day, numbered by save day, Walk-in', r.ok && row &&
  new Date(row.created_at.getTime() + 6 * 3600e3).toISOString().slice(0, 10) === '2026-01-15' && row.source === 'Walk-in' &&
  !r.result.invoiceNo.includes('20260115'), [r, row]);
check('a failed save changed nothing (stock only moved by the good one)', (await stockOf(PLA)) === before - 1);

r = await sales('erpBundle', [['customers', 'dues']]);
check('bundle dues part works', r.ok && r.result.dues && r.result.dues.total > 0, r.result && r.result.errors);

// ---- lock-down (021) ----
for (let i = 0; i < 20; i++) await erpCall(deps, { name: 'erpHello', token: { code: '90' + String(1000 + i), device: 'guess-' + i }, ip: '203.0.113.9' });
r = await erpCall(deps, { name: 'erpHello', token: { code: '111111', device: 'dev-mgr' }, ip: '203.0.113.9' });
check('20 wrong codes from one address lock that address, whatever device id is sent', r.result.reason === 'LOCKED', r);
r = await erpCall(deps, { name: 'erpToday', args: [], token: { code: '111111', device: 'dev-mgr' }, ip: '203.0.113.9' });
check('...for every call, not only sign-in', !r.ok && /Too many wrong codes/.test(r.error), r);
r = await erpCall(deps, { name: 'erpHello', token: { code: '111111', device: 'dev-mgr' }, ip: '198.51.100.7' });
check('the same person from another address is not affected', r.result.ok === true, r);
await sql`update erp_device_locks set updated_at = now() - interval '16 minutes', locked_until = now() - interval '1 minute' where device_id = 'ip:203.0.113.9'`;
await erpCall(deps, { name: 'erpHello', token: { code: '900000', device: 'guess-x' }, ip: '203.0.113.9' });
const lk = await sql`select failed, locked_until from erp_device_locks where device_id = 'ip:203.0.113.9'`;
check('after 15 quiet minutes the count starts again', lk[0].failed === 1 && lk[0].locked_until === null, lk);
let anonSees = 'nothing';
try {
  await sql.begin(async (tx) => { await tx`set local role anon`; const x = await tx`select count(*)::int n from products`; anonSees = 'rows:' + x[0].n; });
} catch (e) { anonSees = /permission denied/.test(e.message) ? 'denied' : e.message; }
check('not signed in: no permission on tables at all', anonSees === 'denied', anonSees);
let anonFn = 'ran';
try {
  await sql.begin(async (tx) => { await tx`set local role anon`; await tx`select create_business('x')`; });
} catch (e) { anonFn = /permission denied/.test(e.message) ? 'denied' : e.message; }
check('not signed in: cannot run database functions', anonFn === 'denied', anonFn);
const norls = await sql`select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relkind = 'r' and not c.relrowsecurity`;
check('every table has row-level security', norls.length === 0, norls);

await sql.end();
console.log('\n' + fails + ' failure(s)');
process.exit(fails ? 1 : 0);
