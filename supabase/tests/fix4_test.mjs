// fix-4 (24 Oct 2026): the partner's odd-case report, batch 4 - website orders (H17-H21, M19-M24).
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sql, FIX, owner, mgr, sales, check, done, web, deps, fnDir } from './harness.mjs';

const W = await import(pathToFileURL(path.join(fnDir, 'handlers', 'weborders.js')));
const { runJob } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const B = FIX.B;
async function asOwner(fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' })}, true)`;
    const ctx = { tx, sql, s: { userId: FIX.U.owner, name: 'Owner', role: 'owner', businessId: B, businessName: 'Costareen' },
                  biz: B, now: new Date(), memo: {}, deps };
    return fn(ctx);
  });
}
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'W4-PLA', 'Web PLA', 'Filaments', 'T', 'PLA', 0, 1350, 'Active'),
  (${B}, 'W4-A1', 'Web A1', 'Printers', 'T', 'FDM', 0, 52000, 'Active')`;
for (const [sku, q, c] of [['W4-PLA', 6, 900], ['W4-A1', 3, 40000]]) {
  const id = (await sql`select id from products where business_id = ${B} and sku = ${sku}`)[0].id;
  await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price) values (${B}, ${id}, 'RECEIVE', 'IN', ${q}, ${c})`;
}
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'CZ_SYNC_KEY', 'sekrit') on conflict do nothing`;
const head = (no, status, total) => ({ number: no, created: '2026-10-20 10:00:00', status, customer: 'Web Buyer', phone: '01811000444', address: 'Dhaka', payment: 'Cash on delivery', total });
let feed = [];
web.on(/\/orders\?/, () => ({ body: { items: feed } }));
let stockBody = null, stockCalls = 0;
web.on(/\/stock$/, (url, opts) => { stockCalls++; stockBody = JSON.parse(opts.body); return { body: { changed: [], changed_count: 0 } }; });
const pull = () => asOwner((ctx) => W.pullWebOrders(ctx));
const stockOf = async (sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${B} and p.sku = ${sku}`)[0].s);
const order = async (no) => (await mgr('erpWebOrders', [])).result.find((o) => o.no === no);

// ---- H17: two lines of one SKU are two lines
feed = [{ ...head('2001', 'processing', 4130), line_id: '11', sku: 'W4-PLA', product: 'Web PLA', qty: 1, line_total: 1350 },
        { ...head('2001', 'processing', 4130), line_id: '12', sku: 'W4-PLA', product: 'Web PLA', qty: 2, line_total: 2700 }];
let p = await pull();
check('(H17) two lines of PLA (x1 and x2) are both kept', p.ok && p.added === 2 && (await order('2001')).lines.length === 2, [p, (await order('2001')).lines]);
p = await pull();
check('(H17) pulled again: nothing doubled', p.added === 0 && (await order('2001')).lines.length === 2, p);
let r = await mgr('erpEnterWebOrder', [{ orderNo: '2001' }]);
const inv = (await sql`select delivery_charge, grand_total from invoices where business_id = ${B} and invoice_no = ${r.result && r.result.invoiceNo}`)[0];
check('(H17) entered: 3 units on the invoice, delivery 80 (not 2,780)', r.ok && Number(inv.delivery_charge) === 80 && Number(inv.grand_total) === 4130 && (await stockOf('W4-PLA')) === 3, [r.error, inv]);

// ---- H21: a line added on the website after the order was entered
feed.push({ ...head('2001', 'processing', 4130), line_id: '13', sku: 'W4-PLA', product: 'Web PLA', qty: 1, line_total: 1350 });
await pull();
let o = await order('2001');
check('(H21) the order says lines were added after entry, and offers to enter them', !o.entered && o.partEntered && o.changed && /added on the website after/.test(o.changeNote), o);
r = await mgr('erpEnterWebOrder', [{ orderNo: '2001' }]);
const inv2 = (await sql`select delivery_charge, grand_total from invoices where business_id = ${B} and invoice_no = ${r.result && r.result.invoiceNo}`)[0];
check('(H21) the added line goes on its own invoice, no second delivery charge', r.ok && Number(inv2.delivery_charge) === 0 && Number(inv2.grand_total) === 1350 && (await stockOf('W4-PLA')) === 2, [r.error, inv2]);
check('(H21) now the whole order is entered', (await order('2001')).entered === true);

