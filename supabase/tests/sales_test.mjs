// Sales group: erpSales, erpRecentInvoices, erpInvoicePdf, erpReturnPreview,
// erpReturnGoods, erpCancelInvoice, erpFixInvoice, erpVoidInvoice, and the
// export makeInvoicePdf (the designed invoice).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done, files, pdfs, web, deps, fnDir } from './harness.mjs';

const S = await import(pathToFileURL(path.join(fnDir, 'handlers', 'sales.js')));
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const PRT = 'PRT-BAM-A1-001';

const stockOf = async (sku) => Number((await sql`select stock from product_stock where business_id = ${B} and sku = ${sku}`)[0].stock);
const inv = async (no) => (await sql`select * from invoices where business_id = ${B} and invoice_no = ${no}`)[0];
const pays = async (no) => sql`select * from payments where business_id = ${B} and invoice_no = ${no} order by seq`;
const lastPdf = () => pdfs[pdfs.length - 1];

await makeShareholder();

// the business identity the quotes group keeps; images live in storage 'assets'
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4, 5, 6]);
await deps.storage.save(B, 'assets', 'logo.png', PNG, 'image/png');
await deps.storage.save(B, 'assets', 'qr.png', PNG, 'image/png');
await deps.storage.save(B, 'assets', 'junk.txt', new TextEncoder().encode('hello'), 'text/plain');
await sql`insert into quote_settings (business_id, key, value) values
  (${B}, 'profile', ${sql.json({ name: 'Costareen Ltd', address: 'House 1\nDhanmondi, Dhaka', phone: '01700000000, 01800000000',
                                 email: 'hi@costareen.com', website: 'costareen.com', footer: 'Thanks!',
                                 logoId: 'logo.png', qrId: 'qr.png',
                                 banks: [{ bank: 'BRAC Bank', name: 'Costareen', number: '2080773020001', branch: 'Gulshan' }] })}),
  (${B}, 'settings', ${sql.json({ accent: '#1a3c8f', currency: 'BDT' })})`;
