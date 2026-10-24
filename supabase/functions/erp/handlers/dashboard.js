// Group 'dashboard': Dashboard, Profitability, Product cost (spec 01).
// Ported from ERP.js:187-627 (erpDashboardData), 2550 (erpDaySales),
// 2839-3168 (price book), 5582 (erpMoney), 6716 (erpMonthGross_),
// 7093-7110 (expense totals), 8306-8405 (erpPnl), 8682/8894 (courier by
// month), 8841 (erpOwedMap_), 11070 (erpSfNeeds_).
//
// Deliberate changes are listed in docs/fixes/dashboard.md:
//   - one cost rule everywhere: PRODUCT cost_price first, then the price book
//   - one price-book key everywhere: blank category/brand/type read as
//     'Uncategorised' / '-' / '-', the way the book's own rows are written
//   - below shareholder the dashboard is BUILT without profit, cost, cover
//     and cash, instead of being trimmed afterwards
//   - the price book is a table; landed and margin are computed, not stored

import { salesLog, paymentsTab, asDate, str, SL, PAY } from '../lib/tabs.js';
import { formatDate, num, round2, dhakaDayStart, DAY_MS, looseDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast, powerOn } from '../allow.js';
import { erpDues, creditMap, paidByOrder, discLeft, lock } from './money.js';
import { ratesMap, landedCost, saveRate } from './currency.js';
import { returnsFor } from './returns.js';
import { serviceFor } from './repairs.js';
import { poolExpenses } from '../lib/pool.js';
import { commissionDue } from './commission.js';

// ------------------------------------------------------------------ months

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function monthKey(d) { return formatDate(d, 'yyyy-MM'); }

/** erpMonthLabel_: "Oct '26" */
function monthLabel(key) {
  const p = key.split('-');
  return MON3[Number(p[1]) - 1] + " '" + p[0].slice(2);
}

/** erpShiftMonth_ / erpMonthShift_: yyyy-MM n months away. */
function shiftMonth(key, n) {
  let y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) + n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}

/** Run a part the original wrapped in try/catch, so its failure cannot abort the call. */
async function soft(ctx, fn, fallback) {
  try { return await ctx.tx.savepoint(() => fn()); } catch (_) { return fallback; }
}

// ------------------------------------------------------- the cost of a sale
/**
 * What one unit of a sold line cost (plan A1). It is the cost written on the
 * line the day it was sold, so a later shipment at another price cannot
 * rewrite a month that is over. Only where nothing was known that day does
 * today's cost stand in - filling in a missing cost completes the past, it
 * does not change it.
 */

// stock at cost the FIFO way (lots.js lotStock); before lots or if lots cannot be read: stock x the product's cost
async function atLots(ctx) {
  try { const { lotStock } = await import('./lots.js'); return await ctx.tx.savepoint(() => lotStock(ctx)); } catch (_) { return null; }
}
function lotValue(LS, p, stock) {
  const x = LS && LS.bySku[String(p.sku).toLowerCase()];
  if (x && num(x.units) > 0) return num(x.value) * Math.min(1, stock / num(x.units));
  return stock * (p.cost > 0 ? p.cost : 0);
}

export function soldCost(row, today) {
  const then = num(row[SL.unit_cost]);
  return then > 0 ? then : (num(today) || 0);
}

// --------------------------------------------------------------- price book

/**
 * The one price-book key (fix 3): a blank category is 'Uncategorised' and a
 * blank brand or type is '-', exactly as erpCostSync_ writes the book's rows
 * (ERP.js:3028-3030). The original looked products up with raw blanks, so a
 * product with no brand or type never found its row.
 */
export function bookKey(cat, brand, type) {
  return [str(cat) || 'Uncategorised', str(brand) || '-', str(type) || '-'].join('\u0001').toLowerCase();
}

/** erpCostCell_: blank stays blank (null), anything else is a number. */
function costCell(v) {
  return (v === '' || v === null || v === undefined) ? null : num(v);
}

/** COST_PRICES O2:O4 */
async function costConfig(ctx) {
  const rates = await ratesMap(ctx);
  return {
    rates,
    rate: num(rates.RMB) || num(await getConfig(ctx, 'cost_rate', '')),
    handling: num(await getConfig(ctx, 'cost_handling', '')),
    minMargin: num(await getConfig(ctx, 'cost_min_margin', '')),
  };
}

/** Column G: landed = rmb x rate + handling, else bdt + handling, else blank (null). */
function landedOf(r, cfg) {
  return landedCost(r, cfg.rates || { RMB: cfg.rate, BDT: 1 }, cfg.handling);        // plan A5: any currency
}

/** Column J: margin on the selling price, 1 dp, or blank (null). */
function marginOf(landed, sell) {
  if (!num(landed) || !num(sell)) return null;
  return Math.round((sell - landed) / sell * 100 * 10) / 10;
}

async function bookRows(ctx) {
  return ctx.tx`
    select id, sort_order, category, brand, type, buy_rmb, buy_bdt, buy_amount, buy_cur, handling,
           products, typical_sell, updated_at, note
    from cost_book where business_id = ${ctx.biz}
    order by sort_order, id`;
}

/** erpBookCostMap_: price-book key -> landed, for rows with landed > 0. */
export async function bookCostMap(ctx) {
  if (ctx.memo.bookCost) return ctx.memo.bookCost;
  const cfg = await costConfig(ctx);
  const map = {};
  for (const r of await bookRows(ctx)) {
    const k = bookKey(r.category, r.brand, r.type);
    const landed = landedOf(r, cfg);
    if (landed > 0 && !(k in map)) map[k] = landed;
  }
  ctx.memo.bookCost = map;
  return map;
}

/**
 * PRODUCT_MASTER with each product's cost and stock (STOCK_VIEW).
 * Cost (fix 2): the product's own cost_price first - the weighted average of
 * what was really paid, kept up to date by receiving - then the price book.
 */
export async function products(ctx) {
  if (ctx.memo.dashProducts) return ctx.memo.dashProducts;
  const book = await bookCostMap(ctx);
  const rows = await ctx.tx`
    select p.sku, p.name, p.category, p.brand, p.type, p.cost_price, p.sell_price,
           p.reorder_level, p.status, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${ctx.biz}
    order by p.created_at, p.sku`;
  const list = [], bySku = {};
  for (const r of rows) {
    const sku = str(r.sku);
    if (!sku) continue;
    const k = bookKey(r.category, r.brand, r.type);
    const p = {
      sku, name: str(r.name), cat: str(r.category), brand: str(r.brand), type: str(r.type),
      cost: num(r.cost_price) || (Object.prototype.hasOwnProperty.call(book, k) ? book[k] : 0),
      sell: num(r.sell_price),
      stock: num(r.stock),
      reorder: num(r.reorder_level) || 5,          // STOCK_VIEW: blank/0 reads as the default 5
      status: str(r.status),
    };
    list.push(p);
    bySku[sku.toLowerCase()] = p;
  }
  ctx.memo.dashProducts = { list, bySku };
  return ctx.memo.dashProducts;
}

// ---------------------------------------------------------------- expenses

async function expRows(ctx, month) {
  return ctx.tx`
    select expense_no, month, kind, coalesce(nullif(btrim(category), ''), 'Miscellaneous') as category,
           amount, coalesce(item_no, '') as item_no, coalesce(btrim(voided), '') as voided
    from expenses where business_id = ${ctx.biz} and month = ${month}
      -- plan A6: an investor's return is a cost of the month it fell due in, not of the day it was paid
      and not (category = 'Investor returns' and description like 'Return paid to %')
      -- 110: commission is a cost of the month it was earned in; paying it later is not a second cost
      and not (category = 'Commission' and description like 'Commission paid to %')`;
}

