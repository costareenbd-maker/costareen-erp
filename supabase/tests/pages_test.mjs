// Phase 2: invoice page, customer page, global search, Sales paging.
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B, PLA = 'FIL-SUN-PLA-BLA-001';

// a sale with a part payment, a later payment, a return and a parcel
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim Uddin', phone: '01811111111', address: 'House 4, Road 2, Mirpur 10, Dhaka', source: 'Steadfast courier' },
  items: [{ sku: PLA, qty: 2 }], invoiceDiscount: 100, deliveryCharge: 60, payMode: 'part', paidNow: 1000, paymentMethod: 'bKash' }]);
check('fixture sale saved (2660, due 1660)', r.ok && r.result.grandTotal === 2660 && r.result.thisDue === 1660, r);
const A = r.result.invoiceNo;
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'due', reason: 'wrong colour' }]);
check('fixture return saved', r.ok, r);
r = await mgr('erpSettleDue', [{ phone: '01811111111', name: 'Rahim Uddin', amount: 200, reason: 'payment', method: 'Cash', note: 'paid at the shop' }]);
check('fixture payment saved', r.ok, r);
await mgr('erpParcelHandled', [{ invoiceNo: A, consignment: 'SF123456' }]);
await mgr('erpFixInvoice', [{ invoiceNo: A, name: 'Rahim Uddin', phone: '01811111111', address: 'House 4, Road 2, Mirpur 10, Dhaka 1216', source: 'Steadfast courier' }]);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim Uddin', phone: '01811111111' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const A2 = r.result.invoiceNo;

// ---- invoice page ----
r = await sales('erpInvoice', [{ invoiceNo: '' }]);
check('invoice: which invoice?', !r.ok && r.error === 'Which invoice?', r);
r = await sales('erpInvoice', [{ invoiceNo: 'INV-NOPE' }]);
check('invoice: unknown', !r.ok && r.error === 'No invoice called INV-NOPE.', r);
r = await sales('erpInvoice', [{ invoiceNo: A }]);
const I = r.result;
check('invoice page: head', r.ok && I.id === A && I.customer === 'Rahim Uddin' && I.phone === '01811111111' && I.delivery === 'Steadfast courier' && I.method === 'bKash' && /Dhaka 1216$/.test(I.address), I);
check('invoice page: lines and totals', I.lines.length === 1 && I.lines[0].qty === 2 && I.lines[0].price === 1350 && I.lines[0].discount === 100 && I.lines[0].total === 2600 &&
  I.subtotal === 2700 && I.discount === 100 && I.deliveryCharge === 60 && I.grand === 2660 && I.units === 2, I);
