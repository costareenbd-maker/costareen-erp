// final-goods (10 Nov 2026): the goods area checked end to end on the awkward paths the owner named.
//  1. Joint stock with MANY products: the partner asks for 3 products, Costareen sends them as one parcel, the partner
//     confirms the whole parcel with one tap (erpJointGot requests[]), both companies sell joint lines on mixed invoices,
//     the pool mirrors stay right, and the month end still balances.
//  2. FIFO when a lot has no cost (a count-up lot): the sale takes the product's own cost, never 0, never a guess
//     that is lost; a sale from a no-cost product is kept out of profit (D1).
//  3. A struck-out shipment bill / cost is not summed anywhere (shipments, suppliers).
//  4. Receive from a file: a bad row is reported on its own row; a bad receive line refuses the whole receive.
//  5. Stock count: a huge count is refused plainly; a count twice of the same SKU is refused.
//  6. Negative stock on a sale is refused; serial numbers stay unique; a product with stock cannot be discontinued;
//     there is no product delete.
//  7. Excel import: the preview writes nothing; the stock column never changes stock.
//  8. A sales-role user never sees a cost figure on the goods calls; a manager without the Product cost ability sees
//     no landed cost on Shipments / Lots.
//  9. Supplier dues: the head figure equals the list sum, with an advance and an opening balance.
// 10. Market privacy: a listing never carries sku, cost or the stock number; the seller is "Supplier · city".
import { sql, FIX, owner, mgr, sales, check, done, deps, makeShareholder, shareholder } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));

const A = FIX.B, PLA = 'FIL-SUN-PLA-BLA-001', PRT = 'PRT-BAM-A1-001';
const near = (a, b, d = 0.011) => Math.abs(Number(a) - Number(b)) < d;

// ================================================================ 1. joint stock with many products, both companies
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partnerfinal@t.test', ${sql.json({ full_name: 'Proto Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner final test') as id`;
}))[0].id;
const proto = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;

let r = await owner('erpJointStart', [{ action: 'create', name: 'Final JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await proto('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner', tier: 'wholesale' }]);
for (const [sku, name, cost] of [['J1', 'JV PLA Red', 1000], ['J2', 'JV PLA Blue', 1200], ['J3', 'JV PETG Black', 1500]])
  await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku, name, category: 'Filament', retail: 2000, wholesale: 1800, floor: 1600, cost }]);
