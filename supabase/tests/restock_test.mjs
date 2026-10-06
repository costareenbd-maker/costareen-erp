// Waiting orders: a customer wants more than the shelf has; the rest is asked for on the market; when it is
// received the order becomes one normal invoice. Seller = business B (shares Sunlu PLA Black); buyer = B2.
import { sql, FIX, owner, call, check, done } from './harness.mjs';

const other = (name, args) => call(name, args, { authHeader: 'Bearer owner:' + FIX.U.other });   // owner of B2, the shop that is short
const B2 = FIX.B2;
const stockOf = async (biz, sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${biz} and p.sku = ${sku}`)[0]?.s ?? -1);

// the buyer's own shelf: 1 roll of the same filament (named a little differently), and another product in stock
const pb = (await sql`insert into products (business_id, sku, name, brand, cost_price, sell_price) values (${B2}, 'MY-PLA-BLK', 'Sunlu PLA Black 1kg', 'Sunlu', 1000, 1500) returning id`)[0].id;
const pn = (await sql`insert into products (business_id, sku, name, cost_price, sell_price) values (${B2}, 'MY-NOZZLE', 'Brass nozzle 0.4', 50, 150) returning id`)[0].id;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${B2}, ${pb}, 'RECEIVE', 'IN', 1), (${B2}, ${pn}, 'RECEIVE', 'IN', 10)`;
// the seller shares its PLA on the market
let r = await owner('erpMarketMine', []);
const prod = Object.fromEntries(r.result.products.map((p) => [p.sku, p.id]));
r = await owner('erpMarketSave', [{ on: true, city: 'Dhaka', products: [{ id: prod['FIL-SUN-PLA-BLA-001'], shared: true }] }]);
check('seller lists its PLA', r.ok && r.result.listed === 1, r);

const order = [{ sku: 'MY-PLA-BLK', qty: 4 }, { sku: 'MY-NOZZLE', qty: 2 }];
r = await other('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: order, payMode: 'full' }]);
check('the normal invoice is refused: not enough stock', !r.ok && /Not enough stock/.test(r.error), r);

// 1. what is short, and who has it
r = await other('erpRestockOffers', [{ items: order }]);
const line = r.ok && r.result.lines[0];
check('one line is short by 3; the seller is offered (same product, size ignored)', r.ok && r.result.lines.length === 1 && line.sku === 'MY-PLA-BLK' && line.need === 3 && line.have === 1 &&
  line.offers.length === 1 && line.offers[0].name === 'Sunlu PLA Black' && line.offers[0].band === 'in', r);
r = await other('erpRestockOffers', [{ items: [{ sku: 'MY-NOZZLE', qty: 2 }] }]);
check('nothing short: nothing offered', r.ok && r.result.lines.length === 0, r);

// 2. keep the order waiting and ask
r = await other('erpRestockStart', [{ customer: { name: 'Karim', phone: '01712345678', address: 'Dhaka', source: 'Steadfast courier' }, items: order, picks: [], phone: '01711111111' }]);
check('a shop must be chosen', !r.ok && /Choose a shop/.test(r.error), r);
r = await other('erpRestockStart', [{ customer: { name: 'Karim', phone: '01712345678', address: 'Dhaka', source: 'Steadfast courier' }, items: order,
  picks: [{ sku: 'MY-PLA-BLK', ref: line.offers[0].ref }], phone: '01711111111' }]);
check('order waiting, one request sent', r.ok && r.result.asked === 1 && r.result.orders.length === 1 && r.result.orders[0].status === 'waiting' &&
  r.result.orders[0].requests[0].state === 'asked' && r.result.orders[0].missing[0].sku === 'MY-PLA-BLK', r);
const OID = r.result.id, REQ = r.result.orders[0].requests[0].request;
check('nothing left the shelf yet', await stockOf(B2, 'MY-PLA-BLK') === 1 && await stockOf(B2, 'MY-NOZZLE') === 10);
r = await owner('erpMarketRequests', []);
const seen = r.result.toMe.find((x) => x.id === REQ);
check('the seller sees a normal request for 3, saying it is for a customer order', seen && seen.qty === 3 && /For a customer order \(Karim\)/.test(seen.note), seen);

// 3. the market deal goes on as usual: price, accept, invoice
await owner('erpMarketQuote', [{ id: REQ, price: 1100, delivery: 120, phone: '01999999999', days: 5 }]);
r = await other('erpRestockList', []);
check('the waiting order shows the price', r.ok && r.result.orders[0].requests[0].state === 'quoted' && r.result.orders[0].requests[0].price === 1100 && r.result.ready === 0, r.result);
await other('erpMarketAccept', [{ id: REQ }]);
r = await owner('erpMarketInvoice', [{ id: REQ }]);
check('the seller invoices', r.ok, r);
r = await other('erpRestockList', []);
check('...on the way', r.result.orders[0].requests[0].state === 'invoiced' && r.result.orders[0].status === 'waiting', r.result);

// 4. received on the buyer's own product: the order is ready
r = await other('erpMarketReceive', [{ id: REQ, sku: 'MY-PLA-BLK' }]);
check('received onto the buyer\'s own product', r.ok && await stockOf(B2, 'MY-PLA-BLK') === 4, r);
r = await other('erpRestockList', []);
check('the order is ready', r.ok && r.result.ready === 1 && r.result.orders[0].status === 'ready' && r.result.orders[0].missing.length === 0, r.result);

// 5. one normal invoice from it
r = await other('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678', address: 'Dhaka', source: 'Steadfast courier' }, items: order, payMode: 'full', restockId: OID }]);
check('the invoice is made', r.ok && r.result.grandTotal === 6300, r);
check('stock out as a normal sale', await stockOf(B2, 'MY-PLA-BLK') === 0 && await stockOf(B2, 'MY-NOZZLE') === 8);
const row = (await sql`select status, invoice_no from restock_orders where id = ${OID}`)[0];
check('the waiting order is closed with the invoice number', row.status === 'invoiced' && row.invoice_no === r.result.invoiceNo, row);
r = await other('erpRestockList', []);
check('...and no longer listed', r.ok && r.result.orders.length === 0, r.result);

// 6. a cancelled order closes its open requests; an order of another business cannot be touched
r = await other('erpRestockStart', [{ customer: { name: 'Rahim' }, items: [{ sku: 'MY-PLA-BLK', qty: 2 }],
  picks: [{ sku: 'MY-PLA-BLK', ref: (await other('erpRestockOffers', [{ items: [{ sku: 'MY-PLA-BLK', qty: 2 }] }])).result.lines[0].offers[0].ref }], phone: '01711111111' }]);
const OID2 = r.result.id, REQ2 = r.result.orders[0].requests[0].request;
r = await owner('erpRestockCancel', [{ id: OID2 }]);
check('another business cannot cancel it', !r.ok, r);
r = await other('erpRestockCancel', [{ id: OID2, reason: 'customer changed mind' }]);
check('cancelled', r.ok && r.result.orders.length === 0, r);
const q2 = (await sql`select status from erp_market_requests where id = ${REQ2}`)[0];
check('...its market request is cancelled too', q2.status === 'cancelled', q2);
check('the other business sees no waiting orders of B2', (await owner('erpRestockList', [])).result.orders.length === 0);
await done();
