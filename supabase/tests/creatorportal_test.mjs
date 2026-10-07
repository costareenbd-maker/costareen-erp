// The creator portal (handlers/creatorportal.js): permanent links, the creator's page, a filament request, the owner's
// approval and handover, links pasted into the project, YouTube numbers fetched (verified), typed numbers (reported),
// the gate on the next request, the sponsor's dashboard, the audit trail.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, deps, fnDir, web } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
const get = async (q, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': ip || '10.0.0.1' } }), R)).body;
const post = async (q, body, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || '10.0.0.1' }, body: JSON.stringify(body) }), R)).body;
const PLA = 'FIL-SUN-PLA-BLA-001';

// the YouTube API, faked: one video with known numbers
let ytCalls = 0;
web.on(/googleapis\.com\/youtube\/v3\/videos/, (url) => { ytCalls++; const ids = new URL(url).searchParams.get('id').split(','); return { status: 200, body: { items: ids.map((id) => ({ id, statistics: { viewCount: '4321', likeCount: '210', commentCount: '33' } })) } }; });

let r = await owner('erpCreatorSave', [{ name: 'Mr. Setu', platforms: 'YouTube, Facebook', brand: 'Polymaker', code: 'SETU10', videos_month: 2, posts_month: 2, rolls_video: 2, filament: 'general, from stock' }]);
const setu = r.result.creators[0].id;
r = await owner('erpCreatorPortalLink', [{ creator_id: setu }]);
check('the creator gets a permanent link with a QR', r.ok && /creator\?t=[A-Za-z0-9_-]{16,}/.test(r.result.url) && /^data:image/.test(r.result.qr), r);
const CT = r.result.url.split('t=')[1];
r = await owner('erpCreatorPortalLink', [{ creator_id: setu }]);
check('the same link every time', r.ok && r.result.url.split('t=')[1] === CT, r);
r = await mgr('erpCreatorPortalLink', [{ creator_id: setu }]);
check('a manager cannot issue it', !r.ok, r);
r = await owner('erpSponsorLink', [{ brand: 'Polymaker' }]);
check('the brand gets its own link', r.ok && /sponsor\?t=/.test(r.result.url), r);
const ST = r.result.url.split('t=')[1];

// the creator's page
r = await get('pub=creator&t=' + CT);
check('the creator page: his terms, the shop, filament in stock to pick from, can request', r.ok && r.creator.name === 'Mr. Setu' && r.creator.rolls_video === 2 && r.shop.name && r.stock.some((s) => s.sku === PLA) && r.canRequest === true, r);
r = await get('pub=creator&t=' + ST);
check('the sponsor token does not open the creator page', !r.ok, r);
r = await get('pub=creator&t=' + CT.slice(0, 12) + 'XXXXXXXXXXXX');
check('a wrong token is refused', !r.ok, r);

// a request
r = await post('pub=creator&t=' + CT, { action: 'request', sku: PLA, qty: 2, title: 'Strength test: PLA vs PLA+' });
check('the request is in, waiting; no second request until answered', r.ok && r.requests.length === 1 && r.requests[0].status === 'requested' && r.canRequest === false && /waiting/.test(r.why), r);
const REQ = r.requests[0].id;
r = await post('pub=creator&t=' + CT, { action: 'request', sku: PLA, qty: 2, title: 'Another' });
check('a second request while one waits is refused', !r.ok && /waiting/.test(r.error), r);
r = await post('pub=creator&t=' + CT, { action: 'request', sku: 'NOPE', qty: 2, title: 'x' });
check('a product not in stock cannot be requested', !r.ok, r);

// the owner sees it, approves, hands over
r = await owner('erpCreatorRequests', []);
check('the owner sees the request waiting with the creator name', r.ok && r.result.waiting.length === 1 && r.result.waiting[0].creator === 'Mr. Setu' && r.result.waiting[0].title === 'Strength test: PLA vs PLA+', r);
r = await mgr('erpCreatorDecide', [{ id: REQ, action: 'approve' }]);
check('a manager cannot decide', !r.ok, r);
r = await owner('erpCreatorDecide', [{ id: REQ, action: 'approve', qty: 2, note: 'Collect from the shop' }]);
check('approved with a note', r.ok && r.result.approved.length === 1 && r.result.approved[0].owner_note === 'Collect from the shop' && r.result.waiting.length === 0, r);
r = await get('pub=creator&t=' + CT);
check('the creator sees "approved" and the note', r.ok && r.requests[0].status === 'approved' && r.requests[0].owner_note === 'Collect from the shop' && r.canRequest === false, r);
r = await owner('erpCreatorDecide', [{ id: REQ, action: 'given' }]);
check('given: value from the product (2 x 1350), project now open for links', r.ok && r.result.open.length === 1 && r.result.open[0].value === 2700 && r.result.open[0].status === 'given', r);
r = await owner('erpCreators', [{}]);
check('the filament line is on the creator (2 rolls, 2700) with the project title', r.ok && r.result.creators[0].ships.length === 1 && r.result.creators[0].ships[0].value === 2700 && /Project: Strength test/.test(r.result.creators[0].ships[0].note), r.ok ? r.result.creators[0].ships : r);
r = await get('pub=creator&t=' + CT);
check('the creator cannot request again until the link is in', r.ok && r.canRequest === false && /Paste the link/.test(r.why), r);

