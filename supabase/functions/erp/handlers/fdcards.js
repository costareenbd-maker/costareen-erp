// FilaDash dashboard: extra cards a person can add (owner 14 Oct 2026: "every figure the ERP already works out").
//
//   erpFdCards({ ids: [...], months })   the values of the cards asked for, each from the handler (formula) that
//                                         already gives it on its own screen. A card whose screen this person may not
//                                         open comes back { locked: true } - the figure never leaves the server.
//
// Every card: { v, money?, pct?, note?, go?, f?, tone? }. A card that fails comes back { error } and the others stand.

import { str } from '../lib/tabs.js';
import { num, formatDate } from '../lib/time.js';
import { callAllowed } from '../allow.js';

const R = (v) => Math.round(num(v));
function shift(m, n) { let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + n; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + (mo < 10 ? '0' : '') + mo; }

// id: [the call whose screen this figure belongs to, title, how it is worked out]
const CARDS = {
  cashInHand:     ['erpCashBook', 'Money in hand', async (ctx) => { const { erpCashBook } = await import('./cash.js'); const c = await erpCashBook(ctx, {});
                    return { v: R(c.inHand), money: true, go: 'cash', note: (c.accounts || []).filter((a) => !a.archived).length + ' account(s), courier and agent apart' }; }],
  supplierDue:    ['erpSuppliers', 'We owe suppliers', async (ctx) => { const { erpSuppliers } = await import('./suppliers.js'); const s = await erpSuppliers(ctx);
                    return { v: R(s.owedTotal), money: true, go: 'suppliers', tone: s.owedTotal > 0 ? 'warn' : '', note: (s.suppliers || []).filter((x) => x.owed > 0.5).length + ' supplier(s)' }; }],
  supplierAhead:  ['erpSuppliers', 'Paid ahead to suppliers', async (ctx) => { const { erpSuppliers } = await import('./suppliers.js'); const s = await erpSuppliers(ctx);
                    return { v: R(s.aheadTotal), money: true, go: 'suppliers' }; }],
  preordersOpen:  ['erpPreorders', 'Open pre-orders', async (ctx) => { const { erpPreorders } = await import('./preorders.js'); const p = await erpPreorders(ctx, {});
                    return { v: p.totals.open, go: 'preorders', note: p.totals.ready + ' ready to hand over' }; }],
  depositsHeld:   ['erpPreorders', 'Pre-order deposits held', async (ctx) => { const { erpPreorders } = await import('./preorders.js'); const p = await erpPreorders(ctx, {});
                    return { v: p.totals.held, money: true, go: 'preorders', note: 'the customers’ money until handed over' }; }],
  followupsDue:   ['erpFollowups', 'Follow-ups due', async (ctx) => { const { erpFollowups } = await import('./custextra.js'); const f = await erpFollowups(ctx, {});
                    return { v: f.totals.overdue + f.totals.today, go: 'customers', tone: f.totals.overdue ? 'warn' : '', note: f.totals.overdue + ' overdue · ' + f.totals.open + ' open' }; }],
  deadStock:      ['erpAnalytics', 'Dead stock (at cost)', async (ctx) => { const { erpAnalytics } = await import('./insight.js'); const a = await erpAnalytics(ctx);
                    return { v: R(a.deadValue), money: true, go: 'analytics', tone: a.deadValue > 0 ? 'warn' : '', note: (a.dead || []).length + ' lot(s) idle 90+ days' }; }],
  bestRoi:        ['erpAnalytics', 'Best shipment ROI', async (ctx) => { const { erpAnalytics } = await import('./insight.js'); const a = await erpAnalytics(ctx); const b = (a.roi || [])[0];
                    return { v: b ? b.roi : 0, pct: true, go: 'shipments', note: b ? b.reference : 'no shipment yet' }; }],
  commissionDue:  ['erpCommission', 'Commission this month', async (ctx) => { const { erpCommission } = await import('./commission.js'); const c = await erpCommission(ctx, {});
                    const left = (c.sellers || []).reduce((t, s) => t + Math.max(0, num(s.left)), 0);
                    return { v: R(c.total), money: true, go: 'commission', note: R(left).toLocaleString('en-IN') + ' still to pay' }; }],
  holdingMonth:   ['erpHolding', 'Holding cost this month', async (ctx) => { const { erpHolding } = await import('./holding.js'); const h = await erpHolding(ctx);
                    const m = (h.months || [])[0] || {}; return { v: R(m.pool), money: true, go: 'shipments', note: h.on ? 'shared over stock by kg × days' : 'holding cost is off' }; }],
  onTheWater:     ['erpShipments', 'Shipments on the shelf', async (ctx) => { const { erpShipments } = await import('./lots.js'); const s = await erpShipments(ctx);
                    return { v: R(s.totals.leftValue), money: true, go: 'shipments', note: s.totals.count + ' shipment(s) · landed ' + R(s.totals.landed).toLocaleString('en-IN') }; }],
  shipmentProfit: ['erpShipments', 'Shipments’ profit after holding', async (ctx) => { const { erpShipments } = await import('./lots.js'); const s = await erpShipments(ctx);
                    return { v: R(s.totals.net), money: true, go: 'shipments' }; }],
  investorReturns:['erpCapital', 'Investor returns owed', async (ctx) => { const { erpCapital } = await import('./capital.js'); const c = await erpCapital(ctx);
                    return { v: R(c.totals.returnDue), money: true, go: 'capital', tone: c.totals.returnDue > 0 ? 'warn' : '', note: R(c.totals.returnBuilding).toLocaleString('en-IN') + ' building this month' }; }],
  ownersCapital:  ['erpCapital', 'Owners’ capital', async (ctx) => { const { erpCapital } = await import('./capital.js'); const c = await erpCapital(ctx);
                    return { v: R(c.totals.ownersCapital), money: true, go: 'capital', note: 'what the shareholders put in' }; }],
  webPending:     ['erpWebOrders', 'Website orders waiting', async (ctx) => { const { erpWebOrders } = await import('./weborders.js'); const w = await erpWebOrders(ctx);
                    const n = (w || []).filter((o) => /pending|processing|on-hold/i.test(str(o.status)) && !o.invoiceNo && !o.invoice).length;
                    return { v: n, go: 'weborders', tone: n ? 'warn' : '' }; }],
  returnsMonth:   ['erpPnl', 'Goods returned', async (ctx, M) => { const p = await pnl(ctx, M); return { v: R(p.returns), money: true, go: 'profit', flip: true }; }],
  deliveryIncome: ['erpPnl', 'Delivery charged', async (ctx, M) => { const p = await pnl(ctx, M); return { v: R(p.delivery), money: true, go: 'profit' }; }],
  courierFees:    ['erpPnl', 'Courier and COD fees', async (ctx, M) => { const p = await pnl(ctx, M); return { v: R(p.courier), money: true, go: 'profit', flip: true }; }],
  repairsIncome:  ['erpPnl', 'Repairs income (after parts)', async (ctx, M) => { const p = await pnl(ctx, M); return { v: R(num(p.serviceIncome) - num(p.serviceParts)), money: true, go: 'repairs' }; }],
  netMargin:      ['erpPnl', 'Net margin', async (ctx, M) => { const p = await pnl(ctx, M); return { v: p.netSales ? Math.round(p.net / p.netSales * 1000) / 10 : 0, pct: true, go: 'profit' }; }],
  newCustomers:   ['erpFd22Analytics', 'New customers', async (ctx, M) => { const { erpFd22Analytics } = await import('./fd22.js'); const a = await erpFd22Analytics(ctx, { months: M.n });
                    const c = a.range || {}; return { v: num(c.newCustomers), go: 'customers', note: num(c.returning) + ' returning · ' + num(c.buyers) + ' buyers' }; }],
};
async function pnl(ctx, M) {
  if (ctx.memo.fdcPnl) return ctx.memo.fdcPnl;
  const { pnlFor } = await import('./dashboard.js');
  const rows = await pnlFor(ctx, M.months);
  const t = {};
  for (const x of rows) for (const k of Object.keys(x)) if (typeof x[k] === 'number') t[k] = (t[k] || 0) + x[k];
  return (ctx.memo.fdcPnl = t);
}

