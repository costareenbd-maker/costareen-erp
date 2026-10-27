// The content factory (owner 20 Oct 2026, advertising automation S2): pictures and videos made for the shop from what
// the ERP already knows - the product's photo, name, price and stock - so a post never starts from a blank page.
//
//   erpSocialAssets()                    the pictures and videos made (90 days), ready / rendering / failed
//   erpSocialCard({template, sku, skus, format, offer, headline, lang})   a photo card: PNG drawn by the render server
//   erpSocialAiPhoto({sku, file, scene, lang})   the product placed in a scene by Gemini's image model
//   erpSocialScript({template, sku, lang, notes})   the AI writes the reel's slides and voice-over (to edit before cutting)
//   erpSocialVideo({template, sku, script, media, clip, voice, lang, format})   a template reel: slides drawn, voice spoken,
//                                        cut by ffmpeg on the render server, uploaded straight into the file store
//   erpSocialAssetAct({id, action})      remove
//   erpSocialClipRequest({sku, note})    a task for staff: "shoot a 10-second clip of X"
//   assetsTick(ctx)                      the minute timer: videos whose job finished become ready
//
// Costs: a photo card and a template reel cost nothing (our own server). An AI photo ~৳5, a voice-over ~৳1, a script
// ~free; each is written to ai_work. The day's AI allowance (300 a day per business) counts them too.

import { getConfig, setConfig, getSecret, setSecret, saveFile, fileUrl, readFile } from '../lib/ext.js';
import { formatDate, num } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { gemini, jsonOf } from '../lib/gemini.js';
import { renderPng, startVideo, videoJob, startStudy } from '../lib/render.js';
import { aiKey } from './receivefile.js';
import { products } from './dashboard.js';
import { task } from './inbox.js';
import { storeConn, storeItems, storeMatcher, storeKind } from './stores.js';

const str = (v) => String(v == null ? '' : v).trim();
// cheapest first; erpSocialAiModels lists what the key can use when Google renames them
const IMAGE_MODELS = ['gemini-3.1-flash-lite-image', 'gemini-3.1-flash-image', 'gemini-2.5-flash-image'];
// voices: Microsoft Edge's neural voices through edge-tts on the render server (free; the same ones MoneyPrinterTurbo and
// ShortGPT use), with word timings for the captions. Bangla first.
const VOICES = { bn: { f: 'bn-BD-NabanitaNeural', m: 'bn-BD-PradeepNeural' }, en: { f: 'en-US-AriaNeural', m: 'en-US-GuyNeural' } };
// the hook archetypes the short-video people swear by (curiosity gap, negative, number, POV, cliffhanger...); the writer
// rotates them and the hook used is kept with the video, so the learning loop (S3) can see which ones win
const HOOKS = [
  ['question', 'a question the buyer asks themselves ("Prints keep failing at the corners?")'],
  ['negative', 'a mistake they are making ("Stop drying your filament like this")'],
  ['number', 'a number promise ("3 reasons this roll prints cleaner")'],
  ['curiosity', 'a curiosity gap ("Nobody tells you this about PLA")'],
  ['pov', 'a POV moment ("POV: your first print came out perfect")'],
  ['result', 'the result first ("This came off the bed with zero stringing")'],
  ['price', 'the price as the hook ("1,600 taka for a full kilo")'],
  ['comparison', 'this vs that ("Cheap PLA vs this one")'],
  ['cliffhanger', 'wait for it ("Watch what happens at layer 40")'],
  ['objection', 'the objection answered ("Too expensive? Count the failed prints")'],
];
const FORMATS = { square: [1080, 1080], portrait: [1080, 1350], story: [1080, 1920] };
const CARD_TEMPLATES = ['clean', 'offer', 'left', 'new', 'bundle'];
const VIDEO_TEMPLATES = ['spin', 'reveal', 'reasons', 'showcase'];
const SCENES = {
  desk: 'on a tidy modern maker desk next to a 3D printer, warm daylight from a window, shallow depth of field',
  studio: 'on a clean white studio table with soft even light and a faint shadow, product photography',
  workshop: 'on a wooden workbench in a small 3D-printing workshop, printed parts around, warm light',
  hands: 'held in a person\'s hands at chest height, blurred home background, natural light',
  dark: 'on a dark matte surface with a single warm rim light, premium look, black background',
};