/** erpExpenseTotal_: everything entered for the month and not struck out. */
export async function expenseTotal(ctx, month) {
  let total = 0;
  for (const r of await expRows(ctx, month)) if (!r.voided) total += num(r.amount);
  total += await returnsFor(ctx, month);
  total += await commissionDue(ctx, month);
  for (const e of await poolExpenses(ctx, month)) total += e.amount;
  return Math.round(total);
}

/** erpExpenseUnpaid_: fixed items of the month not yet marked paid. */
export async function expenseUnpaid(ctx, month) {
  if (month > monthKey(ctx.now)) return 0;
  const paid = {};
  for (const r of await expRows(ctx, month)) {
    if (r.kind === 'fixed' && str(r.item_no) && !r.voided) paid[str(r.item_no)] = true;
  }
  const items = await ctx.tx`
    select item_no, kind, amount, from_month, to_month from expense_items
    where business_id = ${ctx.biz}`;
  let sum = 0;
  for (const it of items) {
    const id = str(it.item_no);
    if (!id) continue;
    const kind = str(it.kind) || 'fixed';
    const from = str(it.from_month), to = str(it.to_month);
    if (from && month < from) continue;
    if (to && month > to) continue;
    if (kind === 'fixed' && !paid[id]) sum += num(it.amount);
  }
  return Math.round(sum);
}

/** erpExpByCat_: the month's expenses by category. */
export async function expByCat(ctx, month) {
  const by = {};
  let total = 0;
  for (const r of await expRows(ctx, month)) {
    if (r.voided) continue;
    by[r.category] = (by[r.category] || 0) + num(r.amount);
    total += num(r.amount);
  }
  for (const e of await poolExpenses(ctx, month)) { by[e.category] = (by[e.category] || 0) + e.amount; total += e.amount; }
  const due = await returnsFor(ctx, month);
  if (due) { by['Investor returns'] = (by['Investor returns'] || 0) + due; total += due; }
  const com = await commissionDue(ctx, month);
  if (com) { by['Commission'] = (by['Commission'] || 0) + com; total += com; }
  for (const c of Object.keys(by)) by[c] = Math.round(by[c]);
  return { total, byCat: by };
}

/**
 * erpMonthGross_ (ERP.js:6716): what a month sold, net of invoice discounts,
 * and what those goods cost. Shared with the Expenses screen.
 */
export async function monthGross(ctx, month) {
  const { bySku } = await products(ctx);
  const rows = await salesLog(ctx);
  const lines = [], inv = {};
  for (const r of rows) {
    const oid = str(r[SL.order_id]);
    if (!oid) continue;
    const d = asDate(r[SL.timestamp]);
    if (!d || monthKey(d) !== month) continue;
    const ln = { id: oid, sku: str(r[SL.sku]).toLowerCase(), qty: num(r[SL.quantity]),
                 total: num(r[SL.total]), discount: num(r[SL.discount]) };
    ln.cost = soldCost(r, bySku[ln.sku] && bySku[ln.sku].cost);
    lines.push(ln);
    const o = inv[oid] || (inv[oid] = { lines: 0, discount: 0, gross: 0 });
    if (ln.qty > 0 && ln.total >= 0) o.gross += ln.qty * num(r[SL.unit_price]);   // fix-2 H6
    o.lines += ln.total;
    o.discount = Math.max(o.discount, ln.discount);
  }
  let revenue = 0, cogs = 0;
  for (const L of lines) {
    const I = inv[L.id];
    const leftI = discLeft(I.discount, I.gross, I.lines);
    const share = (I.lines > 0 && leftI > 0) ? leftI * (L.total / I.lines) : 0;
    revenue += L.total < 0 ? L.total : Math.max(0, L.total - share);
    cogs += L.cost * L.qty;
  }
  // 111: a late shipment bill's part for units already sold is cost of the month it was entered in (as pnlFor)
  cogs += await soft(ctx, async () => num((await ctx.tx`select coalesce(sum(sold_part), 0) as s from late_costs where business_id = ${ctx.biz} and month = ${month}`)[0].s), 0);
  return { revenue: Math.round(revenue), cost: Math.round(cogs), gross: Math.round(revenue - cogs) };
}

// ----------------------------------------------------------------- courier

/**
 * What each invoice still owes, counted exactly as the dues list (erpDues): the lines of one old sheet order
 * (ORD-<time>, one row per product line, each carrying the order's whole total) are ONE order. Use this for any
 * total or count of dues; owedMap below (the sheet's erpOwedMap_) is per row and only right for one-invoice
 * look-ups (courier matching). 15 Oct 2026: owedMap summed made the Customers card show 66.17L instead of 4.37L.
 */
export async function duesMap(ctx) {
  const d = await erpDues(ctx), out = {};
  for (const i of (d && d.invoices) || []) out[i.id] = i.due;
  return out;
}

/** erpOwedMap_ (ERP.js:8841): what every invoice still owes. */
export async function owedMap(ctx) {
  const g = {}, s = {}, st = {};
  for (const r of await salesLog(ctx)) {
    const id = str(r[SL.order_id]);
    if (!id) continue;
    g[id] = Math.max(g[id] || 0, num(r[SL.grand_total]));
    s[id] = Math.max(s[id] || 0, num(r[SL.advance_paid]));
    if (str(r[SL.payment_status]).toLowerCase() === 'paid') st[id] = true;
  }
  const paid = await paidByOrder(ctx), out = {};
  for (const k of Object.keys(g)) {
    out[k] = st[k] ? 0 : Math.max(0, Math.round((g[k] - Math.max(paid[k] || 0, s[k] || 0)) * 100) / 100);
  }
  return out;
}

/** erpSfNeeds_ (ERP.js:11070): what about courier money needs a person. */
async function sfNeeds(ctx) {
  const out = { review: 0, pending: 0, error: '', back: 0 };
  try {
    const dn = JSON.parse(String(await getConfig(ctx, 'sf_deliv', '')) || 'null');
    if (dn) out.back = num(dn.back) + num(dn.part);
  } catch (_) { /* as original */ }
  try {
    const recon = await ctx.tx`select consignment_id, action from courier_recon where business_id = ${ctx.biz}`;
    const done = {};
    for (const r of recon) {
      if (String(r.action) === 'review') out.review++;
      done[String(r.consignment_id)] = true;
    }
    const lines = await ctx.tx`
      select consignment_id, status, invoice_no, match from courier_payout_lines
      where business_id = ${ctx.biz}`;
    const phone = lines.filter((l) => String(l.match) === 'phone' && /deliver/i.test(String(l.status || '')) &&
                                      String(l.invoice_no || ''));
    if (phone.length) {
      const owed = await owedMap(ctx);
      for (const l of phone) if (!done[String(l.consignment_id)] && (owed[String(l.invoice_no)] || 0) > 0.5) out.pending++;
    }
    // erpSfNightInfo_: the nightly round's note (business_config 'sf_night', JSON)
    const raw = await getConfig(ctx, 'sf_night', '');
    if (raw) {
      let n = null;
      try { n = JSON.parse(raw); } catch (_) { n = null; }
      if (n && n.at && n.error) out.error = String(n.error);
    }
  } catch (_) { /* as original */ }
  return out;
}

/**
 * erpCourierBalance_: Steadfast's own figure. courier.js owns the call (and
 * its cache); while it is not there, or it fails, this is null - the page then
 * shows our own 30-day figure with "courier did not answer".
 */
async function courierBalance(ctx) {
  try {
    const mod = await import('./courier.js');
    if (typeof mod.sfBalance !== 'function') return null;
    const v = await ctx.tx.savepoint(() => mod.sfBalance(ctx));
    return v === null || v === undefined ? null : Math.round(num(v));
  } catch (_) {
    return null;
  }
}

// --------------------------------------------------------------- dashboard

