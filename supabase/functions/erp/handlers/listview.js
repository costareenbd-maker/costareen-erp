// The list view (redesign look 2, step 2): one engine behind every list -
// search facets, filters, group by, sort, pages, totals - the way Odoo lists
// work. Each list ("model") says where its rows come from and what can be
// searched, filtered, grouped and summed; the engine does the rest.
//
//   erpListView({ model, search: [{field, values:[...]}], filters: [...],
//                 groupBy, group, order: {field, dir}, offset, limit, exportAll })
//     -> { spec, total, rows }                     no group by, or the rows of one group
//     -> { spec, total, groups: [{key, label, count, sums}] }   grouped, nothing opened
//
// Filters in the same set are "or", different sets are "and" (as in Odoo);
// several values for the same search field are "or", different fields "and".

import { formatDate, num } from '../lib/time.js';
import { salesLog, str, SL } from '../lib/tabs.js';
import { custKey } from '../lib/phone.js';
import { roleAtLeast } from '../allow.js';
import { erpSales } from './sales.js';
import { erpCatalog } from './catalog.js';
import { erpCustomers } from './customers.js';
import { erpDues } from './money.js';

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabel = (m) => (/^\d{4}-\d{2}$/.test(m) ? MON[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4) : m);
const ymd = (ts) => formatDate(new Date(ts), 'yyyy-MM-dd');
const lower = (v) => String(v == null ? '' : v).toLowerCase();

// ------------------------------------------------------------------ models