// the link: a YouTube video -> numbers fetched from YouTube, verified
await owner('erpYoutubeKey', [{ key: 'yt-test-key' }]);
r = await post('pub=creator&t=' + CT, { action: 'link', request_id: REQ, url: 'https://youtu.be/dQw4w9WgXcQ' });
check('the link closes the project, numbers came from YouTube (verified), next request allowed', r.ok && r.requests[0].status === 'done' && r.posts.length === 1 && r.posts[0].views === 4321 && r.posts[0].verified === true && r.posts[0].platform === 'YouTube' && r.posts[0].kind === 'video' && r.canRequest === true && ytCalls === 1, r);
const POST = r.posts[0].id;
r = await post('pub=creator&t=' + CT, { action: 'numbers', post_id: POST, views: 9 });
check('verified numbers cannot be typed over', !r.ok && /YouTube itself/.test(r.error), r);
r = await post('pub=creator&t=' + CT, { action: 'link', request_id: REQ, url: 'https://www.facebook.com/setu/posts/123', views: 800, likes: 40, leads: 2 });
check('a Facebook post on the same project: reported numbers, platform guessed', r.ok && r.posts.length === 2 && r.posts.find((p) => p.platform === 'Facebook').verified === false && r.posts.find((p) => p.platform === 'Facebook').leads === 2, r);
const FB = r.posts.find((p) => p.platform === 'Facebook').id;
r = await post('pub=creator&t=' + CT, { action: 'numbers', post_id: FB, views: 1500, likes: 90, comments: 12, leads: 5 });
check('reported numbers updated by the creator', r.ok && r.posts.find((p) => p.id === FB).views === 1500 && r.posts.find((p) => p.id === FB).leads === 5, r);
r = await post('pub=creator&t=' + CT, { action: 'link', url: 'not a link' });
check('a bad link is refused', !r.ok, r);

// the nightly fetch refreshes only old ones; the owner can force it
r = await owner('erpCreatorRefresh', []);
check('the owner forces a YouTube refresh (one video)', r.ok && r.result.fetched === 1 && ytCalls === 2, r);

// the audit trail
r = await owner('erpCreatorEvents', [{ creator_id: setu }]);
const trail = r.result.events.map((e) => e.who + ':' + e.what).reverse();
check('every step is on record with who did it', r.ok && trail.join(' ') === 'creator:requested owner:approved owner:given creator:linked youtube:fetched creator:linked creator:numbers youtube:fetched', trail);
check('the creator’s steps carry the address they came from', r.result.events.some((e) => e.who === 'creator' && e.ip === '10.0.0.1'), r.result.events);

// the sponsor's dashboard
r = await get('pub=sponsor&t=' + ST);
check('the brand sees its creators, the totals, verified count, the project with its links and the filament lines', r.ok && r.brand === 'Polymaker' && r.creators.length === 1 && r.creators[0].totals.rolls === 2 && r.creators[0].totals.views === 5821 && r.creators[0].totals.verified === 1 && r.creators[0].projects[0].posts.length === 2 && r.creators[0].ships[0].value === 2700 && r.months.length === 6 && r.months[5] === new Date().toISOString().slice(0, 7) && r.creators[0].series[5].views === 5821 && r.shop.name, r);
r = await get('pub=sponsor&t=' + CT);
check('the creator token does not open the sponsor page', !r.ok, r);
r = await post('pub=sponsor&t=' + ST, { action: 'request' });
check('the sponsor page takes no writes', !r.ok, r);

// a paused creator cannot request
await owner('erpCreatorSave', [{ id: setu, name: 'Mr. Setu', brand: 'Polymaker', status: 'paused', videos_month: 2, posts_month: 2, rolls_video: 2 }]);
r = await post('pub=creator&t=' + CT, { action: 'request', sku: PLA, qty: 2, title: 'x' });
check('paused: no requests', !r.ok && /paused/.test(r.error), r);
await done();