// website sync key, for the website-order parcel numbers
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'CZ_SYNC_KEY', 'k-123')`;
web.on(/\/cod\?days=45&limit=200$/, () => ({ body: { orders: [{ order_no: '555', consignment: 'SF-WEB-1' }, { order_no: '556' }] } }));

// ------------------------------------------------------------ worked example
// A: Rahim, 2 x 1350, invoice discount 100 (inside the line), delivery 60 -> 2660, 1000 paid
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01811111111', address: 'Mirpur', source: 'Steadfast courier' },
  items: [{ sku: PLA, qty: 2 }], invoiceDiscount: 100, deliveryCharge: 60, payMode: 'part', paidNow: 1000, paymentMethod: 'Cash' }]);
check('A saved: 2660, due 1660', r.ok && r.result.grandTotal === 2660 && r.result.thisDue === 1660, r);
const A = r.result.invoiceNo;

// ------------------------------------------------------------ invoice PDF
r = await sales('erpInvoicePdf', [{ invoiceNo: '' }]);
check('pdf: which invoice?', !r.ok && r.error === 'Which invoice?', r);
// a sale draws its PDF when it is saved (as the original did) ...
check('sale saved its own PDF', files.list().includes(B + '/invoices/Invoice_' + A + '.pdf'));
// ... so to test "no PDF on file", take it away
await deps.storage.remove(B, 'invoices', 'Invoice_' + A + '.pdf');
await sql`update invoices set pdf_designed = false, pdf_path = null where business_id = ${B} and invoice_no = ${A}`;
r = await sales('erpInvoicePdf', [{ invoiceNo: A }]);
check('pdf: none saved -> drawn now (made), Invoice_<no>.pdf', r.ok && r.result.found && r.result.made === true &&
  r.result.name === 'Invoice_' + A + '.pdf' && /^https:\/\/files\.test\//.test(r.result.url) && r.result.notes.length === 0, r);
check('pdf saved in the invoices folder', files.list().includes(B + '/invoices/Invoice_' + A + '.pdf'));
let h = lastPdf().html;
check('designed page: business, invoice no, Bill To, Deliver To, method, delivery',
  h.includes('Costareen Ltd') && h.includes(A) && h.includes('Rahim') && h.includes('Mirpur') &&
  h.includes('<b>Payment</b><span>Cash</span>') && h.includes('Steadfast courier'), h.slice(0, 200));
check('designed page: "Amount due BDT 1,660" bar at the bottom with the PAYMENT DUE seal, due row red',
  /Amount due<\/span><em class="amt"><i class="sealat">[\s\S]*?>PAYMENT DUE<[\s\S]*?BDT 1,660<\/b>/.test(h) && h.includes('<tr class="due"><td>Due</td><td>BDT 1,660</td></tr>'));
check('designed page: discount split from the note tag (invoice discount only)',
  h.includes('<tr><td>Invoice discount</td><td>− 100</td></tr>') && !h.includes('Item discounts') &&
  h.includes('<tr><td>Subtotal</td><td>2,700</td></tr>') && h.includes('<tr><td>Delivery</td><td>60</td></tr>') &&
  h.includes('<tr class="tot"><td>Total</td><td>BDT 2,660</td></tr>') && h.includes('<tr><td>Paid</td><td>1,000</td></tr>'));
check('designed page: line shows gross (no per-line column when an invoice discount exists)',
  !h.includes('>Discount</th>') && h.includes('<td class="r">1,350</td><td class="r">2,700</td>'));
check('designed page: logo + QR embedded as data URLs, bank card, footer text, accent tints',
  h.includes('<img class="logo lgo" src="data:image/png;base64,') && h.includes('<div class="qr"><img src="data:image/png;base64,') &&
  h.includes('BRAC Bank') && h.includes('2080773020001') && h.includes('Thanks!') && h.includes('fill="#1a3c8f"'));
check('designed page: dark accent -> white text on it', h.includes('.owed{position:absolute;right:16mm;top:12mm;text-align:right;color:#ffffff}'));
const foot = lastPdf().opts.footer || '';
check('footer every page: two phones, email/web, address split', foot.includes('01700000000<br>01800000000') &&
  foot.includes('hi@costareen.com<br>costareen.com') && foot.includes('House 1<br>Dhanmondi, Dhaka'), foot);
let row = await inv(A);
check('invoice marked designed with its file', row.pdf_designed === true && row.pdf_path === 'invoices/Invoice_' + A + '.pdf', row);
r = await sales('erpInvoicePdf', [{ invoiceNo: A }]);
check('second open: the saved file, not redrawn', r.ok && r.result.found && !r.result.made && r.result.name === 'Invoice_' + A + '.pdf', r);
r = await sales('erpInvoicePdf', [{ invoiceNo: 'INV-NOPE' }]);
check('unknown invoice: not found', r.ok && r.result.found === false && r.result.why === 'No PDF was saved for INV-NOPE.', r);

// ------------------------------------------------------------ return preview
r = await mgr('erpReturnPreview', [{ invoiceNo: 'RTN-1' }]);
check('preview refuses a return id', !r.ok && r.error === 'That is a return, not a sale.', r);
r = await mgr('erpReturnPreview', [{ invoiceNo: 'INV-NOPE' }]);
check('preview: unknown invoice', !r.ok && r.error === 'No invoice called INV-NOPE.', r);
r = await sales('erpReturnPreview', [{ invoiceNo: A }]);
check('sales role cannot take returns', !r.ok && /does not have permission/.test(r.error), r);
r = await mgr('erpReturnPreview', [{ invoiceNo: A }]);
check('preview: unit = what was really paid (2600/2), grand/paid/owed, manager cannot refund',
  r.ok && r.result.lines.length === 1 && r.result.lines[0].unit === 1300 && r.result.lines[0].sold === 2 &&
  r.result.lines[0].left === 2 && r.result.grand === 2660 && r.result.paid === 1000 && r.result.owed === 1660 &&
  r.result.canRefund === false && r.result.hasAccount === true && r.result.customer === 'Rahim', r.result);
r = await owner('erpReturnPreview', [{ invoiceNo: A }]);
check('owner can refund', r.ok && r.result.canRefund === true);

// ------------------------------------------------------------ return goods
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 1 }], reason: '' }]);
check('reason required', !r.ok && r.error === 'Say why it came back, so the books can be read later.', r);
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: 'XYZ', qty: 1 }], reason: 'x' }]);
check('unknown sku', !r.ok && r.error === 'XYZ is not on invoice ' + A + '.', r);
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 0 }], reason: 'x' }]);
check('nothing coming back', !r.ok && r.error === 'Enter how many came back.', r);
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 3 }], reason: 'x' }]);
check('more than sold', !r.ok && r.error === 'Only 2 of Sunlu PLA Black can still come back on ' + A + ' (2 sold, 0 already returned).', r);

let before = await stockOf(PLA);
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: 'fil-sun-pla-bla-001', qty: 1, condition: 'good' }], money: 'due', reason: 'Wrong colour' }]);
check('return 1 good: 1300 off the due, restocked', r.ok && r.result.value === 1300 && r.result.units === 1 && r.result.restocked === 1 &&
  r.result.dueReduced === 1300 && r.result.refund === 0 && r.result.advance === 0 && /^RTN-\d{12}$/.test(r.result.returnId) &&
  r.result.pdfName === 'Return_' + r.result.returnId + '_' + A + '.pdf' && /^https:/.test(r.result.pdfUrl), r);
const R1 = r.result.returnId;
check('stock +1', (await stockOf(PLA)) === before + 1);
let ret = await sql`select * from returns where business_id = ${B} and return_no = ${R1}`;
check('RETURNS row: good, 1300, "due reduced", reason, by Mehedi', ret.length === 1 && ret[0].condition === 'good' && ret[0].value === 1300 &&
  ret[0].money === 'due reduced' && ret[0].reason === 'Wrong colour' && ret[0].recorded_by === 'Mehedi' && ret[0].customer === 'Rahim' && ret[0].invoice_no === A, ret);
let rtn = await inv(R1);
let rl = await sql`select * from invoice_lines where invoice_id = ${rtn.id}`;
check('RTN- invoice as the sheet wrote it: Paid, zeros, note, source, empty address',
  rtn.payment_status === 'Paid' && rtn.grand_total === 0 && rtn.advance_paid === 0 && rtn.due_amount === 0 && rtn.discount === 0 &&
  rtn.note === 'return of ' + A + ' - Wrong colour' && rtn.source === 'Steadfast courier' && rtn.customer_address === '' &&
  rtn.payment_method === 'Cash' && rtn.customer_phone === '01811111111', rtn);
check('RTN- line: -1 unit at 1300, total -1300, "(returned)", cost snapshot', rl.length === 1 && rl[0].qty === -1 && rl[0].unit_price === 1300 &&
  rl[0].line_total === -1300 && rl[0].name === 'Sunlu PLA Black (returned)' && rl[0].unit_cost === 900, rl);
let mv = await sql`select * from stock_movements where business_id = ${B} and reference = ${'Return: ' + A}`;
check('TXN RETURN IN: unit 0, customer in supplier, note "<RTN> - reason"', mv.length === 1 && mv[0].kind === 'RETURN' &&
  mv[0].direction === 'IN' && mv[0].qty === 1 && mv[0].unit_price === 0 && mv[0].supplier === 'Rahim' &&
  mv[0].note === R1 + ' - Wrong colour' && mv[0].operator === 'Mehedi' && /^TXN-\d{8}-\d{4}$/.test(mv[0].txn_no), mv);
let p = await pays(A);
check('PAYMENTS: +1300 Returned "goods returned [return:RTN]"', p.length === 2 && p[1].amount === 1300 && p[1].method === 'Returned' &&
  p[1].note === 'goods returned [return:' + R1 + ']' && /^R\d{12}$/.test(p[1].payment_no), p);
row = await inv(A);
check('invoice synced: paid 2300, due 360, Partial', row.advance_paid === 2300 && row.due_amount === 360 && row.payment_status === 'Partial', row);
h = lastPdf().html;
check('return note: id, invoice, table, "Taken off what was owed: 1300"', h.includes('Return note ' + R1) && h.includes('Against invoice <b>' + A + '</b>') &&
  h.includes('<td align="right">1</td><td>good</td><td align="right">1300</td>') && h.includes('Taken off what was owed: <b>1300</b>') &&
  h.includes('<h2 style="margin:0">Costareen</h2>'));

r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 1, condition: 'damaged' }], money: 'due', reason: 'Cracked' }]);
check('paid beyond the due: must choose', !r.ok && r.error === 'The customer has already paid 940 for these goods. Choose: refund it, or keep it as advance.', r);
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 1, condition: 'damaged' }], money: 'refund', reason: 'Cracked' }]);
check('manager cannot refund', !r.ok && r.error === 'Only the owner or a shareholder can hand money back. Keep it as advance, or ask them.', r);
before = await stockOf(PLA);
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 1, condition: 'damaged' }], money: 'advance', reason: 'Cracked' }]);
check('damaged return kept as advance: 360 off, 940 advance, nothing restocked', r.ok && r.result.dueReduced === 360 &&
  r.result.advance === 940 && r.result.restocked === 0 && r.result.units === 1, r);
const R2 = r.result.returnId;
check('a second return in the same second still gets its own id', R2 !== R1 && /^RTN-\d{12}(-\d+)?$/.test(R2), [R1, R2]);
check('damaged: stock unchanged', (await stockOf(PLA)) === before);
rl = await sql`select l.* from invoice_lines l join invoices i on i.id = l.invoice_id where i.invoice_no = ${R2}`;
check('damaged RTN line: 0 units, -1300, "(returned damaged)"', rl.length === 1 && rl[0].qty === 0 && rl[0].line_total === -1300 &&
  rl[0].name === 'Sunlu PLA Black (returned damaged)', rl);
ret = await sql`select * from returns where business_id = ${B} and return_no = ${R2}`;
check('RETURNS money word "advance 940"', ret[0].money === 'advance 940' && ret[0].condition === 'damaged', ret);
p = await pays(A);
check('PAYMENTS: +1300 returned, -940 moved to advance', p.length === 4 && p[2].amount === 1300 && p[3].amount === -940 &&
  p[3].method === 'Advance' && p[3].note === 'moved to advance [return:' + R2 + ']', p);
const acct = await sql`select * from payments where business_id = ${B} and invoice_no is null and note like ${'%' + A + '%'}`;
check('advance on account: +940 [advance] [acct:1811111111]', acct.length === 1 && acct[0].amount === 940 &&
  acct[0].note === 'from return of ' + A + ' [advance] [acct:1811111111]' && acct[0].customer_key === '1811111111', acct);
row = await inv(A);
check('invoice now Paid (ledger 2660)', row.payment_status === 'Paid' && row.due_amount === 0 && row.advance_paid === 2660, row);
r = await mgr('erpCustomerCredit', [{ phone: '01811111111' }]);
check('customer credit 940', r.ok && r.result.credit === 940, r);
r = await mgr('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 1 }], reason: 'again' }]);
check('nothing left to return', !r.ok && r.error === 'Only 0 of Sunlu PLA Black can still come back on ' + A + ' (2 sold, 2 already returned).', r);
r = await mgr('erpReturnPreview', [{ invoiceNo: A }]);
check('preview after: 2 returned, 0 left, returned value 2600', r.ok && r.result.lines[0].returned === 2 && r.result.lines[0].left === 0 &&
  r.result.returnedValue === 2600 && r.result.owed === 0, r.result);
r = await sales('erpInvoicePdf', [{ invoiceNo: A }]);
check('pdf open lists the two return notes', r.ok && r.result.notes.length === 2 && r.result.notes.every((n) => /^Return_RTN-.*_/.test(n.name)), r.result);

// ------------------------------------------------------------ cancel
// B: walk-in, printer, paid in full -> cancelled with a refund by the owner
r = await owner('erpCreateInvoice', [{ customer: { name: 'Walk' }, items: [{ sku: PRT, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const Bn = r.result.invoiceNo;
r = await mgr('erpCancelInvoice', [{ invoiceNo: Bn, reason: '' }]);
check('cancel: reason required', !r.ok && r.error === 'Say why the sale is being cancelled.', r);
r = await mgr('erpCancelInvoice', [{ invoiceNo: Bn, reason: 'changed mind' }]);
check('cancel: paid, must choose', !r.ok && r.error === 'The customer paid 52000 for this sale. Choose: refund it, or keep it as advance.', r);
r = await mgr('erpCancelInvoice', [{ invoiceNo: Bn, reason: 'changed mind', money: 'refund' }]);
check('cancel: manager cannot refund', !r.ok && r.error === 'Only the owner or a shareholder can hand money back. Keep it as advance, or ask them.', r);
before = await stockOf(PRT);
r = await shareholder('erpCancelInvoice', [{ invoiceNo: Bn, reason: 'changed mind', money: 'refund', method: 'bKash' }]);
check('shareholder cancels with refund 52000', r.ok && r.result.refund === 52000 && r.result.advance === 0 && r.result.units === 1 &&
  r.result.restocked === 1 && r.result.goods === 52000 && r.result.delivery === 0 && r.result.paid === 52000 && /^RTN-/.test(r.result.returnId), r);
check('printer back in stock', (await stockOf(PRT)) === before + 1);
p = await pays(Bn);
check('PAYMENTS: +52000 returned, -52000 refund (bKash)', p.length === 3 && p[1].amount === 52000 && p[2].amount === -52000 &&
  p[2].method === 'bKash' && /^refund paid out \[return:RTN-/.test(p[2].note), p);
ret = await sql`select * from returns where business_id = ${B} and invoice_no = ${Bn}`;
check('return reason "Invoice cancelled - changed mind"', ret.length === 1 && ret[0].reason === 'Invoice cancelled - changed mind' && ret[0].money === 'refunded 52000', ret);
check('invoice stays, marked cancelled', !!(await inv(Bn)).cancelled_at);
r = await mgr('erpCancelInvoice', [{ invoiceNo: Bn, reason: 'again' }]);
check('cancel refused once anything was returned', !r.ok && r.error === Bn + ' already has goods returned against it. Return the rest with the Return button instead of cancelling.', r);

// C: Salma, 1 x 1350 + delivery 100, paid 1450 -> cancelled, all kept as advance
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Salma', phone: '01922222222' }, items: [{ sku: PLA, qty: 1 }],
  deliveryCharge: 100, payMode: 'full', paymentMethod: 'Cash' }]);
const C = r.result.invoiceNo;
before = await stockOf(PLA);
r = await mgr('erpCancelInvoice', [{ invoiceNo: C, reason: 'entered by mistake', money: 'advance', condition: 'damaged' }]);
check('cancel with advance: goods 1350, delivery 100, all 1450 kept', r.ok && r.result.goods === 1350 && r.result.delivery === 100 &&
  r.result.paid === 1450 && r.result.advance === 1450 && r.result.refund === 0 && r.result.restocked === 0 && r.result.units === 1, r);
check('written off: stock unchanged', (await stockOf(PLA)) === before);
p = await pays(C);
check('PAYMENTS on C: +1450, +1350, -1350, +100 delivery, -100 to advance', p.map((x) => x.amount).join() === '1450,1350,-1350,100,-100' &&
  p[3].method === 'Adjusted' && p[3].note === 'delivery charge cancelled [cancel:' + C + ']' && /^X\d{12}$/.test(p[3].payment_no) &&
  p[4].note === 'delivery charge moved to advance [cancel:' + C + ']', p);
r = await mgr('erpCustomerCredit', [{ phone: '01922222222' }]);
check('Salma credit 1450', r.ok && r.result.credit === 1450, r);
row = await inv(C);
check('C stays Paid', row.payment_status === 'Paid' && row.due_amount === 0, row);

// E: Steadfast parcel already booked
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Nasir', phone: '01633333333', address: 'Uttara', source: 'Steadfast courier' }, items: [{ sku: PLA, qty: 1 }],
  payMode: 'cod' }]);
const E = r.result.invoiceNo;
await sql`update invoices set source = 'Steadfast courier' where invoice_no = ${E}`;
await sql`insert into courier_log (business_id, invoice_no, consignment_id, customer, cod_amount, booked_by)
          values (${B}, ${E}, 'CID-777', 'Nasir', 1350, 'Mehedi')`;
r = await mgr('erpCancelInvoice', [{ invoiceNo: E, reason: 'x' }]);
check('cancel refused with a parcel booked', !r.ok && r.error === 'A parcel (CID-777) is already booked with Steadfast for ' + E +
  '. Cancel it with Steadfast first; when it comes back, take it in with Return.', r);
r = await mgr('erpCancelInvoice', [{ invoiceNo: 'INV-NOPE', reason: 'x' }]);
check('cancel unknown invoice', !r.ok && r.error === 'No invoice called INV-NOPE.', r);

// ------------------------------------------------------------ fix details
r = await sales('erpFixInvoice', [{ invoiceNo: A, name: 'X' }]);
check('sales cannot fix', !r.ok && /does not have permission/.test(r.error), r);
r = await mgr('erpFixInvoice', [{ invoiceNo: A, name: 'Rahim', phone: '01811111111', address: 'Mirpur', delivery: 'Steadfast courier' }]);
check('nothing different', r.ok && r.result.changed === 0, r);
r = await mgr('erpFixInvoice', [{ invoiceNo: A, name: '  ' }]);
check('empty name refused', !r.ok && r.error === 'A sale needs a customer name.', r);
r = await mgr('erpFixInvoice', [{ invoiceNo: A, delivery: 'Bicycle' }]);
check('unknown delivery refused', !r.ok && r.error === '"Bicycle" is not one of the delivery methods.', r);
r = await mgr('erpFixInvoice', [{ invoiceNo: A, phone: '0181' }]);
check('bad phone refused', !r.ok && r.error === 'A Bangladeshi mobile number is 11 digits starting 013-019, like 01712345678 - "0181" has 4. Correct it, or leave it empty.', r);
const nPdf = pdfs.length;
r = await mgr('erpFixInvoice', [{ invoiceNo: A, name: 'Rahim Uddin', phone: '1811111112', address: 'Mirpur', delivery: 'Pathao Instant' }]);
check('fixed: customer, phone, delivery; corrected PDF', r.ok && r.result.changed === 3 && r.result.fields.join() === 'customer,phone,delivery' &&
  r.result.warning === '' && /Invoice_.*_corrected_\d{6}-\d{4}\.pdf$/.test(decodeURIComponent(r.result.pdfUrl)), r);
row = await inv(A);
check('invoice row rewritten, phone tidied, key follows', row.customer_name === 'Rahim Uddin' && row.customer_phone === '01811111112' &&
  row.source === 'Pathao Instant' && row.customer_key === '1811111112', row);
const fx = await sql`select * from invoice_fixes where business_id = ${B} and invoice_no = ${A} order by field`;
check('INVOICE_FIXES: 3 rows with was/now/by', fx.length === 3 && fx.find((x) => x.field === 'phone').was === '01811111111' &&
  fx.find((x) => x.field === 'phone').now === '01811111112' && fx[0].fixed_by === 'Mehedi', fx);
check('corrected copy carries the stamp', pdfs.length === nPdf + 1 && lastPdf().html.includes('CORRECTED COPY · ') && lastPdf().html.includes('Rahim Uddin'));
r = await mgr('erpFixInvoice', [{ invoiceNo: E, delivery: 'Pathao Instant' }]);
check('booked parcel: delivery cannot change', !r.ok && r.error === 'A parcel (CID-777) is already booked for this sale, so how it is delivered can no longer be changed.', r);
r = await mgr('erpFixInvoice', [{ invoiceNo: E, address: 'Uttara 7' }]);
check('booked parcel: address changes with a warning', r.ok && r.result.changed === 1 &&
  r.result.warning === 'The parcel CID-777 was booked with the old details. Tell Steadfast about the change yourself - this does not reach them.', r);
r = await mgr('erpFixInvoice', [{ invoiceNo: 'INV-NOPE', name: 'x' }]);
check('fix unknown invoice', !r.ok && r.error === 'No invoice called INV-NOPE.', r);

// ------------------------------------------------------------ the sales list
// two Steadfast sales put in directly: one before the courier was wired in, one after;
// and a website order whose parcel number lives on the website
async function rawInvoice(no, at, source, note, grand, paid) {
  const i = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, customer_address, source, note,
                       grand_total, advance_paid, due_amount, payment_method, payment_status, created_at)
                     values (${B}, ${no}, ${'Cust ' + no}, '01755555555', 'Somewhere', ${source}, ${note}, ${grand}, ${paid},
                             ${grand - paid}, 'COD', ${paid ? 'Partial' : 'Pending'}, ${at}) returning id`;
  await sql`insert into invoice_lines (business_id, invoice_id, sku, name, qty, unit_price, line_total)
            values (${B}, ${i[0].id}, ${PLA}, 'Sunlu PLA Black', 1, ${grand}, ${grand})`;
}
await rawInvoice('INV-OLD', new Date('2026-09-29T17:00:00Z'), 'Steadfast courier', '', 1000, 0);   // 29 Sep 23:00 Dhaka
await rawInvoice('INV-NEW', new Date('2026-09-29T18:30:00Z'), 'Steadfast courier', '', 1200, 200); // 30 Sep 00:30 Dhaka
await rawInvoice('INV-WEB', new Date('2026-10-01T06:00:00Z'), 'Steadfast courier', 'WEB-555', 900, 900);

