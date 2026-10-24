// fix-1 (24 Oct 2026): the partner's odd-case report, batch 1 - stock and returns. Each check is a case from the report
// (H1-H5, M1-M4, M6, M7) that went wrong before and must now come out right.
import { sql, FIX, owner, mgr, check, done } from './harness.mjs';

const B = FIX.B;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;
const C = { name: 'Odd Case', phone: '01755500011' };
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, weight_g) values
  (${B}, 'FX-1', 'Fix One', 'Filaments', 'T', 'PLA', 0, 500, 'Active', 1000),
  (${B}, 'FX-2', 'Fix Two', 'Filaments', 'T', 'PLA', 0, 900, 'Active', 1000),
  (${B}, 'FX-3', 'Fix Three', 'Filaments', 'T', 'PLA', 0, 900, 'Active', 1000),
  (${B}, 'FX-4', 'Fix Four', 'Filaments', 'T', 'PLA', 0, 300, 'Active', 1000),
  (${B}, 'FX-5', 'Fix Five', 'Printers', 'T', 'FDM', 0, 50000, 'Active', 9000),
  (${B}, 'FX-6', 'Fix Six', 'Filaments', 'T', 'PLA', 0, 300, 'Active', 1000),
  (${B}, 'FX-7', 'Fix Seven', 'Filaments', 'T', 'PLA', 0, 300, 'Active', 1000)`;
await sql`update products set serialised = true where business_id = ${B} and sku = 'FX-5'`;
const recv = (ref, sku, qty, unit, extra) => mgr('erpReceiveShipment', [{ reference: ref, supplier: 'Dragon', mode: 'none', lines: [{ sku, qty, unitBdt: unit, ...(extra || {}) }] }]);
const sell = (sku, qty, more) => mgr('erpCreateInvoice', [{ customer: C, items: [{ sku, qty }], payMode: 'full', ...(more || {}) }]);
const lineCost = async (no, sku) => Number((await sql`select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${B} and i.invoice_no = ${no} and l.sku = ${sku} order by l.line_no limit 1`)[0].unit_cost);
const stock = async (sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${B} and p.sku = ${sku}`)[0].s);
const back = (no, sku, qty) => owner('erpReturnGoods', [{ invoiceNo: no, lines: [{ sku, qty, condition: 'good' }], reason: 'test', money: 'refund', method: 'Cash' }]);

// ---- H1: a late cost is not counted twice on units that come back
let r = await recv('FX1-S', 'FX-1', 10, 100);
check('(H1) 10 in at 100', r.ok, r);
r = await sell('FX-1', 5); const A1 = r.result.invoiceNo;
r = await mgr('erpShipmentLateCost', [{ reference: 'FX1-S', label: 'Duty', amount: 1000, basis: 'units' }]);
check('(H1) a 1000 duty bill arrives after 5 were sold: 500 of it is cost of sales now, the 5 left now cost 200', r.ok && near(r.result.soldPart, 500), r.result);
r = await back(A1, 'FX-1', 5);
check('(H1) the 5 sold come back', r.ok, r);
const lots = await sql`select l.unit_cost::float as c, l.qty_left::float as q, l.source from stock_lots l join products p on p.id = l.product_id where p.business_id = ${B} and p.sku = 'FX-1' and l.qty_left > 0 order by l.received_at, l.seq`;
check('(H1) they come back at the 100 they left at (their own lot), not at 200', lots.some((l) => near(l.c, 100) && l.q === 5) && lots.some((l) => near(l.c, 200) && l.q === 5), lots);
r = await sell('FX-1', 10); const A2 = r.result.invoiceNo;
const total = 5 * 100 - 5 * 100 + 500 + 10 * (await lineCost(A2, 'FX-1'));
check('(H1) all sold: cost of the 10 units = 2000 (10 x 100 + the 1000 duty), not 2500', near(total, 2000), { total, sale2: await lineCost(A2, 'FX-1') });

// ---- H2: a return from two lots takes back the cost of the very units put back
await recv('FX2-a', 'FX-2', 2, 100);
await new Promise((ok) => setTimeout(ok, 20));
await recv('FX2-b', 'FX-2', 2, 500);
r = await sell('FX-2', 3); const B1 = r.result.invoiceNo;
check('(H2) 3 sold from two lots: average 233.33', near(await lineCost(B1, 'FX-2'), 233.33), await lineCost(B1, 'FX-2'));
r = await back(B1, 'FX-2', 1);
const rtn = r.result.returnId;
check('(H2) 1 back: the newest unit (500) goes back on the shelf, and the return takes back 500 of cost - not 233.33', r.ok && near(await lineCost(rtn, 'FX-2'), 500), await lineCost(rtn, 'FX-2'));

