// crit4-pay (10 Nov 2026): a payment's method lands in the money account of the same name when the owner's rules say
// nothing about it (Cash -> the Cash account, bKash / Bkash / BKASH -> the bKash account). The owner's own rule still
// wins; an unknown method stays in "Payments in no account"; lines already written are never moved; what is not money
// (Adjusted, Advance used...) touches no account; the other business is untouched; a closed month still refuses.
// Run: sh local/onetest.sh supabase/tests/payfinal_test.mjs
import { sql, FIX, owner, mgr, check, done } from './harness.mjs';

const B = FIX.B;
const now = new Date(Date.now() + 6 * 3600e3);
const thisMonth = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
let r;

// accounts made one by one (no erpCashSetup, so the rules map is EMPTY - the case the owner hit)
for (const a of [['Cash', 'cash'], ['bKash', 'wallet'], ['City Bank', 'bank']]) {
  r = await owner('erpCashAccountSave', [{ name: a[0], kind: a[1] }]);
  check('account ' + a[0] + ' made', r.ok, r);
}
const A = {};
(await sql`select id, name from money_accounts where business_id = ${B}`).forEach((a) => { A[a.name] = a.id; });
check('three accounts, no method rules', !!(A.Cash && A.bKash && A['City Bank']), A);

await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status)
          values (${B}, 'PF-PLA', 'Pay final PLA', 'Filaments', 'Test', 'PLA', 0, 1000, 'Active')`;
r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-PF', supplier: 'Dragon', mode: 'bdt', totalBdt: 25000, lines: [{ sku: 'PF-PLA', qty: 50 }] }]);
check('50 PLA received', r.ok, r);

// a line written before this fix with no account (the 105 "payments in no account"): it must stay where it is
await sql`insert into payments (business_id, payment_no, invoice_no, customer, paid_at, amount, method, note, recorded_by, account_id)
          values (${B}, 'P-OLD-1', null, 'Old', now(), 500, 'Cash', 'before the fix', 'test', null)`;

const acc = async (no) => (await sql`select amount, method, account_id from payments where business_id = ${B} and invoice_no = ${no} order by seq`);

// ---------------------------------------------------------------- invoice saved, paid now in Cash -> the Cash account
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim Store', phone: '01811111111' }, items: [{ sku: 'PF-PLA', qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('invoice of 2,000 paid now in Cash', r.ok && r.result.grandTotal === 2000, r);
let p = await acc(r.result.invoiceNo);
check('...the payment landed in the Cash account', p.length === 1 && p[0].account_id === A.Cash, p);

// a method spelt differently ("BKASH", " bkash ") still finds the bKash account
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Lamia Akter', phone: '01822222222' }, items: [{ sku: 'PF-PLA', qty: 3 }], payMode: 'part', paidNow: 1000, paymentMethod: 'BKASH' }]);
check('invoice of 3,000 part paid 1,000 by BKASH', r.ok, r);
const LAMIA = r.result.invoiceNo;
p = await acc(LAMIA);
check('...BKASH landed in the bKash account', p.length === 1 && p[0].account_id === A.bKash, p);

// ---------------------------------------------------------------- receive due by bKash -> the bKash account
r = await mgr('erpSettleDue', [{ orderId: LAMIA, reason: 'payment', amount: 700, method: 'bKash' }]);
check('700 received by bKash on the due', r.ok, r);
p = await acc(LAMIA);
check('...in the bKash account', p.length === 2 && p[1].account_id === A.bKash && Number(p[1].amount) === 700, p);

// split parts: each part finds its own account by name
r = await mgr('erpSettleDue', [{ orderId: LAMIA, reason: 'payment', parts: [{ amount: 300, method: 'Cash' }, { amount: 200, method: ' bkash ' }] }]);
check('300 Cash + 200 bkash as one payment', r.ok, r);
p = await acc(LAMIA);
check('...each part in its own account', p.length === 4 && p[2].account_id === A.Cash && p[3].account_id === A.bKash, p);

// ---------------------------------------------------------------- an unknown method stays unplaced
r = await mgr('erpSettleDue', [{ orderId: LAMIA, reason: 'payment', amount: 100, method: 'Nagad' }]);
check('100 by Nagad (no account called Nagad)', r.ok, r);
p = await acc(LAMIA);
check('...stays in no account', p.length === 5 && p[4].account_id === null, p);
r = await owner('erpCashBook', [{}]);
check('...and is listed under payments in no account', r.ok && r.result.loose.some((l) => l.method === 'Nagad' && l.amount === 100), r.ok ? r.result.loose : r);

// what is not money touches no account, even with an account called like it
r = await owner('erpCashAccountSave', [{ name: 'Adjusted', kind: 'bank' }]);
check('an account oddly called Adjusted', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01833333333' }, items: [{ sku: 'PF-PLA', qty: 1 }], payMode: 'none' }]);
const KARIM = r.result.invoiceNo;
r = await owner('erpSettleDue', [{ orderId: KARIM, reason: 'reduce', amount: 100, note: 'a discount after the sale' }]);
check('a due reduced (no money came)', r.ok, r);
p = await acc(KARIM);
check('...the adjustment is in no account', p.length === 1 && p[0].account_id === null, p);

// ---------------------------------------------------------------- the owner's own rule wins over the name
r = await owner('erpCashMapSave', [{ map: { cash: A['City Bank'] } }]);
check('the owner says Cash lands in City Bank', r.ok, r);
r = await mgr('erpSettleDue', [{ orderId: KARIM, reason: 'payment', amount: 400, method: 'Cash' }]);
check('400 Cash received', r.ok, r);
p = await acc(KARIM);
check('...landed where the owner\'s rule says (City Bank), not the Cash account', p.length === 2 && p[1].account_id === A['City Bank'], p);

// an archived account is never chosen by name
r = await owner('erpCashMapSave', [{ map: {} }]);
await sql`update money_accounts set archived = true where id = ${A.bKash}`;
r = await mgr('erpSettleDue', [{ orderId: KARIM, reason: 'payment', amount: 50, method: 'bKash' }]);
check('50 bKash received while the bKash account is archived', r.ok, r);
p = await acc(KARIM);
check('...stays in no account', p.length === 3 && p[2].account_id === null, p);
await sql`update money_accounts set archived = false where id = ${A.bKash}`;

// ---------------------------------------------------------------- old unplaced lines are not moved
const old = (await sql`select account_id from payments where business_id = ${B} and payment_no = 'P-OLD-1'`)[0];
check('the line written before the fix is still in no account', old && old.account_id === null, old);

// ---------------------------------------------------------------- the invoice says every way it was paid
r = await owner('erpInvoice', [{ invoiceNo: LAMIA }]);
check('the invoice lists every method it was paid by', r.ok && r.result.paidBy === 'BKASH + Cash + Nagad', r.ok ? r.result.paidBy : r);
check('...each payment row carries its method', r.ok && r.result.payments.every((x) => typeof x.method === 'string'), r.ok ? r.result.payments : r);

// ---------------------------------------------------------------- a closed month still refuses
await sql`insert into capital_closed (business_id, month, net_profit, shares, by) values (${B}, ${thisMonth}, 0, '{}'::jsonb, 'test')`;
r = await mgr('erpSettleDue', [{ orderId: KARIM, reason: 'payment', amount: 10, method: 'Cash' }]);
check('closed month: receiving a due refuses plainly', !r.ok && /is closed/.test(r.error), r);
await sql`delete from capital_closed where business_id = ${B} and month = ${thisMonth} and by = 'test'`;

// ---------------------------------------------------------------- the other business is untouched
const other = await sql`select (select count(*)::int from payments where business_id = ${FIX.B2}) p, (select count(*)::int from money_accounts where business_id = ${FIX.B2}) a`;
check('the other business has none of this', other[0].p === 0 && other[0].a === 0, other[0]);

await done();
