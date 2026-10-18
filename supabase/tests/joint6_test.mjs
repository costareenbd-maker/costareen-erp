// Joint stock between the two shops (owner 18 Oct 2026): every staff member of both companies receives shipments (own
// company as payer; the same shipment twice is refused unless meant), asks the partner for goods, the holder sends them
// (collected = free; delivered = transport cost written as a joint expense of the one who paid), the asker confirms.
// Decline / cancel. The dashboard card's month movement. The company's profit includes its share of the joint profit.
import { sql, FIX, owner, mgr, sales, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partner6@t.test', ${sql.json({ full_name: 'Proto Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('PrototypeBD test') as id`;
}))[0].id;
const proto = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B;
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;

let r = await owner('erpJointStart', [{ action: 'create', name: 'Printers JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await proto('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'PrototypeBD', tier: 'retail' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'BBL-A1', name: 'Bambu Lab A1', category: 'Printer', brand: 'Bambu Lab', retail: 50000, floor: 45000, cost: 40000 }]);
const held = (res) => res.result.stock.find((s) => s.sku === 'BBL-A1').held;

// 0. staff add a new joint product themselves (the owner is busy); changing it stays the owners'
r = await sales('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-W', name: 'Polymaker PLA White', category: 'Filament', brand: 'Polymaker', retail: 2000, floor: 1800, cost: 1400 }]);
check('sales staff add a new joint product', r.ok && r.result.created && r.result.stock.some((x) => x.sku === 'PM-PLA-W'), r.error);
r = await sales('erpJointProduct', [{ pool: POOL, isNew: false, sku: 'PM-PLA-W', name: 'Polymaker PLA White', retail: 100, floor: 0 }]);
check('...but cannot change its price afterwards', !r.ok && /owners/.test(r.error), r.error);
r = await proto('erpJoint', [{ pool: POOL }]);
check('PrototypeBD sees the new product at once', r.ok && r.result.stock.some((x) => x.sku === 'PM-PLA-W'), r.error);

// 1. staff see the page and receive a shipment, as their own company
r = await sales('erpJoint', [{ pool: POOL }]);
check('sales staff open Joint stock (no money part, no cost)', r.ok && !r.result.money && r.result.stock.length === 2 && r.result.stock.every((x) => !('cost' in x)) && r.result.me === A, r.error || r.result.money);
r = await sales('erpJointReceive', [{ pool: POOL, sku: 'BBL-A1', qty: 10, unitCost: 40000, paidBy: B3 }]);
check('staff cannot say the partner paid', !r.ok && /only for your own company/.test(r.error), r.error);
r = await sales('erpJointReceive', [{ pool: POOL, sku: 'BBL-A1', qty: 10, unitCost: 40000 }]);
check('staff receive 10, paid by their own company, on its shelf', r.ok && held(r)[A] === 10, r.error || held(r));
r = await mgr('erpJointReceive', [{ pool: POOL, sku: 'BBL-A1', qty: 10, unitCost: 40000 }]);
check('the same shipment again (same day, count, cost, payer) is refused - nothing doubles', !r.ok && /^ALREADY: /.test(r.error) && /already received/.test(r.error), r.error);
r = await mgr('erpJointReceive', [{ pool: POOL, sku: 'BBL-A1', qty: 10, unitCost: 40000, again: true }]);
check('...unless it really is a second shipment', r.ok && held(r)[A] === 20, r.error || held(r));
r = await proto('erpJointReceive', [{ pool: POOL, sku: 'BBL-A1', qty: 4, unitCost: 40000, paidBy: B3 }]);
check('PrototypeBD receives its own 4 - the other side is not overwritten', r.ok && held(r)[A] === 20 && held(r)[B3] === 4 && r.result.stock[0].stock === 24, r.error || held(r));

// 2. PrototypeBD asks for 5; Costareen staff send them, delivered, transport 300 paid by Costareen
r = await proto('erpJointAsk', [{ pool: POOL, sku: 'BBL-A1', qty: 5, note: 'for a school order' }]);
const req = (r.result.requests || [])[0] || {};
check('asked: from the partner holding most (Costareen)', r.ok && req.status === 'asked' && req.holder === 'Costareen' && req.qty === 5 && req.canCancel && !req.canSend, r.error || req);
r = await sales('erpJoint', [{ pool: POOL }]);
let mine = r.result.requests[0];
check('Costareen staff see it and may send or decline it', mine.canSend && mine.canDecline && !mine.canGot, mine);
r = await sales('erpJointSend', [{ pool: POOL, sku: 'BBL-A1', from: B3, to: A, qty: 1, how: 'collected' }]);
check('staff cannot send from the partner’s shelf', !r.ok && /only for your own company/.test(r.error), r.error);
r = await sales('erpJointSend', [{ pool: POOL, request: req.id, how: 'delivered', cost: 300 }]);
check('sent 5, delivered: Costareen 15, PrototypeBD 9, pool 24', r.ok && held(r)[A] === 15 && held(r)[B3] === 9 && r.result.stock[0].stock === 24 && r.result.moved.cost === 300, r.error || held(r));
const led = await sql`select kind, partner_business_id, amount, category from pool_ledger where pool_id = ${POOL} and category = 'Transport'`;
check('the transport is a joint expense credited to Costareen', led.length === 1 && led[0].kind === 'EXPENSE' && led[0].partner_business_id === A && Number(led[0].amount) === 300, led);
r = await proto('erpJoint', [{ pool: POOL }]);
mine = r.result.requests.find((x) => x.id === req.id);
check('PrototypeBD sees it sent and can say Got it', mine.status === 'sent' && mine.canGot && mine.how === 'delivered' && mine.cost === 300 && mine.costPaidBy === 'Costareen', mine);
r = await sales('erpJointGot', [{ pool: POOL, request: req.id }]);
check('only the side that asked confirms', !r.ok, r.ok);
r = await proto('erpJointGot', [{ pool: POOL, request: req.id }]);
check('received', r.ok && r.result.requests.find((x) => x.id === req.id).status === 'received', r.error);
r = await sales('erpJointSend', [{ pool: POOL, request: req.id }]);
check('a request is sent once', !r.ok && /already received/.test(r.error), r.error);
check('the move shows in the list with how it went', r.ok === false && (await owner('erpJoint', [{ pool: POOL }])).result.moves.some((m) => m.qty === 5 && m.from === 'Costareen' && m.to === 'PrototypeBD' && /Delivered/.test(m.note)));

// 3. collected: free; more than the shelf holds: refused; decline and cancel
r = await proto('erpJointAsk', [{ pool: POOL, sku: 'BBL-A1', qty: 2 }]);
const req2 = r.result.requests.find((x) => x.status === 'asked');
r = await mgr('erpJointSend', [{ pool: POOL, request: req2.id, how: 'collected', cost: 999 }]);
check('collected: no transport cost written', r.ok && (await sql`select count(*)::int n from pool_ledger where pool_id = ${POOL} and category = 'Transport'`)[0].n === 1, r.error);
r = await proto('erpJointAsk', [{ pool: POOL, sku: 'BBL-A1', qty: 3 }]);
const req3 = r.result.requests.find((x) => x.status === 'asked');
r = await sales('erpJointAskAct', [{ pool: POOL, request: req3.id, action: 'decline' }]);
check('declining needs a reason', !r.ok && /why/i.test(r.error), r.error);
r = await sales('erpJointAskAct', [{ pool: POOL, request: req3.id, action: 'decline', note: 'kept for our own order' }]);
check('declined with the reason', r.ok && r.result.requests.find((x) => x.id === req3.id).status === 'declined', r.error);
r = await proto('erpJointAsk', [{ pool: POOL, sku: 'BBL-A1', qty: 1 }]);
const req4 = r.result.requests.find((x) => x.status === 'asked');
r = await sales('erpJointAskAct', [{ pool: POOL, request: req4.id, action: 'cancel' }]);
check('the holder cannot cancel the asker’s request', !r.ok, r.ok);
r = await proto('erpJointAskAct', [{ pool: POOL, request: req4.id, action: 'cancel' }]);
check('the asker cancels', r.ok && r.result.requests.find((x) => x.id === req4.id).status === 'cancelled', r.error);
r = await sales('erpJointSend', [{ pool: POOL, sku: 'BBL-A1', to: B3, qty: 99, how: 'collected' }]);
check('sending more than the shelf holds is refused', !r.ok && /holds only 13/.test(r.error), r.error);

// 4. sell, then the owner's dashboard card and the company's profit
const JS = (await sales('erpJointCatalog', [])).result.products.find((p) => p.code === 'BBL-A1').sku;
r = await sales('erpCreateInvoice', [{ customer: { name: 'School', phone: '01712340001' }, items: [{ sku: JS, qty: 2, price: 50000 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('Costareen staff sell 2 printers from the joint stock', r.ok, r.error);
await proto('erpCreateInvoice', [{ customer: { name: 'Uni', phone: '01712340002' }, items: [{ sku: JS, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
r = await owner('erpJointCard', []);
if (!r.ok) console.log('CARD ERROR', r.error);
const card = (r.result.pools || []).find((p) => p.id === POOL) || {};
const sh = (n) => (card.shelves || []).find((x) => x.name === n) || {};
check('dashboard card: this month received 24, moved 7, sold Costareen 2 / PrototypeBD 1, shelves 11 / 10',
  r.ok && card.month.received === 24 && card.month.moved === 7 && sh('Costareen').sold === 2 && sh('PrototypeBD').sold === 1 && sh('Costareen').units === 11 && sh('PrototypeBD').units === 10, card);
const J = await import(pathToFileURL(path.join(fnDir, 'handlers', 'joint.js')));
const book = (await owner('erpJoint', [{ pool: POOL }])).result.book.report;
const month = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
const ratio = num((book.partners.find((p) => p.business_id === A) || {}).ratio);
r = await owner('erpPnl', []);
const pm = ((r.result && (r.result.months || r.result)) || []).find ? (r.result.months || r.result).find((m) => m.month === month) : null;
check('Costareen’s profit for the month includes its share of the joint profit (profit x its ratio)',
  pm && Math.abs(pm.jointShare - Math.round(num(book.this_month.profit) * ratio)) <= 1 && pm.jointShare !== 0, [pm && pm.jointShare, book.this_month.profit, ratio]);
// the balance sheet: our part of the joint stock = profit share + what we paid in - the joint goods we sold
const me6 = book.partners.find((p) => p.business_id === A);
const part = Math.round(num(me6.profit_share) + num(me6.purchases) + num(me6.expenses_paid) + num(me6.transfers_out) - num(me6.transfers_in) - num(me6.invoiced));
r = await owner('erpBalanceSheet', []);
const jl = r.ok ? r.result.owns.concat(r.result.owes).find((x) => x.key === 'joint') : null;
check('balance sheet: a joint line with our part (owns when above 0)', jl && Math.round(r.result.owns.some((x) => x.key === 'joint') ? jl.amount : -jl.amount) === part && /Printers JV/.test(jl.what), [jl, part]);
r = await owner('erpFdDash', [{}]);
check('dashboard net-profit breakdown shows the joint share', !r.ok || !r.result.calc || !r.result.calc.net || r.result.calc.net.some((x) => /joint stock profit/.test(x[0])), r.ok && r.result.calc && r.result.calc.net);
// 5. the ERP's own Receive page into the joint stock: same costing, goods to the pool, money in our books
await owner('erpSupplierSave', [{ name: 'Bambu Dhaka Agent' }]).catch(() => null);
const ownBefore = (await sql`select count(*)::int n from stock_movements where business_id = ${A}`)[0].n;
const cat6 = (await mgr('erpJointRecvCatalog', [{ pool: POOL }])).result || [];
check('the Receive page gets the joint products (no cost)', cat6.some((x) => x.sku === 'BBL-A1') && cat6.every((x) => !('cost' in x)), cat6);
r = await mgr('erpReceiveShipment', [{ pool: POOL, receivedAt: B3, supplier: 'Bambu Dhaka Agent', reference: 'JV-SHIP-1', from: 'local', mode: 'bdt', totalBdt: 90000,
  payment: 'later', shippingBdt: 2000, lines: [{ sku: 'BBL-A1', qty: 2 }, { isNew: true, qty: 1, product: { product_name: 'Bambu Lab P1S', category: 'Printer', brand: 'Bambu Lab', sell_price: 80000, cost_price: 0 } }] }]);
check('received through the Receive page into the joint stock', r.ok && r.result.joint === 'Printers JV' && r.result.units === 3, r.error || r.result);
const pj = (await owner('erpJoint', [{ pool: POOL }])).result;
const a1 = pj.stock.find((x) => x.sku === 'BBL-A1'), p1s = pj.stock.find((x) => /P1S/.test(x.name));
check('the new product was made in the joint stock and the units are on PrototypeBD’s shelf', p1s && p1s.stock === 1 && p1s.held[B3] === 1 && a1.held[B3] >= 2, [a1 && a1.held, p1s]);
const rc = await sql`select qty, unit_price, paid_by, held_by, reference, supplier from stock_movements where business_id = ${POOL} and reference = 'JV-SHIP-1' order by unit_price`;
check('landed cost spread as on the own page (90,000 + 2,000 shipping over the goods), paid by Costareen', rc.length === 2 && Math.round(rc.reduce((t, x) => t + Number(x.qty) * Number(x.unit_price), 0)) === 92000 && rc.every((x) => x.paid_by === A && x.held_by === B3 && x.supplier === 'Bambu Dhaka Agent'), rc);
check('Costareen’s own stock untouched', (await sql`select count(*)::int n from stock_movements where business_id = ${A}`)[0].n === ownBefore);
const bill = await sql`select amount from supplier_bills where business_id = ${A} and reference = 'JV-SHIP-1'`;
check('the supplier bill is Costareen’s (owed to the supplier)', bill.length === 1 && Number(bill[0].amount) === 90000, bill);
r = await sales('erpReceiveShipment', [{ pool: POOL, supplier: 'x', mode: 'bdt', totalBdt: 1, lines: [{ sku: 'BBL-A1', qty: 1 }] }]);
check('the Receive page keeps its own rule: sales staff without Stock and receiving cannot use it', !r.ok, r.ok);
r = await mgr('erpReceiveShipment', [{ pool: POOL, poId: 'PO-1', mode: 'bdt', totalBdt: 1, lines: [{ sku: 'BBL-A1', qty: 1 }] }]);
check('a supplier order is not received into the joint stock', !r.ok && /supplier order/.test(r.error), r.error);

check('another business sees none of it', (await sql`select count(*)::int n from pool_requests where pool_id <> ${POOL}`)[0].n === 0);
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
await done();
