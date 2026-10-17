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

// 1. staff see the page and receive a shipment, as their own company
r = await sales('erpJoint', [{ pool: POOL }]);
check('sales staff open Joint stock (no money part, no cost)', r.ok && !r.result.money && r.result.stock.length === 1 && !('cost' in r.result.stock[0]) && r.result.me === A, r.error || r.result.money);
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
check('another business sees none of it', (await sql`select count(*)::int n from pool_requests where pool_id <> ${POOL}`)[0].n === 0);
function num(v) { const n = Number(v); return isFinite(n) ? n : 0; }
await done();
