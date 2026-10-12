// Joint stock, step 4: the month-end sums - returns reduce sales, the slow-payer rule, flags,
// both owners agree before a month closes, the statement paper, the dashboard card, the sales list.
import { sql, FIX, owner, mgr, sales, check, done, deps, pdfs } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partner@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B;
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;
const now = new Date(Date.now() + 6 * 3600e3);
const month = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + String(mo).padStart(2, '0'); };
const prev = shift(month, -1), prev2 = shift(month, -2);

let r = await owner('erpJointStart', [{ action: 'create', name: 'Filament JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Shop', tier: 'retail' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black', retail: 2000, floor: 1700, cost: 1400 }]);
await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 20, unitCost: 1400, paidBy: A }]);
await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 14000 }]);
await other('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: B3, amount: 14000 }]);
// everything so far happened two months ago
await sql`update stock_movements set created_at = created_at - interval '70 days' where business_id = ${POOL}`;
await sql`update pool_ledger set entry_date = entry_date - 70 where pool_id = ${POOL}`;
await sql`update businesses set created_at = created_at - interval '80 days' where id = ${POOL}`;
const JS = (await sales('erpJointCatalog', [])).result.products[0].sku;
const report = async (m) => (await owner('erpJoint', [{ pool: POOL, month: m }])).result.book.report;
const part = (rep, id) => rep.partners.find((x) => x.business_id === id);

// ---- returns reduce the pool's sales
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: JS, qty: 3 }], payMode: 'full', paymentMethod: 'Cash' }]);
const INV1 = r.result.invoiceNo;
r = await mgr('erpReturnGoods', [{ invoiceNo: INV1, lines: [{ sku: JS, qty: 1, condition: 'good' }], money: 'advance', reason: 'wrong colour' }]);
let rep = await report(month);
check('a return reduces the pool\'s sales, cost and money', r.ok && rep.this_month.revenue === 4000 && rep.this_month.cogs === 2800 && rep.this_month.profit === 1200 &&
  part(rep, A).collected === 4000 && rep.to_date.receivables === 0 && part(rep, A).month_sales === 4000, rep);
check('the sums still balance', Math.abs(rep.balance_check) < 0.01, rep.balance_check);

// ---- the slow-payer rule
r = await sales('erpCreateInvoice', [{ customer: { name: 'Slow Payer', phone: '01811111111' }, items: [{ sku: JS, qty: 2 }], payMode: 'none' }]);
const INV2 = r.result.invoiceNo;
rep = await report(month);
check('a fresh credit sale is shared risk: receivable 4000, nothing overdue', rep.to_date.receivables === 4000 && rep.to_date.overdue === 0 && part(rep, A).overdue === 0 && rep.to_date.slow_days === 45, rep.to_date);
const heldBefore = part(rep, A).held;
// ...46 days later
const PINV2 = (await sql`select pool_invoice_no from joint_sales where seller_invoice_no = ${INV2}`)[0].pool_invoice_no;
await sql`update invoices set created_at = created_at - interval '46 days' where business_id = ${POOL} and invoice_no = ${PINV2}`;
rep = await report(month);
check('after 45 days the unpaid part counts as held by the seller', rep.to_date.overdue === 4000 && rep.to_date.receivables === 0 && part(rep, A).overdue === 4000 && part(rep, A).held === heldBefore + 4000 && part(rep, B3).overdue === 0, rep);
check('...still balanced', Math.abs(rep.balance_check) < 0.01, rep.balance_check);
r = await mgr('erpJoint', [{ pool: POOL }]);
let late = r.result.sales.find((s) => s.invoiceNo === INV2);
check('the sales list marks it late (and shows no cost)', !!late && late.late === true && late.due === 4000 && late.seller === 'Costareen' && JSON.stringify(r.result.sales).indexOf('1400') < 0, r.result.sales);
r = await owner('erpJointSettings', [{ pool: POOL, slowDays: 60 }]);
rep = await report(month);
check('60 days agreed instead: not overdue yet', rep.to_date.overdue === 0 && rep.to_date.receivables === 4000 && rep.to_date.slow_days === 60, rep.to_date);
await owner('erpJointSettings', [{ pool: POOL, slowDays: 45 }]);
r = await mgr('erpSettleDue', [{ orderId: INV2, amount: 4000, method: 'Cash' }]);
rep = await report(month);
check('when the customer pays, it is plain money again', r.ok && rep.to_date.overdue === 0 && rep.to_date.receivables === 0 && part(rep, A).held === heldBefore + 4000, rep);