// ---- H3: undo a receipt takes its own units
await recv('FX3-a', 'FX-3', 10, 100);
await recv('FX3-b', 'FX-3', 10, 9999);
r = await mgr('erpReceipts', []); if (!r.ok) console.log('RECEIPTS', JSON.stringify(r).slice(0, 400));
const rc = r.result.find((x) => x.reference === 'FX3-b');
check('(H3) the receipts list shows the wrong one, all 10 can be undone', r.ok && rc && rc.canUndo === 10, rc);
r = await mgr('erpUndoReceipt', [{ txnNo: rc.txnNo, qty: 10, reason: 'typed 9999 by mistake' }]);
check('(H3) undone: the 10 at 9999 come off, the supplier bill is lowered by 99,990', r.ok && r.result.undone === 10 && near(r.result.billCredit, 99990), r.result || r);
r = await sell('FX-3', 1);
check('(H3) the next sale costs 100 (the right lot stayed), not 9999', near(await lineCost(r.result.invoiceNo, 'FX-3'), 100), await lineCost(r.result.invoiceNo, 'FX-3'));
const bills = Number((await sql`select coalesce(sum(amount), 0)::float as s from supplier_bills where business_id = ${B} and reference = 'FX3-b' and coalesce(voided, '') = ''`)[0].s);
check('(H3) the supplier is owed nothing for the mistaken shipment', near(bills, 0), bills);
r = await mgr('erpUndoReceipt', [{ txnNo: rc.txnNo, qty: 1, reason: 'again' }]);
check('(H3) it cannot be undone twice', !r.ok, r);

// ---- H4: a return note is never voided
r = await owner('erpVoidInvoice', [rtn]);
check('(H4) voiding a return note (RTN-) is refused', !r.ok && /return note/.test(r.error), r);

// ---- H5: voiding an invoice removes only its own movements
await recv('FX4-a', 'FX-4', 5, 50);
r = await sell('FX-4', 1, { payMode: 'none' }); const D1 = r.result.invoiceNo;
await mgr('erpAdjustStock', [{ sku: 'FX-4', qty: 1, direction: 'OUT', reason: D1 }]);
check('(H5) after the sale and a broken unit written off (reason = the invoice number): 3', (await stock('FX-4')) === 3, await stock('FX-4'));
r = await owner('erpVoidInvoice', [D1]);
check('(H5) voiding the invoice brings back only its own unit: 4 (the broken one stays out)', r.ok && (await stock('FX-4')) === 4, [r.ok, r.error, await stock('FX-4')]);

// ---- M1: the same shipment twice is asked
r = await recv('DS-1', 'FX-6', 3, 100);
r = await recv('DS-1', 'FX-6', 3, 100);
check('(M1) receiving shipment DS-1 again is asked first', !r.ok && /^CONFIRM: Shipment "DS-1" was already received/.test(r.error), r);
r = await mgr('erpReceiveShipment', [{ reference: 'DS-1', supplier: 'Dragon', mode: 'none', again: true, lines: [{ sku: 'FX-6', qty: 1, unitBdt: 100 }] }]);
check('(M1) ...and goes through when the person says yes', r.ok && (await stock('FX-6')) === 4, r);

// ---- M2: no price below zero
r = await recv('FX-NEG', 'FX-6', 1, -100);
check('(M2) a receipt at -100 is refused', !r.ok && /below zero/.test(r.error), r);

// ---- M3: numbered units say which ones leave
r = await mgr('erpReceiveShipment', [{ reference: 'FX5-S', supplier: 'Dragon', mode: 'none', lines: [{ sku: 'FX-5', qty: 2, unitBdt: 30000, serials: ['SN-A1', 'SN-A2'] }] }]);
check('(M3) 2 printers in with serials', r.ok, r);
r = await mgr('erpAdjustStock', [{ sku: 'FX-5', qty: 1, direction: 'OUT', reason: 'dropped' }]);
check('(M3) taking one out asks which serial', !r.ok && /^SERIALS: 1\|Fix Five\|SN-A1,SN-A2/.test(r.error), r);
r = await mgr('erpAdjustStock', [{ sku: 'FX-5', qty: 1, direction: 'OUT', reason: 'dropped', serials: 'SN-A2' }]);
const sn = await sql`select serial, status from serials where business_id = ${B} and sku = 'FX-5' order by serial`;
check('(M3) with the serial: that unit is written off, the other stays for sale', r.ok && sn.find((x) => x.serial === 'SN-A2').status === 'damaged' && sn.find((x) => x.serial === 'SN-A1').status === 'in_stock', sn);
r = await mgr('erpStockCount', [{ lines: [{ sku: 'FX-5', counted: 0 }] }]);
check('(M3) a count cannot quietly lower a numbered product (write the unit off with its serial)', !r.ok && /numbered units/.test(r.error), r);

