// Stage N8: the design desk - a buyer posts a sketch, designers offer, he chooses, the designer delivers the file,
// he accepts and rates, and the file goes to "Get it printed"; repair-part requests are the same with kind 'repair'.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir, files } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
let N = 0;
const ip = () => '198.51.100.' + (++N % 250);
const get = async (q, addr) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': addr || ip() } }), R)).body;
const post = async (q, body, addr) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': addr || ip() }, body: JSON.stringify(body) }), R)).body;

// 1. the front: empty desk
let r = await get('pub=design');
check('the front: no designers yet, counts', r.ok && r.designers.length === 0 && r.open === 0 && /designer I choose/.test(r.consent), r);

// 2. designers join
r = await post('pub=design', { want: 'join', name: 'Tanvir', phone: '01811111111', city: 'Dhaka', link: 'https://www.printables.com/@tanvir', skills: 'Fusion 360, FreeCAD', about: 'Mechanical parts and brackets.', consent: false });
check('joining needs the consent tick', !r.ok && /Tick/.test(r.error), r);
r = await post('pub=design', { want: 'join', name: 'Tanvir', phone: '01811111111', city: 'Dhaka', link: 'https://www.printables.com/@tanvir', skills: 'Fusion 360, FreeCAD', about: 'Mechanical parts and brackets.', consent: true });
check('Tanvir joined: a desk link and a profile', r.ok && /design\?d=[A-Za-z0-9_-]{16,}$/.test(r.deskUrl) && /design\?p=tanvir-[a-z0-9]{4}$/.test(r.profileUrl), r);
const D1 = r.d, SLUG1 = r.slug;
r = await post('pub=design', { want: 'join', name: 'Tanvir', phone: '01811111111', city: 'Dhaka', consent: true });
check('the same number cannot join twice', !r.ok && /already/.test(r.error), r);
r = await post('pub=design', { want: 'join', name: 'Mita', phone: '01822222222', city: 'Chattogram', skills: 'Blender', consent: true });
const D2 = r.d;
r = await get('pub=design');
check('the front lists both designers, no phone numbers', r.designers.length === 2 && !JSON.stringify(r.designers).includes('0181') && r.designers[0].rating.count === 0, r.designers);
r = await get('pub=design&p=' + SLUG1);
check('a public profile: name, city, skills, link, no work yet', r.ok && r.designer.name === 'Tanvir' && r.designer.skills === 'Fusion 360, FreeCAD' && r.work.length === 0 && !('phone' in r.designer), r);

