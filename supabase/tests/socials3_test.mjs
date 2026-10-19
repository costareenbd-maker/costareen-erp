// S3 (131_social_inspo.sql, handlers/socialmake.js): the inspiration box (link / file / words -> a style card), the rules
// (writers obey, stock and daily cap enforced), the learning loop, the Pexels key and b-roll in a reel job.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const sm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'socialmake.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';
deps.render = { url: 'https://render.test/render', key: 'rk' };
const PLA = 'FIL-SUN-PLA-BLA-001';

const rend = [];
let study = { state: 'done', meta: { title: 'Stringing fix in 10 s', by: 'MakerBD', views: 120000, likes: 4000, seconds: 14, audio: true }, frames: 6 };
web.on(/render\.test\/render/, (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  rend.push({ url, body, method: opts.method });
  if (/\/inspo$/.test(url)) return { status: 200, body: { id: 'b'.repeat(32), state: 'queued' } };
  if (/\/video$/.test(url)) return { status: 200, body: { id: 'a'.repeat(32), state: 'queued' } };
  if (/\/job\//.test(url)) return { status: 200, body: study };
  if (/\/png$/.test(url)) return { status: 200, body: 'PNG'.padEnd(400, 'x') };
  return { status: 404, body: {} };
});
let lastBody = null;
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  lastBody = JSON.parse(opts.body);
  const txt = JSON.stringify(lastBody);
  if (/style card/.test(txt)) return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ hook: 'Shows a failed print first', hookType: 'negative', structure: ['fail', 'the fix', 'result'], shots: ['close-up nozzle'], pace: 'fast, cuts every 2 s', captions: 'big yellow words', sound: 'voice-over', whyItWorks: 'pain first', copyThis: ['show the fail', 'name the price at 8 s'], avoid: ['long intro'] }) }] } }], usageMetadata: { promptTokenCount: 900, candidatesTokenCount: 200 } } };
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify({ broll: '3d printer nozzle closeup', hookType: 'negative', hook: 'Stop doing this', lines: ['a', 'b', 'c'], cta: 'Inbox', voice: 'x y z', facebook: 'fb', instagram: 'ig', marketplace: 'mp', whatsapp: 'wa' }) }] } }], usageMetadata: { promptTokenCount: 300, candidatesTokenCount: 100 } } };
});
web.on(/api\.pexels\.com/, (url, opts) => ({ status: opts.headers && opts.headers.Authorization === 'PEXKEY' ? 200 : 401, body: { videos: [] } }));

// ---- 1. rules
let r = await sales('erpSocialRules', [{}]);
check('the rules: built-in ones always, none of our own yet, 2 a day', r.ok && r.result.builtIn.length >= 5 && r.result.rules.length === 0 && r.result.maxDay === 2 && !r.result.pexels, r);
r = await sales('erpSocialRules', [{ save: 'x' }]);
check('staff cannot change the rules', !r.ok, r);
r = await mgr('erpSocialRules', [{ save: 'Mention free delivery inside Dhaka over 3,000 Tk\n\nNever say cheap', windows: '12:30, 20:30', maxDay: 3 }]);
check('a manager saves rules, posting times and the daily cap', r.ok && r.result.rules.length === 2 && r.result.windows.join() === '12:30,20:30' && r.result.maxDay === 3, r);
r = await sales('erpSocialScript', [{ template: 'spin', sku: PLA, lang: 'en' }]);
check('the writer is told the rules (built-in and ours) and asks for a b-roll idea', r.ok && /Never say cheap/.test(lastBody.systemInstruction.parts[0].text) && /price is in every post/i.test(lastBody.systemInstruction.parts[0].text) && r.result.script.broll === '3d printer nozzle closeup', r);
r = await sales('erpSocialCaptions', [{ sku: PLA, lang: 'en' }]);
check('the caption writer is told the rules too', r.ok && /Never say cheap/.test(lastBody.systemInstruction.parts[0].text), lastBody.systemInstruction.parts[0].text.slice(-200));

