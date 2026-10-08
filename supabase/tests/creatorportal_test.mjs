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
const post = async (q, body, ip, auth) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || '10.0.0.1', ...(auth ? { authorization: auth } : {}) }, body: JSON.stringify(body) }), R)).body;
const getAs = async (q, auth) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': '10.0.0.2', authorization: auth } }), R)).body;
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

// ---- accounts: the join link, joining, the password e-mail, the session, the profile, the owner's review
r = await owner('erpCreatorProgramme', []);
check('the join link carries only a code (the neutral address live)', r.ok && /^https:\/\/[^/]*\/creator\?p=[A-Z0-9]{10}$/.test(r.result.url) && /^data:image/.test(r.result.qr), r);
const CODE = r.result.code;
r = await owner('erpCreatorProgramme', []);
check('the same code every time', r.ok && r.result.code === CODE, r);
r = await get('pub=creator&p=' + CODE);
check('the programme front page: shop and the brand (from the first creator)', r.ok && r.shop.name && r.brands.includes('Polymaker'), r);
r = await owner('erpCreatorProgramme', [{ brand: 'Bambu Lab' }]);
check('the owner names the programme brand', r.ok && r.result.brand === 'Bambu Lab', r);
r = await get('pub=creator&p=' + CODE);
check('the join page shows it', r.ok && r.brands[0] === 'Bambu Lab', r);
await owner('erpCreatorProgramme', [{ brand: 'Polymaker' }]);
r = await get('pub=creator&p=NOPE');
check('a wrong code is refused', !r.ok, r);
deps.resets.length = 0;
r = await post('pub=creator', { action: 'signup', p: CODE, name: 'Rana', email: 'Rana@Example.com', phone: '01711111111' });
check('joined: a creator row (applied), a login, the choose-your-password e-mail to the creator page', r.ok && r.joined && deps.resets.length === 1 && deps.resets[0].email === 'rana@example.com' && /\/creator$/.test(deps.resets[0].to), r.ok ? deps.resets : r);
r = await post('pub=creator', { action: 'signup', p: CODE, name: 'Xy', email: 'rana@example.com', phone: '01711111111' });
check('joining again with the same e-mail: no second row, a fresh link', r.ok && r.again && deps.resets.length === 2, r);
r = await post('pub=creator', { action: 'signup', p: CODE, name: 'Y', email: 'bad', phone: '01711111111' });
check('a bad e-mail is refused', !r.ok, r);
r = await owner('erpCreators', [{}]);
const rana = r.result.creators.find((c) => c.name === 'Rana');
check('the owner sees him as applied, with a login, e-mail and phone', rana && rana.status === 'applied' && rana.hasLogin && rana.email === 'rana@example.com' && rana.whatsapp === '01711111111' && rana.brand === 'Polymaker', rana);
const ranaUser = (await sql`select user_id from erp_creators where id = ${rana.id}`)[0].user_id;
const AUTH = 'Bearer owner:' + ranaUser;
r = await getAs('pub=creator', AUTH);
check('signed in: his page, application under review, profile not done, cannot request', r.ok && r.creator.name === 'Rana' && r.creator.status === 'applied' && r.creator.profileDone === false && r.canRequest === false && /reviewed/.test(r.why), r);
r = await getAs('pub=creator', 'Bearer owner:00000000-0000-0000-0000-000000000000');
check('a login without a creator profile is refused', !r.ok, r);
r = await get('pub=creator');
check('no session, no token: please sign in', !r.ok && /sign in/i.test(r.error), r);
r = await post('pub=creator', { action: 'profile', channels: [], city: 'Dhaka' }, '10.0.0.2', AUTH);
check('a profile without a channel is refused', !r.ok, r);
r = await post('pub=creator', { action: 'profile', channels: [{ platform: 'YouTube', name: 'Rana 3D', count: 2000, url: 'youtube.com/@rana' }] }, '10.0.0.2', AUTH);
check('a link without https:// is refused', !r.ok && /https/.test(r.error), r);
r = await post('pub=creator', { action: 'profile', channels: [{ platform: 'YouTube', name: 'Rana 3D', count: 2300, url: 'https://youtube.com/@rana' }, { platform: 'Facebook group', name: '3D Printing Bangladesh', count: 12000, url: 'https://facebook.com/groups/3dbd' }], niche: '3D printing', city: 'Dhaka', about: 'Makers and students', whatsapp: '01711111111' }, '10.0.0.2', AUTH);
check('the profile is saved and marked done; the one-line strings are derived from the channels', r.ok && r.creator.profileDone === true && r.creator.channels.length === 2 && r.creator.followers === 'YouTube 2,300 · Facebook group 12,000' && r.creator.platforms === 'YouTube, Facebook group' && /Rana 3D \(YouTube\)/.test(r.creator.handle) && r.canRequest === false, r);
r = await owner('erpCreatorSave', [{ id: rana.id, name: 'Rana', brand: 'Polymaker', status: 'active', videos_month: 2, posts_month: 2, rolls_video: 2, trial_until: '2026-12-31', code: 'RANA10' }]);
check('the owner activates him with the terms', r.ok && r.result.creators.find((c) => c.id === rana.id).status === 'active', r);
r = await getAs('pub=creator', AUTH);
check('now he can request', r.ok && r.canRequest === true && r.creator.code === 'RANA10', r);
r = await post('pub=creator', { action: 'request', sku: PLA, qty: 2, title: 'Group review' }, '10.0.0.2', AUTH);
check('a request through the session', r.ok && r.requests.length === 1, r);
r = await owner('erpCreatorEvents', [{ creator_id: rana.id }]);
check('joined, profile and request are on his trail', r.ok && ['creator:joined', 'creator:profile', 'creator:requested'].every((x) => r.result.events.some((e) => e.who + ':' + e.what === x)), r.result.events.map((e) => e.who + ':' + e.what));
// forgot: always the same answer
deps.resets.length = 0;
r = await post('pub=creator', { action: 'forgot', email: 'rana@example.com' });
check('forgot: a link goes out', r.ok && r.sent && deps.resets.length === 1, r);
r = await post('pub=creator', { action: 'forgot', email: 'nobody@example.com' }, '10.0.0.3');
check('forgot for an unknown e-mail: same answer, nothing sent', r.ok && r.sent && deps.resets.length === 1, r);
// the owner invites a hand-added creator
deps.resets.length = 0;
r = await owner('erpCreatorInvite', [{ creator_id: setu, email: 'setu@example.com' }]);
check('invite: a login and the e-mail for the hand-added creator', r.ok && r.result.sent && deps.resets.length === 1, r);
r = await owner('erpCreatorInvite', [{ creator_id: setu, email: 'rana@example.com' }]);
check('an e-mail another creator uses is refused', !r.ok, r);


