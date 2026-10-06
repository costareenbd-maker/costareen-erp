// Stage N4: the print-business kit - printers, opened spools, print jobs with their true cost, the quote calculator,
// the business's public quote link and its inbox.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) } }), R)).body;
const post = async (q, body, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) } , body: JSON.stringify(body) }), R)).body;
const FIL = 'FIL-SUN-PLA-BLA-001';
const B = 'self:' + FIX.B;
const stockOf = async (sku) => (await sql`select coalesce(ps.stock, 0)::numeric as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${FIX.B} and p.sku = ${sku}`)[0].s;

// 1. rates
let r = await sales('erpPrintSettingsSave', [{ kwh: 10 }]);
check('only a manager changes the rates', !r.ok, r);
r = await mgr('erpPrintSettingsSave', [{ kwh: 10, labourHr: 150, failPct: 10, marginPct: 40, pack: 20, quoteOn: true, quoteText: 'We print PLA and PETG, 0.2 mm layers.' }]);
check('rates saved', r.ok && r.result.kwh === 10 && r.result.labourHr === 150 && r.result.quoteOn === true && /PETG/.test(r.result.quoteText), r);
r = await mgr('erpPrintSettingsSave', [{ marginPct: 900 }]);
check('a silly margin is refused', !r.ok && /Margin/.test(r.error), r);

// 2. a printer
r = await mgr('erpPrinterSave', [{ name: 'A' }]);
check('a printer needs a name', !r.ok, r);
r = await sales('erpPrinterSave', [{ name: 'A1 left', cost: 30000 }]);
check('only a manager adds printers', !r.ok, r);
r = await mgr('erpPrinterSave', [{ name: 'A1 left', model: 'Bambu A1', cost: 30000, lifeHours: 5000, powerW: 150, maintenanceHr: 0 }]);
check('printer saved: wear 6 taka an hour', r.ok && r.result.printer.wearHr === 6 && r.result.printers.length === 1, r);
const PRN = r.result.printer.id;
r = await mgr('erpPrinterSave', [{ id: PRN, name: 'A1 left', model: 'Bambu A1', cost: 30000, lifeHours: 5000, powerW: 150, maintenanceHr: 0.5, status: 'active' }]);
check('printer changed', r.ok && r.result.printer.maintenanceHr === 0.5, r);

// 3. a spool off the shelf
const stock0 = Number(await stockOf(FIL));
r = await sales('erpSpoolOpen', [{ sku: 'NOPE-1' }]);
check('an unknown product cannot be opened', !r.ok, r);
r = await sales('erpSpoolOpen', [{ sku: FIL, netG: 10 }]);
check('grams per spool must make sense', !r.ok && /between 50/.test(r.error), r);
r = await sales('erpSpoolOpen', [{ sku: FIL, netG: 1000, note: 'left printer' }]);
check('spool opened: one unit off the shelf, its cost on the spool, 0.9 taka a gram', r.ok && r.result.spool.remainingG === 1000 && r.result.spool.cost === 900 && Math.abs(r.result.spool.costPerG - 0.9) < 1e-9 && r.result.open.length === 1 && Number(await stockOf(FIL)) === stock0 - 1, r);
const SP = r.result.spool.id;
check('the filament list for opening shows the product with its stock', r.result.filaments.some((f) => f.sku === FIL && f.stock === stock0 - 1), r.result.filaments);

// 4. the calculator
r = await sales('erpPrintCost', [{ printerId: PRN, spoolId: SP, grams: 50, hours: 2, labourMin: 20, extraCost: 0 }]);
check('cost: material 45, machine 16 (6 wear + 1.5 power + 0.5 maintenance per hour), labour 50, packaging 20 = 131; failure allowance 6.1; suggested 195',
  r.ok && r.result.material === 45 && r.result.machine === 16 && r.result.labour === 50 && r.result.pack === 20 && r.result.total === 131 && r.result.failAllowance === 6.1 && r.result.suggested === 195 && r.result.hourly === 8, r);
r = await sales('erpPrintCost', [{ sku: FIL, netG: 1000, grams: 100, hours: 0, labourMin: 0 }]);
check('without a spool the product cost per 1000 g is used: 90 + packaging 20', r.ok && r.result.material === 90 && r.result.total === 110, r);