/** erpDashboardData (ERP.js:187-627). */
export async function erpDashboardData(ctx) {
  const full = powerOn(ctx.s, 'dash');
  const now = ctx.now, nowMs = now.getTime();
  const thisKey = monthKey(now);
  const todayKey = formatDate(now, 'yyyy-MM-dd');
  const yesterKey = formatDate(new Date(nowMs - DAY_MS), 'yyyy-MM-dd');
  const prevKey = shiftMonth(thisKey, -1);

  // ---- PRODUCT_MASTER
  const { list: plist, bySku: prod } = await products(ctx);
  let productCount = 0, costMissing = 0;
  for (const p of plist) {
    productCount++;
    if (!p.cost) costMissing++;
  }
  const pcat = (p) => p.cat || 'Uncategorised';

  // ---- SALES_LOG
  const sl = await salesLog(ctx);
  const mon = {}, topMTD = {};
  let badDates = 0, zeroValued = 0, salesLines = 0;
  const tdy = { units: 0, revenue: 0, lines: 0, orders: {}, cogs: 0 };
  const yst = { units: 0, revenue: 0, lines: 0, orders: {}, cogs: 0 };
  const lines = [];
  let cogsMTD = 0, revenueUncosted = 0, cogs90 = 0;
  const ninetyAgo = nowMs - 90 * DAY_MS;
  const dayMap = {}, thirtyAgo = nowMs - 31 * DAY_MS;

  for (const row of sl) {
    const oid = str(row[SL.order_id]);
    if (!oid) continue;
    const dt = asDate(row[SL.timestamp]);
    if (!dt) { badDates++; continue; }
    salesLines++;
    const qty = num(row[SL.quantity]);
    const total = num(row[SL.total]);
    if (!total) zeroValued++;
    const isRtn = /^RTN-/.test(oid);

    const pinfo = prod[str(row[SL.sku]).toLowerCase()];
    const unitThen = soldCost(row, pinfo && pinfo.cost);
    const lineCost = unitThen > 0 ? unitThen * qty : 0;
    const costed = unitThen > 0;

    const dayKey = formatDate(dt, 'yyyy-MM-dd');
    if (dayKey === todayKey) {
      tdy.units += qty; tdy.revenue += total; tdy.lines++; if (!isRtn) tdy.orders[oid] = 1;
      tdy.cogs += lineCost;
    } else if (dayKey === yesterKey) {
      yst.units += qty; yst.revenue += total; yst.lines++; if (!isRtn) yst.orders[oid] = 1;
      yst.cogs += lineCost;
    }
    if (dt.getTime() >= ninetyAgo) cogs90 += lineCost;
    if (dt.getTime() >= thirtyAgo) {
      const dm = dayMap[dayKey] || (dayMap[dayKey] = { revenue: 0, units: 0, orders: {} });
      dm.revenue += total; dm.units += qty;
      if (!isRtn) dm.orders[oid] = 1;
    }
    const key = monthKey(dt);
    if (!mon[key]) mon[key] = { revenue: 0, units: 0, orders: {} };
    mon[key].revenue += total;
    mon[key].units += qty;
    if (!isRtn) mon[key].orders[oid] = 1;

    if (key === thisKey) {
      cogsMTD += lineCost;
      if (!costed) revenueUncosted += total;
      const skuKey = str(row[SL.sku]).toLowerCase();
      const nm = str(row[SL.product_name]) || (prod[skuKey] ? prod[skuKey].name : skuKey);
      if (!topMTD[skuKey]) topMTD[skuKey] = { name: nm, sku: str(row[SL.sku]), units: 0, revenue: 0 };
      topMTD[skuKey].units += qty;
      topMTD[skuKey].revenue += total;
    }
    lines.push({ id: oid, ts: dt.getTime(), date: formatDate(dt, 'd MMM'),
                 customer: str(row[SL.customer_name]), product: str(row[SL.product_name]),
                 total, status: str(row[SL.delivery_status]) });
  }

  // recent orders
  const agg = {}, aggOrder = [];
  for (const ln of lines) {
    if (!agg[ln.id]) {
      agg[ln.id] = { id: ln.id, ts: ln.ts, date: ln.date, customer: ln.customer,
                     product: ln.product, lines: 0, total: 0, status: ln.status };
      aggOrder.push(ln.id);
    }
    agg[ln.id].lines++;
    agg[ln.id].total += ln.total;
    if (ln.ts > agg[ln.id].ts) agg[ln.id].ts = ln.ts;
  }
  let recentOrders = aggOrder.map((k) => agg[k]);
  recentOrders.sort((a, b) => b.ts - a.ts);
  recentOrders = recentOrders.slice(0, 8);
  for (const ro of recentOrders) { ro.total = Math.round(ro.total); delete ro.ts; }

  // months (continuous, last 14)
  const keys = Object.keys(mon).sort();
  let months = [];
  if (keys.length) {
    let cur = keys[0], guard = 0;
    while (cur <= thisKey && guard++ < 120) {
      const mb = mon[cur] || { revenue: 0, units: 0, orders: {} };
      months.push({ key: cur, label: monthLabel(cur), revenue: Math.round(mb.revenue),
                    units: Math.round(mb.units), orders: Object.keys(mb.orders).length });
      cur = shiftMonth(cur, 1);
    }
  }
  if (months.length > 14) months = months.slice(months.length - 14);

  // years, Jan..Dec
  const years = {}, yearSeen = {};
  yearSeen[thisKey.slice(0, 4)] = 1;
  for (const k of keys) yearSeen[k.slice(0, 4)] = 1;
  for (const yy of Object.keys(yearSeen).sort()) {
    const list = [];
    for (let mi = 1; mi <= 12; mi++) {
      const k12 = yy + '-' + (mi < 10 ? '0' : '') + mi, b12 = mon[k12];
      list.push({ key: k12, label: MON3[mi - 1],
                  revenue: b12 ? Math.round(b12.revenue) : 0,
                  units: b12 ? Math.round(b12.units) : 0,
                  orders: b12 ? Object.keys(b12.orders).length : 0 });
    }
    years[yy] = list;
  }

  // thirty days ending today
  const days = [];
  for (let di = 29; di >= 0; di--) {
    const dd = new Date(nowMs - di * DAY_MS);
    const dk = formatDate(dd, 'yyyy-MM-dd'), db = dayMap[dk];
    days.push({ date: dk, label: formatDate(dd, 'd MMM'),
                revenue: db ? Math.round(db.revenue) : 0,
                units: db ? Math.round(db.units) : 0,
                orders: db ? Object.keys(db.orders).length : 0 });
  }

  let revenueFrom = null;
  for (const m of months) { if (m.revenue > 0) { revenueFrom = m.key; break; } }

  const cm = mon[thisKey] || { revenue: 0, units: 0, orders: {} };
  const pv = mon[prevKey] || { revenue: 0, units: 0, orders: {} };
  const ordersMTD = Object.keys(cm.orders).length;

  // ---- STOCK_VIEW
  let inStock = 0, reorder = 0, outOfStock = 0, stockValue = 0, stockUnits = 0, stockCost = 0;
  const byCat = {}, catOrder = [], low = [];
  const LSd = await atLots(ctx);   // stock at cost = what is left in each lot x its landed cost (FIFO), as everywhere else
  for (const p of plist) {
    const stock = p.stock, rl = p.reorder;
    const value = stock * p.sell;
    if (stock <= 0) outOfStock++;
    else if (rl && stock <= rl) reorder++;
    else inStock++;
    stockValue += value;
    stockUnits += stock;
    const cat = pcat(p);
    if (!byCat[cat]) { byCat[cat] = { cat, value: 0, units: 0, skus: 0, cost: 0, uncosted: 0 }; catOrder.push(cat); }
    byCat[cat].value += value;
    byCat[cat].units += stock;
    byCat[cat].skus++;
    if (stock > 0) {
      const lv = lotValue(LSd, p, stock);
      if (lv > 0) { byCat[cat].cost += lv; stockCost += lv; } else byCat[cat].uncosted++;
    }
    if (stock <= rl) {
      low.push({ sku: p.sku, name: p.name, cat, stock, reorder: rl,
                 deficit: Math.max(0, rl - stock), out: stock <= 0 });
    }
  }
  low.sort((a, b) => (a.out !== b.out ? (a.out ? -1 : 1) : b.deficit - a.deficit));
  const stockByCat = catOrder.map((k) => byCat[k]);
  stockByCat.sort((a, b) => (b.cost - a.cost) || (b.value - a.value) || (b.units - a.units));
  for (const sc of stockByCat) {
    sc.value = Math.round(sc.value);
    sc.cost = Math.round(sc.cost);
    if (!full) { delete sc.cost; delete sc.uncosted; }
  }

  // ---- CUSTOMERS
  const cu = await ctx.tx`select created_at from customers where business_id = ${ctx.biz}`;
  let customers = 0, newThisMonth = 0;
  for (const c of cu) {
    customers++;
    const added = asDate(c.created_at);
    if (added && monthKey(added) === thisKey) newThisMonth++;
  }

  // ---- WEB_ORDERS (one sheet row per order line; entered_in_sheet = 'no')
  const wo = await ctx.tx`
    select o.order_no, l.line_total
    from web_order_lines l join web_orders o on o.id = l.web_order_id
    where o.business_id = ${ctx.biz} and not o.entered`;
  let webPending = 0, webPendingValue = 0;
  const webOrderIds = {};
  for (const w of wo) {
    webPending++;
    webPendingValue += num(w.line_total);
    webOrderIds[str(w.order_no)] = 1;
  }

  // ---- top products this month
  let top = Object.keys(topMTD).map((k) => topMTD[k]);
  top.sort((a, b) => b.units - a.units);
  top = top.slice(0, 10);
  for (const t of top) t.revenue = Math.round(t.revenue);

  const out = {
    generatedAt: formatDate(now, 'EEE d MMM yyyy, h:mm a'),
    monthLabel: monthLabel(thisKey),
    prevLabel: monthLabel(prevKey),
    currency: 'BDT',
    alerts: {
      webPending,
      webPendingValue: Math.round(webPendingValue),
      webOrders: Object.keys(webOrderIds).length,
      outOfStock,
      reorder,
      queueOpen: 0,                      // MANAGER_QUEUE has no table; never shown (spec 1.1b)
      courier: await sfNeeds(ctx),
    },
    kpi: {
      revenueMTD: Math.round(cm.revenue),
      revenuePrev: Math.round(pv.revenue),
      unitsMTD: Math.round(cm.units),
      unitsPrev: Math.round(pv.units),
      ordersMTD,
      ordersPrev: Object.keys(pv.orders).length,
      aov: ordersMTD ? Math.round(cm.revenue / ordersMTD) : 0,
      stockValue: Math.round(stockValue),
      stockUnits: Math.round(stockUnits),
      customers,
      newCustomers: newThisMonth,
      todayUnits: Math.round(tdy.units),
      todayOrders: Object.keys(tdy.orders).length,
      todayRevenue: Math.round(tdy.revenue),
      todayLines: tdy.lines,
      yestUnits: Math.round(yst.units),
      yestOrders: Object.keys(yst.orders).length,
      yestRevenue: Math.round(yst.revenue),
    },
    months,
    years,
    thisMonth: thisKey,
    days,
    revenueFrom,
    stock: { inStock, reorder, outOfStock },
    stockByCat,
    topProducts: top,
    lowStock: low.slice(0, 20),
    lowStockTotal: low.length,
    recentOrders,
    quality: { productCount, costMissing: full ? costMissing : 0, salesLines, zeroValued, badDates },
  };

  // Fix 1: below shareholder the money blocks are never built at all.
  if (!full) {
    out.hideProfit = true;
    return out;
  }

  const monthG = await soft(ctx, () => monthGross(ctx, thisKey),
    { revenue: Math.round(cm.revenue), cost: Math.round(cogsMTD), gross: Math.round(cm.revenue - cogsMTD) });

  out.profit = {
    todayRevenue: Math.round(tdy.revenue),
    todayCost: Math.round(tdy.cogs),
    todayGross: Math.round(tdy.revenue - tdy.cogs),
    todayMargin: tdy.revenue > 0 ? Math.round(((tdy.revenue - tdy.cogs) / tdy.revenue) * 1000) / 10 : 0,
    monthRevenue: monthG.revenue,
    monthCost: monthG.cost,
    monthGross: monthG.gross,
    monthMargin: monthG.revenue > 0 ? Math.round((monthG.gross / monthG.revenue) * 1000) / 10 : 0,
    uncosted: Math.round(revenueUncosted),
    monthExpenses: await soft(ctx, () => expenseTotal(ctx, thisKey), null),
    // plan A2: the month's net as the Profitability screen has it (courier and delivery included)
    monthNet: await soft(ctx, async () => (await monthNet(ctx, thisKey)).net, null),
    monthOther: await soft(ctx, async () => { const m = await monthNet(ctx, thisKey); return m.delivery + m.courierExtra - m.courierShort - m.courier; }, 0),
    monthUnpaid: await soft(ctx, () => expenseUnpaid(ctx, thisKey), 0),
  };

  const perDay = cogs90 / 90;
  out.cover = {
    stockAtCost: Math.round(stockCost),
    dailyCost: Math.round(perDay),
    days: perDay > 0 ? Math.round(stockCost / perDay) : null,
    leadDays: 60,
    reorderNow: reorder,
    outOfStock,
  };

  let owed = 0, credit = 0, courier = 0;
  owed = await soft(ctx, async () => (await erpDues(ctx)).total, 0);
  credit = await soft(ctx, async () => {
    const m = await creditMap(ctx);
    let c = 0;
    for (const k of Object.keys(m)) if (m[k] > 0) c += m[k];
    return c;
  }, 0);
  courier = await soft(ctx, async () => {
    const cutoff = nowMs - 30 * DAY_MS;
    let c = 0;
    for (const r of await paymentsTab(ctx)) {
      if (String(r[PAY.method] || '').indexOf('COD (Steadfast)') < 0) continue;
      const pd = asDate(r[PAY.timestamp]);
      if (pd && pd.getTime() >= cutoff) c += num(r[PAY.amount]);
    }
    return c;
  }, 0);
  out.cash = {
    owedByCustomers: Math.round(owed),
    withCourier: Math.round(courier),
    advancesHeld: Math.round(credit),
    courierBalance: await courierBalance(ctx),
  };
  return out;
}

