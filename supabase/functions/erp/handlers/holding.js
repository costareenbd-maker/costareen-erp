// Holding cost (FilaDash merge P3, owner decision F3: ON by default).
//
// What it costs to keep stock - the warehouse or shop rent, and any other expense category the owner names - is
// shared out every month over the stock lots that sat on the shelf that month, by kg x days: a lot of 20 spools
// (1.3 kg each) on the shelf for the whole month carries 26 kg x 30 days of it. The month's net profit does not
// change (the rent is already an expense of that month); what changes is what each SHIPMENT made after the cost
// of holding its stock, and what an investor in a shipment earns (their share of that profit, after holding).
//
// A unit's weight is the product's chargeable weight (108: the larger of its weight and its box weight); a
// product with no weight counts as 1 kg a unit (listed as "no weight" so it can be fixed).

import { str } from '../lib/tabs.js';
import { num, formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';

const DAY = 86400000;
const R = (v) => Math.round(num(v));

export async function holdingConfig(ctx) {
  let c = null;
  try { c = JSON.parse(str(await getConfig(ctx, 'holding_cost', '')) || 'null'); } catch (_) { c = null; }
  const cats = Array.isArray(c && c.categories) ? c.categories.map(str).filter(Boolean) : ['Rent'];
  return { on: !(c && c.on === false), categories: cats, divisor: num(c && c.divisor) || 6000 };
}

/** Month 'yyyy-MM' -> [start, end) in ms, Dhaka days. The running month ends now. */
function monthSpan(m, nowMs) {
  const y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7));
  const start = Date.UTC(y, mo - 1, 1) - 6 * 3600e3, end = Date.UTC(y, mo, 1) - 6 * 3600e3;
  return [start, Math.min(end, nowMs)];
}

/** What the month's holding categories cost (expenses entered for that month, not struck out). */
async function pool(ctx, months, cats) {
  const out = {};
  if (!cats.length) return out;
  const low = cats.map((c) => c.toLowerCase());
  for (const r of await ctx.tx`select month, sum(amount) as a from expenses
                               where business_id = ${ctx.biz} and month = any(${months}) and coalesce(btrim(voided), '') = ''
                                 and lower(btrim(coalesce(category, ''))) = any(${low}) group by month`) out[str(r.month)] = num(r.a);
  return out;
}

/**
 * The holding cost of the given months, shared over the lots:
 *   { on, byMonth: { m: { pool, kgDays } }, byLot: { lotId: { m: amount } }, byRef: { reference: { m: amount } }, noWeight: [sku] }
 */
