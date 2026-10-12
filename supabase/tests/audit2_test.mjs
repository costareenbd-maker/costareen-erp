// Audit fixes (2026-10-05): a no-phone sale keeps the customer's phone; void is refused where money hangs on
// the invoice and otherwise takes it off the customer's totals; a phone change keeps the customer's advance;
// timer jobs run as one active owner per business.
import { owner, mgr, sql, FIX, deps, check, done } from './harness.mjs';
import { owners } from '../functions/erp/jobs.js';
const B = FIX.B, PLA = 'FIL-SUN-PLA-BLA-001';
const sale = (customer, pay) => owner('erpCreateInvoice', [{ customer, items: [{ sku: PLA, qty: 1 }], payMode: pay || 'full', paymentMethod: 'Cash' }]);

// 1. a sale with no phone, by the name of a customer on the list, does not wipe their phone
let r = await sale({ name: 'Phone Keeper', phone: '01799300001' });
r = await sale({ name: 'Phone Keeper' });
let c = (await sql`select phone, customer_key from customers where business_id = ${B} and name = 'Phone Keeper'`)[0];
check('a no-phone sale keeps the phone on file', r.ok && c && /1799300001/.test(c.phone) && c.customer_key === '1799300001', [r.ok, c]);

// 2. void: refused when payments hang on it; otherwise the customer's totals drop
r = await sale({ name: 'Void Paid', phone: '01799300002' }, 'full');
const paid = r.result.invoiceNo;
r = await owner('erpVoidInvoice', [paid]);
check('void refused for an invoice with payments', !r.ok && /has payments/.test(r.error) && /Cancel it instead/.test(r.error), r);
r = await sale({ name: 'Void Free', phone: '01799300003' }, 'none');
const free = r.result.invoiceNo;
const before = (await sql`select total_orders, total_spent from customers where business_id = ${B} and phone like '%1799300003'`)[0];
r = await owner('erpVoidInvoice', [free]);
const after = (await sql`select total_orders, total_spent from customers where business_id = ${B} and phone like '%1799300003'`)[0];
check('void allowed without payments, and the customer\'s totals drop', r.ok && after.total_orders === before.total_orders - 1 && after.total_spent < before.total_spent, [r.ok, before, after]);

// 3. a phone change moves the customer's advance with them
r = await sale({ name: 'Adv Mover', phone: '01799300004' });
r = await mgr('erpTakeAdvance', [{ phone: '01799300004', name: 'Adv Mover', amount: 500 }]);
let cr = await mgr('erpCustomerCredit', [{ phone: '01799300004' }]);
check('the advance is held', r.ok && cr.ok && cr.result.credit === 500, [r, cr]);
const row = (await sql`select seq from customers where business_id = ${B} and phone like '%1799300004'`)[0];
r = await owner('erpSaveCustomer', [{ row: row.seq, name: 'Adv Mover', phone: '01799300044' }]);
cr = await mgr('erpCustomerCredit', [{ phone: '01799300044' }]);
const invPh = (await sql`select customer_phone from invoices where business_id = ${B} and customer_name = 'Adv Mover'`).map((x) => x.customer_phone);
check('after the phone change the advance is still theirs', r.ok && cr.ok && cr.result.credit === 500, [r, cr]);
check('...and their invoices carry the new phone', invPh.length >= 1 && invPh.every((p) => /1799300044/.test(p)), invPh);

// 4. timer jobs: one active owner per business, none for a switched-off owner
await sql`insert into auth.users (id, email) values ('00000000-0000-4000-8000-0000000000a1', 'off@x.test') on conflict do nothing`;
await sql`insert into memberships (business_id, user_id, role, active, created_at) values (${B}, '00000000-0000-4000-8000-0000000000a1', 'owner', false, now() - interval '10 years') on conflict do nothing`;
const os = await owners(deps.sql || sql);
const forB = os.filter((o) => o.business_id === B);
check('one owner row per business, and not the switched-off one', forB.length === 1 && forB[0].user_id !== '00000000-0000-4000-8000-0000000000a1', forB);
await done();
