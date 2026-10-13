// 119: money paid before the ERP (on the Google Sheet) is never lost when a payment or a return is recorded later.
// The case that happened on 13 Oct 2026: a 3,900 July sale marked Paid on the sheet with no payments row;
// one item was returned and refunded in cash - and the invoice then showed 3,900 due.
import { sql, FIX, owner, mgr, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001';

// an invoice as the sheet import left it: Paid, nothing in payments, advance 0, due = total
async function sheetPaid(no) {
  await sql`update invoices set payment_status = 'Paid', advance_paid = 0, due_amount = grand_total where business_id = ${FIX.B} and invoice_no = ${no}`;
  await sql`delete from payments where business_id = ${FIX.B} and invoice_no = ${no}`;
  // the one-time fill from 119_paid_outside.sql
  await sql`update invoices i set paid_outside = round(i.grand_total - coalesce((select sum(p.amount) from payments p
              where p.business_id = i.business_id and p.invoice_no = i.invoice_no), 0), 2)
            where i.business_id = ${FIX.B} and i.invoice_no = ${no} and i.payment_status = 'Paid' and i.voided_at is null and i.paid_outside = 0
              and i.grand_total - coalesce((select sum(p.amount) from payments p where p.business_id = i.business_id and p.invoice_no = i.invoice_no), 0) > 0.5`;
}
const inv = async (no) => (await sql`select payment_status, advance_paid, due_amount, paid_outside, grand_total from invoices where business_id = ${FIX.B} and invoice_no = ${no}`)[0];
const dueOn = async (no) => { const r = await owner('erpDues', [{}]); return (r.result.invoices.find((x) => x.id === no) || { due: 0 }).due; };

let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Old Customer', phone: '01700000001' }, items: [{ sku: PLA, qty: 2 }], payMode: 'none', paymentMethod: 'Cash' }]);
const A = r.result.invoiceNo;
await sheetPaid(A);
let i = await inv(A);
check('the fill puts the sheet\'s money on the invoice', Number(i.paid_outside) === Number(i.grand_total) && i.payment_status === 'Paid', i);
check('nothing due before the return', (await dueOn(A)) === 0);

r = await owner('erpReturnGoods', [{ invoiceNo: A, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'refund', method: 'Cash', reason: 'not supported' }]);
check('a return with a cash refund is saved', r.ok, r);
i = await inv(A);
check('still Paid after the return, nothing due', i.payment_status === 'Paid' && Number(i.due_amount) === 0, i);
check('no due in the dues list after the return', (await dueOn(A)) === 0);

// a payment recorded on an old Paid invoice (e.g. a tip or a correction) does not wipe the sheet's money either
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none', paymentMethod: 'Cash' }]);
const B = r.result.invoiceNo;
await sheetPaid(B);
r = await owner('erpReturnGoods', [{ invoiceNo: B, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'advance', reason: 'kept as advance' }]);
i = await inv(B);
check('a return kept as advance on an old Paid invoice leaves nothing due', r.ok && i.payment_status === 'Paid' && Number(i.due_amount) === 0 && (await dueOn(B)) === 0, [r, i]);

// an ERP-era unpaid invoice still shows its due (the fix adds only money that was really paid outside)
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Salma', phone: '01911111111' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none', paymentMethod: 'Cash' }]);
const C = r.result.invoiceNo;
i = await inv(C);
check('a new unpaid invoice has nothing paid outside and its full due', Number(i.paid_outside) === 0 && (await dueOn(C)) === Number(i.grand_total), i);
r = await mgr('erpRecordPayment', [{ orderId: C, amount: 500, method: 'Cash' }]);
i = await inv(C);
check('a part payment on it leaves the rest due', r.ok && i.payment_status === 'Partial' && Number(i.due_amount) === Number(i.grand_total) - 500, i);

done();
