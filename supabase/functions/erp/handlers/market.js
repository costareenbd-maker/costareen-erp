// Stage 2 (docs/PLATFORM-BLUEPRINT.md section 8): the open market.
//
//   erpMarket({q, category})   the Market tab: listings from the provider's own businesses (always) and, when this
//                              business shares its own stock, from every other sharing business. Seller shown as
//                              "Supplier · <city>"; no names, no exact quantities, no cost.
//   erpMarketMine()            owner: the switch, the city, and every product with its "shared" mark
//   erpMarketSave({on, city, products: [{id, shared, mode}]})   owner: saves, then lists at once
//   marketRefresh(ctx)         copies this business's shared products into the central list (also every 15 min)
//
// The central list (erp_market_listings) is on the provider's database (deps.control); a company's own
// database holds only its choices (market_shares + business_config).
//
// Stage 3 - a deal between two ERPs (erp_market_requests, provider's database), each side's books in its own ERP:
//   erpMarketAsk({ref, qty, note, phone})                 buyer: a request for a listing (its name + phone go to the seller)
//   erpMarketRequests()                                   both lists: asked of me (seller), I asked (buyer), and what waits for me
//   erpMarketQuote({id, price, delivery, note, phone, days})  seller: price; also a quotation in its own Quotations
//   erpMarketAccept({id})                                 buyer: takes the quote
//   erpMarketInvoice({id})                                seller: the invoice in its own Sales (due, at the quoted price)
//   erpMarketReceive({id, sku | newProduct})              buyer: the stock entry + the bill owed to the seller
//   erpMarketClose({id, reason})                          seller declines / buyer cancels, before the invoice
//   erpMarketRate({id, stars, note})                      buyer rates the seller after the invoice

import { roleAtLeast } from '../allow.js';
import { todayStr, round2 } from '../lib/time.js';

const str = (v) => String(v == null ? '' : v).trim();
const STALE_DAYS = 3;          // a seller not refreshed for this long drops out of the market
const LIMIT = 300;

/** Who is listing: the provider's own businesses are 'self', a company on the bridge its install id. */
function sourceOf(deps) {
  if (!deps || !deps.control) return null;
  const ins = deps.install || {};
  if (ins.bridged) return str(ins.id);
  if (ins.id) return null;     // an old stand-alone copy with its own server: no market there
  return 'self';
}
function needMarket(ctx) {
  const src = sourceOf(ctx.deps);
  if (!src) throw new Error('The market works only for ERPs run by the provider.');
  return src;
}
async function conf(tx, biz) {
  const rows = await tx`select key, value from business_config where business_id = ${biz} and key in ('market_share_on', 'market_city')`;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { on: m.market_share_on === '1', city: str(m.market_city) };
}
const band = (stock, reorder) => (stock <= Math.max(Number(reorder) || 0, 2) ? 'low' : 'in');

/** Copy this business's shared, in-stock products into the market (or take them all out when sharing is off). */
export async function marketRefresh(ctx) {
  const src = sourceOf(ctx.deps);
  if (!src) return { skipped: true };
  const c = await conf(ctx.tx, ctx.biz);
  const rows = c.on ? await ctx.tx`
      select p.id, p.name, p.category, p.brand, p.color, p.unit, p.sell_price, p.reorder_level, coalesce(ps.stock, 0) as stock, m.price_mode
        from market_shares m join products p on p.id = m.product_id and p.business_id = m.business_id
        left join product_stock ps on ps.product_id = p.id
       where m.business_id = ${ctx.biz} and coalesce(p.status, 'Active') = 'Active'` : [];
  const list = rows.filter((r) => Number(r.stock) > 0).map((r) => ({
    source: src, business_id: ctx.biz, product_id: r.id, name: str(r.name), category: str(r.category) || null, brand: str(r.brand) || null,
    color: str(r.color) || null, unit: str(r.unit) || null, band: band(Number(r.stock), r.reorder_level),
    price: r.price_mode === 'ask' || !(Number(r.sell_price) > 0) ? null : Number(r.sell_price), city: c.city || null,
  }));
  const ctl = ctx.deps.control;
  await ctl.begin(async (t) => {
    await t`delete from erp_market_listings where source = ${src} and business_id = ${ctx.biz}`;
    if (list.length) await t`insert into erp_market_listings ${t(list, 'source', 'business_id', 'product_id', 'name', 'category', 'brand', 'color', 'unit', 'band', 'price', 'city')}`;
  });
  return { listed: list.length, on: c.on };
}

