// Stage N7: Get it printed - a stranger posts a job with an estimate from his browser, farms offer, he chooses,
// the farm makes a print job and delivers it, the board job is done, he rates the farm.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir, files } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) } }), R)).body;
const post = async (q, body, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) }, body: JSON.stringify(body) }), R)).body;

// 1. start: a job id, the buyer's link, a signed upload
let r = await post('pub=printjob', { want: 'start', fileName: 'virus.exe', fileSize: 100 });
check('only print files, sketches and PDFs', !r.ok && /STL/.test(r.error), r);
r = await post('pub=printjob', { want: 'start', fileName: 'stand.stl', fileSize: 60 * 1024 * 1024 });
check('40 MB at most', !r.ok && /40 MB/.test(r.error), r);
r = await post('pub=printjob', { want: 'start', fileName: 'phone stand v2.STL', fileSize: 120000 });
check('started: the buyer’s link and an upload address for the file', r.ok && /\/print\?t=[A-Za-z0-9_-]{16,}$/.test(r.jobUrl) && r.upload && /files\.test\/upload\//.test(r.upload.url) && r.upload.path === 'printjobs/' + r.upload.path.split('/')[1] + '/file.stl', r);
const T = r.t;
r = await get('pub=printjob&t=' + T);
check('before posting: uploading, nothing else', r.ok && r.status === 'uploading' && r.fileName === 'file.stl', r);

// 2. post
const est = { grams: 42.5, hours: 3.2, low: 350, high: 620, infill: 15, triangles: 12000, box: '80 × 60 × 120 mm', material: 'PLA' };
const good = (o) => ({ t: T, action: 'post', name: 'Sumon', phone: '01712345678', city: 'Dhaka', material: 'PLA', colour: 'Black', qty: 2, notes: 'Two phone stands, 0.2 mm layers, no supports needed.', est, consent: true, ...(o || {}) });
r = await post('pub=printjob', good({ consent: false }));
check('consent needed', !r.ok && /Tick/.test(r.error), r);
r = await post('pub=printjob', good({ phone: '123' }));
check('a real mobile number', !r.ok && /mobile/i.test(r.error), r);
r = await post('pub=printjob', good({ city: '' }));
check('a city, so farms near can offer', !r.ok && /city/i.test(r.error), r);
r = await post('pub=printjob', good());
check('posted: on the board', r.ok && /^GP-\d{6}-[A-Z0-9]{4}$/.test(r.jobNo) && r.status === 'open', r);
const NO = r.jobNo;
r = await get('pub=printjob&t=' + T);
check('the buyer sees his job: open, the estimate, no offers yet', r.ok && r.status === 'open' && r.est.grams === 42.5 && r.est.high === 620 && r.offers.length === 0 && r.qty === 2, r);

// 3. the farm sees the board without the buyer’s name or number
r = await sales('erpBoard', []);
check('the board: the job with city, estimate, file link - and no name or phone', r.ok && r.result.jobs.length === 1 && r.result.jobs[0].jobNo === NO && r.result.jobs[0].city === 'Dhaka' && r.result.jobs[0].est.grams === 42.5 && /files\.test/.test(r.result.jobs[0].fileUrl) && !JSON.stringify(r.result.jobs).includes('Sumon') && !JSON.stringify(r.result.jobs).includes('01712345678') && r.result.jobs[0].offers === 0 && r.result.jobs[0].mine === null, r);
const ID = r.result.jobs[0].id;
check('the farm’s own name on offers: "Farm · city" until its shop is public', r.result.farm.name === 'Farm' || /^Farm/.test(r.result.farm.name), r.result.farm);

// 4. an offer, seen by the buyer with the rating (none yet)
r = await sales('erpBoardOffer', [{ id: ID, price: 0 }]);
check('an offer needs a price', !r.ok, r);
r = await sales('erpBoardOffer', [{ id: ID, price: 500, days: 3, note: 'PLA black, 2 pieces, 3 days' }]);
check('offered 500 in 3 days', r.ok && r.result.offered, r);
r = await sales('erpBoardOffer', [{ id: ID, price: 480, days: 2 }]);
check('offering again replaces the offer', r.ok && (await sales('erpBoard', [])).result.jobs[0].mine.price === 480, r);
r = await get('pub=printjob&t=' + T);
check('the buyer sees one offer: farm, price, days, no rating yet', r.offers.length === 1 && r.offers[0].price === 480 && r.offers[0].days === 2 && r.offers[0].rating.count === 0 && !('source' in r.offers[0]) && !('businessId' in r.offers[0]), r.offers);
r = await sales('erpBoardWithdraw', [{ id: ID }]);
check('withdrawn', r.ok && (await get('pub=printjob&t=' + T)).offers.length === 0, r);
r = await sales('erpBoardOffer', [{ id: ID, price: 490, days: 3, note: 'final' }]);
r = await get('pub=printjob&t=' + T);
const OFFER = r.offers[0].id;

// 5. the buyer chooses; the farm sees the contact; the job becomes a print job
r = await post('pub=printjob', { t: T, action: 'choose', offerId: '00000000-0000-0000-0000-000000000000' });
check('choosing a vanished offer is refused', !r.ok, r);
r = await post('pub=printjob', { t: T, action: 'choose', offerId: OFFER });
check('chosen: taken, the farm’s contact for the buyer', r.ok && r.status === 'taken' && r.price === 490 && r.farm && r.farm.name, r);
r = await get('pub=printjob&t=' + T);
check('the buyer’s page: taken, chosen offer marked', r.status === 'taken' && r.chosen === OFFER && r.offers[0].status === 'chosen' && r.farm.name, r);
r = await sales('erpBoard', []);
check('for the farm: off the open list, under "mine" with the buyer’s name and number', r.result.jobs.length === 0 && r.result.mine.length === 1 && r.result.mine[0].name === 'Sumon' && r.result.mine[0].phone === '01712345678' && r.result.mine[0].price === 490 && r.result.mine[0].status === 'taken', r.result.mine);
r = await mgr('erpPrinterSave', [{ name: 'A1', cost: 30000 }]);
const PRN = r.result.printer.id;
r = await sales('erpBoardTake', [{ id: ID, printerId: PRN }]);
check('"Make a job": a print job with the buyer, the price, the estimate as the plan, the file link in the notes', r.ok && /^PJ-/.test(r.result.job.jobNo) && r.result.job.customer === 'Sumon' && r.result.job.price === 490 && r.result.job.plannedG === 85 && /GP-/.test(r.result.job.notes) && /files\.test/.test(r.result.job.notes), r);
const PJ = r.result.job.jobNo;
r = await sales('erpBoardTake', [{ id: ID }]);
check('not twice', !r.ok && /already print job/.test(r.error), r);
check('the board remembers the farm’s job number', (await sales('erpBoard', [])).result.mine[0].farmJobNo === PJ);

// 6. delivered in the farm’s ERP -> the board job is done -> the buyer rates
r = await post('pub=printjob', { t: T, action: 'rate', stars: 5 });
check('rating waits for delivery', !r.ok && /delivered/.test(r.error), r);
await sales('erpPrintJobSave', [{ jobNo: PJ, status: 'printing' }]);
await sales('erpPrintJobSave', [{ jobNo: PJ, status: 'ready', actualG: 80, actualH: 6 }]);
r = await sales('erpPrintJobSave', [{ jobNo: PJ, status: 'delivered' }]);
check('delivered', r.ok, r);
r = await get('pub=printjob&t=' + T);
check('the board job is done', r.status === 'done' && r.done, r);
r = await post('pub=printjob', { t: T, action: 'rate', stars: 7 });
check('stars 1 to 5', !r.ok, r);
r = await post('pub=printjob', { t: T, action: 'rate', stars: 5, text: 'Clean print, on time.' });
check('rated 5', r.ok && r.rated, r);
r = await sales('erpBoard', []);
check('the farm sees its rating: 5.0 from 1 job', r.result.rating.stars === 5 && r.result.rating.count === 1 && r.result.mine[0].rating.stars === 5, r.result.rating);

// 7. a second job shows the farm’s rating on its offer; closing a job
r = await post('pub=printjob', { want: 'start' });
const T2 = r.t;
r = await post('pub=printjob', { t: T2, action: 'post', name: 'Rina', phone: '01799999999', city: 'Chattogram', notes: 'A sketch will follow on WhatsApp: a small vase about 15 cm.', consent: true });
check('a job without a file, with a description', r.ok && r.status === 'open', r);
const ID2 = (await sales('erpBoard', [])).result.jobs[0].id;
await sales('erpBoardOffer', [{ id: ID2, price: 300 }]);
r = await get('pub=printjob&t=' + T2);
check('the offer carries the farm’s rating', r.offers[0].rating.stars === 5 && r.offers[0].rating.count === 1, r.offers);
r = await post('pub=printjob', { t: T2, action: 'close' });
check('the buyer closes it', r.ok && r.status === 'closed' && (await sales('erpBoard', [])).result.jobs.length === 0, r);
r = await post('pub=printjob', { t: T, action: 'close' });
check('a taken job cannot be closed from the link', !r.ok, r);

// 8. a flood is slowed down
let last = null;
for (let i = 0; i < 11; i++) last = await post('pub=printjob', { want: 'start' }, '203.0.113.60');
check('the eleventh start from one address in an hour is refused', !last.ok && /Too many/.test(last.error), last);
await done();