/** The list a person can pick from (titles only; no figures). */
export function fdCardList(s) {
  return Object.keys(CARDS).map((id) => ({ id, title: CARDS[id][1], locked: !callAllowed(s, CARDS[id][0]) }));
}

export async function erpFdCards(ctx, payload) {
  ctx.memo.__ro = true;   // read-only: figures worked out once in this call (pnlFor, erpShipments)
  payload = payload || {};
  const n = [1, 3, 6, 12].includes(Number(payload.months)) ? Number(payload.months) : 1;
  const now = formatDate(ctx.now, 'yyyy-MM'), months = [];
  for (let i = n - 1; i >= 0; i--) months.push(shift(now, -i));
  const M = { n, months };
  const want = Array.isArray(payload.ids) ? payload.ids.map(String).filter((id) => CARDS[id]).slice(0, 40) : [];
  const cards = {};
  for (const id of want) {
    const [call, title, run] = CARDS[id];
    if (!callAllowed(ctx.s, call)) { cards[id] = { title, locked: true }; continue; }
    try { cards[id] = Object.assign({ title }, await ctx.tx.savepoint(() => run(ctx, M))); }
    catch (e) { cards[id] = { title, error: String((e && e.message) || e).slice(0, 160) }; }
  }
  return { cards, list: fdCardList(ctx.s), months: n };
}

export const HANDLERS = { erpFdCards };
