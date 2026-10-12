// ERP Navigator (FilaDash merge: the partner's "ERP Mind Map" screen, on our data).
//
//   erpNavigator({ range, filters })  one read-only call with everything the screen draws: the six KPI cards (with the
//                                     previous period), nine modules mapped to our areas with their leaves (each leaf
//                                     says which of our screens opens it), the flows between modules with counts,
//                                     module health, the money flow, what needs action, the filter lists and a
//                                     small search index.
//
// Our formulas, not his: net profit is pnlFor's (the P&L, = erpFdDash), stock value is lotStock's (FIFO, cost book),
// dues are owedMap's, investor figures erpCapital's, checks erpSystemCheck's. The range is whole calendar months
// ('30d' = this month, '90d' = 3 months, '6m', '12m', or {from, to} as yyyy-MM), so net profit is the P&L's.
//
// Roles: every figure a role may not see comes back as { locked: '<why>' } instead of a number - the value never
// leaves the server. cost = the "Product cost" ability, profit = the "Dashboard" ability, dues = "Dues and payments",
// investor = shareholder and up, perm = the screen itself is not open to this person.

import { str } from '../lib/tabs.js';
import { formatDate, num } from '../lib/time.js';
import { powerOn, roleAtLeast, ERP_POWERS } from '../allow.js';
import { products, pnlFor, owedMap, expByCat } from './dashboard.js';
import { lotStock, erpShipments } from './lots.js';
import { holdingConfig } from './holding.js';
import { actionWords } from './security.js';

const MON3 = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const R = (v) => Math.round(num(v));
const monthKey = (d) => formatDate(d, 'yyyy-MM');
const monthLabel = (k) => { const p = k.split('-'); return MON3[Number(p[1]) - 1] + " '" + p[0].slice(2); };
const dayLabel = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
function shiftMonth(key, n) {
  let y = Number(key.slice(0, 4)), m = Number(key.slice(5, 7)) + n;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return y + '-' + (m < 10 ? '0' + m : '' + m);
}
const lc = (v) => str(v).toLowerCase();
const custKey = (phone, name) => { const d = str(phone).replace(/[^0-9]/g, ''); return d.length >= 10 ? d.slice(-10) : (str(name) ? 'n:' + lc(name) : ''); };
const LOCK = (why) => ({ locked: why });

/** A part that may fail (a table this person cannot read, a column not there yet) must not abort the call. */
async function soft(ctx, fn, fallback) {
  try { return await ctx.tx.savepoint(() => fn()); } catch (_) { return fallback; }
}
function countBy(list, f) { const m = {}; for (const x of list) { const k = f(x); if (k === null || k === undefined || k === '') continue; m[k] = (m[k] || 0) + 1; } return m; }
function sortDesc(m) { return Object.entries(m).sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))); }

/** A node of the map. value is a number (or null), display a word when it is not a number; view = our screen. */
function leaf(id, label, value, o) {
  o = o || {};
  const n = { id, label, value: value === undefined ? null : value, icon: o.icon || '', sub: o.sub || '', money: !!o.money, pct: !!o.pct,
              status: o.status || 'ok', view: o.view || '', def: o.def || '', children: o.children || [] };
  if (o.display !== undefined) n.display = o.display;
  if (o.locked) { n.locked = o.locked; n.value = null; n.sub = ''; n.children = []; delete n.display; }
  return n;
}
function kids(prefix, m, o) {
  o = o || {};
  return sortDesc(m).slice(0, o.limit || 6).map(([k, v]) => leaf(prefix + '_' + k.toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40), k, v, { icon: o.icon, money: o.money, view: o.view }));
}

/** The range: whole months ending this month (or `to`), and as many months before it for the comparison. */
function rangeOf(ctx, r) {
  const now = monthKey(ctx.now);
  const N = { '30d': 1, '90d': 3, '6m': 6, '12m': 12 };
  let months = [], key = '30d';
  if (r && typeof r === 'object' && (r.from || r.to)) {
    const fm = String(r.from || '').slice(0, 7), tm = String(r.to || '').slice(0, 7);
    let to = /^\d{4}-(0[1-9]|1[0-2])$/.test(tm) && tm <= now ? tm : now;
    let from = /^\d{4}-(0[1-9]|1[0-2])$/.test(fm) ? fm : to;
    if (from > to) { const t = from; from = to; to = t; }
    for (let m = to, g = 0; m >= from && g < 24; m = shiftMonth(m, -1), g++) months.unshift(m);
    key = 'custom';
  } else {
    key = N[r] ? r : '30d';
    for (let i = N[key] - 1; i >= 0; i--) months.push(shiftMonth(now, -i));
  }
  const n = months.length, prev = [];
  for (let i = n; i >= 1; i--) prev.push(shiftMonth(months[0], -i));
  const lab = (ms) => (ms.length === 1 ? monthLabel(ms[0]) : monthLabel(ms[0]) + ' – ' + monthLabel(ms[ms.length - 1]));
  return { key, months, prev, label: n === 1 && months[0] === now ? 'This month (' + monthLabel(now) + ')' : lab(months), prevLabel: lab(prev),
           from: months[0], to: months[n - 1], now };
}
/** The last moment of a month (yyyy-MM), Dhaka: the first moment of the next month. */
function monthEnd(m) { const n = shiftMonth(m, 1); return new Date(n + '-01T00:00:00+06:00'); }

// ------------------------------------------------------------------------------------------------ the call

