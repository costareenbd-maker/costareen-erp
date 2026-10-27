// onway-1 (27 Oct 2026): "Still coming" on the Receive page - the goods, the invoice total and the payment are written
// down as a supplier order when bought; shipping and the other costs are asked when it arrives. A joint stock's order is
// received into its pool.
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const B = FIX.B, PLA = 'FIL-SUN-PLA-BLA-001';
const SUP = 'Shenzhen Dealer';
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, unit) values
  (${B}, 'OW-A', 'Onway A', 'Filaments', 'T', 'PLA', 0, 900, 'Active', 'Piece'), (${B}, 'OW-B', 'Onway B', 'Parts', 'T', 'Nozzle', 0, 300, 'Active', 'Piece')`;

// ---- 1. written down when bought: a local buy, taka total, not paid yet - no shipping asked
let r = await mgr('erpPoCreate', [{ supplier: SUP, pi: 'INV-77', mode: 'bdt', totalBdt: 10000, payment: 'later', shipBy: 'Sea',
  lines: [{ sku: 'OW-A', qty: 10 }, { sku: 'OW-B', qty: 20 }] }]);
check('(onway) a bought shipment is written down as an order', r.ok && r.result.stage === 'ordered' && r.result.units === 30, r);
const PO1 = r.ok ? r.result.poId : '';
r = await mgr('erpPoList', []);
let o = r.ok && r.result.orders.find((x) => x.id === PO1);
check('(onway) it waits on the way with the taka total, no pool', o && o.stage.goodsBdt === 10000 && o.stage.currency === 'BDT' && !o.stage.pool && o.supplier === SUP, o);
check('(onway) the total is spread equally per unit when nothing has a cost yet', o && o.lines.every((l) => Math.abs(l.rmbUnit - 10000 / 30) < 0.01), o && o.lines);
const paidRows = await sql`select count(*)::int n from supplier_payments where business_id = ${B} and supplier = ${SUP}`;
check('(onway) "not paid yet" writes no payment', paidRows[0].n === 0, paidRows);

// ---- 2. it arrives: received against the order from the Receive page, shipping known now, lines costed from the order
r = await mgr('erpReceiveShipment', [{ poId: PO1, supplier: SUP, reference: 'BOX-1', mode: 'none', shippingBdt: 600, basis: 'units',
  lines: [{ sku: 'OW-A', qty: 10 }, { sku: 'OW-B', qty: 20 }] }]);
check('(onway) received with the shipping typed on arrival', r.ok && r.result.received === 2 && r.result.shipping === 600, r);
const la = r.ok && r.result.lines.find((l) => l.sku === 'OW-A');
check('(onway) each unit costs its order price + its share of the shipping (333.33 + 20)', la && Math.abs(la.unitCost - (10000 / 30 + 20)) < 0.05, la);
check('(onway) the supplier is billed the order\'s goods value', r.ok && r.result.billed === true && r.result.payment === 'later', r.result);
r = await mgr('erpPoList', []);
check('(onway) the order is off the list once everything came', r.ok && !r.result.orders.find((x) => x.id === PO1), r.result.orders.map((x) => x.id));

// ---- 3. imported, foreign money, paid in advance from an account: the payment is written with the order
await owner('erpCashSetup', [{ accounts: [{ name: 'Bank', kind: 'bank' }] }]);
const ACC = ((await owner('erpCashBook', [{}])).result.accounts.find((a) => a.name === 'Bank') || {}).id;
r = await owner('erpPoCreate', [{ supplier: SUP, pi: 'PI-9', mode: 'fx', currency: 'RMB', totalFx: 1000, rate: 17, payment: 'advance', advanceFrom: ACC, advanceDate: '2026-01-10', shipBy: 'Air',
  lines: [{ sku: PLA, qty: 5 }] }]);
check('(onway) an imported shipment paid in advance', r.ok && r.result.paid === 17000, r);
const PO2 = r.ok ? r.result.poId : '';
r = await owner('erpPoList', []);
o = r.ok && r.result.orders.find((x) => x.id === PO2);
check('(onway) it carries RMB 1,000 @ 17 and the advance', o && o.stage.goodsFx === 1000 && o.stage.currency === 'RMB' && o.paid === 17000 && o.shipBy === 'Air', o);
r = await owner('erpPoCreate', [{ supplier: SUP, mode: 'fx', currency: 'RMB', totalFx: 0, rate: 17, lines: [{ sku: PLA, qty: 1 }] }]);
check('(onway) no total in foreign money is refused in words', !r.ok && /invoice total/.test(r.error), r);

// ---- 4. a joint stock's shipment: written for the pool, received into the pool, refused into the own stock
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partnerow@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
await sql`insert into joint_flags (business_id) values (${B}), (${B3}) on conflict do nothing`;
r = await owner('erpJointStart', [{ action: 'create', name: 'Onway JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Shop', tier: 'wholesale' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'JV-OW', name: 'Joint Onway', brand: 'Polymaker', type: 'PLA', retail: 2000, cost: 1400 }]);
r = await owner('erpPoCreate', [{ supplier: SUP, pool: POOL, mode: 'bdt', totalBdt: 7000, payment: 'later', shipBy: 'Sea', lines: [{ sku: 'JV-OW', qty: 5 }] }]);
check('(onway) a shipment for the joint stock is written with its pool', r.ok, r);
const PO3 = r.ok ? r.result.poId : '';
r = await owner('erpPoList', []);
o = r.ok && r.result.orders.find((x) => x.id === PO3);
check('(onway) the list says which pool it is for', o && o.stage.pool === POOL, o && o.stage);
r = await owner('erpReceiveShipment', [{ poId: PO3, supplier: SUP, reference: 'JBOX-1', mode: 'none', lines: [{ sku: 'JV-OW', qty: 5 }] }]);
check('(onway) a joint order is not received into the own stock', !r.ok, r);
r = await owner('erpReceiveShipment', [{ poId: PO3, pool: POOL, supplier: SUP, reference: 'JBOX-1', mode: 'none', shippingBdt: 500, lines: [{ sku: 'JV-OW', qty: 5 }] }]);
check('(onway) ...it is received into its pool, costed from the order plus the shipping', r.ok && r.result.joint && r.result.lines[0] && Math.abs(r.result.lines[0].unitCost - 1500) < 0.05, r);
r = await owner('erpPoList', []);
check('(onway) the joint order is done', r.ok && !r.result.orders.find((x) => x.id === PO3), r.result.orders.map((x) => x.id));
r = await owner('erpPoCreate', [{ supplier: SUP, pool: crypto.randomUUID(), mode: 'bdt', totalBdt: 100, lines: [{ sku: PLA, qty: 1 }] }]);
check('(onway) an unknown pool is refused', !r.ok, r);

done();