await owner('erpJointReceive', [{ pool: POOL, sku: 'J1', qty: 10, unitCost: 1000, paidBy: A }]);
await owner('erpJointReceive', [{ pool: POOL, sku: 'J2', qty: 10, unitCost: 1200, paidBy: A }]);
await owner('erpJointReceive', [{ pool: POOL, sku: 'J3', qty: 6, unitCost: 1500, paidBy: A }]);
await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 20000 }]);
await proto('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: B3, amount: 20000 }]);
const held = (res, sku) => (res.result.stock.find((s) => s.sku === sku) || {}).held || {};

// the partner asks for three products with mixed quantities in one go
r = await proto('erpJointAsk', [{ pool: POOL, note: 'for the fair', lines: [{ sku: 'J1', qty: 3 }, { sku: 'J2', qty: 5 }, { sku: 'J3', qty: 1 }] }]);
let asked = (r.result.requests || []).filter((x) => x.status === 'asked');
check('J1: one ask, three requests, each with its own quantity', r.ok && r.result.asked === 3 && asked.length === 3 &&
  asked.find((x) => x.sku === 'J2').qty === 5 && asked.every((x) => x.holder === 'Costareen' && x.note === 'for the fair'), r.error || asked);
// Costareen's sales staff answer with one parcel (delivered, one transport)
r = await sales('erpJointSend', [{ pool: POOL, how: 'delivered', cost: 300, lines: asked.map((x) => ({ request: x.id, qty: x.qty })) }]);
check('J2: the three requests go out as one parcel', r.ok && held(r, 'J1')[B3] === 3 && held(r, 'J2')[B3] === 5 && held(r, 'J3')[B3] === 1 &&
  held(r, 'J1')[A] === 7 && held(r, 'J3')[A] === 5 && r.result.moved.lines.length === 3, r.error || (r.result && r.result.moved));
let sent = r.result.requests.filter((x) => asked.some((a) => a.id === x.id));
check('J3: all three marked sent, transport written once', sent.every((x) => x.status === 'sent') && sent.reduce((t, x) => t + x.cost, 0) === 300, sent);
// the partner confirms the WHOLE parcel with one tap
r = await proto('erpJointGot', [{ pool: POOL, requests: sent.map((x) => x.id) }]);
let got = r.ok ? r.result.requests.filter((x) => asked.some((a) => a.id === x.id)) : [];
check('J4: one "Got it" for the whole parcel - all three received', r.ok && r.result.got === 3 && got.length === 3 && got.every((x) => x.status === 'received'), r.error || got);
r = await proto('erpJointGot', [{ pool: POOL, requests: sent.map((x) => x.id) }]);
check('J5: confirming again is refused plainly, naming the product', !r.ok && /is not on its way/.test(r.error), r.error);
r = await proto('erpJointGot', [{ pool: POOL, requests: [] }]);
check('J6: an empty confirmation is refused', !r.ok && /Which request/.test(r.error), r.error);
// a parcel of two, one already received: nothing is confirmed (all or none)
r = await proto('erpJointAsk', [{ pool: POOL, lines: [{ sku: 'J1', qty: 1 }, { sku: 'J2', qty: 1 }] }]);
const ask2 = r.result.requests.filter((x) => x.status === 'asked');
r = await sales('erpJointSend', [{ pool: POOL, lines: ask2.map((x) => ({ request: x.id })) }]);
check('J7: second parcel sent (collected, no transport)', r.ok && held(r, 'J1')[B3] === 4 && held(r, 'J2')[B3] === 6, r.error);
await proto('erpJointGot', [{ pool: POOL, request: ask2[0].id }]);
r = await proto('erpJointGot', [{ pool: POOL, requests: [ask2[0].id, ask2[1].id] }]);
const st2 = (await sql`select id, status from pool_requests where id = any(${ask2.map((x) => x.id)})`);
check('J8: one of two already received -> the whole confirmation is refused, the other stays "sent"', !r.ok && st2.find((x) => x.id === ask2[1].id).status === 'sent', [r.error, st2]);
r = await sales('erpJointGot', [{ pool: POOL, requests: [ask2[1].id] }]);
check('J9: the sending company cannot confirm for the asker', !r.ok && /company that asked/.test(r.error), r.error);
await proto('erpJointGot', [{ pool: POOL, requests: [ask2[1].id] }]);

// both companies sell joint lines on their own mixed invoices
r = await sales('erpJointCatalog', []);
const JS = {}; r.result.products.forEach((p) => { JS[p.sku.split('~')[0]] = p.sku; });
check('J10: staff see the three joint products without cost', r.ok && Object.keys(JS).length === 3 && JSON.stringify(r.result).indexOf('"cost"') < 0, r.result && r.result.products[0]);
const poolStock = async (sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${POOL} and p.sku = ${sku}`)[0].s);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }, { sku: JS.J1, qty: 2 }, { sku: JS.J3, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('J11: Costareen sells own + 2 joint products on one invoice', r.ok && r.result.joint && r.result.joint.length === 1 && r.result.grandTotal === 1350 + 3 * 2000, r.error || r.result);
const INV1 = r.ok ? r.result.invoiceNo : '';
check('J12: pool stock down per product (J1 10->8, J3 6->5), own PLA 7->6', await poolStock('J1') === 8 && await poolStock('J3') === 5 &&
  Number((await sql`select ps.stock from products p join product_stock ps on ps.product_id = p.id where p.business_id = ${A} and p.sku = ${PLA}`)[0].stock) === 6, [await poolStock('J1'), await poolStock('J3')]);
let mirror = await sql`select i.invoice_no, i.sold_by, l.sku, l.qty, l.unit_cost from invoices i join invoice_lines l on l.invoice_id = i.id join joint_sales j on j.pool_invoice_no = i.invoice_no
                       where i.business_id = ${POOL} and j.seller_invoice_no = ${INV1} order by l.line_no`;
check('J13: one mirror invoice in the pool with both joint lines at the pool cost', mirror.length === 2 && mirror.find((m) => m.sku === 'J1' && Number(m.qty) === 2 && Number(m.unit_cost) === 1000) &&
  mirror.find((m) => m.sku === 'J3' && Number(m.unit_cost) === 1500), mirror);
// the partner sells from its own shelf, two joint products, part paid
r = await proto('erpJointCatalog', []);
const PJS = {}; r.result.products.forEach((p) => { PJS[p.sku.split('~')[0]] = p.sku; });
r = await proto('erpCreateInvoice', [{ customer: { name: 'Fair Buyer', phone: '01812340009' }, items: [{ sku: PJS.J2, qty: 2 }, { sku: PJS.J1, qty: 1 }], payMode: 'part', paidNow: 2000, paymentMethod: 'Cash' }]);
check('J14: the partner sells two joint products, part paid (wholesale 1800 each)', r.ok && r.result.grandTotal === 3 * 1800, r.error || r.result);
const INV2 = r.ok ? r.result.invoiceNo : '';
check('J15: pool stock J2 10->8, J1 8->7', await poolStock('J2') === 8 && await poolStock('J1') === 7, [await poolStock('J2'), await poolStock('J1')]);
const jm = await sql`select amount from payments where business_id = ${POOL} and method = 'Joint' and invoice_no in (select pool_invoice_no from joint_sales where seller_invoice_no = ${INV2} and seller_business_id = ${B3})`;
check('J16: the pool holds the paid 2000 of the partner\'s sale (pro rata of a part payment)', near(jm.reduce((t, x) => t + Number(x.amount), 0), 2000), jm);
r = await owner('erpJoint', [{ pool: POOL }]);
const rep = r.result.book.report;
check('J17: the month-end sum still balances, both sellers listed', near(rep.balance_check, 0) && r.result.sales.some((s) => s.invoiceNo === INV1) && r.result.sales.some((s) => s.invoiceNo === INV2), [rep.balance_check, r.result.sales.map((s) => s.invoiceNo)]);
check('J18: the partner never sees Costareen\'s customer by name on the pool copy', !JSON.stringify((await proto('erpJoint', [{ pool: POOL }])).result.sales).includes('Karim'));
check('J19: "Sent between the shops" lists every line of both parcels', r.result.moves.filter((m) => m.from === 'Costareen' && m.to === 'Partner').length === 5, r.result.moves.length);

// ================================================================ 2. FIFO with a no-cost lot
const NC = 'FIN-NOCOST';
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values (${A}, ${NC}, 'Final no-cost lot', 'FinalCat', 'Fin', 'X', 700, 1000, 'Active')`;
r = await mgr('erpReceiveShipment', [{ reference: 'FIN-S1', supplier: 'Final Sup', mode: 'none', lines: [{ sku: NC, qty: 2, unitBdt: 500 }] }]);
check('F1: 2 received at 500', r.ok, r.error);
r = await mgr('erpStockCount', [{ lines: [{ sku: NC, counted: 5 }] }]);
check('F2: a count finds 3 more (a lot with no cost)', r.ok && r.result.up === 3, r.error || r.result);
const lotsNC = await sql`select l.source, l.qty_left::float q, l.unit_cost from stock_lots l join products p on p.id = l.product_id where p.business_id = ${A} and p.sku = ${NC} order by l.received_at, l.seq`;
const adjLot = lotsNC.find((l) => l.source === 'adjust');
check('F3: the count-up lot has unit_cost null, not 0', adjLot && adjLot.q === 3 && adjLot.unit_cost === null, lotsNC);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: NC, qty: 4 }], payMode: 'full' }]);
check('F4: a sale across the costed lot and the no-cost lot', r.ok, r.error);
const lc = Number((await sql`select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${A} and i.invoice_no = ${r.result.invoiceNo} and l.sku = ${NC}`)[0].unit_cost);
check('F5: the 2 units from the no-cost lot are valued at the product current cost (500 after the receipt), never 0: line cost 500, not 250', near(lc, 500), lc);
r = await owner('erpLots', [{ sku: NC }]);
check('F6: Lots shows the no-cost lot as unitCost null (the page shows a "no cost" chip), not 0', r.ok && JSON.stringify(r.result).includes('"unitCost":null'), r.result);

