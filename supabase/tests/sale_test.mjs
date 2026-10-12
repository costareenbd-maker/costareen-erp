// FilaDash merge: the New sale screen's server side - seller, channel, the 5 % price check (117, invoice.js, commission.js).
// Run: TEST_SCRIPT=sale_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const sell = Number((await sql`select sell_price from products where business_id = ${B} and sku = ${PLA}`)[0].sell_price);
const base = { customer: { name: 'Karim', phone: '01712345678' }, payMode: 'full', paymentMethod: 'Cash' };

// ---- sellers
let r = await sales('erpSellers', []);
check('anyone sees who can be the seller, themselves first; sales staff cannot choose', r.ok && r.result.sellers[0].me && r.result.canChoose === false && r.result.sellers.length >= 3, r.result);
r = await sales('erpCreateInvoice', [{ ...base, items: [{ sku: PLA, qty: 1 }], seller: FIX.U.mgr }]);
check('sales staff cannot sell in someone else\'s name', !r.ok && /Only a manager or the owner/.test(r.error), r);
r = await mgr('erpCreateInvoice', [{ ...base, items: [{ sku: PLA, qty: 1 }], seller: FIX.U.sales, channel: 'Facebook' }]);
check('a manager names the seller and the channel', r.ok, r);
const inv1 = (await sql`select seller_id, channel, created_by from invoices where business_id = ${B} and invoice_no = ${r.result.invoiceNo}`)[0];
check('...kept on the invoice (made by the manager, sold by the sales person)', inv1.seller_id === FIX.U.sales && inv1.channel === 'Facebook' && inv1.created_by === FIX.U.mgr, inv1);
r = await mgr('erpCreateInvoice', [{ ...base, items: [{ sku: PLA, qty: 1 }], seller: '00000000-0000-0000-0000-000000000001' }]);
check('a seller who does not work here is refused', !r.ok, r);
r = await mgr('erpCreateInvoice', [{ ...base, items: [{ sku: PLA, qty: 1 }], channel: 'Pigeon' }]);
const inv2 = (await sql`select channel from invoices where business_id = ${B} and invoice_no = ${r.result.invoiceNo}`)[0];
check('an unknown channel is left empty', r.ok && inv2.channel === null, inv2);

// ---- commission follows the seller
await owner('erpCommissionRuleSave', [{ scope: 'all', basis: 'sales', pct: 10 }]);
r = await owner('erpCommission', [{}]);
const s = r.result.sellers.find((x) => x.id === FIX.U.sales);
check('the commission of the Facebook sale goes to the sales person, not the manager who typed it', s && s.earned === Math.round(sell * 0.1), r.result.sellers);

// ---- the channel chart
r = await owner('erpFdDash', [{ months: 1 }]);
check('the Sales Channel chart counts Facebook', r.ok && r.result.donuts.byChannel.some((x) => x.label === 'Facebook'), r.result.donuts.byChannel);

// ---- the 5 % price check (only when the screen asks for it)
const off = (pct) => Math.round(sell * pct / 100);
r = await sales('erpCreateInvoice', [{ ...base, items: [{ sku: PLA, qty: 1, discEach: off(10) }], priceCheck: true }]);
check('10% under the price without a reason is refused, naming the product', !r.ok && /^PRICE: .*10% off/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ ...base, items: [{ sku: PLA, qty: 1, discEach: off(10) }], priceCheck: true, priceReason: 'regular customer, owner agreed' }]);
check('...with a reason it goes through', r.ok, r);
const pr = (await sql`select price_reason from invoices where business_id = ${B} and invoice_no = ${r.result.invoiceNo}`)[0];
check('...and the reason is kept on the invoice', pr.price_reason === 'regular customer, owner agreed', pr);
r = await sales('erpCreateInvoice', [{ ...base, items: [{ sku: PLA, qty: 1, discEach: off(4) }], priceCheck: true }]);
check('4% under needs no reason', r.ok, r);
r = await sales('erpCreateInvoice', [{ ...base, items: [{ sku: PLA, qty: 1, discEach: off(10) }] }]);
check('the classic screen (no price check) is unchanged', r.ok, r);

await done();