const MODELS = {
  invoices: {
    need: 'sales',
    async load(ctx) {
      const r = await erpSales(ctx, { all: true });
      // what each invoice holds, so it can be found by product
      const goods = {};
      for (const l of await salesLog(ctx)) {
        const id = str(l[SL.order_id]);
        if (id) goods[id] = (goods[id] || '') + ' ' + str(l[SL.sku]) + ' ' + str(l[SL.product_name]);
      }
      return r.rows.map((x) => ({
        key: x.id, open: { invoice: x.id },
        id: x.id, ts: x.ts, date: x.date, day: x.ts ? ymd(x.ts) : '', month: x.ts ? ymd(x.ts).slice(0, 7) : '',
        customer: x.customer || 'Walk-in', phone: x.phone, units: x.units, total: x.total, due: x.due, net: x.net,
        delivery: x.delivery || '—', method: x.method || '—',
        status: x.cancelled ? 'Cancelled' : x.allBack ? 'Returned' : x.due > 0.5 ? 'Due' : 'Paid',
        parcel: x.consignment || x.handled ? 'Sent' : x.canSend ? 'To send' : '',
        returned: x.returned, canSend: x.canSend, sent: !!(x.handled || x.fromSite || x.consignment),
        goods: goods[x.id] || '',
        act: { phone: x.phone, name: x.customer || '', due: x.due, canReturn: !x.cancelled && !x.allBack },
      }));
    },
    search: [
      { field: 'id', label: 'Invoice', of: (r) => r.id },
      { field: 'customer', label: 'Customer', of: (r) => r.customer + ' ' + r.phone },
      { field: 'product', label: 'Product', of: (r) => r.goods },
    ],
    filters: [
      { name: 'due', label: 'With a due', set: 'pay', test: (r) => r.due > 0.5 },
      { name: 'paid', label: 'Paid', set: 'pay', test: (r) => r.status === 'Paid' },
      { name: 'tosend', label: 'To send', set: 'ship', test: (r) => r.canSend },
      { name: 'sent', label: 'Sent by courier', set: 'ship', test: (r) => r.sent },
      { name: 'returned', label: 'With returns', set: 'ret', test: (r) => r.returned > 0 },
      { name: 'cancelled', label: 'Cancelled', set: 'ret', test: (r) => r.status === 'Cancelled' },
      { name: 'today', label: 'Today', set: 'date', test: (r, c) => r.day === c.today },
      { name: 'week', label: 'Last 7 days', set: 'date', test: (r, c) => r.day >= c.weekAgo },
      { name: 'month', label: 'This month', set: 'date', test: (r, c) => r.month === c.month },
      { name: 'lastmonth', label: 'Last month', set: 'date', test: (r, c) => r.month === c.lastMonth },
      { name: 'year', label: 'This year', set: 'date', test: (r, c) => r.month.slice(0, 4) === c.month.slice(0, 4) },
    ],
    groups: [
      { field: 'customer', label: 'Customer', of: (r) => [lower(r.phone || r.customer), r.customer] },
      { field: 'month', label: 'Month', of: (r) => [r.month || '—', monthLabel(r.month) || 'No date'], newestFirst: true },
      { field: 'day', label: 'Day', of: (r) => [r.day || '—', r.date || 'No date'], newestFirst: true },
      { field: 'status', label: 'Payment', of: (r) => [r.status, r.status] },
      { field: 'delivery', label: 'Delivery', of: (r) => [r.delivery, r.delivery] },
      { field: 'method', label: 'Paid by', of: (r) => [r.method, r.method] },
    ],
    columns: [
      { key: 'id', label: 'Number', main: true, phone: true },
      { key: 'date', label: 'Date', sort: 'ts' },
      { key: 'customer', label: 'Customer', sub: 'phone', phone: true },
      { key: 'units', label: 'Units', type: 'num', sum: true },
      { key: 'total', label: 'Total', type: 'money', sum: true, phone: true },
      { key: 'due', label: 'Due', type: 'money', sum: true },
      { key: 'delivery', label: 'Delivery', sub: 'parcel' },
      { key: 'status', label: 'Status', type: 'badge' },
    ],
    order: { field: 'ts', dir: 'desc' },
  },

  products: {
    need: 'sales',
    async load(ctx) {
      const manager = roleAtLeast(ctx.s.role, 'manager');
      return (await erpCatalog(ctx)).map((p) => ({
        key: p.sku, open: { product: p.sku },
        sku: p.sku, name: p.name, line2: p.sku + (p.color ? ' · ' + p.color : ''), category: p.cat || '—', brand: p.brand || '—',
        color: p.color, stock: p.stock, sold90: p.sold90, sold: p.sold, sell: p.sell, reorder: p.reorder, suggested: p.suggested,
        cover: p.cover, coverText: p.cover === null ? (p.sold ? 'no recent sales' : 'never sold') : p.cover + ' days',
        lastSoldDays: p.lastSoldDays,
        state: p.state, stateText: p.state === 'out' ? 'Out of stock' : p.state === 'low' ? 'At reorder' : 'In stock',
        status: String(p.status).toLowerCase() === 'discontinued' ? 'Discontinued' : 'Active',
        supplier: manager ? (p.supplier || '—') : undefined,
        act: { canAdd: p.stock > 0 && p.sell > 0 && String(p.status).toLowerCase() !== 'discontinued' },
      }));
    },
    search: [
      { field: 'product', label: 'Product', of: (r) => r.name + ' ' + r.sku },
      { field: 'category', label: 'Category', of: (r) => r.category },
      { field: 'brand', label: 'Brand', of: (r) => r.brand },
      { field: 'color', label: 'Colour', of: (r) => r.color },
    ],
    filters: [
      { name: 'active', label: 'Active', set: 'arch', test: (r) => r.status === 'Active' },
      { name: 'archived', label: 'Discontinued', set: 'arch', test: (r) => r.status === 'Discontinued' },
      { name: 'instock', label: 'In stock', set: 'avail', test: (r) => r.state === 'ok' },
      { name: 'low', label: 'At reorder', set: 'avail', test: (r) => r.state === 'low' },
      { name: 'out', label: 'Out of stock', set: 'avail', test: (r) => r.state === 'out' },
      { name: 'running', label: 'Running out (under 14 days)', set: 'move', test: (r) => r.cover !== null && r.cover < 14 },
      { name: 'dead90', label: 'Not sold in 90 days', set: 'move', test: (r) => r.stock > 0 && (r.lastSoldDays === null || r.lastSoldDays >= 90) },
      { name: 'never', label: 'Never sold', set: 'move', test: (r) => !r.sold },
    ],
    groups: [
      { field: 'category', label: 'Category', of: (r) => [r.category, r.category] },
      { field: 'brand', label: 'Brand', of: (r) => [r.brand, r.brand] },
      { field: 'state', label: 'Availability', of: (r) => [r.state, r.stateText] },
      { field: 'status', label: 'Status', of: (r) => [r.status, r.status] },
      { field: 'supplier', label: 'Supplier', of: (r) => [r.supplier, r.supplier], need: 'manager' },
    ],
    columns: [
      { key: 'name', label: 'Product', sub: 'line2', main: true, phone: true },
      { key: 'category', label: 'Category' },
      { key: 'brand', label: 'Brand' },
      { key: 'stock', label: 'In stock', type: 'num', sum: true, phone: true },
      { key: 'sold90', label: 'Sold 90 days', type: 'num', sum: true },
      { key: 'coverText', label: 'Lasts', sort: 'cover' },
      { key: 'sell', label: 'Price', type: 'money' },
      { key: 'stateText', label: 'Availability', type: 'badge', badge: 'state' },
    ],
    order: { field: 'name', dir: 'asc' },
    defaultFilters: ['active'],
  },

  customers: {
    need: 'sales',
    async load(ctx) {
      const money = roleAtLeast(ctx.s.role, 'manager');
      let byKey = {};
      if (money) { try { byKey = (await erpDues(ctx)).byKey || {}; } catch (_) { byKey = {}; } }
      return (await erpCustomers(ctx)).map((c) => {
        const k = custKey(c.phone, c.name), d = byKey[k] || {};
        const mobile = /^01\d{9}$/.test(String(c.phone || '').replace(/\D/g, '').replace(/^88(?=01)/, '').replace(/^(?=1\d{9}$)/, '0'));
        const lastMonth = c.daysSince === null ? '' : formatDate(new Date(ctx.now.getTime() - c.daysSince * 86400e3), 'yyyy-MM');
        const row = {
          key: c.phone || 'n:' + c.name, open: { customer: c.phone || '', name: c.name || '' },
          name: c.name || '—', phone: c.phone, address: c.address || '', type: c.type || '—', source: c.source || '—', status: c.status || '—',
          orders: c.orders, units: c.units, spent: c.spent, lastOrder: c.lastOrder || 'never bought',
          lastAgo: c.daysSince === null ? '' : c.daysSince === 0 ? 'today' : c.daysSince + ' days ago', daysSince: c.daysSince,
          lastMonth, mobile,
          act: { row: c.row, id: c.id, name: c.name || '', phone: c.phone || '', email: c.email || '', address: c.address || '',
                 type: c.type || '', source: c.source || '', status: c.status || '' },
        };
        if (money) { row.owes = d.due || 0; row.advance = d.credit || 0; row.act.owes = d.due || 0; }
        return row;
      });
    },
    search: [
      { field: 'customer', label: 'Customer', of: (r) => r.name + ' ' + r.phone },
      { field: 'address', label: 'Address', of: (r) => r.address },
    ],
    filters: [
      { name: 'phone', label: 'Has a mobile number', set: 'contact', test: (r) => r.mobile },
      { name: 'walkin', label: 'Walk-in (no number)', set: 'contact', test: (r) => !r.mobile },
      { name: 'once', label: 'Bought only once', set: 'pattern', test: (r) => r.orders === 1 },
      { name: 'repeat', label: 'Repeat buyers', set: 'pattern', test: (r) => r.orders >= 2 },
      { name: 'recent', label: 'Bought in the last 30 days', set: 'recency', test: (r) => r.daysSince !== null && r.daysSince <= 30 },
      { name: 'lapsed', label: 'Not bought in 90 days', set: 'recency', test: (r) => r.daysSince !== null && r.daysSince >= 90 },
      { name: 'never', label: 'Never bought', set: 'recency', test: (r) => r.daysSince === null },
      { name: 'owes', label: 'Owes money', set: 'money', test: (r) => r.owes > 0.5, need: 'manager' },
      { name: 'advance', label: 'Holds an advance', set: 'money', test: (r) => r.advance > 0.5, need: 'manager' },
    ],
    groups: [
      { field: 'lastMonth', label: 'Last purchase', of: (r) => [r.lastMonth || '0000', r.lastMonth ? monthLabel(r.lastMonth) : 'Never bought'], newestFirst: true },
      { field: 'type', label: 'Type', of: (r) => [r.type, r.type] },
      { field: 'source', label: 'Came from', of: (r) => [r.source, r.source] },
      { field: 'status', label: 'Status', of: (r) => [r.status, r.status] },
    ],
    columns: [
      { key: 'name', label: 'Customer', sub: 'phone', main: true, phone: true },
      { key: 'address', label: 'Address' },
      { key: 'orders', label: 'Orders', type: 'num', sum: true },
      { key: 'units', label: 'Units', type: 'num', sum: true },
      { key: 'spent', label: 'Spent', type: 'money', sum: true, phone: true },
      { key: 'lastOrder', label: 'Last order', sub: 'lastAgo', sort: 'daysSince', sortFlip: true },
      { key: 'owes', label: 'Owes', type: 'money', sum: true, need: 'manager' },
    ],
    order: { field: 'spent', dir: 'desc' },
  },
};

