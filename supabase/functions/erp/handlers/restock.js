// Waiting orders: restock from the market (2026-10-06).
//
// A customer wants more than is on the shelf. The order is kept as a "waiting order", the missing goods are asked
// for on the market (one request per short product, to the shop chosen), and when they are received the order is
// ready: one click makes it a normal invoice (stock out, PDF, courier) - one parcel to the customer.
//
//   erpRestockOffers({items: [{sku, qty}]})       which lines are short, and who on the market has them (best first)
//   erpRestockStart({customer, items, picks, phone, note})   keep the order waiting + ask the chosen shops
//   erpRestockList()                              waiting / ready orders, each request's state, ready or not
//   erpRestockCancel({id, reason})                give the order up; requests not yet invoiced are cancelled
//   (createInvoice payload.restockId marks the order invoiced - invoice.js)
//
// Nothing is reserved while an order waits: if the other goods are sold meanwhile it shows as short again.

import { round2 } from '../lib/time.js';
import { words, sourceOf, STALE_DAYS, erpMarketAsk, erpMarketClose } from './market.js';

const str = (v) => String(v == null ? '' : v).trim();
const num = (v) => Number(v) || 0;
const isId = (v) => /^[0-9a-f-]{36}$/i.test(String(v || ''));

/** This business's own products by code (joint lines are not restocked: they belong to a pool). */
async function ownProducts(ctx, skus) {
  const list = [...new Set(skus.map((s) => str(s).toLowerCase()).filter((s) => s && !/~j[0-9a-f]{4}$/.test(s)))];
  if (!list.length) return {};
  const rows = await ctx.tx`select p.sku, p.name, p.unit, coalesce(ps.stock, 0) as stock from products p left join product_stock ps on ps.product_id = p.id
                            where p.business_id = ${ctx.biz} and lower(btrim(p.sku)) = any(${list})`;
  const out = {};
  for (const r of rows) out[str(r.sku).toLowerCase()] = { sku: str(r.sku), name: str(r.name), unit: str(r.unit), stock: num(r.stock) };
  return out;
}

/** Market listings this business may ask (the Market list's own rule), with the reference a request needs. */
async function listings(ctx) {
  const src = sourceOf(ctx.deps);
  if (!src) throw new Error('The market works only for ERPs run by the provider.');
  const conf = (await ctx.tx`select key, value from business_config where business_id = ${ctx.biz} and key in ('market_share_on', 'market_city', 'market_phone')`)
    .reduce((o, r) => { o[r.key] = str(r.value); return o; }, {});
  const rows = await ctx.deps.control`
    select md5(l.source || ':' || l.product_id::text) as ref, l.name, l.brand, l.band, l.price, l.city, l.unit
      from erp_market_listings l left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
     where not (l.source = ${src} and l.business_id = ${ctx.biz})
       and l.updated_at > now() - make_interval(days => ${STALE_DAYS})
       and (l.source = 'self' or (${conf.market_share_on === '1'} and t.status = 'active'))
     limit 5000`;
  return { rows, city: conf.market_city || '', phone: conf.market_phone || '' };
}

/** Short lines of an order, each with the shops that list the same product: in stock first, then same city, then price. */
export async function erpRestockOffers(ctx, payload) {
  const items = ((payload && payload.items) || []).filter((i) => i && str(i.sku) && num(i.qty) > 0);
  const own = await ownProducts(ctx, items.map((i) => i.sku));
  const want = {};
  for (const i of items) { const k = str(i.sku).toLowerCase(); if (own[k]) want[k] = (want[k] || 0) + num(i.qty); }
  const short = Object.keys(want).filter((k) => want[k] > own[k].stock);
  if (!short.length) return { lines: [], phone: '' };
  const L = await listings(ctx);
  const lines = short.map((k) => {
    const p = own[k], key = words(p.name).join(' ');
    const offers = key ? L.rows.filter((l) => words(l.name).join(' ') === key) : [];
    offers.sort((a, b) => (a.band === 'in' ? 0 : 1) - (b.band === 'in' ? 0 : 1) ||
                         (a.city && a.city === L.city ? 0 : 1) - (b.city && b.city === L.city ? 0 : 1) ||
                         (a.price == null ? 1e12 : num(a.price)) - (b.price == null ? 1e12 : num(b.price)));
    return { sku: p.sku, name: p.name, unit: p.unit, have: p.stock, need: round2(want[k] - p.stock),
             offers: offers.slice(0, 5).map((o) => ({ ref: o.ref, name: str(o.name), band: str(o.band), price: o.price == null ? null : num(o.price), city: str(o.city) })) };
  });
  return { lines, phone: L.phone };
}

