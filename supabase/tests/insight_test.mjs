// FilaDash merge P3: System Check and Analytics (handlers/insight.js).
// Run: TEST_SCRIPT=insight_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, color, weight_g) values
  (${B}, 'IN-RED', 'Insight Red', 'Filaments', 'T', 'PLA', 0, 300, 'Active', 'Red', 1300),
  (${B}, 'IN-OLD', 'Insight Old', 'Filaments', 'T', 'PLA', 0, 300, 'Active', 'Grey', 1300)`;
let r = await mgr('erpReceiveShipment', [{ reference: 'IN-1', mode: 'bdt', totalBdt: 1000, lines: [{ sku: 'IN-RED', qty: 10 }] }]);
r = await mgr('erpReceiveShipment', [{ reference: 'IN-OLD', mode: 'bdt', totalBdt: 1000, lines: [{ sku: 'IN-OLD', qty: 10 }] }]);
await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'IN-RED', qty: 4 }], payMode: 'full' }]);

// ---- System Check
r = await sales('erpSystemCheck', []);
check('sales staff do not run it', !r.ok, r);
r = await owner('erpSystemCheck', []);
check('it runs', r.ok && r.result.checks.length >= 10, r);
const st = (id) => (r.result.checks.find((c) => c.id === id) || {}).status;
check('lots = stock, lot arithmetic, no negative stock, one net profit: all pass', st('S1') === 'pass' && st('S2') === 'pass' && st('S3') === 'pass' && st('P1') === 'pass', r.result.checks.filter((c) => c.status !== 'pass'));
check('invoices add up, shares within 100%', st('M1') === 'pass' && st('C1') === 'pass' && st('C2') === 'pass', r.result.checks);

// break things on purpose: it must notice
await sql`update stock_lots set qty_left = qty_left + 1 where business_id = ${B} and reference = 'IN-1'`;
const inv = (await sql`select invoice_no from invoices where business_id = ${B} and invoice_no not like 'RTN-%' order by created_at desc limit 1`)[0].invoice_no;
await sql`update invoices set grand_total = grand_total + 50 where business_id = ${B} and invoice_no = ${inv}`;
r = await owner('erpSystemCheck', []);
check('a lot that does not add up fails S1 and S2', st('S1') === 'fail' && st('S2') === 'fail' && /IN-1/.test(r.result.checks.find((c) => c.id === 'S2').detail), r.result.checks.filter((c) => c.status === 'fail'));
check('an invoice that does not add up fails M1, naming it', st('M1') === 'fail' && r.result.checks.find((c) => c.id === 'M1').detail.includes(inv), r.result.checks.find((c) => c.id === 'M1'));
check('the counts', r.result.counts.fail >= 3, r.result.counts);
await sql`update stock_lots set qty_left = qty_left - 1 where business_id = ${B} and reference = 'IN-1'`;
await sql`update invoices set grand_total = grand_total - 50 where business_id = ${B} and invoice_no = ${inv}`;

// ---- Analytics
await sql`update stock_lots set received_at = now() - interval '120 days' where business_id = ${B} and reference = 'IN-OLD'`;
r = await sales('erpAnalytics', []);
check('sales staff do not see analytics', !r.ok, r);
r = await owner('erpAnalytics', []);
check('it runs', r.ok, r);
const roi = r.result.roi.find((x) => x.reference === 'IN-1');
check('shipment ROI: profit after holding on what it cost', roi && roi.landed === 1000 && roi.roi === Math.round(roi.net / 1000 * 1000) / 10, roi);
const dead = r.result.dead.find((x) => x.reference === 'IN-OLD');
check('dead stock: on the shelf 120 days, never sold, 10 units worth 1000', dead && dead.units === 10 && dead.value === 1000 && dead.lastSale === 'never' && dead.days >= 119, r.result.dead);
check('...IN-1 is not dead (sold, and new)', !r.result.dead.some((x) => x.reference === 'IN-1'), 0);
check('colours of the last 90 days', r.result.colours.some((c) => c.colour === 'Red' && c.units === 4), r.result.colours);
check('12 months of revenue, gross, net', r.result.growth.length === 12 && 'net' in r.result.growth[11], r.result.growth.length);

await done();
