// fd-20: erpFdInventory (handlers/fd20.js) - his Inventory figures, read only.
// Run: TEST_SCRIPT=fd20_test.mjs ... erp_server_test.py
// The handler is not registered in handlers/index.js yet (the page block brings the registration lines), so the
// test calls it directly with the same ctx shape core.js gives a handler.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, mgr, fnDir, check, done } from './harness.mjs';

const { erpFdInventory, HANDLERS, DEAD_DAYS } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'fd20.js')));
const B = FIX.B;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.6;
const ctxAs = (role, powers) => ({ tx: sql, sql, s: { role, powers }, biz: B, now: new Date(), memo: {}, deps: {} });
const call = (role, payload, powers) => erpFdInventory(ctxAs(role, powers), payload);

check('exports one read-only handler', HANDLERS && Object.keys(HANDLERS).join() === 'erpFdInventory' && DEAD_DAYS === 120, Object.keys(HANDLERS || {}));

// ---- a product with two shipments at different landed costs, part sold
const SKU = 'FD20-PLA-001';
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, reorder_level, status)
          values (${B}, ${SKU}, 'FD20 Test PLA Red', 'Filaments', 'Test', 'PLA', 0, 400, 3, 'Active')`;
let r = await mgr('erpReceiveShipment', [{ reference: 'FD20-A', supplier: 'Dragon', mode: 'bdt', totalBdt: 1000, shippingBdt: 200, lines: [{ sku: SKU, qty: 10 }] }]);
check('shipment A received (10 at 120)', r.ok, r);
r = await mgr('erpReceiveShipment', [{ reference: 'FD20-B', supplier: 'Dragon', mode: 'bdt', totalBdt: 2000, lines: [{ sku: SKU, qty: 10 }] }]);
check('shipment B received (10 at 200)', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: SKU, qty: 12 }], payMode: 'full' }]);
check('sale of 12 (10 from A, 2 from B)', r.ok, r);

const counts = async () => (await sql`select (select count(*) from stock_lots where business_id = ${B})::int as l,
                                              (select count(*) from stock_movements where business_id = ${B})::int as m,
                                              (select count(*) from invoices where business_id = ${B})::int as i,
                                              (select coalesce(sum(qty_left), 0) from stock_lots where business_id = ${B})::float as q`)[0];
const before = await counts();

let d = await call('owner', { lots: true, sku: SKU });
check('read only: lots, movements, invoices and units left unchanged by the call', JSON.stringify(await counts()) === JSON.stringify(before), [before, await counts()]);
const x = d.items[SKU];
check('owner sees money', d.canCost === true && x && typeof x.value === 'number', d.canCost);
check('one open lot left (A is empty)', x.lots === 1, x);
check('value at cost is FIFO: 8 left of B x 200 = 1600', near(x.value, 1600), x);
check('average unit cost 200', near(x.avgUnit, 200), x);
check('status In stock (8 > reorder 3, sold today)', x.status === 'in_stock' && x.idle === 0 && !!x.lastSale, x);
check('the FIFO queue has B only, oldest first', d.queue.length === 1 && d.queue[0].shipment === 'FD20-B' && d.queue[0].qtyLeft === 8 && near(d.queue[0].unitCost, 200), d.queue);
check('one exhausted lot is counted', d.exhausted === 1, d.exhausted);
const mine = d.lots.filter((l) => l.sku === SKU);
check('the lot list has both lots, newest first, A exhausted', mine.length === 2 && mine[0].shipment === 'FD20-B' && mine[1].status === 'exhausted' && mine[1].qtyLeft === 0, mine);
check('lot numbers look like his (LOT-00012)', /^LOT-\d{5,}$/.test(mine[0].lot), mine[0].lot);
check('value left on the lot list = 1600', near(mine[0].valueLeft, 1600) && near(mine[1].valueLeft, 0), mine);

// stock value at cost equals the dashboard head's figure (one formula: lotStock)
const { erpFdHead } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'fddash.js')));
const head = await erpFdHead(ctxAs('owner'), { view: 'products' });
const hv = (head.cards.filter((c) => c.key === 'stockValue')[0] || {}).v;
check('KPI stock value = the screen head\'s stock value (same lotStock)', near(d.kpi.value, hv), [d.kpi.value, hv]);
const hu = (head.cards.filter((c) => c.key === 'units')[0] || {}).v;
check('KPI units = the screen head\'s units on hand', d.kpi.units === hu, [d.kpi.units, hu]);

// ---- dead stock: in stock, nothing sold and no new lot for 120+ days
const OLD = 'FD20-OLD-001';
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, reorder_level, status)
          values (${B}, ${OLD}, 'FD20 Old Nozzle', 'Spare parts', 'Test', 'Nozzle', 0, 500, 1, 'Active')`;
r = await mgr('erpReceiveShipment', [{ reference: 'FD20-OLD', supplier: 'Dragon', mode: 'bdt', totalBdt: 900, lines: [{ sku: OLD, qty: 3 }] }]);
check('old stock received', r.ok, r);
await sql`update stock_lots set received_at = now() - interval '200 days' where business_id = ${B} and reference = 'FD20-OLD'`;
d = await call('owner', {});
check('200 days on the shelf, never sold = Dead', d.items[OLD].status === 'dead' && d.items[OLD].idle >= 199, d.items[OLD]);
check('dead stock KPI counts it with its value (3 x 300)', d.kpi.dead.items >= 1 && d.kpi.dead.value >= 900, d.kpi.dead);

// ---- receipts, returns and adjustments (no sales)
check('recent moves list receipts and no sales', d.moves.length > 0 && d.moves.every((m) => m.kind !== 'SALE') && d.moves.some((m) => m.kind === 'Received' && m.sku === OLD), d.moves.slice(0, 3));

// ---- sales staff: units, lots, statuses - no money
const before2 = await counts();
d = await call('sales', { lots: true, sku: SKU });
check('sales: no money anywhere', d.canCost === false && d.kpi.value === null && d.kpi.dead.value === null &&
  !('value' in d.items[SKU]) && !('unitCost' in d.queue[0]) && !('valueLeft' in d.lots[0]) && !('holding' in d.lots[0]), [d.kpi, d.items[SKU], d.queue[0]]);
check('sales: still the units, lots and status', d.items[SKU].lots === 1 && d.items[SKU].status === 'in_stock' && d.queue[0].qtyLeft === 8, d.items[SKU]);
d = await call('sales', {}, { costs: true });
check('sales with the "costs" ability given: money shown', d.canCost === true && typeof d.kpi.value === 'number', d.canCost);

// ---- the other business stays apart
const other = await erpFdInventory({ tx: sql, sql, s: { role: 'owner' }, biz: FIX.B2, now: new Date(), memo: {} }, { lots: true });
check('business B2 sees none of B\'s lots or products', !other.items[SKU] && !(other.lots || []).some((l) => l.sku === SKU || l.sku === OLD), Object.keys(other.items).slice(0, 5));

// ---- read only
check('nothing written by the later calls either', JSON.stringify(await counts()) === JSON.stringify(before2), [before2, await counts()]);

await done();