web.calls.length = 0;
r = await sales('erpSales', [{ q: '', filter: 'all', limit: 100 }]);
const rowOf = (res, id) => res.rows.find((x) => x.id === id);
check('erpSales runs for sales; no RTN rows', r.ok && !r.result.rows.some((x) => /^RTN-/.test(x.id)), r);
let L = r.result;
const a = rowOf(L, A), b = rowOf(L, Bn), c = rowOf(L, C);
check('A: total 2660, returned 2600, net 60, all back, paid, Pathao', a && a.total === 2660 && a.returned === 2600 && a.returnedQty === 2 &&
  a.net === 60 && a.due === 0 && a.allBack === true && a.cancelled === false && a.delivery === 'Pathao Instant' && a.customer === 'Rahim Uddin', a);
check('B: cancelled, net 0', b && b.cancelled === true && b.net === 0 && b.returned === 52000, b);
check('C: cancelled', c && c.cancelled === true, c);
check('toSend: only INV-NEW (30 Sep on, Steadfast, not booked, not website), collects the due',
  L.toSend.length === 1 && L.toSend[0].id === 'INV-NEW' && L.toSend[0].collect === 1000 && L.toSend[0].total === 1200 && L.waiting === 1, L.toSend);
check('E: booked parcel shown', rowOf(L, E).consignment === 'CID-777' && rowOf(L, E).handled === true && rowOf(L, E).canSend === false);
check('website order: parcel number fetched from the website', rowOf(L, 'INV-WEB').consignment === 'SF-WEB-1' && rowOf(L, 'INV-WEB').fromSite === true);
check('website asked once, with the key', web.calls.length === 1 && web.calls[0].opts.headers['x-cz-key'] === 'k-123' &&
  web.calls[0].url === 'https://costareen.com/wp-json/cz/v1/cod?days=45&limit=200', web.calls);
