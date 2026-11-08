// joint-multi-1 (owner 8 Nov 2026): Ask for stock and Send stock take many products at once (lines). One send is one
// parcel: every line moves or none does, one transport cost for the whole parcel. A many-product ask is answered with
// one send of all its requests. The old single-product calls keep working (joint6_test).
import { sql, FIX, owner, mgr, sales, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partnerm@t.test', ${sql.json({ full_name: 'Proto Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner multi test') as id`;
}))[0].id;
const proto = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B;
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;

let r = await owner('erpJointStart', [{ action: 'create', name: 'Multi JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await proto('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner', tier: 'retail' }]);
for (const [sku, name] of [['P1', 'PLA Red'], ['P2', 'PLA Blue'], ['P3', 'PETG Black']])
  await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku, name, category: 'Filament', retail: 2000, floor: 1500, cost: 1000 }]);
await sales('erpJointReceive', [{ pool: POOL, sku: 'P1', qty: 10, unitCost: 1000 }]);
await sales('erpJointReceive', [{ pool: POOL, sku: 'P2', qty: 10, unitCost: 1000 }]);
await sales('erpJointReceive', [{ pool: POOL, sku: 'P3', qty: 2, unitCost: 1000 }]);
const held = (res, sku) => (res.result.stock.find((s) => s.sku === sku) || {}).held || {};

// 1. send three products in one parcel, delivered, one transport cost
r = await sales('erpJointSend', [{ pool: POOL, to: B3, how: 'delivered', cost: 250, lines: [{ sku: 'P1', qty: 3 }, { sku: 'P2', qty: 4 }, { sku: 'P3', qty: 1 }] }]);
check('three products sent in one go', r.ok && held(r, 'P1')[B3] === 3 && held(r, 'P2')[B3] === 4 && held(r, 'P3')[B3] === 1 && held(r, 'P1')[A] === 7 && r.result.moved.lines.length === 3 && r.result.moved.qty === 8, r.error || r.result.moved);
let led = await sql`select amount, note from pool_ledger where pool_id = ${POOL} and category = 'Transport'`;
check('one transport expense for the whole parcel, naming the products', led.length === 1 && Number(led[0].amount) === 250 && /3 products/.test(led[0].note) && /PETG Black/.test(led[0].note), led);
r = await owner('erpJoint', [{ pool: POOL }]);
check('each product shows in Sent between the shops', ['PLA Red', 'PLA Blue', 'PETG Black'].every((n) => r.result.moves.some((m) => m.name === n && m.from === 'Costareen' && m.to === 'Partner')), r.result.moves);
const tx = await sql`select txn_no from stock_movements where business_id = ${POOL} and kind = 'MOVE'`;
check('every line has its own move number (out and in pair up)', new Set(tx.map((x) => x.txn_no)).size === tx.length && tx.length === 6, tx);

// 2. all or nothing: one line too many -> nothing moves
const before = (await sql`select count(*)::int n from stock_movements where business_id = ${POOL}`)[0].n;
r = await sales('erpJointSend', [{ pool: POOL, to: B3, lines: [{ sku: 'P1', qty: 1 }, { sku: 'P3', qty: 5 }] }]);
check('one line short refuses the whole parcel', !r.ok && /holds only 1 of PETG Black/.test(r.error), r.error);
check('...and nothing moved', (await sql`select count(*)::int n from stock_movements where business_id = ${POOL}`)[0].n === before);
r = await sales('erpJointSend', [{ pool: POOL, to: B3, lines: [{ sku: 'P3', qty: 1 }, { sku: 'P3', qty: 1 }] }]);
check('the same product twice adds up against the shelf', !r.ok && /holds only 0 of PETG Black/.test(r.error), r.error);
r = await sales('erpJointSend', [{ pool: POOL, to: B3, lines: [{ sku: 'P1', qty: 2 }, { sku: 'P2', qty: 0 }] }]);
check('a line without a count is refused', !r.ok && /of each product/.test(r.error), r.error);
r = await sales('erpJointSend', [{ pool: POOL, to: B3, lines: [{ sku: '', qty: '' }] }]);
check('an empty list is refused', !r.ok && /at least one/.test(r.error), r.error);

// 3. the partner asks for two products in one go; Costareen sends both requests in one parcel
r = await proto('erpJointAsk', [{ pool: POOL, note: 'school order', lines: [{ sku: 'P1', qty: 2 }, { sku: 'P2', qty: 3 }] }]);
const asked = (r.result.requests || []).filter((x) => x.status === 'asked');
check('one ask, two requests, both from Costareen', r.ok && r.result.asked === 2 && asked.length === 2 && asked.every((x) => x.holder === 'Costareen' && x.note === 'school order'), r.error || asked);
r = await proto('erpJointAsk', [{ pool: POOL, lines: [{ sku: 'P1', qty: 2 }, { sku: 'P2', qty: -1 }] }]);
check('a bad count on any line asks for nothing', !r.ok && (await sql`select count(*)::int n from pool_requests where pool_id = ${POOL}`)[0].n === 2, r.error);
r = await sales('erpJointSend', [{ pool: POOL, how: 'delivered', cost: 120, lines: asked.map((x) => ({ request: x.id, qty: x.qty })) }]);
check('both requests sent in one parcel', r.ok && held(r, 'P1')[B3] === 5 && held(r, 'P2')[B3] === 7, r.error);
const rq = r.result.requests.filter((x) => asked.some((a) => a.id === x.id));
check('both marked sent; the transport is shown once', rq.every((x) => x.status === 'sent') && rq.reduce((t, x) => t + x.cost, 0) === 120, rq);
led = await sql`select amount from pool_ledger where pool_id = ${POOL} and category = 'Transport' order by created_at`;
check('...and written once in the joint book', led.length === 2 && Number(led[1].amount) === 120, led);
r = await sales('erpJointSend', [{ pool: POOL, lines: [{ request: asked[0].id }] }]);
check('a request already sent is refused', !r.ok && /already sent/.test(r.error), r.error);

// 4. requests of the other side cannot be mixed into a parcel the wrong way
r = await owner('erpJointAsk', [{ pool: POOL, lines: [{ sku: 'P1', qty: 1 }] }]);
const own = r.result.requests.find((x) => x.status === 'asked');
r = await sales('erpJointSend', [{ pool: POOL, lines: [{ request: own.id }] }]);
check('Costareen cannot send the request it asked itself (the partner holds it)', !r.ok && /only for your own company/.test(r.error), r.error);
r = await proto('erpJointSend', [{ pool: POOL, lines: [{ request: own.id }, { sku: 'P2', qty: 1 }] }]);
check('the partner sends it plus one more product', r.ok && held(r, 'P1')[A] === 6 && held(r, 'P2')[A] === 4, r.error);

await done();
