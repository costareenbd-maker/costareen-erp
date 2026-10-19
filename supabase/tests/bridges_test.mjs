// Posting bridges (handlers/bridges.js): a company key and the provider's key, the accounts a bridge holds, the
// connect links, a network counted as connected through a bridge, posting through each service, pending posts
// finished by the timer, refusals.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const so = await import(pathToFileURL(path.join(fnDir, 'handlers', 'social.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';
deps.render = { url: 'https://render.test/render', key: 'rk' };
deps.social = { redirect: 'https://fn.test/functions/v1/erp?social=back' };
deps.bridges = { uploadpost: 'PROVIDER-UPLOADPOST-KEY' };

const calls = [];
let zAccounts = [], zStatus = 'scheduled';
web.on(/zernio\.com\/api\/v1/, (url, opts) => {
  const h = opts.headers || {}; calls.push({ svc: 'zernio', url, method: opts.method || 'GET', auth: h.Authorization, body: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null });
  if (h.Authorization !== 'Bearer sk_zernio_abcdef') return { status: 401, body: { message: 'bad key' } };
  if (/\/accounts/.test(url)) return { status: 200, body: { accounts: zAccounts } };
  if (/\/profiles$/.test(url)) return { status: 200, body: { profile: { _id: 'ZP1' } } };
  if (/\/connect\/tiktok\?profileId=ZP1/.test(url)) return { status: 200, body: { authUrl: 'https://www.tiktok.com/auth?via=zernio' } };
  if (/\/posts$/.test(url)) return { status: 200, body: { post: { _id: 'ZPOST1', status: 'scheduled' } } };
  if (/\/posts\/ZPOST1$/.test(url)) return { status: 200, body: { post: { _id: 'ZPOST1', status: zStatus, platforms: [{ platform: 'tiktok', externalUrl: 'https://www.tiktok.com/@c/video/99', postId: '99' }] } } };
  return { status: 404, body: {} };
});
let pConns = [], pStatus = 'scheduled';
web.on(/api\.publora\.com/, (url, opts) => {
  const h = opts.headers || {}; calls.push({ svc: 'publora', url, method: opts.method || 'GET', key: h['x-publora-key'], body: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null });
  if (h['x-publora-key'] !== 'publora-key-123456') return { status: 401, body: { message: 'bad key' } };
  if (/platform-connections/.test(url)) return { status: 200, body: { success: true, connections: pConns } };
  if (/create-post/.test(url)) return { status: 200, body: { postGroupId: 'PG1' } };
  if (/get-post\/PG1/.test(url)) return { status: 200, body: { postGroupId: 'PG1', status: pStatus, posts: [{ platform: 'linkedin', status: pStatus, postedId: 'LI9', permalink: 'https://www.linkedin.com/feed/update/LI9' }] } };
  return { status: 404, body: {} };
});
let uProfiles = [];
web.on(/api\.upload-post\.com/, (url, opts) => {
  const h = opts.headers || {}; calls.push({ svc: 'uploadpost', url, method: opts.method || 'GET', auth: h.Authorization, body: opts.body && typeof opts.body === 'string' ? JSON.parse(opts.body) : null, form: opts.body && typeof opts.body.get === 'function' ? Object.fromEntries([...opts.body.keys()].map((k) => [k, opts.body.getAll(k)])) : null });
  if (h.Authorization !== 'Apikey PROVIDER-UPLOADPOST-KEY') return { status: 401, body: { success: false, message: 'bad key' } };
  if (/\/users$/.test(url) && opts.method === 'POST') { uProfiles.push({ username: opts.body ? JSON.parse(opts.body).username : '', social_accounts: {} }); return { status: 201, body: { success: true, profile: uProfiles[uProfiles.length - 1] } }; }
  if (/\/users$/.test(url)) return { status: 200, body: { success: true, plan: 'free', profiles: uProfiles } };
  if (/generate-jwt/.test(url)) return { status: 200, body: { success: true, access_url: 'https://app.upload-post.com/connect?token=JWT1' } };
  if (/\/api\/upload$/.test(url)) return { status: 200, body: { success: true, results: { youtube: { success: true, url: 'https://www.youtube.com/shorts/UP1', post_id: 'UP1' } }, usage: { count: 1, limit: 10 } } };
  if (/\/api\/upload_photos$/.test(url)) return { status: 200, body: { success: true, results: { pinterest: { success: false, error: 'board missing' } } } };
  return { status: 404, body: {} };
});
await mgr('erpSocialRules', [{ save: '', maxDay: 10 }]);

