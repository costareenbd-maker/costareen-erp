// Stage N9: sell without stock - a supplier opens a reseller programme, a reseller joins, sells to his customer at his
// own price, the supplier invoices that customer and ships, the margin is a commission settled at month end.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, call, check, done, deps, fnDir, web, pdfs } from './harness.mjs';
const { runJob } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const B = FIX.B, B2 = FIX.B2;
const other = (name, args) => call(name, args, { authHeader: 'Bearer owner:' + FIX.U.other });   // owner of B2, the reseller
const cat = async () => sql`select * from erp_reseller_catalog order by name`;

// 1. the supplier (B) shares products on the market and opens the programme
let r = await owner('erpMarketMine', []);
const prod = Object.fromEntries(r.result.products.map((p) => [p.sku, p.id]));
r = await owner('erpMarketSave', [{ on: true, city: 'Dhaka', products: [{ id: prod['FIL-SUN-PLA-BLA-001'], shared: true }, { id: prod['PRT-BAM-A1-001'], shared: true, mode: 'ask' }] }]);
check('the supplier shares two products', r.ok && r.result.listed === 2, r);
r = await mgr('erpResellerProgrammeSave', [{ enabled: true, pct: 15 }]);
check('only the owner opens the programme', !r.ok, r);
r = await owner('erpResellerProgrammeSave', [{ enabled: true, pct: 150 }]);
check('a sane percentage', !r.ok && /0 to 90/.test(r.error), r);
r = await owner('erpResellerProgrammeSave', [{ enabled: true, pct: 15, terms: 'Dhaka parcels go next day; commission by bKash on the 5th.', phone: '01700000001' }]);
check('programme on: two products open to resellers', r.ok && r.result.listed === 2, r);
let rows = await cat();
check('the catalogue: exact reseller price = shelf price less 15%, with the SKU and the suggested price', rows.length === 2 && Number(rows.find((x) => x.sku === 'FIL-SUN-PLA-BLA-001').price) === 1148 && Number(rows.find((x) => x.sku === 'FIL-SUN-PLA-BLA-001').retail) === 1350 && rows.every((x) => x.band === 'in'), rows);
r = await owner('erpResellerProgramme', []);
check('the supplier’s card: programme, nobody yet', r.ok && r.result.programme.enabled && r.result.programme.pct === 15 && r.result.links.length === 0 && r.result.orders.length === 0, r);

// 2. the reseller (B2) finds the supplier and asks to join
r = await other('erpResell', []);
check('the reseller sees the supplier: name, 15% off, 2 products, terms; no catalogue yet', r.ok && r.result.suppliers.length === 1 && r.result.suppliers[0].pct === 15 && r.result.suppliers[0].products === 2 && /bKash/.test(r.result.suppliers[0].terms) && r.result.suppliers[0].link === null && r.result.catalogues.length === 0, r);
const SUP = r.result.suppliers[0];
r = await other('erpResellOrder', [{ linkId: '00000000-0000-0000-0000-000000000000', customer: { name: 'Rina', phone: '01799999999', address: 'House 5, Road 2, Sylhet' }, items: [] }]);
check('no order without an approved link', !r.ok, r);
r = await other('erpResellJoin', [{ source: SUP.source, business: SUP.business, note: 'Facebook page with 4k followers, Sylhet.' }]);
check('asked to join', r.ok && r.result.asked, r);
r = await other('erpResellJoin', [{ source: SUP.source, business: SUP.business }]);
check('not twice while waiting', !r.ok && /already asked/.test(r.error), r);
r = await owner('erpResellerProgramme', []);
check('the supplier sees the request with the reseller’s words', r.result.links.length === 1 && r.result.links[0].status === 'asked' && /4k followers/.test(r.result.links[0].note) && r.result.waiting === 1, r.result.links);
const LINK = r.result.links[0].id;
r = await other('erpResell', []);
check('the reseller sees "asked"', r.result.suppliers[0].link.status === 'asked' && r.result.catalogues.length === 0, r.result.suppliers);