export async function erpMarket(ctx, payload) {
  const src = needMarket(ctx);
  const p = payload || {};
  const q = str(p.q).slice(0, 80), cat = str(p.category).slice(0, 80);
  const c = await conf(ctx.tx, ctx.biz);
  const ctl = ctx.deps.control;
  const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  // the provider's stock is always visible; other sellers only to a business that shares its own
  const rows = await ctl`
    select l.name, l.category, l.brand, l.color, l.unit, l.band, l.price, l.city, l.updated_at,
           md5(l.source || ':' || l.product_id::text) as ref, rt.stars, rt.n
      from erp_market_listings l
      left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
      left join lateral (select round(avg(r.rating)::numeric, 1) as stars, count(r.rating)::int as n from erp_market_requests r
                          where r.seller_source = l.source and r.seller_business = l.business_id and r.rating is not null) rt on true
     where not (l.source = ${src} and l.business_id = ${ctx.biz})
       and l.updated_at > now() - make_interval(days => ${STALE_DAYS})
       and (l.source = 'self' or (${c.on} and t.status = 'active'))
       and (${q} = '' or l.name ilike ${like} or coalesce(l.brand, '') ilike ${like} or coalesce(l.category, '') ilike ${like})
       and (${cat} = '' or l.category = ${cat})
     order by l.name, l.price nulls last
     limit ${LIMIT + 1}`;
  const cats = await ctl`
    select distinct l.category from erp_market_listings l left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
     where l.category is not null and not (l.source = ${src} and l.business_id = ${ctx.biz})
       and l.updated_at > now() - make_interval(days => ${STALE_DAYS})
       and (l.source = 'self' or (${c.on} and t.status = 'active'))
     order by 1`;
  const now = Date.now();
  return {
    sharing: c.on, city: c.city, truncated: rows.length > LIMIT,
    categories: cats.map((r) => r.category),
    items: rows.slice(0, LIMIT).map((r) => ({
      name: r.name, category: r.category, brand: r.brand, color: r.color, unit: r.unit,
      band: r.band, price: r.price == null ? null : Number(r.price),
      seller: 'Supplier' + (r.city ? ' · ' + r.city : ''),
      minutes: Math.max(0, Math.round((now - new Date(r.updated_at).getTime()) / 60000)),
      ref: r.ref, stars: r.stars == null ? null : Number(r.stars), ratings: Number(r.n) || 0,
    })),
  };
}

export async function erpMarketMine(ctx) {
  needMarket(ctx);
  const c = await conf(ctx.tx, ctx.biz);
  const rows = await ctx.tx`
    select p.id, p.sku, p.name, p.category, p.brand, p.sell_price, coalesce(ps.stock, 0) as stock, m.price_mode
      from products p left join product_stock ps on ps.product_id = p.id
      left join market_shares m on m.product_id = p.id and m.business_id = p.business_id
     where p.business_id = ${ctx.biz} and coalesce(p.status, 'Active') = 'Active'
     order by (m.product_id is null), p.name`;
  return {
    on: c.on, city: c.city,
    products: rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, category: r.category, brand: r.brand,
      price: Number(r.sell_price) || 0, stock: Number(r.stock), shared: !!r.price_mode, mode: r.price_mode || 'price' })),
  };
}