// 5. a job through the board
r = await sales('erpPrintJobSave', [{ customer: 'Karim' }]);
check('a job needs a title', !r.ok, r);
r = await sales('erpPrintJobSave', [{ title: 'Phone stand', customer: 'Karim', phone: '01712345678', printerId: PRN, spoolId: SP, plannedG: 50, plannedH: 2, labourMin: 20, price: 250 }]);
check('job made: queued, numbered, the planned cost on it, the spool untouched', r.ok && /^PJ-\d{6}-01$/.test(r.result.job.jobNo) && r.result.job.status === 'queued' && r.result.job.cost.total === 131 && r.result.job.profit === 119 && r.result.job.material === 'Sunlu PLA Black' && r.result.job.printer === 'A1 left', r);
const J1 = r.result.job.jobNo;
check('...the spool still has 1000 g', (await sales('erpSpools', [])).result.open[0].remainingG === 1000);
r = await sales('erpPrintJobSave', [{ jobNo: J1, status: 'printing' }]);
check('started', r.ok && r.result.job.status === 'printing' && r.result.job.started, r);
r = await sales('erpPrintJobSave', [{ jobNo: J1, status: 'ready', actualG: 55, actualH: 2.5, failedG: 10 }]);
check('ready: the true cost from 65 g and 2.5 h - material 58.5, machine 20, labour 50, pack 20 = 148.5; profit 101.5', r.ok && r.result.job.status === 'ready' && r.result.job.cost.material === 58.5 && r.result.job.cost.machine === 20 && r.result.job.cost.total === 148.5 && r.result.job.profit === 101.5 && r.result.job.done, r);
check('...65 g left the spool', (await sales('erpSpools', [])).result.open[0].remainingG === 935);
r = await sales('erpPrintJobSave', [{ jobNo: J1, actualG: 50 }]);
check('a correction: 5 g back on the spool, the cost follows', r.ok && r.result.job.cost.material === 54 && (await sales('erpSpools', [])).result.open[0].remainingG === 940, r);
r = await sales('erpPrintJobSave', [{ jobNo: J1, status: 'delivered', invoiceNo: 'INV-1' }]);
check('delivered, with the invoice number', r.ok && r.result.job.status === 'delivered' && r.result.job.delivered && r.result.job.invoiceNo === 'INV-1', r);
r = await sales('erpPrintJobSave', [{ jobNo: J1, status: 'queued' }]);
check('sales cannot reopen a delivered job', !r.ok, r);
r = await mgr('erpPrintJobSave', [{ jobNo: J1, status: 'ready' }]);
check('a manager can', r.ok && r.result.job.status === 'ready', r);
await mgr('erpPrintJobSave', [{ jobNo: J1, status: 'delivered' }]);

// 6. a failed job and a spool that runs out
r = await sales('erpPrintJobSave', [{ title: 'Vase', printerId: PRN, spoolId: SP, plannedG: 80, plannedH: 3, status: 'failed', failedG: 30 }]);
check('a failed job: the wasted grams leave the spool and cost money', r.ok && r.result.job.status === 'failed' && r.result.job.cost.material === 27 && (await sales('erpSpools', [])).result.open[0].remainingG === 910, r);
r = await sales('erpSpoolSet', [{ id: SP, remainingG: 20 }]);
check('remaining grams corrected by hand', r.ok && r.result.open[0].remainingG === 20, r);
r = await sales('erpPrintJobSave', [{ title: 'Keychains', spoolId: SP, plannedG: 30, status: 'ready', actualG: 30, actualH: 1 }]);
check('a job bigger than what was left: the spool is finished at 0 with a note', r.ok && (await sales('erpSpools', [])).result.open.length === 0 && /ran 10 g short/.test((await sales('erpSpools', [])).result.finished[0].note), r);
r = await sales('erpPrintKit', []);
check('the kit overview: rates, the printer, no open spool, the jobs with counts, the quote link', r.ok && r.result.printers.length === 1 && r.result.open.length === 0 && r.result.counts.delivered === 1 && r.result.counts.failed === 1 && r.result.counts.ready === 1 && /\/quote\?b=self%3A/.test(r.result.quoteUrl) && r.result.settings.marginPct === 40, r.ok ? r.result.counts : r);
r = await sales('erpPrintJobs', [{ status: 'failed' }]);
check('the list by status', r.ok && r.result.jobs.length === 1 && r.result.jobs[0].title === 'Vase', r);

