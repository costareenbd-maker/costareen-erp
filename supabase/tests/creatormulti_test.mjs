// multi-1 (handlers/creatorportal.js): one creator project can ask for several different filaments. Each filament is
// its own request line (approve / hand over / stock move per line, as before); the lines share a group, one project
// link, and one pasted video link closes the whole project.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
const get = async (q) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': '10.9.1.1' } }), R)).body;
const post = async (q, body) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.1.1' }, body: JSON.stringify(body) }), R)).body;
const PLA = 'FIL-SUN-PLA-BLA-001', PETG = 'POLY-PETG-GRY-1';
const stockOf = async (sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${FIX.B} and p.sku = ${sku}`)[0].s);

await sql`update products set brand = 'Polymaker' where business_id = ${FIX.B} and sku = ${PLA}`;
await mgr('erpSaveProduct', [{ isNew: true, sku: PETG, product_name: 'Polymaker PETG Grey', brand: 'Polymaker', category: 'Filaments', unit: 'Roll', sell_price: 1500, opening_stock: 10 }]);
await owner('erpCreatorProgramme', [{ brand: 'Polymaker' }]);
let r = await owner('erpCreatorSave', [{ name: 'Mr. Multi', brand: 'Polymaker', status: 'active', videos_month: 2, posts_month: 2, rolls_video: 2, open_limit: 1 }]);
const ME = r.result.creators.find((c) => c.name === 'Mr. Multi').id;
const T = (await owner('erpCreatorPortalLink', [{ creator_id: ME }])).result.url.split('t=')[1];

// 1. refusals: the same filament twice, more than the programme allows in all, too many lines
r = await post('pub=creator&t=' + T, { action: 'request', title: 'x', items: [{ sku: PLA, qty: 1 }, { sku: PLA, qty: 1 }] });
check('the same filament twice is refused', r.error && /twice/.test(r.error), r);
r = await post('pub=creator&t=' + T, { action: 'request', title: 'x', items: [{ sku: PLA, qty: 4 }, { sku: PETG, qty: 3 }] });
check('more than 3 x rolls per video in all is refused (6)', r.error && /6 rolls in all/.test(r.error), r);
r = await post('pub=creator&t=' + T, { action: 'request', title: 'x', items: [1, 2, 3, 4, 5, 6].map(() => ({ sku: PLA, qty: 1 })) });
check('more than 5 lines is refused', r.error && /Up to 5/.test(r.error), r);
r = await post('pub=creator&t=' + T, { action: 'request', title: 'x', items: [{ sku: PLA, qty: 1 }, { sku: PETG, qty: 0 }] });
check('a line without rolls is refused', r.error && /How many rolls/.test(r.error), r);
check('nothing was saved by the refusals', (await sql`select count(*)::int as n from erp_creator_requests where creator_id = ${ME}`)[0].n === 0, 'ok');

// 2. two filaments in one project: two lines, one group, one project link
r = await post('pub=creator&t=' + T, { action: 'request', title: 'PLA vs PETG', note: 'grey please', items: [{ sku: PLA, qty: 2 }, { sku: PETG, qty: 1 }] });
check('the request is saved', r.ok !== false && !r.error && r.requests.length === 2, r);
const lines = r.requests.slice().sort((a, b) => a.id - b.id);
check('both lines share the first line’s group', lines[0].group === lines[0].id && lines[1].group === lines[0].id, lines);
check('one project link, on the first line', !!lines[0].go && !lines[1].go, lines);
check('each line keeps its product and rolls', lines[0].product && lines[0].qty === 2 && lines[1].qty === 1 && lines[1].sku === PETG, lines);
check('he cannot ask again while it waits', r.canRequest === false, r.why);
r = await owner('erpCreatorRequests', []);
check('the owner sees two lines waiting', r.ok && r.result.waiting.filter((x) => x.creator_id === ME).length === 2, r);

// 3. the owner decides per line: both handed over from my stock
const p0 = await stockOf(PLA), g0 = await stockOf(PETG);
for (const l of lines) { await owner('erpCreatorDecide', [{ id: l.id, action: 'approve' }]); r = await owner('erpCreatorDecide', [{ id: l.id, action: 'given', source: 'own' }]); check('line ' + l.id + ' handed over', r.ok, r); }
check('each stock went down by its own rolls', await stockOf(PLA) === p0 - 2 && await stockOf(PETG) === g0 - 1, [await stockOf(PLA), await stockOf(PETG)]);
r = await get('pub=creator&t=' + T);
check('one project open without a link (not two)', r.ok && r.canRequest === false && /Paste the link/.test(r.why), r.why);

// 4. one video link closes the whole project
r = await post('pub=creator&t=' + T, { action: 'link', request_id: lines[0].id, url: 'https://www.facebook.com/x/posts/77', views: 5 });
check('the link is saved', r.ok !== false && !r.error, r);
check('both lines are done', r.requests.filter((x) => x.group === lines[0].id).every((x) => x.status === 'done'), r.requests);
const post1 = r.posts.find((p) => p.url.endsWith('/77'));
check('the post names both filaments', post1 && /PETG/.test(post1.product) && post1.product.includes(','), post1);
check('he can ask for the next project', r.canRequest === true, r.why);

// 5. the old single request still works and is its own project
r = await post('pub=creator&t=' + T, { action: 'request', sku: PETG, qty: 1, title: 'PETG only' });
const one = r.requests.find((x) => x.title === 'PETG only');
check('a single request is its own group with its own link', one && one.group === one.id && !!one.go, one);
r = await get('pub=sponsor&t=' + (await owner('erpSponsorLink', [{ brand: 'Polymaker' }])).result.url.split('t=')[1]);
check('the brand page still loads with grouped lines', r.ok && r.creators.some((c) => c.projects.length === 3), r.ok ? r.creators.map((c) => c.projects.length) : r);
await done();