export async function erpMarketSave(ctx, payload) {
  needMarket(ctx);
  const p = payload || {};
  const put = (k, v) => ctx.tx`insert into business_config (business_id, key, value) values (${ctx.biz}, ${k}, ${v})
                               on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
  if (p.on !== undefined) await put('market_share_on', p.on ? '1' : '0');
  if (p.city !== undefined) await put('market_city', str(p.city).slice(0, 40));
  let changed = 0;
  for (const x of Array.isArray(p.products) ? p.products.slice(0, 5000) : []) {
    const id = str(x && x.id);
    if (!/^[0-9a-f-]{36}$/i.test(id)) continue;
    if (x.shared) {
      const mode = x.mode === 'ask' ? 'ask' : 'price';
      const r = await ctx.tx`insert into market_shares (business_id, product_id, price_mode)
                             select ${ctx.biz}, id, ${mode} from products where id = ${id} and business_id = ${ctx.biz}
                             on conflict (business_id, product_id) do update set price_mode = excluded.price_mode returning 1`;
      changed += r.length;
    } else {
      changed += (await ctx.tx`delete from market_shares where business_id = ${ctx.biz} and product_id = ${id} returning 1`).length;
    }
  }
  const c = await conf(ctx.tx, ctx.biz);
  if (c.on && !c.city) throw new Error('Write your city: buyers see "Supplier · <city>".');
  const r = await marketRefresh(ctx);
  return { on: c.on, city: c.city, changed, listed: r.listed || 0 };
}

// ---------------------------------------------------------------- Stage 3: deals
const ACTIVE = ['asked', 'quoted', 'accepted', 'invoiced'];
const SAY = { asked: 'Waiting for a price', quoted: 'Price given', accepted: 'Accepted - waiting for the invoice', invoiced: 'Invoiced',
  received: 'Received', declined: 'Declined', cancelled: 'Cancelled' };
const phoneOk = (p) => str(p).replace(/[^0-9+]/g, '').length >= 6;
function need(ctx, role, what) { if (!roleAtLeast(ctx.s.role, role)) throw new Error('Only a ' + role + ' or the owner can ' + what + '.'); }
async function phoneSave(ctx, phone) {
  await ctx.tx`insert into business_config (business_id, key, value) values (${ctx.biz}, 'market_phone', ${str(phone).slice(0, 30)})
               on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
}
/** A request this business is in, as seller ('seller') or buyer ('buyer'); refused otherwise. */
async function dealOf(ctx, id, side) {
  const src = needMarket(ctx);
  if (!/^[0-9a-f-]{36}$/i.test(str(id))) throw new Error('That request was not found.');
  const r = (await ctx.deps.control`select * from erp_market_requests where id = ${str(id)}`)[0];
  const mine = r && (side === 'seller' ? r.seller_source === src && r.seller_business === ctx.biz : r.buyer_source === src && r.buyer_business === ctx.biz);
  if (!mine) throw new Error('That request was not found.');
  return r;
}
/** Move a deal on, only from the state it was read in (two people pressing at once: the second is told). */
async function step(ctx, r, from, set) {
  const ctl = ctx.deps.control;
  const cols = Object.keys(set);
  const got = await ctl`update erp_market_requests set ${ctl(set, ...cols)}, updated_at = now()
                        where id = ${r.id} and status = any(${from}) returning *`;
  if (!got.length) throw new Error('This request has just been changed by someone else. Open it again.');
  return got[0];
}
function view(r, side) {
  const out = { id: r.id, side, status: r.status, say: SAY[r.status] || r.status, product: r.product_name, unit: r.unit,
    qty: Number(r.qty), note: str(r.note), price: r.price == null ? null : Number(r.price), delivery: Number(r.delivery) || 0,
    total: r.price == null ? null : round2(Number(r.price) * Number(r.qty) + (Number(r.delivery) || 0)),
    quoteNote: str(r.quote_note), validUntil: r.valid_until ? new Date(r.valid_until).toISOString().slice(0, 10) : '',
    quoteRef: str(r.quote_ref), invoiceNo: str(r.invoice_no), stockRef: str(r.stock_ref), reason: str(r.closed_reason),
    rating: r.rating == null ? null : Number(r.rating), ratingNote: str(r.rating_note), at: r.created_at, updated: r.updated_at };
  if (side === 'seller') Object.assign(out, { who: r.buyer_name, city: str(r.buyer_city), phone: str(r.buyer_phone), by: str(r.buyer_by) });
  else if (r.quoted_at) Object.assign(out, { who: r.seller_name, city: str(r.seller_city), phone: str(r.seller_phone) });
  else Object.assign(out, { who: 'Supplier', city: str(r.seller_city), phone: '' });   // the seller is named only with a price
  out.mine = side === 'seller' ? ['asked', 'accepted'].includes(r.status) : ['quoted', 'invoiced'].includes(r.status) || (r.status === 'received' && r.rating == null);
  return out;
}