check('dates d MMM yyyy', rowOf(L, 'INV-NEW').date === '30 Sep 2026' && rowOf(L, 'INV-OLD').date === '29 Sep 2026');
const fixtureGrand = L.rows.reduce((s, x) => s + x.total, 0);
check('totals: sold = sum of totals, returned = 2600+52000+1350', L.totals.sold === fixtureGrand && L.totals.returned === 2600 + 52000 + 1350 &&
  L.matched === L.rows.length && L.shown === L.rows.length, L.totals);
check('totals: due = 1350 (E) + 1000 (NEW) + 1000 (OLD)', L.totals.due === 3350, L.totals);

r = await sales('erpSales', [{ filter: 'due' }]);
check('filter due', r.ok && r.result.rows.map((x) => x.id).sort().join() === [E, 'INV-NEW', 'INV-OLD'].sort().join(), r.result.rows.map((x) => x.id));
r = await sales('erpSales', [{ filter: 'returned' }]);
check('filter returned', r.ok && r.result.rows.map((x) => x.id).sort().join() === [A, Bn, C].sort().join(), r.result.rows.map((x) => x.id));
r = await sales('erpSales', [{ filter: 'sent' }]);
check('filter sent: booked or website', r.ok && r.result.rows.map((x) => x.id).sort().join() === [E, 'INV-WEB'].sort().join(), r.result.rows.map((x) => x.id));
r = await sales('erpSales', [{ filter: 'tosend' }]);
check('filter tosend', r.ok && r.result.rows.length === 1 && r.result.rows[0].id === 'INV-NEW' && r.result.rows[0].canSend === true);
r = await sales('erpSales', [{ q: 'SALMA' }]);
check('search by name, case-insensitive; toSend not hidden by search', r.ok && r.result.rows.length === 1 && r.result.rows[0].id === C &&
  r.result.toSend.length === 1, r.result);
