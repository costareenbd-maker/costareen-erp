// FilaDash merge P2 (docs/FILADASH-MERGE-REVIEW.md): the figures for the FilaDash-style dashboard.
//
// One call, read only. The range is whole calendar months (1, 3, 6 or 12 ending this month or `to`), so
// "Net profit" is exactly the P&L screen's figure (pnlFor) - one net profit everywhere. The owner's
// product-group drop-down (decision F5) narrows the sales side to one product category: revenue, cost,
// gross profit, units, orders, stock. Expenses, net profit, dues and cash belong to the whole business;
// with a group picked they are left out (`group` is set) and the page says so.
//
// Every money figure comes with `calc`: the lines it is made of (FilaDash's "Show calculation").

import { salesLog, paymentsTab, asDate, str, SL, PAY } from '../lib/tabs.js';
import { formatDate, num } from '../lib/time.js';
import { powerOn, roleAtLeast } from '../allow.js';
import { discLeft } from './money.js';
import { products, pnlFor, soldCost, owedMap } from './dashboard.js';

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const NOT_MONEY = /^(adjusted|returned|undone|advance|written off)$/i;

function monthKey(d) { return formatDate(d, 'yyyy-MM'); }
function monthLabel(key) { const p = key.split('-'); return MON3[Number(p[1]) - 1] + " '" + p[0].slice(2); }
function shiftMonth(key, n) {
  let y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) + n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}
const R = (v) => Math.round(num(v));
const pct = (a, b) => (b > 0 ? Math.round(a / b * 1000) / 10 : 0);
const groupKey = (cat) => (str(cat) || 'Uncategorised').toLowerCase();

/** Sales lines of the given months, discount shared out the way pnlFor does it, with each line's category. */
async function lines(ctx, months) {
  const want = new Set(months);
  const { bySku } = await products(ctx);
  const inv = {}, order = [];
  for (const r of await salesLog(ctx)) {
    const oid = str(r[SL.order_id]);
    if (!oid) continue;
    const d = asDate(r[SL.timestamp]);
    if (!d) continue;
    const m = monthKey(d);
    if (!want.has(m)) continue;
    let o = inv[oid];
    if (!o) {
      o = inv[oid] = { id: oid, month: m, at: d, lines: [], sum: 0, gross: 0, discount: 0,
                       source: str(r[SL.customer_source]) || 'Walk-in / direct' };
      order.push(oid);
    }
    const sku = str(r[SL.sku]).toLowerCase(), p = bySku[sku];
    const ln = { sku, name: str(r[SL.product_name]) || (p && p.name) || sku, qty: num(r[SL.quantity]), total: num(r[SL.total]),
                 group: groupKey(p ? p.cat : ''), brand: (p && p.brand) || '-' };
    ln.cost = soldCost(r, p && p.cost);
    o.lines.push(ln);
    if (ln.total > 0) { o.sum += ln.total; o.gross += ln.qty * num(r[SL.unit_price]); }
    o.discount = Math.max(o.discount, num(r[SL.discount]));
  }
  const out = [];
  for (const id of order) {
    const I = inv[id], isReturn = /^RTN-/.test(id);
    const leftD = discLeft(I.discount, I.gross, I.sum);
    for (const L of I.lines) {
      let revenue;
      if (L.total < 0 || isReturn) revenue = L.total < 0 ? L.total : -L.total;
      else revenue = Math.max(0, L.total - ((I.sum > 0 && leftD > 0) ? leftD * (L.total / I.sum) : 0));
      out.push({ inv: id, month: I.month, at: I.at, source: I.source, sku: L.sku, name: L.name, group: L.group, brand: L.brand,
                 qty: isReturn && L.qty > 0 ? -L.qty : L.qty, revenue, cost: L.cost * (isReturn && L.qty > 0 ? -L.qty : L.qty), costed: L.cost > 0 });
    }
  }
  return out;
}

