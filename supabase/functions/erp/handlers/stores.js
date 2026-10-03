// WooCommerce (without the Costareen plugin) and Shopify, through their own
// standard APIs. Chosen in Settings > Connections > Website (website_kind).
//
//   WooCommerce: store_url = https://shop.com; secrets WOO_KEY / WOO_SECRET
//                (WooCommerce > Settings > Advanced > REST API, Read/Write)
//   Shopify:     store_url = https://name.myshopify.com; secret SHOPIFY_TOKEN
//                (a custom app's Admin API token: read_orders, read_products,
//                 write_inventory, read_locations)
//
// storePull(ctx)        the last 7 days' orders (new or changed) into Web orders - same rows as the plugin's
// storePush(ctx, mode)  every shop item matched to a product gets that product's stock
//                       (less website orders not entered yet); 'apply' changes the shop, else a dry run
// storeTest(ctx)        one harmless read
// Items are matched with lib/match.js (link > same SKU > barcode); unmatched items are never touched.

import { getSecret, getConfig, httpFetch } from '../lib/ext.js';
import { matcher, extKey } from '../lib/match.js';
import { addWebLines, stockItems } from './weborders.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };
const LOOKBACK_DAYS = 7;
const SHOPIFY_API = '2024-10';
const SHOPIFY_SETS_PER_RUN = 60;   // Shopify allows ~2 calls a second; the rest go next run

export async function storeKind(ctx) { return str(await getConfig(ctx, 'website_kind', '')) || 'plugin'; }

async function conn(ctx) {
  const kind = await storeKind(ctx);
  const url = str(await getConfig(ctx, 'store_url', '')).replace(/\/+$/, '');
  if (kind === 'woo') {
    const k = await getSecret(ctx, 'WOO_KEY'), s = await getSecret(ctx, 'WOO_SECRET');
    if (!url || !k || !s) throw new Error('WooCommerce is not set up: the shop address and both keys are needed.');
    return { kind, url, api: url + '/wp-json/wc/v3/', headers: { Authorization: 'Basic ' + btoa(k + ':' + s), 'Content-Type': 'application/json' } };
  }
  if (kind === 'shopify') {
    const t = await getSecret(ctx, 'SHOPIFY_TOKEN');
    if (!url || !t) throw new Error('Shopify is not set up: the shop address and the Admin API token are needed.');
    return { kind, url, api: url + '/admin/api/' + SHOPIFY_API + '/', headers: { 'X-Shopify-Access-Token': t, 'Content-Type': 'application/json' } };
  }
  throw new Error('This business uses the WordPress sync plugin, not a store connection.');
}

async function call(ctx, c, method, path, body) {
  const r = await httpFetch(ctx, /^https?:/.test(path) ? path : c.api + path, { method, headers: c.headers, body });
  const shop = c.kind === 'woo' ? 'WooCommerce' : 'Shopify';
  if (r.code === 0) throw new Error('The shop could not be reached: ' + str(r.text).slice(0, 160));
  if (r.code === 401 || r.code === 403) throw new Error(shop + ' refused the keys (' + r.code + '). Check them, and that they may read orders and products and change stock.');
  if (r.code === 404) throw new Error(shop + ' answered "not found" - check the shop address.');
  if (r.code === 429) throw new Error(shop + ' says too many requests; the next run carries on.');
  if (r.code < 200 || r.code >= 300) throw new Error(shop + ' answered ' + r.code + ': ' + str(r.text).slice(0, 200));
  return r;
}

/** Shopify pages: the next page's address from the Link header. */
const nextLink = (r) => { const m = /<([^>]+)>;\s*rel="next"/.exec(str(r.link)); return m ? m[1] : ''; };

