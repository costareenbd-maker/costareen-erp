// night-books B7 (owner D3 = A, 6 Nov 2026): joint stock with no capital written - what each side paid for the stock
// is its capital and the profit splits by it; the report says which rule made the split. Made-up figures only.
// Run: TEST_SCRIPT=books7_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'night-partner@t.test', ${sql.json({ full_name: 'Night Partner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Night Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B;
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;

let r = await owner('erpJointStart', [{ action: 'create', name: 'Night JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Night Partner', tier: 'retail' }]);
r = await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'NJ-PLA', name: 'Night PLA', retail: 2000, floor: 1500, cost: 1000 }]);
check('joint product made', r.ok, r);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'NJ-PLA', qty: 20, unitCost: 1000, paidBy: A }]);
check('Costareen paid for 20 x 1000', r.ok, r);
r = await other('erpJointReceive', [{ pool: POOL, sku: 'NJ-PLA', qty: 10, unitCost: 1000, paidBy: B3 }]);
check('the partner paid for 10 x 1000', r.ok, r);

const report = async () => (await owner('erpJoint', [{ pool: POOL }])).result.book.report;
const part = (rep, id) => rep.partners.find((x) => x.business_id === id);
let rep = await report();
check('B7 no capital written: the split is by what each paid for stock (not 50/50)', rep.ratio_basis === 'stock_paid' && rep.capital_basis === 'stock_paid', [rep.ratio_basis, rep.capital_basis]);
check('B7 each side\'s capital = what it paid for stock (20000 / 10000), written capital 0',
  part(rep, A).capital === 20000 && part(rep, B3).capital === 10000 && part(rep, A).capital_written === 0 && part(rep, A).stock_paid === 20000, rep.partners);
check('B7 shares 2/3 and 1/3', Math.abs(part(rep, A).ratio - 2 / 3) < 1e-5 && Math.abs(part(rep, B3).ratio - 1 / 3) < 1e-5, rep.partners.map((p) => p.ratio));
check('B7 the sums still balance', Math.abs(rep.balance_check) < 0.01, rep.balance_check);
check('B7 nothing sold yet: nobody owes anybody', (rep.transfers || []).length === 0, rep.transfers);

// a sale on Costareen's own invoice, paid in cash to Costareen: 3 x 2000 = 6000 in, goods 3000, profit 3000
const JS = (await mgr('erpJointCatalog', [])).result.products.find((p) => /Night PLA/.test(p.name)).sku;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Night Buyer', phone: '01712340003' }, items: [{ sku: JS, qty: 3 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('a joint sale', r.ok, r);
rep = await report();
check('B7 profit 3000 shared 2000 / 1000 by the stock money', rep.this_month.profit === 3000 && Math.abs(part(rep, A).profit_share - 2000) < 0.01 && Math.abs(part(rep, B3).profit_share - 1000) < 0.01, rep.partners);
check('B7 still balanced after the sale', Math.abs(rep.balance_check) < 0.01, rep.balance_check);
// Costareen holds the 6000. Should hold: 20000 + 2000 - 2/3 x 27000 stock = 4000; the partner: 10000 + 1000 - 9000 = 2000
check('B7 Costareen pays the partner 2000 (its share of the cash), not a 50/50 figure',
  rep.transfers.length === 1 && rep.transfers[0].from === A && rep.transfers[0].to === B3 && Math.abs(rep.transfers[0].amount - 2000) < 0.01, rep.transfers);

// once capital is written, the written capital rules again
r = await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 5000 }]);
check('capital written for Costareen', r.ok, r);
rep = await report();
check('B7 with capital written the basis is the written capital', rep.capital_basis === 'written' && rep.ratio_basis !== 'stock_paid' && part(rep, A).capital === 5000 && part(rep, B3).capital === 0, [rep.capital_basis, rep.ratio_basis, rep.partners]);

await done();
