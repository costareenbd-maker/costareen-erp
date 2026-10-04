// One phone = one customer: an invoice never renames a saved customer; the name is changed on the customer's
// page and then follows on every invoice and payment of theirs.
import { owner, mgr, sql, FIX, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001';
const sale = (name, phone, extra) => owner('erpCreateInvoice', [{ customer: { name, phone }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash', ...(extra || {}) }]);

let r = await sale('Karim Uddin', '01799000111');
check('a new phone makes a new customer', r.ok, r);
const A = r.ok ? r.result.invoiceNo : '';
let c = await sql`select seq, name from customers where business_id = ${FIX.B} and phone like '%1799000111'`;
check('the customer is on the list with the typed name', c.length === 1 && c[0].name === 'Karim Uddin', c);

r = await sale('Karim vai [shop]', '01799000111');
const B = r.ok ? r.result.invoiceNo : '';
let inv = await sql`select invoice_no, customer_name from invoices where business_id = ${FIX.B} and invoice_no = any(${[A, B]}::text[]) order by invoice_no`;
check('the same phone with another name: the invoice gets the saved name', r.ok && inv.every((i) => i.customer_name === 'Karim Uddin'), inv);
c = await sql`select seq, name from customers where business_id = ${FIX.B} and phone like '%1799000111'`;
check('and the saved customer is not renamed, nor doubled', c.length === 1 && c[0].name === 'Karim Uddin', c);

r = await mgr('erpFixInvoice', [{ invoiceNo: B, name: 'Somebody Else' }]);
check('the name cannot be changed on an invoice of a saved customer', !r.ok && /belongs to Karim Uddin/.test(r.error), r);

r = await owner('erpSaveCustomer', [{ row: c[0].seq, name: 'Karim Uddin Ahmed', phone: '01799000111' }]);
inv = await sql`select customer_name from invoices where business_id = ${FIX.B} and invoice_no = any(${[A, B]}::text[])`;
const pay = await sql`select customer from payments where business_id = ${FIX.B} and invoice_no = any(${[A, B]}::text[])`;
check('renamed on the customer page: every invoice of theirs follows', r.ok && inv.length === 2 && inv.every((i) => i.customer_name === 'Karim Uddin Ahmed'), inv);
check('and their payments too', pay.length >= 1 && pay.every((p) => p.customer === 'Karim Uddin Ahmed'), pay);

r = await sale('Rahim', '01799000222');
const other = (await sql`select seq from customers where business_id = ${FIX.B} and phone like '%1799000222'`)[0];
r = await owner('erpSaveCustomer', [{ row: other.seq, name: 'Rahim', phone: '01799000111' }]);
check('a customer cannot take a phone number that is already another customer\'s', !r.ok && /already belongs to Karim Uddin Ahmed/.test(r.error), r);
await done();
