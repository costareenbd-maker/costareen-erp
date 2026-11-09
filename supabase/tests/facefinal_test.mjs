// crit5-face (10 Nov 2026): a shareholder is the owner's equal (owner rule 27 Oct 2026) - the Joint stock page gives a
// shareholder the book and the money of the pool, as it gives the owner; a manager and sales staff still see stock only.
import { sql, FIX, owner, mgr, sales, check, done, deps, makeShareholder, shareholder } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partnerface@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B;
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;
let r = await owner('erpJointStart', [{ action: 'create', name: 'Face JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Shop', tier: 'wholesale' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black', brand: 'Polymaker', retail: 2000, cost: 1400 }]);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 4, unitCost: 1400, paidBy: A }]);
check('set-up: 4 in the pool', r.ok, r);

r = await owner('erpJoint', [{ pool: POOL }]);
check('owner: the book and the money', r.ok && r.result.money === true && !!r.result.book && r.result.owner === true, r.ok ? { money: r.result.money, owner: r.result.owner } : r);

await makeShareholder();
r = await shareholder('erpJoint', [{ pool: POOL }]);
check('shareholder: the book and the money too (the owner\'s equal)', r.ok && r.result.money === true && !!r.result.book && r.result.owner === true,
  r.ok ? { money: r.result.money, owner: r.result.owner, pools: r.result.pools } : r);
check('...with the cost on the stock rows', r.ok && (r.result.stock || []).some((x) => 'cost' in x), r.ok ? r.result.stock : r);

r = await mgr('erpJoint', [{ pool: POOL }]);
check('manager: stock only, no book, no money', r.ok && r.result.money === false && r.result.book === undefined && r.result.owner === false, r.ok ? { money: r.result.money, owner: r.result.owner } : r);
check('...and no cost on the stock rows', r.ok && (r.result.stock || []).every((x) => !('cost' in x)), r.ok ? r.result.stock : r);
r = await sales('erpJoint', [{ pool: POOL }]);
check('sales: stock only, no book, no money', r.ok && !r.result.money && !r.result.book && (r.result.stock || []).every((x) => !('cost' in x)), r.ok ? r.result.money : r);

// the receive answer: the pool's cost before and after is for owners and shareholders, never staff
r = await shareholder('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 1, unitCost: 1500, paidBy: A }]);
check('shareholder may receive into the pool and keeps the book', r.ok && r.result.money === true, r.ok ? { money: r.result.money } : r);

await done();