/** erpDaySales (ERP.js:2550): everything sold on one Dhaka day. */
export async function erpDaySales(ctx, dateStr) {
  const want = str(dateStr);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(want)) throw new Error('Pick a date first.');
  let units = 0, revenue = 0, lines = 0, cogs = 0;
  const orders = {}, byProduct = {}, byOrder = [], invoices = {}, byInv = [];
  // profit only for those who may see it (as on the Dashboard)
  const full = powerOn(ctx.s, 'dash');
  const prod = full ? (await products(ctx)).bySku : {};
  for (const row of await salesLog(ctx)) {
    const oid = str(row[SL.order_id]);
    if (!oid) continue;
    const dt = asDate(row[SL.timestamp]);
    if (!dt || formatDate(dt, 'yyyy-MM-dd') !== want) continue;
    const qty = num(row[SL.quantity]), total = num(row[SL.total]);
    units += qty; revenue += total; lines++;
    orders[oid] = 1;
    if (full) { const pi = prod[str(row[SL.sku]).toLowerCase()]; const c = soldCost(row, pi && pi.cost); if (c > 0) cogs += c * qty; }
    const nm = str(row[SL.product_name]) || str(row[SL.sku]);
    if (!byProduct[nm]) { byProduct[nm] = { name: nm, units: 0, revenue: 0 }; byOrder.push(nm); }
    byProduct[nm].units += qty;
    byProduct[nm].revenue += total;
    if (!invoices[oid]) {
      invoices[oid] = { id: oid, customer: str(row[SL.customer_name]), time: formatDate(dt, 'h:mm a'),
                        units: 0, total: 0 };
      byInv.push(oid);
    }
    invoices[oid].units += qty;
    invoices[oid].total += total;
  }
  const top = byOrder.map((k) => byProduct[k]);
  top.sort((a, b) => b.units - a.units);
  const inv = byInv.map((k) => invoices[k]);
  inv.sort((a, b) => b.total - a.total);
  for (const v of inv) v.total = Math.round(v.total);
  return {
    date: want, label: formatDate(dhakaDayStart(want), 'EEE d MMM yyyy'),
    units: Math.round(units), orders: Object.keys(orders).length, revenue: Math.round(revenue),
    lines, top: top.slice(0, 8), invoices: inv.slice(0, 25),
    ...(full ? { gross: Math.round(revenue - cogs), margin: revenue > 0 ? Math.round(((revenue - cogs) / revenue) * 1000) / 10 : 0 } : {}),
  };
}