// 3. the buyer starts a repair-part request with a photo
r = await post('pub=design', { want: 'start', fileName: 'knob.exe', fileSize: 10 });
check('photos, drawings and model files only', !r.ok && /photo/i.test(r.error), r);
r = await post('pub=design', { want: 'start', fileName: 'broken knob.JPG', fileSize: 250000 });
check('started: a request link and an upload address for the photo', r.ok && /design\?t=[A-Za-z0-9_-]{16,}$/.test(r.requestUrl) && r.upload && /files\.test\/upload\/public\/design\//.test(r.upload.url) && /\/sketch\.jpg$/.test(r.upload.path), r);
const T = r.t;
const good = (o) => ({ t: T, action: 'post', kind: 'repair', title: 'Washing-machine knob', what: 'The timer knob of a Samsung WA70 broke; the D-shaft is 6 mm, the knob was 38 mm across. Photo attached.', size: '38 mm across, 6 mm D-shaft', deadline: 'within a week', budget: 'around 300', city: 'Dhaka', name: 'Sumon', phone: '01712345678', consent: true, ...(o || {}) });
r = await post('pub=design', good({ what: 'knob' }));
check('a description is needed', !r.ok && /Describe/.test(r.error), r);
r = await post('pub=design', good({ consent: false }));
check('consent needed', !r.ok && /Tick/.test(r.error), r);
r = await post('pub=design', good());
check('posted: DR number, open', r.ok && /^DR-\d{6}-[A-Z0-9]{4}$/.test(r.reqNo) && r.status === 'open', r);
const NO = r.reqNo;
r = await get('pub=design&t=' + T);
check('the buyer sees his request: repair part, photo link, no offers', r.ok && r.kind === 'repair' && r.status === 'open' && /files\.test/.test(r.fileUrl) && r.offers.length === 0 && r.printUrl === '', r);

// 4. designers see the desk without the buyer's name or number; offers
r = await get('pub=design&d=' + D1);
check('Tanvir’s desk: the open request with city, size, photo - and no name or phone', r.ok && r.requests.length === 1 && r.requests[0].reqNo === NO && r.requests[0].city === 'Dhaka' && /files\.test/.test(r.requests[0].fileUrl) && !JSON.stringify(r.requests).includes('Sumon') && !JSON.stringify(r.requests).includes('01712345678') && r.me.name === 'Tanvir' && r.me.phone === '01811111111', r);
const ID = r.requests[0].id;
r = await post('pub=design', { d: D1, action: 'offer', id: ID, price: 0 });
check('an offer needs a price', !r.ok, r);
r = await post('pub=design', { d: D1, action: 'offer', id: ID, price: 350, days: 2, note: 'I can model it from the photo and the shaft size.' });
check('Tanvir offered 350 in 2 days', r.ok && r.result === undefined && r.offered, r);
r = await post('pub=design', { d: D2, action: 'offer', id: ID, price: 300, days: 3 });
r = await post('pub=design', { d: D1, action: 'offer', id: ID, price: 320, days: 2, note: 'final' });
check('offering again replaces', r.ok && (await get('pub=design&d=' + D1)).requests[0].mine.price === 320, r);
r = await get('pub=design&t=' + T);
check('the buyer sees two offers with names, skills, ratings - no designer ids', r.offers.length === 2 && r.offers.find((o) => o.designer === 'Tanvir').price === 320 && r.offers.find((o) => o.designer === 'Mita').rating.count === 0 && !('designerId' in r.offers[0]), r.offers);
const OFFER = r.offers.find((o) => o.designer === 'Tanvir').id;

// 5. choose: both sides get contact; Mita's offer is passed
r = await post('pub=design', { t: T, action: 'choose', offerId: OFFER });
check('chosen Tanvir: taken, his contact', r.ok && r.status === 'taken' && r.designer.name === 'Tanvir' && r.designer.phone === '01811111111' && r.price === 320, r);
r = await get('pub=design&t=' + T);
check('the buyer’s page shows the designer and the passed offer', r.status === 'taken' && r.designer.phone === '01811111111' && r.offers.find((o) => o.designer === 'Mita').status === 'passed', r);
r = await get('pub=design&d=' + D2);
check('for Mita: off the open list, nothing under jobs', r.requests.length === 0 && r.jobs.length === 0, r);
r = await get('pub=design&d=' + D1);
check('for Tanvir: the job with the buyer’s name and number', r.jobs.length === 1 && r.jobs[0].name === 'Sumon' && r.jobs[0].phone === '01712345678' && r.jobs[0].price === 320 && r.jobs[0].out === null, r.jobs);
r = await post('pub=design', { d: D2, action: 'deliverStart', id: ID, fileName: 'knob.stl', fileSize: 1000 });
check('Mita cannot deliver on Tanvir’s job', !r.ok && /not given to you/.test(r.error), r);

// 6. deliver the file, changes, deliver again, accept, rate
r = await post('pub=design', { t: T, action: 'accept' });
check('accepting waits for a file', !r.ok, r);
r = await post('pub=design', { d: D1, action: 'deliverStart', id: ID, fileName: 'knob v1.STL', fileSize: 5000 });
check('a signed upload for the delivered file', r.ok && /files\.test\/upload\/public\/design\/.*\/out\/v[a-z0-9]+\.stl$/.test(r.upload.url) && /^v[a-z0-9]+\.stl$/.test(r.stored), r);
let stored = r.stored;
r = await post('pub=design', { d: D1, action: 'delivered', id: ID, stored, fileSize: 5000, note: 'Knob with a 6 mm D-hole, 38 mm, 2 mm walls. Print in PETG.' });
check('delivered', r.ok && r.status === 'delivered', r);
r = await get('pub=design&t=' + T);
check('the buyer sees the file, the note, Accept / changes, and a print link', r.status === 'delivered' && /\/out\//.test(r.out.url) && /PETG/.test(r.out.note) && /print\?from=/.test(r.printUrl), r);
r = await post('pub=design', { t: T, action: 'changes', note: 'The hole is round, the shaft is D-shaped: please add the flat.' });
check('changes asked: back with the designer', r.ok && r.status === 'taken', r);
r = await get('pub=design&d=' + D1);
check('Tanvir sees the change note', /flat/.test(r.jobs[0].changeNote), r.jobs[0]);
r = await post('pub=design', { d: D1, action: 'deliverStart', id: ID, fileName: 'knob v2.stl', fileSize: 5200 });
stored = r.stored;
r = await post('pub=design', { d: D1, action: 'delivered', id: ID, stored, fileSize: 5200, note: 'Flat added.' });
check('delivered again, the change note is cleared', r.ok && (await get('pub=design&t=' + T)).changeNote === '', r);
r = await post('pub=design', { t: T, action: 'rate', stars: 5 });
check('rating waits for acceptance', !r.ok, r);
r = await post('pub=design', { t: T, action: 'accept' });
check('accepted: done', r.ok && r.status === 'done', r);
r = await post('pub=design', { t: T, action: 'rate', stars: 5, text: 'Fits perfectly.' });
check('rated 5', r.ok && r.rated, r);
r = await get('pub=design&p=' + SLUG1);
check('the profile shows 1 job done, 5 stars, the work with its title', r.designer.rating.done === 1 && r.designer.rating.stars === 5 && r.work.length === 1 && r.work[0].title === 'Washing-machine knob' && r.work[0].stars === 5, r);

// 7. Get it printed takes the delivered file
const { fromDesign } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'designdesk.js')));
// put bytes where the browser's PUT would have put them
const key = files.list().find((k) => /\/out\/v[a-z0-9]+\.stl$/.test(k) && k.endsWith(stored));
check('the delivered file lives under public/design/<id>/out/', !!key, files.list());
await deps.storage.save('public', key.split('/').slice(1, -1).join('/'), stored, new TextEncoder().encode('solid knob\nendsolid knob'), 'model/stl');
r = await post('pub=printjob', { want: 'start', from: T });
check('a print job started from the design: the file copied, no upload needed', r.ok && r.upload === null && r.from && r.from.reqNo === NO && /\/print\?t=/.test(r.jobUrl), r);
const PT = r.t;
r = await get('pub=printjob&t=' + PT);
check('the print job carries the design file', r.fileName === 'file.stl' && /files\.test/.test(r.fileUrl), r);
check('the copied bytes are the design file', new TextDecoder().decode(files.get(files.list().find((k) => /printjobs\/.*\/file\.stl$/.test(k))).bytes).startsWith('solid knob'));
r = await post('pub=printjob', { t: PT, action: 'post', name: 'Sumon', phone: '01712345678', city: 'Dhaka', material: 'PETG', qty: 1, notes: 'Knob from the design desk, ' + NO, consent: true });
check('posted on the Get-it-printed board', r.ok && r.status === 'open', r);