check('invoice page: payments in order with plain labels', I.payments.length === 3 && I.payments[0].amount === 1000 && I.payments[0].label === 'Payment · bKash' &&
  I.payments[1].label === 'Goods returned' && I.payments[2].amount === 200 && I.payments[2].note === 'paid at the shop' && !/\[/.test(I.payments.map((p) => p.note).join('')), I.payments);
check('invoice page: return shown, line knows 1 came back', I.returns.length === 1 && I.returns[0].qty === 1 && I.returns[0].reason === 'wrong colour' && I.lines[0].returned === 1 && I.returnedQty === 1 && !I.allBack && !I.cancelled, I.returns);
check('invoice page: owed agrees with the dues list', I.owed === (await mgr('erpDues', [])).result.invoices.find((d) => d.id === A).due, I.owed);
check('invoice page: parcel', I.parcel && I.parcel.consignment === 'SF123456' && I.parcel.byHand === true && I.courier === true, I.parcel);
check('invoice page: change history', I.changes.length === 1 && I.changes[0].field === 'address' && /1216$/.test(I.changes[0].now), I.changes);
check('invoice page: no cost or profit for anyone', !JSON.stringify(I).match(/cost|profit|margin/i));
r = await sales('erpInvoice', [{ invoiceNo: 'RTN-1' }]);
check('invoice: a return note is refused', !r.ok && r.error === 'That is a return note, not a sale.', r);

// ---- customer page ----
r = await sales('erpCustomerPage', [{}]);
check('customer: whose page?', !r.ok && r.error === 'Whose page?', r);
r = await sales('erpCustomerPage', [{ phone: '+880 1811-111111' }]);
const C = r.result;
check('customer page: found by any spelling of the phone', r.ok && C.name === 'Rahim Uddin' && C.phone === '01811111111' && C.key === '1811111111' && C.onList, C);
check('customer page: a later pickup sale did not wipe the saved address', /Mirpur 10/.test(C.address), C.address);
check('customer page: invoices newest first with dues', C.orders === 2 && C.invoices[0].id === A2 && C.invoices[1].id === A && C.invoices[1].due === I.owed && C.invoices[0].due === 0, C.invoices);
check('customer page: spent is net of returns', C.spent === 2660 + 1350 - C.invoices[1].returned && C.invoices[1].returned > 0 && C.units === 3, C);
check('customer page: balance matches the account box', C.balance === (await mgr('erpCustomerAccount', [{ phone: '01811111111', name: 'Rahim Uddin' }])).result.balance, C.balance);
check('customer page: payments listed', C.payments.length >= 4 && C.payments.every((p) => !/\[/.test(p.note)), C.payments);
await mgr('erpTakeAdvance', [{ phone: '01811111111', name: 'Rahim Uddin', amount: 300, method: 'Cash', note: 'for next order' }]);
r = await sales('erpCustomerPage', [{ phone: '01811111111' }]);
check('customer page: advance held shows as credit and in payments', r.result.credit === 300 && r.result.payments.some((p) => p.amount === 300 && p.invoice === ''), r.result.credit);
// a customer saved long ago with a formatted phone
await sql`insert into customers (business_id, name, phone, total_orders, total_spent) values (${B}, 'Old Format', '+880 1999-888777', 0, 0)`;
r = await sales('erpLookupCustomer', ['01999888777']);
check('a phone stored with spaces and dashes is still found', r.ok && r.result && r.result.name === 'Old Format', r);
r = await sales('erpCustomerPage', [{ phone: '01999888777' }]);
check('customer page: on the list with no orders', r.ok && r.result.orders === 0 && r.result.daysSince === null && r.result.balance === 0, r.result);
r = await sales('erpCustomerPage', [{ phone: '01000000000' }]);
check('customer page: unknown', !r.ok && r.error === 'That customer was not found.', r);
// walk-in by name only
await mgr('erpCreateInvoice', [{ customer: { name: 'Walk In Guy' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
r = await sales('erpCustomerPage', [{ name: 'walk in guy' }]);
check('customer page: by name when there is no phone', r.ok && r.result.orders === 1 && r.result.balance === 1350, r.result);

// ---- search ----
r = await sales('erpSearch', [{ q: 'r' }]);
check('search: one letter finds nothing yet', r.ok && r.result.invoices.length === 0 && r.result.customers.length === 0, r.result);
r = await sales('erpSearch', [{ q: 'rahim' }]);
check('search: by customer name', r.ok && r.result.invoices.length === 2 && r.result.customers.some((c) => c.name === 'Rahim Uddin'), r.result);
r = await sales('erpSearch', [{ q: A.slice(-4) }]);
check('search: by the end of an invoice number', r.result.invoices.some((i) => i.id === A), r.result.invoices);
r = await sales('erpSearch', [{ q: '0181111' }]);
check('search: by part of a phone, leading 0 or not', r.result.invoices.length === 2 && r.result.customers.length >= 1, r.result);
r = await sales('erpSearch', [{ q: '999-888' }]);
check('search: phone typed with a dash finds the formatted one', r.result.customers.some((c) => c.name === 'Old Format'), r.result.customers);
r = await sales('erpSearch', [{ q: 'pla' }]);
check('search: products by name, with stock and price, no cost', r.result.products.length === 1 && r.result.products[0].sku === PLA && r.result.products[0].sell === 1350 && !('cost' in r.result.products[0]), r.result.products);
r = await sales('erpSearch', [{ q: '100%_' }]);
check('search: % and _ are plain characters', r.ok && r.result.invoices.length === 0 && r.result.products.length === 0, r.result);
r = await sales('erpSearch', [{ q: 'other shop' }]);
check('search: never reaches another business', r.result.products.length === 0, r.result);

// ---- sales paging ----
const all = (await sales('erpSales', [{ q: '', filter: 'all', limit: 20 }])).result;
const p2 = (await sales('erpSales', [{ q: '', filter: 'all', limit: 20, offset: 2 }])).result;
check('sales: offset skips the newest rows, totals stay whole', p2.offset === 2 && p2.matched === all.matched && p2.totals.sold === all.totals.sold &&
  p2.rows[0].id === all.rows[2].id && p2.rows.length === all.rows.length - 2, [all.rows.map((x) => x.id), p2.rows.map((x) => x.id)]);
r = await sales('erpSales', [{ q: 'rahim', filter: 'all', limit: 20, offset: 1 }]);
check('sales: paging works inside a search', r.result.matched === 2 && r.result.rows.length === 1 && r.result.rows[0].id === A, r.result.rows);

await done();