// ---- the flag for a sale under the floor
r = await owner('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: JS, qty: 2, discEach: 400 }], payMode: 'full', paymentMethod: 'Cash' }]);
rep = await report(month);
check('a sale under the floor is listed for the partner', r.ok && rep.below_floor.length === 1 && rep.below_floor[0].seller === A && rep.below_floor[0].amount === 200 && rep.below_floor[0].invoice === r.result.invoiceNo, rep.below_floor);

// ---- both owners agree before a month closes
r = await owner('erpJointAgree', [{ pool: POOL, month }]);
check('this month cannot be agreed yet', !r.ok && /after it has ended/.test(r.error), r);
r = await mgr('erpJointAgree', [{ pool: POOL, month: prev2 }]);
check('a manager cannot agree', !r.ok, r);
r = await owner('erpJointAgree', [{ pool: POOL, month: prev2 }]);
check('one owner agrees: not closed', r.ok && r.result.book.report.closed === false && r.result.book.report.agreed.length === 1 && r.result.book.report.agreed[0] === A && r.result.book.closedMonths.length === 0, r.result && r.result.book.report);
r = await owner('erpJointAgree', [{ pool: POOL, month: prev2, withdraw: true }]);
check('...and can take it back', r.ok && r.result.book.report.agreed.length === 0, r.result && r.result.book.report.agreed);
await owner('erpJointAgree', [{ pool: POOL, month: prev2 }]);
r = await other('erpJointAgree', [{ pool: POOL, month: prev2 }]);
check('the second yes closes the month', r.ok && r.result.book.report.closed === true && r.result.book.closedMonths.length === 1 && r.result.book.report.agreed.length === 2, r.result && r.result.book.report);
r = await owner('erpJointAgree', [{ pool: POOL, month: prev2, withdraw: true }]);
check('a closed month stays closed', !r.ok && /already closed/.test(r.error), r);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 1, unitCost: 1400, paidBy: A, date: prev2 + '-15' }]);
check('nothing is received into a closed month', !r.ok && /closed and agreed/.test(r.error), r);
r = await owner('erpPoolClose', [{ month: prev }]);
check('the old one-sided close cannot be used from outside the pool', !r.ok, r);

// ---- the paper and the card
const n0 = pdfs.length;
r = await owner('erpJointStatementPdf', [{ pool: POOL, month }]);
const html = pdfs.length > n0 ? pdfs[pdfs.length - 1].html : '';
check('statement paper', r.ok && /^Joint_Filament_JV_/.test(r.result.name) && /Joint stock statement/.test(html) && /Costareen/.test(html) && /Partner Shop/.test(html) && /Sold under the floor price/.test(html), [r, html.slice(0, 300)]);
r = await mgr('erpJointStatementPdf', [{ pool: POOL, month }]);
check('...owners only', !r.ok, r);
r = await owner('erpJointCard', []);
rep = await report(month);
check('dashboard card: one line per pool', r.ok && r.result.pools.length === 1 && r.result.pools[0].profit === rep.this_month.profit && r.result.pools[0].share === 0.5 && Array.isArray(r.result.pools[0].transfers), r.result);
r = await mgr('erpJointCard', []);
check('...not for managers', !r.ok || r.result.pools.length === 0, r);
await done();