// ---- 2. the rules are enforced when posting: no product out of stock, the daily cap
r = await owner('erpSaveProduct', [{ isNew: true, product_name: 'Empty Shelf Item', category: 'Parts', brand: 'BIQU', unit: 'Piece', cost_price: 100, sell_price: 500, opening_stock: 0, status: 'Active' }]);
const OUT = r.result && (r.result.sku || (r.result.product && r.result.product.sku)) || (await sql`select sku from products where business_id = ${FIX.B} and name = 'Empty Shelf Item'`)[0].sku;
r = await owner('erpSocialSave', [{ sku: OUT, captions: { facebook: 'x' }, targets: { facebook: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
check('a product with no stock is not posted', !r.ok && /out of stock/.test(r.error), r);
await sql`update social_posts set state = 'published', published_at = now() where business_id = ${FIX.B}`;
for (let i = 0; i < 3; i++) await sql`insert into social_posts (business_id, title, captions, targets, state, published_at, created_by) values (${FIX.B}, ${'p' + i}, '{}', '{"facebook":true}', 'published', now(), 'x')`;
r = await owner('erpSocialSave', [{ captions: { facebook: 'one more' }, targets: { facebook: true } }]);
r = await owner('erpSocialAct', [{ id: r.result.post.id, action: 'publish' }]);
check('the daily cap (3) holds: the fourth is refused with the count', !r.ok && /at most 3 posts a day/.test(r.error), r);

// ---- 3. the inspiration box: a link -> a study job -> the style card by the minute timer
rend.length = 0;
r = await sales('erpSocialInspo', [{ url: 'https://www.facebook.com/reel/123', note: 'love the start' }]);
const job = rend.find((x) => /\/inspo$/.test(x.url));
check('a link starts a study on the render server with six frame addresses and one for the sound', r.ok && r.result.inspo.length === 1 && r.result.inspo[0].status === 'studying' && job && job.body.url === 'https://www.facebook.com/reel/123' && job.body.uploads.frames.length === 6 && job.body.uploads.audio, [r, job && job.body]);
const I1 = r.result.inspo[0].id;
for (let i = 0; i < 6; i++) await deps.storage.save(FIX.B, 'social', 'inspo-' + I1 + '-f' + i + '.jpg', Buffer.alloc(600, 1), 'image/jpeg');
await deps.storage.save(FIX.B, 'social', 'inspo-' + I1 + '-a.mp3', Buffer.alloc(2000, 2), 'audio/mpeg');
let t = await asB((ctx) => sm.assetsTick(ctx));
r = await sales('erpSocialInspo', [{}]);
const card = r.result.inspo[0];
check('the timer sees the study done: frames and sound go to the AI, the style card is written', t.studied === 1 && card.status === 'ready' && card.style.hookType === 'negative' && card.style.copyThis.length === 2 && card.meta.title === 'Stringing fix in 10 s' && card.meta.views === 120000, [t, card]);
check('the AI got six pictures and the sound', lastBody.contents[0].parts.filter((p) => p.inline_data && /image/.test(p.inline_data.mime_type)).length === 6 && lastBody.contents[0].parts.some((p) => p.inline_data && /audio/.test(p.inline_data.mime_type)) && /love the start/.test(lastBody.contents[0].parts[lastBody.contents[0].parts.length - 1].text));
r = await sales('erpSocialInspo', [{ text: 'A reel: a print fails, then a slow zoom on the spool, big yellow captions, price at the end.' }]);
check('a video described in words is studied at once', r.ok && r.result.inspo[0].status === 'ready' && r.result.inspo[0].style.hook, r.result.inspo[0]);
study = { state: 'failed', error: 'This site will not give the video to a server: save the video on your phone and upload the file instead.' };
r = await sales('erpSocialInspo', [{ url: 'https://www.youtube.com/shorts/abc' }]);
t = await asB((ctx) => sm.assetsTick(ctx));
r = await sales('erpSocialInspo', [{}]);
check('a site that refuses: failed with the advice to upload the file', r.result.inspo.some((x) => x.status === 'failed' && /upload the file/.test(x.error)), r.result.inspo.map((x) => x.status));
study = { state: 'done', meta: { title: 'Uploaded one', seconds: 9 }, frames: 6 };
await deps.storage.save(FIX.B, 'social', 'myreel.mp4', Buffer.alloc(500, 3), 'video/mp4');
r = await sales('erpSocialInspo', [{ file: 'social/myreel.mp4' }]);
check('an uploaded video is studied by its link', r.ok && rend[rend.length - 1].body.clipUrl && /myreel\.mp4/.test(rend[rend.length - 1].body.clipUrl), rend[rend.length - 1].body);

// ---- 4. a reel in the style of a card; the Pexels key and the b-roll opening
r = await sales('erpSocialScript', [{ template: 'spin', sku: PLA, lang: 'en', style: I1 }]);
check('the writer follows the chosen style card', r.ok && /MAKE IT IN THIS STYLE/.test(lastBody.systemInstruction.parts[0].text) && /show the fail/.test(lastBody.systemInstruction.parts[0].text));
const sc = r.result.script;
r = await owner('erpSocialPexels', [{ key: 'WRONG' }]);
check('a wrong Pexels key is refused', !r.ok, r);
r = await owner('erpSocialPexels', [{ key: 'PEXKEY' }]);
check('the owner\'s Pexels key is checked and sealed', r.ok && r.result.pexels && (await sales('erpSocialRules', [{}])).result.pexels);
await deps.storage.save(FIX.B, 'products', 'pla.jpg', Buffer.concat([Buffer.from('\xff\xd8\xff'), Buffer.alloc(300, 2)]), 'image/jpeg');
await sql`update products set photo = 'pla.jpg' where business_id = ${FIX.B} and sku = ${PLA}`;
rend.length = 0;
r = await sales('erpSocialVideo', [{ template: 'spin', sku: PLA, script: sc, lang: 'en', voice: false, style: I1 }]);
const vj = rend.find((x) => /\/video$/.test(x.url));
check('with a key, the reel job opens on a stock clip: the b-roll words, the key, the hook laid over it; the style kept with the video', r.ok && vj && vj.body.broll && vj.body.broll.key === 'PEXKEY' && vj.body.broll.query === '3d printer nozzle closeup' && /Stop doing this/.test(vj.body.broll.html) && r.result.asset.meta.style === I1 && r.result.asset.meta.broll === true, [r.result && r.result.asset.meta, vj && vj.body.broll]);
r = await sales('erpSocialVideo', [{ template: 'spin', sku: PLA, script: sc, lang: 'en', voice: false, broll: false }]);
check('b-roll can be switched off for one reel', r.ok && !rend[rend.length - 1].body.broll);
r = await owner('erpSocialPexels', [{ key: '' }]);
check('the key can be removed', r.ok && !r.result.pexels);

// ---- 5. the learning loop
await sql`update social_posts set stats = '{"facebook":{"reach":1000,"reactions":30,"comments":5,"shares":2}}'::jsonb where business_id = ${FIX.B} and title = 'p0'`;
await sql`update social_posts set stats = '{"facebook":{"reach":100,"reactions":1}}'::jsonb where business_id = ${FIX.B} and title = 'p1'`;
const vid = (await sql`select file from social_assets where business_id = ${FIX.B} and kind = 'video' order by created_at limit 1`)[0].file;
await sql`update social_posts set media = ${sql.json([{ kind: 'video', file: vid }])}, sku = ${PLA} where business_id = ${FIX.B} and title = 'p0'`;
t = await asB((ctx) => sm.learnTick(ctx));
r = await sales('erpSocialLearn', [{}]);
const L = r.result.learn;
check('posts are scored; what worked by hook, format, hour and product', t.posts >= 4 && L.posts >= 4 && L.top[0].title === 'p0' && L.top[0].score === 1000 + 150 + 50 + 40 && L.hooks.some((h) => h.key === 'negative') && L.products.some((h) => h.key === PLA) && L.hours.length >= 1, L);
check('each post keeps its score and how it stands to the median', (await sql`select stats->>'score' s, stats->>'vsMedian' m from social_posts where business_id = ${FIX.B} and title = 'p0'`)[0].s === '1240');
r = await sales('erpSocialScript', [{ template: 'spin', sku: PLA, lang: 'en' }]);
check('the writer is told what has worked', /WHAT HAS WORKED FOR US/.test(lastBody.systemInstruction.parts[0].text) && /negative/.test(lastBody.systemInstruction.parts[0].text));
check('the other business sees none of it', (await sql`select count(*)::int n from social_inspo where business_id = ${FIX.B2}`)[0].n === 0);

await done();
