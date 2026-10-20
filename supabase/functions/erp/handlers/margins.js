// The invoice's low-profit warning (owner 14 Oct 2026: "no restriction on discount; only warn when selling under 10 %
// profit" - a wholesaler sells at thin margins on purpose, so it never stops a sale).
//
//   erpLineMargins({ items: [{ sku, qty, discEach }], invoiceDiscount })
//     For each line: the price after its own discount and its share of the invoice discount, against the cost the
//     invoice will write on it - the oldest open stock lots first (FIFO, as the sale draws them), the product's cost
//     for what is not in a lot. { lines: [{ sku, low, margin?, unknown }], under: 10 }
//     margin (the %) only goes to people with the Product cost ability; everyone else learns only "low" (no cost).

import { num } from '../lib/time.js';
import { powerOn } from '../allow.js';
import { products } from './dashboard.js';

const UNDER = 10;   // the warning line, in %

export async function erpLineMargins(ctx, payload) {
  payload = payload || {};
  const items = (Array.isArray(payload.items) ? payload.items : []).slice(0, 60)
    .map((x) => ({ sku: String((x && x.sku) || '').trim(), qty: Math.max(0, num(x && x.qty)), disc: Math.max(0, num(x && x.discEach)) }))
    .filter((x) => x.sku && x.qty > 0);
  if (!items.length) return { lines: [], under: UNDER };
  const { bySku } = await products(ctx);
  const canCost = powerOn(ctx.s, 'costs');
  // joint stock lines (code ~Jxxxx): the pool's price for this company and the pool's cost
  let joint = {};
  if (items.some((x) => /~J[0-9a-f]{4}$/i.test(x.sku))) {
    try { const { jointPriceCost } = await import('./joint.js'); joint = await ctx.tx.savepoint(() => jointPriceCost(ctx)); } catch (_) { joint = {}; }
  }
  // the invoice discount shared over the lines by their value, as on the invoice
  const priced = items.map((x) => { const p = bySku[x.sku.toLowerCase()], J = joint[x.sku.toLowerCase()]; const unit = p ? num(p.sell) : J ? num(J.price) : 0; return { ...x, p, unit, gross: Math.max(0, x.qty * (unit - x.disc)) }; });
  const sum = priced.reduce((t, x) => t + x.gross, 0), invDisc = Math.min(Math.max(0, num(payload.invoiceDiscount)), sum);
  const out = [];
  for (const x of priced) {
    const J = joint[x.sku.toLowerCase()];
    if (!x.p && J) {   // a joint line: its revenue against the pool's cost
      const revenue = x.qty * (num(J.price) - x.disc) - (sum > 0 ? invDisc * x.gross / sum : 0), cost = x.qty * num(J.cost);
      if (!(num(J.cost) > 0) || !(revenue > 0)) { out.push({ sku: x.sku, low: false, unknown: !(num(J.cost) > 0), joint: true }); continue; }
      const margin = Math.round((revenue - cost) / revenue * 1000) / 10, line = { sku: x.sku, low: margin < UNDER, unknown: false, joint: true };
      if (canCost && ctx.s.role === 'owner') line.margin = margin;   // joint-fix-4: with the price it gives the pool's cost away
      out.push(line); continue;
    }
    if (!x.p) { out.push({ sku: x.sku, low: false, unknown: true }); continue; }
    const revenue = x.gross - (sum > 0 ? invDisc * x.gross / sum : 0);
    // FIFO: the oldest open lots of this product, as many units as the line takes
    const lots = await ctx.tx`select l.qty_left, l.unit_cost from stock_lots l join products p on p.id = l.product_id
                              where l.business_id = ${ctx.biz} and lower(btrim(p.sku)) = ${x.sku.toLowerCase()} and l.qty_left > 0
                              order by l.received_at, l.id`;
    let left = x.qty, cost = 0, known = true;
    for (const l of lots) {
      if (!(left > 0)) break;
      const take = Math.min(left, num(l.qty_left)), c = l.unit_cost === null ? num(x.p.cost) : num(l.unit_cost);
      if (!(c > 0)) known = false;
      cost += take * c; left -= take;
    }
    if (left > 0) { const c = num(x.p.cost); if (!(c > 0)) known = false; cost += left * c; }
    if (!known || !(revenue > 0)) { out.push({ sku: x.sku, low: false, unknown: !known }); continue; }
    const margin = Math.round((revenue - cost) / revenue * 1000) / 10;
    const line = { sku: x.sku, low: margin < UNDER, unknown: false };
    if (canCost) line.margin = margin;
    out.push(line);
  }
  return { lines: out, under: UNDER };
}

export const HANDLERS = { erpLineMargins };
