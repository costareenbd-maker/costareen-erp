// Phase 6: the kept sales log, customers a page at a time, alerts, idle devices.
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const { runJob } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const PLA = 'FIL-SUN-PLA-BLA-001';
const soldOf = async () => (await owner('erpCatalog', [])).result.find((p) => p.sku === PLA).sold;
const count = async () => (await owner('erpSales', [{ limit: 200 }])).result.matched;

// ---------------------------------------------------------------- the kept sales log never serves old books
const s0 = await soldOf(), n0 = await count();
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full' }]);
const INV = r.result.invoiceNo;
check('a sale shows at once', (await soldOf()) === s0 + 2 && (await count()) === n0 + 1, [s0, await soldOf(), n0, await count()]);
check('...and again from the kept copy', (await soldOf()) === s0 + 2 && (await count()) === n0 + 1);
// a change made straight in the database (a timer, an import, a repair) is seen too
await sql`update invoice_lines set qty = qty + 3 where invoice_id = (select id from invoices where invoice_no = ${INV})`;
check('a change made outside the app is seen', (await soldOf()) === s0 + 5, await soldOf());
await sql`update invoices set customer_name = 'Renamed Buyer' where invoice_no = ${INV}`;
r = await owner('erpSales', [{ q: 'Renamed Buyer' }]);
check('an edit to an invoice is seen', r.ok && r.result.rows.length === 1 && r.result.rows[0].id === INV, r.result && r.result.rows);
await sql`delete from invoice_lines where invoice_id = (select id from invoices where invoice_no = ${INV})`;
await sql`delete from invoices where invoice_no = ${INV}`;
check('a removed invoice is gone', (await soldOf()) === s0 && (await count()) === n0, [await soldOf(), await count()]);
// a save that fails half-way leaves nothing behind in the kept copy
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }, { sku: 'NOPE', qty: 1 }], payMode: 'full' }]);
check('a failed save changes nothing', !r.ok && (await soldOf()) === s0 && (await count()) === n0, r);
r = await erpCall(deps, { name: 'erpSales', args: [{ limit: 200 }], authHeader: 'Bearer owner:' + FIX.U.other });
check('another business never gets this one’s rows', r.ok && !r.result.rows.some((o) => o.id === 'INV-1'), r.result && r.result.rows);

// ---------------------------------------------------------------- customers, a page at a time
for (let i = 0; i < 25; i++) {
  await sql`insert into customers (business_id, name, phone, address, total_orders, total_spent)
            values (${FIX.B}, ${'Cust ' + String(i).padStart(2, '0')}, ${i % 5 === 0 ? '' : '0181100' + String(1000 + i)}, 'Dhaka', 0, ${i * 10})`;
}
r = await sales('erpCustomerList', [{ limit: 10 }]);
check('first page: 10 of all, biggest spender first', r.ok && r.result.rows.length === 10 && r.result.total === 26 && r.result.matched === 26 &&
  r.result.rows[0].spent >= r.result.rows[1].spent, r.result);
const all = (await sales('erpCustomers', [])).result;
check('same order as the full list', JSON.stringify(r.result.rows.map((c) => c.row)) === JSON.stringify(all.slice(0, 10).map((c) => c.row)));
r = await sales('erpCustomerList', [{ limit: 10, offset: 20 }]);
check('last page holds the rest', r.ok && r.result.rows.length === 6 && r.result.offset === 20, r.result);
r = await sales('erpCustomerList', [{ q: 'cust 07' }]);
check('search by name', r.ok && r.result.matched === 1 && r.result.rows[0].name === 'Cust 07', r.result);
r = await sales('erpCustomerList', [{ q: '01811001013' }]);
check('search by phone', r.ok && r.result.matched === 1 && r.result.rows[0].name === 'Cust 13', r.result);
r = await sales('erpCustomerList', [{ contact: 'walkin' }]);
check('walk-ins only', r.ok && r.result.matched === 5 && r.result.rows.every((c) => !c.phone), r.result);
r = await sales('erpCustomerList', [{ lapse: 'never' }]);
check('never bought', r.ok && r.result.matched === 25 && !r.result.rows.some((c) => c.name === 'Karim'), r.result.matched);
r = await sales('erpCustomerList', [{ orders: 'repeat' }]);
check('repeat buyers', r.ok && r.result.rows.every((c) => c.orders >= 2), r.result);