// 7. the public quote link
r = await get('pub=printquote&b=nonsense');
check('a broken quote link is refused', !r.ok, r);
r = await get('pub=printquote&b=' + encodeURIComponent(B));
check('the quote page: the shop, its text, the filaments it has', r.ok && r.shop.name && /PETG/.test(r.text) && r.materials.length >= 1, r);
await mgr('erpPrintSettingsSave', [{ quoteOn: false }]);
r = await get('pub=printquote&b=' + encodeURIComponent(B));
check('switched off: "not taking print requests"', !r.ok && /not taking/.test(r.error), r);
await mgr('erpPrintSettingsSave', [{ quoteOn: true }]);
const good = (o) => ({ b: B, name: 'Rina', phone: '01799999999', material: 'PLA', colour: 'Black', qty: 2, notes: 'Two phone stands like the picture, 15 cm tall.', link: 'https://drive.google.com/x', consent: true, ...(o || {}) });
r = await post('pub=printquote', good({ name: '' }));
check('a request needs a name', !r.ok, r);
r = await post('pub=printquote', good({ phone: '123' }));
check('...a real mobile number', !r.ok && /mobile/i.test(r.error), r);
r = await post('pub=printquote', good({ notes: '', link: '' }));
check('...a description or a file link', !r.ok && /Describe/.test(r.error), r);
r = await post('pub=printquote', good({ consent: false }));
check('...and the consent line', !r.ok && /Tick/.test(r.error), r);
r = await post('pub=printquote', good());
check('sent: a request number and a request link', r.ok && /^PR-\d{6}-01$/.test(r.reqNo) && /\/quote\?t=[A-Za-z0-9_-]{16,}&b=self%3A/.test(r.requestUrl), r);
const T1 = /t=([A-Za-z0-9_-]+)/.exec(r.requestUrl)[1];
r = await sales('erpPrintRequests', []);
check('the inbox has it, new, with the customer’s details', r.ok && r.result.requests.length === 1 && r.result.requests[0].status === 'new' && r.result.requests[0].name === 'Rina' && r.result.requests[0].qty === 2 && r.result.requests[0].link === 'https://drive.google.com/x', r);
const REQ = r.result.requests[0].id;
r = await get('pub=printreq&t=' + T1 + '&b=' + encodeURIComponent(B));
check('the customer sees the request: new, no price yet, the shop', r.ok && r.status === 'new' && r.price === null && r.shop.name && !('email' in r) && !('id' in r), r);
r = await post('pub=printreq', { t: T1, b: B, action: 'accept' });
check('nothing to accept yet', !r.ok, r);
r = await sales('erpPrintRequestAnswer', [{ id: REQ, price: 0 }]);
check('a quote needs a price', !r.ok, r);
r = await sales('erpPrintRequestAnswer', [{ id: REQ, price: 300, note: 'PLA black, 2 pieces, ready in 2 days' }]);
check('quoted 300', r.ok && r.result.status === 'quoted', r);
r = await get('pub=printreq&t=' + T1 + '&b=' + encodeURIComponent(B));
check('the customer sees the price and the note', r.ok && r.status === 'quoted' && r.price === 300 && /2 days/.test(r.quoteNote), r);
r = await post('pub=printreq', { t: T1, b: B, action: 'accept' });
check('accepted', r.ok && r.status === 'accepted', r);
r = await sales('erpPrintRequestJob', [{ id: REQ, printerId: PRN, plannedG: 60, plannedH: 3 }]);
check('"Make a job": the job carries the customer, the price and the request', r.ok && r.result.job.customer === 'Rina' && r.result.job.phone === '01799999999' && r.result.job.price === 300 && /PR-/.test(r.result.job.notes) && /drive\.google/.test(r.result.job.notes) && r.result.job.status === 'queued', r);
r = await sales('erpPrintRequests', []);
check('the request is now a job', r.result.requests[0].status === 'job' && /^PJ-/.test(r.result.requests[0].jobNo), r.result.requests[0]);
r = await sales('erpPrintRequestJob', [{ id: REQ }]);
check('not twice', !r.ok && /already job/.test(r.error), r);
r = await post('pub=printquote', good({ name: 'Jamal', phone: '01788888888', notes: 'A 30 cm sword prop' }));
const REQ2 = (await sales('erpPrintRequests', [])).result.requests.find((x) => x.name === 'Jamal');
r = await sales('erpPrintRequestAnswer', [{ id: REQ2.id, decline: true, note: 'Too big for our printers.' }]);
check('declined with a reason', r.ok && r.result.status === 'declined', r);
r = await get('pub=printreq&t=' + /t=([A-Za-z0-9_-]+)/.exec((await post('pub=printquote', good({ name: 'Zed', phone: '01777777777' }))).requestUrl)[1] + '&b=' + encodeURIComponent(B));
check('a third request, seen by its sender', r.ok && r.name === 'Zed' && r.status === 'new', r);
let last = null;
for (let i = 0; i < 6; i++) last = await post('pub=printquote', good({ consent: false }), '203.0.113.30');
check('a flood of requests from one address is slowed down', !last.ok && /Too many/.test(last.error), last);

// 8. the other business sees nothing of this
check('the other business has no jobs, printers or requests', (await sql`select (select count(*) from print_jobs where business_id = ${FIX.B2}) + (select count(*) from printers where business_id = ${FIX.B2}) + (select count(*) from print_requests where business_id = ${FIX.B2}) as n`)[0].n == 0);
await done();
