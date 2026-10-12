// Stage N3: the Print Doctor's community parts - votes, members' cases with a guide's answer, tips with credit,
// settings that worked (approved, confirmed), the platform admin as the first guide.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, deps, fnDir, files } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) } }), R)).body;
const post = async (q, body, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) }, body: JSON.stringify(body) }), R)).body;
const PNG = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(300)]).toString('base64');
const photos = () => files.list().filter((k) => k.startsWith('public/doctor/'));

// 1. the page's data, empty
let r = await get('pub=doctor');
check('the doctor data: no tips, no votes, no settings yet, the material list', r.ok && r.tips.length === 0 && Object.keys(r.votes).length === 0 && r.settings.length === 0 && r.materials.includes('PETG'), r);

// 2. votes
r = await post('pub=doctorvote', { problem: 'Not A Problem!', helped: true });
check('a vote needs a problem id', !r.ok, r);
r = await post('pub=doctorvote', { problem: 'stringing', helped: true }, '203.0.113.1');
check('yes: counted', r.ok && r.yes === 1 && r.no === 0, r);
r = await post('pub=doctorvote', { problem: 'stringing', helped: false }, '203.0.113.1');
check('the same address again: the latest answer counts, not both', r.ok && r.yes === 0 && r.no === 1, r);
r = await post('pub=doctorvote', { problem: 'stringing', helped: true }, '203.0.113.2');
check('another address: added', r.ok && r.yes === 1 && r.no === 1, r);
r = await get('pub=doctor');
check('the page sees the counts', r.votes.stringing && r.votes.stringing.yes === 1 && r.votes.stringing.no === 1, r.votes);