// ---- 1. the provider's bridge is there by itself; a company adds its own with a key checked by the service
let r = await sales('erpSocialBridges', [{}]);
check('the provider\'s Upload-Post bridge shows for the company without any key pasted', r.ok && r.result.bridges.some((b) => b.service === 'uploadpost' && b.provider) && r.result.services.length === 3, r);
r = await mgr('erpSocialBridgeAdd', [{ service: 'zernio', key: 'sk_zernio_abcdef' }]);
check('only the owner adds a bridge', !r.ok, r);
r = await owner('erpSocialBridgeAdd', [{ service: 'zernio', key: 'wrong-key-000000' }]);
check('a wrong key is refused by the service', !r.ok && /Zernio said 401/.test(r.error), r);
r = await owner('erpSocialBridgeAdd', [{ service: 'zernio', key: 'sk_zernio_abcdef' }]);
const Z = r.ok && r.result.bridges.find((b) => b.service === 'zernio');
check('Zernio added: a profile made for this company, no accounts yet, the key sealed', Z && !Z.provider && Z.accounts.length === 0 && calls.some((c) => c.svc === 'zernio' && /\/profiles$/.test(c.url)) && !JSON.stringify(r.result).includes('sk_zernio'), r);
r = await owner('erpSocialBridgeAdd', [{ service: 'zernio', key: 'sk_zernio_abcdef' }]);
check('a second account of the same service is refused', !r.ok && /already added/.test(r.error), r);
r = await owner('erpSocialBridgeAdd', [{ service: 'publora', key: 'publora-key-123456' }]);
check('Publora added', r.ok && r.result.bridges.some((b) => b.service === 'publora'), r);

// ---- 2. connect links; the accounts read back; the Posts form sees the networks as connected
r = await owner('erpSocialBridgeConnect', [{ id: Z.id, platform: 'tiktok' }]);
check('Zernio: the connect link for TikTok comes from its API, for this company\'s profile', r.ok && r.result.url === 'https://www.tiktok.com/auth?via=zernio', r);
const U = (await owner('erpSocialBridges', [{}])).result.bridges.find((b) => b.service === 'uploadpost');
r = await owner('erpSocialBridgeConnect', [{ id: U.id, platform: 'youtube' }]);
const jwt = calls.find((c) => c.svc === 'uploadpost' && /generate-jwt/.test(c.url));
check('Upload-Post: a profile is made for the company on the provider\'s key, and a branded connect page link comes back', r.ok && /app\.upload-post\.com\/connect/.test(r.result.url) && jwt && /^erp-/.test(jwt.body.username) && jwt.body.platforms[0] === 'youtube' && jwt.body.show_calendar === false, [r, jwt && jwt.body]);
r = await owner('erpSocialBridgeConnect', [{ id: Z.id, platform: 'whatsapp' }]);
check('a network the service does not do is refused', !r.ok, r);
zAccounts = [{ _id: 'ZA1', platform: 'tiktok', username: 'costareen3d', profileId: 'ZP1' }];
pConns = [{ platformId: 'linkedin-LI1', username: 'rahman', displayName: 'Rahman Nazir', connectionStatus: 'active' }, { platformId: 'twitter-X1', username: 'old', connectionStatus: 'reconnect_required' }];
uProfiles[0].social_accounts = { youtube: { display_name: 'Costareen 3D', handle: '@costareen3d', username: 'UC1' }, pinterest: { display_name: 'Costareen', handle: 'costareen' } };
r = await mgr('erpSocialBridgeRefresh', [{ id: Z.id }]);
check('Refresh reads the accounts: TikTok on Zernio', r.ok && r.result.bridges.find((b) => b.service === 'zernio').accounts[0].platform === 'tiktok', r);
const P = r.result.bridges.find((b) => b.service === 'publora');
r = await mgr('erpSocialBridgeRefresh', [{ id: P.id }]);
check('Publora: LinkedIn active, X needing a reconnect', r.ok && r.result.bridges.find((b) => b.service === 'publora').accounts.some((a) => a.platform === 'linkedin' && a.ok) && r.result.bridges.find((b) => b.service === 'publora').accounts.some((a) => a.platform === 'x' && a.ok === false), r);
await mgr('erpSocialBridgeRefresh', [{ id: U.id }]);
r = await sales('erpSocialPosts', [{}]);
const net = r.result.net;
check('the Posts form: TikTok, LinkedIn, YouTube and Pinterest connected (through the bridges), X not (needs a reconnect), nothing says which service', net.find((n) => n.key === 'tiktok').connected && net.find((n) => n.key === 'linkedin').connected && net.find((n) => n.key === 'youtube').connected && net.find((n) => n.key === 'pinterest').connected && !net.find((n) => n.key === 'x').connected && !JSON.stringify(net).includes('zernio'), net.map((n) => [n.key, n.connected]));
r = await owner('erpSocialNet', [{}]);
check('Settings shows them connected, with the handle; the owner alone sees through which service', r.result.platforms.find((p) => p.key === 'tiktok').connected && r.result.platforms.find((p) => p.key === 'tiktok').profile.handle === 'costareen3d' && /through zernio/.test(r.result.platforms.find((p) => p.key === 'tiktok').profile.note), r.result.platforms.find((p) => p.key === 'tiktok'));

