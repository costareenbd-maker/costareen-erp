// FilaDash merge P3: holding cost (handlers/holding.js; decision F3 - on by default).
// Run: TEST_SCRIPT=holding_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const near = (a, b, e = 1.01) => Math.abs(Number(a) - Number(b)) <= e;
const month = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);

// ---- the setting: on by default, Rent
let r = await owner('erpHolding', [{}]);
check('on by default, for Rent', r.ok && r.result.on === true && r.result.categories.join() === 'Rent', r.result);
r = await mgr('erpHoldingSave', [{ categories: ['Warehouse'] }]);
check('only the owner changes it', !r.ok, r);
r = await owner('erpHoldingSave', [{ on: true, categories: [] }]);
check('on needs a category', !r.ok, r);
r = await owner('erpHoldingSave', [{ on: true, categories: ['Warehouse'] }]);
check('holding cost = the Warehouse expenses', r.ok && r.result.categories.join() === 'Warehouse', r);

// ---- two shipments, 10 kg and 20 kg, on the shelf since the 1st
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, weight_g) values
  (${B}, 'HC-A', 'Holding A', 'Filaments', 'T', 'PLA', 0, 300, 'Active', 1000),
  (${B}, 'HC-B', 'Holding B', 'Filaments', 'T', 'PLA', 0, 300, 'Active', 2000)`;
r = await mgr('erpReceiveShipment', [{ reference: 'HC-SHIP-A', mode: 'bdt', totalBdt: 1000, lines: [{ sku: 'HC-A', qty: 10 }] }]);
check('A in', r.ok, r);
r = await mgr('erpReceiveShipment', [{ reference: 'HC-SHIP-B', mode: 'bdt', totalBdt: 2000, lines: [{ sku: 'HC-B', qty: 10 }] }]);
check('B in', r.ok, r);
const start = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 1, 1) - 6 * 3600e3);
await sql`update stock_lots set received_at = ${start} where business_id = ${B} and reference in ('HC-SHIP-A', 'HC-SHIP-B')`;
r = await owner('erpExpenseAdd', [{ amount: 3000, description: 'Warehouse rent', category: 'Warehouse', month }]);
check('3000 warehouse rent this month', r.ok, r);

r = await owner('erpHolding', [{}]);
const m = r.result.months.find((x) => x.month === month);
check('this month\'s pool is 3000', m && m.pool === 3000, r.result.months);
const sh = await mgr('erpShipments', [{}]);
const A = sh.result.shipments.find((s) => s.reference === 'HC-SHIP-A'), Bs = sh.result.shipments.find((s) => s.reference === 'HC-SHIP-B');
check('B (20 kg) carries twice what A (10 kg) carries', A.holding > 0 && near(Bs.holding, 2 * A.holding, 2), [A.holding, Bs.holding]);
const all = sh.result.shipments.reduce((t, s) => t + s.holding, 0);
check('every taka of the pool is shared out over the lots', near(all, 3000, sh.result.shipments.length), all);
check('a shipment\'s profit after holding', A.net === A.profit - A.holding, A);
const one = await mgr('erpShipment', [{ reference: 'HC-SHIP-A' }]);
check('line by line too', one.ok && one.result.lines[0].holding === A.holding && one.result.lines[0].net === one.result.lines[0].profit - A.holding, one.result.lines);

// ---- selling half of A: from then on it carries half
const before = A.holding;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'HC-A', qty: 5 }], payMode: 'full' }]);
check('5 of A sold', r.ok, r);
const a2 = (await mgr('erpShipments', [{}])).result.shipments.find((s) => s.reference === 'HC-SHIP-A');
check('A\'s holding grows no faster than before (5 left)', a2.holding <= before * 1.01 + 2, [before, a2.holding]);

// ---- the month's net profit is not changed by sharing it out
const pnl = (await owner('erpPnl', [{ months: 1 }])).result.months.find((x) => x.month === month);
await owner('erpHoldingSave', [{ on: false, categories: ['Warehouse'] }]);
const pnlOff = (await owner('erpPnl', [{ months: 1 }])).result.months.find((x) => x.month === month);
check('net profit is the same with holding on or off (rent is an expense either way)', pnl.net === pnlOff.net, [pnl.net, pnlOff.net]);
const off = (await mgr('erpShipments', [{}])).result.shipments.find((s) => s.reference === 'HC-SHIP-A');
check('off: nothing shared out', off.holding === 0, off);

// ---- an investor in a shipment earns on the profit after holding
await owner('erpHoldingSave', [{ on: true, categories: ['Warehouse'] }]);
await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Holder Inv', returnKind: 'lot', returnValue: 100, invested: 5000 }]);   // fix-3 Q1: a funding is money put in
const H = (await sql`select holder_no from capital_holders where business_id = ${B} and name = 'Holder Inv'`)[0].holder_no;
r = await owner('erpLotFund', [{ holder: H, reference: 'HC-SHIP-B', pct: 50 }]);
check('half of B funded', r.ok, r);
const f = r.result.funding[0];
check('nothing of B sold: their part carries half of B\'s holding, so they are behind', f.holding > 0 && f.earned === -f.holding, f);
const cap = (await owner('erpCapital', [])).result.holders.find((h) => h.id === H);
check('...and Capital shows the same', Math.abs(cap.returnBuilding - f.earned) <= 1, [cap.returnBuilding, f.earned]);

// ---- the other business is untouched
r = await owner('erpHolding', [{}]);
check('the other business\'s setting is its own (Rent)', (await sql`select count(*)::int as n from business_config where business_id = ${FIX.B2} and key = 'holding_cost'`)[0].n === 0, 0);

await done();
