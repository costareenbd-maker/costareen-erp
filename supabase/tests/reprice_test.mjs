// price-each-2 (owner 1 Nov 2026): a shipment already received is priced again from its invoice - the goods shared by each
// line's price, the freight by units / weight, and the lots, the receive movements, the sale draws, the sale lines' cost
// and the products' cost follow. The check writes nothing. Own stock and joint stock alike.
import { sql, FIX, owner, mgr, sales, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const B = FIX.B, near = (a, b) => Math.abs(Number(a) - b) < 0.05;
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, weight_g, status, unit) values
  (${B}, 'RP-A', 'Reprice A', 'Zz', 'Nobook', 'Odd', 0, 5000, 1000, 'Active', 'Piece'),
  (${B}, 'RP-B', 'Reprice B', 'Zz', 'Nobook', 'Odd', 0, 5000, 500, 'Active', 'Piece')`;
// received with the prices the wrong way round: A 2 x $30, B 4 x $10, $100 @ 100, freight 600 by units
let r = await mgr('erpReceiveShipment', [{ reference: 'RP-1', supplier: 'Overseas Co', mode: 'fx', currency: 'USD', totalFx: 100, rate: 100, payment: 'later',
  shippingBdt: 600, freightBasis: 'units', lines: [{ sku: 'RP-A', qty: 2, priceFx: 30 }, { sku: 'RP-B', qty: 4, priceFx: 10 }] }]);
check('set-up: received, A 3,100 and B 1,100 a unit', r.ok && r.result.lines.some((l) => l.sku === 'RP-A' && near(l.unitCost, 3100)), r.ok ? r.result.lines : r.error);
r = await owner('erpCreateInvoice', [{ customer: { name: 'Reprice Buyer', phone: '01755500088' }, items: [{ sku: 'RP-A', qty: 1 }], payMode: 'none' }]);
const INV = r.ok && r.result.invoiceNo;
check('set-up: one A sold at 3,100', r.ok, r.error);

const right = [{ sku: 'RP-A', price: 10 }, { sku: 'RP-B', price: 20 }];
const lotsOf = () => sql`select p.sku, l.unit_cost from stock_lots l join products p on p.id = l.product_id where l.business_id = ${B} and l.reference = 'RP-1' order by p.sku`;
// 1. the check: A 10x100x2 = 2,000, B 20x100x4 = 8,000 share the 10,000 goods; freight 100 a unit
r = await mgr('erpShipmentRepriceCheck', [{ reference: 'RP-1', prices: right, basis: 'units' }]);
const ca = r.ok && r.result.lines.find((l) => l.sku === 'RP-A'), cb = r.ok && r.result.lines.find((l) => l.sku === 'RP-B');
check('check: A 1,100, B 2,100 (goods by price, freight by units), the bill\'s USD and rate', ca && cb && near(ca.now, 1100) && near(cb.now, 2100) && !r.result.mismatch &&
  r.result.currency === 'USD' && r.result.rate === 100 && r.result.goods === 10000 && r.result.shipping === 600, r.ok ? r.result : r.error);
check('check: what was sold and what is on the shelf change', r.ok && r.result.soldChange === -2000 && r.result.landedWas === r.result.landedNow, r.ok && r.result);
check('check: nothing written', near((await lotsOf())[0].unit_cost, 3100));
// 2. refusals
r = await mgr('erpShipmentReprice', [{ reference: 'RP-1', prices: [{ sku: 'RP-A', price: 10 }] }]);
check('a line without a price is refused, by name', !r.ok && /No price for Reprice B/.test(r.error), r.error);
r = await mgr('erpShipmentReprice', [{ reference: 'RP-1', prices: [{ sku: 'RP-A', price: 50 }, { sku: 'RP-B', price: 50 }] }]);
check('prices that do not add up to the goods are asked about', !r.ok && /^CONFIRM: /.test(r.error) && /30000 TK/.test(r.error), r.error);
r = await mgr('erpShipmentRepriceCheck', [{ reference: 'RP-1', prices: [{ sku: 'RP-A', price: 50 }, { sku: 'RP-B', price: 50 }] }]);
check('...and the check shows the gap', r.ok && r.result.mismatch && r.result.mismatch.priced === 30000 && r.result.mismatch.goods === 10000, r.ok ? r.result.mismatch : r.error);
r = await sales('erpShipmentReprice', [{ reference: 'RP-1', prices: right }]);
check('sales staff cannot', !r.ok, r.error);
r = await mgr('erpShipmentReprice', [{ reference: 'NO-SUCH', prices: right }]);
check('an unknown shipment is refused', !r.ok && /No shipment/.test(r.error), r.error);

// 3. corrected
r = await mgr('erpShipmentReprice', [{ reference: 'RP-1', prices: right, basis: 'units' }]);
check('corrected, the sale named', r.ok && r.result.invoices.includes(INV), r.ok ? r.result : r.error);
const lots = await lotsOf();
check('the lots: A 1,100, B 2,100', lots.length === 2 && near(lots[0].unit_cost, 1100) && near(lots[1].unit_cost, 2100), lots);
const mv = await sql`select p.sku, m.unit_price, m.total, m.note from stock_movements m join products p on p.id = m.product_id where m.business_id = ${B} and m.reference = 'RP-1' and m.kind = 'RECEIVE' order by p.sku`;
check('the receive movements carry the new cost and say so', near(mv[0].unit_price, 1100) && near(mv[0].total, 2200) && /prices corrected/.test(mv[0].note), mv);
const line = (await sql`select il.unit_cost from invoice_lines il join invoices i on i.id = il.invoice_id where i.business_id = ${B} and i.invoice_no = ${INV}`)[0];
check('the sale line\'s cost (its profit) follows', line && near(line.unit_cost, 1100), line);
const dr = (await sql`select d.unit_cost from lot_draws d join stock_lots l on l.id = d.lot_id where l.business_id = ${B} and l.reference = 'RP-1' and d.qty > 0`)[0];
check('the draw follows', dr && near(dr.unit_cost, 1100), dr);
const pc = await sql`select sku, cost_price from products where business_id = ${B} and sku in ('RP-A', 'RP-B') order by sku`;
check('the products\' cost follows', near(pc[0].cost_price, 1100) && near(pc[1].cost_price, 2100), pc);
// by weight: A 1 kg, B 0.5 kg -> 2 kg + 2 kg; 600 TK = 150 a kg: A 150, B 75
r = await mgr('erpShipmentRepriceCheck', [{ reference: 'RP-1', prices: right }]);
check('freight by weight when every product has one', r.ok && r.result.basis === 'weight' && near(r.result.lines.find((l) => l.sku === 'RP-A').shipping, 150) &&
  near(r.result.lines.find((l) => l.sku === 'RP-B').shipping, 75), r.ok ? r.result.lines : r.error);
// a cost added after the goods: refused until it is struck out
r = await mgr('erpShipmentLateCost', [{ reference: 'RP-1', label: 'Duty', amount: 300, basis: 'units' }]);
check('set-up: a late cost', r.ok, r.error);
r = await mgr('erpShipmentReprice', [{ reference: 'RP-1', prices: right }]);
check('a late cost: refused, with what to do', !r.ok && /after the goods came/.test(r.error), r.error);

// ---- 4. joint stock: the lots in the pool, the freight paid here
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'reprice@t.test', ${sql.json({ full_name: 'Reprice Partner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Reprice Partner Co') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
await sql`insert into joint_flags (business_id) values (${B}), (${B3}) on conflict do nothing`;
r = await owner('erpJointStart', [{ action: 'create', name: 'Reprice JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner', tier: 'retail' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'JR-W', name: 'Joint White', category: 'Filament', brand: 'X', retail: 2000, floor: 1000, cost: 0 }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'JR-K', name: 'Joint Black', category: 'Filament', brand: 'X', retail: 2000, floor: 1000, cost: 0 }]);
r = await mgr('erpReceiveShipment', [{ pool: POOL, supplier: 'Overseas Co', reference: 'JR-1', mode: 'fx', currency: 'USD', totalFx: 100, rate: 100, payment: 'later',
  shippingBdt: 1000, freightBasis: 'units', lines: [{ sku: 'JR-W', qty: 5, priceFx: 15 }, { sku: 'JR-K', qty: 5, priceFx: 5 }] }]);
check('joint set-up: received into the pool', r.ok, r.error);
const JW = (await sales('erpJointCatalog', [])).result.products.find((x) => /^JR-W~J/.test(x.sku)).sku;
r = await owner('erpCreateInvoice', [{ customer: { name: 'Joint Buyer', phone: '01755500089' }, items: [{ sku: JW, qty: 1 }], payMode: 'none' }]);
check('joint set-up: one White sold (the pool copy draws at 1,500)', r.ok, r.error);
r = await mgr('erpShipments', [{ pool: POOL }]);
const js = r.ok && r.result.shipments.find((s) => s.reference === 'JR-1');
check('joint Shipments list: the pool\'s shipment with the freight paid here', js && js.unitsIn === 10 && js.extraCosts === 1000 && js.landed === 11000, r.ok ? r.result.shipments : r.error);
r = await mgr('erpShipment', [{ pool: POOL, reference: 'JR-1' }]);
check('joint shipment page: its lines and the bill', r.ok && r.result.lines.length === 2 && r.result.bill && r.result.bill.amount === 10000, r.ok ? r.result : r.error);
r = await mgr('erpShipmentReprice', [{ pool: POOL, reference: 'JR-1', prices: [{ sku: 'JR-W', price: 10 }, { sku: 'JR-K', price: 10 }], basis: 'units' }]);
const jl = await sql`select p.sku, l.unit_cost from stock_lots l join products p on p.id = l.product_id where l.business_id = ${POOL} and l.reference = 'JR-1' order by p.sku`;
check('joint corrected: both 1,100 a unit (1,000 goods + 100 freight)', r.ok && jl.length === 2 && jl.every((l) => near(l.unit_cost, 1100)), r.ok ? jl : r.error);
const ml = (await sql`select il.unit_cost from invoice_lines il join invoices i on i.id = il.invoice_id where i.business_id = ${POOL}`)[0];
check('the pool copy of the sale follows: 1,100', ml && near(ml.unit_cost, 1100) && r.result.invoices.length === 1, ml);
const jp = await sql`select cost_price from products where business_id = ${POOL} and sku = 'JR-W'`;
check('the pool product\'s cost follows', near(jp[0].cost_price, 1100), jp);
r = await mgr('erpShipmentReprice', [{ pool: crypto.randomUUID(), reference: 'JR-1', prices: [] }]);
check('a pool this company is not in is refused', !r.ok && /not one this company is in/.test(r.error), r.error);
done();
