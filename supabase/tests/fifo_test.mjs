// FilaDash merge P3: FIFO lots (107_fifo_lots.sql, handlers/lots.js, the line cost in handlers/invoice.js).
// Run: TEST_SCRIPT=fifo_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const SKU = 'FD-FIFO-001';
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status)
          values (${B}, ${SKU}, 'FIFO Test PLA', 'Filaments', 'Test', 'PLA', 0, 300, 'Active')`;
const lots = async () => (await sql`select l.reference, l.source, l.qty_in::float as qin, l.qty_left::float as qleft, l.unit_cost::float as cost
                                     from stock_lots l join products p on p.id = l.product_id
                                     where p.business_id = ${B} and p.sku = ${SKU} and l.qty_in > 0 order by l.received_at, l.seq`);
const lineCost = async (no) => Number((await sql`select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id
                                                  where i.business_id = ${B} and i.invoice_no = ${no} and l.sku = ${SKU} and l.qty > 0`)[0].unit_cost);

// ---- two shipments at different landed costs
let r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-A', supplier: 'Dragon', mode: 'bdt', totalBdt: 1000, shippingBdt: 200, lines: [{ sku: SKU, qty: 10 }] }]);
check('shipment A received', r.ok, r);
r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-B', supplier: 'Dragon', mode: 'bdt', totalBdt: 2000, lines: [{ sku: SKU, qty: 10 }] }]);
check('shipment B received', r.ok, r);
let L = await lots();
check('two lots, each at its own landed cost (A: 1000 + 200 freight over 10 = 120; B: 200)',
  L.length === 2 && L[0].reference === 'SHIP-A' && near(L[0].cost, 120) && L[0].qleft === 10 && L[1].reference === 'SHIP-B' && near(L[1].cost, 200), L);

// ---- a sale across both lots: oldest first
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: SKU, qty: 12 }], payMode: 'full' }]);
check('sale of 12', r.ok, r);
const INV1 = r.result.invoiceNo;
L = await lots();
check('A is empty, B has 8 left', L[0].qleft === 0 && L[1].qleft === 8, L);
check('the line cost is FIFO: (10 x 120 + 2 x 200) / 12', near(await lineCost(INV1), (1200 + 400) / 12), await lineCost(INV1));

// ---- a return goes back into the very lots, newest draw first
r = await owner('erpReturnGoods', [{ invoiceNo: INV1, lines: [{ sku: SKU, qty: 5, condition: 'good' }], money: 'refund', method: 'Cash', reason: 'too many' }]);
check('return of 5', r.ok, r);
L = await lots();
check('B gets its 2 back, A its 3: A 3 left, B 10', L.length === 2 && L[0].qleft === 3 && L[1].qleft === 10, L);

// ---- the next sale takes A's 3 first
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01812345678' }, items: [{ sku: SKU, qty: 4 }], payMode: 'full' }]);
const INV2 = r.result.invoiceNo;
check('sale of 4: 3 from A + 1 from B = (360 + 200) / 4', r.ok && near(await lineCost(INV2), 140), await lineCost(INV2));

// ---- a count that finds fewer takes from the oldest lot too
const stockNow = Number((await sql`select ps.stock from product_stock ps join products p on p.id = ps.product_id where p.business_id = ${B} and p.sku = ${SKU}`)[0].stock);
r = await owner('erpStockCount', [{ lines: [{ sku: SKU, counted: stockNow - 1 }] }]);
check('a count one short', r.ok, r);
L = await lots();
check('the missing unit came out of B (A is empty)', L[0].qleft === 0 && L[1].qleft === 8, L);
const units = L.reduce((t, x) => t + x.qleft, 0);
check('the lots hold exactly the stock', units === stockNow - 1, [units, stockNow]);

// ---- stock from before lots began: one opening lot, cost from the cost book / product
// (a product whose stock came in before 107: its movements are written with the lots rule switched off)
const PLA = 'FD-OLD-001';
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status)
          values (${B}, ${PLA}, 'Old stock PLA', 'Filaments', 'Old', 'PLA', 900, 1200, 'Active')`;