// 8. a plain design request without a file, closing; the platform admin's view
r = await post('pub=design', { want: 'start' });
const T2 = r.t;
r = await post('pub=design', { t: T2, action: 'post', kind: 'personal', title: 'Name sign "Rina"', what: 'A desk name sign, about 15 cm wide, two colours if possible, modern letters.', city: 'Sylhet', name: 'Rina', phone: '01799999999', consent: true });
check('a request without a picture', r.ok && r.status === 'open', r);
r = await post('pub=design', { t: T2, action: 'close' });
check('the buyer closes it', r.ok && r.status === 'closed' && (await get('pub=design&d=' + D1)).requests.length === 0, r);
r = await sales('erpPlatformDesign', []);
check('a sales user is not the platform admin', !r.ok, r);
r = await owner('erpPlatformDesign', []);
check('the admin sees designers with phones and every request', r.ok && r.result.designers.length === 2 && r.result.designers[0].phone && r.result.requests.length === 2 && r.result.counts.done === 1 && r.result.counts.designers === 2, r);
const MITA = r.result.designers.find((d) => d.name === 'Mita').id;
r = await owner('erpPlatformDesignAct', [{ designerId: MITA, block: true }]);
check('Mita blocked', r.ok && r.result.status === 'blocked' && !(await get('pub=design&d=' + D2)).ok && (await get('pub=design')).designers.length === 1, r);
r = await owner('erpPlatformDesignAct', [{ designerId: MITA, block: false }]);
r = await owner('erpPlatformDesignAct', [{ designerId: MITA, newLink: true }]);
check('a new link for a designer who lost his', r.ok && /design\?d=/.test(r.result.deskUrl) && (await get('pub=design&d=' + D2)).ok, r);

// 9. a flood is slowed down
let last = null;
for (let i = 0; i < 11; i++) last = await post('pub=design', { want: 'start' }, '203.0.113.70');
check('the eleventh start from one address in an hour is refused', !last.ok && /Too many/.test(last.error), last);
await done();
