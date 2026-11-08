// adsrc-3 (8 Nov 2026): profit per ad - the autopilot's "which ad really brings money".
// An ad here is what Meta put on the first message of a chat (161: inbox_conversations.ad, see inboxch.js adOf).
//
//   erpAdProfit({days})   manager; per ad: chats, leads, orders, delivered, returned/cancelled, sales and gross profit of
//                         the DELIVERED orders (sale price - cost fixed at the sale), the spend the ERP knows
//                         (ad_campaigns.spend for that ad id), and profit after the ad.
//
// Not counted (said on the screen): courier charges and the cost of returns, spend of ads made outside the ERP.

import { roleAtLeast } from '../allow.js';
import { num } from '../lib/time.js';
import { salesLog, SL } from '../lib/tabs.js';
import { products, soldCost } from './dashboard.js';

const str = (v) => String(v == null ? '' : v).trim();

export async function erpAdProfit(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).');
  const days = Math.max(7, Math.min(365, num((payload || {}).days) || 90));
  const since = new Date(ctx.now.getTime() - days * 864e5);
  const keyOf = (ad) => str(ad && (ad.id || ad.title)) || 'unknown';
  const by = {};
  const row = (ad) => {
    const k = keyOf(ad);
    if (!by[k]) by[k] = { key: k, id: str(ad && ad.id), title: str(ad && ad.title), chats: 0, leads: 0, orders: 0, delivered: 0, lost: 0, open: 0, sales: 0, cost: 0, spend: 0, costKnown: true, clid: 0, courier: 0, deliveryIn: 0 };
    if (!by[k].title && ad && ad.title) by[k].title = str(ad.title);
    return by[k];
  };
  for (const c of await ctx.tx`select ad from inbox_conversations where business_id = ${ctx.biz} and ad is not null and created_at >= ${since}`) {
    const r = row(c.ad); r.chats++; if (str(c.ad.clid)) r.clid++;
  }
  for (const l of await ctx.tx`select ad from inbox_leads where business_id = ${ctx.biz} and ad is not null and created_at >= ${since}`) row(l.ad).leads++;
  const orders = await ctx.tx`select o.no, o.status, o.invoice_no, c.ad, i.delivery_status, i.cancelled_at from chat_orders o
    join inbox_conversations c on c.id = o.conversation_id
    left join invoices i on i.business_id = o.business_id and i.invoice_no = o.invoice_no
    where o.business_id = ${ctx.biz} and c.ad is not null and o.created_at >= ${since}`;
  const deliveredInv = {}, anyInv = {};
  for (const o of orders) {
    const r = row(o.ad), ds = str(o.delivery_status).toLowerCase();
    r.orders++;
    if (o.invoice_no) anyInv[str(o.invoice_no)] = r;
    if (o.status === 'cancelled' || o.cancelled_at || /return|cancel|refus/.test(ds)) r.lost++;
    else if (o.invoice_no && /deliver/.test(ds)) { r.delivered++; deliveredInv[str(o.invoice_no)] = r; }
    else r.open++;
  }
  // adsrc-4: what the courier really charged (Steadfast payout lines: delivery + COD charge, returned parcels too), and the
  // delivery charge the customer paid on a delivered invoice - so profit is after the courier
  const invNos = Object.keys(anyInv);
  if (invNos.length) {
    try {
      for (const c of await ctx.tx`select invoice_no, coalesce(sum(coalesce(delivery_charge, 0) + coalesce(cod_charge, 0)), 0)::float fee from courier_payout_lines
                                   where business_id = ${ctx.biz} and invoice_no = any(${invNos}) group by invoice_no`) anyInv[str(c.invoice_no)].courier += num(c.fee);
    } catch (_) { /* no payout lines table */ }
    const dIn = Object.keys(deliveredInv);
    if (dIn.length) for (const i of await ctx.tx`select invoice_no, coalesce(delivery_charge, 0)::float dc from invoices where business_id = ${ctx.biz} and invoice_no = any(${dIn})`) deliveredInv[str(i.invoice_no)].deliveryIn += num(i.dc);
  }
  if (Object.keys(deliveredInv).length) {
    const { bySku } = await products(ctx);
    for (const s of await salesLog(ctx)) {
      const r = deliveredInv[str(s[SL.order_id])];
      if (!r) continue;
      const sku = str(s[SL.sku]).toLowerCase(), qty = num(s[SL.quantity]);
      const c = soldCost(s, bySku[sku] && bySku[sku].cost);
      r.sales += num(s[SL.total]) - num(s[SL.discount]);
      if (c > 0) r.cost += c * qty; else if (qty) r.costKnown = false;
    }
  }
  const ids = Object.values(by).map((r) => r.id).filter(Boolean);
  if (ids.length) {
    for (const a of await ctx.tx`select ad_id, coalesce(sum(spend), 0)::float spend from ad_campaigns where business_id = ${ctx.biz} and ad_id = any(${ids}) group by ad_id`) {
      const r = Object.values(by).find((x) => x.id === str(a.ad_id)); if (r) r.spend += num(a.spend);
    }
  }
  const rows = Object.values(by).map((r) => {
    const gross = Math.round(r.sales - r.cost), sales = Math.round(r.sales), spend = Math.round(r.spend);
    const courier = Math.round(r.courier - r.deliveryIn);   // what the courier cost us after the customer's delivery charge
    return { id: r.id, title: r.title || (r.id ? 'Ad ' + r.id : 'An ad'), chats: r.chats, leads: r.leads, orders: r.orders, delivered: r.delivered, lost: r.lost, open: r.open,
             sales, gross, courier, spend, profit: gross - courier - spend, costKnown: r.costKnown, perOrder: r.delivered && spend ? Math.round(spend / r.delivered) : null,
             metaCanBeTold: r.clid > 0 };
  }).sort((a, b) => b.profit - a.profit || b.orders - a.orders);
  const t = rows.reduce((s, r) => ({ chats: s.chats + r.chats, orders: s.orders + r.orders, delivered: s.delivered + r.delivered, sales: s.sales + r.sales, gross: s.gross + r.gross, courier: s.courier + r.courier, spend: s.spend + r.spend }),
    { chats: 0, orders: 0, delivered: 0, sales: 0, gross: 0, courier: 0, spend: 0 });
  return { days, rows, total: { ...t, profit: t.gross - t.courier - t.spend },
           note: 'Profit = delivered sales - cost of the goods - courier (Steadfast charges, returned parcels too, less the delivery charge customers paid) - ad spend the ERP knows. Ads made outside the ERP are not in it; courier charges show once Steadfast pays out.' };
}

export const HANDLERS = { erpAdProfit };