function sumUp(rows) {
  const t = { revenue: 0, cost: 0, units: 0, orders: 0 };
  const inv = new Set();
  for (const x of rows) { t.revenue += x.revenue; t.cost += x.cost; t.units += x.qty; if (x.revenue > 0) inv.add(x.inv); }
  t.orders = inv.size;
  t.gross = t.revenue - t.cost;
  return t;
}

function slices(map, n) {
  const all = Object.entries(map).map(([label, value]) => ({ label, value: R(value) })).filter((s) => s.value > 0)
    .sort((a, b) => b.value - a.value);
  if (all.length <= n) return all;
  const top = all.slice(0, n - 1), rest = all.slice(n - 1).reduce((s, x) => s + x.value, 0);
  return top.concat([{ label: 'Other', value: rest }]);
}

export async function erpFdDash(ctx, payload) {
  payload = payload || {};
  const full = powerOn(ctx.s, 'dash');
  const n = [1, 3, 6, 12].includes(Number(payload.months)) ? Number(payload.months) : 1;
  const now = monthKey(ctx.now);
  const to = /^\d{4}-(0[1-9]|1[0-2])$/.test(String(payload.to || '')) && payload.to <= now ? payload.to : now;
  const months = [], prevMonths = [];
  for (let i = n - 1; i >= 0; i--) months.push(shiftMonth(to, -i));
  for (let i = 2 * n - 1; i >= n; i--) prevMonths.push(shiftMonth(to, -i));
  // the line chart always shows at least 6 months, so one month still has a curve
  const chartMonths = [];
  for (let i = Math.max(n, 6) - 1; i >= 0; i--) chartMonths.push(shiftMonth(to, -i));

  const { list } = await products(ctx);
  const groupsMap = {};
  for (const p of list) {
    const k = groupKey(p.cat);
    const g = groupsMap[k] || (groupsMap[k] = { key: k, label: str(p.cat) || 'Uncategorised', products: 0 });
    g.products++;
  }
  const groups = Object.values(groupsMap).sort((a, b) => b.products - a.products || a.label.localeCompare(b.label));
  const group = payload.group && groupsMap[String(payload.group).toLowerCase()] ? String(payload.group).toLowerCase() : '';
  const inGroup = (x) => !group || x.group === group;

  const allMonths = Array.from(new Set(prevMonths.concat(chartMonths, months))).sort();
  const L = (await lines(ctx, allMonths)).filter(inGroup);
  const cur = sumUp(L.filter((x) => months.includes(x.month)));
  const prev = sumUp(L.filter((x) => prevMonths.includes(x.month)));

  // the business's own P&L for the same months (whole business only)
  let pnl = null, pnlPrev = null, series;
  if (!group) {
    const all = await pnlFor(ctx, Array.from(new Set(prevMonths.concat(chartMonths, months))).sort());
    const by = {};
    for (const x of all) by[x.month] = x;
    const add = (ms) => ms.reduce((t, m) => {
      const x = by[m] || {};
      for (const k of ['sales', 'returns', 'netSales', 'cost', 'gross', 'expenses', 'net', 'delivery', 'courier', 'courierExtra', 'courierShort', 'serviceIncome', 'serviceParts']) t[k] = (t[k] || 0) + num(x[k]);
      return t;
    }, {});
    pnl = add(months); pnlPrev = add(prevMonths);
    series = chartMonths.map((m) => ({ month: m, label: monthLabel(m), revenue: R((by[m] || {}).netSales), gross: R((by[m] || {}).gross), net: R((by[m] || {}).net) }));
  } else {
    series = chartMonths.map((m) => { const t = sumUp(L.filter((x) => x.month === m)); return { month: m, label: monthLabel(m), revenue: R(t.revenue), gross: R(t.gross) }; });
  }

  // revenue / cost / gross: the P&L's figure for the whole business, the lines' for a group
  const rev = group ? cur.revenue : pnl.netSales, revPrev = group ? prev.revenue : pnlPrev.netSales;
  const cost = group ? cur.cost : pnl.cost, costPrev = group ? prev.cost : pnlPrev.cost;
  const gross = rev - cost, grossPrev = revPrev - costPrev;

  // stock now
  let stockValue = 0, stockUnits = 0, uncosted = 0;
  const reorder = [];
  let outOfStock = 0, atReorder = 0;
  for (const p of list) {
    if (group && groupKey(p.cat) !== group) continue;
    if (/discontinued|inactive/i.test(p.status)) continue;
    if (p.stock > 0) { stockUnits += p.stock; if (p.cost > 0) stockValue += p.stock * p.cost; else uncosted++; }
    if (p.stock <= 0) outOfStock++;
    else if (p.stock <= p.reorder) atReorder++;
    if (p.stock <= p.reorder) reorder.push({ sku: p.sku, name: p.name, stock: p.stock, reorder: p.reorder, sell: p.sell });
  }
  reorder.sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));

  const curL = L.filter((x) => months.includes(x.month));
  const byGroup = {}, byBrand = {}, byChannel = {}, byProduct = {};
  for (const x of curL) {
    byGroup[(groupsMap[x.group] || { label: x.group }).label] = (byGroup[(groupsMap[x.group] || { label: x.group }).label] || 0) + x.revenue;
    byBrand[x.brand] = (byBrand[x.brand] || 0) + x.revenue;
    byChannel[x.source] = (byChannel[x.source] || 0) + x.revenue;
    const p = byProduct[x.sku] || (byProduct[x.sku] = { sku: x.sku, name: x.name, units: 0, revenue: 0, gross: 0 });
    p.units += x.qty; p.revenue += x.revenue; p.gross += x.revenue - x.cost;
  }
  const topProducts = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 8)
    .map((p) => ({ sku: p.sku.toUpperCase(), name: p.name, units: R(p.units), revenue: R(p.revenue), gross: full ? R(p.gross) : undefined }));

  // latest invoices (in the group: invoices with a line of it)
  const owed = await owedMap(ctx);
  const seen = {}, recent = [];
  const latest = (await salesLog(ctx)).slice().reverse();
  const { bySku } = await products(ctx);
  for (const r of latest) {
    const oid = str(r[SL.order_id]);
    if (!oid || seen[oid] || /^RTN-/.test(oid)) continue;
    if (group) { const p = bySku[str(r[SL.sku]).toLowerCase()]; if (!p || groupKey(p.cat) !== group) continue; }
    seen[oid] = 1;
    const d = asDate(r[SL.timestamp]);
    recent.push({ id: oid, date: d ? formatDate(d, 'd MMM') : '', customer: str(r[SL.customer_name]), total: R(r[SL.grand_total]), owed: R(owed[oid] || 0) });
    if (recent.length >= 8) break;
  }

  const out = {
    currency: 'BDT', months: n, to, from: months[0], rangeLabel: n === 1 ? monthLabel(to) + (to === now ? ' to date' : '') : monthLabel(months[0]) + ' – ' + monthLabel(to),
    prevLabel: n === 1 ? monthLabel(prevMonths[0]) : monthLabel(prevMonths[0]) + ' – ' + monthLabel(prevMonths[prevMonths.length - 1]),
    groups, group, groupLabel: group ? groupsMap[group].label : '', full,
    series, topProducts, recent, reorder: reorder.slice(0, 8),
    attention: { outOfStock, reorder: atReorder },
    kpi: {
      revenue: { v: R(rev), prev: R(revPrev) },
      orders: { v: cur.orders, prev: prev.orders },
      units: { v: R(cur.units), prev: R(prev.units) },
      avgOrder: { v: cur.orders ? R(cur.revenue / cur.orders) : 0, prev: prev.orders ? R(prev.revenue / prev.orders) : 0 },
      stockUnits: { v: R(stockUnits) },
    },
    donuts: {
      byGroup: group ? null : slices(byGroup, 6),
      byBrand: slices(byBrand, 6),
      byChannel: slices(byChannel, 6),
    },
    calc: {
      revenue: group
        ? [['Sales of ' + groupsMap[group].label + ', after each invoice’s discount share', R(cur.revenue)]]
        : [['Sales after discounts', R(pnl.sales)], ['− Goods returned', -R(pnl.returns)], ['= Revenue', R(pnl.netSales)]],
    },
  };
  if (full) {
    out.kpi.gross = { v: R(gross), prev: R(grossPrev) };
    out.kpi.margin = { v: pct(gross, rev), prev: pct(grossPrev, revPrev) };
    out.kpi.stockValue = { v: R(stockValue), uncosted };
    out.calc.gross = [['Revenue', R(rev)], ['− Cost of the goods sold (fixed on each invoice line the day it was sold)', -R(cost)], ['= Gross profit', R(gross)]];
    out.calc.stockValue = [['Units on hand × each product’s cost (Product cost book)', R(stockValue)]].concat(uncosted ? [[uncosted + ' product(s) in stock have no cost yet - not counted', 0]] : []);
  }
  if (!group && full) {
    out.kpi.net = { v: R(pnl.net), prev: R(pnlPrev.net) };
    out.kpi.expenses = { v: R(pnl.expenses), prev: R(pnlPrev.expenses) };
    out.calc.net = [['Gross profit', R(pnl.gross)], ['+ Delivery charged to customers', R(pnl.delivery)],
      ['+ Courier paid more than expected', R(pnl.courierExtra)], ['− Courier paid less (written off)', -R(pnl.courierShort)],
      ['− Courier delivery + COD fees', -R(pnl.courier)], ['+ Repairs income − parts', R(pnl.serviceIncome - pnl.serviceParts)],
      ['− Expenses', -R(pnl.expenses)], ['= Net profit (same as Profit & loss)', R(pnl.net)]];
    out.calc.expenses = [['Expenses entered for these months, not struck out, + investor returns due + joint-stock share', R(pnl.expenses)]];
  }
  if (!group) {
    // money in and dues: the whole business
    const inRange = (d) => { const m = d && monthKey(d); return m && months.includes(m); };
    const inPrev = (d) => { const m = d && monthKey(d); return m && prevMonths.includes(m); };
    let cashIn = 0, cashPrev = 0;
    const byMethod = {};
    for (const p of await paymentsTab(ctx)) {
      const amt = num(p[PAY.amount]), meth = str(p[PAY.method]) || 'Other', d = asDate(p[PAY.timestamp]);
      if (!(amt > 0) || NOT_MONEY.test(meth)) continue;
      if (inRange(d)) { cashIn += amt; byMethod[meth] = (byMethod[meth] || 0) + amt; }
      else if (inPrev(d)) cashPrev += amt;
    }
    out.kpi.cashIn = { v: R(cashIn), prev: R(cashPrev) };
    out.donuts.byMethod = slices(byMethod, 6);
    out.calc.cashIn = [['Payments received in these months (not adjustments, returns or advances moved)', R(cashIn)]];
    // dues by age of the invoice
    const age = { '0–30 days': [0, 0], '31–60 days': [0, 0], '61–90 days': [0, 0], 'Over 90 days': [0, 0] };
    const first = {};
    for (const r of await salesLog(ctx)) { const id = str(r[SL.order_id]); if (id && !first[id]) first[id] = asDate(r[SL.timestamp]); }
    let dues = 0;
    for (const [id, v] of Object.entries(owed)) {
      if (!(v > 0.5)) continue;
      dues += v;
      const d = first[id], days = d ? (ctx.now.getTime() - d.getTime()) / 864e5 : 999;
      const b = days <= 30 ? '0–30 days' : days <= 60 ? '31–60 days' : days <= 90 ? '61–90 days' : 'Over 90 days';
      age[b][0] += v; age[b][1]++;
    }
    out.kpi.dues = { v: R(dues) };
    out.duesByAge = Object.entries(age).map(([band, x]) => ({ band, amount: R(x[0]), count: x[1] }));
    out.calc.dues = [['What every invoice still owes (total − payments and advance), today', R(dues)]];
  }
  out.generatedAt = formatDate(ctx.now, 'd MMM yyyy, h:mm a');
  return out;
}

