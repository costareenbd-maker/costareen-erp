// The content factory (130_social_assets.sql, handlers/socialmake.js): photo cards drawn by the render server, AI photos,
// reel scripts, a voice-over, the video job and its finish by the minute timer, refusals, the clip request.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const sm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'socialmake.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';
deps.render = { url: 'https://render.test/render', key: 'rk' };
const PLA = 'FIL-SUN-PLA-BLA-001';

// ---- the fake outside world: the render server, Gemini (text / image / voice)
const rend = [];
let jobState = 'done';
const PNG = Buffer.concat([Buffer.from('\x89PNG\r\n\x1a\n'), Buffer.alloc(400, 1)]);
web.on(/render\.test\/render/, (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  rend.push({ url, key: opts.headers && opts.headers['X-Render-Key'], body, method: opts.method });
  if (/\/png$/.test(url)) return { status: 200, body: PNG.toString('latin1') };
  if (/\/video$/.test(url)) return { status: 200, body: { id: 'a'.repeat(32), state: 'queued' } };
  if (/\/job\//.test(url)) return { status: 200, body: { state: jobState, error: jobState === 'failed' ? 'ffmpeg said no' : '', bytes: 123456, seconds: 14.5 } };
  return { status: 404, body: {} };
});
let script = null;
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const body = JSON.parse(opts.body);
  if (/flash-image/.test(url)) {
    const sent = body.contents[0].parts.find((p) => p.inline_data);
    return { status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }], usageMetadata: { promptTokenCount: 1500, candidatesTokenCount: 1300 }, sentMime: sent && sent.inline_data.mime_type } };
  }
  if (/-tts/.test(url)) return { status: 200, body: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/L16;codec=pcm;rate=24000', data: Buffer.alloc(48000, 0).toString('base64') } }] } }], usageMetadata: { promptTokenCount: 60, candidatesTokenCount: 900 } } };
  const parts = typeof script === 'function' ? script(body) : script || [{ text: '{}' }];
  return { status: 200, body: { candidates: [{ content: { parts } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 120 } } };
});
// the fixture's PLA gets a stored photo so cards and AI photos have something to draw
await deps.storage.save(FIX.B, 'products', 'pla.jpg', Buffer.concat([Buffer.from('\xff\xd8\xff'), Buffer.alloc(300, 2)]), 'image/jpeg');
await sql`update products set photo = 'pla.jpg' where business_id = ${FIX.B} and sku = ${PLA}`;

const OTHER = (await sql`select sku from products where business_id = ${FIX.B} and sku <> ${PLA} and coalesce(photo, '') = '' limit 1`)[0].sku;

// ---- 1. the list, empty; the render server is known
let r = await sales('erpSocialAssets', [{}]);
check('the content list opens for staff, empty, render server set', r.ok && r.result.assets.length === 0 && r.result.render && r.result.templates.card.includes('bundle'), r);

// ---- 2. photo cards
r = await sales('erpSocialCard', [{ template: 'clean', sku: PLA, format: 'square', lang: 'bn' }]);
const card = r.ok && r.result.asset;
check('a clean card: drawn at 1080x1080 by the render server, kept as a ready picture with a link', card && card.status === 'ready' && card.kind === 'image' && card.url && rend.some((x) => /\/png$/.test(x.url) && x.body.width === 1080 && x.body.height === 1080 && x.key === 'rk'), r);
const pngCall = rend.find((x) => /\/png$/.test(x.url));
check('the card carries the shop, the product name, its price and the photo as data', /class="shop"/.test(pngCall.body.html) && /Sunlu PLA Black/.test(pngCall.body.html) && /৳/.test(pngCall.body.html) && /data:image\/jpeg;base64,/.test(pngCall.body.html) && /অর্ডার করতে ইনবক্স/.test(pngCall.body.html), pngCall.body.html.slice(0, 300));
const stock = (await sql`select ps.stock from product_stock ps join products p on p.id = ps.product_id where p.business_id = ${FIX.B} and p.sku = ${PLA}`)[0].stock;
r = await sales('erpSocialCard', [{ template: 'left', sku: PLA, format: 'story' }]);
check('"only N left" uses the real stock, story shape', r.ok && rend[rend.length - 1].body.height === 1920 && new RegExp('Only ' + Math.round(stock) + ' left').test(rend[rend.length - 1].body.html), r.ok ? rend[rend.length - 1].body.html.slice(0, 200) : r);
r = await sales('erpSocialCard', [{ template: 'offer', sku: PLA }]);
check('an offer card needs the offer price', !r.ok && /offer price/.test(r.error), r);
r = await sales('erpSocialCard', [{ template: 'offer', sku: PLA, offer: 1200 }]);
check('offer card: percentage off and the old price struck', r.ok && /% OFF/.test(rend[rend.length - 1].body.html) && /line-through/.test(rend[rend.length - 1].body.html), r);
r = await sales('erpSocialCard', [{ template: 'bundle', skus: [PLA] }]);
check('a bundle is two or three products', !r.ok, r);
r = await sales('erpSocialCard', [{ template: 'bundle', skus: [PLA, OTHER], offer: 50000 }]);
check('a bundle card with two products', r.ok && r.result.asset.title.includes('+'), r);
r = await sales('erpSocialCard', [{ template: 'clean', sku: 'NOPE' }]);
check('an unknown product is refused', !r.ok, r);

