// Every network (handlers/socialnet.js): the registry, connecting (login pages, the way back, Telegram by token),
// publishing to each through its own API, the figures, and the Posts form's targets/captions for all of them.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const sn = await import(pathToFileURL(path.join(fnDir, 'handlers', 'socialnet.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';
deps.render = { url: 'https://render.test/render', key: 'rk' };
deps.social = { threadsAppId: 'TH', threadsAppSecret: 'ths', tiktokClientKey: 'TK', tiktokClientSecret: 'tks', googleClientId: 'G', googleClientSecret: 'gs', linkedinClientId: 'LI', linkedinClientSecret: 'lis', xClientId: 'X', xClientSecret: 'xs', pinterestAppId: 'PI', pinterestAppSecret: 'pis', redirect: 'https://fn.test/functions/v1/erp?social=back' };
const PLA = 'FIL-SUN-PLA-BLA-001';

// ---- the fake networks
const calls = [];
const JPG = Buffer.concat([Buffer.from('\xff\xd8\xff'), Buffer.alloc(300, 2)]);
web.on(/render\.test\/render\/jpeg/, () => ({ status: 200, body: JPG.toString('latin1') }));
web.on(/graph\.threads\.net/, (url, opts) => {
  calls.push({ net: 'threads', url, method: opts.method || 'GET' });
  if (/oauth\/access_token/.test(url)) return { status: 200, body: { access_token: 'thshort', user_id: 'TU1' } };
  if (/\/access_token\?/.test(url)) return { status: 200, body: { access_token: 'thlong', expires_in: 5184000 } };
  if (/\/me\?/.test(url)) return { status: 200, body: { id: 'TU1', username: 'costareen', name: 'Costareen' } };
  if (/\/TU1\/threads\?/.test(url)) return { status: 200, body: { id: 'THC1' } };
  if (/\/THC1\?/.test(url)) return { status: 200, body: { status: 'FINISHED' } };
  if (/threads_publish/.test(url)) return { status: 200, body: { id: 'THP1' } };
  if (/\/THP1\?fields=permalink/.test(url)) return { status: 200, body: { permalink: 'https://www.threads.net/@costareen/post/abc' } };
  if (/\/THP1\/insights/.test(url)) return { status: 200, body: { data: [{ name: 'views', values: [{ value: 900 }] }, { name: 'likes', values: [{ value: 40 }] }, { name: 'replies', values: [{ value: 3 }] }, { name: 'reposts', values: [{ value: 2 }] }, { name: 'quotes', values: [{ value: 1 }] }] } };
  return { status: 404, body: {} };
});
let tiktokStatus = 'PUBLISH_COMPLETE';
web.on(/open\.tiktokapis\.com|tiktok-upload\.test/, (url, opts) => {
  calls.push({ net: 'tiktok', url, method: opts.method || 'GET', headers: opts.headers, body: opts.body && typeof opts.body === 'string' ? opts.body : null, len: opts.body && opts.body.length });
  if (/oauth\/token/.test(url)) return { status: 200, body: { access_token: 'tkacc', refresh_token: 'tkref', expires_in: 86400, open_id: 'OPEN1' } };
  if (/user\/info/.test(url)) return { status: 200, body: { data: { user: { open_id: 'OPEN1', display_name: 'Costareen', username: 'costareen3d' } } } };
  if (/video\/init/.test(url)) return { status: 200, body: { data: { publish_id: 'PUB1', upload_url: 'https://tiktok-upload.test/up' } } };
  if (/tiktok-upload\.test/.test(url)) return { status: 200, body: {} };
  if (/status\/fetch/.test(url)) return { status: 200, body: { data: { status: tiktokStatus, publicaly_available_post_id: ['7301'] } } };
  if (/video\/query/.test(url)) return { status: 200, body: { data: { videos: [{ view_count: 5000, like_count: 300, comment_count: 12, share_count: 20 }] } } };
  return { status: 404, body: {} };
});
web.on(/oauth2\.googleapis\.com|googleapis\.com\/(youtube|upload)|yt-upload\.test/, (url, opts) => {
  calls.push({ net: 'youtube', url, method: opts.method || 'GET', headers: opts.headers, len: opts.body && opts.body.length });
  if (/oauth2\.googleapis\.com\/token/.test(url)) return { status: 200, body: { access_token: 'ytacc', refresh_token: 'ytref', expires_in: 3600 } };
  if (/channels\?/.test(url)) return { status: 200, body: { items: [{ id: 'UC1', snippet: { title: 'Costareen 3D', customUrl: '@costareen3d' } }] } };
  if (/upload\/youtube\/v3\/videos/.test(url)) return { status: 200, body: {}, headers: { location: 'https://yt-upload.test/session1' } };
  if (/yt-upload\.test/.test(url)) return { status: 200, body: { id: 'YT1' } };
  if (/videos\?part=statistics/.test(url)) return { status: 200, body: { items: [{ statistics: { viewCount: '1234', likeCount: '55', commentCount: '6' } }] } };
  return { status: 404, body: {} };
});
web.on(/linkedin\.com|li-upload\.test/, (url, opts) => {
  calls.push({ net: 'linkedin', url, method: opts.method || 'GET', body: opts.body && typeof opts.body === 'string' ? opts.body : null });
  if (/accessToken/.test(url)) return { status: 200, body: { access_token: 'liacc', expires_in: 5184000 } };
  if (/userinfo/.test(url)) return { status: 200, body: { sub: 'LP1', name: 'Rahman Nazir' } };
  if (/rest\/images\?action=initializeUpload/.test(url)) return { status: 200, body: { value: { uploadUrl: 'https://li-upload.test/u', image: 'urn:li:image:IMG1' } } };
  if (/li-upload\.test/.test(url)) return { status: 201, body: {} };
  if (/rest\/posts/.test(url)) return { status: 201, body: {}, headers: { 'x-restli-id': 'urn:li:share:S1' } };
  return { status: 404, body: {} };
});
web.on(/api\.x\.com|x\.com\/i\/oauth2/, (url, opts) => {
  calls.push({ net: 'x', url, method: opts.method || 'GET', headers: opts.headers, body: opts.body && typeof opts.body === 'string' ? opts.body : null });
  if (/oauth2\/token/.test(url)) return { status: 200, body: { access_token: 'xacc', refresh_token: 'xref', expires_in: 7200 } };
  if (/users\/me/.test(url)) return { status: 200, body: { data: { id: 'XU1', username: 'costareen3d', name: 'Costareen' } } };
  if (/media\/upload/.test(url)) return { status: 200, body: { data: { id: 'M1' } } };
  if (/\/2\/tweets\/T1/.test(url)) return { status: 200, body: { data: { public_metrics: { impression_count: 800, like_count: 20, reply_count: 2, retweet_count: 5, quote_count: 1, bookmark_count: 4 } } } };
  if (/\/2\/tweets$/.test(url)) return { status: 201, body: { data: { id: 'T1' } } };
  return { status: 404, body: {} };
});
web.on(/api\.pinterest\.com/, (url, opts) => {
  calls.push({ net: 'pinterest', url, method: opts.method || 'GET', body: opts.body && typeof opts.body === 'string' ? opts.body : null });
  if (/oauth\/token/.test(url)) return { status: 200, body: { access_token: 'piacc', refresh_token: 'piref', expires_in: 2592000 } };
  if (/user_account/.test(url)) return { status: 200, body: { id: 'PU1', username: 'costareen', business_name: 'Costareen' } };
  if (/\/boards/.test(url)) return { status: 200, body: { items: [{ id: 'B1', name: '3D prints' }] } };
  if (/\/pins\/P1\/analytics/.test(url)) return { status: 200, body: { all: { summary_metrics: { IMPRESSION: 300, PIN_CLICK: 10, SAVE: 7, OUTBOUND_CLICK: 2 } } } };
  if (/\/v5\/pins$/.test(url)) return { status: 201, body: { id: 'P1' } };
  return { status: 404, body: {} };
});
web.on(/api\.telegram\.org/, (url, opts) => {
  calls.push({ net: 'telegram', url: url.replace(/bot[^/]+/, 'bot***'), method: opts.method || 'GET', body: opts.body && typeof opts.body === 'string' ? opts.body : null });
  if (/getMe/.test(url)) return { status: 200, body: { ok: true, result: { username: 'costareen_bot' } } };
  if (/getChat/.test(url)) return { status: 200, body: { ok: true, result: { id: -100123, username: 'costareen3d', title: 'Costareen 3D' } } };
  if (/send(Photo|Video|Message|MediaGroup)/.test(url)) return { status: 200, body: { ok: true, result: { message_id: 77 } } };
  return { status: 404, body: {} };
});
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const body = JSON.parse(opts.body); const sys = body.systemInstruction ? body.systemInstruction.parts[0].text : '';
  const keys = (sys.match(/"([a-zA-Z]+)": "\.\.\."/g) || []).map((x) => x.split('"')[1]);
  const out = {}; for (const k of keys) out[k] = k + ' caption ' + (k === 'youtube' ? '\nTitle line #Shorts\nMore' : '');
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(out) }] } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } } };
});