// ---- 3. posting through each bridge
await deps.storage.save(FIX.B, 'social', 'reel-b.mp4', Buffer.alloc(900, 7), 'video/mp4');
await deps.storage.save(FIX.B, 'social', 'pic.jpg', Buffer.alloc(300, 2), 'image/jpeg');
calls.length = 0;
r = await owner('erpSocialSave', [{ title: 'Reel', captions: { tiktok: 'tt caption', youtube: 'My short #Shorts\nMore words' }, media: [{ kind: 'video', file: 'social/reel-b.mp4', width: 1080, height: 1920 }], targets: { tiktok: true, youtube: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
const REEL = r.result.post.id, rv = r.result.post.results;
const zp = calls.find((c) => c.svc === 'zernio' && /\/posts$/.test(c.url)), up = calls.find((c) => c.svc === 'uploadpost' && /\/api\/upload$/.test(c.url));
check('TikTok through Zernio: content, the account id, the video by link, Dhaka time; waits for Zernio', r.ok && zp && zp.body.platforms[0].accountId === 'ZA1' && zp.body.platforms[0].platform === 'tiktok' && zp.body.mediaItems[0].type === 'video' && /reel-b\.mp4/.test(zp.body.mediaItems[0].url) && zp.body.timezone === 'Asia/Dhaka' && rv.tiktok.pending && rv.tiktok.bridgeId === 'ZPOST1', [r.result.post.state, rv, zp && zp.body]);
check('YouTube through Upload-Post: the profile, the first caption line as the title, public; the link comes back at once', up && up.form.user[0].startsWith('erp-') && up.form['platform[]'][0] === 'youtube' && up.form.title[0] === 'My short #Shorts' && up.form.privacyStatus[0] === 'public' && rv.youtube.id === 'UP1' && /shorts\/UP1/.test(rv.youtube.link), [up && up.form, rv.youtube]);
check('the post waits as "publishing" for Zernio', r.result.post.state === 'publishing');
zStatus = 'published';
await sql`update social_posts set updated_at = now() - interval '2 minutes' where id = ${REEL}`;
let t = await asB((ctx) => so.socialTick(ctx));
r = await owner('erpSocialPosts', [{}]);
const done1 = r.result.posts.find((x) => x.id === REEL);
check('the timer asks Zernio again: published, with TikTok\'s link', t.finished === 1 && done1.state === 'published' && /tiktok\.com\/@c\/video\/99/.test(done1.results.tiktok.link), [t, done1.results]);
calls.length = 0;
r = await owner('erpSocialSave', [{ title: 'Pic', captions: { linkedin: 'li words', pinterest: 'Pin title\nPin words' }, media: [{ kind: 'image', file: 'social/pic.jpg' }], targets: { linkedin: true, pinterest: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
const pp = calls.find((c) => c.svc === 'publora' && /create-post/.test(c.url)), uph = calls.find((c) => c.svc === 'uploadpost' && /upload_photos/.test(c.url));
check('LinkedIn through Publora: the connection id, publish now, the picture by link; Pinterest through Upload-Post failed with the service\'s reason', pp && pp.body.platforms[0] === 'linkedin-LI1' && pp.body.publishNow === true && /pic\.jpg/.test(pp.body.mediaUrls[0]) && r.result.post.results.linkedin.pending && uph && /board missing/.test(r.result.post.results.pinterest.error), [r.result.post.results, pp && pp.body]);
pStatus = 'published';
await sql`update social_posts set updated_at = now() - interval '2 minutes', state = 'publishing' where id = ${r.result.post.id}`;
t = await asB((ctx) => so.socialTick(ctx));
const p2 = (await owner('erpSocialPosts', [{}])).result.posts.find((x) => x.title === 'Pic');
check('Publora published: LinkedIn\'s permalink kept; the Pinterest failure stays shown', p2.results.linkedin.id === 'LI9' && /linkedin\.com/.test(p2.results.linkedin.link) && p2.results.pinterest.error, p2.results);
check('no bridge key is ever in a post', !JSON.stringify(p2).includes('sk_zernio') && !JSON.stringify(p2).includes('publora-key'));

// ---- 4. removing
r = await owner('erpSocialBridgeRemove', [{ id: U.id }]);
check('the provider\'s bridge cannot be removed by a company', !r.ok, r);
r = await owner('erpSocialBridgeRemove', [{ id: Z.id }]);
check('a company bridge removed: its key gone, TikTok no longer connected', r.ok && !r.result.bridges.some((b) => b.service === 'zernio') && (await sql`select count(*)::int n from business_secrets where business_id = ${FIX.B} and key = ${'BRIDGE_' + Z.id + '_KEY'}`)[0].n === 0 && !(await sales('erpSocialPosts', [{}])).result.net.find((n) => n.key === 'tiktok').connected, r);
check('the other business has no bridges', (await sql`select count(*)::int n from business_config where business_id = ${FIX.B2} and key = 'social_bridges'`)[0].n === 0);

await done();