// 3. approved: the catalogue with prices; an order at the reseller's own price
r = await sales('erpResellerLinkSet', [{ id: LINK, status: 'active' }]);
check('sales cannot approve', !r.ok, r);
r = await mgr('erpResellerLinkSet', [{ id: LINK, status: 'active' }]);
check('approved', r.ok && r.result.status === 'active', r);
r = await other('erpResell', []);
check('the reseller sees the catalogue: name, unit, stock band, reseller price, suggested price - no cost', r.result.catalogues.length === 1 && r.result.catalogues[0].items.length === 2 && r.result.catalogues[0].items.find((i) => i.name === 'Sunlu PLA Black').price === 1148 && r.result.catalogues[0].items[0].retail > 0 && !('cost' in r.result.catalogues[0].items[0]), r.result.catalogues);
const PLA = r.result.catalogues[0].items.find((i) => i.name === 'Sunlu PLA Black').productId;
const good = (o) => ({ linkId: LINK, customer: { name: 'Rina', phone: '01799999999', address: 'House 5, Road 2, Sylhet' }, items: [{ productId: PLA, qty: 2, price: 1400 }], delivery: 80, note: 'Deliver after 5 pm.', ...(o || {}) });
r = await other('erpResellOrder', [good({ items: [{ productId: PLA, qty: 2, price: 1000 }] })]);
check('his price cannot be below the reseller price', !r.ok && /below the reseller price/.test(r.error), r);
r = await other('erpResellOrder', [good({ customer: { name: 'Rina', phone: '123', address: 'Sylhet road' } })]);
check('the customer’s real mobile number', !r.ok && /mobile/.test(r.error), r);
r = await other('erpResellOrder', [good({ customer: { name: 'Rina', phone: '01799999999', address: 'Syl' } })]);
check('a full address for the courier', !r.ok && /address/.test(r.error), r);
r = await other('erpResellOrder', [good()]);
check('placed: 2 x 1400 to the customer, 2 x 1148 to the supplier, margin 504, delivery 80', r.ok && /^RS-\d{6}-[A-Z0-9]{4}$/.test(r.result.order.orderNo) && r.result.order.goods === 2800 && r.result.order.cost === 2296 && r.result.order.margin === 504 && r.result.order.delivery === 80 && r.result.order.status === 'placed', r);
const O1 = r.result.order.id, NO1 = r.result.order.orderNo;
r = await other('erpResell', []);
check('under his orders, waiting for the supplier', r.result.orders.length === 1 && r.result.orders[0].status === 'placed' && r.result.orders[0].supplier, r.result.orders);

// 4. the supplier accepts: a normal invoice to the reseller's customer at the reseller's prices, cash on delivery
r = await owner('erpResellerProgramme', []);
check('the supplier sees the order with the customer’s address and the commission', r.result.orders.length === 1 && r.result.orders[0].customer === 'Rina' && r.result.orders[0].address === 'House 5, Road 2, Sylhet' && r.result.orders[0].margin === 504 && r.result.orders[0].reseller, r.result.orders);
const stockBefore = Number((await sql`select stock from product_stock where product_id = ${PLA}`)[0].stock);
r = await mgr('erpResellerAccept', [{ id: O1 }]);
check('accepted: an invoice for 2 x 1400 + 80 = 2880', r.ok && /^INV-/.test(r.result.invoiceNo) && r.result.total === 2880, r);
const INV = r.result.invoiceNo;
let inv = (await sql`select * from invoices where business_id = ${B} and invoice_no = ${INV}`)[0];
check('the supplier’s books: customer Rina, source Reseller, COD, pending, due 2880, note names the reseller order', inv.customer_name === 'Rina' && inv.source === 'Reseller' && inv.payment_method === 'COD' && inv.payment_status === 'Pending' && Number(inv.due_amount) === 2880 && inv.note.includes(NO1), inv);
const lines = await sql`select * from invoice_lines where business_id = ${B} and invoice_id = ${inv.id}`;
check('the line: 2 at 1400 with the supplier’s own cost (900) kept', lines.length === 1 && Number(lines[0].unit_price) === 1400 && Number(lines[0].qty) === 2 && Number(lines[0].unit_cost) === 900, lines);
check('stock went out of the supplier’s shelf', Number((await sql`select stock from product_stock where product_id = ${PLA}`)[0].stock) === stockBefore - 2);
r = await mgr('erpResellerAccept', [{ id: O1 }]);
check('not twice', !r.ok, r);
r = await other('erpResellCancel', [{ id: O1 }]);
check('the reseller cannot cancel an invoiced order', !r.ok && /already taken/.test(r.error), r);

// 5. the packing slip in the reseller's name; the parcel booked from the invoice
const nPdf = pdfs.length;
r = await sales('erpResellerSlip', [{ id: O1 }]);
check('a slip PDF with the reseller’s name, the customer, the lines and the COD amount - never the supplier’s name', r.ok && /slip\.pdf$/.test(r.result.name) && pdfs.length === nPdf + 1 && /Elsewhere/.test(pdfs[nPdf].html) && /Rina/.test(pdfs[nPdf].html) && /2880/.test(pdfs[nPdf].html) && !/Costareen/.test(pdfs[nPdf].html), r);
await owner('erpCourierSetKeys', [{ apiKey: 'K1', apiSecret: 'S1' }]);
const created = [];
web.on(/\/create_order$/, (url, opts) => { const b = JSON.parse(opts.body); created.push(b); return { status: 200, body: { status: 200, consignment: { consignment_id: 7001, invoice: b.invoice, tracking_code: 'TRK1', status: 'in_review' } } }; });
r = await sales('erpResellerBook', [{ id: O1, note: 'fragile' }]);
check('the parcel: booked from the supplier’s invoice, collects 2880, the note names the reseller', r.ok && r.result.consignment === '7001' && r.result.collect === 2880 && created.length === 1 && created[0].recipient_phone === '01799999999' && /Elsewhere/.test(created[0].note) && /fragile/.test(created[0].note), r);
r = await owner('erpResellerProgramme', []);
check('order booked with its consignment; nothing to settle yet', r.result.orders[0].status === 'booked' && r.result.orders[0].consignment === '7001' && r.result.statements.length === 0, r.result.orders[0]);

