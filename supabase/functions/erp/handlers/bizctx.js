// reel-ctx-1 (owner 12 Nov 2026): "the ERP already has enough idea of the business, and the website shows what we work on."
// Until now the content writers (reel script, ad of the day, ad factory, What to push copy) were told they work for "a small
// 3D-printing supplies shop in Bangladesh" - wrong for any other business (Oliareen beauty, the personal brand ...).
// Now every writer gets THIS business: its Business Brain (brain.js, drafted from ERP data + website, confirmed by the
// owner), what the shop sells in numbers, and the product's own text read from the website (siteread.js -> product_ai).
//
//   bizText(ctx)              a short block about the business for a writer's system prompt
//   productText(ctx, sku)     the product's own description + facts (product_ai), '' if none
//   HOOK_FORMULAS             21 hook shapes, adapted from Jakeschincariol/youtube-agent-skill (MIT, skills/yt-script/hooks.json):
//                             only the shape and when it fails - never the YouTube examples, so nothing about channels leaks
//                             into a product reel.

import { brainText } from './brain.js';
import { getConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const MAX_BRAIN = 3000, MAX_PRODUCT = 900;

export const HOOK_FORMULAS = [
  ['statistic', 'a number the buyer did not know, stated flat, then what it means for them', 'the number must be true and from the facts'],
  ['someone-result', 'a real customer\'s outcome, then why it happened', 'needs a real, given result - never invent a customer'],
  ['mistake', 'name the mistake the buyer is probably making right now', 'only works if the mistake is common for this product'],
  ['contrarian', 'state the usual advice, then reject it', 'needs a reason from the facts'],
  ['reveal', 'promise to show one specific thing, then show it', 'the reel must actually show it'],
  ['superlative', 'the single best / cheapest / fastest of its kind', 'cheap if not true; only with a fact behind it'],
  ['clock', 'bound the payoff in time ("in 10 seconds you will know ...")', 'the time must be true'],
  ['tried-it', 'a first-person test with a stated cost or time', 'needs a real test'],
  ['question', 'the exact question the buyer types or asks the shop', 'must be the buyer\'s question, not the shop\'s'],
  ['before-after', 'two states, one cut between them', 'only when both states can be shown'],
  ['teardown', 'take a real thing apart: the label, the ingredients, the parts', 'name what is taken apart'],
  ['stack', 'two named things combined into one result', 'both must be real products of the shop'],
  ['warning', 'a cost the buyer is about to pay', 'if the cost is small the hook is a lie'],
  ['list', 'a counted set, the count in the first line', 'the count must be exact'],
  ['receipt', 'show the proof first (box, batch, document), explain second', 'needs a real proof picture'],
  ['insider', 'information from inside the trade', 'never claim access the shop does not have'],
  ['impossible', 'something that sounds untrue, then proved', 'must be proved in the reel'],
  ['comparison', 'two options, one winner', 'say the losing option out loud, no competitor brand names'],
  ['origin', 'where the product really comes from', 'only with true origin facts'],
  ['deadline', 'something changes on a date', 'only with a real date from the ERP'],
  ['direct-address', 'name the exact buyer in the first six words ("If you have oily skin ...")', 'the buyer must match the product'],
  ['price', 'the price itself as the hook', 'the price must be the ERP price'],
];
export const HOOK_KEYS = HOOK_FORMULAS.map((h) => h[0]);
export function hookList(skip) {
  return HOOK_FORMULAS.filter((h) => !(skip || []).includes(h[0])).map((h) => h[0] + ' = ' + h[1] + ' (fails when: ' + h[2] + ')').join('; ');
}

export async function bizText(ctx) {
  let b = '';
  try { b = await brainText(ctx); } catch (_) { b = ''; }
  b = str(b).replace(/\n{3,}/g, '\n\n');
  if (b.length > MAX_BRAIN) b = b.slice(0, MAX_BRAIN) + ' ...';
  const lines = [b || ('# This business: ' + str(ctx.s && ctx.s.businessName))];
  try {
    const g = await ctx.tx`select coalesce(nullif(category, ''), nullif(brand, ''), 'Other') as g, count(*)::int as n from products
                           where business_id = ${ctx.biz} group by 1 order by 2 desc limit 8`;
    if (g.length) lines.push('What it sells (product groups): ' + g.map((r) => r.g + ' (' + r.n + ')').join(', ') + '.');
  } catch (_) { /* no products table access */ }
  const site = str(await getConfig(ctx, 'store_url', '')) || str(await getConfig(ctx, 'website_api', '')).replace(/\/wp-json.*$/, '');
  if (site) lines.push('Website: ' + site);
  lines.push('Write for THIS business and its buyers only. Never assume another trade.');
  return lines.join('\n');
}

export async function productText(ctx, sku) {
  if (!str(sku)) return '';
  try {
    const r = (await ctx.tx`select description, facts from product_ai where business_id = ${ctx.biz} and lower(sku) = ${str(sku).toLowerCase()}`)[0];
    if (!r) return '';
    let f = '';
    try { const o = typeof r.facts === 'string' ? JSON.parse(r.facts) : r.facts; if (o && typeof o === 'object') f = Object.entries(o).slice(0, 12).map(([k, v]) => k + ': ' + str(typeof v === 'object' ? JSON.stringify(v) : v)).join('; '); } catch (_) { f = ''; }
    const t = (str(r.description) + (f ? '\nFacts: ' + f : '')).replace(/\s+\n/g, '\n');
    return t.length > MAX_PRODUCT ? t.slice(0, MAX_PRODUCT) + ' ...' : t;
  } catch (_) { return ''; }
}