// ================================================================ 3. struck-out bills and costs are not summed
r = await mgr('erpReceiveShipment', [{ reference: 'FIN-S2', supplier: 'Final Sup', mode: 'bdt', totalBdt: 4000, shippingBdt: 400, lines: [{ sku: NC, qty: 4 }] }]);
check('S1: shipment FIN-S2 received, 4000 goods + 400 freight', r.ok, r.error);
r = await owner('erpShipment', [{ reference: 'FIN-S2' }]);
const fr = (r.result.extra || []).find((c) => /freight|shipping/i.test(c.label));
check('S2: the freight is one live cost line', !!fr && fr.amount === 400 && !fr.voided, r.result && r.result.extra);
r = await owner('erpShipmentCostVoid', [{ reference: 'FIN-S2', id: fr.id, reason: 'courier refunded it' }]);
check('S3: struck out with a reason (not deleted)', r.ok && (await sql`select voided from shipment_costs where id = ${fr.id}`)[0].voided, r.error);
r = await owner('erpShipments', [{}]);
const s2 = r.result.shipments.find((x) => x.reference === 'FIN-S2');
check('S4: Shipments no longer sums the struck-out freight', s2 && s2.extraCosts === 0, s2);
r = await owner('erpSupplierPage', [{ name: 'Final Sup' }]);
check('S5: the supplier\'s purchases show the goods only (4000), extras 0 after the strike-out', r.ok && r.result.purchases.rows.find((x) => x.ref === 'FIN-S2').extras === 0, r.result && r.result.purchases);
r = await owner('erpShipmentCostVoid', [{ reference: 'FIN-S2', id: fr.id, reason: 'again' }]);
check('S6: striking out twice is refused', !r.ok && /already struck out/.test(r.error), r.error);