r = await sales('erpSales', [{ q: '01633' }]);
check('search by phone', r.ok && r.result.rows.length === 1 && r.result.rows[0].id === E);
r = await sales('erpSales', [{ limit: 1 }]);
check('limit clamps to at least 20', r.ok && r.result.rows.length === Math.min(20, r.result.matched));
check('the website numbers are remembered (no second fetch)', web.calls.length === 1, web.calls.length);

// ------------------------------------------------------------ the courier list
r = await sales('erpRecentInvoices', [60]);
const ro = (id) => r.result.find((x) => x.id === id);
check('recent: courier work only (Steadfast, website, booked), no walk-in, no RTN', r.ok && !ro(Bn) && !ro(A) && ro(E) && ro('INV-WEB') &&
  !r.result.some((x) => /^RTN-/.test(x.id)), r.result && r.result.map((x) => x.id));
check('recent: postable only from 30 Sep, booked one handled', ro('INV-NEW').postable === true && ro('INV-OLD').postable === false &&
  ro('INV-OLD').canSend === false && ro(E).postable === false && ro(E).handled === true && ro(E).consignment === 'CID-777', r.result);
check('recent: website order fromSite with its number', ro('INV-WEB').fromSite === true && ro('INV-WEB').consignment === 'SF-WEB-1' &&
  ro('INV-WEB').webBooked === true && !('ts' in ro('INV-WEB')), ro('INV-WEB'));
