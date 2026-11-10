// invedit-1 + paidpdf-1: edit a saved invoice (handlers/invedit.js) - products, quantities, prices, delivery, how paid -
// same number; stock and FIFO lots follow; money already taken stays; one line per change; one PDF (overwritten). The PDF
// is drawn again when what was paid has changed (sales.js erpInvoicePdf).
import { sql, FIX, owner, mgr, sales, check, done, files, pdfs } from './harness.mjs';

const PLA = 'FIL-SUN-PLA-BLA-001', PRT = 'PRT-BAM-A1-001';
const stockOf = async (sku) => Number((await sql`select coalesce(ps.stock, 0) s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${FIX.B} and p.sku = ${sku}`)[0].s);
const lotsOf = async (sku) => Number((await sql`select coalesce(sum(l.qty_left), 0) s from stock_lots l join products p on p.id = l.product_id where p.business_id = ${FIX.B} and p.sku = ${sku}`)[0].s);
const invOf = async (no) => (await sql`select * from invoices where business_id = ${FIX.B} and invoice_no = ${no}`)[0];
const fixesOf = async (no) => (await sql`select field, was, now from invoice_fixes where business_id = ${FIX.B} and invoice_no = ${no} order by fixed_at, field`);
const s0 = await stockOf(PLA), l0 = await lotsOf(PLA);

// ---- a courier sale, cash on delivery
let r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678', address: 'Mirpur 2', source: 'Steadfast' }, items: [{ sku: PLA, qty: 2 }], payMode: 'cod', deliveryCharge: 120 }]);
const no = r.result.invoiceNo;
check('the sale is made', r.ok && (await stockOf(PLA)) === s0 - 2, r);

// ---- who may edit
r = await sales('erpInvoiceEdit', [{ invoiceNo: no, items: [{ sku: PLA, qty: 3 }] }]);
check('sales staff cannot edit a saved invoice', !r.ok, r);

// ---- products, quantity, price, address
r = await mgr('erpInvoiceEdit', [{ invoiceNo: no, customer: { name: 'Karim', phone: '01712345678', address: 'Mirpur 10', source: 'Steadfast' }, items: [{ sku: PLA, qty: 3, discEach: 50 }], deliveryCharge: 120 }]);
check('a manager edits it: same number, new total', r.ok && r.result.invoiceNo === no && r.result.grandTotal === 1350 * 3 - 150 + 120, r);
let inv = await invOf(no);
check('the invoice row is the same one, new figures, still cash on delivery', inv.grand_total == 4020 && inv.customer_address === 'Mirpur 10' && inv.payment_method === 'COD' && inv.due_amount == 4020, inv);
check('the stock follows: one more unit out', (await stockOf(PLA)) === s0 - 3, await stockOf(PLA));
check('the FIFO lots follow the stock', (await lotsOf(PLA)) === l0 - 3, [await lotsOf(PLA), l0]);
const lines = await sql`select * from invoice_lines where invoice_id = ${inv.id}`;
const mvs = await sql`select * from stock_movements where invoice_id = ${inv.id} and direction = 'OUT'`;
check('one line and one stock movement, at the sale\'s own time', lines.length === 1 && Number(lines[0].qty) === 3 && Number(lines[0].discount) === 150 && mvs.length === 1 && Number(mvs[0].qty) === 3 &&
  new Date(mvs[0].created_at).getTime() === new Date(inv.created_at).getTime(), [lines.length, mvs.length]);
let fx = await fixesOf(no);
check('one line per change is written', fx.some((f) => f.field === 'address' && f.was === 'Mirpur 2' && f.now === 'Mirpur 10') && fx.some((f) => f.field === 'products' && /× 2/.test(f.was) && /× 3/.test(f.now)) && fx.some((f) => f.field === 'total'), fx);
check('the PDF is drawn again with the new figures', pdfs.length && pdfs[pdfs.length - 1].html.includes(no) && pdfs[pdfs.length - 1].html.includes('Mirpur 10'));

// ---- the price it was sold at stays, even when the price list changes
await sql`update products set sell_price = 1500 where business_id = ${FIX.B} and sku = ${PLA}`;
r = await mgr('erpInvoiceEdit', [{ invoiceNo: no, customer: { address: 'Mirpur 10, Road 3' }, items: [{ sku: PLA, qty: 3, discEach: 50 }], deliveryCharge: 120 }]);
check('a later price-list change does not re-price the sale', r.ok && r.result.grandTotal === 4020 && Number((await sql`select unit_price from invoice_lines where invoice_id = ${inv.id}`)[0].unit_price) === 1350, r);
await sql`update products set sell_price = 1350 where business_id = ${FIX.B} and sku = ${PLA}`;