const oldId = (await sql`select id from products where business_id = ${B} and sku = ${PLA}`)[0].id;
await sql`alter table stock_movements disable trigger stock_movements_lots`;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${B}, ${oldId}, 'OPENING', 'IN', 7)`;
await sql`alter table stock_movements enable trigger stock_movements_lots`;
const plaStock = 7;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
const INV3 = r.result.invoiceNo;
const op = await sql`select l.source, l.qty_in::float as qin, l.qty_left::float as qleft, l.unit_cost from stock_lots l join products p on p.id = l.product_id
                     where p.business_id = ${B} and p.sku = ${PLA} and l.qty_in > 0`;
check('what was on the shelf became one opening lot (cost not known), the sale took 1 from it',
  op.length === 1 && op[0].source === 'opening' && op[0].qin === plaStock && op[0].qleft === plaStock - 1 && op[0].unit_cost === null, [op, plaStock]);
const plaLine = Number((await sql`select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${B} and i.invoice_no = ${INV3}`)[0].unit_cost);
check('...so that sale is costed as before (the product\'s cost)', near(plaLine, 900), plaLine);

// ---- removing an invoice undoes what it did to the lots
await sql`delete from stock_movements where business_id = ${B} and reference = ${'Invoice: ' + INV2}`;
L = await lots();
check('the 4 of invoice 2 are back where they came from (A 3, B 9)', L[0].qleft === 3 && L[1].qleft === 9, L);

// ---- shipments
r = await sales('erpShipments', [{}]);
check('sales staff do not see shipments (costs)', !r.ok, r);
r = await mgr('erpShipments', [{}]);
check('shipments list', r.ok, r);
const A = r.result.shipments.find((s) => s.reference === 'SHIP-A'), Bs = r.result.shipments.find((s) => s.reference === 'SHIP-B');
check('A: 10 in, 3 left, landed 1200, freight 200 noted', A && A.unitsIn === 10 && A.unitsLeft === 3 && A.landed === 1200 && A.extraCosts === 200, A);
check('A sold 7 (12 - 5 returned) at 300 each, profit = 7 x (300 - 120)', A.sold === 7 && A.revenue === 2100 && A.profit === 7 * 180, A);
check('B: what it sold and what is left, the counted-out unit not sold', Bs && Bs.unitsLeft === 9 && Bs.sold === 0 && Bs.status === 'In stock', Bs);
r = await mgr('erpShipment', [{ reference: 'SHIP-A' }]);
check('one shipment line by line with its freight', r.ok && r.result.lines.length === 1 && r.result.lines[0].unitCost === 120 && r.result.extra.length === 1 && r.result.extra[0].amount === 200, r.result);
r = await mgr('erpLots', [{ sku: SKU }]);
check('a product\'s lots', r.ok && r.result.lots.length === 2 && r.result.lots[0].unitsLeft === 3, r.result);

// ---- the dashboard values stock at FIFO
r = await owner('erpFdDash', [{ months: 1, group: 'filaments' }]);
const fifoVal = 3 * 120 + 9 * 200;
const lsRows = await sql`select sum(l.qty_left * l.unit_cost)::float as v from stock_lots l join products p on p.id = l.product_id
                         where p.business_id = ${B} and p.sku = ${SKU}`;
check('this product\'s lots are worth 3 x 120 + 9 x 200', near(lsRows[0].v, fifoVal), lsRows);
check('stock value includes it at FIFO', r.ok && r.result.kpi.stockValue.v >= fifoVal, r.result.kpi.stockValue);

// ---- the other business is untouched
const other = await sql`select count(*)::int as n from stock_lots where business_id = ${FIX.B2} and reference like 'SHIP-%'`;
check('no lots in the other business', other[0].n === 0, other);

await done();
