// Catalogue, lists, form options, one product, customer lookup
// (ERP.js:649-835, 1169-1222).

import { deliveryOptions, guessType, DELIVERY_TYPES, DEFAULT_DELIVERY } from '../lib/delivery.js';
import { setConfig, getConfig } from '../lib/ext.js';
import { roleAtLeast as roleAtLeastC } from '../allow.js';
import { normalizePhone, formatBdPhone } from '../lib/phone.js';
import { DAY_MS } from '../lib/time.js';

/**
 * erpIsCourier_: does this order go out as a Steadfast parcel that this system books?
 * The regular courier does. Steadfast Express does not: it is same-day, booked by hand
 * in Steadfast's own panel, and handled here like any rider.
 */
export function isCourier(delivery) {
  const d = String(delivery || '');
  return /steadfast/i.test(d) && !/express/i.test(d);
}
export const ERP_DELIVERY = DEFAULT_DELIVERY;

// SETTINGS columns A-G as lookup kinds.
export const LIST_KINDS = ['categories', 'brands', 'types', 'suppliers', 'units', 'colors'];

/** JS default sort, as the sheet ERP used (case-sensitive code-unit order). */
function plainSort(list) { return list.sort(); }

/**
 * Every product with its live stock and price, plus the sales-rate analytics
 * the Products screen shows (spec 02 §3).
 *
 * "Sold" reads the same rows SALES_LOG held: every invoice line, and the
 * return notes (RTN-) with negative units on the day the goods came back.
 */
export async function erpCatalog(ctx) {
  if (ctx.memo.catalog) return ctx.memo.catalog.map((p) => ({ ...p }));
  const b = ctx.biz;
  const rows = await ctx.tx`
    select p.sku, p.name, p.category, p.brand, p.color, p.unit, p.supplier, p.family, p.serialised, p.warranty_months,
           p.sell_price, p.wholesale_price, p.reorder_level, p.lead_time_days, p.status,
           coalesce(ps.stock, 0) as stock
    from products p
    left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${b}`;

  // SALES_LOG rows: invoice lines, including the RTN- return notes, which
  // carry -qty for goods back on the shelf (0 for damaged)
  const sold = await ctx.tx`
    select lower(btrim(l.sku)) as k, l.qty, i.created_at as at
    from invoice_lines l join invoices i on i.id = l.invoice_id
    where l.business_id = ${b} and i.voided_at is null
      and coalesce(btrim(l.sku), '') <> ''`;

  const nowMs = ctx.now.getTime();
  const hist = {};
  for (const r of sold) {
    const h = hist[r.k] || (hist[r.k] = { all: 0, d30: 0, d90: 0, d180: 0, d365: 0, last: 0 });
    const q = Number(r.qty) || 0;
    h.all += q;
    const t = r.at ? new Date(r.at).getTime() : 0;
    if (t) {
      const age = (nowMs - t) / DAY_MS;
      if (age <= 30) h.d30 += q;
      if (age <= 90) h.d90 += q;
      if (age <= 180) h.d180 += q;
      if (age <= 365) h.d365 += q;
      if (t > h.last) h.last = t;
    }
  }

  // in a joint pool a wholesale partner sells at the wholesale price, where one is set
  const tier = await ctx.tx`
    select pp.price_tier as tier from businesses b join pool_partners pp on pp.pool_id = b.id
    where b.id = ${b} and b.is_pool and pp.partner_business_id = public.my_partner_in(b.id)`;
  const wholesale = tier.length > 0 && String(tier[0].tier) === 'wholesale';

  const out = rows.map((p) => {
    const sku = String(p.sku || '').trim();
    const stock = Number(p.stock) || 0;
    const rl = Number(p.reorder_level) || 5;     // STOCK_VIEW: a stored 0 or blank shows as 5
    const sell = (wholesale && Number(p.wholesale_price) > 0) ? Number(p.wholesale_price) : (Number(p.sell_price) || 0);
    const state = stock <= 0 ? 'out' : (rl && stock <= rl ? 'low' : 'ok');
    const h = hist[sku.toLowerCase()] || { all: 0, d30: 0, d90: 0, d180: 0, d365: 0, last: 0 };
    const rate = h.d90 > 0 ? h.d90 / 90 : (h.d365 > 0 ? h.d365 / 365 : 0);
    const cover = rate > 0 ? Math.round(stock / rate) : null;
    const lead = Number(p.lead_time_days) > 0 ? Number(p.lead_time_days) : 7;
    const safety = Math.max(1, Math.ceil(lead * 0.5));
    const suggested = rate > 0 ? Math.max(1, Math.ceil(rate * (lead + safety))) : 0;
    return {
      sku,
      name: String(p.name || '').trim(),
      cat: String(p.category || '').trim(),
      brand: String(p.brand || '').trim(),
      color: String(p.color || '').trim(),
      family: String(p.family || '').trim(),
      serialised: !!p.serialised,
      warrantyMonths: p.warranty_months == null ? null : Number(p.warranty_months),
      unit: String(p.unit || '').trim(),
      supplier: String(p.supplier || '').trim(),
      stock,
      available: stock,                // less what is held for pre-orders (below)
      reorder: rl,
      sell,
      state,
      status: String(p.status || 'Active').trim() || 'Active',
      sold: Math.round(h.all),
      sold30: Math.round(h.d30),
      sold90: Math.round(h.d90),
      sold365: Math.round(h.d365),
      rate: Math.round(rate * 1000) / 1000,
      cover,
      lead,
      suggested,
      lastSoldDays: h.last ? Math.floor((nowMs - h.last) / DAY_MS) : null,
    };
  });
  // 115: units that arrived for an open pre-order are held for it: not available to anyone else
  try {
    const { heldMap } = await import('./preorders.js');
    const hm = await ctx.tx.savepoint(() => heldMap(ctx));
    for (const p of out) {
      const h = hm[p.sku.toLowerCase()];
      if (h && h.held > 0) { p.available = Math.max(0, p.stock - h.held); p.held = h.held; p.heldFor = h.nos.map((n, k) => n + ' (' + h.who[k] + ')').join(', '); }
    }
  } catch (_) { /* before 115: nothing is held */ }
  out.sort((a, c) => (a.name < c.name ? -1 : a.name > c.name ? 1 : 0));
  ctx.memo.catalog = out;
  return out.map((p) => ({ ...p }));
}