// ---- more than the shelf: the invoice's own units count, nothing more
const shelf = await stockOf(PLA);
r = await mgr('erpInvoiceEdit', [{ invoiceNo: no, items: [{ sku: PLA, qty: shelf + 3 + 1 }] }]);
check('more than shelf + its own units is refused, nothing changed', !r.ok && /Not enough stock/.test(r.error) && (await stockOf(PLA)) === shelf, r);
r = await mgr('erpInvoiceEdit', [{ invoiceNo: no, items: [{ sku: PLA, qty: 3, discEach: 50 }, { sku: PRT, qty: 1 }] }]);
check('a product added', r.ok && (await stockOf(PRT)) === 2 && r.result.grandTotal === 4020 + 52000, r);
// jointedit-1: a joint-stock product added in an edit is refused in plain words, nothing changed
{ const before = await stockOf(PLA), tot = Number((await invOf(no)).grand_total);
  r = await mgr('erpInvoiceEdit', [{ invoiceNo: no, items: [{ sku: PLA, qty: 3, discEach: 50 }, { sku: PRT, qty: 1 }, { sku: 'JR-W~Jabcd', qty: 2 }] }]);
  check('a joint-stock product added by editing is refused plainly, nothing changed', !r.ok && /Joint-stock products cannot be added/.test(r.error) && !/reading/.test(r.error) && (await stockOf(PLA)) === before && Number((await invOf(no)).grand_total) === tot, r); }
r = await mgr('erpInvoiceEdit', [{ invoiceNo: no, items: [{ sku: PLA, qty: 3, discEach: 50 }] }]);
check('and taken off again: its unit is back on the shelf', r.ok && (await stockOf(PRT)) === 3 && r.result.grandTotal === 4020, r);

// ---- "a walk-in put on the courier by mistake": to walk-in, paid at the counter
r = await mgr('erpInvoiceEdit', [{ invoiceNo: no, customer: { source: 'Customer pickup' }, items: [{ sku: PLA, qty: 3, discEach: 50 }], deliveryCharge: 0, payMode: 'full', paymentMethod: 'Cash' }]);
inv = await invOf(no);
check('changed to walk-in and paid: no cash on delivery, Paid', r.ok && inv.source === 'Customer pickup' && inv.payment_method !== 'COD' && inv.payment_status === 'Paid' && r.result.took === 3900 && r.result.due === 0, [r, inv.payment_method, inv.payment_status]);
fx = await fixesOf(no);
check('the delivery, payment and money are written', fx.some((f) => f.field === 'delivery') && fx.some((f) => f.field === 'payment' && f.was === 'COD') && fx.some((f) => f.field === 'paid'), fx);
r = await mgr('erpInvoiceEdit', [{ invoiceNo: no, items: [{ sku: PLA, qty: 1 }], deliveryCharge: 0 }]);
check('a new total below what is paid is refused (that is a refund)', !r.ok && /below what is already paid/.test(r.error), r);

// ---- one PDF
check('one PDF per invoice, no "corrected" copies', files.list().filter((f) => f.includes('Invoice_' + no)).every((f) => !/_corrected_/.test(f)), files.list().filter((f) => f.includes(no)));

// ---- paidpdf-1: a payment after the PDF - opening it draws it again
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678', source: 'Customer pickup' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
const due = r.result.invoiceNo;
const before = pdfs.length;
r = await owner('erpInvoicePdf', [{ invoiceNo: due }]);
check('opening an unchanged PDF does not draw it again', r.ok && r.result.found && !r.result.made && pdfs.length === before, r);
await sql`insert into payments (business_id, payment_no, invoice_no, customer, amount, method, note) values (${FIX.B}, 'PTEST1', ${due}, 'Karim', 500, 'Cash', 'part')`;
r = await owner('erpInvoicePdf', [{ invoiceNo: due }]);
check('after a payment the PDF is drawn again, showing what was paid', r.ok && r.result.made && pdfs.length === before + 1 && Number((await invOf(due)).pdf_paid) === 500, [r.result, (await invOf(due)).pdf_paid]);
r = await owner('erpInvoicePdf', [{ invoiceNo: due }]);
check('and not again while nothing changes', r.ok && !r.result.made && pdfs.length === before + 1, r.result);

done();
