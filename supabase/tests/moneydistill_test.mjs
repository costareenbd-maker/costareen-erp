// distill-money (9 Nov 2026): payments in no account placed in one go (erpCashPlaceMany), the Money screen's
// month-lock figure (erpCashBook.lockedThrough), and the one net profit (Expenses net === Profitability net).
// Run: sh local/onetest.sh supabase/tests/moneydistill_test.mjs
import { sql, FIX, owner, mgr, check, done } from './harness.mjs';

const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const now = new Date(Date.now() + 6 * 3600e3);
const ym = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
const thisMonth = ym(now);
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + String(mo).padStart(2, '0'); };
const prev = shift(thisMonth, -1);

let r = await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Islami Bank', kind: 'bank' }, { name: 'BRAC Bank', kind: 'bank' }] }]);
const A = {}; r.result.accounts.forEach((a) => { A[a.name] = a.id; });
const book = () => owner('erpCashBook', [{}]);
const bal = async (n) => (await book()).result.accounts.find((a) => a.name === n).balance;

// ---- three payments by a method that has no account: they wait in no balance
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Salma', phone: '01911111111' }, items: [{ sku: PLA, qty: 3 }], payMode: 'none', paymentMethod: 'Bank Transfer' }]);
const INV = r.result.invoiceNo;
for (const amt of [100, 200, 300]) await mgr('erpRecordPayment', [{ orderId: INV, amount: amt, method: 'Cheque' }]);
r = await book();
check('three cheque payments wait in no account', r.result.loose.length === 3 && r.result.loose.reduce((t, p) => t + p.amount, 0) === 600 && (await bal('BRAC Bank')) === 0, r.result.loose);
check('the book says how far the months are closed (nothing closed yet: empty)', r.ok && 'lockedThrough' in r.result && !r.result.lockedThrough, r.result.lockedThrough);
const items = r.result.loose.map((p) => ({ src: 'payment', id: p.id }));

// ---- refusals
r = await mgr('erpCashPlaceMany', [{ account: A['BRAC Bank'], items }]);
check('a manager cannot place payments', !r.ok, r);
r = await owner('erpCashPlaceMany', [{ account: A['BRAC Bank'], items: [] }]);
check('nothing to place is refused plainly', !r.ok && /Nothing to place/.test(r.error), r);
r = await owner('erpCashPlaceMany', [{ account: A['BRAC Bank'], items: [{ src: 'expense', id: items[0].id }] }]);
check('only payments and courier payouts go this way', !r.ok && /Only payments and courier payouts/.test(r.error), r);
r = await owner('erpCashPlaceMany', [{ account: A['BRAC Bank'], items: [items[0], { src: 'payment', id: '00000000-0000-0000-0000-000000000000' }] }]);
check('one unknown line refuses the whole batch (nothing half-done)', !r.ok && /not found/.test(r.error) && (await bal('BRAC Bank')) === 0 && (await book()).result.loose.length === 3, r);

// ---- the batch
r = await owner('erpCashPlaceMany', [{ account: A['BRAC Bank'], items }]);
check('all three placed in one go', r.ok && r.result.placed === 3 && r.result.loose.length === 0 && (await bal('BRAC Bank')) === 600, r.ok ? { placed: r.result.placed, loose: r.result.loose } : r);
check('the other business is untouched', (await sql`select count(*)::int as n from payments where business_id = ${FIX.B2} and account_id = ${A['BRAC Bank']}`)[0].n === 0);

// ---- one net profit: Expenses and Profitability say the same figure for this month
const ex = await owner('erpExpenses', [{ month: thisMonth }]);
const pnl = await owner('erpPnl', [{ months: 1 }]);
check('Expenses net profit is exactly the P&L net profit', ex.ok && pnl.ok && ex.result.net === pnl.result.months[0].net, { ex: ex.result && ex.result.net, pnl: pnl.result && pnl.result.months[0].net });
check('the P&L month carries its lock state (open now)', pnl.ok && pnl.result.months[0].locked === false, pnl.result && pnl.result.months[0]);

// ---- a closed month shows on the Money screen, and a payment dated in it cannot be moved
await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 100, since: shift(thisMonth, -3) }]);
r = await owner('erpCapitalClose', [{ month: prev }]);
check('last month closed', r.ok && r.result.lockedThrough === prev, r);
r = await book();
check('the Money screen knows the books are closed up to last month', r.result.lockedThrough === prev, r.result.lockedThrough);
const pnl2 = await owner('erpPnl', [{ months: 2 }]);
check('the P&L marks the closed month locked and this month open', pnl2.ok && pnl2.result.months[0].locked === true && pnl2.result.months[1].locked === false, pnl2.result && pnl2.result.months.map((m) => [m.month, m.locked]));
await sql`update payments set paid_at = (${prev + '-15'}::date + interval '10 hours'), account_id = null where business_id = ${B} and invoice_no = ${INV} and amount = 100`;
r = await book();
const old = r.result.loose.find((p) => p.amount === 100);
r = await owner('erpCashPlaceMany', [{ account: A['Islami Bank'], items: [{ src: 'payment', id: old.id }] }]);
check('a payment dated in a closed month cannot be placed (the books there are final)', !r.ok && /closed/i.test(r.error) && (await bal('Islami Bank')) === 0, r);

await done();