export async function erpMarketAsk(ctx, payload) {
  const src = needMarket(ctx);
  const p = payload || {};
  const qty = Number(p.qty), note = str(p.note).slice(0, 500), phone = str(p.phone).slice(0, 30);
  if (!(qty > 0) || qty > 1e6) throw new Error('How many do you want?');
  if (!phoneOk(phone)) throw new Error('Write a phone number the seller can call.');
  const c = await conf(ctx.tx, ctx.biz);
  const ctl = ctx.deps.control;
  // the same rule as the Market list: only a listing this business can see
  const l = (await ctl`
    select l.* from erp_market_listings l left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
     where md5(l.source || ':' || l.product_id::text) = ${str(p.ref)}
       and not (l.source = ${src} and l.business_id = ${ctx.biz})
       and l.updated_at > now() - make_interval(days => ${STALE_DAYS})
       and (l.source = 'self' or (${c.on} and t.status = 'active'))`)[0];
  if (!l) throw new Error('That product is no longer on the market.');
  const open = (await ctl`select count(*)::int as n from erp_market_requests where buyer_source = ${src} and buyer_business = ${ctx.biz}
                          and created_at > now() - interval '1 day'`)[0].n;
  if (open >= 50) throw new Error('That is 50 requests today - wait for answers before asking more.');
  const dup = (await ctl`select 1 from erp_market_requests where buyer_source = ${src} and buyer_business = ${ctx.biz}
                         and seller_source = ${l.source} and product_id = ${l.product_id} and status in ('asked', 'quoted')`).length;
  if (dup) throw new Error('You already asked for this product - see Requests.');
  await phoneSave(ctx, phone);
  const r = (await ctl`insert into erp_market_requests (buyer_source, buyer_business, buyer_name, buyer_city, buyer_phone, buyer_by,
                         seller_source, seller_business, seller_city, product_id, product_name, unit, qty, note)
                       values (${src}, ${ctx.biz}, ${str(ctx.s.businessName) || 'A business'}, ${c.city || null}, ${phone}, ${str(ctx.s.name)},
                         ${l.source}, ${l.business_id}, ${l.city}, ${l.product_id}, ${l.name}, ${l.unit}, ${qty}, ${note || null}) returning *`)[0];
  return { request: view(r, 'buyer') };
}

export async function erpMarketRequests(ctx) {
  const src = needMarket(ctx);
  const ctl = ctx.deps.control;
  const toMe = await ctl`select * from erp_market_requests where seller_source = ${src} and seller_business = ${ctx.biz} order by updated_at desc limit 200`;
  const mine = await ctl`select * from erp_market_requests where buyer_source = ${src} and buyer_business = ${ctx.biz} order by updated_at desc limit 200`;
  const ph = (await ctx.tx`select value from business_config where business_id = ${ctx.biz} and key = 'market_phone'`)[0];
  const a = toMe.map((r) => view(r, 'seller')), b = mine.map((r) => view(r, 'buyer'));
  return { toMe: a, mine: b, waiting: a.filter((x) => x.mine).length + b.filter((x) => x.mine).length, phone: ph ? str(ph.value) : '' };
}

