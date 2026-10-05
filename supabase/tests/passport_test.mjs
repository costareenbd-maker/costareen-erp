// Stage N1: the Printer Passport register (written by the seller's ERP at the sale, read by anyone),
// the warranty card, and the customer page behind the QR on every invoice.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done, deps, fnDir, pdfs } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const A1 = 'PRT-BAM-A1-001';
const R = { asBusiness, owners, tenantDeps: null };
const pub = async (q, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: ip ? { 'x-forwarded-for': ip } : {} }), R)).body;
const passport = async (sn) => (await sql`select * from erp_passports where serial_norm = ${sn} and source = 'self' order by updated_at desc limit 1`)[0];
const events = async (sn) => (await sql`select e.kind, e.detail from erp_passport_events e join erp_passports p on p.id = e.passport_id where p.serial_norm = ${sn} and p.source = 'self' order by e.id`).map((e) => e.kind + (e.detail && e.detail.status ? ':' + e.detail.status : ''));

// the printer is sold by serial number with 12 months, three units numbered
let r = await mgr('erpSerialSetup', [{ sku: A1, serialised: true, warrantyMonths: 12 }]);
r = await mgr('erpSerialsAdd', [{ sku: A1, serials: ['BL-A1-0001', 'BL-A1-0002', 'BL-A1-0003'] }]);
check('three printers numbered', r.ok && r.result.inStock.length === 3, r);

// 1. a sale writes the passport
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: A1, qty: 1, serials: ['BL-A1-0001'] }], payMode: 'full' }]);
check('sold with its serial', r.ok, r);
const INV1 = r.result.invoiceNo;
let p = await passport('BLA10001');
check('the register has it: verified, sold, 12 months, the seller, the sale date, never the buyer’s name', p && p.status === 'sold' && p.level === 'verified' && Number(p.warranty_months) === 12 && p.warranty_until && p.seller_name === 'Costareen' && p.product_name === 'Bambu A1' && p.customer_key === '1712345678' && !('customer' in p), p);
check('...with a "sold" event', (await events('BLA10001')).join(',') === 'sold');
check('the invoice PDF carries the customer-page QR', /My orders &amp; warranty/.test((pdfs[pdfs.length - 1] || {}).html || ''), (pdfs[pdfs.length - 1] || {}).html ? 'html' : 'no pdf');

// 2. the public check
r = await pub('pub=check&s=bl-a1-0001');
check('anyone can check the serial, spaces and dashes do not matter', r.ok && r.found && r.records.length === 1, r);
let c = r.records[0];
check('it shows the product, the named seller, the sale month, the warranty, verified, not disputed', c.product === 'Bambu A1' && c.seller === 'Costareen' && c.named && c.soldMonth && c.warrantyState === 'active' && c.daysLeft > 300 && c.level === 'verified' && !c.disputed && c.repairs === 0, c);
check('...and nothing about the buyer', !('customer' in c) && !('phone' in c) && !('invoice' in c) && !('invoiceNo' in c) && !('price' in c), Object.keys(c));
r = await pub('pub=check&s=NOPE-999');
check('an unknown serial: not registered', r.ok && !r.found, r);
r = await pub('pub=check&s=AB');
check('too short is refused', !r.ok, r);

// 3. the owner can hide the shop’s name (then it says "Supplier · city")
r = await owner('erpMarketSave', [{ on: false, city: 'Dhaka' }]);
r = await mgr('erpPassportShowSeller', [{ on: false }]);
check('only the owner hides the name', !r.ok, r);
r = await owner('erpPassportShowSeller', [{ on: false }]);
r = await pub('pub=check&s=BL-A1-0001');
check('hidden: "Supplier · Dhaka"', r.records[0].seller === 'Supplier · Dhaka' && !r.records[0].named, r.records[0]);
await owner('erpPassportShowSeller', [{ on: true }]);