check('recent: shape', ro(E).units === 1 && ro(E).lines === 1 && ro(E).total === 1350 && ro(E).method === 'COD' && ro(E).status === 'Pending');
r = await sales('erpBundle', [['invoices']]);
check('bundle invoices part', r.ok && Array.isArray(r.result.invoices) && r.result.invoices.length >= 4, r.result && r.result.errors);

// the website down: the list still loads, without the number
S.forgetWebParcelIds();
web.on(/\/cod\?/, () => ({ status: 500, body: 'oops' }));
r = await sales('erpSales', [{}]);
check('website down: list loads, no number', r.ok && rowOf(r.result, 'INV-WEB').consignment === '', r);

// ------------------------------------------------------------ old plain PDFs are redrawn
await deps.storage.save(B, 'invoices', 'Invoice_' + E + '_corrected_260101-1010.pdf', new Uint8Array([1]), 'application/pdf');
await sql`update invoices set pdf_designed = false where invoice_no = ${E}`;
r = await sales('erpInvoicePdf', [{ invoiceNo: E }]);
check('plain copy redrawn in the design, corrected flag kept, old one removed', r.ok && r.result.made === true &&
  /^Invoice_.*_corrected_\d{6}-\d{4}\.pdf$/.test(r.result.name) && !files.list().includes(B + '/invoices/Invoice_' + E + '_corrected_260101-1010.pdf'), r);