/** The dropdown lists (SETTINGS A-F), de-duplicated case-insensitively. */
export async function erpSettingsLists(ctx) {
  const rows = await ctx.tx`
    select kind, value from lookups
    where business_id = ${ctx.biz} and kind = any(${LIST_KINDS})
    order by sort_order, value collate "C"`;
  const out = {};
  for (const k of LIST_KINDS) {
    const seen = {}, list = [];
    for (const r of rows) {
      if (r.kind !== k) continue;
      const v = String(r.value || '').trim();
      if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = 1; list.push(v); }
    }
    out[k] = plainSort(list);
  }
  return out;
}

/** Dropdown choices for the invoice form. */
export async function erpFormOptions(ctx) {
  const rows = await ctx.tx`
    select value from lookups
    where business_id = ${ctx.biz} and kind = 'payment_methods'
    order by sort_order, value collate "C"`;
  const pay = [];
  for (const r of rows) {
    const v = String(r.value || '').trim();
    if (v && pay.indexOf(v) === -1) pay.push(v);
  }
  return {
    paymentMethods: pay.length ? pay : ['Cash', 'bKash', 'Bangla QR', 'Bank Transfer'],
    paymentStatuses: ['Pending', 'Paid', 'Partial'],
    sources: (await deliveryOptions(ctx)).map((o) => o.name),
    deliveryTypes: Object.fromEntries((await deliveryOptions(ctx)).map((o) => [o.name, o.type])),
    currency: String((await getConfig(ctx, 'currency', 'BDT')) || 'BDT').trim().toUpperCase() || 'BDT',
  };
}

/**
 * The delivery list with its types (Settings > Lists).
 * erpDeliveryOptionsSave({options:[{name, type}]}) - manager or owner.
 */
export async function erpDeliveryOptions(ctx) {
  return { options: await deliveryOptions(ctx), types: DELIVERY_TYPES };
}
export async function erpDeliveryOptionsSave(ctx, payload) {
  if (!roleAtLeastC(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner changes the delivery list.');
  const list = Array.isArray(payload && payload.options) ? payload.options : [];
  const seen = {}, out = [];
  for (const o of list) {
    const name = String((o && o.name) || '').trim().replace(/\s+/g, ' ');
    if (!name) continue;
    if (name.length > 40) throw new Error('"' + name.slice(0, 40) + '\u2026" is too long for a delivery name (40 letters).');
    if (seen[name.toLowerCase()]) continue;
    seen[name.toLowerCase()] = 1;
    out.push({ name, type: DELIVERY_TYPES[o.type] ? o.type : guessType(name) });
  }
  if (!out.length) throw new Error('Keep at least one delivery option.');
  if (out.length > 30) throw new Error('At most 30 delivery options.');
  await setConfig(ctx, 'delivery_options', JSON.stringify(out));
  delete ctx.memo.delivery;
  return erpDeliveryOptions(ctx);
}

/** One product's full editable record, or null. */
export async function erpProduct(ctx, sku) {
  const key = String(sku || '').trim().toLowerCase();
  const r = await ctx.tx`
    select * from products
    where business_id = ${ctx.biz} and lower(btrim(sku)) = ${key}
    limit 1`;
  const p = r[0];
  if (!p) return null;
  return {
    row: p.id,
    sku: String(p.sku || '').trim(),
    product_name: String(p.name || '').trim(),
    category: String(p.category || '').trim(),
    brand: String(p.brand || '').trim(),
    type: String(p.type || '').trim(),
    color: String(p.color || '').trim(),
    unit: String(p.unit || '').trim(),
    supplier: String(p.supplier || '').trim(),
    cost_price: Number(p.cost_price) || 0,
    sell_price: Number(p.sell_price) || 0,
    wholesale_price: Number(p.wholesale_price) || 0,
    reorder_level: Number(p.reorder_level) || 0,
    lead_time_days: Number(p.lead_time_days) || 0,
    location_bin: String(p.location_bin || '').trim(),
    status: String(p.status || 'Active').trim(),
  };
}

/**
 * Customer autofill by the last 10 digits of the phone, so 01712...,
 * 8801712... and +8801712... all find the same person.
 */
export async function erpLookupCustomer(ctx, phone) {
  const key = normalizePhone(phone);
  if (!key) return null;
  const r = await ctx.tx`
    select name, phone, address, total_orders, total_spent, source
    from customers
    where business_id = ${ctx.biz}
      and right(regexp_replace(coalesce(phone, ''), '[^0-9]', '', 'g'), 10) = ${key}
    order by created_at
    limit 1`;
  const c = r[0];
  if (!c) return null;
  return {
    name: String(c.name || '').trim(),
    phone: formatBdPhone(String(c.phone || '').trim()),
    address: String(c.address || '').trim(),
    orders: Number(c.total_orders) || 0,
    spent: Math.round(Number(c.total_spent) || 0),
    source: String(c.source || '').trim(),
  };
}