export async function erpMarketQuote(ctx, payload) {
  need(ctx, 'manager', 'give a price');
  const p = payload || {};
  const r = await dealOf(ctx, p.id, 'seller');
  if (!['asked', 'quoted'].includes(r.status)) throw new Error('This request is ' + (SAY[r.status] || r.status).toLowerCase() + ' - no new price now.');
  const price = round2(Number(p.price)), delivery = round2(Number(p.delivery) || 0), phone = str(p.phone).slice(0, 30);
  const days = Math.min(60, Math.max(1, Math.round(Number(p.days) || 7)));
  if (!(price > 0)) throw new Error('Write the price for one piece.');
  if (delivery < 0) throw new Error('Delivery cannot be negative.');
  if (!phoneOk(phone)) throw new Error('Write a phone number the buyer can call.');
  const prod = (await ctx.tx`select sku, name, unit from products where id = ${r.product_id} and business_id = ${ctx.biz}`)[0];
  if (!prod) throw new Error('That product is no longer in your list.');
  await phoneSave(ctx, phone);
  // the same price as a normal quotation in this ERP's Quotations (one per request, updated on a new price)
  const today = todayStr(ctx.now), until = todayStr(new Date(ctx.now.getTime() + days * 86400e3));
  const { HANDLERS: Q } = await import('./quotes.js');
  const had = (await ctx.tx`select version from quotations where business_id = ${ctx.biz} and id = ${r.id}`)[0];
  const q = await Q.erpQuoteSave(ctx, { expectedVersion: had ? Number(had.version) : 0, quote: {
    id: r.id, kind: 'Products', title: 'Market request: ' + r.product_name, customer: r.buyer_name, phone: str(r.buyer_phone),
    address: str(r.buyer_city), date: today, validUntil: until, currency: 'BDT', shipping: delivery, notes: str(p.note).slice(0, 1000),
    status: 'Draft', autoNumber: true, items: [{ sku: prod.sku, name: prod.name, qty: Number(r.qty), unit: str(prod.unit), rate: price }] } });
  const got = await step(ctx, r, ['asked', 'quoted'], { status: 'quoted', price, delivery, quote_note: str(p.note).slice(0, 1000) || null,
    quote_ref: q.quote.number, valid_until: until, seller_name: str(ctx.s.businessName) || 'Supplier', seller_phone: phone, quoted_at: new Date() });
  return { request: view(got, 'seller') };
}

export async function erpMarketAccept(ctx, payload) {
  need(ctx, 'manager', 'accept a price');
  const r = await dealOf(ctx, (payload || {}).id, 'buyer');
  if (r.status !== 'quoted') throw new Error('There is no price to accept.');
  if (r.valid_until && todayStr(ctx.now) > new Date(r.valid_until).toISOString().slice(0, 10)) throw new Error('This price has expired - ask the seller again.');
  return { request: view(await step(ctx, r, ['quoted'], { status: 'accepted', accepted_at: new Date() }), 'buyer') };
}