// 6. delivered and paid in the supplier's books -> the order is delivered -> the month's commission is due
await sql`update invoices set delivery_status = 'Delivered', payment_status = 'Paid', advance_paid = 2880, due_amount = 0 where business_id = ${B} and invoice_no = ${INV}`;
r = await owner('erpResellerProgramme', []);
check('delivered and paid: the statement shows 504 due for this month', r.result.orders[0].status === 'delivered' && r.result.statements.length === 1 && r.result.statements[0].margin === 504 && r.result.statements[0].due === 504 && r.result.statements[0].status === 'open', r.result.statements);
const MONTH = r.result.statements[0].month;
r = await other('erpResell', []);
check('the reseller sees delivered and the open commission', r.result.orders[0].status === 'delivered' && r.result.statements[0].margin === 504 && r.result.statements[0].status === 'open', r.result);
r = await other('erpResellReceived', [{ statementId: '00000000-0000-0000-0000-000000000000' }]);
check('nothing to confirm before it is paid', !r.ok, r);

// 7. a second order comes back: no commission on a returned parcel
r = await other('erpResellOrder', [good({ items: [{ productId: PLA, qty: 1, price: 1500 }], delivery: 0 })]);
const O2 = r.result.order.id;
r = await mgr('erpResellerAccept', [{ id: O2 }]);
const INV2 = r.result.invoiceNo;
await sql`update invoices set delivery_status = 'Returned' where business_id = ${B} and invoice_no = ${INV2}`;
r = await owner('erpResellerProgramme', []);
check('returned parcel: the order says returned, the statement still 504', r.result.orders.find((o) => o.id === O2).status === 'returned' && r.result.statements.length === 1 && r.result.statements[0].margin === 504, r.result.orders);

// 8. month end: the supplier pays - an expense in its books; the reseller confirms
r = await mgr('erpResellerPay', [{ linkId: LINK, month: MONTH }]);
check('only the owner pays', !r.ok, r);
r = await owner('erpResellerPay', [{ linkId: LINK, month: '2020-01' }]);
check('nothing due for another month', !r.ok && /Nothing is due/.test(r.error), r);
r = await owner('erpResellerPay', [{ linkId: LINK, month: MONTH, note: 'bKash 5 Oct' }]);
check('paid 504', r.ok && r.result.paid === 504, r);
const exp = await sql`select * from expenses where business_id = ${B} and category = 'Reseller commission'`;
check('an expense "Reseller commission" of 504 naming the reseller and the month', exp.length === 1 && Number(exp[0].amount) === 504 && /Elsewhere/.test(exp[0].description) && exp[0].description.includes(MONTH), exp);
r = await owner('erpResellerPay', [{ linkId: LINK, month: MONTH }]);
check('not twice', !r.ok && /Nothing is due/.test(r.error), r);
r = await owner('erpResellerProgramme', []);
check('the statement: paid, nothing due', r.result.statements[0].status === 'paid' && r.result.statements[0].paid === 504 && r.result.statements[0].due === 0, r.result.statements);
r = await other('erpResell', []);
const ST = r.result.statements[0];
check('the reseller sees paid with the note', ST.status === 'paid' && ST.paid === 504 && /bKash/.test(ST.paidNote), ST);
r = await other('erpResellReceived', [{ statementId: ST.id, note: 'in my bKash' }]);
check('received', r.ok && r.result.received === 504 && (await other('erpResell', [])).result.statements[0].status === 'received', r);

// 9. the timer keeps the catalogue fresh; pausing a reseller stops orders; the programme off hides the supplier
await sql`update products set sell_price = 1000 where business_id = ${B} and sku = 'FIL-SUN-PLA-BLA-001'`;
r = await runJob(deps, 'websync');
check('the websync timer refreshes the reseller catalogue', Number((await cat()).find((x) => x.sku === 'FIL-SUN-PLA-BLA-001').price) === 850, r);
r = await mgr('erpResellerLinkSet', [{ id: LINK, status: 'paused' }]);
r = await other('erpResellOrder', [good()]);
check('paused: no new orders', !r.ok && /paused/.test(r.error), r);
r = await mgr('erpResellerLinkSet', [{ id: LINK, status: 'active', pct: 20 }]);
r = await other('erpResell', []);
check('a reseller’s own discount: 20% off -> 800', r.result.catalogues[0].items.find((i) => i.name === 'Sunlu PLA Black').price === 800 && r.result.suppliers[0].link.pct === 20, r.result.catalogues[0].items);
r = await owner('erpResellerProgrammeSave', [{ enabled: false, pct: 15 }]);
check('programme off: the catalogue is emptied and the supplier is no longer offered', r.ok && (await cat()).length === 0 && (await other('erpResell', [])).result.suppliers.length === 0, r);
// the other business's books were never touched by the supplier's invoice
check('nothing was written in the reseller’s own books', Number((await sql`select count(*)::int as n from invoices where business_id = ${B2}`)[0].n) === 0);
await done();