// ================================================================ 4. receive from a file: row-level errors, all or nothing
const grid = [['SKU', 'Product', 'Qty', 'Price'], [NC, 'Final no-cost lot', 5, 500], ['', '', '', ''], ['ZZZ-NEW', 'Totally new thing', 'abc', 500], [PLA, 'Sunlu PLA', 2, 900]];
r = await mgr('erpReceiveMatch', [{ rows: grid, fileName: 'final.xlsx' }]);
check('R1: the file is read; the known SKUs match by code, the unknown is a new product, the empty row is dropped', r.ok && r.result.lines.length >= 2 && r.result.lines.find((l) => l.sku === NC) && r.result.lines.find((l) => l.sku === PLA), r.error || (r.result && r.result.lines));
const before = (await sql`select count(*)::int n from stock_movements where business_id = ${A} and kind = 'RECEIVE'`)[0].n;
r = await mgr('erpReceiveShipment', [{ reference: 'FIN-S3', supplier: 'Final Sup', mode: 'none', lines: [{ sku: NC, qty: 3, unitBdt: 500 }, { sku: PLA, qty: -2, unitBdt: 900 }] }]);
check('R2: a line with -2 refuses the whole receive, naming the line (it was dropped in silence before)', !r.ok && /below zero/.test(r.error) && /FIL-SUN-PLA-BLA-001/.test(r.error) && (await sql`select count(*)::int n from stock_movements where business_id = ${A} and kind = 'RECEIVE'`)[0].n === before, r.error);
r = await mgr('erpReceiveShipment', [{ reference: 'FIN-S4', supplier: 'Final Sup', mode: 'none', lines: [{ sku: NC, qty: 3, unitBdt: 500 }, { sku: 'NOPE-404', qty: 1, unitBdt: 10 }] }]);
check('R3: an unknown SKU refuses the whole receive, nothing half-saved', !r.ok && (await sql`select count(*)::int n from stock_movements where business_id = ${A} and kind = 'RECEIVE'`)[0].n === before, r.error);
r = await mgr('erpReceiveShipment', [{ reference: 'FIN-S5', supplier: 'Final Sup', mode: 'none', lines: [{ sku: NC, qty: 2.5, unitBdt: 500 }] }]);
check('R4: a fractional quantity is refused plainly', !r.ok && /whole numbers/.test(r.error), r.error);