// ------------------------------------------------------------ makeInvoicePdf export (walk-in, paid, per-line discount)
r = await owner('erpCreateInvoice', [{ customer: { name: 'Shop' }, items: [{ sku: PLA, qty: 2, discEach: 50 }], payMode: 'full', paymentMethod: 'Cash' }]);
const P = r.result.invoiceNo;
const made = await sql.begin(async (tx) => {
  await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' })}, true)`;
  return S.makeInvoicePdf({ tx, sql, biz: B, now: new Date(), memo: {}, deps,
    s: { userId: FIX.U.owner, name: 'Owner', role: 'owner', businessId: B, businessName: 'Costareen' } }, P, {});
});
h = lastPdf().html;
check('makeInvoicePdf returns {id,url,name}', made && made.name === 'Invoice_' + P + '.pdf' && made.id && /^https:/.test(made.url), made);
check('paid in full: Total bar with the PAID seal, per-line discount column, Nothing due', /Total<\/span><em class="amt"><i class="sealat">[\s\S]*?>PAID</.test(h) && h.includes('>Discount</th>') &&
  h.includes('<td class="r">−100</td><td class="r">2,600</td>') && h.includes('<tr class="ok"><td>Due</td><td>Nothing due</td></tr>') &&
  h.includes('<tr><td>Discount</td><td>− 100</td></tr>') && !h.includes('Deliver To'), h.slice(h.indexOf('<table class="items"'), h.indexOf('<table class="items"') + 600));

