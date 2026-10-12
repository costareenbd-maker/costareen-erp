// fd-22 (FilaDash merge): the figures his Analytics and System check screens show that ours did not have yet. Read only.
//
//   erpFd22Analytics  { months: 1 | 3 | 6 | 12 }
//     months   the last 13 calendar months (this one to date): the P&L's own revenue / cost / gross / expenses / net
//              (pnlFor - one net profit everywhere), plus orders, units, buying and new customers, month on month and
//              year on year revenue, the month's status (closed = inside the books' lock), and sales whose cost is unknown
//     range    new and returning customers in the chosen whole months and in the months before (his two KPI cards)
//     uncosted the newest sale lines that carry no cost (none on the day, none in the cost book today) - his "Cost unknown"
//     health   live signals for System check: last backup, unplaced payments, month close, stock without cost,
//              this month's lines without cost, the last thing anybody did
//
// A customer is their phone number (digits, last 10), or their name when the sale has no phone. Returns (RTN-) are
// never orders and never make a customer new.

import { salesLog, asDate, str, SL } from '../lib/tabs.js';
import { formatDate, num } from '../lib/time.js';
import { pnlFor, products, soldCost } from './dashboard.js';
import { lockedThrough } from '../lib/period.js';
import { powerOn } from '../allow.js';

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const R = (v) => Math.round(num(v));
const monthKey = (d) => formatDate(d, 'yyyy-MM');
function shift(m, n) { let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + n; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + (mo < 10 ? '0' : '') + mo; }
const label = (m) => MON3[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
const pct = (a, b) => (b ? Math.round((a - b) / Math.abs(b) * 1000) / 10 : null);

/** who bought: the phone's last 10 digits, else the name */
export function customerKey(contact, name) {
  const d = String(contact || '').replace(/[^0-9]/g, '');
  if (d.length >= 7) return 'p' + d.slice(-10);
  const n = String(name || '').trim().toLowerCase().replace(/\s+/g, ' ');
  return n && !/^(walk[- ]?in|cash|customer|n\/?a|-)$/.test(n) ? 'n' + n : '';
}

async function soft(ctx, fn, fallback) {
  try { return await (ctx.tx.savepoint ? ctx.tx.savepoint(() => fn()) : fn()); } catch (_) { return fallback; }
}

export async function erpFd22Analytics(ctx, payload) {
  if (!powerOn(ctx.s, 'profit')) throw new Error('Profitability is not open to you.');
  payload = payload || {};
  const n = [1, 3, 6, 12].includes(Number(payload.months)) ? Number(payload.months) : 1;
  const now = monthKey(ctx.now);
  const months = [];
  for (let i = 12; i >= 0; i--) months.push(shift(now, -i));
  const all = [];
  for (let i = 24; i >= 0; i--) all.push(shift(now, -i));
  const rangeM = [], prevM = [];
  for (let i = n - 1; i >= 0; i--) rangeM.push(shift(now, -i));
  for (let i = 2 * n - 1; i >= n; i--) prevM.push(shift(now, -i));

  // ---- the P&L of 25 months (13 shown + 12 more for year on year)
  const pnl = {};
  for (const x of await pnlFor(ctx, all)) pnl[x.month] = x;

  // ---- invoices: first purchase of every customer, and per month orders / units / customers
  const { bySku } = await products(ctx);
  const first = {}, per = {}, uncosted = [];
  for (const m of all) per[m] = { orders: new Set(), units: 0, buyers: new Set() };
  for (const r of await salesLog(ctx)) {
    const oid = str(r[SL.order_id]);
    if (!oid || /^RTN-/.test(oid)) continue;
    const d = asDate(r[SL.timestamp]);
    if (!d) continue;
    const m = monthKey(d), key = customerKey(r[SL.customer_contact], r[SL.customer_name]);
    if (key && (!first[key] || m < first[key])) first[key] = m;
    const total = num(r[SL.total]), qty = num(r[SL.quantity]);
    const P = per[m];
    if (P && total >= 0) {
      if (total > 0) P.orders.add(oid);
      P.units += qty;
      if (key) P.buyers.add(key);
    }
    if (months.includes(m) && total > 0) {
      const sku = str(r[SL.sku]).toLowerCase(), p = bySku[sku];
      if (!(soldCost(r, p && p.cost) > 0)) {
        uncosted.push({ invoice: oid, at: d.getTime(), date: formatDate(d, 'd MMM yyyy'), sku: str(r[SL.sku]).toUpperCase(),
                        name: str(r[SL.product_name]) || (p && p.name) || sku, qty, total: R(total), customer: str(r[SL.customer_name]) });
      }
    }
  }
  const newIn = (ms) => {
    const buyers = new Set();
    for (const m of ms) for (const k of per[m].buyers) buyers.add(k);
    let nw = 0, rt = 0;
    for (const k of buyers) { if (first[k] >= ms[0]) nw++; else rt++; }
    return { buyers: buyers.size, newC: nw, returning: rt };
  };

  const lock = await lockedThrough(ctx);
  const rows = months.map((m) => {
    const x = pnl[m] || {}, P = per[m], pm = shift(m, -1), py = shift(m, -12);
    const nc = newIn([m]);
    return {
      month: m, label: label(m), current: m === now, closed: !!lock && m <= lock,
      revenue: R(x.netSales), cost: R(x.cost), gross: R(x.gross), expenses: R(x.expenses), net: R(x.net),
      delivery: R(x.delivery), courier: R(x.courier), uncosted: R(x.uncosted),
      orders: P.orders.size, units: R(P.units), buyers: nc.buyers, newCustomers: nc.newC,
      mom: pnl[pm] && num(pnl[pm].netSales) ? pct(num(x.netSales), num(pnl[pm].netSales)) : null,
      yoy: pnl[py] && num(pnl[py].netSales) ? pct(num(x.netSales), num(pnl[py].netSales)) : null,
    };
  });
  const cur = newIn(rangeM), prev = newIn(prevM);

  // ---- health signals (each one on its own: a missing table never breaks the screen)
  const health = {};
  health.backup = await soft(ctx, async () => {
    const last = (await ctx.tx`select at from erp_backup_log where business_id = ${ctx.biz} and made > 0 order by at desc limit 1`)[0];
    const night = (await ctx.tx`select at from erp_backup_log where business_id = ${ctx.biz} and made > 0 and why = 'night' order by at desc limit 1`)[0];
    const at = last ? new Date(last.at) : null;
    return { at: at ? formatDate(at, 'd MMM, h:mm a') : '', ageHours: at ? Math.round((ctx.now.getTime() - at.getTime()) / 360000) / 10 : null,
             nightly: !!(night && ctx.now.getTime() - new Date(night.at).getTime() <= 36 * 3600e3) };
  }, null);
  health.unplaced = await soft(ctx, async () => {
    const acc = (await ctx.tx`select count(*)::int as n from money_accounts where business_id = ${ctx.biz}`)[0].n;
    if (!acc) return { n: 0, amount: 0, accounts: 0 };
    const u = (await ctx.tx`select count(*)::int as n, coalesce(sum(amount), 0) as a from payments
                            where business_id = ${ctx.biz} and account_id is null and coalesce(amount, 0) <> 0
                              and lower(btrim(coalesce(method, ''))) not in ('adjusted', 'returned', 'advance', 'undone', 'return / refund', '')`)[0];
    return { n: u.n, amount: R(u.a), accounts: acc };
  }, null);
  health.monthClose = { lockedThrough: lock || '', lockedLabel: lock ? label(lock) : '', open: lock ? shift(lock, 1) : '', openLabel: lock ? label(shift(lock, 1)) : '' };
  health.stockNoCost = (await products(ctx)).list.filter((p) => p.stock > 0 && !(p.cost > 0) && !/discontinued/i.test(p.status)).length;
  health.uncostedThisMonth = uncosted.filter((u) => monthKey(new Date(u.at)) === now).length;
  health.lastActivity = await soft(ctx, async () => {
    const a = (await ctx.tx`select who, at from erp_activity where business_id = ${ctx.biz} and action <> 'sign-in' order by at desc limit 1`)[0];
    return a ? { who: str(a.who), at: formatDate(new Date(a.at), 'd MMM, h:mm a') } : null;
  }, null);

  uncosted.sort((a, b) => b.at - a.at);
  return {
    currency: 'BDT', range: { months: n, from: rangeM[0], to: now, label: n === 1 ? label(now) + ' to date' : label(rangeM[0]) + ' – ' + label(now),
                              newCustomers: cur.newC, returning: cur.returning, buyers: cur.buyers,
                              prev: { newCustomers: prev.newC, returning: prev.returning, buyers: prev.buyers } },
    months: rows,
    uncosted: uncosted.slice(0, 200).map(({ at, ...u }) => u), uncostedCount: uncosted.length,
    uncostedValue: uncosted.reduce((t, u) => t + u.total, 0),
    health, at: formatDate(ctx.now, 'd MMM yyyy, h:mm a'),
  };
}

export const HANDLERS = { erpFd22Analytics };