// ----------------------------------------------------------- profitability

/**
 * The profit and loss of some months - THE one place a month's profit is worked
 * out (plan A2). The Profitability screen, the Expenses screen, the Dashboard
 * and the Capital book all read this, so they can never disagree:
 *
 *   net = sales - returns - cost of the goods            (gross)
 *         + delivery charged to customers
 *         + courier collected more  - courier collected less (written off)
 *         - what the courier kept (delivery + COD fee)
 *         - expenses
 */
/** The P&L of these months. Inside a read-only call that asks for many figures (ctx.memo.__ro: ERP Navigator,
 *  Analytics, dashboard cards) each month is worked out once and reused - the months are independent of each other. */
export async function pnlFor(ctx, months) {
  if (!ctx.memo || !ctx.memo.__ro) return pnlForRaw(ctx, months);
  const c = ctx.memo.__pnlm || (ctx.memo.__pnlm = {});
  const miss = months.filter((m) => !c[m]);
  if (miss.length) for (const r of await pnlForRaw(ctx, miss)) c[r.month] = r;
  return months.map((m) => c[m]);
}
async function pnlForRaw(ctx, months) {
  const now = monthKey(ctx.now);
  const want = {};
  for (const m of months) want[m] = { month: m, sales: 0, returns: 0, cost: 0, delivery: 0, uncosted: 0 };

  const { bySku } = await products(ctx);
  const inv = {}, invOrder = [];
  for (const r of await salesLog(ctx)) {
    const oid = str(r[SL.order_id]);
    if (!oid) continue;
    const d = asDate(r[SL.timestamp]);
    if (!d) continue;
    const m = monthKey(d);
    if (!want[m]) continue;
    let o = inv[oid];
    if (!o) { o = inv[oid] = { month: m, lines: [], sum: 0, discount: 0, grand: 0, gross: 0 }; invOrder.push(oid); }
    const ln = { sku: str(r[SL.sku]).toLowerCase(), qty: num(r[SL.quantity]), total: num(r[SL.total]) };
    ln.cost = soldCost(r, bySku[ln.sku] && bySku[ln.sku].cost);
    o.lines.push(ln);
    if (ln.total > 0) o.sum += ln.total;
    if (ln.qty > 0 && ln.total >= 0) o.gross += ln.qty * num(r[SL.unit_price]);   // fix-2 H6: a free line's discount is inside its own line
    o.discount = Math.max(o.discount, num(r[SL.discount]));
    o.grand = Math.max(o.grand, num(r[SL.grand_total]));
  }
  for (const id of invOrder) {
    const I = inv[id], M = want[I.month];
    const isReturn = /^RTN-/.test(id);
    const leftD = discLeft(I.discount, I.gross, I.sum);
    for (const L of I.lines) {
      const unit = L.cost;
      if (L.total < 0 || isReturn) {
        M.returns += -L.total;
        M.cost += unit * L.qty;
        continue;
      }
      const share = (I.sum > 0 && leftD > 0) ? leftD * (L.total / I.sum) : 0;
      const net = Math.max(0, L.total - share);
      M.sales += net;
      if (unit > 0) M.cost += unit * L.qty; else M.uncosted += net;
    }
    // Fix (docs/fixes/dashboard.md): a sale whose lines were logged without
    // prices (everything before July 2026) says nothing about delivery - the
    // original counted its whole total as "delivery charged".
    if (!isReturn && I.grand > 0 && I.sum > 0) M.delivery += Math.max(0, I.grand - (I.sum - leftD));
  }

  // erpSfChargesByMonth_: what Steadfast kept, by the month it paid out
  const courier = await soft(ctx, async () => {
    const c = {};
    const rows = await ctx.tx`select created_src, paid_at, delivery_charges, cod_fee from courier_payouts
                              where business_id = ${ctx.biz}`;
    for (const r of rows) {
      const pd = looseDate(r.paid_at) || looseDate(r.created_src);
      if (!pd) continue;
      const m = monthKey(pd);
      c[m] = (c[m] || 0) + num(r.delivery_charges) + num(r.cod_fee);
    }
    return c;
  }, {});
  // erpSfReconByMonth_: what the parcel check found, by the month it was made
  const chkM = await soft(ctx, async () => {
    const c = {};
    const rows = await ctx.tx`select action, amount, at from courier_recon where business_id = ${ctx.biz}`;
    for (const r of rows) {
      const d = asDate(r.at);
      if (!d) continue;
      const m = monthKey(d), o = c[m] || (c[m] = { extra: 0, short: 0 });
      if (String(r.action) === 'extra') o.extra += num(r.amount);
      if (String(r.action) === 'writeoff') o.short += num(r.amount);
    }
    return c;
  }, {});

  // joint stock sold on this company's own invoices: it is in the sales above at a cost equal to its
  // price - the money is held for the joint book, where its profit is counted
  const jointM = await soft(ctx, async () => {
    const c = {};
    const rows = await ctx.tx`select to_char(public.dhaka_date(i.created_at), 'YYYY-MM') as m, sum(l.line_total) as v
                              from invoice_lines l join invoices i on i.id = l.invoice_id
                              where l.business_id = ${ctx.biz} and i.voided_at is null and l.sku ~* '~J[0-9a-f]{4}$' group by 1`;
    for (const r of rows) c[String(r.m)] = num(r.v);
    return c;
  }, {});

  // owner 18 Oct 2026: this company's share of the joint stock's profit (the pool's own rule) is part of its profit
  const shareM = await soft(ctx, async () => (await import('./joint.js')).jointShareByMonth(ctx, months), {});

  // 111: the part of a late shipment bill for units already sold is cost of goods of the month it was entered in
  const lateM = await soft(ctx, async () => {
    const c = {};
    for (const r of await ctx.tx`select month, sum(sold_part) as s from late_costs where business_id = ${ctx.biz} group by month`) c[String(r.month)] = num(r.s);
    return c;
  }, {});
  for (const m of months) if (lateM[m]) want[m].cost += lateM[m];
  // fix-2 H9: a cancelled sale's delivery charge was never earned - taken back in the month it was cancelled
  const cxlM = await cancelledDelivery(ctx);
  for (const m of months) if (cxlM[m]) want[m].delivery -= cxlM[m];
  // 115: a pre-order deposit the owner kept on cancelling is income of that month
  const forfM = await soft(ctx, async () => {
    const c = {};
    for (const r of await ctx.tx`select forfeit_month, sum(forfeited) as s from preorders where business_id = ${ctx.biz} and forfeited > 0 group by 1`) c[String(r.forfeit_month)] = num(r.s);
    return c;
  }, {});

  const out = [];
  for (const m of months) {
    const x = want[m];
    const net = x.sales - x.returns;
    const gross = net - x.cost;
    const exp = await soft(ctx, () => expByCat(ctx, m), { total: 0, byCat: {} });
    const cour = Math.round(courier[m] || 0);
    const cx = chkM[m] || { extra: 0, short: 0 };
    const svc = await serviceFor(ctx, m);                       // plan D2: repairs made, parts used
    const forfeited = Math.round(forfM[m] || 0);
    const jointShare = Math.round(shareM[m] || 0);
    const profit = gross + x.delivery + cx.extra - cx.short - cour - exp.total + svc.income - svc.parts + forfeited + jointShare;
    out.push({ month: m, sales: Math.round(x.sales), returns: Math.round(x.returns), netSales: Math.round(net),
               cost: Math.round(x.cost), gross: Math.round(gross),
               grossMargin: net > 0 ? Math.round(gross / net * 1000) / 10 : 0,
               expenses: Math.round(exp.total), byCat: exp.byCat,
               net: Math.round(profit), netMargin: net > 0 ? Math.round(profit / net * 1000) / 10 : 0,
               delivery: Math.round(x.delivery), courier: cour,
               courierExtra: Math.round(cx.extra), courierShort: Math.round(cx.short),
               uncosted: Math.round(x.uncosted), current: m === now,
               serviceIncome: svc.income, serviceParts: svc.parts, serviceJobs: svc.jobs, joint: Math.round(jointM[m] || 0), jointShare, forfeited });
  }
  return out;
}

