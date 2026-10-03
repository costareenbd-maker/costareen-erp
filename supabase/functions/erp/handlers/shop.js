// Any website (PHP, Laravel, Shopify app, a builder with webhooks...): the
// "open door", and matching the website's products to ours.
//
// Screens (signed in):
//   erpWebMatches()                       website items not matched yet, with suggestions; links made so far
//   erpWebMatchSet({key, sku})            "this website item is that product" - remembered for good   (manager)
//   erpWebMatchClear({key})               forget a link                                              (manager)
//   erpShopKey({make|remove})             the door's key: shown ONCE when made, kept only as a hash     (owner)
//
// The door (no sign-in; the website's key in the x-shop-key header):
//   GET  .../erp?shop=ping                 who am I talking to
//   GET  .../erp?shop=stock                [{sku, name, qty, price}] - what the website may sell
//   POST .../erp?shop=order                one order {number, created, status, customer, phone, address,
//                                          payment, total, items:[{sku, name, qty, line_total, barcode}]}
//                                          - sent again with a new status (e.g. cancelled) updates it
//   POST .../erp?shop=products             {items:[{sku, name, price, barcode}]} - the website's list,
//                                          so items can be matched before the first order
// Orders land in Web orders exactly like the WordPress plugin's; a person
// still enters each one (that is when stock is deducted).

import { getConfig, setConfig, setSecret, getSecret } from '../lib/ext.js';
import { matcher, extKey, forgetMatcher } from '../lib/match.js';
import { addWebLines, stockItems, webOrdersTab, WO } from './weborders.js';
import { roleAtLeast } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => { const n = Number(v); return isFinite(n) ? n : 0; };