// 4. a repair goes on the record (the job number stays private)
r = await sales('erpJobOpen', [{ customer: { name: 'Karim', phone: '01712345678' }, serial: 'BL-A1-0001', problem: 'Nozzle clogged' }]);
check('a repair job on the serial', r.ok, r);
const JOB = r.result.job.jobNo;
r = await pub('pub=check&s=BL-A1-0001');
check('the check counts the repair', r.records[0].repairs === 1 && r.records[0].lastRepair && r.records[0].events.some((e) => e.kind === 'repair' && e.status === 'received'), r.records[0]);
check('...without the job number', JOB && !JSON.stringify(r.records[0]).includes(JOB), JOB);
r = await mgr('erpJobSave', [{ jobNo: JOB, status: 'returned' }]);
check('returned to the customer: on the record too', r.ok && (await events('BLA10001')).includes('repair:returned'), r.ok ? await events('BLA10001') : r);

// 5. a warranty change by a shareholder
await makeShareholder();
r = await shareholder('erpSerialWarranty', [{ serial: 'BL-A1-0001', months: 24, reason: 'Goodwill for a loyal customer' }]);
check('warranty changed to 24 months', r.ok, r);
p = await passport('BLA10001');
check('the register follows', Number(p.warranty_months) === 24 && (await events('BLA10001')).includes('warranty'), p.warranty_months);

// 6. the warranty card
r = await sales('erpWarrantyCard', [{ serial: 'BL-A1-0001' }]);
check('the card: product, serial, sold date, warranty, the check address and its QR', r.ok && r.result.product === 'Bambu A1' && r.result.serial === 'BL-A1-0001' && r.result.sold && r.result.warrantyUntil && /\/check\?s=BL-A1-0001$/.test(r.result.checkUrl) && /^data:image\/svg\+xml;base64,/.test(r.result.qr) && r.result.seller.name, r.ok ? Object.keys(r.result) : r);
r = await sales('erpWarrantyCard', [{ serial: 'NOPE' }]);
check('no card for an unknown serial', !r.ok, r);

// 7. the customer page behind the QR
r = await sales('erpMyLink', [{ phone: '01712345678', name: 'Karim' }]);
check('staff get the customer’s page link (for WhatsApp)', r.ok && /\/my\?t=[A-Za-z0-9_-]{16,}$/.test(r.result.url) && /wa\.me\/8801712345678/.test(r.result.whatsapp), r);
const TOKEN = r.result.url.split('t=')[1];
const r2 = await sales('erpMyLink', [{ phone: '01712345678' }]);
check('the same customer always gets the same link', r2.result.url === r.result.url);
// a second customer, so the page can be checked for leaks
r = await sales('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01811111111' }, items: [{ sku: A1, qty: 1, serials: ['BL-A1-0002'] }], payMode: 'none' }]);
const INV2 = r.result.invoiceNo;
r = await pub('pub=my&t=' + TOKEN);
check('the page: the shop, the customer, his invoices with paid and due, his warranty, a reorder', r.ok && r.seller.name === 'Costareen' && r.customer.name === 'Karim' && r.invoices.length === 1 && r.invoices[0].no === INV1 && r.invoices[0].due === 0 && r.invoices[0].status === 'Paid' &&
  r.warranties.length === 1 && r.warranties[0].serial === 'BL-A1-0001' && r.warranties[0].state === 'active' && /\/check\?s=/.test(r.warranties[0].check) && /Bambu A1/.test(r.reorder.text) && r.totalDue === 0, r);
