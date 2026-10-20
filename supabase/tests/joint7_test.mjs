// Joint stock fixes of 20 Oct 2026 (tags joint-fix-1..5), each with the case that went wrong before:
//  1. the pool is not a business of its own: not in the menu, cannot be opened, nothing is sold inside it
//  2. a damaged joint return is one loss (the pool's), not two; goods received by mistake are undone, not a loss;
//     a bill closed with a write-off pays the pool its whole part; sponsorship rolls lent to brands are shown apart
//  3. "I agree" is to the exact sums (a later change asks for a new yes); months close in order; each owner writes
//     only their own company's book lines
//  4. staff never get the pool's cost (receive reply, margins); every owner of a partner company is a pool owner
//  5. a dropped pool copy takes its shelf moves with it; a pool return note carries the seller's mark
import { sql, FIX, owner, mgr, sales, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const J = await import(pathToFileURL(path.join(fnDir, 'handlers', 'joint.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partner7@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B, num = (v) => Number(v || 0);
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;
const dhaka = new Date(Date.now() + 6 * 3600e3);
const month = dhaka.toISOString().slice(0, 7);
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } return y + '-' + String(mo).padStart(2, '0'); };
const prev = shift(month, -1), prev2 = shift(month, -2);

let r = await owner('erpJointStart', [{ action: 'create', name: 'Fix JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Shop', tier: 'wholesale' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black', retail: 2000, wholesale: 1800, floor: 1700, cost: 1400 }]);
await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 10, unitCost: 1400, paidBy: A }]);
await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 14000 }]);
await other('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: B3, amount: 14000 }]);
const JS = (await sales('erpJointCatalog', [])).result.products[0].sku;
const rep = async (m) => (await owner('erpJoint', [{ pool: POOL, month: m }])).result.book.report;
const P = (rp, id) => rp.partners.find((p) => p.business_id === id);
const poolStock = async () => num((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${POOL}`)[0].s);

// ---- 1. the pool is not a business of its own
r = await owner('erpBusinesses', []);
check('1. the pool is not in the business menu', r.ok && !r.result.businesses.some((b) => b.id === POOL), r.result);
r = await owner('erpSetBusiness', [POOL]);
check('1. ...and cannot be opened as a business', !r.ok && /not opened as a business/.test(r.error), r);
await sql`insert into erp_prefs (user_id, active_business) values (${FIX.U.owner}, ${POOL}) on conflict (user_id) do update set active_business = ${POOL}`;
r = await owner('erpBusinesses', []);
check('1. a device that still asks for the pool gets the own company', r.ok && r.result.active === A, r.result && r.result.active);
r = await owner('erpCreateInvoice', [{ from: POOL, customer: { name: 'Walk In', phone: '01844444444' }, items: [{ sku: 'PM-PLA-BLK', qty: 1 }], payMode: 'full' }]);
check('1. the old "sell from the pool" route is closed (customers stay in the seller\'s books)', !r.ok && /your own invoice/.test(r.error), r);
check('1. nothing was sold inside the pool', (await sql`select count(*)::int as n from invoices where business_id = ${POOL}`)[0].n === 0);

// ---- 2a. a damaged joint return: one loss, the pool's
const pnlMonth = async () => { const x = (await owner('erpPnl', [])).result; return (x.months || x).find((m) => m.month === month); };
r = await owner('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: JS, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const INV1 = r.result.invoiceNo;
const p0 = await pnlMonth(), rp0 = await rep();
r = await owner('erpReturnGoods', [{ invoiceNo: INV1, lines: [{ sku: JS, qty: 1, condition: 'damaged' }], money: 'advance', reason: 'cracked spool' }]);
check('2a. damaged joint return taken', r.ok, r);
const rl = (await sql`select l.qty, l.unit_cost, l.line_total from invoice_lines l join invoices i on i.id = l.invoice_id
                      where i.business_id = ${A} and i.invoice_no like 'RTN-%' and l.sku = ${JS}`)[0];
check('2a. the seller\'s return line takes the joint line off whole (qty back, its cost back)', rl && num(rl.qty) === -1 && num(rl.line_total) === -2000, rl);
const p1 = await pnlMonth(), rp1 = await rep();
check('2a. the seller\'s own figures: returns +2000 and cost -2000, so no loss of its own', Math.round(p1.returns - p0.returns) === 2000 && Math.round(p1.cost - p0.cost) === -2000, [p0, p1]);
check('2a. the pool carries the loss once: its profit down 2000 (sale undone), goods not back on the shelf',
  Math.round(num(rp1.this_month.profit) - num(rp0.this_month.profit)) === -2000 && await poolStock() === 9, [rp0.this_month, rp1.this_month]);
check('2a. the seller\'s joint share follows the pool\'s profit (one loss, shared)',
  Math.abs((p1.jointShare - p0.jointShare) - Math.round(-2000 * num(P(rp1, A).ratio))) <= 1, [p0.jointShare, p1.jointShare]);

// ---- 2b. received by mistake: undone, not a loss
const rb = await rep(), costOf = async () => num((await sql`select cost_price from products where business_id = ${POOL} and sku = 'PM-PLA-BLK'`)[0].cost_price);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 3, unitCost: 1500, paidBy: A }]);
check('2b. received 3 by mistake (paid by Costareen, average cost moved)', r.ok && await poolStock() === 12 && await costOf() !== 1400, r);
r = await mgr('erpJointAdjust', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 3, direction: 'mistake', reason: 'typed twice', at: A }]);
check('2b. undoing is the owners\'', !r.ok, r);
r = await owner('erpJointAdjust', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 3, direction: 'mistake', reason: '', at: A }]);
check('2b. ...with a reason', !r.ok && /Say what went wrong/.test(r.error), r);
r = await owner('erpJointAdjust', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 3, direction: 'mistake', reason: 'typed twice', at: A }]);
const ra = await rep();
check('2b. undone: stock back to 9, no loss, Costareen no longer counted as having paid', r.ok && await poolStock() === 9 &&
  num(ra.this_month.stock_gain) === num(rb.this_month.stock_gain) && num(ra.this_month.profit) === num(rb.this_month.profit) &&
  num(P(ra, A).purchases) === num(P(rb, A).purchases) && num(ra.to_date.stock_at_cost) === num(rb.to_date.stock_at_cost), [rb.to_date, ra.to_date, P(rb, A), P(ra, A)]);
check('2b. the average cost is back to 1400', await costOf() === 1400, await costOf());
r = await owner('erpJointAdjust', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 50, direction: 'mistake', reason: 'x', at: A }]);
check('2b. more than the shelf holds is refused', !r.ok && /holds only|were received|are in the pool/.test(r.error), r);

// ---- 2c. a bill closed with a write-off: the pool gets its whole part (the seller's own profit carries the write-off)
r = await owner('erpCreateInvoice', [{ customer: { name: 'Courier Buyer', phone: '01733333333' }, items: [{ sku: JS, qty: 1 }], deliveryCharge: 100, payMode: 'none' }]);
const INV2 = r.result.invoiceNo;
const link2 = (await sql`select pool_invoice_no from joint_sales where seller_invoice_no = ${INV2}`)[0];
const poolMoney = async () => num((await sql`select coalesce(sum(amount), 0) as s from payments where business_id = ${POOL} and invoice_no = ${link2.pool_invoice_no} and method = 'Joint'`)[0].s);
r = await owner('erpRecordPayment', [{ orderId: INV2, amount: 2050, method: 'Cash' }]);
check('2c. 2050 of 2100 paid: the pool has its share of the money (2050 x 2000 / 2100)', r.ok && Math.abs(await poolMoney() - 1952.38) < 0.02, await poolMoney());
r = await owner('erpSettleDue', [{ orderId: INV2, reason: 'writeoff', amount: 50, note: 'courier short' }]);
const mir = (await sql`select payment_status, due_amount from invoices where business_id = ${POOL} and invoice_no = ${link2.pool_invoice_no}`)[0];
check('2c. 50 written off: the pool gets its whole 2000 and its copy is Paid (no 45-day debt later)', r.ok && Math.abs(await poolMoney() - 2000) < 0.01 && mir.payment_status === 'Paid' && num(mir.due_amount) === 0, [await poolMoney(), mir]);

// ---- 2d. sponsorship rolls lent to brands: apart from the stock at cost; the money each is owed does not move
const rs0 = await rep();
const pid = (await sql`select id from products where business_id = ${POOL} and sku = 'PM-PLA-BLK'`)[0].id;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, note, txn_no, operator, product_name, held_by)
          values (${POOL}, ${pid}, 'ADJUST', 'OUT', 2, 0, 0, 'creator X', 'Sponsorship rolls taken by test (Costareen)', 'TXN-T7-1', 'test', 'Polymaker PLA Black', ${A})`;
const rs1 = await rep();
check('2d. lent rolls shown apart (2 x 1400) and out of the stock at cost', num(rs1.to_date.lent_to_brands) === 2800 &&
  Math.round(num(rs0.to_date.stock_at_cost) - num(rs1.to_date.stock_at_cost)) === 2800, [rs0.to_date, rs1.to_date]);
check('2d. ...no profit change, no change in who pays whom', num(rs1.this_month.profit) === num(rs0.this_month.profit) &&
  num(P(rs1, A).balance) === num(P(rs0, A).balance), [P(rs0, A), P(rs1, A)]);

// ---- 3. each owner writes their own lines; months close in order; a yes is to the exact sums
r = await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: B3, amount: 5000 }]);
check('3. an owner cannot write the other company\'s capital', !r.ok && /Write only your own company/.test(r.error), r);
const theirLine = (await sql`select id from pool_ledger where pool_id = ${POOL} and partner_business_id = ${B3} limit 1`)[0].id;
r = await owner('erpJointBook', [{ pool: POOL, strike: theirLine, reason: 'not mine to strike' }]);
check('3. ...nor strike out their line', !r.ok && /other company/.test(r.error), r);
r = await other('erpJointBook', [{ pool: POOL, kind: 'transfer', partner: A, to: B3, amount: 100 }]);
check('3. a cash hand-over can be written by the one who got it', r.ok, r);
await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 500, date: prev2 + '-10' }]);
await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 1000, date: prev + '-10' }]);
r = await owner('erpJointAgree', [{ pool: POOL, month: prev }]);
check('3. ' + prev + ' cannot be agreed while ' + prev2 + ' is open', !r.ok && /first: months are closed in order/.test(r.error), r);
await owner('erpJointAgree', [{ pool: POOL, month: prev2 }]);
r = await other('erpJointAgree', [{ pool: POOL, month: prev2 }]);
check('3. ' + prev2 + ' closed by both yeses', r.ok && r.result.book.report.closed === true, r.ok && r.result.book.report);
r = await owner('erpJointAgree', [{ pool: POOL, month: prev }]);
check('3. Costareen agrees to ' + prev, r.ok && r.result.book.report.agreed.includes(A) && !r.result.book.report.closed, r.ok && r.result.book.report.agreed);
r = await other('erpJointBook', [{ pool: POOL, kind: 'expense', partner: B3, amount: 3000, category: 'Rent', note: 'warehouse', date: prev + '-20' }]);
const rp = await rep(prev);
check('3. the partner adds an expense to that month: Costareen\'s yes no longer counts (agreed to other sums)',
  r.ok && !rp.agreed.includes(A) && rp.agreed_stale.includes(A), [rp.agreed, rp.agreed_stale]);