/** fix-2 H9: delivery charges taken back by cancelling a sale, by the month of the cancel. */
async function cancelledDelivery(ctx) {
  return soft(ctx, async () => {
    const c = {};
    for (const r of await ctx.tx`select to_char(public.dhaka_date(paid_at), 'YYYY-MM') as m, sum(amount) as s from payments
                                 where business_id = ${ctx.biz} and method = 'Adjusted' and note like 'delivery charge cancelled [cancel:%' group by 1`) c[String(r.m)] = num(r.s);
    return c;
  }, {});
}

/** One month of it (kept for the length of the call: several screens' parts ask for the same month). */
export async function monthNet(ctx, month) {
  const k = 'pnl:' + month;
  if (!ctx.memo[k]) ctx.memo[k] = (await pnlFor(ctx, [month]))[0];
  return ctx.memo[k];
}

/** erpPnl (ERP.js:8306): calendar-month profit and loss. */
export async function erpPnl(ctx, payload) {
  const n = Math.min(12, Math.max(1, Math.round(num(payload && payload.months)) || 6));
  const now = monthKey(ctx.now);
  // the window can end on an earlier month (redesign phase 4: the month picker)
  const to = payload && /^\d{4}-(0[1-9]|1[0-2])$/.test(String(payload.to || '')) && payload.to < now ? payload.to : now;
  const months = [];
  for (let i = n - 1; i >= 0; i--) months.push(shiftMonth(to, -i));
  const out = await pnlFor(ctx, months);
  const cats = {};
  for (const x of out) for (const c of Object.keys(x.byCat)) cats[c] = 1;
  return { months: out, categories: Object.keys(cats).sort(), to, thisMonth: now,
           generatedAt: formatDate(ctx.now, 'd MMM yyyy, h:mm a') };
}

/**
 * One month of the profit and loss statement, invoice by invoice - what stands
 * behind the figures (redesign phase 4). Same rules as erpPnl above.
 */
export async function erpPnlMonth(ctx, payload) {
  const month = str(payload && payload.month);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Which month?');
  const { bySku } = await products(ctx);
  const inv = {}, order = [];
  for (const r of await salesLog(ctx)) {
    const oid = str(r[SL.order_id]);
    if (!oid) continue;
    const d = asDate(r[SL.timestamp]);
    if (!d || monthKey(d) !== month) continue;
    let o = inv[oid];
    if (!o) {
      o = inv[oid] = { id: oid, ts: d.getTime(), date: formatDate(d, 'd MMM'), customer: str(r[SL.customer_name]),
                       lines: [], sum: 0, discount: 0, grand: 0, gross: 0 };
      order.push(oid);
    }
    const ln = { sku: str(r[SL.sku]).toLowerCase(), qty: num(r[SL.quantity]), total: num(r[SL.total]) };
    ln.cost = soldCost(r, bySku[ln.sku] && bySku[ln.sku].cost);
    o.lines.push(ln);
    if (ln.total > 0) o.sum += ln.total;
    if (ln.qty > 0 && ln.total >= 0) o.gross += ln.qty * num(r[SL.unit_price]);   // fix-2 H6: a free line's discount is inside its own line
    o.discount = Math.max(o.discount, num(r[SL.discount]));
    o.grand = Math.max(o.grand, num(r[SL.grand_total]));
  }
  const rows = [];
  const t = { sales: 0, returns: 0, cost: 0, delivery: 0, profit: 0 };
  for (const id of order) {
    const I = inv[id], isReturn = /^RTN-/.test(id);
    const leftD = discLeft(I.discount, I.gross, I.sum);
    let sales = 0, returns = 0, cost = 0, uncosted = false;
    for (const L of I.lines) {
      const unit = L.cost;
      if (L.total < 0 || isReturn) { returns += -L.total; cost += unit * L.qty; continue; }
      const share = (I.sum > 0 && leftD > 0) ? leftD * (L.total / I.sum) : 0;
      sales += Math.max(0, L.total - share);
      if (unit > 0) cost += unit * L.qty; else uncosted = true;
    }
    const delivery = (!isReturn && I.grand > 0 && I.sum > 0) ? Math.max(0, I.grand - (I.sum - leftD)) : 0;
    const net = sales - returns;
    rows.push({ id, ts: I.ts, date: I.date, customer: I.customer, isReturn, net: Math.round(net), cost: Math.round(cost),
                profit: Math.round(net - cost), delivery: Math.round(delivery), uncosted });
    t.sales += sales; t.returns += returns; t.cost += cost; t.delivery += delivery; t.profit += net - cost;
  }
  rows.sort((a, b) => b.ts - a.ts);
  for (const r of rows) delete r.ts;
  t.delivery -= (await cancelledDelivery(ctx))[month] || 0;   // fix-2 H9
  const exp = await soft(ctx, () => expByCat(ctx, month), { total: 0, byCat: {} });
  const expenses = Object.keys(exp.byCat).map((c) => ({ name: c, amount: exp.byCat[c] })).sort((a, b) => b.amount - a.amount);
  for (const k of Object.keys(t)) t[k] = Math.round(t[k]);
  return { month, label: monthLabel(month), invoices: rows.slice(0, 1500), more: Math.max(0, rows.length - 1500),
           totals: t, expenses, expenseTotal: Math.round(exp.total) };
}

