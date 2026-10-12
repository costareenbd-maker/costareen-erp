// Sponsorship rolls owed back by the brand (handlers/creatorportal.js + joint.js poolSponsorMove): at "Handed over" the
// rolls leave my stock or a joint pool as a zero-value move; the claim list counts them; the brand's replacement puts
// them back in the same stock. Quantities only - no money anywhere (movement totals 0, no pool loss).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const R = { asBusiness, owners, tenantDeps: null };
const get = async (q) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': '10.9.0.1' } }), R)).body;
const post = async (q, body) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '10.9.0.1' }, body: JSON.stringify(body) }), R)).body;
const PLA = 'FIL-SUN-PLA-BLA-001';
const stockOf = async (biz, sku) => Number((await sql`select coalesce(ps.stock, 0) as s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${biz} and p.sku = ${sku}`)[0].s);

// the programme: Polymaker; the test product plays a Polymaker one in my stock
await sql`update products set brand = 'Polymaker' where business_id = ${FIX.B} and sku = ${PLA}`;
await owner('erpCreatorProgramme', [{ brand: 'Polymaker' }]);
let r = await owner('erpCreatorSave', [{ name: 'Mr. Setu', brand: 'Polymaker', status: 'active', videos_month: 2, posts_month: 2, rolls_video: 2, open_limit: 5 }]);
const SETU = r.result.creators[0].id;
const T = (await owner('erpCreatorPortalLink', [{ creator_id: SETU }])).result.url.split('t=')[1];