function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role || 'sales')) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).'); }
function b64(bytes) { let s = ''; const CH = 0x8000; for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH)); return btoa(s); }
function b64decode(s) { const bin = atob(String(s || '').replace(/^data:[^,]*,/, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tk = (n) => '৳' + Math.round(num(n)).toLocaleString('en-IN');
const bnDigits = (s) => String(s).replace(/\d/g, (d) => '০১২৩৪৫৬৭৮৯'[+d]);

async function allowance(ctx, n) {
  const k = 'ai_chat:' + formatDate(ctx.now, 'yyyy-MM-dd'), used = num(await getConfig(ctx, k, '0'));
  if (used >= 300) throw new Error('Today\'s AI allowance is used up for this business.');
  await setConfig(ctx, k, String(used + (n || 1)));
}
async function logWork(ctx, purpose, model, tin, tout, costBdt) {
  try { await ctx.tx`insert into ai_work (business_id, purpose, conversation_id, model, tokens_in, tokens_out, cost_bdt) values (${ctx.biz}, ${purpose}, ${null}, ${model}, ${tin || 0}, ${tout || 0}, ${costBdt || 0})`; } catch (_) { /* never the reason */ }
}

/** A product with its photo as a data: URI (the stored photo, else the web photo fetched). */
async function productWithPhoto(ctx, sku) {
  const { list } = await products(ctx);
  const p = list.find((x) => x.sku.toLowerCase() === str(sku).toLowerCase());
  if (!p) throw new Error('No product with code ' + sku + '.');
  const r = (await ctx.tx`select photo, thumb, image_link from products where business_id = ${ctx.biz} and lower(sku) = ${str(sku).toLowerCase()}`)[0] || {};
  let data = '', mime = '';
  if (str(r.photo)) { const bytes = await readFile(ctx, 'products', str(r.photo)); if (bytes) { mime = /\.png$/i.test(r.photo) ? 'image/png' : /\.webp$/i.test(r.photo) ? 'image/webp' : 'image/jpeg'; data = 'data:' + mime + ';base64,' + b64(bytes); } }
  if (!data && str(r.image_link)) {
    try { const res = await (ctx.deps.fetch || fetch)(str(r.image_link)); if (res.ok) { mime = str(res.headers.get('content-type')).split(';')[0] || 'image/jpeg'; const bytes = new Uint8Array(await res.arrayBuffer()); if (bytes.length < 6 * 1024 * 1024) data = 'data:' + mime + ';base64,' + b64(bytes); } } catch (_) { /* no web photo */ }
  }
  return { sku: p.sku, name: p.name, sell: num(p.sell), stock: num(p.stock), cat: str(p.cat), brand: str(p.brand), photo: data, mime };
}
async function fileData(ctx, file) {
  const f = str(file);
  if (/^https?:\/\//.test(f)) { const res = await (ctx.deps.fetch || fetch)(f); const bytes = new Uint8Array(await res.arrayBuffer()); return 'data:' + (str(res.headers.get('content-type')).split(';')[0] || 'image/jpeg') + ';base64,' + b64(bytes); }
  const i = f.indexOf('/'); if (i < 0) return '';
  const bytes = await readFile(ctx, f.slice(0, i), f.slice(i + 1)); if (!bytes) return '';
  return 'data:' + (/\.png$/i.test(f) ? 'image/png' : 'image/jpeg') + ';base64,' + b64(bytes);
}

// ------------------------------------------------------------------ the owner's rules, what worked, the style cards (S3)
const BUILT_IN_RULES = ['The price is in every post.', 'One product per post.', 'Never a fake "only N left" or a made-up deadline: stock counts and dates come from the ERP.',
  'Bangla first; product and brand names stay as written.', 'Never a product that is out of stock.', 'Claims only from the product\'s own details; no competitor names.'];
export async function erpSocialRules(ctx, payload) {
  need(ctx);
  const p = payload || {};
  if (p.save !== undefined) {
    if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner writes the rules. If you need this, ask the owner to open it for you (Settings > Users).');
    const lines = String(p.save).split(/\n+/).map((x) => x.trim()).filter(Boolean).slice(0, 40).map((x) => x.slice(0, 200));
    await setConfig(ctx, 'social_rules', JSON.stringify(lines));
    const w = String(p.windows || '').split(/[,\s]+/).filter((x) => /^\d{1,2}:\d{2}$/.test(x)).slice(0, 6);
    await setConfig(ctx, 'social_windows', JSON.stringify(w));
    await setConfig(ctx, 'social_max_day', String(Math.max(0, Math.min(10, num(p.maxDay)))));
  }
  let rules = []; try { rules = JSON.parse(str(await getConfig(ctx, 'social_rules', '[]')) || '[]'); } catch (_) { rules = []; }
  let windows = []; try { windows = JSON.parse(str(await getConfig(ctx, 'social_windows', '[]')) || '[]'); } catch (_) { windows = []; }
  return { builtIn: BUILT_IN_RULES, rules, windows, maxDay: num(await getConfig(ctx, 'social_max_day', '2')) || 2, pexels: !!(await getSecret(ctx, 'PEXELS_KEY')) };
}
async function rulesText(ctx) {
  let rules = []; try { rules = JSON.parse(str(await getConfig(ctx, 'social_rules', '[]')) || '[]'); } catch (_) { rules = []; }
  return 'THE SHOP\'S RULES (always):\n- ' + BUILT_IN_RULES.concat(rules).join('\n- ');
}
/** What has worked for this shop, from the figures the posts reported (the learning loop): fed to the writers as a hint. */
async function learnText(ctx) {
  let L = null; try { L = JSON.parse(str(await getConfig(ctx, 'social_learn', '')) || 'null'); } catch (_) { L = null; }
  if (!L || !L.posts) return '';
  const bits = [];
  if ((L.hooks || []).length) bits.push('hook types that scored best: ' + L.hooks.slice(0, 3).map((h) => h.key + ' (' + h.score + ')').join(', '));
  if ((L.templates || []).length) bits.push('formats that scored best: ' + L.templates.slice(0, 3).map((h) => h.key).join(', '));
  if ((L.hours || []).length) bits.push('best posting hours (Dhaka): ' + L.hours.slice(0, 3).map((h) => h.key + ':00').join(', '));
  if ((L.products || []).length) bits.push('products people reacted to: ' + L.products.slice(0, 3).map((h) => h.key).join(', '));
  return bits.length ? 'WHAT HAS WORKED FOR US (from ' + L.posts + ' posts): ' + bits.join('; ') + '.' : '';
}
export async function writerContext(ctx) { return [await rulesText(ctx), await learnText(ctx)].filter(Boolean).join('\n'); }
/** The owner's Pexels key for stock b-roll (free at pexels.com/api). Stored sealed; never shown back. */
export async function erpSocialPexels(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner sets the stock-footage key.');
  const k = str(payload && payload.key);
  if (k === '') { await setSecret(ctx, 'PEXELS_KEY', ''); return { ok: true, pexels: false }; }
  const res = await (ctx.deps.fetch || fetch)('https://api.pexels.com/videos/search?query=printer&per_page=1', { headers: { Authorization: k } });
  if (!res.ok) throw new Error('Pexels refused that key (' + res.status + ').');
  await setSecret(ctx, 'PEXELS_KEY', k);
  return { ok: true, pexels: true };
}

// ------------------------------------------------------------------ the inspiration box
const INSPO_FRAMES = 6;
function inspoView(r) {
  return { id: r.id, url: str(r.url), file: str(r.file), note: str(r.note), status: r.status, error: str(r.error), meta: r.meta || {}, style: r.style || {}, createdBy: str(r.created_by), created: formatDate(new Date(r.created_at), 'd MMM') };
}
export async function erpSocialInspo(ctx, payload) {
  need(ctx);
  const p = payload || {};
  if (str(p.action) === 'remove') { await ctx.tx`update social_inspo set status = 'removed', updated_at = now() where business_id = ${ctx.biz} and id = ${str(p.id)}`; }
  else if (str(p.url) || str(p.file) || str(p.text)) {
    if (!(ctx.deps.storage && ctx.deps.storage.signUpload)) throw new Error('File uploads are not available on this server.');
    const url = /^https?:\/\/\S+$/.test(str(p.url)) ? str(p.url).slice(0, 500) : '';
    const file = str(p.file).replace(/^social\//, '');
    if (str(p.text) && !url && !file) {
      // only words: the AI studies the description itself
      const r = (await ctx.tx`insert into social_inspo (business_id, note, status, meta, created_by) values (${ctx.biz}, ${str(p.text).slice(0, 2000)}, 'studying', ${ctx.tx.json({ text: true })}, ${ctx.s.name}) returning *`)[0];
      await studyInspo(ctx, r);
      return erpSocialInspo(ctx, {});
    }
    if (!(ctx.deps.render && ctx.deps.render.url)) throw new Error('The render server is not set up on this system.');
    const id = globalThis.crypto.randomUUID();
    const frames = [];
    for (let i = 0; i < INSPO_FRAMES; i++) frames.push(await ctx.deps.storage.signUpload(ctx.biz, 'social', 'inspo-' + id + '-f' + i + '.jpg'));
    const audio = await ctx.deps.storage.signUpload(ctx.biz, 'social', 'inspo-' + id + '-a.mp3');
    const job = { uploads: { frames: frames.map((f) => f.url), audio: audio.url } };
    if (file) job.clipUrl = await fileUrl(ctx, 'social', file); else job.url = url;
    const jobId = await startStudy(ctx.deps, job);
    await ctx.tx`insert into social_inspo (id, business_id, url, file, note, status, job, meta, created_by) values (${id}, ${ctx.biz}, ${url || null}, ${file ? 'social/' + file : null}, ${str(p.note).slice(0, 500) || null}, 'studying', ${jobId},
      ${ctx.tx.json({ frames: frames.map((f, i) => 'inspo-' + id + '-f' + i + '.jpg'), audio: 'inspo-' + id + '-a.mp3' })}, ${ctx.s.name})`;
  }
  const rows = await ctx.tx`select * from social_inspo where business_id = ${ctx.biz} and status <> 'removed' order by created_at desc limit 60`;
  return { inspo: rows.map(inspoView), studying: rows.filter((r) => r.status === 'studying').length };
}
/** The AI studies the frames and the sound (or the words) into a style card. */
async function studyInspo(ctx, r) {
  const meta = r.meta || {};
  const parts = [];
  if (!meta.text) {
    for (const f of meta.frames || []) { const b = await readFile(ctx, 'social', f); if (b && b.length > 200) parts.push({ inline_data: { mime_type: 'image/jpeg', data: b64(b) } }); }
    if (meta.audio && meta.hasAudio !== false) { const a = await readFile(ctx, 'social', meta.audio); if (a && a.length > 500 && a.length < 3 * 1024 * 1024) parts.push({ inline_data: { mime_type: 'audio/mpeg', data: b64(a) } }); }
  }
  const facts = ['Title: ' + str(meta.title), 'By: ' + str(meta.by), meta.views ? 'Views: ' + meta.views + ', likes: ' + (meta.likes || 0) + ', comments: ' + (meta.comments || 0) : '', meta.seconds ? 'Length: ' + meta.seconds + ' s' : '', str(meta.description) ? 'Caption: ' + str(meta.description).slice(0, 600) : '', str(r.note) ? 'The owner says: ' + str(r.note) : ''].filter(Boolean);
  parts.push({ text: (meta.text ? 'A short video described in words:\n' : 'Frames of a short video in order, and its sound.\n') + facts.join('\n') +
    '\n\nWrite a style card a small shop can copy for its own product reels. JSON only: {"hook": "the first 2 seconds, in one line", "hookType": "question|negative|number|curiosity|pov|result|price|comparison|cliffhanger|objection|other", "structure": ["beat 1", "beat 2", "..."], "shots": ["shot 1", "..."], "pace": "fast|medium|slow, cuts every N s", "captions": "how the on-screen text looks", "sound": "voice-over / music / none, mood", "whyItWorks": "one or two sentences", "copyThis": ["3-5 concrete things to copy"], "avoid": ["what not to copy"]}. Short lines.' });
  try {
    const { parts: out } = await gemini(ctx, { contents: [{ role: 'user', parts }], generationConfig: { temperature: 0.4, responseMimeType: 'application/json' } }, 'inspo', null);
    const j = jsonOf(out) || {};
    const style = { hook: str(j.hook).slice(0, 200), hookType: str(j.hookType).slice(0, 20), structure: (Array.isArray(j.structure) ? j.structure : []).map((x) => str(x).slice(0, 120)).slice(0, 8), shots: (Array.isArray(j.shots) ? j.shots : []).map((x) => str(x).slice(0, 120)).slice(0, 8),
      pace: str(j.pace).slice(0, 80), captions: str(j.captions).slice(0, 200), sound: str(j.sound).slice(0, 120), whyItWorks: str(j.whyItWorks).slice(0, 300), copyThis: (Array.isArray(j.copyThis) ? j.copyThis : []).map((x) => str(x).slice(0, 160)).slice(0, 6), avoid: (Array.isArray(j.avoid) ? j.avoid : []).map((x) => str(x).slice(0, 160)).slice(0, 4) };
    await ctx.tx`update social_inspo set style = ${ctx.tx.json(style)}, status = 'ready', error = null, updated_at = now() where id = ${r.id}`;
    return true;
  } catch (e) {
    await ctx.tx`update social_inspo set status = 'failed', error = ${str(e && e.message).slice(0, 300)}, updated_at = now() where id = ${r.id}`;
    return false;
  }
}
async function styleText(ctx, id) {
  if (!str(id)) return '';
  const r = (await ctx.tx`select style, meta from social_inspo where business_id = ${ctx.biz} and id = ${str(id)} and status = 'ready'`)[0];
  if (!r || !r.style || !r.style.hook) return '';
  const st = r.style;
  return 'MAKE IT IN THIS STYLE (a reel the owner likes): hook: ' + st.hook + ' (type ' + st.hookType + '); structure: ' + (st.structure || []).join(' → ') + '; pace: ' + st.pace + '; captions: ' + st.captions + '; copy: ' + (st.copyThis || []).join('; ') + (st.avoid && st.avoid.length ? '; avoid: ' + st.avoid.join('; ') : '') + '.';
}

// ------------------------------------------------------------------ the learning loop
/** Score every published post from its figures, then what worked by hook, format, hour and product. Nightly. */
export async function learnTick(ctx) {
  const posts = await ctx.tx`select p.*, a.template as a_template, a.meta as a_meta from social_posts p
    left join social_assets a on a.file = (p.media->0->>'file') and a.business_id = p.business_id
    where p.business_id = ${ctx.biz} and p.state = 'published' and p.published_at > now() - interval '60 days'`;
  if (!posts.length) { await setConfig(ctx, 'social_learn', JSON.stringify({ posts: 0, at: ctx.now.toISOString() })); return { posts: 0 }; }
  const scoreOf = (st) => { const f = (st && st.facebook) || {}, g = (st && st.instagram) || {};
    return num(f.reach || f.views || f.plays) + num(g.reach || g.views) + 5 * (num(f.reactions) + num(g.likes)) + 10 * (num(f.comments) + num(g.comments)) + 20 * (num(f.shares) + num(g.shares) + num(g.saved)) + 3 * num(f.clicks); };
  const rows = posts.map((p) => { const s = scoreOf(p.stats); const hour = Number(formatDate(new Date(p.published_at), 'H')); const hook = str(p.a_meta && p.a_meta.script && p.a_meta.script.hookType) || (p.a_meta ? 'none' : 'picture');
    return { id: p.id, title: str(p.title), score: s, hour, hook, template: str(p.a_template) || (p.media && p.media.length ? (p.media[0].kind === 'video' ? 'video' : 'picture') : 'text'), sku: str(p.sku), at: formatDate(new Date(p.published_at), 'd MMM') }; });
  const sorted = rows.slice().sort((a, b) => b.score - a.score);
  const median = sorted[Math.floor(sorted.length / 2)].score || 1;
  const by = (key) => { const m = {}; for (const r of rows) { const k = r[key] || '-'; if (k === '-' || k === 'none') continue; (m[k] = m[k] || { key: k, n: 0, sum: 0 }); m[k].n++; m[k].sum += r.score; } return Object.values(m).filter((x) => x.n >= 1).map((x) => ({ key: x.key, n: x.n, score: Math.round(x.sum / x.n) })).sort((a, b) => b.score - a.score).slice(0, 6); };
  const L = { posts: rows.length, median: Math.round(median), at: ctx.now.toISOString(), top: sorted.slice(0, 5).map((r) => ({ id: r.id, title: r.title, score: Math.round(r.score), at: r.at, hook: r.hook, template: r.template })),
              hooks: by('hook'), templates: by('template'), hours: by('hour'), products: by('sku') };
  await setConfig(ctx, 'social_learn', JSON.stringify(L));
  for (const r of rows) await ctx.tx`update social_posts set stats = stats || ${ctx.tx.json({ score: Math.round(r.score), vsMedian: median ? Math.round(r.score / median * 100) : 0 })} where id = ${r.id}`;
  return { posts: rows.length };
}
export async function erpSocialLearn(ctx) {
  need(ctx);
  let L = null; try { L = JSON.parse(str(await getConfig(ctx, 'social_learn', '')) || 'null'); } catch (_) { L = null; }
  return { learn: L };
}

// ------------------------------------------------------------------ the look of every card and slide
const CSS = (W, H) => '<style>*{box-sizing:border-box}html,body{margin:0;width:' + W + 'px;height:' + H + 'px;overflow:hidden}body{font-family:Inter,"Noto Sans Bengali",sans-serif;color:#fff;background:linear-gradient(160deg,#141a2b 0%,#1f2a44 60%,#2b1f14 100%)}' +
  '.shop{position:absolute;left:56px;top:48px;font-size:34px;font-weight:700;letter-spacing:.02em;opacity:.9}.shop i{display:inline-block;width:14px;height:14px;border-radius:50%;background:#f0a030;margin-right:12px}' +
  '.photo{position:absolute;left:56px;right:56px;background:#fff;border-radius:36px;overflow:hidden;display:flex;align-items:center;justify-content:center;box-shadow:0 30px 80px rgba(0,0,0,.45)}.photo img{width:100%;height:100%;object-fit:contain}.photo.none{background:#2a3350;color:#9aa4b5;font-size:40px}' +
  '.name{position:absolute;left:56px;right:56px;font-size:56px;font-weight:800;line-height:1.15;text-shadow:0 2px 12px rgba(0,0,0,.4)}.sub{position:absolute;left:56px;right:56px;font-size:34px;opacity:.85}' +
  '.price{position:absolute;right:56px;background:#f0a030;color:#1a1206;font-weight:900;font-size:72px;padding:14px 40px;border-radius:28px;box-shadow:0 16px 40px rgba(0,0,0,.4)}.price small{display:block;font-size:26px;font-weight:600;opacity:.75;text-decoration:line-through}' +
  '.ribbon{position:absolute;left:-10px;background:#e8590c;color:#fff;font-weight:800;font-size:38px;padding:14px 46px 14px 70px;border-radius:0 26px 26px 0;transform:rotate(-4deg);box-shadow:0 10px 30px rgba(0,0,0,.4)}' +
  '.foot{position:absolute;left:56px;right:56px;bottom:48px;font-size:30px;opacity:.85;display:flex;justify-content:space-between}' +
  '.big{position:absolute;left:56px;right:56px;top:50%;transform:translateY(-50%);text-align:center;font-size:96px;font-weight:900;line-height:1.1;text-shadow:0 4px 20px rgba(0,0,0,.5)}.big small{display:block;font-size:40px;font-weight:600;opacity:.85;margin-top:24px}' +
  '.cta{position:absolute;left:56px;right:56px;bottom:140px;text-align:center;font-size:44px;font-weight:800;background:#f0a030;color:#1a1206;padding:26px;border-radius:30px}' +
  '.list{position:absolute;left:56px;right:56px;font-size:46px;line-height:1.5;font-weight:700}.list div{display:flex;gap:22px;margin:18px 0}.list b{background:#f0a030;color:#1a1206;border-radius:50%;width:66px;height:66px;flex:0 0 66px;display:flex;align-items:center;justify-content:center;font-size:36px}' +
  '.grid{position:absolute;left:56px;right:56px;display:flex;gap:24px}.grid .photo{position:static;flex:1;height:100%}' +
  '</style>';
function L(lang, en, bn) { return lang === 'bn' ? bn : en; }

function cardHtml(t, W, H, lang, shop, items, opts) {
  const p = items[0] || {};
  const photo = (x, h) => x && x.photo ? '<div class="photo" style="top:' + h.top + 'px;height:' + h.h + 'px"><img src="' + x.photo + '" alt=""></div>' : '<div class="photo none" style="top:' + h.top + 'px;height:' + h.h + 'px">' + esc(x ? x.name : '') + '</div>';
  const tall = H > W;
  const ph = { top: 130, h: tall ? Math.round(H * 0.48) : Math.round(H * 0.5) };
  const nameTop = ph.top + ph.h + 36, priceTop = nameTop + 150;
  const foot = '<div class="foot"><span>' + esc(L(lang, 'Inbox to order', 'অর্ডার করতে ইনবক্স করুন')) + '</span><span>' + esc(opts.site || '') + '</span></div>';
  const head = '<div class="shop"><i></i>' + esc(shop) + '</div>';
  const price = (x, extra) => '<div class="price" style="top:' + priceTop + 'px">' + (extra || '') + tk(x) + '</div>';
  if (t === 'bundle') {
    const n = items.length, h = { top: 130, h: Math.round(H * 0.42) };
    const total = num(opts.offer) > 0 ? num(opts.offer) : items.reduce((s, x) => s + x.sell, 0);
    return '<html><head>' + CSS(W, H) + '</head><body>' + head + '<div class="grid" style="top:' + h.top + 'px;height:' + h.h + 'px">' + items.map((x) => (x.photo ? '<div class="photo"><img src="' + x.photo + '" alt=""></div>' : '<div class="photo none">' + esc(x.name) + '</div>')).join('') + '</div>' +
      '<div class="name" style="top:' + (h.top + h.h + 36) + 'px;font-size:48px">' + esc(opts.headline || L(lang, 'Bundle: ' + n + ' together', 'একসাথে ' + bnDigits(n) + 'টি')) + '</div>' +
      '<div class="sub" style="top:' + (h.top + h.h + 110) + 'px;font-size:30px">' + items.map((x) => esc(x.name)).join(' + ') + '</div>' +
      '<div class="price" style="top:' + (h.top + h.h + 230) + 'px">' + (num(opts.offer) > 0 ? '<small>' + tk(items.reduce((s, x) => s + x.sell, 0)) + '</small>' : '') + tk(total) + '</div>' + foot + '</body></html>';
  }
  let ribbon = '';
  if (t === 'offer' && num(opts.offer) > 0 && num(opts.offer) < p.sell) ribbon = '<div class="ribbon" style="top:' + (ph.top + 30) + 'px">' + esc(Math.round((1 - num(opts.offer) / p.sell) * 100) + '% ' + L(lang, 'OFF', 'ছাড়')) + '</div>';
  if (t === 'left') ribbon = '<div class="ribbon" style="top:' + (ph.top + 30) + 'px">' + esc(L(lang, 'Only ' + Math.max(1, Math.round(p.stock)) + ' left', 'মাত্র ' + bnDigits(Math.max(1, Math.round(p.stock))) + 'টি বাকি')) + '</div>';
  if (t === 'new') ribbon = '<div class="ribbon" style="top:' + (ph.top + 30) + 'px">' + esc(L(lang, 'New arrival', 'নতুন এসেছে')) + '</div>';
  const pr = t === 'offer' && num(opts.offer) > 0 && num(opts.offer) < p.sell ? price(opts.offer, '<small>' + tk(p.sell) + '</small>') : price(p.sell);
  return '<html><head>' + CSS(W, H) + '</head><body>' + head + photo(p, ph) + ribbon +
    '<div class="name" style="top:' + nameTop + 'px">' + esc(opts.headline || p.name) + '</div>' + (opts.headline ? '<div class="sub" style="top:' + (nameTop + 80) + 'px">' + esc(p.name) + '</div>' : '') + pr + foot + '</body></html>';
}

function slideHtml(kind, W, H, lang, shop, x, s) {
  const head = '<div class="shop"><i></i>' + esc(shop) + '</div>';
  const base = '<html><head>' + CSS(W, H) + '</head><body>' + head;
  if (kind === 'photo') {
    // the title on top, the photo under it, the bottom third left free for the captions
    const tall = H > W, top = s.head ? (tall ? 300 : 230) : 140, ph = { top, h: Math.round(H * (tall ? 0.42 : 0.5)) };
    return base + (s.head ? '<div class="name" style="top:' + (tall ? 130 : 110) + 'px;font-size:' + (tall ? 64 : 54) + 'px;text-align:center">' + esc(s.head) + '</div>' : '') +
      (x.photo ? '<div class="photo" style="top:' + ph.top + 'px;height:' + ph.h + 'px"><img src="' + x.photo + '" alt=""></div>' : '') +
      (s.sub ? '<div class="sub" style="top:' + (ph.top + ph.h + 30) + 'px;text-align:center">' + esc(s.sub) + '</div>' : '') + '</body></html>';
  }
  if (kind === 'text') return base + '<div class="big" style="top:42%">' + esc(s.head || '') + (s.sub ? '<small>' + esc(s.sub) + '</small>' : '') + '</div></body></html>';
  if (kind === 'price') return base + '<div class="big" style="top:42%"><small style="margin:0 0 24px">' + esc(s.head || x.name) + '</small><span style="font-size:150px;color:#f0a030">' + tk(s.price || x.sell) + '</span>' + (s.sub ? '<small>' + esc(s.sub) + '</small>' : '') + '</div></body></html>';
  if (kind === 'list') return base + '<div class="name" style="top:140px;font-size:60px">' + esc(s.head || '') + '</div><div class="list" style="top:280px">' + (s.items || []).slice(0, 4).map((it, i) => '<div><b>' + (i + 1) + '</b><span>' + esc(it) + '</span></div>').join('') + '</div></body></html>';
  if (kind === 'cta') return base + (x.photo ? '<div class="photo" style="top:140px;height:' + Math.round(H * 0.36) + 'px"><img src="' + x.photo + '" alt=""></div>' : '') +
    '<div class="big" style="top:' + Math.round(H * 0.56) + 'px;font-size:56px">' + esc(s.head || x.name) + '<small style="color:#f0a030;font-size:72px;font-weight:900">' + tk(x.sell) + '</small></div><div class="cta" style="bottom:' + Math.round(H * 0.30) + 'px">' + esc(s.sub || L(lang, 'Inbox to order', 'অর্ডার করতে ইনবক্স করুন')) + '</div></body></html>';
  return base + '</body></html>';
}

// ------------------------------------------------------------------ the list
function view(r) {
  return { id: r.id, kind: r.kind, template: r.template, sku: str(r.sku), title: str(r.title), file: r.file, status: r.status, job: str(r.job), error: str(r.error), meta: r.meta || {}, cost: num(r.cost_bdt), createdBy: str(r.created_by), created: formatDate(new Date(r.created_at), 'd MMM h:mm a') };
}
export async function erpSocialAssets(ctx) {
  need(ctx);
  const rows = await ctx.tx`select * from social_assets where business_id = ${ctx.biz} and status <> 'removed' and created_at > now() - interval '90 days' order by created_at desc limit 200`;
  const out = [];
  for (const r of rows) { const v = view(r); if (r.status === 'ready') { try { v.url = await fileUrl(ctx, 'social', r.file.replace(/^social\//, '')); } catch (_) { v.url = ''; } } out.push(v); }
  const pics = (await ctx.tx`select count(*)::int n, count(*) filter (where coalesce(photo, '') <> '' or coalesce(image_link, '') <> '')::int with_pic from products where business_id = ${ctx.biz}`)[0];
  return { assets: out, templates: { card: CARD_TEMPLATES, video: VIDEO_TEMPLATES, scenes: Object.keys(SCENES) }, rendering: out.filter((a) => a.status === 'rendering').length, products: pics.n, withPicture: pics.with_pic, website: await storeKind(ctx),
           render: !!(ctx.deps.render && ctx.deps.render.url && ctx.deps.render.key) };
}
async function shopName(ctx) { return str(((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {}).name) || 'Shop'; }
async function siteName(ctx) { try { const s = str(await getConfig(ctx, 'website_url', '')); return s.replace(/^https?:\/\//, '').replace(/\/.*$/, ''); } catch (_) { return ''; } }
async function keep(ctx, kind, template, sku, title, name, meta, cost) {
  const r = (await ctx.tx`insert into social_assets (business_id, kind, template, sku, title, file, status, meta, cost_bdt, created_by) values (${ctx.biz}, ${kind}, ${template}, ${str(sku) || null}, ${str(title).slice(0, 120)}, ${'social/' + name}, 'ready', ${ctx.tx.json(meta || {})}, ${cost || 0}, ${ctx.s.name}) returning *`)[0];
  const v = view(r); v.url = await fileUrl(ctx, 'social', name); return v;
}
const stamp = (ctx) => formatDate(ctx.now, 'yyMMddHHmmss') + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 4);

// ------------------------------------------------------------------ photo cards
export async function erpSocialCard(ctx, payload) {
  need(ctx);
  const p = payload || {}, t = CARD_TEMPLATES.includes(str(p.template)) ? str(p.template) : 'clean';
  const [W, H] = FORMATS[str(p.format)] || FORMATS.square;
  const lang = str(p.lang) === 'bn' ? 'bn' : 'en';
  const skus = t === 'bundle' ? (Array.isArray(p.skus) ? p.skus : []).map(str).filter(Boolean).slice(0, 3) : [str(p.sku)].filter(Boolean);
  if (!skus.length) throw new Error(t === 'bundle' ? 'Choose two or three products for the bundle.' : 'Choose the product.');
  if (t === 'bundle' && skus.length < 2) throw new Error('A bundle is two or three products.');
  const items = []; for (const s of skus) items.push(await productWithPhoto(ctx, s));
  if (t === 'offer' && !(num(p.offer) > 0)) throw new Error('Type the offer price.');
  if (t === 'left' && !(items[0].stock > 0)) throw new Error(items[0].name + ' is not in stock: "only N left" would be untrue.');
  const html = cardHtml(t, W, H, lang, await shopName(ctx), items, { offer: num(p.offer), headline: str(p.headline).slice(0, 80), site: await siteName(ctx) });
  const png = await renderPng(ctx.deps, html, W, H);
  const name = 'card-' + t + '-' + stamp(ctx) + '.png';
  await saveFile(ctx, 'social', name, png, 'image/png');
  return { asset: await keep(ctx, 'image', t, skus[0], items.map((x) => x.name).join(' + '), name, { width: W, height: H, lang, offer: num(p.offer) || undefined, skus }, 0) };
}

// ------------------------------------------------------------------ AI photos
export async function erpSocialAiPhoto(ctx, payload) {
  need(ctx);
  const p = payload || {}, scene = SCENES[str(p.scene)] ? str(p.scene) : 'desk';
  const key = (await aiKey(ctx)).key;
  if (!key) throw new Error('The AI is not set up on this server (no AI key).');
  let src = '', name = '', sku = '';
  if (str(p.sku)) { const x = await productWithPhoto(ctx, p.sku); if (!x.photo) throw new Error(x.name + ' has no photo yet: add one on the product first.'); src = x.photo; name = x.name; sku = x.sku; }
  else if (str(p.file)) { src = await fileData(ctx, p.file); name = str(p.name) || 'picture'; }
  if (!src) throw new Error('Choose a product with a photo, or a picture.');
  await allowance(ctx, 1);
  const mime = (/^data:([^;]+)/.exec(src) || [])[1] || 'image/jpeg', data = src.replace(/^data:[^,]*,/, '');
  const prompt = 'Place this exact product ' + SCENES[scene] + '. Keep the product exactly as photographed: same shape, colours, label and text on it; do not add any text, logos or watermarks; photorealistic, sharp, square framing, the product fills about half of the frame.' + (str(p.notes) ? ' ' + str(p.notes).slice(0, 300) : '');
  let last = '';
  for (const model of IMAGE_MODELS) {
    let res, txt;
    try {
      res = await (ctx.deps.fetch || fetch)('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
        { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ parts: [{ inline_data: { mime_type: mime, data } }, { text: prompt }] }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'] } }) });
      txt = await res.text();
    } catch (_) { last = 'timeout'; continue; }
    if (!res.ok) { last += ' | ' + model + ': ' + res.status + ' ' + txt.replace(/\s+/g, ' ').slice(0, 140); if ([400, 404, 429, 503].includes(res.status)) continue; throw new Error('The image model could not answer (' + res.status + ').'); }
    let j; try { j = JSON.parse(txt); } catch (_) { last = 'not json'; continue; }
    const part = ((((j.candidates || [])[0] || {}).content || {}).parts || []).find((x) => x.inlineData || x.inline_data);
    if (!part) { last = 'no image: ' + ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join(' ').slice(0, 120); continue; }
    const inl = part.inlineData || part.inline_data;
    const bytes = b64decode(inl.data), outMime = str(inl.mimeType || inl.mime_type) || 'image/png';
    const fname = 'ai-' + scene + '-' + stamp(ctx) + (outMime === 'image/jpeg' ? '.jpg' : '.png');
    await saveFile(ctx, 'social', fname, bytes, outMime);
    const u = j.usageMetadata || {};
    await logWork(ctx, 'ai-photo', model, num(u.promptTokenCount), num(u.candidatesTokenCount), 5);
    return { asset: await keep(ctx, 'image', 'ai:' + scene, sku, name + ' · ' + scene, fname, { scene, model, width: 1024, height: 1024 }, 5) };
  }
  if (/429/.test(last) && !/200/.test(last)) throw new Error('The AI key has no picture quota: Google gives image generation only to keys with billing switched on (Platform → AI reader). Cards and reels still work.');
  throw new Error('The image model gave no picture. ' + last);
}

// ------------------------------------------------------------------ reels: the script, the voice, the cut
export async function erpSocialScript(ctx, payload) {
  need(ctx);
  const p = payload || {}, t = VIDEO_TEMPLATES.includes(str(p.template)) ? str(p.template) : 'spin';
  const lang = str(p.lang) === 'bn' ? 'bn' : str(p.lang) === 'mix' ? 'mix' : 'en';
  const shop = await shopName(ctx);
  let facts = ['Shop: ' + shop];
  let x = null;
  if (str(p.sku)) { x = await productWithPhoto(ctx, p.sku); facts.push('Product: ' + x.name, 'Price: BDT ' + Math.round(x.sell), x.stock > 0 ? 'In stock: ' + x.stock : 'Not in stock', x.brand ? 'Brand: ' + x.brand : '', x.cat ? 'Category: ' + x.cat : ''); }
  if (str(p.notes)) facts.push('Owner notes: ' + str(p.notes).slice(0, 500));
  const shape = t === 'reasons' ? '{"hookType": "", "hook": "", "reasons": ["", "", ""], "cta": "", "voice": ""}' : t === 'reveal' ? '{"hookType": "", "hook": "", "tease": "", "after": "", "cta": "", "voice": ""}' : t === 'showcase' ? '{"hookType": "", "hook": "", "caption": "", "cta": "", "voice": ""}' : '{"hookType": "", "hook": "", "lines": ["", "", ""], "cta": "", "voice": ""}';
  // not the hook used last time for this product
  let lastHook = '';
  if (str(p.sku)) { try { const r0 = (await ctx.tx`select coalesce(meta #>> '{script,hookType}', '') as h from social_assets where business_id = ${ctx.biz} and kind = 'video' and sku = ${str(p.sku)} order by created_at desc limit 1`)[0]; lastHook = str(r0 && r0.h); } catch (_) { /* fine */ } }
  const hooks = HOOKS.filter((h) => h[0] !== lastHook);
  const hookLine = 'Choose ONE hook type from this list and name it in hookType: ' + hooks.map((h) => h[0] + ' = ' + h[1]).join('; ') + '.';
  const extra = [await rulesText(ctx), await learnText(ctx), await styleText(ctx, p.style)].filter(Boolean).join('\n');
  const langLine = lang === 'bn' ? 'All text and the voice in Bangla written in BENGALI SCRIPT (never Bangla in Latin letters); only brand and product names stay in Latin letters.' : lang === 'mix' ? 'Text in Banglish (Bangla in Latin letters), product names as given; the voice in natural spoken Bangla (Bengali script).' : 'All in simple English.';
  const sys = 'You write 12-20 second vertical product reels for a small 3D-printing supplies shop in Bangladesh. Only the facts given; never invent prices, specs, discounts or deadlines. Each text line fits on a phone screen: at most 7 words. The hook is the first 2 seconds and decides everything: ' + hookLine + ' Never start with the product name or "welcome". The voice-over is 35-55 words, spoken naturally like a friend, says the price once, ends with how to order (inbox / website). ' + langLine + '\n' + extra + '\nAlso give "broll": 2-4 English words for a stock clip that fits the hook (e.g. "3d printer printing closeup"), or "" if none. Return JSON only: ' + shape.replace('{', '{"broll": "", ');
  await allowance(ctx, 1);
  let j = {};
  for (let attempt = 0; attempt < 2; attempt++) {
    const { parts } = await gemini(ctx, { systemInstruction: { parts: [{ text: sys + (attempt ? ' The previous answer used Latin letters for Bangla: write the Bangla in Bengali script this time.' : '') }] }, contents: [{ role: 'user', parts: [{ text: 'Template: ' + t + '\nFacts:\n' + facts.filter(Boolean).join('\n') }] }], generationConfig: { temperature: 0.8, responseMimeType: 'application/json' } }, 'reel-script', null);
    j = jsonOf(parts) || {};
    // Bangla asked: the voice-over must mostly be Bengali letters, else one more try
    if (lang !== 'bn') break;
    const v = str(j.voice), bengali = (v.match(/[\u0980-\u09FF]/g) || []).length, latin = (v.match(/[A-Za-z]/g) || []).length;
    if (bengali >= latin) break;
  }
  const script = { broll: str(j.broll).slice(0, 60), hookType: HOOKS.some((h) => h[0] === str(j.hookType)) ? str(j.hookType) : '', hook: str(j.hook).slice(0, 80), cta: str(j.cta).slice(0, 80), voice: str(j.voice).slice(0, 600), lines: (Array.isArray(j.lines) ? j.lines : Array.isArray(j.reasons) ? j.reasons : []).map((s) => str(s).slice(0, 80)).filter(Boolean).slice(0, 4), tease: str(j.tease).slice(0, 80), after: str(j.after).slice(0, 80), caption: str(j.caption).slice(0, 120) };
  return { script, template: t, lang, product: x ? { sku: x.sku, name: x.name, sell: x.sell } : null };
}

export async function erpSocialVideo(ctx, payload) {
  need(ctx);
  const p = payload || {}, t = VIDEO_TEMPLATES.includes(str(p.template)) ? str(p.template) : 'spin';
  if (!(ctx.deps.render && ctx.deps.render.url)) throw new Error('The render server is not set up on this system.');
  if (!(ctx.deps.storage && ctx.deps.storage.signUpload)) throw new Error('File uploads are not available on this server.');
  const [W, H] = FORMATS[str(p.format)] || FORMATS.story;
  const lang = str(p.lang) === 'bn' ? 'bn' : str(p.lang) === 'mix' ? 'mix' : 'en';
  const s = p.script || {};
  const script = { broll: str(s.broll).slice(0, 60), style: str(p.style).slice(0, 40), hookType: str(s.hookType).slice(0, 20), hook: str(s.hook).slice(0, 80), cta: str(s.cta).slice(0, 80), voice: str(s.voice).slice(0, 600), lines: (Array.isArray(s.lines) ? s.lines : []).map((x) => str(x).slice(0, 80)).filter(Boolean).slice(0, 4), tease: str(s.tease).slice(0, 80), after: str(s.after).slice(0, 80), caption: str(s.caption).slice(0, 120) };
  const x = str(p.sku) ? await productWithPhoto(ctx, p.sku) : { sku: '', name: str(p.title) || 'Post', sell: 0, stock: 0, photo: '' };
  const shop = await shopName(ctx);
  // the pictures: chosen ones first (uploaded, cards, AI photos), else the product's own
  const photos = [];
  for (const m of (Array.isArray(p.media) ? p.media : []).slice(0, 6)) { try { const d = await fileData(ctx, m.file || m); if (d) photos.push(d); } catch (_) { /* skip */ } }
  if (!photos.length && x.photo) photos.push(x.photo);
  const slides = [];
  const img = (i) => ({ ...x, photo: photos[i % Math.max(1, photos.length)] || '' });
  if (t === 'spin') {
    if (!photos.length) throw new Error('Pictures are needed: the product\'s photo, or choose some.');
    slides.push({ html: slideHtml('photo', W, H, lang, shop, img(0), { head: script.hook || x.name }), seconds: 3, motion: 'in' });
    photos.slice(1, 5).forEach((_, i) => slides.push({ html: slideHtml('photo', W, H, lang, shop, img(i + 1), { head: script.lines[i] || '' }), seconds: 2.5, motion: i % 2 ? 'left' : 'out' }));
    if (photos.length === 1) script.lines.slice(0, 3).forEach((ln, i) => slides.push({ html: slideHtml('photo', W, H, lang, shop, img(0), { head: ln }), seconds: 2.5, motion: i % 2 ? 'right' : 'out' }));
    slides.push({ html: slideHtml('price', W, H, lang, shop, x, { head: x.name, sub: x.stock > 0 ? (lang === 'bn' ? 'স্টকে আছে' : 'In stock') : '' }), seconds: 2.5, motion: 'in' });
    slides.push({ html: slideHtml('cta', W, H, lang, shop, img(0), { head: x.name, sub: script.cta }), seconds: 3, motion: 'none' });
  } else if (t === 'reveal') {
    slides.push({ html: slideHtml('photo', W, H, lang, shop, img(0), { head: script.hook || x.name }), seconds: 3, motion: 'in' });
    slides.push({ html: slideHtml('text', W, H, lang, shop, x, { head: script.tease || (lang === 'bn' ? 'দাম কত?' : 'Guess the price?') }), seconds: 2, motion: 'none' });
    slides.push({ html: slideHtml('price', W, H, lang, shop, x, { head: x.name, sub: script.after }), seconds: 3, motion: 'in' });
    slides.push({ html: slideHtml('cta', W, H, lang, shop, img(0), { head: x.name, sub: script.cta }), seconds: 3, motion: 'none' });
  } else if (t === 'reasons') {
    slides.push({ html: slideHtml('photo', W, H, lang, shop, img(0), { head: script.hook || x.name }), seconds: 3, motion: 'in' });
    slides.push({ html: slideHtml('list', W, H, lang, shop, x, { head: lang === 'bn' ? 'কেন এটি?' : 'Why this one?', items: script.lines.length ? script.lines : [x.name] }), seconds: 5, motion: 'none' });
    slides.push({ html: slideHtml('cta', W, H, lang, shop, img(0), { head: x.name, sub: script.cta }), seconds: 3, motion: 'none' });
  } else {
    // showcase: a real clip first, then the price and the call to order
    if (!str(p.clip)) throw new Error('Choose the clip (an MP4 uploaded under Content).');
    slides.push({ html: slideHtml('cta', W, H, lang, shop, img(0), { head: script.caption || x.name, sub: script.cta }), seconds: 3.5, motion: 'none' });
  }
  const job = { width: W, height: H, slides };
  // a stock clip under the hook (Pexels, the owner's key), or a clip of ours by link
  const pex = await getSecret(ctx, 'PEXELS_KEY');
  if (p.broll !== false && t !== 'showcase' && (str(p.brollFile) || (pex && str(script.broll)))) {
    const hookHtml = '<html><head>' + CSS(W, H) + '<style>body{background:transparent}</style></head><body><div class="big" style="top:30%;font-size:' + (H > W ? 76 : 60) + 'px">' + esc(script.hook || x.name) + '</div></body></html>';
    job.broll = str(p.brollFile) ? { url: await fileUrl(ctx, 'social', str(p.brollFile).replace(/^social\//, '')), seconds: 3, html: hookHtml } : { key: pex, query: script.broll, seconds: 3, html: hookHtml };
    if (slides.length && t !== 'reveal') slides[0].seconds = Math.max(1.5, slides[0].seconds - 1);
  }
  if (t === 'showcase') {
    const f = str(p.clip).replace(/^social\//, '');
    const url = await fileUrl(ctx, 'social', f);
    if (!url) throw new Error('That clip was not found.');
    job.clip = { url, seconds: Math.max(3, Math.min(30, num(p.clipSeconds) || 12)), mute: !!p.mute };
  }
  // the voice: spoken on the render server by Microsoft's neural voices (free), captions burned in from its word timings
  const voiceOn = p.voice !== false && !!script.voice;
  if (voiceOn) {
    const sex = str(p.voiceSex) === 'm' ? 'm' : 'f';
    job.voice = { text: script.voice, voice: str(p.voiceName) || (VOICES[lang === 'en' ? 'en' : 'bn'])[sex], rate: /^[+-]\d{1,2}%$/.test(str(p.rate)) ? str(p.rate) : '+0%', captions: p.captions !== false, offset: 0.4 };
  }
  // music under it, from an MP3 kept under Content (the owner's own licensed track)
  if (str(p.music)) {
    const mf = str(p.music).replace(/^social\//, '');
    const murl = await fileUrl(ctx, 'social', mf);
    if (murl) job.music = { url: murl, volume: num(p.musicVolume) || undefined };
  }
  const name = 'reel-' + t + '-' + stamp(ctx) + '.mp4';
  const up = await ctx.deps.storage.signUpload(ctx.biz, 'social', name);
  job.upload = { url: up.url, contentType: 'video/mp4' };
  const id = await startVideo(ctx.deps, job);
  const r = (await ctx.tx`insert into social_assets (business_id, kind, template, sku, title, file, status, job, meta, cost_bdt, created_by)
                          values (${ctx.biz}, 'video', ${t}, ${x.sku || null}, ${(x.name + ' · ' + t).slice(0, 120)}, ${'social/' + name}, 'rendering', ${id}, ${ctx.tx.json({ width: W, height: H, lang, script, voice: voiceOn, voiceName: job.voice ? job.voice.voice : '', captions: voiceOn && p.captions !== false, music: !!job.music, broll: !!job.broll, style: str(p.style), slides: slides.length })}, 0, ${ctx.s.name}) returning *`)[0];
  return { asset: view(r) };
}

export async function erpSocialAssetAct(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const a = (await ctx.tx`select * from social_assets where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
  if (!a) throw new Error('Not found.');
  if (str(p.action) === 'remove') { await ctx.tx`update social_assets set status = 'removed', updated_at = now() where id = ${a.id}`; return { ok: true }; }
  if (str(p.action) === 'retry' && a.status === 'rendering') { await ctx.tx`update social_assets set updated_at = now() where id = ${a.id}`; return { ok: true }; }
  throw new Error('Which action?');
}

/** The website's product pictures for products that have none here (the shop's own photos are usually only on the site). */
export async function erpSocialWebPhotos(ctx) {
  need(ctx, 'manager');
  const kind = await storeKind(ctx);
  if (kind !== 'woo' && kind !== 'shopify') throw new Error('Pictures come from a WooCommerce or Shopify website (Settings → Connections → Website).');
  const c = await storeConn(ctx);
  const items = await storeItems(ctx, c);
  const m = await storeMatcher(ctx);
  const have = new Set((await ctx.tx`select lower(sku) k from products where business_id = ${ctx.biz} and (coalesce(photo, '') <> '' or coalesce(image_link, '') <> '')`).map((r) => r.k));
  let set = 0, matched = 0, noPic = 0;
  const done = new Set();
  for (const it of items) {
    const hit = m.find(it.sku, it.name, it.barcode);
    if (!hit) continue;
    matched++;
    const k = str(hit.product.sku).toLowerCase();
    if (!it.image) { noPic++; continue; }
    if (have.has(k) || done.has(k)) continue;
    const r = await ctx.tx`update products set image_link = ${str(it.image).slice(0, 500)} where business_id = ${ctx.biz} and lower(sku) = ${k} and coalesce(photo, '') = '' and coalesce(image_link, '') = '' returning id`;
    if (r.length) { set++; done.add(k); }
  }
  delete ctx.memo.catalog; delete ctx.memo.dashProducts;
  return { ok: true, items: items.length, matched, set, noPic, already: have.size };
}

/** Owner: which image models this key can use (to fix IMAGE_MODELS when Google renames them). */
export async function erpSocialAiModels(ctx) {
  if (ctx.s.role !== 'owner') throw new Error('Owner only.');
  const key = (await aiKey(ctx)).key; if (!key) throw new Error('No AI key.');
  const res = await (ctx.deps.fetch || fetch)('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200&key=' + encodeURIComponent(key));
  const j = JSON.parse(await res.text());
  return { models: (j.models || []).filter((m) => /image|tts|imagen/i.test(m.name)).map((m) => ({ name: m.name.replace(/^models\//, ''), methods: m.supportedGenerationMethods })) };
}

/** Staff: shoot a short clip of this product (a Notifications task in the Inbox, and a note in the list). */
export async function erpSocialClipRequest(ctx, payload) {
  need(ctx, 'manager');
  const p = payload || {};
  const x = str(p.sku) ? await productWithPhoto(ctx, p.sku) : null;
  const text = 'Shoot a 10-second phone clip' + (x ? ' of ' + x.name : '') + (str(p.note) ? ': ' + str(p.note).slice(0, 200) : '') + '. Upload it under Campaigns → Advertisement → Content.';
  try { await task(ctx, null, 'alert', 'clip', text); } catch (_) { /* no inbox: the request still shows in the list */ }
  await setConfig(ctx, 'clip_request', JSON.stringify({ text, at: ctx.now.toISOString(), by: ctx.s.name }));
  return { ok: true, text };
}

/** The minute timer: a video whose job finished on the render server becomes ready (its file was uploaded by the server). */
export async function assetsTick(ctx) {
  const out = { ready: 0, failed: 0, studied: 0 };
  // the inspiration box: a study job that finished -> the AI writes the style card
  for (const r of await ctx.tx`select * from social_inspo where business_id = ${ctx.biz} and status = 'studying' and job is not null order by created_at limit 5`) {
    let j; try { j = await videoJob(ctx.deps, r.job); } catch (_) { continue; }
    if (j.state === 'done') {
      const { audio: gotAudio, ...fromServer } = j.meta || {};   // the server says whether there was sound; the file name stays ours
      const meta = { ...(r.meta || {}), ...fromServer, hasAudio: !!(gotAudio || fromServer.hasAudio) };
      const row = (await ctx.tx`update social_inspo set meta = ${ctx.tx.json(meta)}, updated_at = now() where id = ${r.id} returning *`)[0];
      if (await studyInspo(ctx, row)) out.studied++;
    } else if (j.state === 'failed' || j.state === 'lost' || new Date(r.created_at).getTime() < ctx.now.getTime() - 20 * 60e3) {
      await ctx.tx`update social_inspo set status = 'failed', error = ${j.error || 'The video took too long to fetch.'}, updated_at = now() where id = ${r.id}`;
    }
  }
  // the learning loop: once a day, after the figures were read
  try {
    const last = str(await getConfig(ctx, 'social_learn_at', ''));
    if (!last || new Date(last).getTime() < ctx.now.getTime() - 24 * 3600e3) { await learnTick(ctx); await setConfig(ctx, 'social_learn_at', ctx.now.toISOString()); }
  } catch (_) { /* next time */ }
  const rows = await ctx.tx`select * from social_assets where business_id = ${ctx.biz} and status = 'rendering' order by created_at limit 10`;
  for (const a of rows) {
    let j;
    try { j = await videoJob(ctx.deps, a.job); } catch (_) { continue; }
    if (j.state === 'done') {
      await ctx.tx`update social_assets set status = 'ready', meta = meta || ${ctx.tx.json({ seconds: j.seconds, bytes: j.bytes, voice: !!j.voice, captions: !!j.captions, music: !!j.music, brollUsed: !!(j.broll && !j.broll.error), warn: j.warn || '' })}, updated_at = now() where id = ${a.id}`; out.ready++;
    } else if (j.state === 'failed' || j.state === 'lost' || (new Date(a.created_at).getTime() < ctx.now.getTime() - 30 * 60e3)) {
      await ctx.tx`update social_assets set status = 'failed', error = ${j.error || 'The video took too long.'}, updated_at = now() where id = ${a.id}`; out.failed++;
    }
  }
  return out;
}

export const HANDLERS = { erpSocialAssets, erpSocialCard, erpSocialAiPhoto, erpSocialScript, erpSocialVideo, erpSocialAssetAct, erpSocialClipRequest, erpSocialWebPhotos, erpSocialAiModels, erpSocialRules, erpSocialPexels, erpSocialInspo, erpSocialLearn };