// ---- M19: the quantity changed on the website before the order was entered
feed.push({ ...head('2002', 'processing', 52080), line_id: '21', sku: 'W4-A1', product: 'Web A1', qty: 1, line_total: 52000 });
await pull();
feed[feed.length - 1] = { ...head('2002', 'processing', 156080), line_id: '21', sku: 'W4-A1', product: 'Web A1', qty: 3, line_total: 156000 };
await pull();
o = await order('2002');
check('(M19) the ERP follows the website: 3 printers, 156,080', o.lines[0].qty === 3 && o.orderTotal === 156080, o);

// ---- H20: units held for a pre-order are not offered on the website, and entering them is asked first
const po = (await sql`insert into preorders (business_id, no, customer, phone, customer_key, status) values (${B}, 'PO-W4', 'Waiting', '01800000001', 'p:01800000001', 'open') returning id`)[0].id;
await sql`insert into preorder_lines (business_id, preorder_id, sku, name, qty, price, line_no) values (${B}, ${po}, 'W4-A1', 'Web A1', 2, 52000, 1)`;
p = await asOwner((ctx) => W.pushStockToWebsite(ctx, 'dry'));
const sent = {};
for (const x of stockBody.items) sent[x.sku] = x.qty;
check('(H20) the website gets A1 3 - 3 waiting on order 2002 - 2 held = 0', sent['W4-A1'] === 0, sent);
r = await mgr('erpEnterWebOrder', [{ orderNo: '2002' }]);
check('(H20) entering an order that takes held units is asked first', !r.ok && /^CONFIRM: This order takes units held for a pre-order/.test(r.error), r);

// ---- H18 / M20: cancelled orders
feed.push({ ...head('2003', 'cancelled', 1430), line_id: '31', sku: 'W4-PLA', product: 'Web PLA', qty: 1, line_total: 1350 });
await pull();
r = await mgr('erpEnterWebOrder', [{ orderNo: '2003' }]);
check('(H18) a cancelled website order cannot be entered (stock stays)', !r.ok && /cancelled on the website/.test(r.error) && (await stockOf('W4-PLA')) === 2, r);
feed = feed.map((x) => (x.number === '2001' ? { ...x, status: 'refunded' } : x));
await pull();
o = await order('2001');
check('(M20) an entered order refunded on the website is flagged', o.cancelledAfterEntry === true && /after it was entered: cancel or return/.test(o.changeNote), o);

// ---- M21: no negative quantity from the plugin
feed.push({ ...head('2004', 'processing', 0), line_id: '41', sku: 'W4-PLA', product: 'Web PLA', qty: -3, line_total: -4050 });
p = await pull();
check('(M21) a line with qty -3 is not taken in', !(await order('2004')), p);

// ---- H19: the orders could not be read -> the stock is not sent
await sql`insert into business_config (business_id, key, value) values (${B}, 'website_sync_on', '1') on conflict (business_id, key) do update set value = '1'`;
web.on(/\/orders\?/, () => ({ status: 500, body: { error: 'down' } }));
stockCalls = 0;
r = await runJob(deps, 'websync');
check('(H19) the website answered the orders with an error: no stock was sent', stockCalls === 0, [stockCalls, JSON.stringify(r).slice(0, 300)]);

// ---- M23: a seller cannot find the cost by trying prices
let flipAt = 0;
for (let price = 940; price <= 1070; price += 2) {
  const x = await sales('erpLineMargins', [{ items: [{ sku: 'W4-PLA', qty: 1, discEach: 1350 - price }] }]);
  if (!x.result.lines[0].low && !flipAt) flipAt = price;
  if (x.result.lines[0].margin !== undefined) flipAt = -1;
}
const thr = flipAt > 0 ? (1 - 900 / flipAt) * 100 : -1;   // the lot cost is 900
check('(M23) staff get "low profit" but never the margin; the line sits somewhere between 5% and 15% over the cost', flipAt > 0 && thr >= 4.5 && thr <= 15.5, [flipAt, thr]);
const own = await owner('erpLineMargins', [{ items: [{ sku: 'W4-PLA', qty: 1, discEach: 350 }] }]);
check('(M23) the owner still gets the exact margin', typeof own.result.lines[0].margin === 'number', own.result);

// ---- M24: a save naming only some fields keeps the rest
r = await owner('erpSaveProduct', [{ sku: 'W4-A1', product_name: 'Web A1 printer' }]);
const pr = (await sql`select name, sell_price, category, brand from products where business_id = ${B} and sku = 'W4-A1'`)[0];
check('(M24) only the name is sent: price 52,000, category and brand stay', r.ok && pr.name === 'Web A1 printer' && Number(pr.sell_price) === 52000 && pr.category === 'Printers' && pr.brand === 'T', [r.error, pr]);

const other = await sql`select count(*)::int as n from web_orders where business_id = ${FIX.B2}`;
check('the other business is untouched', other[0].n === 0, other);
await done();