r = await other('erpJointAgree', [{ pool: POOL, month: prev }]);
check('3. ...so the partner\'s yes alone does not close it', r.ok && !r.result.book.report.closed, r.ok && r.result.book.report);
r = await owner('erpJointAgree', [{ pool: POOL, month: prev }]);
check('3. Costareen agrees to the new sums: closed', r.ok && r.result.book.report.closed === true, r.ok && r.result.book.report);
r = await sql.begin(async (t) => { await t`select set_config('erp.system', 'on', true)`; await t`select close_pool_month(${POOL}, ${prev2 + '-01'}::date)`; }).then(() => ({ ok: true })).catch((e) => ({ ok: false, error: e.message }));
check('3. a closed month stays closed', !r.ok && /already closed/.test(r.error), r);

// ---- 4. cost is the owners'; every owner of a partner company is a pool owner
r = await sales('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 1, unitCost: 1300 }]);
check('4. staff receive: no average cost in the reply', r.ok && r.result.received && r.result.received.cost === undefined, r.ok && r.result.received);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 1, unitCost: 1350, paidBy: A }]);
check('4. owner receive: the new average cost', r.ok && r.result.received.cost > 0, r.ok && r.result.received);
await sql`update memberships set powers = ${sql.json({ costs: true })} where business_id = ${A} and user_id = ${FIX.U.mgr}`;
r = await mgr('erpLineMargins', [{ items: [{ sku: JS, qty: 1 }] }]);
check('4. a manager with the costs power sees no % on a joint line (it would give the pool cost away)', r.ok && r.result.lines[0].joint && r.result.lines[0].margin === undefined, r.result);
r = await owner('erpLineMargins', [{ items: [{ sku: JS, qty: 1 }] }]);
check('4. the owner does', r.ok && typeof r.result.lines[0].margin === 'number', r.result);
const O2 = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${O2}, 'second.owner@t.test', ${sql.json({ full_name: 'Second Owner' })})`;
await sql`insert into memberships (business_id, user_id, role) values (${A}, ${O2}, 'owner')`;
const owner2 = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + O2 });
r = await owner2('erpJoint', [{ pool: POOL }]);
check('4. a second owner login of Costareen (not the one that started the pool) sees the money and month end', r.ok && r.result.money === true && !!r.result.book && r.result.pools[0].member === true, r.ok && [r.result.money, r.result.pools]);

// ---- 5. a pool return note carries the seller's mark; a dropped pool copy takes its shelf moves with it
r = await owner('erpCreateInvoice', [{ customer: { name: 'Ret', phone: '01755555555' }, items: [{ sku: JS, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const INV3 = r.result.invoiceNo;
r = await owner('erpReturnGoods', [{ invoiceNo: INV3, lines: [{ sku: JS, qty: 1, condition: 'good' }], money: 'advance', reason: 'changed mind' }]);
const mark = A.replace(/-/g, '').slice(0, 4).toLowerCase();
check('5. the pool\'s return note: RTN-<time>-J + the seller\'s mark', r.ok && (await sql`select count(*)::int as n from invoices where business_id = ${POOL} and invoice_no like ${'RTN-%-J' + mark}`)[0].n >= 1);
const shelfA = num((await sql`select coalesce(sum(case when direction = 'IN' then qty else -qty end), 0) as n from stock_movements where business_id = ${POOL} and held_by = ${B3}`)[0].n);
r = await other('erpCreateInvoice', [{ customer: { name: 'Their Buyer', phone: '01966666666' }, items: [{ sku: JS, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const link4 = (await sql`select pool_invoice_no from joint_sales where seller_business_id = ${B3} and seller_invoice_no = ${r.result.invoiceNo}`)[0];
const moves = await sql`select count(*)::int as n from stock_movements where business_id = ${POOL} and kind = 'MOVE' and note like ${'% [' + link4.pool_invoice_no + ']'}`;
check('5. the partner sold from an empty shelf: the move is tagged with the pool invoice', shelfA === 0 && moves[0].n === 2, [shelfA, moves]);
await J.dropMirror(sql, POOL, link4.pool_invoice_no);
check('5. dropping that pool copy takes the shelf moves too', (await sql`select count(*)::int as n from stock_movements where business_id = ${POOL} and kind = 'MOVE' and note like ${'% [' + link4.pool_invoice_no + ']'}`)[0].n === 0);


// ---- joint-recv-file: "From a file or photo" on the joint Receive page matches the file to the joint products
r = await mgr('erpReceiveMatch', [{ pool: POOL, kind: 'grid', rows: [['Item', 'Qty', 'Price'], ['Polymaker PLA Black 1kg', '5', '9.5']], fileName: 'packing.xlsx' }]);
check('file lines matched to the joint product (manager, no cost)', r.ok && r.result.lines.length === 1 && r.result.lines[0].sku === 'PM-PLA-BLK' && r.result.lines[0].qty === 5 &&
  !/cost/.test(JSON.stringify(r.result.lines[0].candidates)), r.result || r);
r = await mgr('erpReceiveMatch', [{ kind: 'grid', rows: [['Item', 'Qty'], ['Polymaker PLA Black 1kg', '5']], fileName: 'packing.xlsx' }]);
check('...without the pool, the own products as before (no joint code)', r.ok && r.result.lines[0].sku !== 'PM-PLA-BLK', r.result || r);

await done();