// ------------------------------------------------------------------ engine

const allowed = (ctx, x) => !x.need || roleAtLeast(ctx.s.role, x.need);

function specOf(ctx, m) {
  return {
    search: m.search.map((s) => ({ field: s.field, label: s.label })),
    filters: m.filters.filter((f) => allowed(ctx, f)).map((f) => ({ name: f.name, label: f.label, set: f.set })),
    groups: m.groups.filter((g) => allowed(ctx, g)).map((g) => ({ field: g.field, label: g.label })),
    columns: m.columns.filter((c) => allowed(ctx, c)).map((c) => ({ key: c.key, label: c.label, type: c.type || 'text', sub: c.sub || '',
                                                                  sum: !!c.sum, main: !!c.main, phone: !!c.phone, badge: c.badge || '', sort: c.sort || c.key })),
    order: m.order, defaultFilters: m.defaultFilters || [],
  };
}

function compare(a, b) {
  if (a === b) return 0;
  if (a === null || a === undefined || a === '') return 1;           // blanks last, either way
  if (b === null || b === undefined || b === '') return -1;
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
}

export async function erpListView(ctx, payload) {
  payload = payload || {};
  const m = MODELS[str(payload.model)];
  if (!m) throw new Error('Unknown list.');
  if (!roleAtLeast(ctx.s.role, m.need)) throw new Error('Your account does not have access to that.');
  const spec = specOf(ctx, m);

  // the dates the date filters compare with (Dhaka calendar)
  const nowMs = ctx.now.getTime(), month = formatDate(ctx.now, 'yyyy-MM');
  let y = Number(month.slice(0, 4)), mo = Number(month.slice(5, 7)) - 1;
  if (mo < 1) { mo = 12; y--; }
  const c = { today: ymd(nowMs), weekAgo: ymd(nowMs - 6 * 86400e3), month, lastMonth: y + '-' + String(mo).padStart(2, '0') };

  let rows = await m.load(ctx);

  // search facets
  for (const f of Array.isArray(payload.search) ? payload.search : []) {
    const s = m.search.find((x) => x.field === str(f && f.field));
    const vals = ((f && f.values) || []).map((v) => lower(v).trim()).filter(Boolean);
    if (!s || !vals.length) continue;
    rows = rows.filter((r) => { const hay = lower(s.of(r)); return vals.some((v) => hay.indexOf(v) >= 0); });
  }
  // filters: "or" inside a set, "and" between sets
  const sets = {};
  for (const name of Array.isArray(payload.filters) ? payload.filters : []) {
    const f = m.filters.find((x) => x.name === name && allowed(ctx, x));
    if (f) (sets[f.set] = sets[f.set] || []).push(f);
  }
  for (const k of Object.keys(sets)) rows = rows.filter((r) => sets[k].some((f) => f.test(r, c)));

  // order
  const ord = payload.order && payload.order.field ? payload.order : m.order;
  const col = m.columns.find((x) => (x.sort || x.key) === ord.field || x.key === ord.field);
  const field = col ? (col.sort || col.key) : ord.field;
  const dir = (ord.dir === 'asc' ? 1 : -1) * (col && col.sortFlip ? -1 : 1);
  rows.sort((a, b) => dir * compare(a[field], b[field]) || compare(a.key, b.key));

  const sumCols = spec.columns.filter((x) => x.sum).map((x) => x.key);
  const sumOf = (list) => { const o = {}; for (const k of sumCols) { let t = 0; for (const r of list) t += num(r[k]); o[k] = Math.round(t); } return o; };
  const strip = (r) => { const o = { key: r.key, open: r.open, act: r.act }; for (const x of spec.columns) { o[x.key] = r[x.key]; if (x.sub) o[x.sub] = r[x.sub]; if (x.badge) o[x.badge] = r[x.badge]; } return o; };
  const total = rows.length, sums = sumOf(rows);

  // grouped: the groups, or the rows of one of them
  const g = m.groups.find((x) => x.field === str(payload.groupBy) && allowed(ctx, x));
  if (g) {
    const by = new Map();
    for (const r of rows) {
      const [k, label] = g.of(r);
      const key = String(k == null || k === '' ? '—' : k);
      let e = by.get(key);
      if (!e) { e = { key, label: String(label || '—'), rows: [] }; by.set(key, e); }
      e.rows.push(r);
    }
    if (payload.group !== undefined && payload.group !== null && payload.group !== '') {
      const e = by.get(String(payload.group));
      const list = e ? e.rows : [];
      const limit = Math.min(500, Math.max(1, Math.round(num(payload.limit)) || 80));
      const offset = Math.max(0, Math.round(num(payload.offset)) || 0);
      return { spec, total: list.length, offset, limit, rows: list.slice(offset, offset + limit).map(strip) };
    }
    const groups = [...by.values()].map((e) => ({ key: e.key, label: e.label, count: e.rows.length, sums: sumOf(e.rows) }));
    groups.sort((a, b) => (g.newestFirst ? compare(b.key, a.key) : compare(a.label, b.label)));
    return { spec, total, sums, groups };
  }

  // plain: one page
  const limit = payload.exportAll ? 20000 : Math.min(500, Math.max(1, Math.round(num(payload.limit)) || 80));
  const offset = payload.exportAll ? 0 : Math.max(0, Math.round(num(payload.offset)) || 0);
  return { spec, total, sums, offset, limit, rows: rows.slice(offset, offset + limit).map(strip) };
}

export const HANDLERS = { erpListView };