/** erpMoney (ERP.js:5582): product profitability and cash asleep on the shelf. */
export async function erpMoney(ctx, payload) {
  payload = payload || {};
  const days = num(payload.days) > 0 ? Math.round(num(payload.days)) : 90;
  const deadAfter = num(payload.deadAfter) > 0 ? Math.round(num(payload.deadAfter)) : 90;
  const now = ctx.now.getTime();
  const from = days >= 9999 ? 0 : now - days * DAY_MS;

  const { list: plist, bySku: prod } = await products(ctx);
  const sl = await salesLog(ctx);

  const lines = [], byInvoice = {};
  for (const r of sl) {
    const oid = str(r[SL.order_id]);
    if (!oid) continue;
    const when = asDate(r[SL.timestamp]);
    if (!when || when.getTime() < from) continue;
    const line = { id: oid, sku: str(r[SL.sku]), qty: num(r[SL.quantity]), total: num(r[SL.total]),
                   discount: num(r[SL.discount]) };
    line.cost = soldCost(r, prod[line.sku.toLowerCase()] && prod[line.sku.toLowerCase()].cost);
    if (!line.sku || (line.qty <= 0 && line.total >= 0)) continue;
    lines.push(line);
    const inv = byInvoice[oid] || (byInvoice[oid] = { lines: 0, discount: 0, gross: 0 });
    if (line.qty > 0 && line.total >= 0) inv.gross += line.qty * num(r[SL.unit_price]);
    inv.lines += line.total;
    inv.discount = Math.max(inv.discount, line.discount);
  }

  const bySku = {}, byBrand = {}, byCat = {};
  const skuOrder = [], brandOrder = [], catOrder = [];
  let revenue = 0, cost = 0, unknownRevenue = 0, unknownUnits = 0;
  function bucket(map, order, name) {
    if (!map[name]) { map[name] = { name, units: 0, revenue: 0, cost: 0, profit: 0, unknown: false }; order.push(name); }
    return map[name];
  }
  for (const ln of lines) {
    const inv2 = byInvoice[ln.id];
    const left2 = inv2 ? discLeft(inv2.discount, inv2.gross, inv2.lines) : 0;
    const share = (inv2 && inv2.lines > 0 && left2 > 0) ? left2 * (ln.total / inv2.lines) : 0;
    const net = ln.total < 0 ? ln.total : Math.max(0, ln.total - share);
    const p = prod[ln.sku.toLowerCase()];
    const unitCost = ln.cost;
    const lineCost = unitCost > 0 ? unitCost * ln.qty : 0;
    const known = unitCost > 0;
    revenue += net;
    if (known) cost += lineCost;
    else { unknownRevenue += net; unknownUnits += ln.qty; }

    const k = ln.sku.toLowerCase();
    let s = bySku[k];
    if (!s) {
      s = bySku[k] = { sku: p ? p.sku : ln.sku, name: p ? p.name : ln.sku,
                       brand: p ? p.brand : '', cat: p ? p.cat : '', type: p ? p.type : '',
                       units: 0, revenue: 0, cost: 0, profit: 0, unknown: !known };
      skuOrder.push(k);
    }
    s.units += ln.qty; s.revenue += net; s.cost += lineCost;
    if (!known) s.unknown = true;
    const b = bucket(byBrand, brandOrder, (p && p.brand) || 'Unknown');
    b.units += ln.qty; b.revenue += net; b.cost += lineCost;
    if (!known) b.unknown = true;
    const c = bucket(byCat, catOrder, (p && p.cat) || 'Unknown');
    c.units += ln.qty; c.revenue += net; c.cost += lineCost;
    if (!known) c.unknown = true;
  }
  function finish(o) {
    o.units = Math.round(o.units * 100) / 100;
    o.revenue = Math.round(o.revenue);
    o.cost = Math.round(o.cost);
    o.profit = o.revenue - o.cost;
    o.margin = o.revenue > 0 ? Math.round((o.profit / o.revenue) * 1000) / 10 : 0;
    return o;
  }
  function list(map, order) {
    const out = order.map((k) => finish(map[k]));
    out.sort((a, b) => b.profit - a.profit);
    return out;
  }
  const productsOut = list(bySku, skuOrder);

  // cash asleep on the shelf
  const sold = {};
  for (const r of sl) {
    if (!str(r[SL.order_id])) continue;
    const sk = str(r[SL.sku]).toLowerCase();
    if (!sk) continue;
    const d = asDate(r[SL.timestamp]);
    if (d && (!sold[sk] || d.getTime() > sold[sk])) sold[sk] = d.getTime();
  }
  const dead = [];
  let deadCash = 0, stockCash = 0;
  const LSm = await atLots(ctx);
  for (const pr of plist) {
    const stock = pr.stock;
    if (stock <= 0) continue;
    const tied = Math.round(lotValue(LSm, pr, stock));
    stockCash += tied;
    const last = sold[pr.sku.toLowerCase()] || 0;
    const since = last ? Math.floor((now - last) / DAY_MS) : null;
    if (since === null || since > deadAfter) {
      deadCash += tied;
      dead.push({ sku: pr.sku, name: pr.name, brand: pr.brand || '', cat: pr.cat || '',
                  stock, unitCost: Math.round(tied / stock), tied, lastSoldDays: since });
    }
  }
  dead.sort((a, b) => b.tied - a.tied);

  revenue = Math.round(revenue); cost = Math.round(cost);
  return {
    days, deadAfter,
    revenue, cost, profit: revenue - cost,
    margin: revenue > 0 ? Math.round(((revenue - cost) / revenue) * 1000) / 10 : 0,
    unknownRevenue: Math.round(unknownRevenue), unknownUnits: Math.round(unknownUnits),
    products: productsOut.slice(0, 200),
    brands: list(byBrand, brandOrder), categories: list(byCat, catOrder),
    dead: dead.slice(0, 100), deadCount: dead.length,
    deadCash: Math.round(deadCash), stockCash: Math.round(stockCash),
    generatedAt: formatDate(ctx.now, 'd MMM yy, h:mm a'),
  };
}

// ------------------------------------------------------------ product cost

/**
 * erpCostSync_ (ERP.js:3012): a book row for every category + brand + type an
 * active product uses; SKU count and typical selling price rewritten each time.
 */
async function costSync(ctx) {
  const prods = await ctx.tx`
    select sku, category, brand, type, sell_price, status from products
    where business_id = ${ctx.biz} order by created_at, sku`;
  const want = {}, order = [];
  for (const r of prods) {
    if (!str(r.sku)) continue;
    const status = str(r.status).toLowerCase();
    if (status && status !== 'active') continue;
    const key = [str(r.category) || 'Uncategorised', str(r.brand) || '-', str(r.type) || '-'];
    const id = bookKey(...key);
    if (!want[id]) { want[id] = { key, skus: 0, sell: [] }; order.push(id); }
    want[id].skus++;
    if (num(r.sell_price) > 0) want[id].sell.push(num(r.sell_price));
  }
  if (!order.length) return { added: 0 };

  await lock(ctx, 'cost_book');
  const rows = await bookRows(ctx);
  const have = {};
  let maxOrder = 0;
  for (const r of rows) {
    if (r.sort_order > maxOrder) maxOrder = r.sort_order;
    if (!str(r.category) && !str(r.brand) && !str(r.type)) continue;
    const k = bookKey(r.category, r.brand, r.type);
    if (!have[k]) have[k] = r;
  }

  let added = 0;
  for (const id of order) {
    if (have[id]) continue;
    const w = want[id];
    const handling = /^filament/i.test(w.key[0]) ? null : 0;
    const ins = await ctx.tx`
      insert into cost_book (business_id, sort_order, category, brand, type, handling)
      values (${ctx.biz}, ${++maxOrder}, ${w.key[0]}, ${w.key[1]}, ${w.key[2]}, ${handling})
      returning id, products, typical_sell`;
    have[id] = ins[0];
    added++;
  }

  const live = {};
  for (const id of order) {
    const w = want[id], at = have[id];
    live[at.id] = true;
    const sell = w.sell.length ? Math.round(w.sell.reduce((a, b) => a + b, 0) / w.sell.length) : 0;
    if (num(at.products) !== w.skus || num(at.typical_sell) !== sell) {
      await ctx.tx`update cost_book set products = ${w.skus}, typical_sell = ${sell} where id = ${at.id}`;
    }
  }
  let stale = 0;
  for (const r of rows) {
    if (live[r.id]) continue;
    if (num(r.products) !== 0) {
      await ctx.tx`update cost_book set products = 0, typical_sell = 0 where id = ${r.id}`;
    }
    stale++;
  }
  if (added || stale) delete ctx.memo.bookCost;
  return { added, stale };
}

