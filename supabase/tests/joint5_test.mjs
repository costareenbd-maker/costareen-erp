// Joint stock: where the goods are. 1,000 received: 700 on Costareen's shelf, 300 on the partner's. The partner sells
// 100 (his shelf), collects 250 more (Move), sells 400; Costareen sells 200. Held counts, the automatic move when a
// seller sells more than he holds, counts per shelf, a return to the seller's shelf, a move that is refused.
import { sql, FIX, owner, mgr, sales, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partner5@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B;
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;

let r = await owner('erpJointStart', [{ action: 'create', name: 'Import JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Shop', tier: 'wholesale' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'JV-PLA', name: 'JV PLA Black 1kg', category: 'Filament', brand: 'JV', retail: 2000, wholesale: 1800, floor: 1700, cost: 1000 }]);
const held = (res) => res.result.stock.find((s) => s.sku === 'JV-PLA').held;

// 1. 1,000 in: 700 on Costareen's shelf (Costareen paid), 300 on the partner's (the partner paid)
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'JV-PLA', qty: 700, unitCost: 1000, paidBy: A }]);
check('received at the payer’s shelf unless said otherwise', r.ok && held(r)[A] === 700 && !held(r)[B3], r.ok ? held(r) : r);
r = await other('erpJointReceive', [{ pool: POOL, sku: 'JV-PLA', qty: 300, unitCost: 1000, paidBy: B3, receivedAt: B3 }]);
check('1,000 in the pool: 700 at Costareen, 300 at the partner', r.ok && r.result.stock[0].stock === 1000 && held(r)[A] === 700 && held(r)[B3] === 300, r.ok ? held(r) : r);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'JV-PLA', qty: 1, unitCost: 1000, paidBy: A, receivedAt: 'nobody' }]);
check('received at someone who is not a partner: refused', !r.ok, r);

// 2. the partner sells 100 from his own shelf
const JS = (await other('erpJointCatalog', [])).result.products.find((p) => p.code === 'JV-PLA').sku;
r = await other('erpCreateInvoice', [{ customer: { name: 'Buyer A', phone: '01712345678' }, items: [{ sku: JS, qty: 100 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('the partner sells 100', r.ok, r);
r = await other('erpJoint', [{ pool: POOL }]);
check('his shelf 200, Costareen’s untouched 700, pool 900', held(r)[B3] === 200 && held(r)[A] === 700 && r.result.stock[0].stock === 900, held(r));

// 3. he collects 250 from Costareen: Move
r = await other('erpJointMove', [{ pool: POOL, sku: 'JV-PLA', from: A, to: B3, qty: 250, note: 'collected by van' }]);
check('moved 250: Costareen 450, partner 450; the pool total unchanged', r.ok && held(r)[A] === 450 && held(r)[B3] === 450 && r.result.stock[0].stock === 900 && r.result.moved.from === 'Costareen', r.ok ? held(r) : r);
const mv = await sql`select kind, direction, qty, held_by, note from stock_movements where business_id = ${POOL} and kind = 'MOVE' order by txn_no`;
check('two MOVE rows, OUT from one shelf and IN to the other, same note', mv.length === 2 && mv[0].direction === 'OUT' && mv[0].held_by === A && mv[1].direction === 'IN' && mv[1].held_by === B3 && /van/.test(mv[0].note), mv);
r = await other('erpJointMove', [{ pool: POOL, sku: 'JV-PLA', from: B3, to: A, qty: 451 }]);
check('moving more than the shelf holds is refused with the count', !r.ok && /holds only 450/.test(r.error), r);
r = await sales('erpJointMove', [{ pool: POOL, sku: 'JV-PLA', from: A, to: B3, qty: 1 }]);
check('staff cannot move joint stock', !r.ok, r);

// 4. he sells 400 (holds 450); Costareen sells 200
r = await other('erpCreateInvoice', [{ customer: { name: 'Buyer B', phone: '01712345679' }, items: [{ sku: JS, qty: 400 }], payMode: 'full', paymentMethod: 'Cash' }]);
r = await owner('erpCreateInvoice', [{ customer: { name: 'Buyer C', phone: '01712345670' }, items: [{ sku: JS, qty: 200 }], payMode: 'full', paymentMethod: 'Cash' }]);
r = await owner('erpJoint', [{ pool: POOL }]);
check('after the sales: Costareen 250, partner 50, pool 300', held(r)[A] === 250 && held(r)[B3] === 50 && r.result.stock[0].stock === 300, held(r));

// 5. he sells 80 holding 50: the 30 are marked moved from Costareen on the sale, nothing refused
r = await other('erpCreateInvoice', [{ customer: { name: 'Buyer D', phone: '01712345671' }, items: [{ sku: JS, qty: 80 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('the sale goes through although his shelf held only 50', r.ok, r);
r = await owner('erpJoint', [{ pool: POOL }]);
check('30 moved on the sale: Costareen 220, partner 0, pool 220', held(r)[A] === 220 && (held(r)[B3] || 0) === 0 && r.result.stock[0].stock === 220, held(r));
const auto = await sql`select note from stock_movements where business_id = ${POOL} and kind = 'MOVE' and note like 'Moved on sale%' limit 1`;
check('the automatic move is written with the invoice number', auto.length === 1, auto);

// 6. a count on one shelf; a return comes back to the seller's shelf
r = await owner('erpJointAdjust', [{ pool: POOL, sku: 'JV-PLA', qty: 5, direction: 'out', reason: '5 rolls water damaged', at: A }]);
check('Costareen’s shelf counted 5 short: 215', r.ok && held(r)[A] === 215, r.ok ? held(r) : r);
const inv = (await sql`select invoice_no from invoices where business_id = ${A} and customer_name = 'Buyer C'`)[0].invoice_no;
r = await owner('erpReturnGoods', [{ invoiceNo: inv, lines: [{ sku: JS, qty: 10, condition: 'good' }], money: 'advance', reason: 'unopened, returned' }]);
check('a return of 10 lands on the seller’s shelf: Costareen 225', r.ok && held((await owner('erpJoint', [{ pool: POOL }])))[A] === 225, r);
await done();
