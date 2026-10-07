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
  const advertise = [], clear = [], rising = [], hold = [];
  for (const p of cat) {
    if (p.status && p.status !== 'Active') continue;
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
  return { rules: R, advertise: slim(advertise), clear: slim(clear), rising: slim(rising), hold: slim(hold),
           tied: clear.reduce((a, r) => a + r.value, 0), today: formatDate(ctx.now, 'yyyy-MM-dd') };
}
export const HANDLERS = { erpPushList, erpPushRulesSave };