/** erpCostBook (ERP.js:2839): the price book plus the three editable numbers. */
export async function erpCostBook(ctx) {
  const sync = await soft(ctx, () => costSync(ctx), { added: 0 });
  const cfg = await costConfig(ctx);
  const rows = [];
  (await bookRows(ctx)).forEach((r, i) => {
    if (!str(r.category) && !str(r.type)) return;
    const landed = landedOf(r, cfg);
    const sell = num(r.typical_sell);
    rows.push({
      row: i + 2,
      category: str(r.category), brand: str(r.brand), type: str(r.type),
      rmb: costCell(r.buy_rmb), bdt: costCell(r.buy_bdt), handling: costCell(r.handling),
      amount: num(r.buy_amount) > 0 ? num(r.buy_amount) : (num(r.buy_rmb) > 0 ? num(r.buy_rmb) : num(r.buy_bdt) > 0 ? num(r.buy_bdt) : null),
      cur: str(r.buy_cur).toUpperCase() || (num(r.buy_rmb) > 0 ? 'RMB' : num(r.buy_bdt) > 0 ? 'BDT' : ''),
      landed: num(landed), products: num(r.products), sell,
      margin: marginOf(landed, sell),
      note: str(r.note),
    });
  });
  let priced = 0;
  for (const r of rows) if (r.landed > 0) priced++;
  return { ok: true, rows, rate: cfg.rate, rates: cfg.rates, handling: cfg.handling, minMargin: cfg.minMargin,
           priced, missing: rows.length - priced, added: sync.added || 0 };
}

/** erpSaveCostSettings (ERP.js:2896). Blank leaves that one alone. */
export async function erpSaveCostSettings(ctx, payload) {
  await lock(ctx, 'cost_book');
  const map = [['rate', 'cost_rate'], ['handling', 'cost_handling'], ['minMargin', 'cost_min_margin']];
  for (const [key, cfgKey] of map) {
    if (!payload || payload[key] === '' || payload[key] === null || payload[key] === undefined) continue;
    const v = num(payload[key]);
    if (v < 0) throw new Error('A negative value does not make sense for ' + key + '.');
    if (key === 'rate' && v > 1000) {
      throw new Error('That rate looks wrong (' + v + ' TK per RMB). Check it before saving.');
    }
    await setConfig(ctx, cfgKey, v);
    if (key === 'rate' && v > 0) await saveRate(ctx, 'RMB', v);          // plan A5: the RMB rate lives with the currencies
  }
  delete ctx.memo.bookCost;
  delete ctx.memo.dashProducts;
  return erpCostBook(ctx);
}

/** erpSaveCostRows (ERP.js:2926): only the fields actually typed, matched by name. */
export async function erpSaveCostRows(ctx, payload) {
  const list = (payload && payload.rows) || [];
  if (!list.length) return erpCostBook(ctx);
  await lock(ctx, 'cost_book');
  const whereIs = {};
  for (const r of await bookRows(ctx)) {
    if (!str(r.category) && !str(r.brand) && !str(r.type)) continue;
    const k = bookKey(r.category, r.brand, r.type);
    if (!whereIs[k]) whereIs[k] = r.id;
  }
  const notFound = [];
  let saved = 0;
  const cols = { rmb: 'buy_rmb', bdt: 'buy_bdt', handling: 'handling' };
  for (const raw of list) {
    const it = raw || {};
    const want = [str(it.category), str(it.brand), str(it.type)];
    const id = whereIs[bookKey(...want)];
    if (!id) { notFound.push(want[1] + ' ' + want[2]); continue; }
    let touched = false;
    // plan A5: a price in any currency - { amount, cur }. The old two columns are kept in step.
    if (Object.prototype.hasOwnProperty.call(it, 'amount')) {
      const amt = costCell(it.amount), cur = str(it.cur).toUpperCase() || 'BDT';
      if (amt !== null && amt < 0) throw new Error('A price cannot be negative.');
      if (amt !== null && cur !== 'BDT' && !(num((await ratesMap(ctx))[cur]) > 0)) {
        throw new Error('There is no rate for ' + cur + ' yet. Set it under Currencies first.');
      }
      await ctx.tx`update cost_book set buy_amount = ${amt}, buy_cur = ${amt === null ? null : cur},
                   buy_rmb = ${amt !== null && cur === 'RMB' ? amt : null}, buy_bdt = ${amt !== null && cur === 'BDT' ? amt : null} where id = ${id}`;
      touched = true;
    }
    for (const f of Object.keys(cols)) {
      if (!Object.prototype.hasOwnProperty.call(it, f)) continue;
      const val = costCell(it[f]);
      if (val !== null && val < 0) {
        throw new Error(f === 'handling' ? 'Handling cannot be negative.' : 'A price cannot be negative.');
      }
      await ctx.tx`update cost_book set ${ctx.tx(cols[f])} = ${val} where id = ${id}`;
      if (f === 'rmb' && !Object.prototype.hasOwnProperty.call(it, 'amount')) await ctx.tx`update cost_book set buy_amount = ${val}, buy_cur = ${val === null ? null : 'RMB'} where id = ${id} and (${val}::numeric is not null or buy_cur = 'RMB')`;
      if (f === 'bdt' && !Object.prototype.hasOwnProperty.call(it, 'amount')) await ctx.tx`update cost_book set buy_amount = ${val}, buy_cur = ${val === null ? null : 'BDT'} where id = ${id} and (${val}::numeric is not null or buy_cur = 'BDT')`;
      touched = true;
    }
    if (!touched) continue;
    await ctx.tx`update cost_book set updated_at = now() where id = ${id}`;
    saved++;
  }
  delete ctx.memo.bookCost;
  delete ctx.memo.dashProducts;
  const book = await erpCostBook(ctx);
  book.saved = saved;
  book.notFound = notFound;
  return book;
}

export const HANDLERS = {
  erpDashboardData,
  erpDaySales,
  erpPnl,
  erpPnlMonth,
  erpMoney,
  erpCostBook,
  erpSaveCostSettings,
  erpSaveCostRows,
};

/** Stock on the shelf at cost, for the balance sheet: units in a lot with a landed cost at that cost; units with no
 *  cost of their own (the opening stock) at the cost FROZEN when the books were opened, so a new shipment changing a
 *  product's average cost does not re-price what was already on the shelf. frozen: { sku(lower): unit cost }. */
export async function stockAtCost(ctx, frozen) {
  const { list } = await products(ctx);
  const fz = frozen || {};
  const lots = {};
  for (const r of await ctx.tx`select lower(p.sku) k, sum(l.qty_left) units,
                                      sum(l.qty_left * l.unit_cost) filter (where l.unit_cost is not null) known,
                                      coalesce(sum(l.qty_left) filter (where l.unit_cost is null), 0) unknown
                               from stock_lots l join products p on p.id = l.product_id
                               where l.business_id = ${ctx.biz} and l.qty_left > 0 group by 1`) lots[r.k] = r;
  let cost = 0, units = 0, uncosted = 0;
  const costs = {};
  for (const p of list) {
    if (!(p.stock > 0)) continue;
    const k = p.sku.toLowerCase(), r = lots[k], unit = Object.prototype.hasOwnProperty.call(fz, k) ? num(fz[k]) : (p.cost > 0 ? p.cost : 0);
    costs[k] = unit;
    units += p.stock;
    // units with no cost of their own: the lots that have none, plus any stock the lots do not cover
    const known = r ? num(r.known) : 0, inLots = r ? num(r.units) : 0;
    const noCost = (r ? num(r.unknown) : 0) + Math.max(0, p.stock - inLots);
    const v = known + noCost * unit;
    if (noCost > 0 && !(unit > 0)) uncosted++;
    cost += v;
  }
  return { cost: Math.round(cost), units, uncosted, costs };
}
