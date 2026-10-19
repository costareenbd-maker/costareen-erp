// Social posts (129_social_posts.sql, handlers/social.js): drafts by staff, the owner approves, publishing to the
// Facebook Page and Instagram through the Meta login, scheduling by the minute timer, the figures read back,
// Marketplace/WhatsApp copy-only, refusals.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const mc = await import(pathToFileURL(path.join(fnDir, 'handlers', 'metaconnect.js')));
const so = await import(pathToFileURL(path.join(fnDir, 'handlers', 'social.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';
deps.meta = { appId: 'APP1', appSecret: 'appsecret', redirect: 'https://fn.test/functions/v1/erp?meta=back' };

// ---- the fake outside world
let script = [];
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const next = script.shift();
  const parts = !next ? [{ text: 'OK.' }] : typeof next === 'function' ? next(JSON.parse(opts.body)) : next;
  return { status: 200, body: { candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } } };
});
const graph = [];
let igStatus = 'FINISHED', fbVideoState = 'ready';
web.on(/rupload\.facebook\.com\/video-upload/, (url, opts) => { graph.push({ p: 'rupload', method: opts.method, body: null, q: '', headers: opts.headers }); return { status: 200, body: { success: true } }; });
web.on(/graph\.facebook\.com\/v21\.0\//, (url, opts) => {
  const u = new URL(url), p = u.pathname.replace(/^\/v21\.0/, ''), body = opts.body ? JSON.parse(opts.body) : null, method = opts.method || 'GET';
  graph.push({ p, method, body, q: u.search });
  if (/oauth\/access_token\?grant_type=fb_exchange_token/.test(url)) return { status: 200, body: { access_token: 'LONGUSER', expires_in: 5184000 } };
  if (/oauth\/access_token/.test(url)) return { status: 200, body: { access_token: 'SHORTUSER' } };
  if (p === '/me/accounts') return { status: 200, body: { data: [{ id: 'PAGE9', name: 'Demo Page', access_token: 'PAGETOKEN9', instagram_business_account: { id: 'IG9', username: 'demo.shop' } }, { id: 'PAGE8', name: 'Plain Page', access_token: 'PAGETOKEN8' }] } };
  if (p === '/me/permissions') return { status: 200, body: { data: [] } };
  if (p === '/me') return { status: 200, body: { id: 'U1', name: 'Rahman' } };
  if (/\/me\/(businesses|adaccounts)$/.test(p)) return { status: 200, body: { data: [] } };
  if (p === '/PAGE9/photos' || p === '/PAGE8/photos') return { status: 200, body: { id: 'PH' + graph.length, post_id: 'PAGE9_POST' + graph.length } };
  if (p === '/PAGE9/feed') return { status: 200, body: { id: 'PAGE9_FEED' + graph.length } };
  if (p === '/PAGE9/videos') return { status: 200, body: { id: 'VID' + graph.length } };
  if (p === '/PAGE9/video_reels' && body && body.upload_phase === 'start') return { status: 200, body: { video_id: 'REEL1', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/REEL1' } };
  if (p === '/PAGE9/video_reels' && body && body.upload_phase === 'finish') return { status: 200, body: { success: true } };
  if (p === '/PAGE9/video_stories' && body && body.upload_phase === 'start') return { status: 200, body: { video_id: 'STV1', upload_url: 'https://rupload.facebook.com/video-upload/v21.0/STV1' } };
  if (p === '/PAGE9/video_stories' && body && body.upload_phase === 'finish') return { status: 200, body: { success: true, post_id: 'STPOST1' } };
  if (p === '/PAGE9/photo_stories') return { status: 200, body: { success: true, post_id: 'STPH' + graph.length } };
  if (/^\/(REEL1|STV1)$/.test(p)) return { status: 200, body: { status: { video_status: fbVideoState } } };
  if (/^\/REEL1\/video_insights$/.test(p)) return { status: 200, body: { data: [{ name: 'fb_reels_total_plays', values: [{ value: 540 }] }, { name: 'total_video_views', values: [{ value: 410 }] }] } };
  if (p === '/IG9/media') return { status: 200, body: { id: 'CREATION' + graph.length } };
  if (/^\/CREATION\d+$/.test(p)) return { status: 200, body: { status_code: igStatus } };
  if (p === '/IG9/media_publish') return { status: 200, body: { id: 'IGMEDIA' + graph.length } };
  if (/^\/IGMEDIA\d+$/.test(p) && /permalink/.test(u.search)) return { status: 200, body: { permalink: 'https://www.instagram.com/p/abc/' } };
  if (/^\/IGMEDIA\d+$/.test(p)) return { status: 200, body: { like_count: 12, comments_count: 3 } };
  if (/^\/IGMEDIA\d+\/insights$/.test(p)) return { status: 200, body: { data: [{ name: 'reach', values: [{ value: 340 }] }, { name: 'saved', values: [{ value: 5 }] }] } };
  if (/^\/PAGE9_POST\d+\/insights$/.test(p)) return { status: 200, body: { data: [{ name: 'post_impressions_unique', values: [{ value: 1200 }] }] } };
  if (/^\/PAGE9_POST\d+$/.test(p)) return { status: 200, body: { shares: { count: 4 }, reactions: { summary: { total_count: 31 } }, comments: { summary: { total_count: 6 } } } };
  if (/subscribed_apps/.test(p)) return { status: 200, body: { success: true } };
  return { status: 404, body: { error: { message: 'no route ' + p } } };
});

await mgr('erpSocialRules', [{ save: '', maxDay: 10 }]);   // this suite publishes more than the default two a day

// ---- 1. before the Meta login: drafts can be written, nothing can go out
let r = await sales('erpSocialPosts', [{}]);
check('the list opens for staff; not connected yet', r.ok && !r.result.connected && r.result.posts.length === 0 && !r.result.canPublish, r);
r = await sales('erpSocialSave', [{ captions: { facebook: 'Black PLA 1kg - 1,600 Tk. Inbox to order.' }, targets: { facebook: true } }]);
check('a staff draft is saved', r.ok && r.result.post.state === 'draft' && r.result.post.createdBy && r.result.post.title.startsWith('Black PLA'), r);
const D1 = r.result.post.id;
r = await sales('erpSocialAct', [{ id: D1, action: 'publish' }]);
check('staff cannot publish', !r.ok && /owner approves/.test(r.error), r);
r = await mgr('erpSocialAct', [{ id: D1, action: 'publish' }]);
check('a manager cannot publish an unapproved draft', !r.ok, r);
r = await owner('erpSocialAct', [{ id: D1, action: 'publish' }]);
check('without the Meta login, publishing says so', r.ok && r.result.post.state === 'failed' && /connect Facebook/i.test(r.result.post.results.facebook.error), r.result && r.result.post.results);
await sql`update social_posts set state = 'draft', results = '{}' where id = ${D1}`;
r = await sales('erpSocialSave', [{ captions: { instagram: 'x' }, targets: { instagram: true } }]);
check('Instagram needs media', !r.ok && /picture or a video/.test(r.error), r);

// ---- 2. the Meta login (as in inbox_test)
r = await owner('erpMetaStart', [{}]);
const st = new URL(r.result.url).searchParams.get('state');
await mc.metaCallback(deps, { state: st, code: 'CODE1' }, (biz, fn) => asB(fn));
r = await owner('erpSocialPosts', [{}]);
check('connected: the pages with their Instagram, the first page as default', r.ok && r.result.connected && r.result.pages.length === 2 && r.result.pages[0].ig.username === 'demo.shop' && !r.result.pages[1].ig && r.result.defaultPage === 'PAGE9' && r.result.canPublish, r.result);

// ---- 3. captions by the AI, from the product's own facts, one per platform
const PLA = 'FIL-SUN-PLA-BLA-001';
script = [(body) => {
  const t = body.contents[0].parts[0].text;
  return [{ text: JSON.stringify({ facebook: 'FB: ' + (/Price: BDT (\d+)/.exec(t) || [])[1], instagram: 'IG #3dprinting', marketplace: 'MP listing', whatsapp: 'WA reply to order' }) }];
}];
r = await sales('erpSocialCaptions', [{ sku: PLA, lang: 'en' }]);
check('four captions from the product facts (the price given to the AI)', r.ok && /^FB: \d+$/.test(r.result.captions.facebook) && r.result.captions.instagram === 'IG #3dprinting' && r.result.captions.marketplace === 'MP listing' && r.result.title, r);
r = await sales('erpSocialPhotos', [{ sku: PLA }]);
check('the product photo call answers (none stored in the fixture)', r.ok && Array.isArray(r.result.media), r);

// ---- 4. approve and publish to Facebook (a picture)
r = await owner('erpSocialSave', [{ id: D1, captions: { facebook: 'Black PLA 1kg - 1,600 Tk.' }, media: [{ kind: 'image', file: 'https://cdn.test/pla.jpg', name: 'pla.jpg' }], targets: { facebook: true }, approved: true, sku: PLA }]);
check('the owner saves it approved', r.ok && r.result.post.state === 'approved' && r.result.post.approvedBy, r);
graph.length = 0;
r = await mgr('erpSocialAct', [{ id: D1, action: 'publish' }]);
const fbCall = graph.find((g) => g.p === '/PAGE9/photos');
check('a manager publishes an approved post: the photo goes to the page with the Facebook caption', r.ok && r.result.post.state === 'published' && fbCall && fbCall.body.url === 'https://cdn.test/pla.jpg' && fbCall.body.message === 'Black PLA 1kg - 1,600 Tk.' && /access_token=PAGETOKEN9/.test(fbCall.q), [r, fbCall]);
check('the answer is kept with a link', r.result.post.results.facebook.id && /facebook\.com/.test(r.result.post.results.facebook.link) && r.result.post.publishedAt, r.result.post.results);
r = await owner('erpSocialAct', [{ id: D1, action: 'remove' }]);
check('a published post is never removed here', !r.ok && /stays/.test(r.error), r);
r = await owner('erpSocialSave', [{ id: D1, captions: { facebook: 'changed' } }]);
check('…nor changed', !r.ok && /cannot be changed/.test(r.error), r);

// ---- 5. Instagram: container, status, publish; a reel waits for Instagram and the timer finishes it
graph.length = 0;
r = await owner('erpSocialSave', [{ captions: { facebook: 'both', instagram: 'IG caption #x' }, media: [{ kind: 'image', file: 'https://cdn.test/a.jpg' }], targets: { facebook: true, instagram: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
const igMedia = graph.find((g) => g.p === '/IG9/media'), igPub = graph.find((g) => g.p === '/IG9/media_publish');
check('Instagram: a container with the Instagram caption, then media_publish', r.ok && r.result.post.state === 'published' && igMedia && igMedia.body.image_url === 'https://cdn.test/a.jpg' && igMedia.body.caption === 'IG caption #x' && igPub && /^CREATION/.test(igPub.body.creation_id) && r.result.post.results.instagram.id && /instagram\.com/.test(r.result.post.results.instagram.link), [r.result.post.results, graph.map((g) => g.p)]);
graph.length = 0; igStatus = 'IN_PROGRESS';
r = await owner('erpSocialSave', [{ captions: { instagram: 'reel' }, media: [{ kind: 'video', file: 'https://cdn.test/r.mp4' }], targets: { instagram: true } }]);
const REEL = r.result.post.id;
r = await owner('erpSocialAct', [{ id: REEL, action: 'publish' }]);
check('a reel: REELS container; still processing -> the post waits as "publishing"', r.ok && r.result.post.state === 'publishing' && graph.find((g) => g.p === '/IG9/media').body.media_type === 'REELS' && r.result.post.results.instagram.creation && !r.result.post.results.instagram.id, r.result.post);
igStatus = 'FINISHED';
await sql`update social_posts set updated_at = now() - interval '2 minutes' where id = ${REEL}`;
graph.length = 0;
let t = await asB((ctx) => so.socialTick(ctx));
r = await owner('erpSocialPosts', [{}]);
const reel = r.result.posts.find((x) => x.id === REEL);
check('the minute timer finishes it: no new container, media_publish with the same creation id', t.finished === 1 && reel.state === 'published' && !graph.some((g) => g.p === '/IG9/media') && graph.some((g) => g.p === '/IG9/media_publish'), [t, reel, graph.map((g) => g.p)]);
r = await owner('erpSocialSave', [{ captions: { instagram: 'no ig' }, media: [{ kind: 'image', file: 'https://cdn.test/a.jpg' }], targets: { instagram: true }, pageId: 'PAGE8' }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
check('a page with no Instagram linked: failed, with the reason', r.ok && r.result.post.state === 'failed' && /No Instagram account is linked/.test(r.result.post.error), r);

// ---- 5b. a Reel on the Page (a 9:16 video): video_reels start -> upload by link -> ready -> finish; stories on both
graph.length = 0; fbVideoState = 'ready';
r = await owner('erpSocialSave', [{ captions: { facebook: 'reel caption' }, media: [{ kind: 'video', file: 'social/reel-spin-x.mp4', width: 1080, height: 1920 }], targets: { facebook: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
const up = graph.find((g) => g.p === 'rupload'), fin = graph.find((g) => g.p === '/PAGE9/video_reels' && g.body.upload_phase === 'finish');
check('a tall video goes out as a Reel: start, the file by its link with the OAuth header, finish PUBLISHED with the caption', r.ok && r.result.post.state === 'published' && up && /OAuth PAGETOKEN9/.test(up.headers.Authorization) && up.headers.file_url && fin && fin.body.video_id === 'REEL1' && fin.body.video_state === 'PUBLISHED' && fin.body.description === 'reel caption' && /facebook\.com\/reel\/REEL1/.test(r.result.post.results.facebook.link), [r.result.post.results, graph.map((g) => g.p)]);
const REELPOST = r.result.post.id;
graph.length = 0; fbVideoState = 'processing';
r = await owner('erpSocialSave', [{ captions: { facebook: 'slow reel' }, media: [{ kind: 'video', file: 'social/reel-spin-y.mp4', width: 1080, height: 1920 }], targets: { facebook: true } }]);
const SLOW = r.result.post.id;
r = await owner('erpSocialAct', [{ id: SLOW, action: 'publish' }]);
check('a reel still processing waits as "publishing" with its video id', r.ok && r.result.post.state === 'publishing' && r.result.post.results.facebook.videoId === 'REEL1' && !graph.some((g) => g.p === '/PAGE9/video_reels' && g.body.upload_phase === 'finish'), r.result.post);
fbVideoState = 'ready'; graph.length = 0;
await sql`update social_posts set updated_at = now() - interval '2 minutes' where id = ${SLOW}`;
t = await asB((ctx) => so.socialTick(ctx));
check('…and the timer finishes it without uploading again', t.finished === 1 && !graph.some((g) => g.p === 'rupload') && graph.some((g) => g.p === '/PAGE9/video_reels' && g.body.upload_phase === 'finish'), [t, graph.map((g) => g.p)]);
graph.length = 0;
r = await owner('erpSocialSave', [{ captions: { facebook: 'x' }, media: [{ kind: 'image', file: 'https://cdn.test/s.jpg' }], targets: { facebookStory: true, instagramStory: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
check('a picture story on the Page (unpublished photo -> photo_stories) and on Instagram (STORIES container -> publish)', r.ok && r.result.post.state === 'published' && graph.some((g) => g.p === '/PAGE9/photos' && g.body.published === false) && graph.some((g) => g.p === '/PAGE9/photo_stories') && graph.some((g) => g.p === '/IG9/media' && g.body.media_type === 'STORIES') && /facebook\.com\/stories\//.test(r.result.post.results.facebookStory.link) && r.result.post.results.instagramStory.id, [r.result.post.results, graph.map((g) => g.p)]);
graph.length = 0;
r = await owner('erpSocialSave', [{ captions: {}, media: [{ kind: 'video', file: 'social/clip.mp4' }], targets: { facebookStory: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
check('a video story on the Page: video_stories start -> upload -> finish', r.ok && r.result.post.state === 'published' && graph.some((g) => g.p === '/PAGE9/video_stories' && g.body.upload_phase === 'finish' && g.body.video_id === 'STV1') && /stories\/STPOST1/.test(r.result.post.results.facebookStory.link), [r.result.post.results, graph.map((g) => g.p)]);
r = await owner('erpSocialSave', [{ captions: { facebook: 'no media story' }, targets: { facebookStory: true } }]);
check('a story needs media', !r.ok && /need a picture or a video/.test(r.error), r);

// ---- 6. scheduling: the timer publishes what is due; cancel puts it back
r = await owner('erpSocialSave', [{ captions: { facebook: 'later' }, targets: { facebook: true } }]);
const S1 = r.result.post.id;
r = await owner('erpSocialAct', [{ id: S1, action: 'schedule', at: new Date(Date.now() + 3600e3).toISOString() }]);
check('scheduled for later', r.ok && r.result.post.state === 'scheduled' && r.result.post.scheduled, r);
t = await asB((ctx) => so.socialTick(ctx));
check('not due: nothing published', t.published === 0, t);
r = await owner('erpSocialAct', [{ id: S1, action: 'cancel' }]);
check('cancelled -> back to approved', r.ok && r.result.post.state === 'approved' && !r.result.post.scheduledAt, r);
r = await owner('erpSocialAct', [{ id: S1, action: 'schedule', at: new Date(Date.now() - 30e3).toISOString() }]);
graph.length = 0;
t = await asB((ctx) => so.socialTick(ctx));
check('due now: the timer publishes it (a text post on the page feed)', t.published === 1 && graph.some((g) => g.p === '/PAGE9/feed' && g.body.message === 'later'), [t, graph.map((g) => g.p)]);
r = await owner('erpSocialAct', [{ id: S1, action: 'schedule', at: 'nonsense' }]);
check('a bad time is refused', !r.ok, r);

// ---- 7. figures: reactions, comments, shares, reach; Instagram likes, reach, saved
await sql`update social_posts set stats_at = null where business_id = ${FIX.B}`;
t = await asB((ctx) => so.socialTick(ctx));
r = await owner('erpSocialPosts', [{}]);
const p1 = r.result.posts.find((x) => x.id === D1), p2 = r.result.posts.find((x) => x.id === REEL);
check('figures read for published posts', t.stats >= 2 && p1.stats.facebook.reactions === 31 && p1.stats.facebook.comments === 6 && p1.stats.facebook.shares === 4 && p1.stats.facebook.reach === 1200 && p1.stats.at, p1.stats);
const pr = r.result.posts.find((x) => x.id === REELPOST);
check('a reel\'s figures come from video insights: plays and views', pr.stats.facebook.plays === 540 && pr.stats.facebook.views === 410, pr.stats);
check('Instagram figures', p2.stats.instagram.likes === 12 && p2.stats.instagram.reach === 340 && p2.stats.instagram.saved === 5, p2.stats);
t = await asB((ctx) => so.socialTick(ctx));
check('read again only after an hour', t.stats === 0, t);

// ---- 8. the other business sees nothing; drafts removed; approval taken back
check('another business has no posts', (await sql`select count(*)::int n from social_posts where business_id = ${FIX.B2}`)[0].n === 0);
r = await sales('erpSocialSave', [{ captions: { whatsapp: 'wa only' } }]);
const D2 = r.result.post.id;
r = await owner('erpSocialAct', [{ id: D2, action: 'publish' }]);
check('no target ticked: refused', !r.ok && /at least one place/.test(r.error), r);
r = await owner('erpSocialAct', [{ id: D2, action: 'approve' }]);
r = await owner('erpSocialAct', [{ id: D2, action: 'unapprove' }]);
check('approval taken back', r.ok && r.result.post.state === 'draft' && !r.result.post.approvedBy, r);
r = await mgr('erpSocialAct', [{ id: D2, action: 'remove' }]);
r = await owner('erpSocialPosts', [{}]);
check('a removed draft leaves the list', r.ok && !r.result.posts.some((x) => x.id === D2), r.result.posts.map((x) => x.id));

await done();