// ------------------------------------------------------------------ screen heads
// FilaDash's list screens open with four cards (the first one the "hero"). erpFdHead gives them for one screen:
// this month against last month. Anyone who may open the screen may ask; money only reaches the people the
// matching ability allows (dues: "dues", stock value: "costs", expenses: "expenses", money: shareholder).

function card(key, title, icon, v, o) { return Object.assign({ key, title, icon, v: R(v) }, o || {}); }

export async function erpFdHead(ctx, payload) {
  const view = String((payload && payload.view) || '');
  const now = monthKey(ctx.now), prev = shiftMonth(now, -1);
  const cards = [];
  const canDues = powerOn(ctx.s, 'dues'), canCost = powerOn(ctx.s, 'costs');
  const owedTotal = async () => { let t = 0, n = 0; for (const v of Object.values(await owedMap(ctx))) if (v > 0.5) { t += v; n++; } return { t, n }; };

  if (view === 'sales' || view === 'orders') {
    const L = await lines(ctx, [prev, now]);
    const cur = sumUp(L.filter((x) => x.month === now)), last = sumUp(L.filter((x) => x.month === prev));
    if (canDues) cards.push(card('revenue', 'Revenue this month', 'taka', cur.revenue, { prev: R(last.revenue), money: true, hero: true }));
    cards.push(card('orders', 'Orders this month', 'cart', cur.orders, { prev: last.orders, hero: !canDues }));
    const o = await owedTotal();
    if (canDues) cards.push(card('dues', 'Dues receivable', 'bell', o.t, { money: true, tone: o.t > 0 ? 'warn' : '', f: 'due', note: o.n + ' invoice(s) owe' }));
    else cards.push(card('duesN', 'Invoices with a due', 'bell', o.n, { tone: o.n ? 'warn' : '', f: 'due' }));
    cards.push(card('units', 'Units sold this month', 'spool', cur.units, { prev: R(last.units) }));
  } else if (view === 'customers') {
    const c = (await ctx.tx`select count(*)::int as n,
                 count(*) filter (where to_char(public.dhaka_date(created_at), 'YYYY-MM') = ${now})::int as fresh,
                 count(*) filter (where to_char(public.dhaka_date(created_at), 'YYYY-MM') = ${prev})::int as fresh_prev
               from customers where business_id = ${ctx.biz}`)[0];
    const b = (await ctx.tx`select count(*) filter (where n >= 1)::int as buyers, count(*) filter (where n >= 2)::int as repeat
               from (select right(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g'), 10) as k, count(*) as n
                     from invoices where business_id = ${ctx.biz} and voided_at is null and invoice_no not like 'RTN-%'
                       and coalesce(customer_phone, '') <> '' group by 1) t`)[0];
    cards.push(card('customers', 'Customers', 'users', c.n, { hero: true, note: 'in the customer list' }));
    cards.push(card('fresh', 'New this month', 'plus', c.fresh, { prev: c.fresh_prev }));
    cards.push(card('repeat', 'Repeat buyers', 'reset', b.buyers ? b.repeat / b.buyers * 100 : 0, { pct: true, note: b.repeat + ' of ' + b.buyers + ' buyers bought twice or more' }));
    const o = await owedTotal();
    if (canDues) cards.push(card('dues', 'Owed by customers', 'bell', o.t, { money: true, tone: o.t > 0 ? 'warn' : '', go: 'sales', f: 'due', note: o.n + ' invoice(s)' }));
    else cards.push(card('duesN', 'Invoices with a due', 'bell', o.n, { tone: o.n ? 'warn' : '', go: 'sales', f: 'due' }));
  } else if (view === 'products' || view === 'stock') {
    const { list } = await products(ctx);
    let value = 0, units = 0, out = 0, low = 0, uncosted = 0;
    for (const p of list) {
      if (/discontinued|inactive/i.test(p.status)) continue;
      if (p.stock > 0) { units += p.stock; if (p.cost > 0) value += p.stock * p.cost; else uncosted++; }
      if (p.stock <= 0) out++; else if (p.stock <= p.reorder) low++;
    }
    if (canCost) cards.push(card('stockValue', 'Stock value at cost', 'box', value, { money: true, hero: true, note: uncosted ? uncosted + ' product(s) in stock without a cost' : list.length + ' products' }));
    cards.push(card('units', 'Units on hand', 'spool', units, { hero: !canCost }));
    cards.push(card('out', 'Out of stock', 'x', out, { tone: out ? 'bad' : '', go: 'products', f: 'out' }));
    cards.push(card('low', 'At or below reorder', 'warn', low, { tone: low ? 'warn' : '', go: 'stock', f: 'plan' }));
  } else if (view === 'expenses' && powerOn(ctx.s, 'expenses')) {
    const { expByCat, expenseUnpaid } = await import('./dashboard.js');
    const a = await expByCat(ctx, now), b = await expByCat(ctx, prev);
    const top = Object.entries(a.byCat).sort((x, y) => y[1] - x[1])[0];
    cards.push(card('expenses', 'Expenses this month', 'receipt', a.total, { prev: R(b.total), money: true, hero: true, flip: true }));
    cards.push(card('unpaid', 'Fixed costs not yet paid', 'clock', await expenseUnpaid(ctx, now), { money: true, tone: 'warn', note: 'this month’s fixed items' }));
    cards.push(card('top', top ? top[0] : 'Biggest category', 'layers', top ? top[1] : 0, { money: true, note: 'biggest category this month' }));
    cards.push(card('last', 'Last month', 'calendar', b.total, { money: true, note: monthLabel(prev) }));
  } else if ((view === 'cash' || view === 'profit') && roleAtLeast(ctx.s.role, 'shareholder')) {
    const p = (await pnlFor(ctx, [prev, now]));
    const [pm, cm] = p;
    if (view === 'profit') {
      cards.push(card('net', 'Net profit this month', 'target', cm.net, { prev: pm.net, money: true, hero: true }));
      cards.push(card('revenue', 'Revenue', 'taka', cm.netSales, { prev: pm.netSales, money: true }));
      cards.push(card('gross', 'Gross profit', 'trend', cm.gross, { prev: pm.gross, money: true, note: cm.grossMargin + '% margin' }));
      cards.push(card('expenses', 'Expenses', 'receipt', cm.expenses, { prev: pm.expenses, money: true, flip: true }));
    } else {
      const { erpCashBook } = await import('./cash.js');
      const cb = await erpCashBook(ctx, {});
      let cin = 0, cprev = 0;
      for (const r of await paymentsTab(ctx)) {
        const amt = num(r[PAY.amount]), meth = str(r[PAY.method]), d = asDate(r[PAY.timestamp]);
        if (!(amt > 0) || NOT_MONEY.test(meth) || !d) continue;
        if (monthKey(d) === now) cin += amt; else if (monthKey(d) === prev) cprev += amt;
      }
      cards.push(card('inHand', 'Money in hand', 'wallet', cb.inHand || 0, { money: true, hero: true, note: (cb.accounts || []).length + ' account(s), courier balance apart' }));
      cards.push(card('cashIn', 'Received this month', 'taka', cin, { prev: R(cprev), money: true }));
      cards.push(card('loose', 'Payments in no account', 'warn', (cb.loose || []).length, { tone: (cb.loose || []).length ? 'warn' : '', note: 'say which account they went to' }));
      const o = await owedTotal();
      cards.push(card('dues', 'Dues receivable', 'bell', o.t, { money: true, tone: o.t > 0 ? 'warn' : '', go: 'sales', f: 'due' }));
    }
  }
  return { view, cards, month: monthLabel(now), prevMonth: monthLabel(prev), currency: 'BDT' };
}

export const HANDLERS = { erpFdDash, erpFdHead };
