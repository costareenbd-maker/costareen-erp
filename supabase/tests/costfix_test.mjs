// cost-fix-1 (27 Oct 2026): the goods total typed again as the shipping doubled every unit's cost. (1) The receive
// asks first when shipping is half the goods or more; (2) a shipment cost can be struck out - the lots, the draws and
// the cost fixed on the sale lines follow.
import { sql, FIX, owner, mgr, check, done } from './harness.mjs';
const B = FIX.B, C = { name: 'Cost Fix', phone: '01755500077' };
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, unit) values
  (${B}, 'CF-A', 'Cost A', 'Filaments', 'T', 'PLA', 0, 1600, 'Active', 'Piece'), (${B}, 'CF-B', 'Cost B', 'Filaments', 'T', 'PLA', 0, 1600, 'Active', 'Piece')`;

// ---- 1. the goods total typed again as shipping is asked about
let r = await mgr('erpReceiveShipment', [{ reference: 'CF-1', supplier: 'Local Dealer', mode: 'bdt', totalBdt: 10000, payment: 'later',
  shippingBdt: 10000, shipNote: 'total', lines: [{ sku: 'CF-A', qty: 5 }, { sku: 'CF-B', qty: 5 }] }]);
check('(cost-fix) shipping as big as the goods is asked about first', !r.ok && /^CONFIRM: /.test(r.error) && /typed again/.test(r.error), r);
r = await mgr('erpReceiveShipment', [{ reference: 'CF-1', supplier: 'Local Dealer', mode: 'bdt', totalBdt: 10000, payment: 'later',
  shippingBdt: 10000, shipNote: 'total', again: true, lines: [{ sku: 'CF-A', qty: 5 }, { sku: 'CF-B', qty: 5 }] }]);
check('(cost-fix) ...and goes through when confirmed: 2,000 a unit (1,000 goods + 1,000 shipping)', r.ok && r.result.lines.every((l) => Math.abs(l.unitCost - 2000) < 0.05), r);
r = await mgr('erpReceiveShipment', [{ reference: 'CF-2', supplier: 'Local Dealer', mode: 'bdt', totalBdt: 10000, payment: 'later', shippingBdt: 800,
  lines: [{ sku: 'CF-A', qty: 1 }] }]);
check('(cost-fix) ordinary shipping is not asked about', r.ok, r);

// ---- 2. a sale drew from the doubled lot
r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'CF-A', qty: 2 }], payMode: 'none' }]);
check('(cost-fix) sold 2 at the doubled cost', r.ok, r);
const INV = r.result.invoiceNo;
let line = (await sql`select il.unit_cost from invoice_lines il join invoices i on i.id = il.invoice_id where i.business_id = ${B} and i.invoice_no = ${INV} and il.sku = 'CF-A'`)[0];
check('(cost-fix) the sale line carries 2,000 a unit', line && Math.abs(Number(line.unit_cost) - 2000) < 0.05, line);

// ---- 3. strike the wrong shipping out
r = await owner('erpShipment', [{ reference: 'CF-1' }]);
const freight = r.ok && r.result.extra.find((x) => /Freight/.test(x.label));
check('(cost-fix) the shipment page lists the freight with its id', freight && freight.id && !freight.voided, r.ok ? r.result.extra : r.error);
r = await mgr('erpShipmentCostVoid', [{ reference: 'CF-1', id: freight.id, reason: '' }]);
check('(cost-fix) a reason is needed', !r.ok && /why/i.test(r.error), r);
r = await mgr('erpShipmentCostVoid', [{ reference: 'CF-1', id: freight.id, reason: 'goods total typed again' }]);
check('(cost-fix) struck out: 10,000 off, 2 units sold + 8 on the shelf', r.ok && r.result.amount === 10000 && r.result.offShelf === 8000 && r.result.offSold === 2000 && r.result.invoices.includes(INV), r);
const lots = await sql`select p.sku, l.unit_cost, l.qty_left from stock_lots l join products p on p.id = l.product_id where l.business_id = ${B} and l.reference = 'CF-1' order by p.sku`;
check('(cost-fix) every lot of the shipment is back to 1,000 a unit', lots.length === 2 && lots.every((l) => Math.abs(Number(l.unit_cost) - 1000) < 0.05), lots);
line = (await sql`select il.unit_cost from invoice_lines il join invoices i on i.id = il.invoice_id where i.business_id = ${B} and i.invoice_no = ${INV} and il.sku = 'CF-A'`)[0];
check('(cost-fix) the sale line now carries 1,000 a unit', line && Math.abs(Number(line.unit_cost) - 1000) < 0.05, line);
const dr = await sql`select d.unit_cost from lot_draws d join stock_lots l on l.id = d.lot_id where l.business_id = ${B} and l.reference = 'CF-1'`;
check('(cost-fix) the draws from the shipment say 1,000 too', dr.length === 1 && Math.abs(Number(dr[0].unit_cost) - 1000) < 0.05, dr);
r = await owner('erpShipment', [{ reference: 'CF-1' }]);
check('(cost-fix) the page shows it struck out, with the reason', r.ok && /struck out .*goods total typed again/.test(r.result.extra.find((x) => /Freight/.test(x.label)).voided), r.ok ? r.result.extra : r.error);
r = await mgr('erpShipmentCostVoid', [{ reference: 'CF-1', id: freight.id, reason: 'again' }]);
check('(cost-fix) not twice', !r.ok && /already/.test(r.error), r);

done();