/** Keep the order waiting and ask the chosen shops for what is missing. */
export async function erpRestockStart(ctx, payload) {
  const p = payload || {}, c = p.customer || {};
  const name = str(c.name);
  if (!name) throw new Error('Customer name is required.');
  const items = (p.items || []).filter((i) => i && str(i.sku) && num(i.qty) > 0).map((i) => ({ sku: str(i.sku), qty: num(i.qty), discEach: num(i.discEach) }));
  if (!items.length) throw new Error('The order has no products.');
  const picks = (p.picks || []).filter((x) => x && str(x.sku) && str(x.ref));
  if (!picks.length) throw new Error('Choose a shop for each missing product.');
  const offers = await erpRestockOffers(ctx, { items });
  const short = [];
  for (const line of offers.lines) {
    const pick = picks.find((x) => str(x.sku).toLowerCase() === line.sku.toLowerCase());
    if (!pick) throw new Error(line.name + ': choose a shop for the ' + line.need + ' missing.');
    if (!line.offers.some((o) => o.ref === str(pick.ref))) throw new Error(line.name + ': that shop no longer lists it. Look again.');
    const qty = Math.max(line.need, Math.round(num(pick.qty)) || 0);
    const r = await erpMarketAsk(ctx, { ref: pick.ref, qty, phone: p.phone, note: ('For a customer order (' + name + ')' + (str(p.note) ? ' - ' + str(p.note) : '')).slice(0, 500) });
    short.push({ sku: line.sku, name: line.name, need: line.need, asked: qty, request: r.request.id });
  }
  if (!short.length) throw new Error('Nothing is missing - save it as a normal invoice.');
  const row = (await ctx.tx`
    insert into restock_orders (business_id, customer_name, phone, address, source, items, short, note, created_by)
    values (${ctx.biz}, ${name.slice(0, 120)}, ${str(c.phone).slice(0, 30) || null}, ${str(c.address).slice(0, 300) || null}, ${str(c.source).slice(0, 60) || null},
            ${ctx.tx.json(items)}, ${ctx.tx.json(short)}, ${str(p.note).slice(0, 300) || null}, ${str(ctx.s.name) || null})
    returning id`)[0];
  return { ok: true, id: row.id, asked: short.length, ...(await erpRestockList(ctx)) };
}

/** Every open waiting order: each request's state, and whether the whole order is on the shelf now. */
export async function erpRestockList(ctx) {
  const rows = await ctx.tx`select * from restock_orders where business_id = ${ctx.biz} and status in ('waiting', 'ready') order by created_at`;
  if (!rows.length) return { orders: [], ready: 0 };
  const ids = rows.flatMap((r) => (r.short || []).map((s) => s.request)).filter(isId);
  const reqs = {};
  if (ids.length && ctx.deps.control) {
    for (const q of await ctx.deps.control`select id, status, price, delivery, qty, seller_name, seller_phone, quoted_at, valid_until, invoice_no from erp_market_requests where id = any(${ids})`) reqs[q.id] = q;
  }
  const own = await ownProducts(ctx, rows.flatMap((r) => (r.items || []).map((i) => i.sku)));
  const SAY = { asked: 'asked - waiting for a price', quoted: 'price given - accept it', accepted: 'accepted - waiting for their invoice', invoiced: 'on the way - press Received when it arrives',
                received: 'received', declined: 'the shop said no', cancelled: 'cancelled' };
  const out = [];
  let ready = 0;
  for (const r of rows) {
    const need = {};
    for (const i of r.items || []) { const k = str(i.sku).toLowerCase(); need[k] = (need[k] || 0) + num(i.qty); }
    const missing = Object.keys(need).filter((k) => !own[k] || own[k].stock < need[k]).map((k) => ({ sku: own[k] ? own[k].sku : k, name: own[k] ? own[k].name : k, have: own[k] ? own[k].stock : 0, need: need[k] }));
    const status = missing.length ? 'waiting' : 'ready';
    if (status !== r.status) await ctx.tx`update restock_orders set status = ${status}, updated_at = now() where id = ${r.id}`;
    if (status === 'ready') ready++;
    out.push({ id: r.id, customer: str(r.customer_name), phone: str(r.phone), address: str(r.address), source: str(r.source), note: str(r.note),
               items: (r.items || []).map((i) => ({ ...i, name: own[str(i.sku).toLowerCase()] ? own[str(i.sku).toLowerCase()].name : i.sku })),
               when: r.created_at, status, missing,
               requests: (r.short || []).map((s) => { const q = reqs[s.request] || {}; return { sku: s.sku, name: s.name, qty: num(s.asked || s.need), request: s.request,
                 state: str(q.status) || 'gone', say: SAY[q.status] || 'not found', price: q.price == null ? null : num(q.price), delivery: num(q.delivery),
                 shop: q.quoted_at ? str(q.seller_name) : 'Supplier', phone: q.quoted_at ? str(q.seller_phone) : '' }; }) });
  }
  return { orders: out, ready };
}

/** Give a waiting order up. Requests not yet invoiced are cancelled; goods already invoiced still come and stay on the shelf. */
export async function erpRestockCancel(ctx, payload) {
  const id = str(payload && payload.id), reason = str(payload && payload.reason).slice(0, 300);
  if (!isId(id)) throw new Error('Which waiting order?');
  const r = (await ctx.tx`select * from restock_orders where id = ${id} and business_id = ${ctx.biz}`)[0];
  if (!r || !['waiting', 'ready'].includes(r.status)) throw new Error('That waiting order is not open.');
  for (const s of r.short || []) {
    try { await ctx.tx.savepoint(() => erpMarketClose(ctx, { id: s.request, side: 'buyer', reason: 'customer order cancelled' })); } catch (_) { /* invoiced or already closed: it stays */ }
  }
  await ctx.tx`update restock_orders set status = 'cancelled', reason = ${reason || null}, updated_at = now() where id = ${id}`;
  return erpRestockList(ctx);
}

/** invoice.js: the invoice made from a waiting order closes it. */
export async function restockInvoiced(ctx, id, invoiceNo) {
  if (!isId(id)) return;
  await ctx.tx`update restock_orders set status = 'invoiced', invoice_no = ${invoiceNo}, updated_at = now()
               where id = ${id} and business_id = ${ctx.biz} and status in ('waiting', 'ready')`;
}

export const HANDLERS = { erpRestockOffers, erpRestockStart, erpRestockList, erpRestockCancel };