await mgr('erpSocialRules', [{ save: '', maxDay: 10 }]);   // this suite publishes more than the default two a day

// ---- 1. the registry as the Posts form sees it: every network listed, none connected but the copy-only ones
let r = await sales('erpSocialPosts', [{}]);
const net = r.result.net;
check('every network is listed with what it takes', r.ok && net.length >= 12 && net.find((n) => n.key === 'tiktok').media.video && !net.find((n) => n.key === 'tiktok').media.image && net.find((n) => n.key === 'x').max === 280, net.map((n) => n.key));
check('nothing is connected yet except the copy-only ones; the apps are set up (test env)', net.filter((n) => n.connected).every((n) => n.via === 'copy') && net.find((n) => n.key === 'threads').configured && !net.find((n) => n.key === 'whatsapp').configured === false, net.map((n) => [n.key, n.connected, n.configured]));
r = await owner('erpSocialNet', [{}]);
check('the connections screen lists the seven networks with their state', r.ok && r.result.platforms.length === 9 && r.result.platforms.every((p) => !p.connected), r.result.platforms.map((p) => p.key));
r = await sales('erpSocialCaptions', [{ sku: PLA, lang: 'en' }]);
check('the caption writer writes one caption per network, each with its own rules', r.ok && r.result.captions.threads === 'threads caption' && r.result.captions.tiktok && r.result.captions.pinterest && r.result.captions.x && r.result.captions.telegram && /Title line/.test(r.result.captions.youtube), r.result && Object.keys(r.result.captions));
r = await owner('erpSocialSave', [{ captions: { facebook: 'x' }, media: [{ kind: 'video', file: 'social/reel-x.mp4' }], targets: { pinterest: true } }]);
check('a network that takes no video refuses a video post at save', !r.ok && /Pinterest takes no video/.test(r.error), r);
r = await owner('erpSocialSave', [{ captions: { tiktok: 'x' }, media: [{ kind: 'image', file: 'social/c.png' }], targets: { tiktok: true } }]);
check('a video-only network refuses a picture post at save', !r.ok && /TikTok takes a video only/.test(r.error), r);
r = await owner('erpSocialSave', [{ captions: { threads: 'hello' }, targets: { threads: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
check('publishing to a network that is not connected fails with the way to connect', r.ok && r.result.post.state === 'failed' && /Threads is not connected: Settings/.test(r.result.post.results.threads.error), r.result && r.result.post.results);

// ---- 2. connecting: the login pages, the way back for each network
r = await sales('erpSocialNetStart', [{ key: 'threads' }]);
check('only the owner connects', !r.ok, r);
r = await owner('erpSocialNetStart', [{ key: 'whatsapp' }]);
check('a copy-only network has no login page', !r.ok, r);
const back = async (key, extra) => {
  const st = await owner('erpSocialNetStart', [{ key }]);
  check('login page for ' + key, st.ok && /^https:\/\//.test(st.result.url) && /state=/.test(st.result.url), st);
  const state = new URL(st.result.url).searchParams.get('state');
  const to = await sn.socialNetCallback(deps, { p: key, state, code: 'CODE', ...(extra || {}) }, (biz, fn) => asB(fn));
  return to;
};
let to = await back('threads');
check('Threads: the code becomes a long-lived key, the profile is kept, back to Settings', /social=ok&p=threads/.test(to) && calls.some((c) => /th_exchange_token/.test(c.url)), to);
to = await back('tiktok');
check('TikTok: token + refresh, the profile with its note', /social=ok&p=tiktok/.test(to), to);
to = await back('youtube');
check('YouTube: the channel found', /social=ok&p=youtube/.test(to), to);
to = await back('linkedin');
check('LinkedIn connected', /social=ok&p=linkedin/.test(to), to);
to = await back('x');
const xTok = calls.find((c) => c.net === 'x' && /oauth2\/token/.test(c.url));
check('X: PKCE - the code verifier goes with the code', /social=ok&p=x/.test(to) && xTok && /code_verifier=[0-9a-f]{40,}/.test(xTok.body), [to, xTok && xTok.body]);
to = await back('pinterest');
check('Pinterest: the first board is chosen for pins', /social=ok&p=pinterest/.test(to), to);
to = await sn.socialNetCallback(deps, { p: 'threads', state: FIX.B + '.' + 'f'.repeat(32), code: 'x' }, (biz, fn) => asB(fn));
check('a stale way back is refused', /social=expired/.test(to), to);
r = await owner('erpSocialNetToken', [{ key: 'telegram', token: '123456789:AAHabcdefghijklmnopqrstuvwxyz', chat: 'costareen3d' }]);
check('Telegram: the channel must be @name or an id', !r.ok, r);
r = await owner('erpSocialNetToken', [{ key: 'telegram', token: '123456789:AAHabcdefghijklmnopqrstuvwxyz', chat: '@costareen3d' }]);
check('Telegram: the bot token is checked with Telegram and the channel read', r.ok && r.result.platforms.find((p) => p.key === 'telegram').connected && r.result.platforms.find((p) => p.key === 'telegram').profile.name === 'Costareen 3D', r);
r = await owner('erpSocialNet', [{}]);
check('all seven now connected, with handles', r.result.platforms.filter((p) => p.via !== 'copy').every((p) => p.connected) && r.result.platforms.find((p) => p.key === 'x').profile.handle === 'costareen3d', r.result.platforms.map((p) => [p.key, p.connected]));
check('no token is ever read back', !/thlong|tkacc|ytacc|liacc|xacc|piacc|AAHabc/.test(JSON.stringify(r.result)));

// ---- 3. publishing to each
await deps.storage.save(FIX.B, 'social', 'card.png', Buffer.alloc(800, 9), 'image/png');
await deps.storage.save(FIX.B, 'social', 'reel-a.mp4', Buffer.alloc(5000, 7), 'video/mp4');
calls.length = 0;
r = await owner('erpSocialSave', [{ title: 'Black PLA', captions: { threads: 'th', linkedin: 'li', x: 'x post', pinterest: 'Pin title\nPin words', telegram: 'tg' }, media: [{ kind: 'image', file: 'social/card.png' }], targets: { threads: true, linkedin: true, x: true, pinterest: true, telegram: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
const res = r.result && r.result.post.results;
check('a picture post goes to Threads, LinkedIn, X, Pinterest and Telegram in one go', r.ok && r.result.post.state === 'published' && res.threads.id === 'THP1' && res.linkedin.id === 'urn:li:share:S1' && res.x.id === 'T1' && res.pinterest.id === 'P1' && res.telegram.id === '77', [r.result && r.result.post.state, res]);
check('…each with its own caption and link', /threads\.net/.test(res.threads.link) && /linkedin\.com/.test(res.linkedin.link) && /x\.com\/costareen3d\/status\/T1/.test(res.x.link) && /pinterest\.com\/pin\/P1/.test(res.pinterest.link) && /t\.me\/costareen3d\/77/.test(res.telegram.link), res);
const pin = calls.find((c) => c.net === 'pinterest' && /\/v5\/pins$/.test(c.url));
check('Pinterest: the first caption line is the title, the board from the connection', pin && JSON.parse(pin.body).title === 'Pin title' && JSON.parse(pin.body).board_id === 'B1' && /card\.jpg/.test(JSON.parse(pin.body).media_source.url), pin && pin.body);
check('a PNG card went out as a JPEG (made once, kept beside it)', (await deps.storage.read(FIX.B, 'social', 'card.jpg')) !== null);
const li = calls.find((c) => c.net === 'linkedin' && /rest\/posts/.test(c.url));
check('LinkedIn: a picture post from the person\'s profile', li && JSON.parse(li.body).author === 'urn:li:person:LP1' && JSON.parse(li.body).content.media.id === 'urn:li:image:IMG1', li && li.body);
calls.length = 0;
r = await owner('erpSocialSave', [{ title: 'Reel', captions: { tiktok: 'tt', youtube: 'My short #Shorts\nDesc line', threads: 'th video', telegram: 'tg v' }, media: [{ kind: 'video', file: 'social/reel-a.mp4', width: 1080, height: 1920 }], targets: { tiktok: true, youtube: true, threads: true, telegram: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
const rv = r.result && r.result.post.results;
check('a reel goes to TikTok (one chunk upload), YouTube Shorts (resumable upload), Threads and Telegram', r.ok && r.result.post.state === 'published' && rv.tiktok.id === '7301' && /tiktok\.com\/@costareen3d\/video\/7301/.test(rv.tiktok.link) && rv.youtube.id === 'YT1' && /youtube\.com\/shorts\/YT1/.test(rv.youtube.link) && rv.threads.id && rv.telegram.id, [r.result && r.result.post.state, rv]);
const tkUp = calls.find((c) => c.net === 'tiktok' && /tiktok-upload\.test/.test(c.url)), ytStart = calls.find((c) => c.net === 'youtube' && /uploadType=resumable/.test(c.url)), ytPut = calls.find((c) => c.net === 'youtube' && /yt-upload\.test/.test(c.url));
check('TikTok: the bytes with a Content-Range; YouTube: title from the first line, then the bytes to the session', tkUp && /^bytes 0-4999\/5000$/.test(tkUp.headers['Content-Range']) && ytStart && ytPut && ytPut.len === 5000, [tkUp && tkUp.headers, ytPut && ytPut.len]);
tiktokStatus = 'PROCESSING_UPLOAD';
r = await owner('erpSocialSave', [{ captions: { tiktok: 'slow' }, media: [{ kind: 'video', file: 'social/reel-a.mp4' }], targets: { tiktok: true } }]);
const SLOW = r.result.post.id;
r = await owner('erpSocialAct', [{ id: SLOW, action: 'publish' }]);
check('TikTok still processing: the post waits as "publishing" with its publish id', r.ok && r.result.post.state === 'publishing' && r.result.post.results.tiktok.publishId === 'PUB1', r.result && r.result.post);
tiktokStatus = 'PUBLISH_COMPLETE'; calls.length = 0;
await sql`update social_posts set updated_at = now() - interval '2 minutes' where id = ${SLOW}`;
const so = await import(pathToFileURL(path.join(fnDir, 'handlers', 'social.js')));
let t = await asB((ctx) => so.socialTick(ctx));
check('…and the timer finishes it without uploading again', t.finished === 1 && !calls.some((c) => /video\/init/.test(c.url)), [t, calls.map((c) => c.url)]);

// ---- 4. the figures from each network
await sql`update social_posts set stats_at = null where business_id = ${FIX.B}`;
t = await asB((ctx) => so.socialTick(ctx));
r = await owner('erpSocialPosts', [{}]);
const pic = r.result.posts.find((x) => x.title === 'Black PLA'), reel = r.result.posts.find((x) => x.title === 'Reel');
check('Threads views/likes, X impressions and bookmarks, Pinterest impressions and saves', pic.stats.threads.views === 900 && pic.stats.threads.shares === 3 && pic.stats.x.views === 800 && pic.stats.x.saved === 4 && pic.stats.pinterest.views === 300 && pic.stats.pinterest.saved === 7, pic.stats);
check('TikTok and YouTube views', reel.stats.tiktok.views === 5000 && reel.stats.youtube.views === 1234 && reel.stats.youtube.likes === 55, reel.stats);

// ---- 5. disconnecting
r = await owner('erpSocialNetOff', [{ key: 'x' }]);
check('disconnected: the token is gone', r.ok && !r.result.platforms.find((p) => p.key === 'x').connected && (await sql`select count(*)::int n from business_secrets where business_id = ${FIX.B} and key = 'SOCIAL_X_TOKEN'`)[0].n === 0, r);
check('the other business has none of it', (await sql`select count(*)::int n from business_secrets where business_id = ${FIX.B2} and key like 'SOCIAL_%'`)[0].n === 0);

await done();