// ================================================================ 5. stock count edge cases
r = await mgr('erpStockCount', [{ lines: Array.from({ length: 2001 }, (_, i) => ({ sku: 'X' + i, counted: 1 })) }]);
check('C1: 2001 lines refused plainly (save in parts)', !r.ok && /too many lines/.test(r.error), r.error);
r = await mgr('erpStockCount', [{ lines: [{ sku: NC, counted: 1 }, { sku: NC.toLowerCase(), counted: 2 }] }]);
check('C2: the same SKU twice (any case) is refused', !r.ok && /twice/.test(r.error), r.error);
r = await mgr('erpStockCount', [{ lines: [{ sku: NC, counted: -1 }] }]);
check('C3: a negative count is refused', !r.ok && /0 or more/.test(r.error), r.error);
r = await sales('erpStockCount', [{ lines: [{ sku: NC, counted: 1 }] }]);
check('C4: sales staff cannot write a count', !r.ok, r.error);

// ================================================================ 6. negative stock, serials, discontinue, no delete
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: NC, qty: 999 }], payMode: 'full' }]);
check('N1: selling more than the shelf holds is refused', !r.ok && /Not enough stock/.test(r.error), r.error);
r = await mgr('erpSerialsAdd', [{ sku: PRT, serials: ['SN-FIN-1', 'SN-FIN-2'] }]);
check('N2: two serials registered on the printer', r.ok && r.result.added === 2, r.error);
r = await mgr('erpSerialsAdd', [{ sku: PRT, serials: ['SN-FIN-2'] }]);
check('N3: the same serial again is refused', !r.ok && /Already on the list/.test(r.error), r.error);
r = await mgr('erpSerialsAdd', [{ sku: PRT, serials: ['SN-FIN-3', 'SN-FIN-3'] }]);
check('N4: a serial typed twice in one go is refused', !r.ok && /typed twice/.test(r.error), r.error);
r = await mgr('erpSetProductStatus', [NC, 'Discontinued']);
check('N5: a product with stock cannot be discontinued', !r.ok && /still has .* in stock/.test(r.error), r.error);
const HANDLERS = (await import(pathToFileURL(path.join(fnDir, 'handlers', 'index.js')))).HANDLERS;
check('N6: there is no product delete call at all (history is never lost)', !Object.keys(HANDLERS).some((k) => /^erp(Delete|Remove)Product|^erpProduct(Delete|Remove)/.test(k)), Object.keys(HANDLERS).filter((k) => /Product/.test(k)));

// ================================================================ 7. Excel import: preview writes nothing, stock never changes
const sellBefore = Number((await sql`select sell_price from products where business_id = ${A} and sku = ${NC}`)[0].sell_price);
r = await mgr('erpImport', [{ what: 'products', rows: [{ 'SKU': NC, 'Product': 'Final no-cost lot', 'Price': 1234, 'Stock': 999 }] }]);
check('E1: preview lists the price change and points out the stock column; nothing written', r.ok && r.result.change.length === 1 && r.result.skip.some((s) => /stock is not changed/.test(s.text)) &&
  Number((await sql`select sell_price from products where business_id = ${A} and sku = ${NC}`)[0].sell_price) === sellBefore, r.error || r.result);
r = await mgr('erpImport', [{ what: 'products', rows: [{ 'SKU': NC, 'Product': 'Final no-cost lot', 'Price': 1234, 'Stock': 999 }], apply: true }]);
const after = await sql`select p.sell_price, ps.stock from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${A} and p.sku = ${NC}`;
check('E2: applied: the price changed, the stock did not', r.ok && Number(after[0].sell_price) === 1234 && Number(after[0].stock) !== 999, after);

