// fd-22: erpFd22Analytics (handlers/fd22.js) - his Analytics / System check figures, read only.
// Run: TEST_SCRIPT=fd22_test.mjs ... erp_server_test.py
// The handler is not registered in handlers/index.js yet (the page block's report brings the registration lines), so the
// test calls it directly, inside a transaction, with the same ctx shape core.js gives a handler.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, fnDir, check, done } from './harness.mjs';

const { erpFd22Analytics, HANDLERS, customerKey } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'fd22.js')));
const B = FIX.B, B2 = FIX.B2;
const PLA = 'FIL-SUN-PLA-BLA-001';
const call = (payload, biz) => sql.begin((tx) => erpFd22Analytics({ tx, sql, s: { role: 'owner' }, biz: biz || B, now: new Date(), memo: {}, deps: {} }, payload));

check('exports one read-only handler', HANDLERS && Object.keys(HANDLERS).join() === 'erpFd22Analytics', Object.keys(HANDLERS || {}));
check('a customer is the phone (last 10 digits), else the name', customerKey('+880 1712-345678', 'X') === customerKey('01712345678', 'Y') &&
  customerKey('', ' Karim  Ali ') === 'nkarim ali' && customerKey('', 'Walk-in') === '', [customerKey('+880 1712-345678'), customerKey('', ' Karim  Ali ')]);

const counts = async () => (await sql`select (select count(*) from invoices where business_id = ${B})::int as i,
                                              (select count(*) from stock_movements where business_id = ${B})::int as m,
                                              (select count(*) from payments where business_id = ${B})::int as p,
                                              (select count(*) from erp_activity where business_id = ${B})::int as a`)[0];

// ---- before: whatever the fixture holds
let d0 = await call({ months: 1 });
const cur0 = d0.months[d0.months.length - 1];

// ---- sales through the ERP itself: Karim twice (one customer), Rahim once, one line without any cost
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'FD22-NOCOST', 'FD22 Mystery part', 'FD22 Parts', 'FD22Brand', 'FD22Type', 0, 500, 'Active')`;
const pid = (await sql`select id from products where business_id = ${B} and sku = 'FD22-NOCOST'`)[0].id;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${B}, ${pid}, 'RECEIVE', 'IN', 5)`;
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim FD22', phone: '01799922201' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full' }]);
check('invoice 1 (Karim)', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim FD22', phone: '01799922201' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
check('invoice 2 (Karim again)', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim FD22', phone: '01899922202' }, items: [{ sku: 'FD22-NOCOST', qty: 1 }], payMode: 'none' }]);
check('invoice 3 (Rahim, a product with no cost)', r.ok, r);
const inv3 = r.result.invoiceNo;

const before = await counts();
const d = await call({ months: 1 });
const after = await counts();
check('reads only: nothing written', JSON.stringify(before) === JSON.stringify(after), [before, after]);

const cur = d.months[d.months.length - 1];
check('13 months, oldest first, this month last and marked current', d.months.length === 13 && cur.current && d.months[0].month < cur.month, d.months.map((m) => m.month));
check('three more orders this month', cur.orders - cur0.orders === 3, [cur0.orders, cur.orders]);
check('four more units sold this month', cur.units - cur0.units === 4, [cur0.units, cur.units]);
check('Karim counts once: two more buying customers', cur.buyers - cur0.buyers === 2, [cur0.buyers, cur.buyers]);
check('both are new customers this month', cur.newCustomers - cur0.newCustomers === 2, [cur0.newCustomers, cur.newCustomers]);
check('the range card says the same (this month)', d.range.newCustomers - d0.range.newCustomers === 2 && d.range.months === 1, d.range);

// ---- one net profit everywhere: the month rows are the P&L's
const p = await owner('erpPnl', [{ months: 1 }]);
const pm = p.result.months[p.result.months.length - 1];
check('revenue, gross, expenses and net are the P&L figures', cur.revenue === pm.netSales && cur.gross === pm.gross && cur.expenses === pm.expenses && cur.net === pm.net, [cur, pm]);
const an = await owner('erpAnalytics', []);
const g = an.result.growth[an.result.growth.length - 1];
check('...and Analytics\' 12 months agree', g.revenue === cur.revenue && g.net === cur.net, [g, cur]);

// ---- cost unknown
const u = d.uncosted.find((x) => x.invoice === inv3);
check('the sale without a cost is listed with its invoice and amount', u && u.sku === 'FD22-NOCOST' && u.total === 500 && u.qty === 1, d.uncosted.slice(0, 3));
check('...and no sale with a cost is', !d.uncosted.some((x) => x.sku === PLA), d.uncosted.filter((x) => x.sku === PLA));
check('the month counts it as sales with no cost', cur.uncosted - cur0.uncosted === 500, [cur0.uncosted, cur.uncosted]);
check('health: this month\'s lines without cost', d.health.uncostedThisMonth >= 1, d.health);

// ---- range: three months
const d3 = await call({ months: 3 });
check('a 3-month range starts two months back', d3.range.months === 3 && d3.range.from < d3.range.to && d3.range.newCustomers >= d.range.newCustomers, d3.range);
const dx = await call({ months: 7 });
check('an odd range falls back to one month', dx.range.months === 1, dx.range);

// ---- returning customer: an older invoice for Karim moves his first purchase back
await sql`update invoices set created_at = created_at - interval '70 days' where business_id = ${B} and invoice_no = ${(await sql`select invoice_no from invoices where business_id = ${B} and customer_name = 'Karim FD22' order by created_at limit 1`)[0].invoice_no}`;
const d4 = await sql.begin((tx) => erpFd22Analytics({ tx, sql, s: { role: 'owner' }, biz: B, now: new Date(), memo: {}, deps: {} }, { months: 1 }));
check('Karim bought before this month: returning, not new', d4.range.returning - d.range.returning === 1 && d.range.newCustomers - d4.range.newCustomers === 1, [d.range, d4.range]);

// ---- health
check('health signals are there', d.health && d.health.monthClose && typeof d.health.stockNoCost === 'number' && 'unplaced' in d.health && 'backup' in d.health, d.health);

// ---- the other business sees none of it
const o = await call({ months: 1 }, B2);
check('the other business: none of these sales', !o.uncosted.some((x) => x.invoice === inv3) && o.months[12].orders === 0 && o.months[12].buyers === 0, o.months[12]);

await done();
