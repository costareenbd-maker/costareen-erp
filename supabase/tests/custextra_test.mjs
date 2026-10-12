// FilaDash merge: customer extras (116_customer_extras.sql, handlers/custextra.js).
// Run: TEST_SCRIPT=custextra_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
await sql`update products set color = 'Black', brand = 'Sunlu' where business_id = ${B} and sku = ${PLA}`;
let r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim Uddin', phone: '01755500011', address: 'House 5, Mirpur' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('Karim buys', r.ok, r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim Uddin', phone: '01755500011' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const INV2 = r.result.invoiceNo;

// ---- insight
r = await sales('erpCustomerInsight', [{ phone: '01755500011' }]);
check('two orders, black Sunlu his favourite, bought today', r.ok && r.result.orders === 2 && r.result.favouriteColour.name === 'Black' && r.result.favouriteBrand.name === 'Sunlu' && r.result.daysSince === 0, r.result);

// ---- follow-ups
r = await sales('erpFollowupSave', [{ phone: '01755500011', due: '2026-01-01', note: 'Ask about the A1 he wanted' }]);
check('a follow-up (already overdue)', r.ok && r.result.totals.open === 1 && r.result.totals.overdue === 1, r.result);
r = await sales('erpFollowupSave', [{ phone: '01755500011', due: '2026-01-01', note: '' }]);
check('a follow-up needs what it is about', !r.ok, r);
const F = r.ok ? null : (await sales('erpFollowups', [{}])).result.followups[0].id;
r = await sales('erpFollowupDone', [{ id: F, outcome: 'He will come on Friday' }]);
check('done, with what came of it', r.ok && r.result.totals.open === 0 && r.result.followups[0].outcome === 'He will come on Friday', r.result);

// ---- removing his personal data
r = await mgr('erpCustomerErase', [{ phone: '01755500011', reason: 'asked by phone', confirm: 'Karim Uddin' }]);
check('only the owner', !r.ok, r);
r = await owner('erpCustomerErase', [{ phone: '01755500011', reason: 'asked by phone', confirm: 'Karim' }]);
check('the exact name must be typed to confirm', !r.ok && /Type the customer/.test(r.error), r);
await owner('erpTakeAdvance', [{ phone: '01755500011', name: 'Karim Uddin', amount: 500, method: 'Cash' }]);
r = await owner('erpCustomerErase', [{ phone: '01755500011', reason: 'asked by phone', confirm: 'Karim Uddin' }]);
check('refused while he holds credit', !r.ok && /holds credit/.test(r.error), r);
await sql`delete from payments where business_id = ${B} and note like '%[advance]%' and customer_key = '1755500011'`;
const totalBefore = (await sql`select sum(grand_total)::float as s from invoices where business_id = ${B}`)[0].s;
r = await owner('erpCustomerErase', [{ phone: '01755500011', reason: 'asked by phone on 13 Oct', confirm: 'Karim Uddin' }]);
check('removed', r.ok && /^Removed customer \d+$/.test(r.result.label) && r.result.rows >= 4 && r.result.tables.invoices === 2, r);
const left = await sql`select count(*)::int as n from invoices where business_id = ${B} and (customer_name like '%Karim%' or customer_phone like '%1755500011%' or customer_address like '%Mirpur%')`;
check('no invoice keeps his name, phone or address', left[0].n === 0, left);
const cust = await sql`select name, phone, address from customers where business_id = ${B} and name like 'Removed customer%'`;
check('the customer is "Removed customer N" with no phone or address', cust.length === 1 && !cust[0].phone && !cust[0].address, cust);
const pays = await sql`select count(*)::int as n from payments where business_id = ${B} and (customer like '%Karim%' or note like '%1755500011%' or customer_key = '1755500011')`;
check('no payment keeps him', pays[0].n === 0, pays);
const fu = await sql`select count(*)::int as n from customer_followups where business_id = ${B} and (customer like '%Karim%' or phone is not null)`;
check('nor a follow-up', fu[0].n === 0, fu);
const totalAfter = (await sql`select sum(grand_total)::float as s from invoices where business_id = ${B}`)[0].s;
check('the amounts are unchanged (the books do not move)', totalAfter === totalBefore, [totalAfter, totalBefore]);
const log = await sql`select reason, rows_changed, tables from customer_erasures where business_id = ${B}`;
check('the removal is logged without the removed details', log.length === 1 && log[0].reason.includes('asked by phone') && !JSON.stringify(log[0]).includes('Karim') && !JSON.stringify(log[0]).includes('1755500011'), log);
r = await sales('erpInvoice', [{ invoiceNo: INV2 }]);
check('his invoice still opens, under the new name', r.ok && JSON.stringify(r.result).includes('Removed customer') && !JSON.stringify(r.result).includes('Karim'), r.ok);

// ---- someone who owes cannot be removed
await sales('erpCreateInvoice', [{ customer: { name: 'Owes Money', phone: '01898765432' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
r = await owner('erpCustomerErase', [{ phone: '01898765432', reason: 'asked', confirm: 'Owes Money' }]);
check('refused while they owe', !r.ok && /still owes/.test(r.error), r);

await done();
