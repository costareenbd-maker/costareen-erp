// Phase 3: product page, price/cost history, stock count.
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001', A1 = 'PRT-BAM-A1-001';

// make some history: a sale, a price change by the manager, a cost change by a receipt
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full' }]);
const INV = r.result.invoiceNo;
r = await mgr('erpSaveProduct', [{ sku: PLA, product_name: 'Sunlu PLA Black', category: 'Filaments', brand: 'Sunlu', type: 'PLA', color: 'Black', unit: 'Roll', sell_price: 1400, reorder_level: 5, lead_time_days: 7, status: 'Active' }]);
check('fixture: manager changed the price', r.ok, r);
r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-1', mode: 'bdt', totalBdt: 10000, lines: [{ sku: PLA, qty: 10 }] }]);
check('fixture: shipment received', r.ok, r);

// ---- product page ----
r = await sales('erpProductPage', [{ sku: '' }]);
check('product: which product?', !r.ok && r.error === 'Which product?', r);
r = await sales('erpProductPage', [{ sku: 'NOPE' }]);
check('product: unknown', !r.ok && r.error === 'That product is no longer on the list.', r);
r = await owner('erpProductPage', [{ sku: PLA.toLowerCase() }]);
const P = r.result;
check('product page: found case-insensitively, basics', r.ok && P.sku === PLA && P.name === 'Sunlu PLA Black' && P.sell === 1400 && P.category === 'Filaments', P);
check('product page: stock = ledger (7 - 2 + 10 = 15), totals in/out', P.stock === 15 && P.totalIn - P.totalOut === 15, [P.stock, P.totalIn, P.totalOut]);
check('product page: ledger newest first with running balance', P.ledger[0].what === 'Received' && P.ledger[0].after === 15 && P.ledger[0].qty === 10 &&
  P.ledger[1].what === 'Sold' && P.ledger[1].invoice === INV && P.ledger[1].after === 5, P.ledger.slice(0, 3));
check('product page: owner sees cost, margin, stock at cost, receipt cost', P.canSeeMoney && P.cost > 0 && P.margin !== undefined && P.stockValueCost > 0 && P.ledger[0].price === 1000, [P.cost, P.margin, P.ledger[0]]);
check('product page: 12 months, this month has the sale', P.months.length === 12 && P.months[11].units >= 2, P.months.slice(-2));
check('product page: recent sales link to invoices', P.sales[0].invoice === INV && P.sales[0].qty === 2 && P.sales[0].price === 1350, P.sales[0]);
const fields = P.changes.map((c) => c.field);
const sp = P.changes.find((c) => c.field === 'Selling price') || {};
check('product page: price and cost changes recorded with who', fields.includes('Selling price') && fields.includes('Cost') &&
  sp.was === '1350' && sp.now === '1400' && sp.by === 'Mehedi', P.changes);
await sql`update memberships set powers = '{"costs": false}'::jsonb where business_id = ${FIX.B} and user_id = ${FIX.U.mgr}`;   // since 058 a manager has Product cost unless switched off
r = await mgr('erpProductPage', [{ sku: PLA }]);
check('manager: no cost, margin, stock value at cost, receipt cost or cost changes', r.ok && !r.result.canSeeMoney && !('cost' in r.result) && !('margin' in r.result) &&
  !('stockValueCost' in r.result) && r.result.ledger[0].price === null && !r.result.changes.some((c) => c.field === 'Cost') && 'supplier' in r.result, r.result);
await sql`update memberships set powers = '{}'::jsonb where business_id = ${FIX.B} and user_id = ${FIX.U.mgr}`;
r = await sales('erpProductPage', [{ sku: PLA }]);
check('sales: no supplier either, sale prices still shown', r.ok && !('supplier' in r.result) && r.result.ledger[0].supplier === '' && r.result.ledger[1].price === 1350 &&
  !JSON.stringify(r.result).match(/"cost"|margin|stockValueCost/), Object.keys(r.result || {}));
r = await owner('erpProductPage', [{ sku: 'X-OTHER' }]);
check('a product of another business cannot be opened', !r.ok, r);

// ---- stock count ----
r = await sales('erpStockCount', [{ lines: [{ sku: PLA, counted: 1 }] }]);
check('sales cannot count stock', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await mgr('erpStockCount', [{ lines: [] }]);
check('count: nothing typed', !r.ok && r.error === 'Type what you counted for at least one product.', r);
r = await mgr('erpStockCount', [{ lines: [{ sku: PLA, counted: -1 }] }]);
check('count: negative refused', !r.ok && r.error === PLA + ': the count must be a whole number, 0 or more.', r);
r = await mgr('erpStockCount', [{ lines: [{ sku: PLA, counted: 3 }, { sku: PLA.toLowerCase(), counted: 4 }] }]);
check('count: same product twice refused', !r.ok && / is in the count twice\.$/.test(r.error), r);
r = await mgr('erpStockCount', [{ lines: [{ sku: PLA, counted: 12 }, { sku: 'NOPE', counted: 1 }] }]);
check('count: unknown product refuses the whole count', !r.ok && r.error === 'Product not found: NOPE', r);
check('...and nothing was written', (await owner('erpProductPage', [{ sku: PLA }])).result.stock === 15);
r = await mgr('erpStockCount', [{ note: 'shelf B', lines: [{ sku: PLA, counted: 12 }, { sku: A1, counted: 3 }, { sku: 'x-unused', counted: '' }] }]);
check('count: one short, one agrees, blank ignored', r.ok && r.result.checked === 2 && r.result.same === 1 && r.result.changed === 1 && r.result.down === 3 && r.result.up === 0 &&
  r.result.lines[0].was === 15 && r.result.lines[0].now === 12, r.result);
r = await owner('erpProductPage', [{ sku: PLA }]);
const L0 = r.result.ledger[0];
check('count: books now say 12, ledger explains it', r.result.stock === 12 && L0.what === 'Adjusted' && L0.dir === 'OUT' && L0.qty === 3 &&
  /^Stock count /.test(L0.ref) && L0.note === 'counted 12, books said 15 · shelf B' && L0.by === 'Mehedi', L0);
r = await mgr('erpStockCount', [{ lines: [{ sku: A1, counted: 5 }] }]);
check('count: found more than the books', r.ok && r.result.up === 2 && (await owner('erpProductPage', [{ sku: A1 }])).result.stock === 5, r.result);
r = await mgr('erpStockCount', [{ lines: [{ sku: PLA, counted: 0 }] }]);
check('count: zero is a real count', r.ok && r.result.down === 12 && (await sales('erpCatalog', [])).result.find((p) => p.sku === PLA).state === 'out', r.result);
const other = await sql`select count(*)::int n from stock_movements m join products p on p.id = m.product_id where p.business_id = ${FIX.B2}`;
check('nothing written to another business', other[0].n === 0);

await done();