// ================================================================ 8. who sees cost
r = await sales('erpProductPage', [{ sku: NC }]);
const txt = JSON.stringify(r.result || {});
check('P1: a sales user\'s product page carries no cost figure', r.ok && !/"cost":\s*[1-9]|"cost_price"|"landed"|"unit_cost"/.test(txt), txt.slice(0, 300));
check('P2: ...and no receipt price in the history', r.ok && !(r.result.history || r.result.moves || []).some((m) => m.kind !== 'SALE' && m.price), (r.result.history || r.result.moves || []).slice(0, 3));
r = await sales('erpLots', [{ sku: NC }]);
check('P3: sales staff cannot read lots (costs)', !r.ok, r.error);
r = await sales('erpShipments', [{}]);
check('P4: ...nor shipments', !r.ok, r.error);
r = await sales('erpCostBook', []);
check('P5: ...nor the cost book', !r.ok, r.error);
r = await sales('erpSuppliers', []);
check('P6: ...nor suppliers\' dues', !r.ok, r.error);
r = await sales('erpJoint', [{ pool: POOL }]);
check('P7: the joint page for staff has no cost and no book', r.ok && !r.result.money && !r.result.book && JSON.stringify(r.result.stock).indexOf('"cost"') < 0, r.result && r.result.stock && r.result.stock[0]);
r = await sales('erpCatalog', []);
check('P8: the catalogue for staff has no cost_price', r.ok && !r.result.some((p) => p.cost_price !== undefined || p.cost !== undefined), r.result && r.result[0]);

// ================================================================ 9. supplier dues: head = list, with advance and opening
await owner('erpSupplierSave', [{ name: 'Final Adv', country: 'BD', currency: 'BDT', openingOwed: 1000 }]);
r = await owner('erpSupplierBill', [{ name: 'Final Adv', amount: 500, note: 'bill' }]);
check('D0: bill written', r.ok, r.error);
const acct = ((await owner('erpMoney', [])).result.accounts || [])[0];
r = await owner('erpSupplierPay', [{ name: 'Final Adv', amount: 3000, account: acct && acct.id }]);
check('D0b: advance paid', r.ok, r.error);
r = await owner('erpSuppliers', []);
const fa = r.result.suppliers.find((s) => s.name === 'Final Adv');
check('D1: 1000 opening + 500 billed - 3000 paid = 1500 ahead (an advance), never a due', fa && fa.owed === -1500, fa);
const headOwed = r.result.suppliers.reduce((t, s) => t + Math.max(0, s.owed), 0), headAhead = r.result.suppliers.reduce((t, s) => t + Math.max(0, -s.owed), 0);
check('D2: the head figures equal the list sums (owed and ahead kept apart, not netted)', r.result.owedTotal === headOwed && r.result.aheadTotal === headAhead && r.result.aheadTotal >= 1500, [r.result.owedTotal, headOwed, r.result.aheadTotal, headAhead]);
r = await owner('erpSupplierPage', [{ name: 'Final Adv' }]);
check('D3: the supplier page agrees with the list', r.ok && r.result.owed === -1500 && r.result.lines[0].after === -1500, r.result && [r.result.owed, r.result.lines[0]]);

// ================================================================ 10. market privacy
r = await owner('erpMarketSave', [{ on: true, city: 'Dhaka', shares: [{ sku: NC, mode: 'price' }] }]);
await sql`update erp_market_listings set updated_at = now() where business_id = ${A}`;
const cols = (await sql`select column_name from information_schema.columns where table_name = 'erp_market_listings'`).map((c) => c.column_name);
check('M1: the listing table has no sku, cost or stock column', !cols.some((c) => /sku|cost|stock/.test(c)), cols);
await makeShareholder();
r = await owner('erpMarket', [{ q: '' }]);
check('M2: a business never sees its own listing, and every item names only "Supplier · city"', r.ok && r.result.items.every((i) => /^Supplier/.test(i.seller) && i.sku === undefined && i.stock === undefined && i.cost === undefined), r.result && r.result.items.slice(0, 2));

await done();