export async function storeTest(ctx) {
  try {
    const c = await conn(ctx);
    if (c.kind === 'woo') {
      await call(ctx, c, 'GET', 'products?per_page=1');
      await call(ctx, c, 'GET', 'orders?per_page=1');
      return { ok: true, reply: 'WooCommerce at ' + c.url.replace(/^https:\/\//, '') };
    }
    const r = await call(ctx, c, 'GET', 'shop.json');
    await call(ctx, c, 'GET', 'orders.json?limit=1&status=any');
    return { ok: true, reply: 'Shopify: ' + str(r.json && r.json.shop && r.json.shop.name) };
  } catch (e) { return { ok: false, error: String((e && e.message) || e) }; }
}

// ------------------------------------------------------------- orders in

function wooLines(o) {
  const b = o.billing || {}, s = o.shipping || {};
  const head = { number: str(o.number || o.id), created: str(o.date_created), status: str(o.status),
    customer: str([s.first_name || b.first_name, s.last_name || b.last_name].filter(Boolean).join(' ')),
    phone: str(s.phone || b.phone), address: [s.address_1 || b.address_1, s.address_2 || b.address_2, s.city || b.city].map(str).filter(Boolean).join(', '),
    payment: str(o.payment_method_title || o.payment_method), total: num(o.total) };
  return (o.line_items || []).map((l) => ({ ...head, sku: str(l.sku), product: str(l.name), qty: num(l.quantity), line_total: num(l.total) + num(l.total_tax) }));
}

function shopifyLines(o) {
  const s = o.shipping_address || o.billing_address || {}, cu = o.customer || {};
  const paid = /paid/.test(str(o.financial_status)) && !/partially|refunded/.test(str(o.financial_status));
  const head = { number: str(o.order_number || o.name).replace(/^#/, ''), created: str(o.created_at),
    status: o.cancelled_at ? 'cancelled' : str(o.fulfillment_status || o.financial_status || 'open'),
    customer: str(s.name || [cu.first_name, cu.last_name].filter(Boolean).join(' ')),
    phone: str(s.phone || o.phone || cu.phone), address: [s.address1, s.address2, s.city].map(str).filter(Boolean).join(', '),
    // a paid card order reads as paid; "Cash on Delivery (COD)" as COD (weborders.webPayment)
    payment: str((o.payment_gateway_names || []).join(', ')) + (paid && !/cash on delivery|cod/i.test((o.payment_gateway_names || []).join(' ')) ? ' (paid online)' : ''),
    total: num(o.total_price) };
  return (o.line_items || []).map((l) => {
    const off = (l.discount_allocations || []).reduce((a, d) => a + num(d.amount), 0) || num(l.total_discount);
    return { ...head, sku: str(l.sku), product: str(l.name || [l.title, l.variant_title].filter(Boolean).join(' - ')), qty: num(l.quantity), line_total: num(l.price) * num(l.quantity) - off };
  });
}

export async function storePull(ctx) {
  const c = await conn(ctx);
  const since = new Date(Date.now() - LOOKBACK_DAYS * 86400000).toISOString().slice(0, 19);
  const lines = [];
  let orders = 0;
  if (c.kind === 'woo') {
    for (let p = 1; p <= 5; p++) {
      const r = await call(ctx, c, 'GET', 'orders?per_page=100&page=' + p + '&orderby=date&order=asc&modified_after=' + encodeURIComponent(since));
      const got = Array.isArray(r.json) ? r.json : [];
      orders += got.length;
      for (const o of got) if (o.status !== 'checkout-draft') lines.push(...wooLines(o));
      if (got.length < 100) break;
    }
  } else {
    let next = 'orders.json?status=any&limit=250&updated_at_min=' + encodeURIComponent(since + 'Z');
    for (let p = 0; next && p < 4; p++) {
      const r = await call(ctx, c, 'GET', next);
      const got = (r.json && r.json.orders) || [];
      orders += got.length;
      for (const o of got) lines.push(...shopifyLines(o));
      next = nextLink(r);
    }
  }
  const added = await addWebLines(ctx, lines.filter((l) => l.number && l.qty > 0));
  return { ok: true, fetched: lines.length, orders, added };
}

// ------------------------------------------------------------- stock out

/** Every item the shop sells: {ref, parent, sku, name, qty, tracked, price, barcode}. */
async function shopItems(ctx, c) {
  const out = [];
  if (c.kind === 'woo') {
    for (let p = 1; p <= 30; p++) {
      const r = await call(ctx, c, 'GET', 'products?per_page=100&status=publish&page=' + p);
      const got = Array.isArray(r.json) ? r.json : [];
      for (const x of got) {
        if (x.type === 'variable') {
          for (let q = 1; q <= 5; q++) {
            const v = await call(ctx, c, 'GET', 'products/' + x.id + '/variations?per_page=100&page=' + q);
            const vs = Array.isArray(v.json) ? v.json : [];
            for (const y of vs) out.push({ ref: y.id, parent: x.id, sku: str(y.sku), name: str(x.name) + ' - ' + (y.attributes || []).map((a) => str(a.option)).join(' '),
                                           qty: y.stock_quantity == null ? null : num(y.stock_quantity), tracked: !!y.manage_stock, price: num(y.price), barcode: '' });
            if (vs.length < 100) break;
          }
        } else if (x.type === 'simple' || !x.type) {
          out.push({ ref: x.id, parent: 0, sku: str(x.sku), name: str(x.name), qty: x.stock_quantity == null ? null : num(x.stock_quantity), tracked: !!x.manage_stock, price: num(x.price), barcode: '' });
        }
      }
      if (got.length < 100) break;
    }
  } else {
    let next = 'products.json?limit=250&fields=id,title,variants';
    for (let p = 0; next && p < 20; p++) {
      const r = await call(ctx, c, 'GET', next);
      for (const x of (r.json && r.json.products) || []) {
        for (const v of x.variants || []) {
          const vt = str(v.title);
          out.push({ ref: v.inventory_item_id, parent: x.id, sku: str(v.sku), name: str(x.title) + (vt && vt !== 'Default Title' ? ' - ' + vt : ''),
                     qty: num(v.inventory_quantity), tracked: v.inventory_management === 'shopify', price: num(v.price), barcode: str(v.barcode) });
        }
      }
      next = nextLink(r);
    }
  }
  return out;
}

export async function storePush(ctx, mode) {
  const c = await conn(ctx);
  const apply = mode === 'apply';
  const items = await shopItems(ctx, c);
  // the shop's list is kept, so its items can be matched before the first order
  for (const it of items) {
    const k = extKey(it.sku, it.name);
    if (!k) continue;
    await ctx.tx`insert into web_catalog (business_id, ext_key, ext_sku, ext_name, barcode, price)
                 values (${ctx.biz}, ${k}, ${it.sku || null}, ${it.name || null}, ${it.barcode || null}, ${it.price})
                 on conflict (business_id, ext_key) do update set ext_sku = excluded.ext_sku, ext_name = excluded.ext_name,
                   barcode = excluded.barcode, price = excluded.price, seen_at = now()`;
  }
  const m = await matcher(ctx);
  const qtyBySku = {};
  for (const s of await stockItems(ctx)) if (!s.ours) qtyBySku[s.sku.toLowerCase()] = s.qty;
  const change = [];
  let matched = 0, missing = 0, untracked = 0;
  for (const it of items) {
    const hit = m.find(it.sku, it.name, it.barcode);
    if (!hit) { missing++; continue; }
    matched++;
    const want = qtyBySku[str(hit.product.sku).toLowerCase()];
    if (want === undefined) continue;
    if (c.kind === 'shopify' && !it.tracked) { untracked++; continue; }
    if (it.tracked && it.qty === want) continue;
    change.push({ ...it, want });
  }
  let done = 0, more = 0;
  if (apply && change.length) {
    if (c.kind === 'woo') {
      const groups = {};
      for (const x of change) (groups[x.parent] = groups[x.parent] || []).push({ id: x.ref, manage_stock: true, stock_quantity: x.want });
      for (const [parent, list] of Object.entries(groups)) {
        for (let i = 0; i < list.length; i += 100) {
          await call(ctx, c, 'POST', parent === '0' ? 'products/batch' : 'products/' + parent + '/variations/batch', { update: list.slice(i, i + 100) });
          done += list.slice(i, i + 100).length;
        }
      }
    } else {
      let loc = str(await getConfig(ctx, 'shopify_location', ''));
      if (!loc) {
        const r = await call(ctx, c, 'GET', 'locations.json');
        const l = ((r.json && r.json.locations) || []).find((x) => x.active !== false);
        if (!l) throw new Error('Shopify has no active location to hold the stock.');
        loc = String(l.id);
      }
      for (const x of change.slice(0, SHOPIFY_SETS_PER_RUN)) {
        await call(ctx, c, 'POST', 'inventory_levels/set.json', { location_id: Number(loc), inventory_item_id: x.ref, available: x.want });
        done++;
      }
      more = Math.max(0, change.length - SHOPIFY_SETS_PER_RUN);
    }
  }
  return { ok: true, sent: matched, changed_count: apply ? done : change.length, unchanged: matched - change.length - untracked,
           missing_count: missing, untracked, more,
           changes: change.slice(0, 20).map((x) => ({ sku: x.sku, name: x.name, from: x.qty, to: x.want })) };
}