export async function erpNavigator(ctx, payload) {
  payload = payload || {};
  const s = ctx.s;
  const can = {
    profit: powerOn(s, 'dash'),                      // net / gross profit (the dashboard's money)
    pnl: powerOn(s, 'profit'),                       // the Profitability screen, Analytics, System check
    cost: powerOn(s, 'costs'),                       // buying prices, stock value, shipments
    dues: powerOn(s, 'dues'),                        // what customers owe, invoice money
    expenses: powerOn(s, 'expenses'),
    suppliers: powerOn(s, 'suppliers'),
    stock: powerOn(s, 'stock'),
    investors: roleAtLeast(s.role, 'shareholder'),
    manager: roleAtLeast(s.role, 'manager'),
    owner: s.role === 'owner',
  };
  const RG = rangeOf(ctx, payload.range);
  const inR = (d) => d && RG.months.includes(monthKey(new Date(d)));
  const inP = (d) => d && RG.prev.includes(monthKey(new Date(d)));
  const rangeEnd = monthEnd(RG.to), prevEnd = monthEnd(RG.prev[RG.prev.length - 1]);

  // ---------------------------------------------------------------- base data
  const { list: allProducts } = await products(ctx);
  const live = allProducts.filter((p) => !/discontinued/i.test(p.status));
  const lots = await soft(ctx, () => ctx.tx`
    select l.reference, l.source, l.received_at, l.qty_in, l.qty_left, l.unit_cost, lower(p.sku) as sku
    from stock_lots l join products p on p.id = l.product_id where l.business_id = ${ctx.biz}`, []);
  const funding = can.investors ? await soft(ctx, () => ctx.tx`
    select f.holder_no, f.reference, f.pct, f.at, h.name, h.private from lot_funding f
    left join capital_holders h on h.business_id = f.business_id and h.holder_no = f.holder_no
    where f.business_id = ${ctx.biz} and f.voided_at is null`, []) : [];
  const holders = can.investors ? await soft(ctx, () => ctx.tx`
    select holder_no, name, kind, private, ended_month from capital_holders where business_id = ${ctx.biz} order by seq`, []) : [];
  const invoices = await soft(ctx, () => ctx.tx`
    select id, invoice_no, created_at, coalesce(nullif(btrim(channel), ''), nullif(btrim(source), ''), 'Walk-in') as src, grand_total,
           customer_name, customer_phone
    from invoices where business_id = ${ctx.biz} and voided_at is null order by created_at`, []);
  const lines = await soft(ctx, () => ctx.tx`
    select l.invoice_id, lower(coalesce(l.sku, '')) as sku, l.qty from invoice_lines l join invoices i on i.id = l.invoice_id
    where l.business_id = ${ctx.biz} and i.voided_at is null`, []);
  const owed = await soft(ctx, () => owedMap(ctx), {});

  // ---------------------------------------------------------------- filters
  const F0 = payload.filters && typeof payload.filters === 'object' ? payload.filters : {};
  const F = {};
  for (const k of ['brand', 'type', 'category', 'investor', 'shipment', 'source']) if (str(F0[k])) F[k] = str(F0[k]);
  if (F.investor && !can.investors) delete F.investor;            // the Investor filter is not open below shareholder
  if (F.investor && String(ctx.s.role) !== 'owner') {               // a private investor's shipments are the owner's to see
    const pv = await ctx.tx`select 1 from capital_holders where business_id = ${ctx.biz} and holder_no = ${F.investor} and private`;
    if (pv.length) delete F.investor;
  }
  const itemF = !!(F.brand || F.type || F.category);
  const items = live.filter((p) => (!F.brand || lc(p.brand) === lc(F.brand)) && (!F.type || lc(p.type) === lc(F.type)) && (!F.category || lc(p.cat) === lc(F.category)));
  const itemSet = new Set(items.map((p) => p.sku.toLowerCase()));
  let refSet = null;
  if (F.shipment) refSet = new Set([F.shipment]);
  if (F.investor) {
    const mine = new Set(funding.filter((f) => str(f.holder_no) === F.investor).map((f) => str(f.reference)));
    refSet = refSet ? new Set([...refSet].filter((x) => mine.has(x))) : mine;
  }
  const lotF = !!refSet;
  const fLots = lots.filter((l) => itemSet.has(str(l.sku)) && (!refSet || refSet.has(str(l.reference))));
  let lotInvoices = null;
  if (lotF) {
    const refs = [...refSet];
    lotInvoices = new Set((await soft(ctx, () => ctx.tx`
      select distinct m.invoice_id from lot_draws d join stock_lots l on l.id = d.lot_id join stock_movements m on m.id = d.movement_id
      where d.business_id = ${ctx.biz} and m.invoice_id is not null and l.reference = any(${refs})`, [])).map((r) => r.invoice_id));
  }
  const linesBy = {};
  for (const l of lines) (linesBy[l.invoice_id] = linesBy[l.invoice_id] || []).push(l);
  const ordF = !!(F.source || itemF || lotF);
  const okInv = (i) => (!F.source || lc(i.src) === lc(F.source)) && (!itemF || (linesBy[i.id] || []).some((l) => itemSet.has(l.sku))) && (!lotInvoices || lotInvoices.has(i.id));
  const sales = invoices.filter((i) => !/^RTN-/.test(str(i.invoice_no)) && okInv(i));
  const returns = invoices.filter((i) => /^RTN-/.test(str(i.invoice_no)));
  const salesR = sales.filter((i) => inR(i.created_at)), salesP = sales.filter((i) => inP(i.created_at));
  const unitsOf = (list) => list.reduce((t, i) => t + (linesBy[i.id] || []).reduce((u, l) => u + (num(l.qty) > 0 && (!itemF || itemSet.has(l.sku)) ? num(l.qty) : 0), 0), 0);

  // ---------------------------------------------------------------- the money that the KPI strip and modules share
  const pnlMonths = Array.from(new Set(RG.prev.concat(RG.months))).sort();
  const pnl = can.profit || can.dues ? await soft(ctx, () => pnlFor(ctx, pnlMonths), null) : null;
  const add = (ms, k) => (pnl ? pnl.filter((x) => ms.includes(x.month)).reduce((t, x) => t + num(x[k]), 0) : 0);
  const P = pnl ? { net: add(RG.months, 'net'), netPrev: add(RG.prev, 'net'), rev: add(RG.months, 'netSales'), revPrev: add(RG.prev, 'netSales'),
                    gross: add(RG.months, 'gross'), grossPrev: add(RG.prev, 'gross'), cost: add(RG.months, 'cost'), exp: add(RG.months, 'expenses'),
                    courier: add(RG.months, 'courier'), delivery: add(RG.months, 'delivery'), sales: add(RG.months, 'sales'), returns: add(RG.months, 'returns'),
                    courierExtra: add(RG.months, 'courierExtra'), courierShort: add(RG.months, 'courierShort'), service: add(RG.months, 'serviceIncome') - add(RG.months, 'serviceParts'),
                    forfeited: add(RG.months, 'forfeited') } : null;
  const LS = can.cost ? await soft(ctx, () => lotStock(ctx), null) : null;
  const capital = can.investors ? await soft(ctx, async () => (await import('./capital.js')).erpCapital(ctx), null) : null;
  const sysCheck = can.pnl ? await soft(ctx, async () => (await import('./insight.js')).erpSystemCheck(ctx), null) : null;
  const ship = can.cost ? await soft(ctx, () => erpShipments(ctx), null) : null;

  // open purchase orders (Planned / Ordered / In transit), as they stand at a moment
  const poRows = can.cost || can.suppliers || can.stock ? await soft(ctx, () => ctx.tx`
    select l.po_no, min(l.ordered_at) as ordered_at, max(l.closed_at) as closed_at, bool_or(l.status = 'open') as open, max(l.supplier) as supplier,
           sum(l.qty) as qty, sum(l.received) as received, max(st.stage) as stage, max(st.eta) as eta
    from po_lines l left join po_stages st on st.business_id = l.business_id and st.po_no = l.po_no
    where l.business_id = ${ctx.biz} group by l.po_no`, []) : null;
  const pendingAt = (when, isNow) => (poRows || []).filter((p) => {
    if (new Date(p.ordered_at) > when) return false;
    if (isNow) return p.open && str(p.stage) !== 'received';
    return p.open || (p.closed_at && new Date(p.closed_at) > when);
  });
  const isNowRange = RG.to === RG.now;
  const pendNow = pendingAt(isNowRange ? ctx.now : rangeEnd, isNowRange), pendPrev = pendingAt(prevEnd, false);

  // low stock: at or below its reorder level and still selling (sold in 90 days) or still on the shelf
  const sold90 = new Set();
  const cut90 = ctx.now.getTime() - 90 * 864e5;
  for (const i of sales) if (new Date(i.created_at).getTime() >= cut90) for (const l of linesBy[i.id] || []) sold90.add(l.sku);
  const low = items.filter((p) => p.stock <= p.reorder && (p.stock > 0 || sold90.has(p.sku.toLowerCase()))).sort((a, b) => a.stock - b.stock || a.name.localeCompare(b.name));

  // dues and open orders
  const due = (i) => num(owed[str(i.invoice_no)]);
  const openOrders = sales.filter((i) => due(i) > 0.5);
  const duesTotal = openOrders.reduce((t, i) => t + due(i), 0);

  // ---------------------------------------------------------------- KPI strip (range only, like his)
  const kpis = [];
  kpis.push(can.cost && LS ? { key: 'stockValue', label: 'Total stock value', icon: 'box', v: R(LS.value), money: true, go: 'products',
                               note: R(LS.units).toLocaleString('en-US') + ' units on hand' + (LS.uncosted ? ' · ' + LS.uncosted + ' without a cost' : ''),
                               calc: [['What is left in each stock lot × that lot’s landed cost (FIFO); stock from before lots at the cost book’s price', R(LS.value)]] }
    : { key: 'stockValue', label: 'Total stock value', icon: 'box', locked: 'cost' });
  kpis.push(can.profit && P ? { key: 'net', label: 'Net profit · ' + RG.label, icon: 'target', v: R(P.net), prev: R(P.netPrev), money: true, go: 'profit',
                                calc: [['Gross profit', R(P.gross)], ['+ Delivery charged to customers', R(P.delivery)], ['+ Courier paid more than expected', R(P.courierExtra)],
                                       ['− Courier paid less (written off)', -R(P.courierShort)], ['− Courier delivery + COD fees', -R(P.courier)], ['+ Repairs income − parts', R(P.service)],
                                       ['+ Pre-order deposits kept on cancelling', R(P.forfeited)], ['− Expenses', -R(P.exp)], ['= Net profit (same as Profit & loss)', R(P.net)]] }
    : { key: 'net', label: 'Net profit · ' + RG.label, icon: 'target', locked: 'profit' });
  kpis.push(poRows ? { key: 'pending', label: 'Pending shipments', icon: 'truck', v: pendNow.length, prev: pendPrev.length, go: can.cost ? 'shipments' : 'suppliers',
                       note: pendNow.filter((p) => str(p.stage) === 'in_transit').length + ' in transit',
                       calc: pendNow.slice(0, 12).map((p) => [str(p.po_no) + (p.supplier ? ' · ' + str(p.supplier) : '') + ' · ' + (str(p.stage) || 'ordered').replace('_', ' '), 1]).concat([['Purchase orders not received at ' + RG.label.replace(/^This month \((.*)\)$/, 'today'), pendNow.length]]) }
    : { key: 'pending', label: 'Pending shipments', icon: 'truck', locked: 'perm' });
  kpis.push({ key: 'low', label: 'Low-stock alerts', icon: 'warn', v: low.length, go: 'stock', f: 'plan', tone: low.length ? 'warn' : '', note: 'at or below the reorder level',
              calc: low.slice(0, 14).map((p) => [p.name + ' · on hand ' + p.stock + ', reorder at ' + p.reorder, p.stock]).concat([['Products to reorder', low.length]]) });
  const payout = capital ? R(num(capital.totals.returnDue) - num(capital.totals.returnPaid)) : 0;
  const owingInv = capital ? capital.holders.filter((h) => h.kind === 'investor' && h.returnOwed > 0) : [];
  kpis.push(capital ? { key: 'payout', label: 'Investor payout due', icon: 'wallet', v: payout, money: true, go: 'capital', tone: payout > 0 ? 'warn' : '',
                        note: owingInv.length + ' investor(s) · months that are over',
                        calc: owingInv.map((h) => [h.name + ' · return owed', h.returnOwed]).concat([['Returns due for months that are over − returns paid', payout]]) }
    : { key: 'payout', label: 'Investor payout due', icon: 'wallet', locked: 'investor' });
  kpis.push({ key: 'open', label: 'Open orders', icon: 'cart', v: openOrders.length, go: 'sales', f: 'due', note: can.dues ? 'BDT ' + R(duesTotal).toLocaleString('en-US') + ' still due' : 'invoices with a due',
              calc: can.dues ? openOrders.slice(-14).reverse().map((i) => [str(i.invoice_no) + ' · ' + str(i.customer_name), R(due(i))]).concat([['Still due on ' + openOrders.length + ' invoice(s)', R(duesTotal)]]) : null });

  // ---------------------------------------------------------------- modules
  const mods = {};
  const checks = sysCheck ? sysCheck.checks : [];
  const areaChecks = (areas) => checks.filter((c) => areas.includes(c.area));

  // Inventory & Catalog
  {
    const brands = countBy(items, (p) => p.brand || '-'), types = countBy(items, (p) => p.type || '-'), cats = countBy(items, (p) => p.cat || 'Uncategorised');
    const units = items.reduce((t, p) => t + Math.max(0, p.stock), 0);
    const openLots = fLots.filter((l) => num(l.qty_left) > 0);
    const out = items.filter((p) => p.stock <= 0).length, noCost = items.filter((p) => p.stock > 0 && !(p.cost > 0)).length;
    let value = null;
    if (LS) value = items.reduce((t, p) => t + num((LS.bySku[p.sku.toLowerCase()] || {}).value), 0);
    const byValue = LS ? items.map((p) => [p.name, num((LS.bySku[p.sku.toLowerCase()] || {}).value)]).filter((x) => x[1] > 0).sort((a, b) => b[1] - a[1]).slice(0, 5) : [];
    mods.inventory = { count: items.length, sub: R(units).toLocaleString('en-US') + ' units on hand', view: 'products',
      calc: [['Products in the filters (not discontinued)', items.length], ['Units on hand', R(units)]],
      children: [
        leaf('inv_brands', 'Brands', Object.keys(brands).length, { icon: 'tag', sub: sortDesc(brands).slice(0, 3).map((x) => x[0]).join(', '), view: 'products', children: kids('inv_brand', brands, { icon: 'tag', view: 'products' }) }),
        leaf('inv_types', 'Types', Object.keys(types).length, { icon: 'spool', sub: sortDesc(types).slice(0, 3).map((x) => x[0]).join(', '), view: 'products', children: kids('inv_type', types, { icon: 'spool', view: 'products' }) }),
        leaf('inv_cats', 'Categories', Object.keys(cats).length, { icon: 'layers', sub: sortDesc(cats).slice(0, 3).map((x) => x[0]).join(', '), view: 'products', children: kids('inv_cat', cats, { icon: 'layers', view: 'products' }) }),
        leaf('inv_units', 'Units on hand', R(units), { icon: 'box', sub: openLots.length + ' open lots', view: 'stock', children: [
          leaf('inv_lots_open', 'Open stock lots', openLots.length, { icon: 'box', view: can.cost ? 'shipments' : 'stock' }),
          leaf('inv_out', 'Out of stock', out, { icon: 'x', status: out ? 'warn' : 'ok', view: 'products' }),
          leaf('inv_nocost', 'In stock without a cost', noCost, { icon: 'tag', status: noCost ? 'warn' : 'ok', view: 'costs', locked: can.cost ? '' : 'cost' })] }),
        leaf('inv_low', 'Low or out', low.length, { icon: 'warn', status: low.length ? 'warn' : 'ok', sub: low.length ? 'Reorder level reached' : 'All above reorder level', view: 'stock',
          children: low.slice(0, 6).map((p) => leaf('inv_low_' + p.sku.toLowerCase(), p.name, p.stock, { icon: 'spool', view: 'stock' })) }),
        leaf('inv_value', 'Stock value', value === null ? null : R(value), { icon: 'taka', money: true, sub: 'FIFO, at landed cost', view: 'products', locked: LS ? '' : 'cost',
          children: byValue.map((x, i) => leaf('inv_v_' + i, x[0], R(x[1]), { icon: 'box', money: true, view: 'products' })) }),
      ],
      minis: [{ label: 'Units on hand', v: R(units) }, LS ? { label: 'Stock value', v: R(value), money: true } : { label: 'Stock value', locked: 'cost' }, { label: 'Low-stock alerts', v: low.length }],
      chart: { title: 'Products by category', items: sortDesc(cats).slice(0, 6).map(([label, v]) => ({ label, value: v })) },
      data: { columns: ['Product', 'On hand', 'Reorder at'], rows: items.slice().sort((a, b) => b.stock - a.stock).slice(0, 30).map((p) => [p.name, p.sku, R(p.stock), R(p.reorder)]), view: 'products', sub: true },
    };
  }

  // Orders, Invoice & Sales
  {
    const src = countBy(salesR, (i) => str(i.src));
    const pay = { Paid: 0, 'Part paid': 0, Unpaid: 0 };
    for (const i of salesR) { const d = due(i), g = num(i.grand_total); if (d <= 0.5) pay.Paid++; else if (d >= g - 0.5) pay.Unpaid++; else pay['Part paid']++; }
    const pre = await soft(ctx, () => ctx.tx`select no, customer, status, eta from preorders where business_id = ${ctx.biz} and status = 'open' order by created_at`, []);
    const quotes = await soft(ctx, () => ctx.tx`select count(*) filter (where status = 'Draft')::int as drafts,
                                                 count(*) filter (where to_char(public.dhaka_date(created_at), 'YYYY-MM') = any(${RG.months}))::int as in_range
                                               from quotations where business_id = ${ctx.biz}`, [{ drafts: 0, in_range: 0 }]);
    const web = can.manager ? await soft(ctx, () => ctx.tx`select count(*)::int as n from web_orders where business_id = ${ctx.biz} and not entered and invoice_id is null`, [{ n: 0 }]) : null;
    const retR = returns.filter((i) => inR(i.created_at));
    const invoiced = salesR.reduce((t, i) => t + num(i.grand_total), 0);
    const latest = salesR.slice(-4).reverse();
    mods.orders = { count: salesR.length, sub: (can.dues ? 'BDT ' + R(invoiced).toLocaleString('en-US') + ' invoiced · ' : '') + RG.label, view: 'sales', ranged: true,
      calc: [['Invoices in ' + RG.label + (ordF ? ' (filtered)' : ''), salesR.length]].concat(can.dues ? [['Their totals', R(invoiced)]] : []),
      children: [
        leaf('ord_sources', 'Order sources', Object.keys(src).length, { icon: 'globe', sub: sortDesc(src).slice(0, 2).map((x) => x[0] + ' ' + x[1]).join(' · '), view: 'sales', children: kids('ord_src', src, { icon: 'globe', view: 'sales' }) }),
        leaf('ord_payment', 'Payment status', pay.Unpaid + pay['Part paid'], { icon: 'wallet', sub: pay.Paid + ' paid · rest open', status: pay.Unpaid ? 'warn' : 'ok', view: 'sales',
          children: Object.entries(pay).filter((x) => x[1]).map(([k, v]) => leaf('ord_pay_' + k.toLowerCase().replace(/ /g, '-'), k, v, { icon: 'wallet', view: 'sales' })) }),
        leaf('ord_invoices', 'Invoices', salesR.length, { icon: 'receipt', sub: latest[0] ? 'Latest ' + str(latest[0].invoice_no) : 'None in range', view: 'sales',
          children: latest.map((i) => can.dues ? leaf('ord_inv_' + str(i.invoice_no), str(i.invoice_no), R(i.grand_total), { icon: 'receipt', money: true, view: 'sales' })
            : leaf('ord_inv_' + str(i.invoice_no), str(i.invoice_no), null, { icon: 'receipt', display: dayLabel(i.created_at), view: 'sales' })) }),
        leaf('ord_pre', 'Pre-orders & quotes', pre.length + num(quotes[0].in_range), { icon: 'calendar', sub: pre.length + ' pre-orders · ' + num(quotes[0].in_range) + ' quotes', view: 'preorders',
          children: pre.slice(0, 5).map((p) => leaf('ord_po_' + str(p.no), str(p.no), null, { icon: 'calendar', display: p.eta ? dayLabel(p.eta) : 'open', view: 'preorders' }))
            .concat([leaf('ord_quotes', 'Quotations', num(quotes[0].in_range), { icon: 'tag', sub: num(quotes[0].drafts) + ' drafts', view: 'quotes' })]) }),
        leaf('ord_attention', 'Web orders & returns', (web ? num(web[0].n) : 0) + retR.length, { icon: 'warn', status: web && num(web[0].n) ? 'warn' : 'ok',
          sub: (web ? num(web[0].n) + ' web orders waiting · ' : '') + retR.length + ' returned', view: web && num(web[0].n) ? 'weborders' : 'sales',
          children: (web ? [leaf('ord_web', 'Website orders not entered', num(web[0].n), { icon: 'globe', status: num(web[0].n) ? 'warn' : 'ok', view: 'weborders' })] : [])
            .concat([leaf('ord_ret', 'Goods returned', retR.length, { icon: 'reset', view: 'sales' })]) }),
      ],
      minis: [P && (can.dues || can.profit) ? { label: 'Revenue', v: R(P.rev), money: true } : { label: 'Revenue', locked: 'dues' }, { label: 'Orders', v: salesR.length }, can.dues ? { label: 'Dues', v: R(duesTotal), money: true } : { label: 'Dues', locked: 'dues' }],
      chart: { title: 'Invoices by month', items: RG.months.slice(-6).map((m) => ({ label: monthLabel(m), value: sales.filter((i) => monthKey(new Date(i.created_at)) === m).length })) },
      data: { columns: ['Invoice', 'Date', 'Customer'].concat(can.dues ? ['Total', 'Due'] : []), rows: salesR.slice(-30).reverse().map((i) => [str(i.invoice_no), dayLabel(i.created_at), str(i.customer_name)].concat(can.dues ? [R(i.grand_total), R(due(i))] : [])), view: 'sales', param: 0 },
    };
  }

  // Customers & CRM
  {
    const custs = await soft(ctx, () => ctx.tx`select name, phone, customer_key, coalesce(nullif(btrim(source), ''), 'Not said') as source, created_at from customers where business_id = ${ctx.biz}`, []);
    const byKey = {}, first = {}, orders = {}, dueBy = {};
    for (const c of custs) { const k = custKey(c.phone, c.name); if (k) byKey[k] = c; }
    for (const i of sales) {
      const k = custKey(i.customer_phone, i.customer_name); if (!k) continue;
      orders[k] = (orders[k] || 0) + 1;
      if (!first[k] || new Date(i.created_at) < first[k].at) first[k] = { at: new Date(i.created_at), name: str(i.customer_name) };
      if (due(i) > 0.5) dueBy[k] = (dueBy[k] || 0) + due(i);
    }
    const nameOf = (k) => (byKey[k] ? str(byKey[k].name) : (first[k] && first[k].name) || k);
    const keys = ordF ? Object.keys(orders) : Array.from(new Set(Object.keys(byKey).concat(Object.keys(orders))));
    const buying = new Set(salesR.map((i) => custKey(i.customer_phone, i.customer_name)).filter(Boolean));
    const repeat = keys.filter((k) => (orders[k] || 0) > 1).sort((a, b) => orders[b] - orders[a]);
    const fresh = keys.filter((k) => first[k] && inR(first[k].at));
    const dues = keys.filter((k) => dueBy[k] > 0.5).sort((a, b) => dueBy[b] - dueBy[a]);
    const fol = await soft(ctx, () => ctx.tx`select customer, due_on, customer_key from customer_followups where business_id = ${ctx.biz} and status = 'open'
                                             and due_on <= (now() at time zone 'Asia/Dhaka')::date + 7 order by due_on`, []);
    const today = formatDate(ctx.now, 'yyyy-MM-dd');
    const overdue = fol.filter((f) => formatDate(new Date(f.due_on), 'yyyy-MM-dd') < today).length;
    const srcs = countBy(keys.map((k) => byKey[k]).filter(Boolean), (c) => str(c.source));
    mods.customers = { count: keys.length, sub: buying.size + ' bought · ' + RG.label, view: 'customers',
      calc: [['Customers (one per phone number)' + (ordF ? ', who bought in the filters' : ''), keys.length], ['Bought in ' + RG.label, buying.size]],
      children: [
        leaf('cus_repeat', 'Repeat buyers', repeat.length, { icon: 'heart', sub: 'More than one order', view: 'customers', children: repeat.slice(0, 4).map((k) => leaf('cus_r_' + k, nameOf(k), orders[k], { icon: 'user', sub: 'orders', view: 'customers' })) }),
        leaf('cus_new', 'New · ' + RG.label, fresh.length, { icon: 'sparkle', sub: 'First purchase in range', view: 'customers', children: fresh.slice(-4).reverse().map((k) => leaf('cus_n_' + k, nameOf(k), null, { icon: 'user', display: dayLabel(first[k].at), view: 'customers' })) }),
        leaf('cus_dues', 'Customers with dues', dues.length, { icon: 'bell', status: dues.length ? 'warn' : 'ok', sub: can.dues ? 'BDT ' + R(dues.reduce((t, k) => t + dueBy[k], 0)).toLocaleString('en-US') + ' due' : 'owe money', view: 'customers',
          children: dues.slice(0, 4).map((k) => can.dues ? leaf('cus_d_' + k, nameOf(k), R(dueBy[k]), { icon: 'user', money: true, view: 'customers' }) : leaf('cus_d_' + k, nameOf(k), null, { icon: 'user', display: 'owes', view: 'customers' })) }),
        leaf('cus_follow', 'Follow-ups', fol.length, { icon: 'clock', status: overdue ? 'warn' : 'ok', sub: overdue ? overdue + ' overdue · within 7 days' : 'Due within 7 days', view: 'customers',
          children: fol.slice(0, 4).map((f, i) => leaf('cus_f_' + i, str(f.customer), null, { icon: 'user', display: dayLabel(f.due_on), view: 'customers' })) }),
        leaf('cus_src', 'Came from', Object.keys(srcs).length, { icon: 'globe', sub: sortDesc(srcs).slice(0, 2).map((x) => x[0]).join(', '), view: 'customers', children: kids('cus_s', srcs, { icon: 'globe', limit: 5, view: 'customers' }) }),
      ],
      minis: [can.dues ? { label: 'Dues receivable', v: R(duesTotal), money: true } : { label: 'Dues receivable', locked: 'dues' }, { label: 'Repeat buyers', v: repeat.length }, { label: 'Open orders', v: openOrders.length }],
      chart: { title: 'New and returning buyers · ' + RG.label, items: [{ label: 'New', value: [...buying].filter((k) => first[k] && inR(first[k].at)).length }, { label: 'Returning', value: [...buying].filter((k) => !(first[k] && inR(first[k].at))).length }] },
      data: { columns: ['Customer', 'Orders'].concat(can.dues ? ['Due'] : []), rows: (dues.length ? dues : repeat).slice(0, 30).map((k) => [nameOf(k), byKey[k] ? str(byKey[k].phone) : '', orders[k] || 0].concat(can.dues ? [R(dueBy[k] || 0)] : [])), view: 'customers', sub: true },
    };
  }

  // Procurement & Shipments
  const procOpen = can.cost || can.suppliers || can.stock;
  if (procOpen) {
    const refs = {};
    for (const l of fLots) {
      if (l.source !== 'receive') continue;
      const r = str(l.reference) || '(no reference)', x = refs[r] || (refs[r] = { ref: r, at: l.received_at, units: 0, left: 0 });
      if (l.received_at < x.at) x.at = l.received_at;
      x.units += num(l.qty_in); x.left += num(l.qty_left);
    }
    const rec = Object.values(refs).sort((a, b) => new Date(b.at) - new Date(a.at));
    const recLots = fLots.filter((l) => l.source === 'receive');
    const open = (poRows || []).filter((p) => p.open && str(p.stage) !== 'received' && (!F.shipment || str(p.po_no) === F.shipment));
    const sup = can.suppliers ? await soft(ctx, () => ctx.tx`select name from suppliers where business_id = ${ctx.biz} order by name`, []) : null;
    const owe = can.suppliers ? await soft(ctx, () => ctx.tx`select
        (select coalesce(sum(amount), 0) from supplier_bills where business_id = ${ctx.biz} and coalesce(btrim(voided), '') = '') -
        (select coalesce(sum(amount), 0) from supplier_payments where business_id = ${ctx.biz} and coalesce(btrim(voided), '') = '') as owe`, [{ owe: 0 }]) : null;
    const stageWord = { planned: 'Planned', ordered: 'Ordered', in_transit: 'On the way' };
    mods.procurement = { count: rec.length + open.length, sub: open.length + ' open · ' + rec.length + ' received', view: can.cost ? 'shipments' : can.suppliers ? 'suppliers' : 'stock',
      calc: [['Shipments received (by reference)', rec.length], ['Purchase orders not received yet', open.length]],
      children: [
        leaf('prc_open', 'Ordered & on the way', open.length, { icon: 'truck', sub: open.filter((p) => str(p.stage) === 'in_transit').length + ' on the way', view: can.suppliers ? 'suppliers' : 'stock',
          children: open.slice(0, 6).map((p) => leaf('prc_o_' + str(p.po_no), str(p.po_no), null, { icon: 'ship', display: (stageWord[str(p.stage)] || 'Ordered') + (p.eta ? ' · ' + formatDate(new Date(p.eta), 'd MMM') : ''), view: can.suppliers ? 'suppliers' : 'stock' })) }),
        leaf('prc_received', 'Received', rec.length, { icon: 'check', sub: rec[0] ? 'Latest ' + rec[0].ref : '—', view: can.cost ? 'shipments' : 'stock',
          children: rec.slice(0, 4).map((x) => leaf('prc_r_' + x.ref, x.ref, null, { icon: 'ship', display: formatDate(new Date(x.at), 'd MMM'), view: can.cost ? 'shipments' : 'stock' })) }),
        leaf('prc_lots', 'Lots created', recLots.length, { icon: 'box', sub: recLots.filter((l) => num(l.qty_left) > 0).length + ' still have stock', view: can.cost ? 'shipments' : 'stock', children: [
          leaf('prc_l_open', 'With stock left', recLots.filter((l) => num(l.qty_left) > 0).length, { icon: 'box' }),
          leaf('prc_l_ex', 'Sold out', recLots.filter((l) => num(l.qty_left) <= 0).length, { icon: 'box' }),
          leaf('prc_l_open0', 'Stock from before lots', fLots.filter((l) => l.source === 'opening').length, { icon: 'box' })] }),
        leaf('prc_suppliers', 'Suppliers', sup ? sup.length : null, { icon: 'store', sub: sup ? sup.slice(0, 2).map((x) => str(x.name)).join(', ') : '', view: 'suppliers', locked: sup ? '' : 'perm',
          children: (sup || []).slice(0, 5).map((x, i) => leaf('prc_s_' + i, str(x.name), null, { icon: 'store', display: 'supplier', view: 'suppliers' })) }),
        leaf('prc_owe', 'We owe suppliers', owe ? R(owe[0].owe) : null, { icon: 'taka', money: true, status: owe && num(owe[0].owe) > 0 ? 'warn' : 'ok', sub: 'Bills − payments', view: 'suppliers', locked: owe ? '' : 'perm' }),
      ],
      minis: [{ label: 'Pending', v: pendNow.length }, { label: 'Units on the way', v: R(open.reduce((t, p) => t + Math.max(0, num(p.qty) - num(p.received)), 0)) },
              ship ? { label: 'Landed (received)', v: R(ship.totals.landed), money: true } : { label: 'Landed (received)', locked: 'cost' }],
      chart: { title: 'Purchase orders by stage', items: [['Planned', 'planned'], ['Ordered', 'ordered'], ['On the way', 'in_transit']].map(([label, k]) => ({ label, value: open.filter((p) => (str(p.stage) || 'ordered') === k).length })).concat([{ label: 'Received', value: rec.length }]) },
      data: { columns: ['Shipment', 'Received', 'Units in', 'Left'], rows: rec.slice(0, 30).map((x) => [x.ref, dayLabel(x.at), R(x.units), R(x.left)]), view: can.cost ? 'shipments' : 'stock' },
    };
  } else mods.procurement = { locked: 'perm' };

  // Analytics & Forecasting
  if (can.pnl) {
    const revPct = P && P.revPrev ? Math.round((P.rev - P.revPrev) / Math.abs(P.revPrev) * 1000) / 10 : null;
    const roiList = ship ? ship.shipments.filter((x) => !x.opening && x.landed > 0) : [];
    const roiBest = roiList.length ? roiList[0] : null;
    const roiPct = roiBest ? Math.round(roiBest.net / roiBest.landed * 1000) / 10 : null;
    const dead = await soft(ctx, () => ctx.tx`select count(*)::int as n from stock_lots l where l.business_id = ${ctx.biz} and l.qty_left > 0 and l.received_at < now() - interval '90 days'
                                            and not exists (select 1 from lot_draws d where d.lot_id = l.id and d.qty > 0 and d.at > now() - interval '60 days')`, [{ n: 0 }]);
    const colours = await soft(ctx, () => ctx.tx`select coalesce(nullif(btrim(p.color), ''), 'No colour') as c, sum(l.qty) as units
                                               from invoice_lines l join invoices i on i.id = l.invoice_id left join products p on p.id = l.product_id
                                               where l.business_id = ${ctx.biz} and i.voided_at is null and i.created_at > now() - interval '90 days' and l.pool_id is null
                                               group by 1 order by 2 desc limit 6`, []);
    const unitsR = unitsOf(salesR);
    const margin = P && P.rev > 0 ? Math.round(P.gross / P.rev * 1000) / 10 : 0;
    mods.analytics = { count: revPct, display: revPct === null ? '—' : (revPct >= 0 ? '+' : '−') + Math.abs(revPct) + '%', sub: 'Revenue vs ' + RG.prevLabel, view: 'analytics',
      calc: P ? [['Revenue ' + RG.label, R(P.rev)], ['Revenue ' + RG.prevLabel, R(P.revPrev)], ['Change', revPct === null ? 0 : revPct]] : [],
      children: [
        leaf('an_growth', 'Monthly growth', null, { icon: 'trend', display: revPct === null ? '—' : (revPct >= 0 ? '+' : '−') + Math.abs(revPct) + '%', sub: 'Revenue vs ' + RG.prevLabel, view: 'analytics', children: [
          leaf('an_g_rev', 'Revenue', P ? R(P.rev) : null, { icon: 'taka', money: true, view: 'profit' }),
          leaf('an_g_ord', 'Orders', salesR.length, { icon: 'cart', view: 'sales' }),
          leaf('an_g_units', 'Units sold', R(unitsR), { icon: 'spool', view: 'sales' })] }),
        leaf('an_profit', 'Profit & margin', P ? R(P.net) : null, { icon: 'target', money: true, sub: 'Net profit · ' + RG.label, view: 'profit', locked: can.profit && P ? '' : 'profit', children: [
          leaf('an_p_gross', 'Gross profit', P ? R(P.gross) : null, { icon: 'trend', money: true, view: 'profit' }),
          leaf('an_p_gm', 'Gross margin', margin, { icon: 'percent', pct: true, view: 'profit' }),
          leaf('an_p_net', 'Net profit', P ? R(P.net) : null, { icon: 'target', money: true, view: 'profit' })] }),
        leaf('an_roi', 'Shipment ROI', roiPct, { icon: 'ship', pct: true, sub: roiBest ? roiBest.reference + ' · after holding' : 'No shipment yet', view: 'analytics', locked: ship ? '' : 'cost' }),
        leaf('an_reorder', 'Reorder & dead stock', low.length, { icon: 'reset', status: low.length ? 'warn' : 'ok', sub: num(dead[0].n) + ' dead-stock lots', view: 'stock',
          children: low.slice(0, 4).map((p) => leaf('an_r_' + p.sku.toLowerCase(), p.name, p.stock, { icon: 'spool', sub: 'on hand', view: 'stock' })) }),
        leaf('an_colours', 'Top colours', colours.length, { icon: 'palette', sub: colours.slice(0, 2).map((c) => str(c.c)).join(', ') + ' · 90 days', view: 'analytics',
          children: colours.slice(0, 5).map((c, i) => leaf('an_c_' + i, str(c.c), R(c.units), { icon: 'palette', view: 'analytics' })) }),
      ],
      minis: [P ? { label: 'Revenue', v: R(P.rev), money: true } : { label: 'Revenue', locked: 'profit' }, can.profit && P ? { label: 'Net profit', v: R(P.net), money: true } : { label: 'Net profit', locked: 'profit' },
              can.profit && P ? { label: 'Gross margin', v: margin, pct: true } : { label: 'Gross margin', locked: 'profit' }],
      chart: pnl ? { title: 'Revenue by month', money: true, items: pnl.filter((x) => RG.months.includes(x.month)).slice(-12).map((x) => ({ label: monthLabel(x.month), value: R(x.netSales) })) } : null,
      data: pnl ? { columns: ['Month', 'Revenue'].concat(can.profit ? ['Gross', 'Net'] : []), rows: pnl.filter((x) => RG.months.includes(x.month)).reverse().map((x) => [monthLabel(x.month), R(x.netSales)].concat(can.profit ? [R(x.gross), R(x.net)] : [])), view: 'profit' } : null,
    };
  } else mods.analytics = { locked: 'perm' };

  // Roles, Settings & Controls
  {
    const people = await soft(ctx, () => ctx.tx`select role::text as role, count(*)::int as n from memberships where business_id = ${ctx.biz} group by 1`, []);
    const pc = {}; people.forEach((r) => { pc[str(r.role)] = r.n; });
    const powers = ERP_POWERS.map((p) => ({ id: p.id, label: p.label, on: powerOn(s, p.id), min: p.min }));
    const lists = await soft(ctx, () => ctx.tx`select kind, count(*)::int as n from lookups where business_id = ${ctx.biz} group by 1 order by 2 desc`, []);
    const accounts = await soft(ctx, () => ctx.tx`select name from money_accounts where business_id = ${ctx.biz} and not archived order by sort_order, created_at`, []);
    const closed = await soft(ctx, () => ctx.tx`select month from capital_closed where business_id = ${ctx.biz} order by month desc limit 1`, []);
    const ROLES = [['owner', 'Owner'], ['shareholder', 'Shareholder'], ['manager', 'Manager'], ['sales', 'Sales staff']];
    const nPeople = people.reduce((t, r) => t + r.n, 0);
    mods.roles = { count: nPeople, sub: powers.filter((p) => p.on).length + ' of ' + powers.length + ' abilities on for you', view: 'settings',
      calc: [['People with access to this business', nPeople], ['Abilities on for you', powers.filter((p) => p.on).length]],
      children: [
        leaf('rol_roles', 'Roles', ROLES.length, { icon: 'users', sub: 'You are ' + (ROLES.find((r) => r[0] === s.role) || ['', s.role])[1], view: 'settings',
          children: ROLES.map(([k, l]) => leaf('rol_r_' + k, l, pc[k] || (k === 'sales' ? (pc.staff || 0) + (pc.sales || 0) : 0), { icon: 'user', sub: 'people', view: 'settings' })) }),
        leaf('rol_powers', 'Your abilities', null, { icon: 'eye', display: powers.filter((p) => p.on).length + '/' + powers.length, sub: powers.filter((p) => !p.on).length + ' hidden for you', view: 'settings',
          children: powers.map((p) => leaf('rol_p_' + p.id, p.label, null, { icon: p.on ? 'eye' : 'lock', display: p.on ? 'On' : 'Off', status: p.on ? 'ok' : 'off', view: 'settings' })) }),
        leaf('rol_lists', 'Drop-down lists', lists.length, { icon: 'list', sub: 'Categories, brands, methods…', view: 'settings', children: lists.slice(0, 6).map((r) => leaf('rol_l_' + str(r.kind), str(r.kind).replace(/_/g, ' '), r.n, { icon: 'list', view: 'settings' })) }),
        leaf('rol_accounts', 'Money accounts', accounts.length, { icon: 'wallet', sub: accounts.slice(0, 3).map((a) => str(a.name)).join(', '), view: 'cash', children: accounts.slice(0, 6).map((a, i) => leaf('rol_a_' + i, str(a.name), null, { icon: 'wallet', display: 'account', view: 'cash' })) }),
        leaf('rol_lock', 'Month lock', null, { icon: 'calendar', display: closed[0] ? monthLabel(str(closed[0].month)) : 'None', sub: closed[0] ? 'Closed through ' + monthLabel(str(closed[0].month)) : 'No month closed yet', view: 'capital' }),
      ],
      minis: [{ label: 'People', v: nPeople }, { label: 'Abilities on', display: powers.filter((p) => p.on).length + '/' + powers.length }, { label: 'Money accounts', v: accounts.length }],
      chart: { title: 'Abilities each role has by default', items: ROLES.slice().reverse().map(([k, l]) => ({ label: l, value: ERP_POWERS.filter((p) => k === 'owner' || roleAtLeast(k, p.min)).length })) },
      data: { columns: ['Ability', 'For you'], rows: powers.map((p) => [p.label, p.on ? 'On' : 'Off']), view: 'settings' },
    };
  }

  // Audit, Backup & System Check
  if (can.pnl) {
    const counts = sysCheck ? sysCheck.counts : { pass: 0, warn: 0, fail: 0 };
    const bad = checks.filter((c) => c.status !== 'pass').sort((a, b) => (a.status === 'fail' ? 0 : 1) - (b.status === 'fail' ? 0 : 1));
    const act = can.owner ? await soft(ctx, () => ctx.tx`select action, count(*)::int as n from erp_activity where business_id = ${ctx.biz} and at > now() - interval '30 days' and action <> 'sign-in' group by 1 order by 2 desc`, []) : null;
    const backups = await soft(ctx, () => ctx.tx`select count(*)::int as n, max(at) as last from erp_backup_log where business_id = ${ctx.biz} and at > now() - interval '30 days'`, [{ n: 0, last: null }]);
    const closedN = await soft(ctx, () => ctx.tx`select count(*)::int as n, max(month) as last from capital_closed where business_id = ${ctx.biz}`, [{ n: 0, last: null }]);
    const lastClosed = closedN[0].last ? str(closedN[0].last) : '';
    mods.audit = { count: checks.length, sub: counts.pass + '/' + checks.length + ' healthy', view: 'syscheck',
      calc: [['Checks passed', counts.pass], ['To look at', counts.warn], ['Failed', counts.fail]],
      children: [
        leaf('aud_checks', 'System check', counts.pass, { icon: 'shield', display: counts.pass + '/' + checks.length, status: counts.fail ? 'fail' : counts.warn ? 'warn' : 'ok', sub: counts.fail + ' failing · ' + counts.warn + ' to look at', view: 'syscheck',
          children: bad.slice(0, 6).map((c) => leaf('aud_c_' + c.id, c.id + ' ' + c.title, null, { icon: c.status === 'fail' ? 'x' : 'warn', display: c.status === 'fail' ? 'Failing' : 'Look', status: c.status, view: c.go || 'syscheck', def: c.detail })) }),
        leaf('aud_log', 'Activity log', act ? act.reduce((t, r) => t + r.n, 0) : null, { icon: 'list', sub: 'Every change, 30 days', view: 'settings', locked: act ? '' : 'perm',
          children: (act || []).slice(0, 5).map((r, i) => leaf('aud_a_' + i, actionWords(str(r.action)), r.n, { icon: 'list', view: 'settings' })) }),
        leaf('aud_backup', 'Backups', num(backups[0].n), { icon: 'archive', sub: backups[0].last ? 'Last ' + formatDate(new Date(backups[0].last), 'd MMM, h:mm a') : 'None in 30 days', status: backups[0].last ? 'ok' : 'warn', view: 'tools' }),
        leaf('aud_close', 'Month close', num(closedN[0].n), { icon: 'calendar', sub: lastClosed ? 'Closed through ' + monthLabel(lastClosed) : 'No month closed yet', view: 'capital', children: [
          leaf('aud_cl_last', 'Last closed', null, { icon: 'calendar', display: lastClosed ? monthLabel(lastClosed) : 'None' }),
          leaf('aud_cl_open', 'Open now', null, { icon: 'calendar', display: (lastClosed ? monthLabel(shiftMonth(lastClosed, 1)) + ' – ' : '') + monthLabel(RG.now), status: 'warn' })] }),
      ],
      minis: [{ label: 'Checks healthy', display: counts.pass + '/' + checks.length }, { label: 'To look at', v: counts.warn }, { label: 'Failed', v: counts.fail }],
      chart: { title: 'System check results', items: [{ label: 'Pass', value: counts.pass, tone: 'pass' }, { label: 'Look', value: counts.warn, tone: 'warn' }, { label: 'Fail', value: counts.fail, tone: 'fail' }] },
      data: { columns: ['Check', 'Area', 'Result'], rows: checks.map((c) => [c.title, c.id, c.area, c.status === 'pass' ? 'Pass' : c.status === 'warn' ? 'Look' : 'Fail']), view: 'syscheck', sub: true },
    };
  } else mods.audit = { locked: 'perm' };

  // Expenses & Accounting
  if (can.expenses) {
    const byCat = {}; let expTotal = 0;
    for (const m of RG.months) { const e = await soft(ctx, () => expByCat(ctx, m), { total: 0, byCat: {} }); expTotal += num(e.total); for (const [k, v] of Object.entries(e.byCat || {})) byCat[k] = (byCat[k] || 0) + num(v); }
    const nExp = await soft(ctx, () => ctx.tx`select count(*)::int as n from expenses where business_id = ${ctx.biz} and month = any(${RG.months}) and coalesce(btrim(voided), '') = ''`, [{ n: 0 }]);
    const hc = await soft(ctx, () => holdingConfig(ctx), { on: false });
    const rules = await soft(ctx, () => ctx.tx`select count(*)::int as n from commission_rules where business_id = ${ctx.biz} and voided_at is null`, null)
      || await soft(ctx, () => ctx.tx`select count(*)::int as n from commission_rules where business_id = ${ctx.biz}`, [{ n: 0 }]);
    const pays = await soft(ctx, () => ctx.tx`select count(*) filter (where to_char(public.dhaka_date(paid_at), 'YYYY-MM') = any(${RG.months}))::int as n,
        count(*) filter (where account_id is null and coalesce(amount, 0) <> 0 and lower(btrim(coalesce(method, ''))) not in ('adjusted', 'returned', 'advance', 'undone', 'return / refund', ''))::int as loose
        from payments where business_id = ${ctx.biz}`, [{ n: 0, loose: 0 }]);
    const cashups = await soft(ctx, () => ctx.tx`select count(*)::int as n from cash_ups where business_id = ${ctx.biz} and to_char(public.dhaka_date(at), 'YYYY-MM') = any(${RG.months})`, [{ n: 0 }]);
    mods.expenses = { count: num(nExp[0].n), sub: 'BDT ' + R(expTotal).toLocaleString('en-US') + ' · ' + RG.label, view: 'expenses', ranged: true,
      calc: sortDesc(byCat).map(([k, v]) => [k, R(v)]).concat([['Expenses (as on Profit & loss)', R(expTotal)]]),
      children: [
        leaf('exp_cats', 'Expense categories', Object.keys(byCat).length, { icon: 'receipt', sub: sortDesc(byCat).slice(0, 2).map((x) => x[0]).join(', '), view: 'expenses',
          children: sortDesc(byCat).slice(0, 6).map(([k, v]) => leaf('exp_c_' + k.toLowerCase().replace(/[^a-z0-9]+/g, '-'), k, R(v), { icon: 'receipt', money: true, view: 'expenses' })) }),
        leaf('exp_courier', 'Courier fees', P && can.profit ? R(P.courier) : null, { icon: 'truck', money: true, sub: 'Delivery + COD fees kept', view: 'sales', locked: P && can.profit ? '' : 'profit' }),
        leaf('exp_holding', 'Holding cost', null, { icon: 'store', display: hc.on ? 'On' : 'Off', sub: 'Shelf cost by kg-days', view: 'shipments', status: hc.on ? 'ok' : 'off' }),
        leaf('exp_comm', 'Commission', num(rules[0].n), { icon: 'percent', sub: 'Rules for sellers', view: 'commission' }),
        leaf('exp_pay', 'Payments', num(pays[0].n), { icon: 'wallet', status: num(pays[0].loose) ? 'warn' : 'ok', sub: num(pays[0].loose) + ' in no account', view: 'cash', children: [
          leaf('exp_p_loose', 'In no money account', num(pays[0].loose), { icon: 'search', status: num(pays[0].loose) ? 'warn' : 'ok', view: 'cash' }),
          leaf('exp_p_cashup', 'Cash-ups', num(cashups[0].n), { icon: 'check', view: 'cash' })] }),
      ],
      minis: [{ label: 'Expenses', v: R(expTotal), money: true }, P && can.profit ? { label: 'Courier fees', v: R(P.courier), money: true } : { label: 'Courier fees', locked: 'profit' }, { label: 'In no account', v: num(pays[0].loose) }],
      chart: { title: 'Expenses by category · ' + RG.label, money: true, items: sortDesc(byCat).slice(0, 6).map(([label, v]) => ({ label, value: R(v) })) },
      data: { columns: ['Category', 'Amount'], rows: sortDesc(byCat).map(([k, v]) => [k, R(v)]), view: 'expenses' },
    };
  } else mods.expenses = { locked: 'perm' };

  // Investors & Funding
  if (capital) {
    const inv = capital.holders.filter((h) => h.kind === 'investor' && (!F.investor || h.id === F.investor || str(h.id) === F.investor));
    const fund = funding.filter((f) => (!F.investor || str(f.holder_no) === F.investor) && (!refSet || refSet.has(str(f.reference))) && (!f.private || can.owner));
    const links = can.owner ? await soft(ctx, () => ctx.tx`select count(*)::int as n from investor_links where business_id = ${ctx.biz} and revoked_at is null`, [{ n: 0 }]) : null;
    const kindWord = (h) => (h.returnKind === 'lot' ? h.returnValue + '% of shipment profit' : h.returnKind === 'percent' ? h.returnValue + '% a month' : h.returnKind === 'monthly' ? 'BDT ' + h.returnValue + ' a month' : 'nothing fixed');
    const capIn = inv.reduce((t, h) => t + num(h.capital), 0), owedT = inv.reduce((t, h) => t + Math.max(0, num(h.returnOwed)), 0);
    mods.investors = { count: inv.length, sub: 'BDT ' + R(capIn).toLocaleString('en-US') + ' capital', view: 'capital',
      calc: inv.map((h) => [h.name + ' · capital', R(h.capital)]).concat([['Investors', inv.length]]),
      children: [
        leaf('ivs_profiles', 'Investor profiles', inv.length, { icon: 'user', sub: capital.hidden ? capital.hidden + ' private, not listed' : 'Owners apart', view: 'capital',
          children: inv.slice(0, 6).map((h) => leaf('ivs_p_' + h.id, h.name, null, { icon: 'user', display: kindWord(h), view: 'capital' })) }),
        leaf('ivs_capital', 'Capital in', R(capIn), { icon: 'wallet', money: true, sub: 'Invested − withdrawn', view: 'capital', children: inv.slice(0, 6).map((h) => leaf('ivs_c_' + h.id, h.name, R(h.capital), { icon: 'wallet', money: true, view: 'capital' })) }),
        leaf('ivs_funding', 'Shipment funding', fund.length, { icon: 'layers', sub: new Set(fund.map((f) => str(f.reference))).size + ' shipments funded', view: 'shipments',
          children: fund.slice(0, 6).map((f, i) => leaf('ivs_f_' + i, str(f.reference) + ' · ' + (str(f.name) || str(f.holder_no)), num(f.pct), { icon: 'box', pct: true, view: 'shipments' })) }),
        leaf('ivs_owed', 'Returns owed', R(owedT), { icon: 'taka', money: true, status: owedT > 0.5 ? 'warn' : 'ok', sub: 'Months that are over', view: 'capital',
          children: inv.filter((h) => h.returnOwed > 0).slice(0, 6).map((h) => leaf('ivs_o_' + h.id, h.name, R(h.returnOwed), { icon: 'taka', money: true, view: 'capital' })) }),
        leaf('ivs_pages', 'Investor pages', links ? num(links[0].n) : null, { icon: 'link', sub: 'Private link + code', view: 'capital', locked: links ? '' : 'perm' }),
      ],
      minis: [{ label: 'Capital in', v: R(capIn), money: true }, { label: 'Returns paid', v: R(capital.totals.returnPaid), money: true }, { label: 'Payout due', v: payout, money: true }],
      chart: { title: 'Capital by investor', money: true, items: inv.slice().sort((a, b) => b.capital - a.capital).slice(0, 6).map((h) => ({ label: h.name, value: R(h.capital) })) },
      data: { columns: ['Investor', 'Capital', 'Returns owed'], rows: inv.map((h) => [h.name, R(h.capital), R(h.returnOwed)]), view: 'capital' },
    };
  } else mods.investors = { locked: 'investor' };

  // ---------------------------------------------------------------- assemble the nine modules
  const DEF = [
    ['inventory', 'Inventory & Catalog', ['Inventory &', 'Catalog'], 'box', -90, ['Stock'], 'products',
      'Every product with its brand, type and category, the stock lots it came in (FIFO), stock on hand and reorder levels. Stock value is landed cost; holding cost is never added to it.',
      ['Each sale takes the oldest lot first (FIFO); a lot whose cost is not known uses the product’s cost-book price.', 'Unsold stock is an asset, never a cost: stock value = what is left in each lot × its landed cost.',
       'Product cost lives in the cost book (Product cost screen), not on the product.', 'A product at or below its reorder level shows up in What to order.']],
    ['customers', 'Customers & CRM', ['Customers &', 'CRM'], 'users', -50, [], 'customers',
      'Customers are one per phone number, with what they bought, what they owe, follow-ups and where they came from.',
      ['One customer per phone number (the last 10 digits): 017…, 88017… and +88017… are the same person.', 'Dues = invoice total − payments and advance, worked out from the payments, never typed.', 'A follow-up is a call planned for a day; overdue ones are shown first.']],
    ['procurement', 'Procurement & Shipments', ['Procurement &', 'Shipments'], 'ship', -10, ['Capital'], 'shipments',
      'Purchase orders from Planned to Received, shipments with their freight, duty and agent costs, and the stock lots made when goods arrive.',
      ['Landed cost = goods at the rate of the day + freight (by chargeable weight, value or units) + every other cost of the shipment, spread on its lines.', 'Receiving makes one stock lot per line at landed cost.', 'A bill that comes after the goods: its part for units already sold is cost of sales now, the rest goes onto the units on the shelf.']],
    ['analytics', 'Analytics & Forecasting', ['Analytics &', 'Forecasting'], 'bars', 30, ['Profit'], 'analytics',
      'Growth, profit and margin, shipment ROI after holding cost, what to reorder, dead stock and the colours that sell.',
      ['One net profit everywhere: the dashboard, this map and Profit & loss use the same figure.', 'Shipment ROI = profit after holding cost ÷ what the shipment cost to land.', 'Dead stock = lots on the shelf 90+ days with nothing sold from them for 60 days.']],
    ['roles', 'Roles, Settings & Controls', ['Roles, Settings', '& Controls'], 'gear', 70, [], 'settings',
      'Who may do what: roles, each person’s abilities, drop-down lists, money accounts and the month lock.',
      ['A figure your role may not see is never sent to your screen: it shows a lock instead.', 'Roles go sales < manager < shareholder < owner; the owner can switch single abilities on or off per person.', 'A closed month is locked: nothing can be added to it until the owner reopens it.']],
    ['audit', 'Audit, Backup & System Check', ['Audit, Backup &', 'System Check'], 'shield', 110, [], 'syscheck',
      'The books checked against themselves, the activity log of every change, backups and the month close.',
      ['Nothing is deleted: a mistake is struck out with a reason and stays in the books.', 'Every change is written to the activity log with who did it and when.', 'System check: stock lots = stock, every invoice adds up, nobody paid more than they owed, shares within 100%, one net profit.']],
    ['expenses', 'Expenses & Accounting', ['Expenses &', 'Accounting'], 'receipt', 150, ['Money'], 'expenses',
      'Expenses by category, courier fees, holding cost, sellers’ commission and payments into money accounts.',
      ['An expense belongs to the month it is for; an investor’s return and commission to the month they were earned in.', 'Every payment goes into a money account (cash, bank, bKash, courier).', 'Holding cost is shared over the lots on the shelf by kg × days; it lowers shipment profit, not stock value.']],
    ['investors', 'Investors & Funding', ['Investors &', 'Funding'], 'briefcase', 190, ['Capital'], 'capital',
      'Investors and their capital, who funded which shipment and what share, returns owed and their private pages.',
      ['An investor’s return is due once its month is over; the running month is still building.', 'All shares of one shipment together stay within 100%.', 'Each investor can see only their own statement, on a private link with a code.']],
    ['orders', 'Orders, Invoice & Sales', ['Orders, Invoice', '& Sales'], 'orders', 230, ['Sales'], 'sales',
      'Invoices from the shop, phone and website, payment status, pre-orders and quotations, returns and website orders waiting.',
      ['The cost of each sold line is fixed on the line the day it is sold; a later shipment does not rewrite a month that is over.', 'Payment status and dues come from the payments, never typed.', 'A pre-order deposit is the customer’s money until the goods are handed over.']],
  ];
  const ACCESS = { inventory: ['sales', 'costs'], customers: ['sales', 'dues'], procurement: ['costs', 'costs'], analytics: ['profit', 'dash'], roles: ['manager', null],
                   audit: ['profit', null], expenses: ['expenses', 'expenses'], investors: ['shareholder', 'shareholder'], orders: ['sales', 'dues'] };
  const allowedFor = (sess, k) => (['sales', 'manager', 'shareholder', 'owner'].includes(k) ? roleAtLeast(sess.role, k) : powerOn(sess, k));
  const AUDIT_RE = { inventory: /Product|Stock|Cost|Famil|Serial/, customers: /Customer|Followup|Consent|Points/, procurement: /Po[A-Z]|Shipment|Receive|Supplier|Lot/, analytics: /Pnl|Capital(Close|Reopen)/,
                     roles: /User|Power|Access|Config|Lookup|Setting|Device|Person/, audit: /Backup|Restore|Capital(Close|Reopen)/, expenses: /Expense|Commission|Cash|Holding/, investors: /Capital|Lot(Fund)|Investor/,
                     orders: /Invoice|Return|Settle|Advance|Preorder|Quote|WebOrder|Parcel/ };
  const activity = can.owner ? await soft(ctx, () => ctx.tx`select who, action, at from erp_activity where business_id = ${ctx.biz} and action <> 'sign-in' order by at desc limit 400`, []) : null;
  const lastAct = await soft(ctx, () => ctx.tx`select
      (select max(created_at) from invoices where business_id = ${ctx.biz}) as orders,
      (select max(created_at) from stock_movements where business_id = ${ctx.biz}) as inventory,
      greatest((select max(created_at) from customers where business_id = ${ctx.biz}), (select max(at) from customer_followups where business_id = ${ctx.biz})) as customers,
      greatest((select max(ordered_at) from po_lines where business_id = ${ctx.biz}), (select max(received_at) from stock_lots where business_id = ${ctx.biz} and source = 'receive')) as procurement,
      (select max(recorded_at) from expenses where business_id = ${ctx.biz}) as expenses`, [{}]);
  const lastOf = (id) => {
    let d = lastAct[0][id] || null;
    if (id === 'analytics') d = lastAct[0].orders || null;
    if (id === 'investors' && funding.length) d = funding.reduce((m, f) => (!m || f.at > m ? f.at : m), null);
    if ((id === 'roles' || id === 'audit') && activity) { const r = activity.find((a) => AUDIT_RE[id].test(str(a.action))) || (id === 'audit' ? activity[0] : null); d = r ? r.at : null; }
    return d ? formatDate(new Date(d), 'd MMM yyyy') : '';
  };
  const AREA = {};
  for (const x of DEF) for (const a of x[5]) (AREA[a] = AREA[a] || []).push(x[0]);
  const modules = DEF.map(([id, label, lines2, icon, angle, areas, view, desc, rules]) => {
    const m = mods[id];
    const mc = areaChecks(areas).filter((c) => !(id === 'procurement' && c.area === 'Capital' && c.id !== 'C2') && !(id === 'investors' && c.id === 'C2'));
    const out = { id, label, lines: lines2, icon, angle, desc, view, rules,
                  checks: mc.map((c) => ({ id: c.id, title: c.title, status: c.status, detail: c.detail || '' })),
                  access: [['sales', 'Sales staff'], ['manager', 'Manager'], ['shareholder', 'Shareholder'], ['owner', 'Owner']].map(([r, l]) => ({ role: r, label: l, you: s.role === r,
                    screen: allowedFor({ role: r }, ACCESS[id][0]), money: ACCESS[id][1] ? allowedFor({ role: r }, ACCESS[id][1]) : null })) };
    out.youScreen = allowedFor(s, ACCESS[id][0]); out.youMoney = ACCESS[id][1] ? allowedFor(s, ACCESS[id][1]) : null;
    if (m.locked) {
      Object.assign(out, { locked: m.locked, count: null, sub: '', children: [], status: 'ok' });
      return out;
    }
    Object.assign(out, { count: m.count === undefined ? null : m.count, sub: m.sub, children: m.children, minis: m.minis, chart: m.chart, data: m.data, calc: m.calc, ranged: !!m.ranged });
    if (m.display !== undefined) out.display = m.display;
    if (m.view) out.view = m.view;
    out.status = mc.some((c) => c.status === 'fail') ? 'fail' : mc.some((c) => c.status === 'warn') ? 'warn' : 'ok';
    out.audit = activity ? activity.filter((a) => AUDIT_RE[id].test(str(a.action))).slice(0, 8).map((a) => ({ when: formatDate(new Date(a.at), 'd MMM, h:mm a'), who: str(a.who), what: actionWords(str(a.action)) })) : LOCK('perm');
    out.last = lastOf(id);
    return out;
  });
  const M = {}; modules.forEach((m) => { M[m.id] = m; });

  // ---------------------------------------------------------------- flows between modules
  const lotsR = fLots.filter((l) => l.source === 'receive' && inR(l.received_at));
  const unitsSold = unitsOf(salesR);
  const shipCostRows = can.cost ? await soft(ctx, () => ctx.tx`select (select count(*)::int from shipment_costs where business_id = ${ctx.biz}) + (select count(*)::int from late_costs where business_id = ${ctx.biz}) as n`, [{ n: 0 }]) : null;
  const linesR = salesR.reduce((t, i) => t + (linesBy[i.id] || []).filter((l) => num(l.qty) > 0).length, 0);
  const flows = [
    { from: 'orders', to: 'inventory', label: 'Orders create demand', count: linesR, unit: 'invoice lines', def: 'Each invoice line takes units from the oldest stock lot first (FIFO), in the range.' },
    { from: 'inventory', to: 'customers', label: 'Stock sold to customers', count: R(unitsSold), unit: 'units sold', def: 'Units that left the shelf on invoices in the range.' },
    { from: 'customers', to: 'procurement', label: 'Demand sets reorders', count: low.length, unit: 'products to reorder', def: 'What customers buy runs stock down to its reorder level; those products show in What to order.' },
    { from: 'procurement', to: 'inventory', label: 'Shipment updates inventory', count: lotsR.length, unit: 'lots received', inner: true, def: 'Receiving a shipment makes one stock lot per line at landed cost.' },
    { from: 'procurement', to: 'analytics', label: 'Landed cost feeds ROI', count: new Set(lotsR.map((l) => str(l.reference))).size, unit: 'shipments received', def: 'Shipment ROI and margins use the landed cost written on each lot.' },
    { from: 'roles', to: 'analytics', label: 'Roles decide who sees figures', count: ERP_POWERS.filter((p) => !powerOn(s, p.id)).length, unit: 'abilities off for you', def: 'A figure your role may not see is never sent to the page: it shows a lock.' },
    { from: 'roles', to: 'audit', label: 'Controls keep the system safe', count: activity ? activity.filter((a) => inR(a.at)).length : null, unit: 'changes logged', def: 'Every change is written to the activity log with who and when.' },
    { from: 'audit', to: 'expenses', label: 'Audit ready, traceable', count: sysCheck ? sysCheck.counts.fail : null, unit: 'checks failing', def: 'The system check proves invoices, payments, stock and shares agree; nothing is deleted, only struck out.' },
    { from: 'expenses', to: 'investors', label: 'Costs linked to shipments', count: shipCostRows && capital ? num(shipCostRows[0].n) : null, unit: 'shipment cost rows', def: 'Freight, duty and late bills on a shipment lower its profit, which investors who funded it share in.' },
    { from: 'investors', to: 'orders', label: 'Funding mapped to sales', count: capital ? funding.length : null, unit: 'funding rows', def: 'Who funded what share of each shipment; its units sold on invoices earn their share.' },
  ].map((f) => { if (M[f.from].locked || M[f.to].locked) f.count = null; return f; });

  // ---------------------------------------------------------------- module health
  const health = modules.map((m) => {
    if (m.locked) return { id: m.id, locked: m.locked, action: m.locked === 'investor' ? 'Shareholders and the owner only' : 'Ask the owner for access', status: 'locked' };
    const bad = m.checks.filter((c) => c.status !== 'pass'), att = m.children.filter((c) => c.status === 'warn' || c.status === 'fail');
    const fail = bad.filter((c) => c.status === 'fail');
    const action = fail.length ? 'Fix ' + fail.map((c) => c.id).join(', ') + ' before closing the month' : att.length ? 'Look at ' + att.map((c) => c.label.toLowerCase()).join(', ') : bad.length ? 'Look at check ' + bad.map((c) => c.id).join(', ') : 'Nothing to do';
    return { id: m.id, count: m.count, display: m.display, issues: bad.length + att.length, last: m.last, action, status: fail.length ? 'fail' : bad.length + att.length ? 'warn' : 'pass' };
  });

  // ---------------------------------------------------------------- money flow (since the first month on record, max 36)
  let money = LOCK(can.profit ? 'cost' : 'profit');
  if (can.profit && can.cost && LS) {
    money = await soft(ctx, async () => {
      const firstInv = invoices.length ? monthKey(new Date(invoices[0].created_at)) : RG.now;
      const ms = [];
      for (let m = RG.now, g = 0; m >= firstInv && g < 36; m = shiftMonth(m, -1), g++) ms.unshift(m);
      const all = await pnlFor(ctx, ms);
      const sumK = (k) => all.reduce((t, x) => t + num(x[k]), 0);
      const r = Math.max(0, sumK('netSales')), k = Math.max(0, sumK('cost')), g = Math.max(0, sumK('gross')), n = Math.max(0, sumK('net')), sv = Math.max(0, num(LS.value));
      // stock bought = the landed cost of every lot with a known cost; stock from before lots (no lot cost) is counted
      // at what it was sold at / is valued at now, so the column is never smaller than what flows out of it
      const Blots = lots.filter((l) => l.unit_cost !== null).reduce((t, l) => t + num(l.qty_in) * num(l.unit_cost), 0);
      const B = Math.max(Blots, k + sv);
      const invOK = !!capital, cap = invOK ? Math.max(0, num(capital.totals.outsideCapital)) : 0;
      const I = invOK ? Math.max(0, num(capital.totals.returnDue) + num(capital.totals.returnBuilding)) : 0;
      const capIn = Math.min(cap, B), own = Math.max(0, B - capIn), other = Math.max(0, B - Math.min(k, B) - Math.min(sv, B)), unknown = Math.max(0, r - k - g), exp = Math.max(0, g - n);
      // investor returns are already a cost inside expenses (dashboard.js pnlFor): they flow from gross profit, the
      // owners' share is the whole net profit (it was taken off twice before)
      const inv = invOK ? Math.min(I, exp) : 0, expOnly = Math.max(0, exp - inv), ownS = n;
      const nodes = [
        { id: 'cap', col: 0, label: invOK ? 'Investor capital' : 'Investor capital (hidden)', v: R(capIn), c: 'violet', view: 'capital' },
        { id: 'own', col: 0, label: 'Owner & recycled cash', v: R(own), c: 2, view: 'capital' },
        { id: 'bought', col: 1, label: 'Stock bought (landed)', v: R(B), c: 1, view: 'shipments' },
        { id: 'sold', col: 2, label: 'Sold at cost', v: R(k), c: 6, view: 'profit' },
        { id: 'stock', col: 2, label: 'In stock now', v: R(sv), c: 4, view: 'products' },
        { id: 'other', col: 2, label: 'Written off & other', v: R(other), c: 8, view: 'stock' },
        { id: 'margin', col: 2, label: 'Margin added', v: R(Math.max(0, r - k)), c: 5, view: 'profit' },
        { id: 'rev', col: 3, label: 'Sales revenue', v: R(r), c: 5, view: 'profit' },
        { id: 'gross', col: 4, label: 'Gross profit', v: R(g), c: 5, view: 'profit' },
        { id: 'unk', col: 4, label: 'Revenue with no cost', v: R(unknown), c: 8, view: 'costs' },
        { id: 'exp', col: 5, label: invOK ? 'Expenses & fees (less delivery charged)' : 'Expenses & fees', v: R(invOK ? expOnly : exp), c: 7, view: 'expenses' },
        { id: 'net', col: 5, label: 'Net profit', v: R(n), c: 5, view: 'profit' },
        { id: 'inv', col: 5, label: invOK ? 'Investor returns' : 'Investor returns (hidden)', v: R(inv), c: 'violet', view: 'capital' },
        { id: 'ownS', col: 6, label: 'Owners’ share (net profit)', v: R(ownS), c: 'accent', view: 'capital' },
      ];
      const links = [['cap', 'bought', capIn], ['own', 'bought', own], ['bought', 'sold', Math.min(k, B)], ['bought', 'stock', Math.min(sv, B)], ['bought', 'other', other], ['sold', 'rev', k], ['margin', 'rev', Math.max(0, r - k)],
                     ['rev', 'gross', g], ['rev', 'unk', unknown], ['gross', 'exp', invOK ? expOnly : exp], ['gross', 'inv', inv], ['gross', 'net', n], ['net', 'ownS', n]].map((x) => [x[0], x[1], R(x[2])]);
      return { since: monthLabel(ms[0]), nodes, links };
    }, LOCK('cost'));
  }

  // ---------------------------------------------------------------- what needs action
  const actions = [];
  for (const c of checks.filter((x) => x.status === 'fail')) actions.push({ tone: 'bad', icon: 'x', title: c.title, sub: c.id + ' failed · ' + (c.detail || ''), view: c.go || 'syscheck' });
  if (low.length) actions.push({ tone: 'warn', icon: 'warn', title: low.length + ' product(s) low on stock', sub: low.slice(0, 3).map((p) => p.name).join(', '), view: 'stock', f: 'plan' });
  const outN = items.filter((p) => p.stock <= 0).length;
  if (outN) actions.push({ tone: 'bad', icon: 'box', title: outN + ' product(s) out of stock', sub: 'Order them or mark them discontinued', view: 'products', f: 'out' });
  if (openOrders.length) actions.push({ tone: 'warn', icon: 'bell', title: can.dues ? 'BDT ' + R(duesTotal).toLocaleString('en-US') + ' customer dues' : openOrders.length + ' invoice(s) with a due', sub: openOrders.length + ' invoice(s) still owe', view: 'sales', f: 'due' });
  if (payout > 0.5) actions.push({ tone: 'info', icon: 'wallet', title: 'BDT ' + payout.toLocaleString('en-US') + ' investor returns owed', sub: owingInv.map((h) => h.name).slice(0, 3).join(', '), view: 'capital' });
  const cf = mods.customers.children.find((c) => c.id === 'cus_follow');
  if (cf && cf.value) actions.push({ tone: cf.status === 'warn' ? 'warn' : 'info', icon: 'clock', title: cf.value + ' customer follow-up(s) due', sub: cf.sub, view: 'customers' });
  const po = mods.orders.children.find((c) => c.id === 'ord_pre');
  if (po && po.children.length > 1) actions.push({ tone: 'info', icon: 'calendar', title: (po.children.length - 1) + ' open pre-order(s)', sub: 'Hand over when the goods are on the shelf', view: 'preorders' });
  const wo = mods.orders.children.find((c) => c.id === 'ord_attention');
  if (wo && wo.status === 'warn') actions.push({ tone: 'warn', icon: 'globe', title: 'Website orders waiting', sub: wo.sub, view: 'weborders' });
  const lateP = (poRows || []).filter((p) => p.open && p.eta && new Date(p.eta) < ctx.now && str(p.stage) !== 'received');
  if (lateP.length) actions.push({ tone: 'warn', icon: 'truck', title: lateP.length + ' shipment(s) past their expected date', sub: lateP.slice(0, 3).map((p) => str(p.po_no)).join(', '), view: can.suppliers ? 'suppliers' : 'stock' });
  for (const c of checks.filter((x) => x.status === 'warn')) actions.push({ tone: 'warn', icon: 'warn', title: c.title, sub: c.detail || '', view: c.go || 'syscheck' });
  if (!can.cost) actions.push({ tone: 'neutral', icon: 'lock', title: 'Costs and stock value', sub: 'Hidden for your role (Product cost ability)', view: '' });

  // ---------------------------------------------------------------- filter lists and search
  const uniqSorted = (a) => Array.from(new Set(a.filter(Boolean))).sort((x, y) => x.localeCompare(y));
  const shipOpts = uniqSorted(lots.filter((l) => l.source === 'receive').map((l) => str(l.reference)));
  const filters = {
    active: F,
    options: {
      brand: uniqSorted(live.map((p) => p.brand)).map((v) => ({ value: v, label: v })),
      type: uniqSorted(live.map((p) => p.type)).map((v) => ({ value: v, label: v })),
      category: uniqSorted(live.map((p) => p.cat)).map((v) => ({ value: v, label: v })),
      investor: can.investors ? holders.filter((h) => h.kind === 'investor' && (!h.private || can.owner)).map((h) => ({ value: str(h.holder_no), label: str(h.name) })) : null,
      shipment: shipOpts.map((v) => ({ value: v, label: v })),
      source: uniqSorted(invoices.map((i) => str(i.src))).map((v) => ({ value: v, label: v })),
    },
  };
  const search = {
    invoices: sales.slice(-300).reverse().map((i) => ({ no: str(i.invoice_no), customer: str(i.customer_name), date: dayLabel(i.created_at) })),
    customers: (await soft(ctx, () => ctx.tx`select name, phone from customers where business_id = ${ctx.biz} order by created_at desc limit 300`, [])).map((c) => ({ name: str(c.name), phone: str(c.phone), key: custKey(c.phone, c.name) })),
    shipments: procOpen ? shipOpts.slice(-300).map((r) => ({ ref: r, kind: 'Received' })).concat((poRows || []).filter((p) => p.open).slice(0, 100).map((p) => ({ ref: str(p.po_no), kind: 'Purchase order' }))) : [],
    skus: live.slice(-300).map((p) => ({ sku: p.sku, name: p.name })),
  };

  return {
    currency: 'BDT', role: s.role, can,
    range: { key: RG.key, label: RG.label, prevLabel: RG.prevLabel, from: RG.from, to: RG.to, months: RG.months.length },
    filtered: Object.keys(F).length > 0,
    kpis, core: { label: 'ERP Core', sub: 'Connected business logic', status: sysCheck ? (sysCheck.counts.fail ? 'fail' : sysCheck.counts.warn ? 'warn' : 'ok') : 'ok',
                  checks: sysCheck ? sysCheck.counts : null },
    modules, flows, health, money, actions: actions.slice(0, 14), filters, search,
    generatedAt: formatDate(ctx.now, 'd MMM yyyy, h:mm a'),
  };
}

export const HANDLERS = { erpNavigator };