function needManager(ctx) { if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner can match website products.'); }

// ------------------------------------------------------------- matching

export async function erpWebMatches(ctx) {
  needManager(ctx);
  const m = await matcher(ctx);
  const seen = new Map();
  const note = (sku, name, barcode, from, open) => {
    const key = extKey(sku, name);
    if (!key) return;
    const x = seen.get(key) || { key, sku: str(sku) === '(no sku)' ? '' : str(sku), name: str(name), barcode: str(barcode), orders: 0, onSite: false };
    if (from === 'order' && open) x.orders++;
    if (from === 'site') x.onSite = true;
    if (!x.name && name) x.name = str(name);
    seen.set(key, x);
  };
  for (const r of await webOrdersTab(ctx)) note(r[WO.sku], r[WO.product], '', 'order', str(r[WO.entered_in_sheet]).toLowerCase() !== 'yes');
  for (const c of await ctx.tx`select ext_sku, ext_name, barcode from web_catalog where business_id = ${ctx.biz} order by ext_name`) note(c.ext_sku, c.ext_name, c.barcode, 'site');
  const unmatched = [];
  let matched = 0;
  for (const x of seen.values()) {
    if (m.find(x.sku, x.name, x.barcode)) { matched++; continue; }
    unmatched.push({ ...x, suggest: m.suggest(x.sku, x.name, 3) });
  }
  // waiting orders first, then the website's list
  unmatched.sort((a, b) => b.orders - a.orders || a.name.localeCompare(b.name));
  return {
    unmatched, matched,
    links: m.links.map((l) => ({ key: l.ext_key, extSku: str(l.ext_sku), extName: str(l.ext_name), sku: l.sku, name: l.name, by: str(l.made_by) })),
    products: m.products.filter((p) => str(p.status).toLowerCase() !== 'discontinued').map((p) => ({ sku: p.sku, name: p.name })),
  };
}

export async function erpWebMatchSet(ctx, payload) {
  needManager(ctx);
  payload = payload || {};
  const key = str(payload.key);
  if (!key) throw new Error('Which website item?');
  const p = (await ctx.tx`select id, sku, name from products where business_id = ${ctx.biz} and lower(sku) = lower(${str(payload.sku)})`)[0];
  if (!p) throw new Error('No product with SKU ' + str(payload.sku) + '.');
  // stock goes back out under the website's SKU exactly as the website writes it
  let extSku = key.startsWith('name:') ? '' : str(payload.extSku);
  if (!extSku && !key.startsWith('name:')) {
    const seen = await ctx.tx`select ext_sku as s from web_catalog where business_id = ${ctx.biz} and ext_key = ${key} and ext_sku is not null
                              union all select sku from web_order_lines where business_id = ${ctx.biz} and lower(replace(sku, ' ', '')) = ${key} limit 1`;
    extSku = seen.length ? str(seen[0].s) : key;
  }
  await ctx.tx`insert into web_product_links (business_id, ext_key, ext_sku, ext_name, product_id, made_by)
               values (${ctx.biz}, ${key}, ${extSku || null}, ${str(payload.name) || null}, ${p.id}, ${str(ctx.s.name)})
               on conflict (business_id, ext_key) do update set product_id = excluded.product_id, ext_sku = coalesce(excluded.ext_sku, web_product_links.ext_sku),
                 ext_name = coalesce(excluded.ext_name, web_product_links.ext_name), made_by = excluded.made_by, made_at = now()`;
  forgetMatcher(ctx);
  return { ok: true, key, sku: p.sku, name: p.name };
}

export async function erpWebMatchClear(ctx, payload) {
  needManager(ctx);
  const key = str(payload && payload.key);
  const r = await ctx.tx`delete from web_product_links where business_id = ${ctx.biz} and ext_key = ${key} returning ext_key`;
  if (!r.length) throw new Error('That link is not there.');
  forgetMatcher(ctx);
  return { ok: true, key };
}

// ------------------------------------------------------------- the key

async function sha256(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function shopStatus(ctx) {
  return { hasKey: !!(await getSecret(ctx, 'SHOP_KEY_HASH')), last: str(await getConfig(ctx, 'shop_last', '')),
           door: str(ctx.deps && ctx.deps.hookBase) + '?shop=' };
}

export async function erpShopKey(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner manages connections.');
  payload = payload || {};
  if (payload.remove) { await setSecret(ctx, 'SHOP_KEY_HASH', ''); return { ...(await shopStatus(ctx)), key: '' }; }
  if (!payload.make) return shopStatus(ctx);
  const raw = new Uint8Array(24); crypto.getRandomValues(raw);
  const key = 'shop_' + btoa(String.fromCharCode(...raw)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  await setSecret(ctx, 'SHOP_KEY_HASH', await sha256(key));
  return { ...(await shopStatus(ctx)), key };
}

// ------------------------------------------------------------- the door

const MAX_BODY = 1_000_000;

/** One website order (the door's shape) as web-order lines. */
function orderLines(o) {
  const no = str(o.number || o.order_no || o.id);
  if (!no || no.length > 60 || /\s/.test(no)) throw new Error('number: the order number is needed (no spaces, at most 60 characters).');
  const items = Array.isArray(o.items) ? o.items : [];
  if (!items.length || items.length > 200) throw new Error('items: 1 to 200 lines.');
  const total = num(o.total);
  return items.map((it, i) => {
    const qty = num(it.qty ?? it.quantity);
    if (!(qty > 0)) throw new Error('items[' + i + '].qty must be more than 0.');
    if (!str(it.sku) && !str(it.name)) throw new Error('items[' + i + ']: a sku or a name is needed.');
    return { number: no, created: str(o.created || o.date) || new Date().toISOString().slice(0, 19), status: str(o.status) || 'processing',
             customer: str(o.customer || o.name), phone: str(o.phone), address: str(o.address), payment: str(o.payment),
             total, sku: str(it.sku) || (str(it.barcode) || ''), product: str(it.name || it.product), qty,
             line_total: it.line_total !== undefined ? num(it.line_total) : num(it.price) * qty };
  });
}

/**
 * The request from a website. deps: the function's deps; run(row, label, fn)
 * runs fn(ctx) as the business's owner in one transaction (jobs.js asBusiness).
 * Returns {status, body}.
 */
export async function shopDoor(deps, run, owners, req) {
  const url = new URL(req.url);
  const what = str(url.searchParams.get('shop'));
  const key = str(req.headers.get('x-shop-key') || (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, ''));
  if (!/^shop_[A-Za-z0-9_-]{20,}$/.test(key)) return { status: 401, body: { ok: false, error: 'The x-shop-key header is missing or not a shop key.' } };
  const hash = await sha256(key);
  const sql = deps.sqlAux || deps.sql;
  const hit = await sql`select s.business_id, b.suspended_at from business_secrets s join businesses b on b.id = s.business_id
                        where s.key = 'SHOP_KEY_HASH' and s.value = ${hash}`;
  if (!hit.length) return { status: 401, body: { ok: false, error: 'Unknown shop key (it may have been replaced in the ERP).' } };
  if (hit[0].suspended_at) return { status: 403, body: { ok: false, error: 'This business is suspended.' } };
  const row = (await owners(sql, [hit[0].business_id]))[0];
  if (!row) return { status: 403, body: { ok: false, error: 'This business has no owner.' } };

  let body = null;
  if (req.method === 'POST') {
    const text = await req.text();
    if (text.length > MAX_BODY) return { status: 413, body: { ok: false, error: 'Too big: send at most 1 MB per call.' } };
    try { body = JSON.parse(text || '{}'); } catch (_) { return { status: 400, body: { ok: false, error: 'The body is not JSON.' } }; }
  }
  const want = { ping: 'GET', stock: 'GET', order: 'POST', products: 'POST' }[what];
  if (!want) return { status: 404, body: { ok: false, error: 'Unknown: use ?shop=ping, stock, order or products.' } };
  if (req.method !== want) return { status: 405, body: { ok: false, error: '?shop=' + what + ' takes ' + want + '.' } };

  const out = await run(deps, { ...row, who: 'Website' }, 'shop:' + what, async (ctx) => {
    ctx.s.name = 'Website';
    await setConfig(ctx, 'shop_last', new Date().toISOString());
    if (what === 'ping') return { ok: true, business: row.name };
    if (what === 'stock') {
      const items = (await stockItems(ctx)).filter((x) => x.active).map((x) => ({ sku: x.sku, name: x.name, qty: x.qty, price: x.price }));
      return { ok: true, count: items.length, items };
    }
    if (what === 'order') {
      const lines = orderLines(body || {});
      const added = await addWebLines(ctx, lines);
      const m = await matcher(ctx);
      const unmatched = lines.filter((l) => !m.find(l.sku, l.product)).map((l) => l.sku || l.product);
      return { ok: true, order: lines[0].number, added, duplicate: added === 0, unmatched };
    }
    // products
    const items = Array.isArray(body && body.items) ? body.items : [];
    if (!items.length || items.length > 5000) throw new Error('items: 1 to 5000 products.');
    const m = await matcher(ctx);
    let unmatched = 0;
    for (const it of items) {
      const k = extKey(it.sku, it.name);
      if (!k) continue;
      await ctx.tx`insert into web_catalog (business_id, ext_key, ext_sku, ext_name, barcode, price)
                   values (${ctx.biz}, ${k}, ${str(it.sku) || null}, ${str(it.name) || null}, ${str(it.barcode) || null}, ${it.price === undefined ? null : num(it.price)})
                   on conflict (business_id, ext_key) do update set ext_sku = excluded.ext_sku, ext_name = excluded.ext_name,
                     barcode = excluded.barcode, price = excluded.price, seen_at = now()`;
      if (!m.find(it.sku, it.name, it.barcode)) unmatched++;
    }
    return { ok: true, received: items.length, matched: items.length - unmatched, unmatched };
  });
  if (out && out.error && out.ok === undefined) return { status: 400, body: { ok: false, error: out.error } };
  return { status: 200, body: out };
}

export const HANDLERS = { erpWebMatches, erpWebMatchSet, erpWebMatchClear, erpShopKey };
