// shots-1 (owner 16 Nov 2026): "Realistic AI shots" on the reel screen (Advertisement > Content > + Video). "Only me" app
// `aishots`. The business's OWN AI (its ChatGPT gateway / key - never Claude: Claude is for the personal brand only) gets the
// video engine pack's rules + this business's profile + the product's facts, and must answer with a shot plan (JSON, engine
// pack shot_plan.schema.json). The plan is checked (schema, hard rules, every voice-over claim against the facts); a bad
// plan is sent back once with the problems, then refused. A good plan becomes a prompt pack: per shot the start still, the
// end still (state changes) and the video prompt, to paste into a generator. No generator is connected (lib/videogen.js).
//
//   erpVideoShots()                      the last plans, this business's profile, whether the full pack is loaded
//   erpVideoPlan({sku, platform, seconds, lang, notes})           make a plan (the AI), check it, keep it
//   erpVideoPackSet({rules, realism, physics, version})            platform admin: load the engine pack (not in git)
//
// Profiles never mix: oliareen = beauty, ordinary BD women; costareen = electronics / 3D printers, men (lib/shots.js).

import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { ai } from '../lib/ai.js';
import { openJSON, sealJSON } from '../lib/bridge.js';
import { products } from './dashboard.js';
import { productText, bizText } from './bizctx.js';
import { platformAdmin } from './platform.js';
import { appIsOff } from './apps.js';
import { FALLBACK, PROFILES, PROFILE_KEYS, PLATFORMS, profileText, validatePlan, factCheck, promptPack } from '../lib/shots.js';
import { generatorList } from '../lib/videogen.js';

const str = (v) => String(v == null ? '' : v).trim();
const ctl = (ctx) => (ctx.deps && ctx.deps.control) || ctx.sql;
const KEEP = 8, LENGTHS = [15, 20, 30, 45, 60];

async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Realistic AI shots are for the owner.');
  if (str(await getConfig(ctx, 'business_kind', '')) === 'brand') throw new Error('The personal brand plans its AI shots in its own studio (Brand desk), not here.');
  if (!(await platformAdmin(ctx)) && await appIsOff(ctx.deps, ctx.sql, 'aishots', ctx)) throw new Error('Realistic AI shots are not open on this ERP yet.');
}

/** The engine pack: the uploaded one (erp_provider_secrets VIDEO_PACK) or the short fallback in our own words. */
export async function loadPack(ctx) {
  ctx.memo = ctx.memo || {};
  if (ctx.memo.videoPack) return ctx.memo.videoPack;
  let pack = FALLBACK;
  try {
    const r = (await ctl(ctx)`select value_enc from erp_provider_secrets where key = 'VIDEO_PACK'`)[0];
    if (r) {
      const e = str(r.value_enc);
      const raw = e.startsWith('v1.') ? str((await openJSON(ctx.deps.bridgeKey, e)).v) : e.startsWith('v0.') ? e.slice(3) : '';
      const j = raw ? JSON.parse(raw) : null;
      if (j && str(j.rules)) pack = { version: str(j.version) || 'pack', rules: str(j.rules), realism: str(j.realism) || FALLBACK.realism, physics: str(j.physics) || FALLBACK.physics };
    }
  } catch (_) { pack = FALLBACK; }
  ctx.memo.videoPack = pack;
  return pack;
}