// ------------------------------------------------------------ void (owner only)
r = await owner('erpCreateInvoice', [{ customer: { name: 'Oops' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
const V = r.result.invoiceNo;
before = await stockOf(PLA);
r = await mgr('erpVoidInvoice', [V]);
check('manager cannot void', !r.ok && /does not have permission/.test(r.error), r);
r = await owner('erpVoidInvoice', ['']);
check('void needs a number', !r.ok && r.error === 'Type the invoice number to void.', r);
r = await owner('erpVoidInvoice', ['INV-NOPE']);
check('void unknown', !r.ok && r.error === 'Nothing found for invoice INV-NOPE.', r);
r = await owner('erpVoidInvoice', [V]);
check('void: 1 line, 1 movement, 1 unit, 1350', r.ok && r.result.salesLines === 1 && r.result.txnLines === 1 && r.result.units === 1 &&
  r.result.value === 1350 && r.result.invoiceNo === V, r);
check('void: invoice gone, stock back', !(await inv(V)) && (await stockOf(PLA)) === before + 1);

// another business's invoice is invisible
await sql`insert into invoices (business_id, invoice_no, customer_name) values (${FIX.B2}, 'INV-B2', 'Other')`;
r = await mgr('erpReturnPreview', [{ invoiceNo: 'INV-B2' }]);
check("another business's invoice is invisible", !r.ok && r.error === 'No invoice called INV-B2.', r);

await done();
