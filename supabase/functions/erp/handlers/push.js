// What to push next (Campaigns): which products to advertise, which to clear out with an offer, which are rising,
// and which not to advertise because they would sell out. Rules, not AI - the owner sees why each product is where
// it is. Owner-only for now (an "Only me" app, handlers/apps.js); the provider can open it to everyone later.
//
//   erpPushList()                the four lists, each row with the figures behind the call
//   erpPushRulesSave({...})      the owner's numbers: coverDays, slowDays, marginFloor, lowCover, keepMargin

import { num, formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { erpCatalog } from './catalog.js';
import { bookCostMap, bookKey } from './dashboard.js';

const str = (v) => String(v == null ? '' : v).trim();
const DEFAULTS = { coverDays: 30, slowDays: 60, marginFloor: 15, lowCover: 14, keepMargin: 10, minValue: 2000 };
async function rules(ctx) {
  let r = {};
  try { r = JSON.parse(str(await getConfig(ctx, 'push_rules', '')) || '{}'); } catch (_) { r = {}; }
  const out = { ...DEFAULTS };
  for (const k of Object.keys(DEFAULTS)) if (num(r[k]) > 0) out[k] = num(r[k]);
  return out;
}
export async function erpPushRulesSave(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only an owner changes the rules.');
  const p = payload || {}, out = {};
  for (const k of Object.keys(DEFAULTS)) { const v = num(p[k]); if (!(v >= 0)) throw new Error('Each rule is a number.'); out[k] = v || DEFAULTS[k]; }
  await setConfig(ctx, 'push_rules', JSON.stringify(out));
  return erpPushList(ctx);
}

/** Sold in the last 30 days and in the 30 before, per SKU, from the sales lines. */
async function soldByWindow(ctx) {
  const rows = await ctx.tx`
    select lower(btrim(l.sku)) as sku,
           sum(case when i.created_at >= now() - interval '30 days' then l.qty else 0 end) as last30,
           sum(case when i.created_at >= now() - interval '60 days' and i.created_at < now() - interval '30 days' then l.qty else 0 end) as prev30,
           max(i.created_at) as last_at
      from invoice_lines l join invoices i on i.id = l.invoice_id
     where i.business_id = ${ctx.biz} and l.qty > 0 and i.created_at >= now() - interval '400 days'
     group by 1`;
  const m = {};
  for (const r of rows) m[str(r.sku)] = { last30: num(r.last30), prev30: num(r.prev30), lastAt: r.last_at };
  return m;
}

export async function erpPushList(ctx) {
  const R = await rules(ctx);
  const cat = await erpCatalog(ctx);
  const book = await bookCostMap(ctx);
  const prods = await ctx.tx`select sku, category, brand, type, cost_price from products where business_id = ${ctx.biz}`;
  const costOf = {};
  for (const p of prods) {
    const k = bookKey(p.category, p.brand, p.type);
    costOf[str(p.sku).toLowerCase()] = num(book[k]) > 0 ? num(book[k]) : num(p.cost_price);
  }
  const sold = await soldByWindow(ctx);
  const now = ctx.now.getTime();
  const advertise = [], clear = [], rising = [], hold = [], all = [];
  for (const p of cat) {
    if (p.status && p.status !== 'Active') continue;
    if (num(p.stock) > 0) all.push({ sku: p.sku, name: p.name, cat: p.cat, sell: num(p.sell), stock: num(p.stock) });
    const sku = str(p.sku).toLowerCase(), cost = num(costOf[sku]), sell = num(p.sell), stock = num(p.stock);
    const s = sold[sku] || { last30: 0, prev30: 0, lastAt: null };
    const sold90 = num(p.sold90), rate = num(p.rate);                       // rate: units a day over 90 days (the catalogue's own)
    const cover = rate > 0 ? Math.round(stock / rate) : (stock > 0 ? 999 : 0);
    const margin = sell > 0 && cost > 0 ? Math.round((sell - cost) / sell * 100) : null;
    const lastDays = s.lastAt ? Math.floor((now - new Date(s.lastAt).getTime()) / 86400000) : (stock > 0 ? 999 : 0);
    const value = Math.round(stock * (cost || 0));
    const row = { sku: p.sku, name: p.name, stock, sold30: s.last30, prev30: s.prev30, sold90, cover, margin, cost, sell, value, lastDays };
    if (stock <= 0) continue;
    // clear out: nothing sold for long, real money on the shelf
    if (lastDays >= R.slowDays && value >= R.minValue) {
      const floor = cost > 0 ? Math.ceil(cost * (1 + R.keepMargin / 100)) : 0;
      const offer = floor > 0 && floor < sell ? floor : (sell > 0 ? Math.round(sell * 0.85) : 0);
      clear.push({ ...row, offer, offPct: sell > 0 && offer > 0 ? Math.round((1 - offer / sell) * 100) : 0, why: 'Not sold for ' + (lastDays >= 999 ? 'ever' : lastDays + ' days') + '; ৳' + value.toLocaleString('en-US') + ' on the shelf' });
      continue;
    }
    // rising: last 30 days clearly above the 30 before
    if (s.last30 >= 3 && s.last30 >= s.prev30 * 1.5 && s.last30 > s.prev30) rising.push({ ...row, why: s.last30 + ' sold in 30 days, ' + s.prev30 + ' in the 30 before' });
    // selling but about to run out: advertising would only disappoint
    if (sold90 > 0 && cover < R.lowCover) { hold.push({ ...row, why: 'Only ' + cover + ' day(s) of stock left — reorder first' }); continue; }
    // advertise: a seller with enough stock and a healthy margin
    if (sold90 > 0 && cover >= R.coverDays && (margin === null || margin >= R.marginFloor)) advertise.push({ ...row, why: sold90 + ' sold in 90 days, ' + (cover >= 999 ? 'plenty' : cover + ' days') + ' of stock' + (margin !== null ? ', ' + margin + '% margin' : '') });
  }
  advertise.sort((a, b) => b.sold90 - a.sold90);
  clear.sort((a, b) => b.value - a.value);
  rising.sort((a, b) => (b.sold30 - b.prev30) - (a.sold30 - a.prev30));
  hold.sort((a, b) => a.cover - b.cover);
  const slim = (l) => l.slice(0, 25);
  all.sort((a, b) => (a.cat + a.name).localeCompare(b.cat + b.name));
  return { rules: R, advertise: slim(advertise), clear: slim(clear), rising: slim(rising), hold: slim(hold), all,
           tied: clear.reduce((a, r) => a + r.value, 0), today: formatDate(ctx.now, 'yyyy-MM-dd') };
}
export const HANDLERS = { erpPushList, erpPushRulesSave };

// ---- Advertisement (Campaigns > Advertisement): a caption written by the AI for one product and one channel.
// Owner-only like the rest of this file; the page writes the plain template itself, this is the "Improve with AI" step.
import { aiKey, GEMINI_MODELS } from './receivefile.js';
const CHANNELS = {
  post: 'a Facebook page post (price in the caption, how to order by inbox or call, 3-6 lines, 2-4 hashtags at the end)',
  reel: 'a 15-30 second Facebook Reel / short video: a shot list of 4-6 scenes plus a 1-2 line caption',
  offer: 'a limited-stock clearance offer post: the offer price, the old price, how many are left, a clear deadline, 3-6 lines',
  bundle: 'a bundle offer post pairing this product with a best seller at a small saving, 3-6 lines',
  marketplace: 'a Facebook Marketplace listing: title (max 60 characters) and a 4-8 line description with specs and price',
  story: 'a 1-2 line Facebook Story caption with a sense of urgency',
  website: 'a website banner: headline (max 8 words), sub-line (max 15 words), button text',
};
export async function erpAdDraft(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only an owner writes advertisements.');
  const p = payload || {}, channel = CHANNELS[str(p.channel)] ? str(p.channel) : 'post';
  const key = (await aiKey(ctx)).key;
  if (!key) throw new Error('The AI writer is not set up on this server (no AI key).');
  const k = 'ai_chat:' + formatDate(ctx.now, 'yyyy-MM-dd'), used = num(await getConfig(ctx, k, '0'));
  if (used >= 300) throw new Error('Today’s AI allowance is used up for this business.');
  await setConfig(ctx, k, String(used + 1));
  const biz = (await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {};
  const facts = ['Shop: ' + str(biz.name), 'Product: ' + str(p.name), 'Price: BDT ' + num(p.sell)];
  if (num(p.offer) > 0) facts.push('Offer price: BDT ' + num(p.offer) + ' (' + num(p.offPct) + '% off)');
  if (num(p.stock) > 0) facts.push('In stock: ' + num(p.stock));
  if (str(p.why)) facts.push('Why we chose it: ' + str(p.why));
  if (str(p.notes)) facts.push('Owner notes: ' + str(p.notes).slice(0, 400));
  const lang = str(p.lang) === 'bn' ? 'Write in Bangla (Bengali script), product names and numbers as given.' : str(p.lang) === 'mix' ? 'Write in Banglish (Bangla in Latin letters) as Dhaka shops do, product names as given.' : 'Write in simple English.';
  const sys = 'You write short social-media copy for a small 3D-printing supplies shop in Bangladesh. Only use the facts given; never invent specs, prices, discounts or deadlines (say "this week" if none). No emojis except at most two. ' + lang + ' Output only the copy, no preamble.';
  const user = 'Write ' + CHANNELS[channel] + '.\nFacts:\n' + facts.join('\n');
  let last = '';
  for (const model of GEMINI_MODELS) {
    const ac = typeof AbortController === 'function' ? new AbortController() : null, timer = ac ? setTimeout(() => ac.abort(), 40000) : null;
    let res = null, txt = '';
    try {
      res = await ctx.deps.fetch('https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + encodeURIComponent(key),
        { method: 'POST', headers: { 'content-type': 'application/json' }, signal: ac ? ac.signal : undefined,
          body: JSON.stringify({ systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: user }] }], generationConfig: { temperature: 0.7 } }) });
      txt = await res.text();
    } catch (_) { last = 'timeout'; continue; } finally { if (timer) clearTimeout(timer); }
    if (!res.ok) { last = res.status + ' ' + txt.slice(0, 120); if ([404, 429, 503].includes(res.status)) continue; throw new Error('The AI writer could not answer (' + res.status + ').'); }
    let j; try { j = JSON.parse(txt); } catch (_) { throw new Error('The AI writer gave no answer.'); }
    const text = ((((j.candidates || [])[0] || {}).content || {}).parts || []).map((x) => x.text || '').join('').trim();
    if (!text) throw new Error('The AI writer gave no answer.');
    return { text, channel, model };
  }
  throw new Error(/429|503|timeout/.test(last) ? 'The AI writer is busy right now. Try again in a moment.' : 'The AI writer could not answer. ' + last);
}
HANDLERS.erpAdDraft = erpAdDraft;