export async function erpMarketInvoice(ctx, payload) {
  need(ctx, 'manager', 'invoice a market order');
  const r = await dealOf(ctx, (payload || {}).id, 'seller');
  if (r.status !== 'accepted') throw new Error('The buyer has not accepted the price yet.');
  const prod = (await ctx.tx`select sku from products where id = ${r.product_id} and business_id = ${ctx.biz}`)[0];
  if (!prod) throw new Error('That product is no longer in your list.');
  const { createInvoice } = await import('./invoice.js');
  // a normal sale in this ERP's books: the agreed price, unpaid until the buyer pays (Receive / adjust due)
  const inv = await createInvoice(ctx, {
    customer: { name: r.buyer_name, address: str(r.buyer_city), source: 'Market' },
    items: [{ sku: prod.sku, qty: Number(r.qty) }], deliveryCharge: Number(r.delivery) || 0, payMode: 'none',
    notes: 'Market request ' + (r.quote_ref || '') + (r.buyer_phone ? ' - buyer phone ' + r.buyer_phone : ''),
  }, { partnerDeal: true, unitPrice: Number(r.price) });
  const got = await step(ctx, r, ['accepted'], { status: 'invoiced', invoice_no: inv.invoiceNo, invoiced_at: new Date() });
  return { request: view(got, 'seller'), invoiceNo: inv.invoiceNo, total: inv.grandTotal };
}

export async function erpMarketReceive(ctx, payload) {
  need(ctx, 'manager', 'receive stock');
  const p = payload || {};
  const r = await dealOf(ctx, p.id, 'buyer');
  if (r.status !== 'invoiced') throw new Error('The seller has not invoiced this yet.');
  const qty = Number(r.qty), price = Number(r.price), delivery = Number(r.delivery) || 0;
  const unit = round2(price + delivery / qty);
  let line;
  if (p.newProduct) {
    line = { isNew: true, qty, unitBdt: unit, product: { product_name: r.product_name, unit: str(r.unit), cost_price: unit, sell_price: 0, status: 'Active' } };
  } else {
    const sku = str(p.sku);
    if (!sku) throw new Error('Choose which of your products this is, or make it a new product.');
    line = { sku, qty, unitBdt: unit };
  }
  const { receiveShipment } = await import('./stock.js');
  const ref = 'Market ' + (r.invoice_no || r.quote_ref || r.id.slice(0, 8));
  // a local purchase: the goods go on the shelf at the agreed price, and the amount is owed to the seller (Suppliers)
  await receiveShipment(ctx, { from: 'local', mode: 'bdt', totalBdt: round2(price * qty + delivery), reference: ref,
    supplier: str(r.seller_name) || 'Market supplier', lines: [line] });
  return { request: view(await step(ctx, r, ['invoiced'], { status: 'received', stock_ref: ref, received_at: new Date() }), 'buyer') };
}

export async function erpMarketClose(ctx, payload) {
  const p = payload || {};
  const side = p.side === 'seller' ? 'seller' : 'buyer';
  need(ctx, side === 'seller' ? 'manager' : 'sales', side === 'seller' ? 'decline a request' : 'cancel a request');
  const r = await dealOf(ctx, p.id, side);
  if (!['asked', 'quoted', 'accepted'].includes(r.status)) throw new Error('An invoiced request cannot be closed here - use the invoice in Sales.');
  const reason = str(p.reason).slice(0, 300);
  const got = await step(ctx, r, ['asked', 'quoted', 'accepted'], { status: side === 'seller' ? 'declined' : 'cancelled', closed_reason: reason || null });
  return { request: view(got, side) };
}

export async function erpMarketRate(ctx, payload) {
  need(ctx, 'manager', 'rate a supplier');
  const p = payload || {};
  const r = await dealOf(ctx, p.id, 'buyer');
  if (!['invoiced', 'received'].includes(r.status)) throw new Error('A supplier is rated after the invoice.');
  const stars = Math.round(Number(p.stars));
  if (!(stars >= 1 && stars <= 5)) throw new Error('Give 1 to 5 stars.');
  return { request: view(await step(ctx, r, ['invoiced', 'received'], { rating: stars, rating_note: str(p.note).slice(0, 300) || null, rated_at: new Date() }), 'buyer') };
}

export const HANDLERS = { erpMarket, erpMarketMine, erpMarketSave, erpMarketAsk, erpMarketRequests, erpMarketQuote, erpMarketAccept,
  erpMarketInvoice, erpMarketReceive, erpMarketClose, erpMarketRate };
