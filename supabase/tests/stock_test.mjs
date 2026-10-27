// Stock group: products, receiving, adjustments, history, To-order plan,
// purchase orders, reorder levels. Run through erp_server_test.py with
// TEST_SCRIPT=stock_test.mjs.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done, fnDir } from './harness.mjs';

const { formatDate } = await import(pathToFileURL(path.join(fnDir, 'lib', 'time.js')));
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001', A1 = 'PRT-BAM-A1-001', PETG = 'FIL-SUN-PETG-WHI-001';
const r2 = (n) => Math.round(n * 100) / 100;

// ---- seed: price book, config, a fast seller -------------------------------
await sql`insert into business_config (business_id, key, value) values
  (${B}, 'cost_rate', '17'), (${B}, 'cost_handling', '30')`;
await sql`insert into cost_book (business_id, sort_order, category, brand, type, buy_rmb, buy_bdt, handling) values
  (${B}, 1, 'Filaments', 'Sunlu', 'PLA', 40, null, 0),
  (${B}, 2, 'Filaments', 'Sunlu', 'PETG', 50, null, null),
  (${B}, 3, 'Uncategorised', '-', '-', null, 100, 5),
  (${B}, 4, 'Printers', 'Bambulab', 'X1', null, null, null)`;
const pe = await sql`insert into products (business_id, sku, name, category, brand, type, color, cost_price, sell_price, supplier)
  values (${B}, ${PETG}, 'Sunlu PETG White', 'Filaments', 'Sunlu', 'PETG', 'White', 0, 1500, 'Sunlu Direct') returning id`;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${B}, ${pe[0].id}, 'RECEIVE', 'IN', 5)`;
const iv = await sql`insert into invoices (business_id, invoice_no, customer_name, created_at)
  values (${B}, 'INV-P', 'C', now() - interval '3 days') returning id`;
await sql`insert into invoice_lines (business_id, invoice_id, sku, qty) values (${B}, ${iv[0].id}, ${PETG}, 90)`;
await makeShareholder();

const prod = async (sku) => (await sql`select * from products where business_id = ${B} and sku = ${sku}`)[0];
const stockOf = async (sku) => (await sql`select ps.stock from product_stock ps join products p on p.id = ps.product_id
                                          where p.business_id = ${B} and p.sku = ${sku}`)[0].stock;
const moves = async (sku) => sql`select m.* from stock_movements m join products p on p.id = m.product_id
                                 where p.business_id = ${B} and p.sku = ${sku} order by m.seq`;
let r;

// ============================================================ products
r = await sales('erpSaveProduct', [{ isNew: true, product_name: 'X' }]);
check('sales cannot save a product', !r.ok && /does not have permission/.test(r.error), r);
r = await mgr('erpSaveProduct', [{ isNew: true, product_name: '  ' }]);
check('name required', !r.ok && r.error === 'Product name is required.', r);
r = await mgr('erpSaveProduct', [{ isNew: true, product_name: 'X', sell_price: -1 }]);
check('negative price refused', !r.ok && r.error === 'Prices cannot be negative.', r);

r = await mgr('erpSaveProduct', [{ isNew: true, sku: '', product_name: 'Sunlu PLA+ White', category: 'Filaments', brand: 'Sunlu',
  type: 'PLA+', color: 'White', unit: '', supplier: 'Sunlu Direct', cost_price: 500, sell_price: 1200, reorder_level: 0,
  lead_time_days: 0, location_bin: 'A1', status: 'Active', opening_stock: 4 }]);
check('create: generated SKU FIL-SUN-PLA+-WHI-001', r.ok && r.result.sku === 'FIL-SUN-PLA+-WHI-001' && r.result.created === true, r);
let p = await prod('FIL-SUN-PLA+-WHI-001');
check('create: defaults reorder 0->5, lead 0->7, unit Piece', p && p.reorder_level === 5 && p.lead_time_days === 7 &&
  p.unit === 'Piece' && p.status === 'Active' && p.cost_price === 500 && p.location_bin === 'A1', p);
let mv = await moves('FIL-SUN-PLA+-WHI-001');
check('create: OPENING 4 at cost, by the ERP person', mv.length === 1 && mv[0].kind === 'OPENING' && mv[0].qty === 4 &&
  mv[0].unit_price === 500 && mv[0].total === 2000 && mv[0].reference === 'API - New Product' && mv[0].operator === 'Mehedi' &&
  /^TXN-\d{8}-\d{4}$/.test(mv[0].txn_no), mv);
r = await mgr('erpSaveProduct', [{ isNew: true, product_name: 'Sunlu PLA+ White 2', category: 'Filaments', brand: 'Sunlu', type: 'PLA+', color: 'White' }]);
check('next SKU in the series: -002, no opening -> no movement', r.ok && r.result.sku === 'FIL-SUN-PLA+-WHI-002' &&
  (await moves('FIL-SUN-PLA+-WHI-002')).length === 0, r);
r = await mgr('erpSaveProduct', [{ isNew: true, sku: 'fil-sun-pla-bla-001', product_name: 'Dup' }]);
check('duplicate SKU (case-insensitive)', !r.ok && r.error === 'SKU already exists: fil-sun-pla-bla-001', r);

await sql`update memberships set powers = '{"costs": false}'::jsonb where business_id = ${FIX.B} and user_id = ${FIX.U.mgr}`;   // since 058 a manager has Product cost unless switched off
// manager edit: the cost is scrubbed from what the form loads, so it must survive the save
r = await mgr('erpProduct', [PLA]);
const form = { ...r.result, isNew: false, sell_price: 1400 };
check('manager form has no cost_price', !('cost_price' in form), form);
r = await mgr('erpSaveProduct', [form]);
p = await prod(PLA);
check('manager edit keeps the cost it cannot see (fix)', r.ok && r.result.created === false && p.cost_price === 900 && p.sell_price === 1400, [r, p]);
r = await mgr('erpSaveProduct', [{ ...form, cost_price: 0 }]);
check('manager sending cost 0 does not wipe it either', r.ok && (await prod(PLA)).cost_price === 900);
await sql`update memberships set powers = '{}'::jsonb where business_id = ${FIX.B} and user_id = ${FIX.U.mgr}`;
r = await owner('erpSaveProduct', [{ ...(await owner('erpProduct', [PLA])).result, isNew: false, cost_price: 1000 }]);
check('owner can change the cost', r.ok && (await prod(PLA)).cost_price === 1000, r);
await owner('erpSaveProduct', [{ ...(await owner('erpProduct', [PLA])).result, isNew: false, cost_price: 900, sell_price: 1350 }]);
r = await mgr('erpSaveProduct', [{ sku: 'NOPE', product_name: 'x' }]);
check('update unknown product', !r.ok && r.error === 'Product not found: NOPE', r);
r = await mgr('erpSaveProduct', [{ ...form, status: 'Discontinued' }]);
check('form cannot discontinue with stock', !r.ok && r.error === 'Sunlu PLA Black still has 7 in stock, so it cannot be ' +
  'discontinued yet. Sell what is left, or remove it with a stock adjustment if it is damaged or lost, then discontinue it.', r);

r = await mgr('erpSetProductStatus', [PLA, 'Gone']);
check('status must be Active/Discontinued', !r.ok && r.error === 'Status must be Active or Discontinued.', r);
r = await mgr('erpSetProductStatus', ['', 'Active']);
check('which product', !r.ok && r.error === 'Which product?', r);
r = await mgr('erpSetProductStatus', [PLA, 'Discontinued']);
check('button cannot discontinue with stock (SKU as the name)', !r.ok && /^FIL-SUN-PLA-BLA-001 still has 7 in stock/.test(r.error), r);
r = await mgr('erpSetProductStatus', ['fil-sun-pla+-whi-002', 'Discontinued']);
check('discontinue an empty product', r.ok && r.result.sku === 'FIL-SUN-PLA+-WHI-002' && r.result.status === 'Discontinued', r);
r = await sales('erpDiscontinued', []);
check('erpDiscontinued lists it (sales may read)', r.ok && r.result.length === 1 && r.result[0].sku === 'FIL-SUN-PLA+-WHI-002', r);
r = await mgr('erpSetProductStatus', ['FIL-SUN-PLA+-WHI-002', 'Active']);
check('reactivate', r.ok && (await prod('FIL-SUN-PLA+-WHI-002')).status === 'Active', r);
r = await mgr('erpSetProductStatus', ['X-OTHER', 'Active']);
check("another business's product is not found", !r.ok && r.error === 'Product not found: X-OTHER', r);
r = await sales('erpSetProductStatus', [PLA, 'Active']);
check('sales cannot change status', !r.ok && /does not have permission/.test(r.error), r);

// ============================================================ receive shipment
const recv = (pl) => mgr('erpReceiveShipment', [{ supplier: 'Sunlu Direct', reference: 'INV-77', notes: '', mode: 'none', again: true,   // fix-1 M1: the same bill reused on purpose here
  totalRmb: 0, rate: 0, totalBdt: 0, saveRate: true, shippingBdt: 0, shipNote: '', poId: '', ...pl }]);
r = await recv({ lines: [] });
check('no lines', !r.ok && r.error === 'Add at least one product with a quantity.', r);
r = await recv({ mode: 'rmb', lines: [{ sku: PLA, qty: 1 }] });
check('rmb needs a total', !r.ok && r.error === 'Enter the shipment total in RMB, or switch to local.', r);
r = await recv({ mode: 'rmb', totalRmb: 10, lines: [{ sku: PLA, qty: 1 }] });
check('rmb needs a rate', !r.ok && r.error === 'Enter the rate you paid for this shipment (TK per RMB).', r);
r = await recv({ mode: 'rmb', totalRmb: 10, rate: 1500, lines: [{ sku: PLA, qty: 1 }] });
check('silly rate', !r.ok && /^That rate looks wrong \(1500 TK per RMB/.test(r.error), r);
r = await recv({ mode: 'bdt', lines: [{ sku: PLA, qty: 1 }] });
check('bdt needs a total', !r.ok && r.error === 'Enter what this shipment cost in taka, or switch to imported.', r);
r = await recv({ shippingBdt: -5, lines: [{ sku: PLA, qty: 1 }] });
check('negative shipping', !r.ok && r.error === 'Shipping cannot be negative.', r);
r = await recv({ lines: [{ sku: 'X-OTHER', qty: 1 }] });
check("another business's SKU is not found", !r.ok && r.error === 'Product not found: X-OTHER', r);
r = await sales('erpReceiveShipment', [{ reference: 'x', lines: [{ sku: PLA, qty: 1 }] }]);
check('sales cannot receive', !r.ok && /does not have permission/.test(r.error), r);

// price book: Filaments|Sunlu|PLA = 40 x 17 + 0 = 680; average (7x900 + 3x680)/10 = 834
r = await recv({ lines: [{ sku: PLA, qty: 3 }] });
check('price-book receive: 680 a unit, average 834', r.ok && r.result.costed === 'price book' && r.result.units === 3 &&
  r.result.received === 1 && r.result.lines[0].unitCost === 680 && r.result.lines[0].wasCost === 900 &&
  r.result.lines[0].nowCost === 834 && r.result.lines[0].hadStock === 7 && r.result.totalCost === 0, r);
mv = (await moves(PLA)).pop();
check('RECEIVE row: unit 680, total 2040, ref, supplier, operator', mv.kind === 'RECEIVE' && mv.direction === 'IN' && mv.qty === 3 &&
  mv.unit_price === 680 && mv.total === 2040 && mv.reference === 'INV-77' && mv.supplier === 'Sunlu Direct' && mv.operator === 'Mehedi', mv);
check('PLA cost now 834, stock 10', (await prod(PLA)).cost_price === 834 && (await stockOf(PLA)) === 10);

// RMB total spread by expected value, shipping spread the same way
r = await recv({ mode: 'rmb', totalRmb: 1000, rate: 18, shippingBdt: 500, shipNote: 'sea 2 kg @ 250',
  lines: [{ sku: PLA, qty: 10 }, { sku: A1, qty: 1 }] });
const wP = 680 * 10, wA = 40000 * 1, sW = wP + wA;
const cP = r2(18000 * wP / sW / 10 + 500 * wP / sW / 10), cA = r2(18000 * wA / sW + 500 * wA / sW);
check('rmb shipment: unit costs by value share', r.ok && r.result.costed === 'shipment total' && r.result.totalCost === 18000 &&
  r.result.rate === 18 && r.result.rateSaved === true && r.result.shipping === 500 && r.result.units === 11 &&
  r.result.lines[0].unitCost === cP && r.result.lines[1].unitCost === cA, [r, cP, cA]);
check('worked example: PLA 268.8, A1 15811.97', cP === 268.8 && cA === 15811.97, [cP, cA]);
check('weighted averages', (await prod(PLA)).cost_price === r2((10 * 834 + 10 * cP) / 20) &&
  (await prod(A1)).cost_price === r2((3 * 40000 + cA) / 4), [await prod(PLA), await prod(A1)]);
mv = (await moves(A1)).pop();
check('note stamp', mv.note === 'RMB 1000 @ 18 TK/RMB | shipping TK 500 (sea 2 kg @ 250)', mv.note);
check('rate saved to cost_rate', (await sql`select value from business_config where business_id = ${B} and key = 'cost_rate'`)[0].value === '18');

// a new product on the receive screen (the server side; see fixes about the page)
r = await recv({ mode: 'bdt', totalBdt: 600, lines: [{ sku: '', isNew: true, qty: 5,
  product: { product_name: 'Mystery Nozzle', category: '', brand: '', type: '', color: '', cost_price: 0, opening_stock: 5 } }] });
check('draft created, costed from the shipment total (120 each)', r.ok && r.result.createdProducts.length === 1 &&
  r.result.createdProducts[0] === '----001' && r.result.lines[0].unitCost === 120 && r.result.lines[0].nowCost === 120, r);
p = await prod('----001');
mv = await moves('----001');
check('draft product: lead 60, no double OPENING (fix), stock 5', p && p.lead_time_days === 60 && p.cost_price === 120 &&
  mv.length === 1 && mv[0].kind === 'RECEIVE' && (await stockOf('----001')) === 5, [p, mv]);
r = await recv({ lines: [{ sku: '', qty: 5 }] });
check('what the page sends for a draft ({sku:"", qty}) is dropped', !r.ok && r.error === 'Add at least one product with a quantity.', r);
r = await recv({ lines: [{ sku: A1, qty: 1 }, { isNew: true, qty: 1, product: { sku: 'fil-sun-pla-bla-001', product_name: 'Clash' } }] });
check('colliding new SKU refuses the whole shipment', !r.ok && r.error === 'SKU already exists: fil-sun-pla-bla-001' &&
  (await stockOf(A1)) === 4, r);
r = await recv({ lines: [{ isNew: true, qty: 1, product: { product_name: '' } }] });
check('new product needs a name', !r.ok && r.error === 'A new product needs a name.', r);
r = await recv({ lines: [{ isNew: true, qty: 1, product: { product_name: 'Thing' } }] });
check('blank-attribute product finds the Uncategorised|-|- book row (fix): 105', r.ok && r.result.lines[0].unitCost === 105, r);

r = await mgr('erpReceiveStock', [{ lines: [{ sku: A1, qty: 1 }, { sku: 'NOPE', qty: 1 }], supplier: 'S' }]);
check('legacy erpReceiveStock: zero cost, partial failure reported', r.ok && r.result.received.length === 1 &&
  r.result.failed[0].error === 'Product not found: NOPE' && (await moves(A1)).pop().unit_price === 0, r);
r = await mgr('erpReceiveStock', [{ lines: [{ sku: 'NOPE', qty: 1 }] }]);
check('legacy: all failed -> error', !r.ok && r.error === 'NOPE: Product not found: NOPE', r);

// ============================================================ adjustments
r = await mgr('erpAdjustStock', [{ sku: '', qty: 1, direction: 'IN', reason: 'x' }]);
check('adjust: choose a product', !r.ok && r.error === 'Choose a product.', r);
r = await mgr('erpAdjustStock', [{ sku: A1, qty: 0, direction: 'IN', reason: 'x' }]);
check('adjust: qty', !r.ok && r.error === 'Quantity must be at least 1.', r);
r = await mgr('erpAdjustStock', [{ sku: A1, qty: 1, direction: 'IN', reason: ' ' }]);
check('adjust: reason', !r.ok && r.error === 'A reason is required for a stock adjustment.', r);
const a1Before = await stockOf(A1);
r = await mgr('erpAdjustStock', [{ sku: A1, qty: 2, direction: 'IN', reason: 'found in store', notes: '' }]);
mv = (await moves(A1)).pop();
check('adjust IN = RETURN at 0', r.ok && r.result.direction === 'IN' && r.result.qty === 2 && r.result.product === 'Bambu A1' &&
  r.result.txnId === mv.txn_no && mv.kind === 'RETURN' && mv.unit_price === 0 && mv.reference === 'found in store' &&
  (await stockOf(A1)) === a1Before + 2, [r, mv]);
r = await mgr('erpAdjustStock', [{ sku: A1, qty: 100, direction: 'OUT', reason: 'lost' }]);
check('adjust OUT cannot exceed stock', !r.ok && r.error === 'Only ' + (a1Before + 2) + ' in stock for Bambu A1.', r);
r = await mgr('erpAdjustStock', [{ sku: 'prt-bam-a1-001', qty: 1, direction: 'OUT', reason: 'damaged' }]);
mv = (await moves(A1)).pop();
check('adjust OUT = ADJUST, no cost change', r.ok && r.result.direction === 'OUT' && mv.kind === 'ADJUST' && mv.direction === 'OUT' &&
  mv.operator === 'Mehedi' && (await stockOf(A1)) === a1Before + 1, [r, mv]);
r = await mgr('erpAdjustStock', [{ sku: 'NOPE', qty: 1, direction: 'OUT', reason: 'x' }]);
check('adjust unknown', !r.ok && r.error === 'Product not found: NOPE', r);

// ============================================================ history
r = await mgr('erpStockHistory', [60]);
check('history newest first', r.ok && r.result[0].type === 'ADJUST' && r.result[0].dir === 'OUT' && r.result[0].sku === A1 &&
  r.result[0].ref === 'damaged' && r.result[0].by === 'Mehedi' && /^\d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d{2} (AM|PM)$/.test(r.result[0].date), r.result && r.result[0]);
r = await mgr('erpStockHistory', [2]);
check('history limit', r.ok && r.result.length === 2, r);
r = await sales('erpBundle', [['history']]);
check('bundle history part runs (as original)', r.ok && Array.isArray(r.result.history), r.result && r.result.errors);

// ============================================================ To-order plan
r = await mgr('erpReorderPlan', [{}]);
let row = r.ok && r.result.rows.find((x) => x.sku === PETG);
// PETG: 90 sold in 90 days = 1/day, lead 7 (catalogue default), target 1 x (7 + 30 + 3.5) = 40.5, stock 5 -> 36
// landed 50 x 18 (the rate just saved) + 30 default handling = 930
check('plan: PETG needs 36, urgent, landed 930', row && row.need === 36 && row.urgent === true && row.cover === 5 && row.lead === 7 &&
  row.unitCost === 930 && row.cost === 33480 && row.perMonth === 30 && row.coming === 0 &&
  row.why === 'runs out in 5 days, 7 days before a shipment could land', row);
check('plan totals', r.result.cycleDays === 30 && r.result.leadDays === 60 && r.result.count === r.result.rows.length &&
  r.result.urgent >= 1 && /^\d{1,2} [A-Z][a-z]{2} \d{2}, /.test(r.result.generatedAt), r.result);
check('never-sold products are left out', !r.result.rows.find((x) => x.sku === A1));
r = await sales('erpReorderPlan', [{}]);
check('plan is manager+', !r.ok);

// ============================================================ purchase orders
const po = (pl) => mgr('erpPoCreate', [{ shipBy: 'Sea', rate: 17.5, note: '', supplier: 'Sunlu Direct', ...pl }]);
r = await po({ shipBy: 'Boat', lines: [{ sku: PLA, qty: 1 }] });
check('PO: sea or air', !r.ok && r.error === 'By sea or by air?', r);
r = await po({ rate: 2000, lines: [{ sku: PLA, qty: 1 }] });
check('PO: silly rate', !r.ok && r.error === 'That rate looks wrong (2000 TK per RMB).', r);
r = await po({ lines: [{ sku: PLA, qty: 0 }] });
check('PO: nothing ordered', !r.ok && r.error === 'Choose at least one product with a quantity.', r);
r = await po({ lines: [{ sku: PLA, qty: 1 }, { sku: 'fil-sun-pla-bla-001', qty: 2 }] });
check('PO: twice', !r.ok && r.error === 'Sunlu PLA Black is on the order twice.', r);
r = await po({ lines: [{ sku: 'NOPE', qty: 1 }] });
check('PO: unknown', !r.ok && r.error === 'Product not found: NOPE', r);
r = await po({ rate: 0, lines: [{ sku: PLA, qty: 1, rmbUnit: 5 }] });
check('PO: priced needs a rate', !r.ok && r.error === 'Enter the rate you paid (TK per RMB), so the prices can be turned into cost.', r);
r = await po({ lines: [{ sku: PLA, qty: 1, rmbUnit: -1 }] });
check('PO: negative price', !r.ok && r.error === 'A price cannot be negative.', r);
r = await po({ lines: [{ isNew: true, qty: 1, product: { product_name: '' } }] });
check('PO: new needs a name', !r.ok && r.error === 'A new product needs a name.', r);
r = await po({ lines: [{ isNew: true, qty: 1, product: { product_name: 'x', sku: PETG } }] });
check('PO: new SKU clash', !r.ok && r.error === 'SKU already exists: ' + PETG, r);
r = await sales('erpPoCreate', [{ lines: [{ sku: PLA, qty: 1 }] }]);
check('PO: sales refused', !r.ok && /does not have permission/.test(r.error), r);

r = await po({ lines: [{ sku: PETG, qty: 20, rmbUnit: 50 }, { sku: PLA, qty: 10, rmbUnit: 40 },
  { isNew: true, qty: 5, rmbUnit: 60, product: { product_name: 'Sunlu Silk Gold', category: 'Filaments', brand: 'Sunlu', type: 'Silk', color: 'Gold' } }] });
const po1 = r.ok && r.result.poId;
check('PO created: id, units, rmb, new product', r.ok && /^PO-\d{6}-\d{4}$/.test(po1) && r.result.units === 35 &&
  r.result.rmb === 1700 && r.result.lines === 3 && r.result.created[0] === 'FIL-SUN-SILK-GOL-001', r);
p = await prod('FIL-SUN-SILK-GOL-001');
check('PO new product: lead 60, nothing in stock', p && p.lead_time_days === 60 && (await stockOf('FIL-SUN-SILK-GOL-001')) === 0, p);
r = await mgr('erpPoCreate', [{ shipBy: 'Air', rate: 0, supplier: '', lines: [{ sku: A1, qty: 1 }] }]);
const po2 = r.ok && r.result.poId;
check('second order in the same minute gets its own id (fix)', r.ok && po2 !== po1 &&
  (po2.slice(0, 14) !== po1 || po2 === po1 + '-2'), [po1, po2]);
const lines1 = await sql`select * from po_lines where business_id = ${B} and po_no = ${po1} order by seq`;
check('PO rows: open, by, rmb, rate, supplier', lines1.length === 3 && lines1.every((l) => l.status === 'open' &&
  l.ordered_by === 'Mehedi' && l.rmb_rate === 17.5 && l.supplier === 'Sunlu Direct' && l.ship_by === 'Sea') && lines1[0].rmb_unit === 50, lines1);

r = await mgr('erpPoList', []);
let o1 = r.ok && r.result.orders.find((o) => o.id === po1);
check('PO list: order 1', o1 && o1.lines.length === 3 && o1.rate === 17.5 && o1.rmb === 1700 && o1.left === 35 && o1.days === 0 &&
  o1.when === formatDate(new Date(), 'd MMM yyyy') && o1.supplier === 'Sunlu Direct' && o1.shipBy === 'Sea' && o1.boxes.length === 0, o1);
check('PO list: two orders, nothing to decide', r.result.orders.length === 2 && r.result.differences.length === 0 && r.result.balances.length === 0, r.result);
r = await mgr('erpReorderPlan', [{}]);
row = r.result.rows.find((x) => x.sku === PETG);
check('plan counts what is on the way: 36 - 20 = 16', row && row.coming === 20 && row.need === 16, row);

// arrival
const arrive = (pl) => mgr('erpPoArrive', [{ poId: po1, lines: [], extras: [], shipment: { no: 'SHIP-1', agent: 'Karim', by: 'Sea', kg: 10, shippingBdt: 2500, date: '2026-09-30' }, ...pl }]);
r = await arrive({ poId: 'PO-X' });
check('arrive: unknown order', !r.ok && r.error === 'No open order called PO-X.', r);
r = await arrive({ lines: [{ sku: 'NOPE', qty: 1 }] });
check('arrive: not on the order', !r.ok && r.error === 'NOPE is not on order ' + po1 + '.', r);
r = await arrive({ extras: [{ sku: PETG, qty: 1 }] });
check('arrive: an ordered product as an extra', !r.ok && r.error === 'Sunlu PETG White is on the order: type what came on its own line.', r);
r = await arrive({});
check('arrive: nothing typed', !r.ok && r.error === 'Type what arrived on at least one line.', r);
r = await arrive({ lines: [{ sku: PETG, qty: 1 }], shipment: { shippingBdt: -1 } });
check('arrive: negative shipping', !r.ok && r.error === 'Shipping cannot be negative.', r);

const plaCostBefore = (await prod(PLA)).cost_price;
r = await arrive({ lines: [{ sku: PETG, qty: 20 }, { sku: PLA, qty: 12 }],
  extras: [{ sku: A1, name: 'Bambu A1', qty: 1, rmbUnit: 100 }, { isNew: true, qty: 2, rmbUnit: 0, product: { product_name: 'Free Scraper' } }] });
// unit = rmb x 17.5: PETG 875, PLA 700, A1 1750; the scraper has no price -> price book Uncategorised 105
const W = { petg: 875 * 20, pla: 700 * 12, a1: 1750, scr: 105 * 2 }, SW = W.petg + W.pla + W.a1 + W.scr;
const cPetg = r2(875 + 2500 * W.petg / SW / 20), cPla = r2(700 + 2500 * W.pla / SW / 12);
check('arrive: received, shipping shared by value', r.ok && r.result.units === 35 && r.result.shipping === 2500 &&
  r.result.differences === 3 && r.result.stillToCome === 5 && r.result.shortLines === 0 && r.result.created.length === 1 &&
  r.result.lines.find((l) => l.sku === PETG).unitCost === cPetg && r.result.lines.find((l) => l.sku === PLA).unitCost === cPla, [r, cPetg, cPla]);
mv = (await moves(PETG)).pop();
check('arrive: movement note and reference', mv.reference === 'SHIP-1' &&
  mv.note === 'priced on the order @ 17.5 TK/RMB | shipping TK 2500 (agent Karim, 10 kg) | order ' + po1, mv);
const after1 = await sql`select sku, received, status from po_lines where po_no = ${po1} order by seq`;
check('arrive: received capped at the order, still open', after1[0].received === 20 && after1[1].received === 10 &&
  after1[2].received === 0 && after1.every((l) => l.status === 'open'), after1);
r = await mgr('erpPoList', []);
o1 = r.result.orders.find((o) => o.id === po1);
check('box recorded', o1 && o1.boxes.length === 1 && o1.boxes[0].on === '2026-09-30' && o1.boxes[0].no === 'SHIP-1' &&
  o1.boxes[0].units === 35 && o1.boxes[0].shipping === 2500 && o1.boxes[0].kg === 10 && o1.left === 5, o1);
const D = r.result.differences;
const dPla = D.find((d) => d.sku === PLA), dA1 = D.find((d) => d.sku === A1), dScr = D.find((d) => d.product === 'Free Scraper');
check('differences: extra PLA 2 (RMB 80), wrong A1 (RMB 100), wrong scraper', D.length === 3 && dPla && dPla.kind === 'extra' && dPla.qty === 2 &&
  dPla.rmb === 80 && dA1 && dA1.kind === 'wrong' && dA1.rmb === 100 && dScr && dScr.kind === 'wrong' && dScr.qty === 2 &&
  /^D\d{12}-\d+$/.test(dPla.id) && new Set(D.map((d) => d.id)).size === 3, D);
const dPlaRow = (await sql`select * from po_diffs where diff_no = ${dPla.id}`)[0];
check('difference carries the landed unit cost', dPlaRow.unit_bdt === cPla && dPlaRow.status === 'open' && dPlaRow.supplier === 'Sunlu Direct', dPlaRow);

// decisions
r = await mgr('erpPoDiffDecide', [{ diffId: dA1.id, decision: 'maybe' }]);
check('decide: bad decision', !r.ok && r.error === 'Pay for it, keep it free, or hand it back?', r);
r = await mgr('erpPoDiffDecide', [{ diffId: 'D0', decision: 'pay' }]);
check('decide: unknown', !r.ok && r.error === 'That difference was not found.', r);
r = await mgr('erpPoDiffDecide', [{ diffId: dA1.id, decision: 'pay' }]);
check('decide: pay -> i_owe', r.ok && r.result.status === 'i_owe' && r.result.note === '', r);
r = await mgr('erpPoDiffDecide', [{ diffId: dA1.id, decision: 'pay' }]);
check('decide: only once', !r.ok && r.error === 'That one has already been decided.', r);
const plaNow = (await prod(PLA)).cost_price, plaHave = await stockOf(PLA);
r = await mgr('erpPoDiffDecide', [{ diffId: dPla.id, decision: 'free' }]);
const freeCost = Math.max(0, r2((plaNow * plaHave - 2 * cPla) / plaHave));
check('decide: free bonus lowers the average', r.ok && r.result.status === 'free' && (await prod(PLA)).cost_price === freeCost &&
  r.result.note === 'average cost ' + plaNow + ' -> ' + freeCost && plaCostBefore !== plaNow, [r, freeCost]);
const scrSku = (await sql`select sku from po_diffs where diff_no = ${dScr.id}`)[0].sku;
r = await mgr('erpPoDiffDecide', [{ diffId: dScr.id, decision: 'return' }]);
mv = (await moves(scrSku)).pop();
check('decide: return takes it out of stock', r.ok && r.result.status === 'returned' && r.result.note === 'taken out of stock' &&
  (await stockOf(scrSku)) === 0 && mv.kind === 'ADJUST' && mv.reference === 'not ordered - handed back to the supplier (' + po1 + ')', [r, mv]);

// will not come
r = await mgr('erpPoLineClose', [{ poId: po1, sku: PETG, reason: 'x' }]);
check('line close: nothing left on that line', !r.ok && r.error === 'Nothing is still to come on that line.', r);
r = await mgr('erpPoLineClose', [{ poId: 'PO-X', sku: PETG }]);
check('line close: unknown order', !r.ok && r.error === 'No open order called PO-X.', r);
r = await mgr('erpPoLineClose', [{ poId: po1, sku: 'fil-sun-silk-gol-001', reason: 'factory out of stock' }]);
check('line close: supplier owes RMB 300', r.ok && r.result.owed === 300 && r.result.sku === 'FIL-SUN-SILK-GOL-001', r);
const silk = (await sql`select status, closed_at from po_lines where po_no = ${po1} and sku = 'FIL-SUN-SILK-GOL-001'`)[0];
check('line close: status closed: why', silk.status === 'closed: factory out of stock' && silk.closed_at, silk);
r = await mgr('erpPoList', []);
const bal = r.result.balances.find((b) => b.supplier === 'Sunlu Direct');
check('balances: owes 300, you owe 100, net 200', bal && bal.owesYou === 300 && bal.youOwe === 100 && bal.net === 200 && bal.items.length === 2 &&
  bal.items.some((i) => i.what === 'did not come' && i.qty === 5) && bal.items.some((i) => i.what === 'extra kept'), bal);
check('order 1 no longer listed (nothing left to come)', !r.result.orders.find((o) => o.id === po1), r.result.orders.map((o) => o.id));

// nothing more is coming
r = await mgr('erpPoClose', [{ poId: po2, reason: ' ' }]);
check('close: why', !r.ok && r.error === 'Say why the rest is not coming.', r);
r = await mgr('erpPoClose', [{ poId: po2, reason: 'cancelled' }]);
check('close order 2', r.ok && r.result.poId === po2, r);
r = await mgr('erpPoClose', [{ poId: po2, reason: 'again' }]);
check('close: already closed', !r.ok && r.error === 'No open order called ' + po2 + '.', r);
r = await mgr('erpPoList', []);
check('unnamed supplier balance', r.result.balances.some((b) => b.supplier === '(no supplier named)' && b.owesYou === 0 && b.items.length === 1), r.result.balances);

// settle
r = await mgr('erpPoSettle', [{ supplier: 'Sunlu Direct', note: 'refunded' }]);
check('settle: manager refused', !r.ok && /does not have permission/.test(r.error), r);
r = await shareholder('erpPoSettle', [{ supplier: 'Sunlu Direct', note: '' }]);
check('settle: how', !r.ok && r.error === 'Say how it was settled.', r);
r = await shareholder('erpPoSettle', [{ supplier: 'sunlu direct', note: 'refunded' }]);
check('settle: both items', r.ok && r.result.settled === 2, r);
const sNote = (await sql`select note from po_diffs where business_id = ${B} and kind = 'short' and po_no = ${po1}`)[0].note;
check('settle note appended', sNote === 'factory out of stock | settled: refunded', sNote);
r = await shareholder('erpPoSettle', [{ supplier: 'Sunlu Direct', note: 'again' }]);
check('settle: nothing left', !r.ok && r.error === 'Nothing is outstanding with that supplier.', r);
r = await shareholder('erpPoSettle', [{ supplier: '(no supplier named)', note: 'written off' }]);
check('settle the unnamed supplier (fix)', r.ok && r.result.settled === 1, r);
r = await mgr('erpPoList', []);
check('no balances left', r.result.balances.length === 0, r.result.balances);

// an order that completes closes itself
r = await po({ rate: 17, lines: [{ sku: PLA, qty: 2, rmbUnit: 40 }] });
const po3 = r.result.poId;
r = await mgr('erpPoArrive', [{ poId: po3, lines: [{ sku: PLA, qty: 2 }], extras: [], shipment: { shippingBdt: 0 } }]);
const l3 = (await sql`select status, received, closed_at from po_lines where po_no = ${po3}`)[0];
check('complete order -> arrived', r.ok && r.result.stillToCome === 0 && r.result.differences === 0 && l3.status === 'arrived' &&
  l3.received === 2 && l3.closed_at, [r, l3]);
mv = (await moves(PLA)).pop();
check('no shipment no: reference "PO-id / d MMM yyyy"', mv.reference === po3 + ' / ' + formatDate(new Date(), 'd MMM yyyy') && mv.unit_price === 680, mv);

// ============================================================ reorder levels
r = await mgr('erpApplyReorderLevels', [false]);
check('reorder levels: manager refused', !r.ok && /does not have permission/.test(r.error), r);
const cat = (await shareholder('erpCatalog', [])).result;
const raw = await sql`select sku, reorder_level from products where business_id = ${B}`;
const expect = raw.filter((x) => { const c = cat.find((p) => p.sku === x.sku); return c && c.suggested !== x.reorder_level; }).length;
r = await shareholder('erpApplyReorderLevels', [false]);
check('preview: changes counted, nothing written', r.ok && r.result.applied === false && r.result.changed === expect && expect > 0 &&
  r.result.raised + r.result.lowered === expect && (await prod(PETG)).reorder_level === 0, [r, expect]);
const petgPrev = r.result.preview.find((x) => x.sku === PETG);
check('preview row', petgPrev && petgPrev.from === 0 && petgPrev.to === cat.find((p) => p.sku === PETG).suggested, petgPrev);
r = await shareholder('erpApplyReorderLevels', [true]);
check('apply writes the suggested level', r.ok && r.result.applied === true && (await prod(PETG)).reorder_level === petgPrev.to &&
  (await prod('FIL-SUN-PLA+-WHI-001')).reorder_level === 0, r);
r = await shareholder('erpApplyReorderLevels', [false]);
check('after apply nothing to change', r.ok && r.result.changed === 0, r);

r = await recv({ reference: ' ', from: 'local', lines: [{ sku: PLA, qty: 1 }] });
check('a local buy needs no reference: one is made for it', r.ok && /^Bought locally \d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(r.result.reference), r);
await done();
