// Stage 3: a deal between two ERPs on the market - ask, price (+ quotation), accept, invoice, receive, rate.
import { sql, FIX, owner, mgr, sales, call, check, done } from './harness.mjs';

const other = (name, args) => call(name, args, { authHeader: 'Bearer owner:' + FIX.U.other });   // owner of B2 ("Elsewhere"): the buyer
const stockOf = async (biz, sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${biz} and p.sku = ${sku}`)[0]?.s ?? -1);

// the seller (provider's business B) shares two products
let r = await owner('erpMarketMine', []);
const prod = Object.fromEntries(r.result.products.map((p) => [p.sku, p.id]));
r = await owner('erpMarketSave', [{ on: true, city: 'Dhaka', products: [{ id: prod['FIL-SUN-PLA-BLA-001'], shared: true }, { id: prod['PRT-BAM-A1-001'], shared: true, mode: 'ask' }] }]);
check('seller shares two products', r.ok && r.result.listed === 2, r);
r = await other('erpMarket', []);
const pla = r.result.items.find((x) => x.name === 'Sunlu PLA Black'), a1 = r.result.items.find((x) => x.name === 'Bambu A1');
check('listings carry a handle, no rating yet', pla && pla.ref && pla.stars === null && pla.ratings === 0, r.result.items);

// 1. ask
r = await other('erpMarketAsk', [{ ref: pla.ref, qty: 2, note: 'Need by Friday' }]);
check('a phone is required', !r.ok && /phone/.test(r.error), r);
r = await other('erpMarketAsk', [{ ref: 'nope', qty: 2, phone: '01711111111' }]);
check('an unknown listing is refused', !r.ok && /no longer/.test(r.error), r);
r = await other('erpMarketAsk', [{ ref: pla.ref, qty: 2, note: 'Need by Friday', phone: '01711111111' }]);
check('request sent; the seller is not named yet', r.ok && r.result.request.status === 'asked' && r.result.request.who === 'Supplier' && !r.result.request.phone, r);
const id = r.result.request.id;
r = await other('erpMarketAsk', [{ ref: pla.ref, qty: 1, phone: '01711111111' }]);
check('the same product twice while open is refused', !r.ok && /already asked/.test(r.error), r);
r = await owner('erpMarketAsk', [{ ref: pla.ref, qty: 1, phone: '01711111111' }]);
check('a seller cannot ask itself', !r.ok, r);

// 2. the seller sees it, with the buyer's name and phone
r = await owner('erpMarketRequests', []);
let q = r.result.toMe.find((x) => x.id === id);
check('seller sees the request with the buyer named', q && q.who === 'Elsewhere' && q.phone === '01711111111' && q.mine && r.result.waiting === 1, r.result);

// 3. price
r = await sales('erpMarketQuote', [{ id, price: 1200, delivery: 100, phone: '01999999999' }]);
check('sales staff cannot give a price', !r.ok && /manager/.test(r.error), r);
r = await other('erpMarketQuote', [{ id, price: 1, phone: '0123456' }]);
check('the buyer cannot price its own request', !r.ok && /not found/.test(r.error), r);
r = await owner('erpMarketQuote', [{ id, price: 1200, delivery: 100, note: 'Cash on pickup ok', phone: '01999999999', days: 5 }]);
check('price given', r.ok && r.result.request.status === 'quoted' && r.result.request.total === 2500, r);
let qt = await sql`select reference, customer, total from quotations where business_id = ${FIX.B} and id = ${id}`;
check('...also a quotation in the seller\'s Quotations', qt.length === 1 && qt[0].customer === 'Elsewhere' && Number(qt[0].total) === 2500, qt);
r = await owner('erpMarketQuote', [{ id, price: 1150, delivery: 100, phone: '01999999999' }]);
qt = await sql`select count(*)::int n, max(total) t from quotations where business_id = ${FIX.B} and id = ${id}`;
check('a new price updates the same quotation', r.ok && qt[0].n === 1 && Number(qt[0].t) === 2400, qt);

// 4. the buyer sees the seller now, and accepts
r = await other('erpMarketRequests', []);
q = r.result.mine.find((x) => x.id === id);
check('buyer sees the price and now the seller\'s name and phone', q.status === 'quoted' && q.who === 'Costareen' && q.phone === '01999999999' && q.total === 2400 && q.mine, q);
await sql`update erp_market_requests set valid_until = current_date - 2 where id = ${id}`;
r = await other('erpMarketAccept', [{ id }]);
check('an expired price cannot be accepted', !r.ok && /expired/.test(r.error), r);
await sql`update erp_market_requests set valid_until = current_date + 3 where id = ${id}`;
r = await other('erpMarketAccept', [{ id }]);
check('accepted', r.ok && r.result.request.status === 'accepted', r);
r = await other('erpMarketAccept', [{ id }]);
check('accepting twice is refused', !r.ok, r);

// 5. the seller invoices: a normal sale in its own books
const before = await stockOf(FIX.B, 'FIL-SUN-PLA-BLA-001');
r = await owner('erpMarketInvoice', [{ id }]);
check('invoiced', r.ok && r.result.request.status === 'invoiced' && r.result.invoiceNo, r);
const inv = (await sql`select invoice_no, customer_name, grand_total, payment_status from invoices where business_id = ${FIX.B} and invoice_no = ${r.result.invoiceNo}`)[0];
check('...a real invoice at the agreed price + delivery, unpaid', inv && inv.customer_name === 'Elsewhere' && Number(inv.grand_total) === 2400 && inv.payment_status === 'Pending', inv);
check('...and the stock went down by 2', (await stockOf(FIX.B, 'FIL-SUN-PLA-BLA-001')) === before - 2);
r = await owner('erpMarketClose', [{ id, side: 'seller', reason: 'changed my mind' }]);
check('an invoiced request cannot be declined', !r.ok, r);

// 6. the buyer receives it into stock, as a new product, owed to the seller
r = await other('erpMarketReceive', [{ id }]);
check('the buyer must say which product it is', !r.ok && /Choose/.test(r.error), r);
r = await other('erpMarketReceive', [{ id, newProduct: true }]);
check('received', r.ok && r.result.request.status === 'received', r);
const np = (await sql`select p.sku, coalesce(ps.stock, 0) s, p.cost_price from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${FIX.B2} and p.name = 'Sunlu PLA Black'`)[0];
check('...a new product in the buyer\'s list with 2 in stock', np && Number(np.s) === 2, np);

// 7. rating shows on the seller's listings
r = await other('erpMarketRate', [{ id, stars: 7 }]);
check('stars are 1 to 5', !r.ok, r);
r = await other('erpMarketRate', [{ id, stars: 5, note: 'Fast' }]);
check('rated', r.ok && r.result.request.rating === 5, r);
r = await other('erpMarket', []);
check('the seller\'s listings show its rating', r.result.items.every((x) => x.stars === 5 && x.ratings === 1), r.result.items);

// 8. a second request, declined by the seller with a reason; a third cancelled by the buyer
r = await other('erpMarketAsk', [{ ref: a1.ref, qty: 1, phone: '01711111111' }]);
const id2 = r.result.request.id;
r = await mgr('erpMarketClose', [{ id: id2, side: 'seller', reason: 'Booked for another customer' }]);
check('the seller\'s manager declines with a reason', r.ok && r.result.request.status === 'declined', r);
r = await other('erpMarketRequests', []);
check('...the buyer sees why', r.result.mine.find((x) => x.id === id2).reason === 'Booked for another customer');
r = await other('erpMarketAsk', [{ ref: a1.ref, qty: 1, phone: '01711111111' }]);
const id3 = r.result.request.id;
r = await other('erpMarketClose', [{ id: id3 }]);
check('the buyer cancels its own request', r.ok && r.result.request.status === 'cancelled', r);
r = await owner('erpMarketRequests', []);
check('nothing waits for the seller now', r.result.waiting === 0, r.result.waiting);
// 9. many market calls at once never lock up (the market list has its own connections)
const many = await Promise.race([Promise.all([...Array(8)].map((_, i) => (i % 2 ? owner : other)(i % 3 ? 'erpMarket' : 'erpMarketRequests', []))),
  new Promise((ok) => setTimeout(() => ok(null), 20000))]);
check('8 market calls at once all answer', many && many.every((x) => x.ok), many && many.map((x) => x.ok));
await done();