// a one-time sign-in link to send on WhatsApp instead of the e-mail
deps.links.length = 0;
r = await owner('erpCreatorSave', [{ name: 'Mr. Robin', brand: 'Polymaker', videos_month: 2, posts_month: 2, rolls_video: 2 }]);
const robin2 = r.result.creators.find((c) => c.name === 'Mr. Robin').id;
r = await owner('erpCreatorInvite', [{ creator_id: robin2, email: 'Robin@Example.com', mode: 'link' }]);
check('the link comes back (nothing mailed), it leads to the creator page, his login is made', r.ok && /type=recovery/.test(r.result.link) && /creator/.test(decodeURIComponent(r.result.link)) && deps.links.length === 1 && deps.links[0].email === 'robin@example.com', r);
r = await owner('erpCreators', [{}]);
check('he now has a login and his e-mail on the card', r.ok && r.result.creators.find((c) => c.id === robin2).hasLogin && r.result.creators.find((c) => c.id === robin2).email === 'robin@example.com', r);
r = await mgr('erpCreatorInvite', [{ creator_id: robin2, email: 'robin@example.com', mode: 'link' }]);
check('a manager cannot make it', !r.ok, r);
const ownerMail = (await sql`select email from auth.users where id = ${FIX.U.owner}`)[0].email;
r = await owner('erpCreatorInvite', [{ creator_id: robin2, email: ownerMail, mode: 'link' }]);
check('never for an e-mail that signs in to an ERP (would change that password)', !r.ok && /ERP/.test(r.error), r);
r = await owner('erpCreatorEvents', [{ creator_id: robin2 }]);
check('the link is on his trail', r.ok && r.result.events.some((e) => e.what === 'sign-in link'), r);

// the owner's flow: only an e-mail -> an applied creator + a sign-in link; he fills his profile; approve; preview
deps.links.length = 0;
r = await owner('erpCreatorInvite', [{ email: 'Newbie@Example.com', mode: 'link' }]);
check('e-mail only: a creator is made (applied, programme brand) and the link comes back', r.ok && r.result.created > 0 && /type=recovery/.test(r.result.link) && deps.links.length === 1, r);
const NEWID = r.result.created;
r = await owner('erpCreators', [{}]);
const nb = r.result.creators.find((c) => c.id === NEWID);
check('he is listed as applied, with a login, name from the e-mail until he types his own', nb && nb.status === 'applied' && nb.hasLogin && nb.name === 'newbie' && nb.email === 'newbie@example.com', nb);
r = await owner('erpCreatorInvite', [{ email: 'newbie@example.com', mode: 'link' }]);
check('the same e-mail again: the same creator, a fresh link, no second row', r.ok && r.result.creator_id === NEWID && !r.result.created, r);
const nbUser = (await sql`select user_id from erp_creators where id = ${NEWID}`)[0].user_id;
r = await getAs('pub=creator', 'Bearer owner:' + nbUser);
check('he signs in: profile first', r.ok && r.creator.needProfile === true && r.canRequest === false, r);
r = await post('pub=creator', { action: 'profile', name: 'Mr. Newbie', whatsapp: '01799999999', channels: [{ platform: 'Facebook profile', name: 'Newbie Prints', count: 900, url: 'https://facebook.com/newbie' }] }, '10.0.0.4', 'Bearer owner:' + nbUser);
check('his own name and phone are saved with the profile', r.ok && r.creator.name === 'Mr. Newbie' && r.creator.whatsapp === '01799999999' && r.creator.profileDone, r);
r = await mgr('erpCreatorApprove', [{ creator_id: NEWID }]);
check('a manager cannot approve', !r.ok, r);
r = await owner('erpCreatorApprove', [{ creator_id: NEWID }]);
check('approved: active', r.ok && r.result.status === 'active', r);
r = await getAs('pub=creator', 'Bearer owner:' + nbUser);
check('he can request now', r.ok && r.creator.status === 'active' && r.canRequest === true, r);
r = await owner('erpCreatorPreview', [{ creator_id: NEWID }]);
check('preview: his page read-only and the brand page', r.ok && /creator\?t=.+&preview=1$/.test(r.result.creator) && /sponsor\?t=/.test(r.result.sponsor) && r.result.brand === 'Polymaker', r);
r = await owner('erpCreatorApprove', [{ creator_id: NEWID, action: 'decline' }]);
check('declined: stopped', r.ok && r.result.status === 'stopped', r);
await done();