// ---------------------------------------------------------------- alerts
r = await mgr('erpAlerts', []);
check('alerts are for shareholders and the owner', !r.ok, r);
r = await owner('erpAlerts', []);
check('nothing to report', r.ok && r.result.count === 0 && r.result.phone === '', r.result);
await erpCall(deps, { name: 'erpHello', args: [], token: { code: '222222', device: 'new-phone', label: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' } });
await sql`insert into erp_errors (business_id, who, role, action, message, build) values (${FIX.B}, 'Timer', 'owner', 'nightly:steadfast', 'Steadfast said no', 'jobs')`;
await sql`insert into erp_errors (business_id, who, role, action, message, build) values (${FIX.B2}, 'Timer', 'owner', 'nightly:backup', 'not ours', 'jobs')`;
r = await owner('erpAlerts', []);
const titles = r.result.alerts.map((a) => a.title);
check('a device waiting and a failed night job', r.ok && r.result.count === 2 && titles.includes('Rina is waiting to be let in') &&
  titles.includes('The nightly Steadfast check failed') && !JSON.stringify(r.result).includes('not ours'), r.result);
r = await owner('erpAlertPhone', [{ phone: '123' }]);
check('alert number must be a real mobile', !r.ok, r);
r = await owner('erpAlertPhone', [{ phone: '01799999999' }]);
check('alert number saved; WhatsApp not linked yet', r.ok && r.result.whatsappReady === false && (await owner('erpAlerts', [])).result.phone === '01799999999', r);

// the timer sends what is new, once
const sent = [];
web.on(/evo\.test\/message\/sendText/, (url, opts) => { sent.push(JSON.parse(opts.body)); return { status: 201, body: { key: { id: 'x' } } }; });
web.on(/evo\.test\/instance\/connectionState/, () => ({ status: 200, body: { instance: { state: 'open' } } }));
r = await owner('erpEvoSetup', [{ url: 'https://evo.test', instance: 'cz', key: 'k-123' }]);
check('fixture: WhatsApp linked', r.ok, r);
let j = await runJob(deps, 'alerts');
check('timer sends both alerts in one message to the owner', sent.length === 1 && sent[0].number === '8801799999999' &&
  /Rina is waiting/.test(sent[0].text) && /Steadfast check failed/.test(sent[0].text) && !/not ours/.test(sent[0].text), [j, sent]);
j = await runJob(deps, 'alerts');
check('...and does not repeat them', sent.length === 1, [j, sent.length]);
await sql`insert into erp_errors (business_id, who, role, action, message, build) values (${FIX.B}, 'Timer', 'owner', 'websync:pull', 'site down', 'jobs')`;
j = await runJob(deps, 'alerts');
check('a new problem is sent on its own', sent.length === 2 && /website orders/.test(sent[1].text) && !/Rina/.test(sent[1].text), sent[1]);
await owner('erpAlertPhone', [{ phone: '' }]);
await sql`delete from erp_alert_sent`;
j = await runJob(deps, 'alerts');
check('no number, nothing sent', sent.length === 2, j);

// ---------------------------------------------------------------- a device unused for 30 days asks again
r = await mgr('erpCatalog', []);
check('a device in use works', r.ok);
await sql`update erp_devices set last_used = now() - interval '31 days', decided_at = now() - interval '90 days', requested_at = now() - interval '90 days' where device_id = 'dev-mgr'`;
r = await mgr('erpCatalog', []);
check('after 30 idle days it is asked for again', !r.ok && /not been used for 30 days/.test(r.error), r);
r = await mgr('erpCatalog', []);
check('...and waits for the owner', !r.ok && /owner has to allow this device/.test(r.error), r);
r = await owner('erpAlerts', []);
check('the owner is told', r.ok && r.result.alerts.some((a) => a.title === 'Mehedi is waiting to be let in'), r.result);
const d = (await owner('erpDevices', [])).result.pending.find((x) => x.name === 'Mehedi');
r = await owner('erpApproveDevice', [d.userId]);
if (!r.ok) r = await owner('erpAllowDevice', [{ userId: d.userId, device: d.id }]);
r = await mgr('erpCatalog', []);
check('allowed again, it works', r.ok, r);

await done();
