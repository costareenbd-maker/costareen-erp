// Joint stock, step 1: the switch, setting a pool up from inside the company, joint products, receiving.
import { sql, FIX, owner, mgr, sales, check, done, deps } from './harness.mjs';
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

// ---- off by default
let r = await owner('erpHello', []);
check('hello: joint off by default', r.ok && r.result.joint === false, r);
r = await owner('erpJoint', [{}]);
check('page: off', r.ok && r.result.on === false, r);
r = await sales('erpJointCatalog', []);
check('catalog: off, nothing', r.ok && r.result.on === false && r.result.products.length === 0, r);
r = await owner('erpJointStart', [{ action: 'create', name: 'Joint A' }]);
check('cannot start a pool while off', !r.ok && /not switched on/.test(r.error), r);
r = await owner('erpPoolCreate', [{ name: 'Joint A' }]);
check('...nor through the old call', !r.ok && /not switched on/.test(r.error), r);

// ---- the provider's switch
r = await owner('erpPlatformJoint', [{ businessId: A, on: true }]);
check('only a platform admin switches it', !r.ok, r);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
r = await owner('erpPlatformJoint', [{ businessId: A, on: true }]);
check('switched on for the company', r.ok && r.result.businesses.find((b) => b.id === A).joint === true && r.result.businesses.find((b) => b.id === B3).joint === false, r);
r = await owner('erpHello', []);
check('hello: joint on', r.ok && r.result.joint === true, r);
r = await other('erpHello', []);
check('...the other company still off', r.ok && r.result.joint === false, r);

// ---- set-up from inside the company
r = await mgr('erpJointStart', [{ action: 'create', name: 'Joint A' }]);
check('a manager cannot start a pool', !r.ok, r);
r = await owner('erpJointStart', [{ action: 'create', name: 'Filament JV', displayName: 'Costareen', tier: 'wholesale' }]);
check('pool created', r.ok && /^[0-9A-F]{10}$/.test(r.result.created.code), r);
const POOL = r.result.created.id, CODE = r.result.created.code;
r = await other('erpJointStart', [{ action: 'join', code: CODE }]);
check('partner cannot join while it is off for them', !r.ok && /not switched on/.test(r.error), r);
r = await owner('erpPlatformJoint', [{ businessId: B3, on: true }]);
r = await other('erpJointStart', [{ action: 'join', code: CODE, displayName: 'Partner Shop', tier: 'retail' }]);
check('partner joins', r.ok && r.result.joined.id === POOL, r);
r = await owner('erpPlatformJoint', [{ businessId: A, on: false }]);
check('cannot switch off a company that is in a pool', !r.ok && /partner in a joint pool/.test(r.error), r);
r = await owner('erpPlatformJoint', [{ businessId: POOL, on: true }]);
check('a pool itself is not switched', !r.ok, r);

// ---- the page
r = await owner('erpJoint', [{}]);
check('owner page: the pool, both partners, the book', r.ok && r.result.pools.length === 1 && r.result.pools[0].partners.length === 2 && r.result.money === true &&
  r.result.book && r.result.book.isPool === true && r.result.slowDays === 45 && r.result.stock.length === 0, r.result);
r = await mgr('erpJoint', [{}]);
check('manager page: stock only, no book', r.ok && r.result.money === false && r.result.book === undefined, r.result);
r = await sales('erpJoint', [{}]);
check('sales staff have no page', !r.ok, r);