check('...and not the other customer’s invoice', !JSON.stringify(r).includes(INV2) && !JSON.stringify(r).includes('Rahim'));
r = await pub('pub=my&t=' + TOKEN + '&pdf=' + INV1);
check('his invoice PDF: a link', r.ok && /^https:\/\/files\.test\//.test(r.pdf), r);
r = await pub('pub=my&t=' + TOKEN + '&pdf=' + INV2);
check('someone else’s invoice PDF: refused', !r.ok, r);
r = await pub('pub=my&t=' + TOKEN.slice(0, 10) + 'XXXXXXXXXXXX');
check('a wrong link is refused', !r.ok, r);
r = await pub('pub=my&t=short');
check('a broken link is refused', !r.ok, r);
r = await sales('erpMyLink', [{ phone: '', name: '' }]);
check('a walk-in with no name and no phone has no page', !r.ok, r);
// the second customer owes money: his page says so
const r3 = await sales('erpMyLink', [{ phone: '01811111111' }]);
r = await pub('pub=my&t=' + r3.result.url.split('t=')[1]);
check('a customer who owes: due shown', r.ok && r.customer.name === 'Rahim' && r.invoices[0].due > 0 && r.totalDue === r.invoices[0].due && r.invoices[0].status === 'Due', r);

// 8. the QR can be switched off in the invoice design
r = await mgr('erpInvoiceDesignSave', [{ design: { template: 'wave', show: { myqr: false } } }]);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: A1, qty: 1, serials: ['BL-A1-0003'] }], payMode: 'full' }]);
check('design without the customer QR: the PDF has none', r.ok && !/My orders &amp; warranty/.test((pdfs[pdfs.length - 1] || {}).html || ''));
await mgr('erpInvoiceDesignSave', [{ design: { template: 'modern' } }]);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'FIL-SUN-PLA-BLA-001', qty: 1 }], payMode: 'full' }]);
check('another design draws it again with the QR', r.ok && /My orders &amp; warranty/.test((pdfs[pdfs.length - 1] || {}).html || ''), r.ok ? 'pdf without it' : r);

// 9. a return takes the unit off the road
r = await mgr('erpReturnGoods', [{ invoiceNo: INV2, lines: [{ sku: A1, qty: 1, condition: 'good', serials: ['BL-A1-0002'] }], money: 'due', reason: 'changed mind' }]);
check('returned', r.ok, r);
p = await passport('BLA10002');
check('the register says returned', p && p.status === 'returned' && (await events('BLA10002')).includes('returned'), p && p.status);

// 10. two sellers claiming one serial: disputed
await sql`insert into erp_passports (serial_norm, serial, source, business_id, seller_name, product_name, sold_at, status) values ('BLA10001', 'BL-A1-0001', 'other-co', gen_random_uuid(), 'Another Shop', 'Bambu A1', current_date, 'sold')`;
r = await pub('pub=check&s=BL-A1-0001');
check('two active sales from two sellers: both marked disputed', r.records.length === 2 && r.records.every((x) => x.disputed), r.records.map((x) => x.seller));

// 11. publish everything sold so far (idempotent), and a company on the bridge writes under its own id
r = await sales('erpPassportSync', []);
check('only a manager publishes', !r.ok, r);
r = await mgr('erpPassportSync', []);
check('published: the sold units of this business', r.ok && r.result.published === 2, r);
check('...and the register has no duplicates', (await sql`select count(*)::int n from erp_passports where source = 'self' and business_id = ${FIX.B}`)[0].n === 3);
const had = deps.install; deps.install = { id: 'T-1', bridged: true };
// (the returned unit BL-A1-0002 is back on the shelf and sold again)
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: A1, qty: 1, serials: ['BL-A1-0002'] }], payMode: 'full' }]);
check('a company on the bridge: the passport carries its install id', r.ok && (await sql`select count(*)::int n from erp_passports where serial_norm = 'BLA10002' and source = 'T-1' and status = 'sold'`)[0].n === 1, r);
deps.install = had;

// 12. a scraper is slowed down
let last = null;
for (let i = 0; i < 61; i++) last = await pub('pub=check&s=BL-A1-0001', '203.0.113.9');
check('the 61st check from one address in an hour is refused', !last.ok && /Too many/.test(last.error), last);
await done();