// ---- 3. an AI photo: the product's photo goes to the image model; the answer is kept; cost written
const workBefore = (await sql`select count(*)::int n from ai_work where business_id = ${FIX.B}`)[0].n;
r = await sales('erpSocialAiPhoto', [{ sku: PLA, scene: 'desk' }]);
const ai = r.ok && r.result.asset;
check('an AI photo is made and kept, scene in the name, ৳5', ai && ai.status === 'ready' && ai.template === 'ai:desk' && ai.cost === 5 && ai.url, r);
check('…and written to the AI cost book', (await sql`select count(*)::int n, max(cost_bdt) c from ai_work where business_id = ${FIX.B} and purpose = 'ai-photo'`)[0].n === 1);
r = await sales('erpSocialAiPhoto', [{ sku: OTHER, scene: 'studio' }]);
check('a product with no photo cannot be placed in a scene', !r.ok && /no photo/.test(r.error), r);

// ---- 4. the reel script, the voice and the video job
script = (body) => [{ text: JSON.stringify({ hookType: 'question', hook: 'Prints keep failing?', lines: ['Smooth 1.75 mm', 'Dries fast', 'Fits every printer'], cta: 'Inbox us to order', voice: 'Black PLA from Costareen, sixteen hundred taka a roll. Inbox us to order today.' }) }];
r = await sales('erpSocialScript', [{ template: 'spin', sku: PLA, lang: 'en' }]);
check('the script: hook type, hook, three lines, closing line, voice-over; the product named back', r.ok && r.result.script.hookType === 'question' && r.result.script.hook === 'Prints keep failing?' && r.result.script.lines.length === 3 && /sixteen hundred/.test(r.result.script.voice) && r.result.product.sku === PLA, r);
let lastSys = '';
script = (body) => { lastSys = body.systemInstruction.parts[0].text; return [{ text: JSON.stringify({ hookType: 'number', hook: '3 reasons', lines: ['a', 'b', 'c'], cta: 'x', voice: 'y' }) }]; };
await sql`insert into social_assets (business_id, kind, template, sku, title, file, status, meta) values (${FIX.B}, 'video', 'spin', ${PLA}, 't', 'social/x.mp4', 'ready', ${sql.json({ script: { hookType: 'question' } })})`;
r = await sales('erpSocialScript', [{ template: 'spin', sku: PLA, lang: 'en' }]);
check('the writer rotates the hook: the one used last time for this product is left out of the choice', r.ok && !/question = /.test(lastSys) && /negative = /.test(lastSys) && /curiosity = /.test(lastSys), lastSys.slice(lastSys.indexOf('Choose ONE'), lastSys.indexOf('Choose ONE') + 160));
script = (body) => [{ text: JSON.stringify({ hookType: 'question', hook: 'Prints keep failing?', lines: ['Smooth 1.75 mm', 'Dries fast', 'Fits every printer'], cta: 'Inbox us to order', voice: 'Black PLA from Costareen, sixteen hundred taka a roll. Inbox us to order today.' }) }];
r = await sales('erpSocialScript', [{ template: 'spin', sku: PLA, lang: 'en' }]);
const sc = r.result.script;
rend.length = 0;
r = await sales('erpSocialVideo', [{ template: 'spin', sku: PLA, script: sc, lang: 'en', format: 'story', voice: true, media: [card.file] }]);
const vid = r.ok && r.result.asset;
const job = rend.find((x) => /\/video$/.test(x.url));
check('the video job goes to the render server: 9:16, slides, the voice text with a Bangla-or-English neural voice and captions on, an upload address in our store', vid && vid.status === 'rendering' && vid.job === 'a'.repeat(32) && job && job.body.width === 1080 && job.body.height === 1920 && job.body.slides.length >= 4 && job.body.voice && /sixteen hundred/.test(job.body.voice.text) && job.body.voice.voice === 'en-US-AriaNeural' && job.body.voice.captions === true && /supabase|upload/.test(job.body.upload.url), [r.ok, vid && vid.job, job && { w: job.body.width, h: job.body.height, n: job.body.slides.length, voice: job.body.voice, up: job.body.upload }]);
check('the slides: the hook on the first, the price card, the closing line on the last', /Prints keep failing/.test(job.body.slides[0].html) && job.body.slides.some((s) => /font-size:150px/.test(s.html)) && /Inbox us to order/.test(job.body.slides[job.body.slides.length - 1].html));
check('the chosen picture (the card) is in the slides, as data', job.body.slides[0].html.includes('data:image/png;base64,'), job.body.slides[0].html.slice(0, 120));
check('a Bangla reel gets the Bangla voice; a man\'s voice when asked', (await sales('erpSocialVideo', [{ template: 'spin', sku: PLA, script: sc, lang: 'bn', voiceSex: 'm' }])).ok && rend[rend.length - 1].body.voice.voice === 'bn-BD-PradeepNeural');
let t = await asB((ctx) => sm.assetsTick(ctx));
r = await sales('erpSocialAssets', [{}]);
const v2 = r.result.assets.find((x) => x.id === vid.id);
check('the minute timer sees the jobs done: ready, 14.5 s, with a link', t.ready === 2 && v2.status === 'ready' && v2.meta.seconds === 14.5 && v2.url, [t, v2]);
jobState = 'failed';
r = await sales('erpSocialVideo', [{ template: 'reveal', sku: PLA, script: sc, lang: 'bn', voice: false }]);
check('a reel without a voice: no voice in the job, Bangla slides', r.ok && !rend[rend.length - 1].body.voice && /দাম কত\?|অর্ডার/.test(rend[rend.length - 1].body.slides.map((s) => s.html).join('')), r);
await deps.storage.save(FIX.B, 'social', 'beat.mp3', Buffer.alloc(300, 4), 'audio/mpeg');
r = await sales('erpSocialVideo', [{ template: 'spin', sku: PLA, script: sc, voice: false, music: 'social/beat.mp3', musicVolume: 0.3 }]);
check('music under the reel, by its link, at the asked volume', r.ok && rend[rend.length - 1].body.music && /beat\.mp3/.test(rend[rend.length - 1].body.music.url) && rend[rend.length - 1].body.music.volume === 0.3, r);
await sql`update social_assets set status = 'ready' where business_id = ${FIX.B} and status = 'rendering' and meta->>'music' = 'true'`;
t = await asB((ctx) => sm.assetsTick(ctx));
r = await sales('erpSocialAssets', [{}]);
check('a failed job: the reason kept', t.failed >= 1 && r.result.assets.some((x) => x.status === 'failed' && /ffmpeg said no/.test(x.error)), [t]);
jobState = 'done';
r = await sales('erpSocialVideo', [{ template: 'showcase', sku: PLA, script: sc }]);
check('a showcase needs the clip', !r.ok && /clip/.test(r.error), r);
await deps.storage.save(FIX.B, 'social', 'clip1.mp4', Buffer.alloc(500, 3), 'video/mp4');
r = await sales('erpSocialVideo', [{ template: 'showcase', sku: PLA, script: sc, clip: 'social/clip1.mp4', clipSeconds: 10, voice: false }]);
const sj = rend[rend.length - 1].body;
check('a showcase: the clip by its link, 10 s, then the end card', r.ok && sj.clip && /clip1\.mp4/.test(sj.clip.url) && sj.clip.seconds === 10 && sj.slides.length === 1, [r, sj.clip]);
r = await sales('erpSocialVideo', [{ template: 'reasons', sku: PLA, script: sc, voice: false, format: 'square' }]);
check('3 reasons, square', r.ok && rend[rend.length - 1].body.height === 1080 && rend[rend.length - 1].body.slides.some((s) => /Fits every printer/.test(s.html)), r);

// ---- 5. remove, the clip request, the other business
r = await sales('erpSocialAssetAct', [{ id: card.id, action: 'remove' }]);
r = await sales('erpSocialAssets', [{}]);
check('a removed picture leaves the list', r.ok && !r.result.assets.some((x) => x.id === card.id));
r = await sales('erpSocialClipRequest', [{ sku: PLA }]);
check('only a manager asks staff for a clip', !r.ok, r);
r = await mgr('erpSocialClipRequest', [{ sku: PLA, note: 'show the spool label' }]);
check('the clip request: a Notifications task for staff', r.ok && /10-second/.test(r.result.text) && (await sql`select count(*)::int n from inbox_tasks where business_id = ${FIX.B} and reason = 'clip'`)[0].n === 1, r);
check('the other business has nothing', (await sql`select count(*)::int n from social_assets where business_id = ${FIX.B2}`)[0].n === 0);

await done();