// a joint pool holding a Polymaker product too
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partner9@t.test', ${sql.json({ full_name: 'Partner' })})`;
const B3 = (await sql.begin(async (t) => { await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`; return t`select create_business('Partner Nine') as id`; }))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
await sql`insert into joint_flags (business_id) values (${FIX.B}), (${B3}) on conflict do nothing`;
r = await owner('erpJointStart', [{ action: 'create', name: 'Poly JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Nine', tier: 'retail' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'CA04072', name: 'Polymaker Panchroma PLA Matte Sapphire Blue 1kg', category: 'Filament', brand: 'Polymaker', retail: 2000, wholesale: 1800, floor: 1700, cost: 1000 }]);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'CA04072', qty: 10, unitCost: 1000, paidBy: FIX.B }]);
check('fixture: pool has 10', r.ok && await stockOf(POOL, 'CA04072') === 10, r);
await owner('erpCreatorCatalogAdd', [{ text: 'CA04072, Polymaker Panchroma PLA Matte Sapphire Blue 1kg' }]);

// 1. from my stock: quantity down, no money
const before = await stockOf(FIX.B, PLA);
r = await post('pub=creator&t=' + T, { action: 'request', sku: PLA, qty: 2, title: 'Strength test' });
const REQ1 = r.requests[0].id;
await owner('erpCreatorDecide', [{ id: REQ1, action: 'approve' }]);
r = await owner('erpCreatorSources', [{ id: REQ1 }]);
check('the sources for a stock product: my stock count, no pool holds it', r.ok && r.result.own === before && r.result.pools.length === 0, r);
r = await owner('erpCreatorDecide', [{ id: REQ1, action: 'given', source: 'own' }]);
check('handed over from my stock', r.ok, r);
check('my stock went down by 2', await stockOf(FIX.B, PLA) === before - 2, { before, now: await stockOf(FIX.B, PLA) });
const mv = (await sql`select kind, direction, qty, unit_price, total from stock_movements where business_id = ${FIX.B} and reference like 'Sponsorship:%'`);
check('as a zero-value adjustment (no money)', mv.length === 1 && mv[0].kind === 'ADJUST' && mv[0].direction === 'OUT' && Number(mv[0].total) === 0 && Number(mv[0].unit_price) === 0, mv);
check('no invoice was made', (await sql`select count(*)::int as n from invoices where business_id = ${FIX.B} and note like '%Sponsorship%'`)[0].n === 0, 'ok');

// 2. from the joint pool: the pool's quantity down on my shelf, no money
r = await post('pub=creator&t=' + T, { action: 'link', request_id: REQ1, url: 'https://www.facebook.com/x/posts/1', views: 10 });
r = await post('pub=creator&t=' + T, { action: 'request', sku: 'CA04072', qty: 3, title: 'Matte review' });
const REQ2 = r.requests[0].id;
check('the request is on request (not in my stock)', r.ok && r.requests[0].onRequest === true, r.ok ? r.requests[0] : r);
await owner('erpCreatorDecide', [{ id: REQ2, action: 'approve' }]);
r = await owner('erpCreatorSources', [{ id: REQ2 }]);
check('the sources: not in my stock, the pool holds 10', r.ok && r.result.own === null && r.result.pools.length === 1 && r.result.pools[0].stock === 10, r);
r = await owner('erpCreatorDecide', [{ id: REQ2, action: 'given', source: 'own' }]);
check('my stock refused (not in my products)', !r.ok && /not in your stock/.test(r.error), r);
r = await owner('erpCreatorDecide', [{ id: REQ2, action: 'given', source: 'pool:' + POOL }]);
check('handed over from the joint stock', r.ok, r);
check('the pool went down by 3', await stockOf(POOL, 'CA04072') === 7, await stockOf(POOL, 'CA04072'));
const pm = await sql`select kind, direction, qty, total, held_by from stock_movements where business_id = ${POOL} and reference like 'Sponsorship:%'`;
check('a zero-value move on my shelf in the pool', pm.length === 1 && pm[0].kind === 'ADJUST' && Number(pm[0].total) === 0 && pm[0].held_by === FIX.B, pm);
check('nothing in the pool’s money book', (await sql`select count(*)::int as n from pool_ledger where pool_id = ${POOL} and note ilike '%sponsor%'`.catch(() => [{ n: 0 }]))[0].n === 0, 'ok');

// 3. the claim list
r = await owner('erpCreatorClaims', []);
check('owed back: 2 from my stock + 3 from the pool = 5', r.ok && r.result.open === 5 && r.result.given === 5 && r.result.lines.length === 2 && r.result.lines.some((l) => l.from === 'Poly JV') && r.result.lines.some((l) => l.from === 'My stock'), r);
r = await mgr('erpCreatorClaims', []);
check('a manager cannot see it', !r.ok, r);
const ST = (await owner('erpSponsorLink', [{ brand: 'Polymaker' }])).result.url.split('t=')[1];
r = await get('pub=sponsor&t=' + ST);
check('the brand sees the same list: 5 to replace, by product', r.ok && r.claims.open === 5 && r.claims.bySku.length === 2, r.ok ? r.claims : r);

// 4. the brand's shipment replaces them: back into the same stock, no money
const pLine = (await owner('erpCreatorClaims', [])).result.lines.find((l) => l.from === 'Poly JV');
r = await owner('erpCreatorReplace', [{ id: pLine.id, qty: 2, note: 'PI 2026-11' }]);
check('2 of 3 replaced: back in the pool', r.ok && await stockOf(POOL, 'CA04072') === 9 && r.result.open === 3, r);
r = await owner('erpCreatorReplace', [{ id: pLine.id, qty: 5 }]);
check('more than is open is refused', !r.ok, r);
const oLine = (await owner('erpCreatorClaims', [])).result.lines.find((l) => l.from === 'My stock');
r = await owner('erpCreatorReplace', [{ id: oLine.id }]);
check('the whole line replaced: back in my stock', r.ok && await stockOf(FIX.B, PLA) === before && r.result.open === 1, r);
const back = await sql`select kind, direction, total from stock_movements where reference like 'Sponsorship replaced%'`;
check('replacements are zero-value too', back.length === 2 && back.every((m) => m.direction === 'IN' && Number(m.total) === 0), back);
r = await get('pub=sponsor&t=' + ST);
check('the brand sees 4 replaced, 1 to go', r.ok && r.claims.replaced === 4 && r.claims.open === 1, r.ok ? r.claims : r);

// 5. "not from our stock": nothing moves, nothing owed
r = await post('pub=creator&t=' + T, { action: 'link', request_id: REQ2, url: 'https://www.facebook.com/x/posts/2', views: 10 });
r = await post('pub=creator&t=' + T, { action: 'request', sku: 'CA04072', qty: 1, title: 'Direct from the brand' });
const REQ3 = r.requests[0].id;
await owner('erpCreatorDecide', [{ id: REQ3, action: 'approve' }]);
r = await owner('erpCreatorDecide', [{ id: REQ3, action: 'given', source: 'none' }]);
check('not from our stock: given, nothing moves, nothing owed', r.ok && await stockOf(POOL, 'CA04072') === 9 && (await owner('erpCreatorClaims', [])).result.open === 1, r);
await done();
