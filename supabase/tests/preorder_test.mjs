// FilaDash merge: pre-orders with advances (115_preorders.sql, handlers/preorders.js).
// Run: TEST_SCRIPT=preorder_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const month = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'PRE-X1', 'Printer X1', 'Printers', 'Bambu', 'Printer', 50000, 70000, 'Active')`;
const credit = async (phone) => (await owner('erpCustomerAccount', [{ phone }])).result;

// ---- a pre-order with a deposit
let r = await sales('erpPreorderSave', [{ customer: { name: 'Karim', phone: '01712345678' }, lines: [{ sku: 'PRE-X1', qty: 1, price: 65000 }], advance: 20000, method: 'Cash', eta: '2026-11-01' }]);
check('sales staff take a pre-order with a 20,000 deposit', r.ok && /^PRE-\d{6}-\d{3}$/.test(r.result.no) && r.result.total === 65000, r);
const P1 = r.result.no;
let p = r.result.list.preorders.find((x) => x.no === P1);
check('open, paid 20,000, 45,000 to pay, not ready (no stock)', p.status === 'open' && p.paid === 20000 && p.toPay === 45000 && !p.ready, p);
r = await sales('erpPreorderSave', [{ customer: { name: 'Rahim', phone: '01812345678' }, lines: [{ sku: 'PRE-X1', qty: 1, price: 66000 }], advance: 10000 }]);
const P2 = r.result.no;
r = await sales('erpPreorderSave', [{ customer: { name: 'Nadia', phone: '01912345678' }, lines: [{ name: 'Prusa Core One', qty: 1, price: 120000 }], advance: 30000 }]);
const P3 = r.result.no;
check('a model not in the product list yet', r.ok && r.result.list.preorders.find((x) => x.no === P3).items[0].needsProduct, r);
r = await sales('erpPreorderSave', [{ customer: { name: 'Greedy', phone: '01611111111' }, lines: [{ sku: 'PRE-X1', qty: 1, price: 100 }], advance: 500 }]);
check('a deposit above the order is refused', !r.ok, r);
const c = await credit('01712345678');
check('the deposit is the customer\'s money held (credit), not a sale', c && c.credit >= 20000, c);
const pnl0 = (await owner('erpPnl', [{ months: 1 }])).result.months.find((x) => x.month === month);

// ---- more deposit; the goods arrive: the oldest pre-order is ready first
r = await sales('erpPreorderPay', [{ id: P1, amount: 5000, method: 'bKash' }]);
check('5,000 more', r.ok && r.result.preorders.find((x) => x.no === P1).paid === 25000, r);
r = await mgr('erpReceiveShipment', [{ reference: 'PRE-SHIP', mode: 'bdt', totalBdt: 50000, lines: [{ sku: 'PRE-X1', qty: 1 }] }]);
r = await sales('erpPreorders', [{}]);
check('one printer arrived: Karim (first) is ready, Rahim is not', r.result.preorders.find((x) => x.no === P1).ready && !r.result.preorders.find((x) => x.no === P2).ready && r.result.totals.ready === 1, r.result.preorders);
r = await sales('erpPreorderFulfil', [{ id: P2 }]);
check('Rahim cannot be handed over before Karim', !r.ok, r);

// ---- handing over
r = await sales('erpPreorderFulfil', [{ id: P1 }]);
check('Karim\'s printer handed over: invoice at the agreed 65,000, 25,000 paid by the deposit, 40,000 due', r.ok && r.result.grandTotal === 65000 && r.result.paidByDeposit === 25000 && r.result.due === 40000, r.result);
const line = (await sql`select l.unit_price from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${B} and i.invoice_no = ${r.result.invoiceNo}`)[0];
check('the line carries the agreed price', Number(line.unit_price) === 65000, line);
check('the pre-order is done, with its invoice', r.result.list.preorders.find((x) => x.no === P1).status === 'done' && r.result.list.preorders.find((x) => x.no === P1).invoice === r.result.invoiceNo, 0);
r = await sales('erpPreorderFulfil', [{ id: P3 }]);
check('a typed model needs its product first', !r.ok && /product first/.test(r.error), r);

// ---- cancelling: paid back, or kept
r = await sales('erpPreorderCancel', [{ id: P2, reason: 'changed mind' }]);
check('sales staff cannot pay money back', !r.ok, r);
r = await mgr('erpPreorderCancel', [{ id: P2, reason: '' }]);
check('a reason is needed', !r.ok, r);
r = await mgr('erpPreorderCancel', [{ id: P2, reason: 'found it cheaper', method: 'Cash' }]);
check('Rahim cancelled: 10,000 paid back', r.ok && r.result.mode === 'refund' && r.result.amount === 10000, r.result);
check('...his credit is back to 0', (await credit('01812345678')).credit === 0, await credit('01812345678'));
r = await mgr('erpPreorderCancel', [{ id: P3, mode: 'forfeit', reason: 'no-show' }]);
check('only the owner keeps a deposit', !r.ok, r);
r = await owner('erpPreorderCancel', [{ id: P3, mode: 'forfeit', reason: 'walked away after 3 months' }]);
check('Nadia\'s 30,000 kept', r.ok && r.result.mode === 'forfeit' && r.result.amount === 30000, r.result);
const pnl1 = (await owner('erpPnl', [{ months: 1 }])).result.months.find((x) => x.month === month);
check('a kept deposit is income of the month', pnl1.forfeited === 30000, pnl1.forfeited);
check('Nadia owes nothing and holds no credit', (await credit('01912345678')).credit === 0, 0);
r = await owner('erpPreorderPay', [{ id: P3, amount: 100 }]);
check('a closed pre-order takes no more money', !r.ok, r);

// ---- the other business is untouched
const other = await sql`select count(*)::int as n from preorders where business_id = ${FIX.B2}`;
check('no pre-orders in the other business', other[0].n === 0, other);

await done();