export async function holdingFor(ctx, months) {
  const key = 'holding:' + months.join(',');
  if (ctx.memo[key]) return ctx.memo[key];
  const cfg = await holdingConfig(ctx);
  const out = { on: cfg.on, categories: cfg.categories, byMonth: {}, byLot: {}, byRef: {}, noWeight: [] };
  if (!cfg.on || !months.length) return (ctx.memo[key] = out);
  const nowMs = ctx.now.getTime();
  const spans = months.map((m) => [m, ...monthSpan(m, nowMs)]).filter((s) => s[2] > s[1]);
  if (!spans.length) return (ctx.memo[key] = out);
  const lastEnd = Math.max(...spans.map((s) => s[2]));
  const lots = await ctx.tx`
    select l.id, l.reference, l.source, l.received_at, l.qty_in, p.sku,
           greatest(coalesce(p.weight_g, 0),
                    case when p.length_mm > 0 and p.width_mm > 0 and p.height_mm > 0 then p.length_mm * p.width_mm * p.height_mm / ${cfg.divisor} else 0 end) as g
    from stock_lots l join products p on p.id = l.product_id
    where l.business_id = ${ctx.biz} and l.qty_in > 0 and l.received_at < ${new Date(lastEnd)}`;
  if (!lots.length) return (ctx.memo[key] = out);
  const draws = {};
  for (const d of await ctx.tx`select lot_id, qty, at from lot_draws where business_id = ${ctx.biz} and lot_id is not null and at < ${new Date(lastEnd)} order by at`) {
    (draws[d.lot_id] = draws[d.lot_id] || []).push({ q: num(d.qty), t: new Date(d.at).getTime() });
  }
  const P = await pool(ctx, spans.map((s) => s[0]), cfg.categories);
  const noW = {};
  const kd = {};                                    // m -> lotId -> kg-days
  for (const l of lots) {
    const kg = num(l.g) > 0 ? num(l.g) / 1000 : 1;
    if (!(num(l.g) > 0)) noW[str(l.sku)] = 1;
    const t0 = new Date(l.received_at).getTime(), ds = draws[l.id] || [];
    for (const [m, a, b] of spans) {
      const from = Math.max(a, t0);
      if (from >= b) continue;
      let qty = num(l.qty_in), i = 0;
      while (i < ds.length && ds[i].t <= from) qty -= ds[i++].q;
      let at = from, sum = 0;
      while (i < ds.length && ds[i].t < b) { sum += Math.max(0, qty) * (ds[i].t - at); at = ds[i].t; qty -= ds[i++].q; }
      sum += Math.max(0, qty) * (b - at);
      const v = sum / DAY * kg;
      if (v > 0) (kd[m] = kd[m] || {})[l.id] = v;
    }
  }
  const refOf = {};
  lots.forEach((l) => { refOf[l.id] = l.source === 'opening' ? 'Stock before lots began' : str(l.reference); });
  for (const [m] of spans) {
    const per = kd[m] || {}, total = Object.values(per).reduce((t, v) => t + v, 0), cost = num(P[m]);
    out.byMonth[m] = { pool: R(cost), kgDays: Math.round(total) };
    if (!(total > 0) || !(cost > 0)) continue;
    for (const [id, v] of Object.entries(per)) {
      const amt = cost * v / total;
      (out.byLot[id] = out.byLot[id] || {})[m] = amt;
      const ref = refOf[id];
      (out.byRef[ref] = out.byRef[ref] || {})[m] = ((out.byRef[ref] || {})[m] || 0) + amt;
    }
  }
  out.noWeight = Object.keys(noW);
  return (ctx.memo[key] = out);
}

/** Months from the first lot to now (at most 36). */
export async function lotMonths(ctx) {
  const r = (await ctx.tx`select min(received_at) as a from stock_lots where business_id = ${ctx.biz} and qty_in > 0`)[0];
  const now = formatDate(ctx.now, 'yyyy-MM');
  if (!r || !r.a) return [now];
  const out = [];
  let m = formatDate(new Date(r.a), 'yyyy-MM');
  for (let g = 0; g < 36 && m <= now; g++) {
    out.push(m);
    let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + 1;
    if (mo > 12) { mo = 1; y++; }
    m = y + '-' + (mo < 10 ? '0' + mo : '' + mo);
  }
  return out;
}

/** The holding cost picture: the setting, each month's pool and how it was shared. */
export async function erpHolding(ctx) {
  const months = await lotMonths(ctx);
  const h = await holdingFor(ctx, months);
  const refs = Object.entries(h.byRef).map(([ref, ms]) => ({ reference: ref, amount: R(Object.values(ms).reduce((t, v) => t + v, 0)) }))
    .sort((a, b) => b.amount - a.amount);
  const cats = (await ctx.tx`select distinct btrim(category) as c from expenses where business_id = ${ctx.biz} and coalesce(btrim(category), '') <> '' order by 1`).map((r) => str(r.c));
  return { currency: 'BDT', on: h.on, categories: h.categories, allCategories: cats, noWeight: h.noWeight,
           months: months.map((m) => ({ month: m, pool: (h.byMonth[m] || {}).pool || 0, kgDays: (h.byMonth[m] || {}).kgDays || 0 })).reverse(),
           shipments: refs };
}

export async function erpHoldingSave(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder changes how holding cost is worked out.');
  payload = payload || {};
  const cats = (Array.isArray(payload.categories) ? payload.categories : []).map((c) => str(c).slice(0, 60)).filter(Boolean);
  const on = payload.on !== false;
  if (on && !cats.length) throw new Error('Choose at least one expense category that is the cost of holding stock (for example Rent).');
  await setConfig(ctx, 'holding_cost', JSON.stringify({ on, categories: cats }));
  Object.keys(ctx.memo).forEach((k) => { if (k.indexOf('holding:') === 0 || k === 'invReturns') delete ctx.memo[k]; });
  return erpHolding(ctx);
}

export const HANDLERS = { erpHolding, erpHoldingSave };
