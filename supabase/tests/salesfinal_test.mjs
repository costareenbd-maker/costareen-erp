// final-sales (10 Nov 2026): the sales screens' "one where the shop has many" fixes on the server.
//   - one invoice paid over several methods (payload.payments), each part its own payment row / account
//   - a Save pressed twice books one invoice (payload.clientKey, 164_invoice_client_key.sql)
//   - a quotation that became an invoice is marked Invoiced and keeps the invoice number
//   - a big order in more than one box: a second parcel on the same invoice (extraBox), 0 to collect
import { sql, FIX, owner, mgr, sales, makeShareholder, check, done, web } from './harness.mjs';
await makeShareholder();
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';   // sells at 1350
const C = { name: 'Split Customer', phone: '01811111111' };
const err = (r) => (r && !r.ok ? r.error : '');
const stock = async (sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${B} and p.sku = ${sku}`)[0].s);
const pays = (no) => sql`select amount, method, note from payments where business_id = ${B} and invoice_no = ${no} order by payment_no`;

// ---- split payments ----------------------------------------------------------------------------
let r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash',
  payments: [{ method: 'Cash', amount: 1000 }, { method: 'bKash', amount: 350 }] }]);
check('split: paid in full over two methods', r.ok && r.result.paidNow === 1350 && r.result.thisDue === 0, r);
const S1 = r.ok ? r.result.invoiceNo : '';
let p = await pays(S1);
check('split: two payment rows, one per method', p.length === 2 && Number(p[0].amount) === 1000 && p[0].method === 'Cash' && Number(p[1].amount) === 350 && p[1].method === 'bKash', p);
let inv = (await sql`select payment_method, payment_status, advance_paid, due_amount from invoices where business_id = ${B} and invoice_no = ${S1}`)[0];
check('split: the invoice head says both methods and Paid', inv.payment_method === 'Cash + bKash' && inv.payment_status === 'Paid' && Number(inv.due_amount) === 0, inv);

r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'part', paidNow: 1, paymentMethod: 'Cash',
  payments: [{ method: 'Cash', amount: 500 }, { method: 'Nagad', amount: 300 }] }]);
check('split: part paid over two methods leaves the rest due', r.ok && r.result.paidNow === 800 && r.result.thisDue === 550, r);
inv = (await sql`select payment_method, payment_status from invoices where business_id = ${B} and invoice_no = ${r.result && r.result.invoiceNo}`)[0];
check('split: Partial, both methods named', inv && inv.payment_status === 'Partial' && inv.payment_method === 'Cash + Nagad', inv);

r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'full', payments: [{ method: 'Cash', amount: 1000 }] }]);
check('split: "Paid now" with parts short of the total is refused plainly', !r.ok && /Part paid/.test(err(r)), r);
r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'part', payments: [{ method: 'Cash', amount: 1000 }, { method: 'bKash', amount: 1000 }] }]);
check('split: parts over the total are refused', !r.ok && /more than the invoice total/.test(err(r)), r);
r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'part', payments: [{ method: '', amount: 100 }] }]);
check('split: a part without a method is refused', !r.ok && /needs a method/.test(err(r)), r);
r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'part', payments: [{ method: 'COD', amount: 100 }] }]);
check('split: COD is not a part payment', !r.ok && /not a part payment/.test(err(r)), r);

// ---- the same Save twice ------------------------------------------------------------------------
const before = await stock(PLA);
const pay = { customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash', clientKey: 'ck-test-1' };
r = await mgr('erpCreateInvoice', [pay]);
check('clientKey: first save books the sale', r.ok && !r.result.repeated, r);
const K1 = r.ok ? r.result.invoiceNo : '';
r = await mgr('erpCreateInvoice', [pay]);
check('clientKey: the second press answers with the same invoice, nothing sold twice', r.ok && r.result.repeated === true && r.result.invoiceNo === K1 && r.result.grandTotal === 1350 && r.result.thisDue === 0, r);
check('clientKey: stock moved once', (await stock(PLA)) === before - 1, { before, after: await stock(PLA) });
const n = await sql`select count(*)::int n from invoices where business_id = ${B} and client_key = 'ck-test-1'`;
check('clientKey: one invoice carries the key', n[0].n === 1, n);
r = await mgr('erpCreateInvoice', [{ ...pay, clientKey: 'ck-test-2' }]);
check('clientKey: a new key is a new sale', r.ok && !r.result.repeated && r.result.invoiceNo !== K1, r);
// the other business never sees the key (scoped by business_id)
const other = await sql`select count(*)::int n from invoices where business_id = ${FIX.B2} and client_key is not null`;
check('clientKey: nothing written in the other business', other[0].n === 0, other);

// ---- quotation -> invoice: the mark --------------------------------------------------------------
const q = { id: 'q-final-1', number: '', kind: 'Products', title: 'Filament offer', customer: 'Split Customer', contact: '', email: '', phone: '01811111111',
  address: '', date: '2026-10-02', validUntil: '2026-10-12', currency: 'BDT', items: [{ id: 'a', name: 'PLA', kind: 'Product', qty: 1, unit: 'unit', rate: 1350 }],
  discountType: 'Fixed', discount: 0, vat: 0, shipping: 0, advance: 0, terms: '', notes: '', showBank: false, showSignature: false, useSignature: false,
  bankIds: [], theme: 'Signature', accent: '#123456', dark: '#000000', font: 'Georgia', fontSize: 'Compact', autoNumber: true, status: 'Draft', company: null };
r = await sales('erpQuoteSave', [{ quote: q, expectedVersion: 0, saveKey: 'kf1' }]);
check('quote: saved', r.ok && r.result.quote.number, r);
const QN = r.ok ? r.result.quote.number : '', QV = r.ok ? r.result.quote.version : 0;
r = await mgr('erpCreateInvoice', [{ customer: C, items: [{ sku: PLA, qty: 1 }], payMode: 'none', note: 'From quotation ' + QN, quoteRef: QN }]);
check('quote: the invoice from it is saved', r.ok, r);
const QI = r.ok ? r.result.invoiceNo : '';
let qr = (await sql`select status, doc->>'invoiceNo' as inv from quotations where business_id = ${B} and id = 'q-final-1'`)[0];
check('quote: marked Invoiced with the invoice number', qr && qr.status === 'Invoiced' && qr.inv === QI, qr);
r = await sales('erpQuoteList', [{}]);
check('quote list: counts Invoiced, row carries the invoice number', r.ok && r.result.counts.invoiced === 1 && r.result.rows.some((x) => x.id === 'q-final-1' && x.status === 'Invoiced' && x.invoiceNo === QI), r.ok ? r.result.counts : r);
r = await sales('erpQuoteList', [{ status: 'Invoiced' }]);
check('quote list: filter by Invoiced', r.ok && r.result.rows.length === 1, r.ok ? r.result.rows.length : r);
r = await sales('erpQuoteSave', [{ quote: { ...q, title: 'Edited later', status: 'Ready' }, expectedVersion: QV, saveKey: 'kf2' }]);
check('quote: an edit later keeps it Invoiced', r.ok && r.result.quote.status === 'Invoiced' && r.result.quote.invoiceNo === QI, r.ok ? r.result.quote.status : r);

// ---- a second box on one invoice -----------------------------------------------------------------
let cidNext = 5001;
web.on(/\/create_order$/, (url, opts) => {
  const b = JSON.parse(opts.body);
  return { status: 200, body: { status: 200, message: 'ok', consignment: { consignment_id: cidNext++, invoice: b.invoice, tracking_code: 'TRK' + b.invoice, status: 'in_review' } } };
});
web.on(/\/get_balance$/, () => ({ status: 200, body: { status: 200, current_balance: 10 } }));
web.on(/\/status_by_cid\//, () => ({ status: 200, body: { status: 200, delivery_status: 'in_review' } }));
r = await owner('erpCourierSetKeys', [{ apiKey: 'K1', apiSecret: 'S1' }]);
check('courier: keys set', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Box Customer', phone: '01822222222', address: 'House 5, Road 2, Dhaka', source: 'Steadfast' },
  items: [{ sku: PLA, qty: 2 }], payMode: 'cod' }]);
check('courier: a COD sale to book', r.ok, r);
const BI = r.ok ? r.result.invoiceNo : '';
r = await mgr('erpBookParcel', [{ invoiceNo: BI }]);
check('courier: first parcel collects the money', r.ok && r.result.collect === 2700 && r.result.consignment === '5001', r);
r = await mgr('erpBookParcel', [{ invoiceNo: BI }]);
check('courier: a plain second booking is still refused, and says how to add a box', !r.ok && /already has a parcel/.test(err(r)) && /Add another box/.test(err(r)), r);
r = await mgr('erpBookParcel', [{ invoiceNo: BI, extraBox: true, note: 'box 2' }]);
check('courier: an extra box goes out with 0 to collect', r.ok && r.result.collect === 0 && r.result.consignment === '5002', r);
const logs = await sql`select consignment_id, cod_amount, note from courier_log where business_id = ${B} and invoice_no = ${BI} order by seq`;
check('courier: two log rows, the second marked [extra box]', logs.length === 2 && Number(logs[0].cod_amount) === 2700 && Number(logs[1].cod_amount) === 0 && /\[extra box\]/.test(logs[1].note), logs);
r = await mgr('erpParcelPreview', [{ invoiceNo: BI }]);
check('courier: THE parcel of the invoice stays the first one', r.ok && r.result.alreadyBooked === '5001', r);
r = await mgr('erpParcelLabels', [{ invoices: [BI] }]);
check('courier: a label for each box', r.ok && JSON.stringify(r.result).includes('5002') && JSON.stringify(r.result).includes('5001'), r.ok ? Object.keys(r.result) : r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Box Customer', phone: '01822222222', address: 'House 5, Road 2, Dhaka', source: 'Steadfast' },
  items: [{ sku: PLA, qty: 1 }], payMode: 'cod' }]);
await sql`insert into stock_movements(business_id,product_id,kind,direction,qty) select business_id, id, 'RECEIVE', 'IN', 5 from products where business_id = ${B} and sku = ${PLA}`;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Box Customer', phone: '01822222222', address: 'House 5, Road 2, Dhaka', source: 'Steadfast' }, items: [{ sku: PLA, qty: 1 }], payMode: 'cod' }]);
check("courier: second COD sale saved", r.ok, r); r = await mgr("erpBookParcel", [{ invoiceNo: r.ok ? r.result.invoiceNo : "", extraBox: true }]);
check('courier: extraBox on an invoice with no parcel yet books the normal first parcel', r.ok && r.result.collect === 1350, r);

await done();