// 3. a member's case
const good = (o) => ({ problem: 'warping', printer: 'Ender-3 V3 SE', material: 'PLA', story: 'A 200 mm flat tray lifted at two corners after an hour, PLA at 200/60.', tried: 'Cleaned the bed, added a brim', name: 'Sumon', contact: '01712345678', consent: true, photo: { data: PNG }, ...(o || {}) });
r = await post('pub=doctorcase', good({ story: 'short' }));
check('a case needs a story', !r.ok && /sentence/i.test(r.error), r);
r = await post('pub=doctorcase', good({ name: '' }));
check('...and a first name', !r.ok && /name/i.test(r.error), r);
r = await post('pub=doctorcase', good({ consent: false }));
check('...and consent', !r.ok && /consent/i.test(r.error), r);
r = await post('pub=doctorcase', good({ photo: { data: Buffer.alloc(400).toString('base64') } }));
check('a photo that is not an image is refused', !r.ok && /not a JPEG/i.test(r.error), r);
r = await post('pub=doctorcase', good());
check('sent: a case link', r.ok && /\/doctor\?c=[A-Za-z0-9_-]{16,}$/.test(r.caseUrl), r);
const CASE = r.caseUrl.split('c=')[1], CASE_ID = r.id;
check('the photo is on file', photos().length === 1 && photos()[0].startsWith('public/doctor/' + CASE_ID + '/'), photos());
r = await get('pub=doctorcase&t=' + CASE);
check('the sender sees his case: waiting, no answer yet', r.ok && r.status === 'new' && r.story.startsWith('A 200 mm') && r.reply === '' && /^https:\/\/files\.test\//.test(r.photo), r);
check('...but not his own contact echoed to a page', !('contact' in r));
r = await get('pub=doctorcase&t=short');
check('a broken case link is refused', !r.ok, r);
r = await post('pub=doctorcase', good({ story: 'Second case: a PETG part came off the bed half-way, glue stick used.', name: 'Rina', photo: null }), '203.0.113.5');
check('a case without a photo is fine', r.ok, r);
const CASE2_ID = r.id;

// 4. the guide (platform admin)
r = await mgr('erpPlatformDoctor', []);
check('a manager is not the guide', !r.ok, r);
r = await owner('erpPlatformDoctor', []);
check('the admin sees both cases, the new ones first, with the photo and the contact', r.ok && r.result.cases.length === 2 && r.result.newCases === 2 && r.result.cases.some((c) => c.id === CASE_ID && c.contact === '01712345678' && /files\.test/.test(c.photo)) && r.result.pendingSettings === 0, r.ok ? r.result.newCases : r);
r = await owner('erpPlatformDoctorCase', [{ id: CASE_ID, reply: 'Hi' }]);
check('an answer must say something', !r.ok, r);
r = await owner('erpPlatformDoctorCase', [{ id: CASE_ID, reply: 'Your bed is probably too cold for a tray that size: try 65 C, a 10 mm brim, and no part fan for the first 5 layers.' }]);
check('answered (not published)', r.ok && r.result.answered && !r.result.tipId, r);
r = await get('pub=doctorcase&t=' + CASE);
check('the sender sees the answer', r.ok && r.status === 'answered' && /65 C/.test(r.reply) && r.answered, r);
r = await get('pub=doctor');
check('nothing published yet', r.tips.length === 0);
r = await owner('erpPlatformDoctorCase', [{ id: CASE_ID, reply: 'Bed 65 C, brim 10 mm, fan off for 5 layers fixed it.', publish: true, tip: 'Big flat trays: bed 65 C, brim 10 mm, fan off for the first 5 layers.', credit: 'Sumon, Mirpur' }]);
check('answered and published as a tip', r.ok && r.result.tipId, r);
const TIP = r.result.tipId;
r = await get('pub=doctor');
check('the page shows the tip under "warping" with the credit', r.tips.length === 1 && r.tips[0].problem === 'warping' && /brim 10 mm/.test(r.tips[0].text) && r.tips[0].credit === 'Sumon, Mirpur', r.tips);
r = await get('pub=doctorcase&t=' + CASE);
check('the sender sees "published"', r.status === 'published');
r = await owner('erpPlatformDoctorTipRemove', [{ id: TIP }]);
check('the tip can be taken down', r.ok && (await get('pub=doctor')).tips.length === 0, r);

// 5. settings that worked
r = await post('pub=doctorsettings', { printer: 'A1 mini', material: 'Wood', nozzle: 210, bed: 60, name: 'Rina' });
check('the material must be from the list', !r.ok && /material/i.test(r.error), r);
r = await post('pub=doctorsettings', { printer: 'A1 mini', material: 'PETG', nozzle: 400, bed: 60, name: 'Rina' });
check('a nozzle temperature out of range is refused', !r.ok && /150 and 350/.test(r.error), r);
r = await post('pub=doctorsettings', { printer: 'A1 mini', material: 'PETG', nozzle: 245, bed: 75, name: '' });
check('a name is needed', !r.ok && /name/i.test(r.error), r);
r = await post('pub=doctorsettings', { printer: 'A1 mini', material: 'PETG', brand: 'Sunlu', nozzle: 245, bed: 75, speed: '80', cooling: '40%', retraction: '0.8 mm', notes: 'Dry 6 h first; glue stick.', name: 'Rina' });
check('sent: pending', r.ok && r.pending, r);
const SET = r.id;
r = await get('pub=doctor');
check('not on the page before approval', r.settings.length === 0);
r = await owner('erpPlatformDoctor', []);
check('the admin sees it pending', r.result.pendingSettings === 1 && r.result.settings[0].status === 'pending' && r.result.settings[0].brand === 'Sunlu', r.result.settings);
r = await owner('erpPlatformDoctorSettings', [{ id: SET, action: 'approve' }]);
check('approved', r.ok && r.result.status === 'approved', r);
r = await get('pub=doctor');
check('now on the page with the numbers and the credit', r.settings.length === 1 && r.settings[0].nozzle === 245 && r.settings[0].bed === 75 && r.settings[0].name === 'Rina' && r.settings[0].confirms === 0, r.settings);
r = await post('pub=doctorconfirm', { id: SET }, '203.0.113.7');
check('"works for me too": 1', r.ok && r.confirms === 1, r);
r = await post('pub=doctorconfirm', { id: SET }, '203.0.113.7');
check('the same address again: not counted twice', r.ok && r.already, r);
r = await post('pub=doctorconfirm', { id: SET }, '203.0.113.8');
check('another address: 2', r.ok && r.confirms === 2, r);
r = await owner('erpPlatformDoctorSettings', [{ id: SET, action: 'remove' }]);
r = await post('pub=doctorconfirm', { id: SET }, '203.0.113.9');
check('removed settings cannot be confirmed', !r.ok, r);
check('...and are off the page', (await get('pub=doctor')).settings.length === 0);

// 6. the admin removes a case: photo gone, link dead
r = await owner('erpPlatformDoctorCase', [{ id: CASE_ID, remove: true }]);
check('case removed: photo deleted, the case link is dead', r.ok && photos().length === 0 && !(await get('pub=doctorcase&t=' + CASE)).ok, r);
r = await owner('erpPlatformDoctor', []);
check('the admin list no longer shows it', r.result.cases.length === 1 && r.result.cases[0].id === CASE2_ID, r.result.cases.length);

// 7. a flood is slowed down
let last = null;
for (let i = 0; i < 6; i++) last = await post('pub=doctorcase', good({ consent: false }), '203.0.113.20');
check('the sixth case from one address in an hour is refused', !last.ok && /Too many/.test(last.error), last);
await done();
