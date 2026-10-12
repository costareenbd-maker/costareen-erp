// fd-19 (FilaDash merge, owner 13 Oct 2026: "his design is the top priority"): the one figure his Orders screen
// shows per sale that our invoice list did not have - gross profit. One call, READ ONLY - it writes nothing and
// changes no formula:
//
//   erpFd19Profit({ ids: ['INV-...', ...] })      at most 100 invoice numbers (one page of the list)
//     rows[id] = { revenue, cost, profit, known, channel, lines? }
//       revenue  the invoice's goods after its discount, shared over the lines exactly as the dashboard and the
//                P&L do it (fddash.js lines(): discLeft, the line's share of what is left of the discount)
//       cost     each line's unit cost FIXED ON THE DAY IT WAS SOLD (plan A1, salesLog unit_cost); a line sold
//                before costs were kept falls back to the cost book (soldCost - the same rule as the dashboard)
//       profit   revenue - cost
//       known    every line had a cost; when false the page shows no profit (an unknown cost is never profit)
//       channel  where the customer came from, as the sale says (invoices.channel), '' when not set
//       lines    only when one invoice is asked for (the drawer): [{ sku, qty, revenue, unitCost }]
//     Delivery charges are not revenue. Returns are separate documents (RTN-...): the figure is the sale as sold,
//     before returns; the page shows no profit for an invoice that has returns or was cancelled.
//
// Cost and profit only for the people with the "costs" ability (as erpFdHead / erpFdInventory); others get
// { hidden: true, rows: {} } and the page leaves the column out.

import { salesLog, str, SL } from '../lib/tabs.js';
import { num } from '../lib/time.js';
import { powerOn } from '../allow.js';
import { discLeft } from './money.js';
import { products, soldCost } from './dashboard.js';

const R = (v) => Math.round(num(v));
export const MAX_IDS = 100;

export async function erpFd19Profit(ctx, payload) {
  payload = payload || {};
  if (!powerOn(ctx.s, 'costs')) return { hidden: true, rows: {} };
  const ids = Array.isArray(payload.ids) ? payload.ids.map((x) => str(x)).filter(Boolean) : [];
  if (ids.length > MAX_IDS) throw new Error('Ask for at most ' + MAX_IDS + ' invoices at a time.');
  const want = new Set(ids), rows = {};
  if (!want.size) return { hidden: false, rows };

  const { bySku } = await products(ctx);
  const chan = {};
  for (const r of await ctx.tx`select invoice_no, channel from invoices where business_id = ${ctx.biz} and invoice_no = any(${[...want]}) and channel is not null`) chan[str(r.invoice_no)] = str(r.channel);

  const inv = {};
  for (const r of await salesLog(ctx)) {
    const oid = str(r[SL.order_id]);
    if (!want.has(oid)) continue;
    const o = inv[oid] || (inv[oid] = { lines: [], sum: 0, gross: 0, discount: 0 });
    const sku = str(r[SL.sku]).toLowerCase(), p = bySku[sku];
    const ln = { sku, qty: num(r[SL.quantity]), total: num(r[SL.total]), unitCost: soldCost(r, p && p.cost) };
    o.lines.push(ln);
    if (ln.total > 0) { o.sum += ln.total; o.gross += ln.qty * num(r[SL.unit_price]); }
    o.discount = Math.max(o.discount, num(r[SL.discount]));
  }

  for (const id of Object.keys(inv)) {
    const I = inv[id], isReturn = /^RTN-/.test(id);
    const leftD = discLeft(I.discount, I.gross, I.sum);
    let revenue = 0, cost = 0, known = I.lines.length > 0;
    const lines = [];
    for (const L of I.lines) {
      let rev;
      if (L.total < 0 || isReturn) rev = L.total < 0 ? L.total : -L.total;
      else rev = Math.max(0, L.total - ((I.sum > 0 && leftD > 0) ? leftD * (L.total / I.sum) : 0));
      const q = isReturn && L.qty > 0 ? -L.qty : L.qty;
      revenue += rev; cost += L.unitCost * q;
      if (!(L.unitCost > 0) && L.qty) known = false;
      lines.push({ sku: L.sku, qty: L.qty, revenue: Math.round(rev * 100) / 100, unitCost: Math.round(L.unitCost * 100) / 100 });
    }
    rows[id] = { revenue: R(revenue), cost: known ? R(cost) : null, profit: known ? R(revenue) - R(cost) : null, known, channel: chan[id] || '' };
    if (want.size === 1) rows[id].lines = lines;
  }
  return { hidden: false, rows };
}

export const HANDLERS = { erpFd19Profit };