// ---- M4: pre-order holds are not written off quietly
const po = (await sql`insert into preorders (business_id, no, customer, phone, customer_key, status) values (${B}, 'PO-FX', 'Waiting Man', '01800000000', 'p:01800000000', 'open') returning id`)[0].id;
await sql`insert into preorder_lines (business_id, preorder_id, sku, name, qty, price, line_no) values (${B}, ${po}, 'FX-6', 'Fix Six', 3, 300, 1)`;
r = await mgr('erpAdjustStock', [{ sku: 'FX-6', qty: 2, direction: 'OUT', reason: 'lost' }]);
check('(M4) taking held units out is asked first', !r.ok && /^CONFIRM: 3 of Fix Six are held for pre-order PO-FX/.test(r.error), r);
r = await mgr('erpStockCount', [{ lines: [{ sku: 'FX-6', counted: 1 }] }]);
check('(M4) a count that leaves a pre-order short is asked first', !r.ok && /^CONFIRM: This count leaves pre-orders short/.test(r.error), r);
r = await mgr('erpStockCount', [{ lines: [{ sku: 'FX-6', counted: 1 }], overHold: true }]);
check('(M4) ...and saved when the person says yes', r.ok && (await stock('FX-6')) === 1, r);

// ---- M6: a hand adjustment that says "Return: INV-..." is not a customer return
await recv('FX7-a', 'FX-7', 4, 100);
r = await sell('FX-7', 2); const G1 = r.result.invoiceNo;
await mgr('erpAdjustStock', [{ sku: 'FX-7', qty: 1, direction: 'IN', reason: 'Return: ' + G1 }]);
const rev = Number((await sql`select coalesce(sum(d.reversed), 0)::float as s from lot_draws d join stock_movements m on m.id = d.movement_id join invoices i on i.id = m.invoice_id where i.business_id = ${B} and i.invoice_no = ${G1}`)[0].s);
check('(M6) the sale\'s draws stay as they were (nothing reversed by the hand adjustment)', rev === 0, rev);
r = await back(G1, 'FX-7', 2);
const rev2 = Number((await sql`select coalesce(sum(d.reversed), 0)::float as s from lot_draws d join stock_movements m on m.id = d.movement_id join invoices i on i.id = m.invoice_id where i.business_id = ${B} and i.invoice_no = ${G1}`)[0].s);
check('(M6) the real return then puts both units back into their own lot', r.ok && rev2 === 2, rev2);

// ---- M7: a sale dated in the past takes only what was on the shelf that day
const day = (n) => new Date(Date.now() + 6 * 3600e3 - n * 86400e3).toISOString().slice(0, 10);
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values (${B}, 'FX-8', 'Fix Eight', 'Filaments', 'T', 'PLA', 0, 300, 'Active')`;
await recv('FX8-a', 'FX-8', 2, 100);
await sql`update stock_lots set received_at = now() - interval '5 days' where business_id = ${B} and reference = 'FX8-a'`;
await new Promise((ok) => setTimeout(ok, 20));
await recv('FX8-b', 'FX-8', 2, 900);
r = await sell('FX-8', 3, { date: day(2) });
check('(M7) a sale dated 2 days ago is saved', r.ok, r);
const dr = await sql`select d.qty::float as q, d.unit_cost::float as c, d.at, l.received_at from lot_draws d join stock_lots l on l.id = d.lot_id
                     join stock_movements m on m.id = d.movement_id join invoices i on i.id = m.invoice_id where i.invoice_no = ${r.result.invoiceNo} order by l.received_at`;
check('(M7) it takes the 2 that were on the shelf that day first, then 1 from the later lot', dr.length === 2 && dr[0].q === 2 && dr[0].c === 100 && dr[1].q === 1 && dr[1].c === 900, dr);
check('(M7) the unit from the later lot counts as leaving on the day it arrived (no negative holding time)', dr.every((d) => new Date(d.at) >= new Date(d.received_at)), dr);

const other = await sql`select count(*)::int as n from stock_lots where business_id = ${FIX.B2} and reference like 'FX%'`;
check('the other business is untouched', other[0].n === 0, other);
await done();