// ---- products
r = await mgr('erpJointProduct', [{ pool: POOL, isNew: true, name: 'X', retail: 10 }]);
check('manager cannot add a joint product', !r.ok, r);
r = await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black', category: 'Filament', brand: 'Polymaker', retail: 2000, wholesale: 1800, floor: 1900, cost: 1400 }]);
check('floor above the lowest price refused', !r.ok && /floor price/.test(r.error), r);
r = await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black', category: 'Filament', brand: 'Polymaker', retail: 2000, wholesale: 1800, floor: 1700, cost: 1400 }]);
check('joint product added', r.ok && r.result.created && r.result.stock.length === 1 && r.result.stock[0].floor === 1700 && r.result.stock[0].cost === 1400 && r.result.stock[0].price === 1800, r);
r = await owner('erpJointProduct', [{ pool: FIX.B2, isNew: true, name: 'X', retail: 10 }]);
check('not into a business that is not my pool', !r.ok, r);
r = await owner('erpJointProduct', [{ pool: POOL, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black 1kg', category: 'Filament', brand: 'Polymaker', retail: 2100, wholesale: 1800, floor: 1750 }]);
check('joint product changed, cost kept', r.ok && !r.result.created && r.result.stock[0].name === 'Polymaker PLA Black 1kg' && r.result.stock[0].retail === 2100 && r.result.stock[0].cost === 1400 && r.result.stock[0].floor === 1750, r);

// ---- receiving: who paid
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 10, unitCost: 1400, paidBy: FIX.B2 }]);
check('the payer must be a partner', !r.ok, r);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 10, unitCost: 0 }]);
check('receive needs the buying price', !r.ok, r);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 10, unitCost: 1400, paidBy: A }]);
check('received, paid by Costareen', r.ok && r.result.stock[0].stock === 10 && r.result.stock[0].cost === 1400, r);
r = await other('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 10, unitCost: 1600, paidBy: B3 }]);
check('the partner receives too; cost is the average', r.ok && r.result.stock[0].stock === 20 && r.result.stock[0].cost === 1500, r);
const mv = await sql`select paid_by, total from stock_movements where business_id = ${POOL} and kind = 'RECEIVE' order by created_at`;
check('each receipt remembers who paid', mv.length === 2 && mv[0].paid_by === A && Number(mv[0].total) === 14000 && mv[1].paid_by === B3 && Number(mv[1].total) === 16000, mv);
r = await owner('erpJoint', [{ pool: POOL }]);
const P = r.result.book.report.partners;
check('the settlement credits each purchase to its payer', P.find((x) => x.business_id === A).purchases === 14000 && P.find((x) => x.business_id === B3).purchases === 16000, P);

// ---- correction, valued at cost
r = await owner('erpJointAdjust', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 2, direction: 'out', reason: '' }]);
check('a correction needs a reason', !r.ok, r);
r = await owner('erpJointAdjust', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 2, direction: 'out', reason: 'two rolls water damaged' }]);
check('2 written off', r.ok && r.result.stock[0].stock === 18, r);
check('...the loss (3000) is the pool\'s', r.ok && r.result.book.report.this_month.stock_gain === -3000 && r.result.book.report.to_date.stock_at_cost === 27000, r.ok && r.result.book.report);

// ---- money book and settings through the page
r = await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 14000 }]);
r = await other('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: B3, amount: 16000 }]);
check('capital written by each side', r.ok && r.result.book.report.to_date.capital === 30000, r.result && r.result.book && r.result.book.report);
r = await owner('erpJointSettings', [{ pool: POOL, slowDays: 3 }]);
check('slow days: sensible range only', !r.ok, r);
r = await owner('erpJointSettings', [{ pool: POOL, slowDays: 30, tier: { partner: B3, tier: 'wholesale' }, invite: true }]);
check('settings saved', r.ok && r.result.slowDays === 30 && r.result.pools[0].partners.find((p) => p.id === B3).tier === 'wholesale' && r.result.book.invites.length === 1, r.result);

// ---- what staff see for the invoice: price, floor, count - never cost
r = await sales('erpJointCatalog', []);
const jp = r.ok && r.result.products[0];
check('sales staff see the joint product for New invoice', r.ok && r.result.products.length === 1 && jp.name === 'Polymaker PLA Black 1kg' && jp.sell === 1800 && jp.floor === 1750 && jp.stock === 18 && /~J[0-9a-f]{4}$/.test(jp.sku) && jp.code === 'PM-PLA-BLK', r);
check('...and no cost anywhere', JSON.stringify(r).indexOf('1500') < 0 && !('cost' in jp), r);
r = await mgr('erpJoint', [{ pool: POOL }]);
check('manager: stock list without cost', r.ok && r.result.stock.length === 1 && !('cost' in r.result.stock[0]), r.result);

// ---- the partner's company made from here
r = await owner('erpJointStart', [{ action: 'company', business: 'Friend Filaments', ownerName: 'Friend', email: 'friend@t.test' }]);
check('partner company created with its own link, joint switched on (provider)', r.ok && r.result.company.link && r.result.company.link.key && r.result.company.switched === true, r);
const fr = await sql`select b.id, (select enabled from joint_flags f where f.business_id = b.id) as on from businesses b where name = 'Friend Filaments'`;
check('...the flag is there', fr.length === 1 && fr[0].on === true, fr);
const mem = fr.length ? await sql`select count(*)::int as n from memberships where business_id = ${fr[0].id} and user_id = ${FIX.U.owner}` : [{ n: -1 }];
check('...and I am not a member of their company', mem[0].n === 0, mem);
await done();