/** Which profile this business is: the owner's setting, else a guess from the name and what it sells. */
export async function profileOf(ctx, asked) {
  if (PROFILE_KEYS.includes(str(asked))) return str(asked);
  const set = str(await getConfig(ctx, 'video_profile', ''));
  if (PROFILE_KEYS.includes(set)) return set;
  let name = str(ctx.s && ctx.s.businessName);
  try { name = str(((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {}).name) || name; } catch (_) { /* fine */ }
  if (/oliareen|beauty|skin|cosmetic/i.test(name)) return 'oliareen';
  if (/costareen|3d|print|electro/i.test(name)) return 'costareen';
  try {
    const g = await ctx.tx`select coalesce(category, '') || ' ' || coalesce(name, '') as t from products where business_id = ${ctx.biz} limit 200`;
    const t = g.map((r) => r.t).join(' ');
    const beauty = (t.match(/serum|toner|cream|sunscreen|cleanser|skin|lotion|mask|essence|lip|beauty/gi) || []).length;
    const tech = (t.match(/filament|printer|pla|petg|nozzle|laser|resin|electronic|module|sensor/gi) || []).length;
    if (beauty > tech) return 'oliareen';
  } catch (_) { /* fine */ }
  return 'costareen';
}

async function plans(ctx) {
  try { const a = JSON.parse(str(await getConfig(ctx, 'video_plans', '')) || '[]'); return Array.isArray(a) ? a : []; } catch (_) { return []; }
}

export async function erpVideoShots(ctx) {
  await gate(ctx);
  const pack = await loadPack(ctx), profile = await profileOf(ctx);
  const list = await plans(ctx);
  return { profile, profiles: PROFILE_KEYS.map((k) => ({ key: k, name: PROFILES[k].name, trade: PROFILES[k].trade })), pack: pack.version, platforms: Object.keys(PLATFORMS), lengths: LENGTHS,
           generators: generatorList(), plans: list.map((p) => ({ ...p, prompts: promptPack(p.plan, pack) })) };
}

async function factsFor(ctx, sku, notes) {
  const f = [];
  let shop = '';
  try { shop = str(((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {}).name); } catch (_) { shop = ''; }
  if (shop) f.push('Shop: ' + shop);
  let x = null;
  if (str(sku)) {
    const { list } = await products(ctx);
    x = list.find((p) => p.sku.toLowerCase() === str(sku).toLowerCase());
    if (!x) throw new Error('No product with code ' + sku + '.');
    f.push('Product: ' + x.name, 'Price: BDT ' + Math.round(Number(x.sell) || 0), Number(x.stock) > 0 ? 'In stock' : 'Not in stock now');
    if (str(x.brand)) f.push('Brand: ' + x.brand);
    if (str(x.cat)) f.push('Category: ' + x.cat);
    const pt = await productText(ctx, x.sku);
    if (pt) f.push('About the product (from its own page): ' + pt);
  }
  if (str(notes)) f.push('Owner notes: ' + str(notes).slice(0, 600));
  return { text: f.join('\n'), product: x ? { sku: x.sku, name: x.name, sell: Math.round(Number(x.sell) || 0) } : null };
}

export async function erpVideoPlan(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (!str(p.sku) && !str(p.notes)) throw new Error('Choose the product (or write what the video is about).');
  const profile = await profileOf(ctx);   // never from the page: one business, one profile
  const platform = PLATFORMS[str(p.platform)] ? str(p.platform) : 'reels', aspect = PLATFORMS[platform];
  const seconds = LENGTHS.includes(Number(p.seconds)) ? Number(p.seconds) : 20;
  const lang = str(p.lang) === 'en' ? 'en' : 'bn';
  const pack = await loadPack(ctx);
  const facts = await factsFor(ctx, p.sku, p.notes);
  let biz = '';
  try { biz = await bizText(ctx); } catch (_) { biz = ''; }
  const sys = [pack.rules, '', profileText(profile), '', 'About this business (its own Business Brain):', biz,
    '', 'Answer with ONE JSON object only, exactly in this shape (shot_plan.schema.json): {"business": "' + profile + '", "platform": "' + platform + '", "aspect_ratio": "' + aspect + '", "goal": "", "facts_used": [""], "vo": [{"shot": 1, "text": ""}], "shots": [{"n": 1, "purpose": "hook|problem|product|proof|broll|cta", "seconds": 4, "model": "veo|seedance|kling|gemini_omni|avatar|stock", "start_frame": "", "end_frame": null, "camera": {"movement": "", "start": "", "speed": "", "framing": "", "end": "", "time": "real time, normal speed, no slow motion"}, "action": "", "physics": null, "light": "", "mood": "", "sound": "", "onscreen_text": null}]}',
    'facts_used: copy each fact you use word for word from the facts block. Every name, number, spec and claim in "vo" must be in facts_used.',
    'start_frame / end_frame: written in English for an image model. action / camera / physics / light / mood / sound: English. vo text: ' + (lang === 'bn' ? 'spoken Bangla in BENGALI SCRIPT (brand and product names in Latin letters as given).' : 'simple spoken English.'),
    'The whole video is about ' + seconds + ' seconds (the shots\' seconds add up to it), 4 to 8 shots, aspect ratio ' + aspect + '.',
    'Voice-over budget: at most ' + Math.floor(seconds * (lang === 'bn' ? 2.5 : 4.2)) + ' words in total (' + (lang === 'bn' ? '2.5 Bangla' : '4.2 English') + ' words a second); a shot of N seconds carries at most N x ' + (lang === 'bn' ? '2.5' : '4.2') + ' words. Count the words before answering.'].join('\n');
  const user = 'Platform: ' + platform + ' (' + aspect + ')\nLength: ' + seconds + ' s\nFacts:\n' + facts.text;
  const ask = async (extra) => ai(ctx, { purpose: 'video-plan', json: true, maxTokens: 4000, temperature: 0.6, avoid: ['anthropic'], system: sys + (extra ? '\n\n' + extra : ''), messages: [{ role: 'user', content: [{ type: 'text', text: user }] }] });
  let r = await ask(''), plan = r.json, errors = [], tries = 1;
  const judge = (pl) => { const e = validatePlan(pl, { profile, aspect }); if (!e.length) { const fc = factCheck(pl, facts.text); return fc.problems; } return e; };
  errors = judge(plan);
  if (errors.length) {
    tries = 2;
    r = await ask('Your last plan was refused for these reasons - fix every one and answer with the whole plan again:\n- ' + errors.join('\n- '));
    plan = r.json; errors = judge(plan);
  }
  if (errors.length) return { valid: false, errors, tries, profile, model: r.provider + ':' + r.model };
  const row = { id: 'vp' + Date.now().toString(36), at: (ctx.now || new Date()).toISOString(), profile, platform, seconds, lang, sku: facts.product ? facts.product.sku : '', product: facts.product ? facts.product.name : str(p.notes).slice(0, 60), model: r.provider + ':' + r.model, tries, plan };
  const list = [row].concat(await plans(ctx)).slice(0, KEEP);
  await setConfig(ctx, 'video_plans', JSON.stringify(list));
  return { valid: true, tries, profile, pack: pack.version, plan: { ...row, prompts: promptPack(plan, pack) } };
}

export async function erpVideoPackSet(ctx, payload) {
  if (!(await platformAdmin(ctx))) throw new Error('Only the platform admin loads the video engine pack.');
  const p = payload || {};
  if (str(p.rules).length < 200) throw new Error('The pack needs its rules (VIDEO_RULES.md).');
  const v = JSON.stringify({ version: str(p.version).slice(0, 40) || 'pack', rules: str(p.rules).slice(0, 20000), realism: str(p.realism).slice(0, 1500), physics: str(p.physics).slice(0, 600) });
  const enc = ctx.deps.bridgeKey ? await sealJSON(ctx.deps.bridgeKey, { v }) : 'v0.' + v;
  await ctl(ctx)`insert into erp_provider_secrets (key, value_enc, updated_at, updated_by) values ('VIDEO_PACK', ${enc}, now(), ${ctx.s.userId})
                 on conflict (key) do update set value_enc = excluded.value_enc, updated_at = now(), updated_by = excluded.updated_by`;
  ctx.memo = {};
  return { pack: (await loadPack(ctx)).version };
}

export const HANDLERS = { erpVideoShots, erpVideoPlan, erpVideoPackSet };
