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
//
// Stage 4 - helpers around the market:
//   erpMarketHints()            products running low on this business's shelf that are on the market (and from what price)
//   erpMarketMine() .guide      the market's price range for each of this business's products (price guide)
//   erpMarketNames({q})         product names used on the market (suggestions when adding a product: one shared naming)
//   erpWanted()                 the wanted board: open posts of others + this business's own posts
//   erpWantedPost({item, qty, note, days, phone})   erpWantedClose({id})
//   erpWantedOffer({id, sku, price, delivery, days, phone, note})   a supplier answers: a request, already priced

import { roleAtLeast } from '../allow.js';
import { todayStr, round2 } from '../lib/time.js';

const str = (v) => String(v == null ? '' : v).trim();
export const STALE_DAYS = 3;          // a seller not refreshed for this long drops out of the market
const LIMIT = 300;

/** Who is listing: the provider's own businesses are 'self', a company on the bridge its install id. */
export function sourceOf(deps) {
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
  const rows = await tx`select key, value from business_config where business_id = ${biz} and key in ('market_share_on', 'market_city', 'market_public_on', 'market_public_orders', 'market_public_note', 'market_colours')`;
  const m = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  let colours = {}; try { colours = JSON.parse(m.market_colours || '{}') || {}; } catch (_) { colours = {}; }
  return { on: m.market_share_on === '1', city: str(m.market_city), publicOn: m.market_public_on === '1', orders: m.market_public_orders === '1', note: str(m.market_public_note), colours };
}
const HEX = /^#[0-9a-f]{6}$/i;
const hexOf = (colours, name) => { const h = str(colours[str(name).toLowerCase()]); return HEX.test(h) ? h.toLowerCase() : null; };
// Stage N5: the shop's public address on Find stock - "<name>-<4 letters>", kept once made
async function slugFor(ctl, src, biz, name) {
  const had = (await ctl`select slug from erp_market_shops where source = ${src} and business_id = ${biz}`)[0];
  if (had) return str(had.slug);
  const base = str(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'shop';
  const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('shop|' + src + '|' + biz));
  const hex = [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join('');
  for (let n = 4; n <= 12; n += 2) {
    const slug = base + '-' + hex.slice(0, n);
    if (!(await ctl`select 1 from erp_market_shops where slug = ${slug}`).length) return slug;
  }
  return base + '-' + hex.slice(0, 16);
}
async function shopUpsert(ctx, src, c) {
  const ctl = ctx.deps.control;
  let prof = {}; try { prof = await (await import('./sales.js')).qProfile(ctx); } catch (_) { prof = {}; }
  const name = str(prof.name) || str(ctx.s.businessName) || 'Shop';
  const slug = await slugFor(ctl, src, ctx.biz, name);
  await ctl`insert into erp_market_shops (source, business_id, slug, name, phone, address, city, note, public, orders, updated_at)
            values (${src}, ${ctx.biz}, ${slug}, ${name}, ${str(prof.phone) || null}, ${str(prof.address) || null}, ${c.city || null}, ${c.note || null}, ${!!(c.on && c.publicOn)}, ${!!c.orders}, now())
            on conflict (source, business_id) do update set name = excluded.name, phone = excluded.phone, address = excluded.address, city = excluded.city, note = excluded.note,
              public = excluded.public, orders = excluded.orders, updated_at = now()`;
  return slug;
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
    color: str(r.color) || null, color_hex: hexOf(c.colours, r.color), unit: str(r.unit) || null, band: band(Number(r.stock), r.reorder_level),
    price: r.price_mode === 'ask' || !(Number(r.sell_price) > 0) ? null : Number(r.sell_price), city: c.city || null,
  }));
  const ctl = ctx.deps.control;
  // the catalogue's feed: every active product, in or out of stock (the listing only what is on the shelf)
  const all = rows.map((r) => ({ source: src, business_id: ctx.biz, product_id: r.id, name: str(r.name), category: str(r.category) || null, brand: str(r.brand) || null, color: str(r.color) || null, unit: str(r.unit) || null }));
  await ctl.begin(async (t) => {
    await t`delete from erp_market_listings where source = ${src} and business_id = ${ctx.biz}`;
    if (list.length) await t`insert into erp_market_listings ${t(list, 'source', 'business_id', 'product_id', 'name', 'category', 'brand', 'color', 'color_hex', 'unit', 'band', 'price', 'city')}`;
    await t`delete from erp_catalog_products where source = ${src} and business_id = ${ctx.biz}`;
    if (all.length) await t`insert into erp_catalog_products ${t(all, 'source', 'business_id', 'product_id', 'name', 'category', 'brand', 'color', 'unit')}`;
  });
  try { await shopUpsert(ctx, src, c); } catch (e) { console.error('market shop row', e); }
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
    select p.id, p.sku, p.name, p.category, p.brand, p.color, p.sell_price, coalesce(ps.stock, 0) as stock, m.price_mode
      from products p left join product_stock ps on ps.product_id = p.id
      left join market_shares m on m.product_id = p.id and m.business_id = p.business_id
     where p.business_id = ${ctx.biz} and coalesce(p.status, 'Active') = 'Active'
     order by (m.product_id is null), p.name`;
  const seen = await visibleListings(ctx);
  const src = sourceOf(ctx.deps);
  const slug = await slugFor(ctx.deps.control, src, ctx.biz, str((await (await import('./sales.js')).qProfile(ctx)).name) || str(ctx.s.businessName));
  const base = (await import('./passport.js')).pubBase(ctx.deps).check.replace(/check$/, '');
  return {
    on: c.on, city: c.city, publicOn: c.publicOn, orders: c.orders, note: c.note, shopUrl: base + 'find?s=' + slug, waiting: (await waitingFor(ctx, src)).length,
    // the colour names on the shared products, with the swatch the shop set (Stage N5b)
    colours: [...new Set(rows.filter((r) => r.price_mode && str(r.color)).map((r) => str(r.color)))].sort().map((name) => ({ name, hex: hexOf(c.colours, name) || '' })),
    products: rows.map((r) => ({ id: r.id, sku: r.sku, name: r.name, category: r.category, brand: r.brand,
      price: Number(r.sell_price) || 0, stock: Number(r.stock), shared: !!r.price_mode, mode: r.price_mode || 'price',
      guide: guideFor(seen, r.name) })),
  };
}

export async function erpMarketSave(ctx, payload) {
  needMarket(ctx);
  const p = payload || {};
  const put = (k, v) => ctx.tx`insert into business_config (business_id, key, value) values (${ctx.biz}, ${k}, ${v})
                               on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
  if (p.on !== undefined) await put('market_share_on', p.on ? '1' : '0');
  if (p.publicOn !== undefined) await put('market_public_on', p.publicOn ? '1' : '0');
  if (p.orders !== undefined) await put('market_public_orders', p.orders ? '1' : '0');
  if (p.note !== undefined) await put('market_public_note', str(p.note).slice(0, 300));
  if (p.colours !== undefined) {
    const had = (await conf(ctx.tx, ctx.biz)).colours, next = { ...had };
    for (const [k, v] of Object.entries(p.colours && typeof p.colours === 'object' ? p.colours : {})) {
      const name = str(k).toLowerCase().slice(0, 60); if (!name) continue;
      if (!str(v)) { delete next[name]; continue; }
      if (!HEX.test(str(v))) throw new Error('A colour value looks like #1a2b3c (' + str(k) + ').');
      next[name] = str(v).toLowerCase();
    }
    await put('market_colours', JSON.stringify(Object.fromEntries(Object.entries(next).slice(0, 300))));
  }
  if (p.city !== undefined) {
    await put('market_city', str(p.city).slice(0, 40));
    // the Printer Passport register shows "Supplier · <city>" for a seller who hides the name
    try { await (await import('./passport.js')).refreshSeller(ctx); } catch (e) { console.error('passport seller', e); }
  }
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
  if (c.publicOn && !c.on) throw new Error('Switch on "Share my stock on the market" first - Find stock shows the same products.');
  const r = await marketRefresh(ctx);
  return { on: c.on, city: c.city, publicOn: c.publicOn, orders: c.orders, note: c.note, changed, listed: r.listed || 0 };
}
// ---------------------------------------------------------------- Stage N5: buyers waiting for a product I list
async function waitingFor(ctx, src) {
  if (!src) return [];
  const keys = [...new Set((await ctx.deps.control`select name from erp_market_listings where source = ${src} and business_id = ${ctx.biz}`).map((l) => words(l.name).join(' ')).filter(Boolean))];
  if (!keys.length) return [];
  return ctx.deps.control`select * from erp_stock_alerts where told_at is null and name_key = any(${keys}) and created_at > now() - interval '60 days' order by created_at desc limit 200`;
}
export async function erpMarketWaiting(ctx) {
  const src = needMarket(ctx);
  const c = await conf(ctx.tx, ctx.biz);
  let shop = str(ctx.s.businessName); try { shop = str((await (await import('./sales.js')).qProfile(ctx)).name) || shop; } catch (_) { /* the business name */ }
  const rows = await waitingFor(ctx, src);
  return { waiting: rows.map((a) => { const d = str(a.phone).replace(/[^0-9]/g, ''); return { id: a.id, name: str(a.name), phone: str(a.phone), since: a.created_at ? formatDateDay(a.created_at) : '',
    whatsapp: d ? 'https://wa.me/' + (d.startsWith('0') ? '88' + d : d) + '?text=' + encodeURIComponent('Hello, ' + str(a.name) + ' is back in stock at ' + shop + '.') : '' }; }), publicOn: c.publicOn };
}
function formatDateDay(d) { const x = new Date(d); return x.getDate() + ' ' + ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][x.getMonth()]; }
export async function erpMarketTold(ctx, payload) {
  const src = needMarket(ctx);
  const mine = (await waitingFor(ctx, src)).map((a) => String(a.id));
  const id = str(payload && payload.id);
  if (!mine.includes(id)) throw new Error('That buyer is not waiting for a product you list.');
  await ctx.deps.control`update erp_stock_alerts set told_at = now(), told_by = ${src + ':' + ctx.biz} where id = ${id}::uuid`;
  return { told: true };
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

// ---------------------------------------------------------------- Stage 4: hints, price guide, names, wanted board
/** Every listing this business may see (the Market list's own rule), for matching by name. */
async function visibleListings(ctx) {
  const src = sourceOf(ctx.deps);
  if (!src) return [];
  const c = await conf(ctx.tx, ctx.biz);
  return ctx.deps.control`
    select l.name, l.brand, l.category, l.band, l.price, l.city from erp_market_listings l
      left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
     where not (l.source = ${src} and l.business_id = ${ctx.biz})
       and l.updated_at > now() - make_interval(days => ${STALE_DAYS})
       and (l.source = 'self' or (${c.on} and t.status = 'active'))
     limit 5000`;
}
/** The words that name a product, without sizes ("Sunlu PLA+ Black 1kg" -> black, pla, sunlu). */
export function words(name) {
  return [...new Set(str(name).toLowerCase().split(/[^a-z0-9+ঀ-৿]+/)
    .filter((w) => w.length >= 2 && !/^\d+(\.\d+)?(kg|g|gm|mm|cm|m|ml|l|pcs|pc)?$/.test(w)))].sort();
}
// a match: the same words, in any order, sizes ignored ("Sunlu PLA Black" ~ "Black Sunlu PLA 1kg";
// not "Sunlu PLA Twinkling Black", not "Sunlu PLA White")
function matching(list, name) {
  const key = words(name).join(' ');
  if (!key) return [];
  return list.filter((l) => words(l.name).join(' ') === key);
}
function guideFor(list, name) {
  const m = matching(list, name);
  const prices = m.map((l) => Number(l.price)).filter((x) => x > 0).sort((a, b) => a - b);
  if (!m.length) return null;
  return { sellers: m.length, priced: prices.length, low: prices[0] ?? null, high: prices[prices.length - 1] ?? null,
    mid: prices.length ? prices[Math.floor((prices.length - 1) / 2)] : null };
}

export async function erpMarketHints(ctx) {
  needMarket(ctx);
  const low = await ctx.tx`
    select p.name, p.unit, coalesce(ps.stock, 0) as stock, p.reorder_level from products p left join product_stock ps on ps.product_id = p.id
     where p.business_id = ${ctx.biz} and coalesce(p.status, 'Active') = 'Active' and coalesce(ps.stock, 0) <= greatest(p.reorder_level, 2)
     order by coalesce(ps.stock, 0), p.name limit 200`;
  if (!low.length) return { items: [] };
  const seen = await visibleListings(ctx);
  const items = [];
  for (const p of low) {
    const g = guideFor(seen, p.name);
    if (g) items.push({ name: p.name, unit: p.unit, stock: Number(p.stock), sellers: g.sellers, from: g.low });
    if (items.length >= 12) break;
  }
  return { items };
}

export async function erpMarketNames(ctx, payload) {
  const src = sourceOf(ctx.deps);
  if (!src) return { names: [] };
  const q = str(payload && payload.q).slice(0, 60);
  const like = '%' + q.replace(/[\\%_]/g, (m) => '\\' + m) + '%';
  // names only (no price, no seller), from every active listing: the point is one way of naming things
  const rows = await ctx.deps.control`
    select l.name, max(l.brand) as brand, max(l.category) as category, count(*)::int as n from erp_market_listings l
      left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
     where l.updated_at > now() - make_interval(days => ${STALE_DAYS}) and (l.source = 'self' or t.status = 'active')
       and (${q} = '' or l.name ilike ${like})
     group by l.name order by count(*) desc, l.name limit 300`;
  return { names: rows.map((r) => ({ name: r.name, brand: r.brand, category: r.category, n: r.n })) };
}

function wantedView(w, mine, offers) {
  return { id: w.id, item: w.item, qty: Number(w.qty), note: str(w.note), until: new Date(w.until).toISOString().slice(0, 10),
    status: w.status, at: w.created_at, mine, who: mine ? 'You' : 'Buyer', city: str(w.city), offers: offers || 0 };
}

export async function erpWanted(ctx) {
  const src = needMarket(ctx);
  const ctl = ctx.deps.control;
  const today = todayStr(ctx.now);
  const others = await ctl`
    select w.*, (select count(*)::int from erp_market_requests r where r.wanted_id = w.id and r.seller_source = ${src} and r.seller_business = ${ctx.biz}) as by_me
      from erp_market_wanted w left join erp_tenants t on w.source <> 'self' and t.id::text = w.source
     where w.status = 'open' and w.until >= ${today}::date and not (w.source = ${src} and w.business_id = ${ctx.biz})
       and (w.source = 'self' or t.status = 'active')
     order by w.created_at desc limit 200`;
  const mine = await ctl`
    select w.*, (select count(*)::int from erp_market_requests r where r.wanted_id = w.id) as n
      from erp_market_wanted w where w.source = ${src} and w.business_id = ${ctx.biz} order by w.created_at desc limit 100`;
  const ph = (await ctx.tx`select value from business_config where business_id = ${ctx.biz} and key = 'market_phone'`)[0];
  return { others: others.map((w) => ({ ...wantedView(w, false), offered: w.by_me > 0 })),
    mine: mine.map((w) => ({ ...wantedView(w, true, w.n), expired: new Date(w.until).toISOString().slice(0, 10) < today })),
    phone: ph ? str(ph.value) : '' };
}

export async function erpWantedPost(ctx, payload) {
  need(ctx, 'manager', 'post on the wanted board');
  const src = needMarket(ctx);
  const p = payload || {};
  const item = str(p.item).slice(0, 200), qty = Number(p.qty), phone = str(p.phone).slice(0, 30);
  const days = Math.min(60, Math.max(1, Math.round(Number(p.days) || 14)));
  if (item.length < 3) throw new Error('Write what you need.');
  if (!(qty > 0) || qty > 1e6) throw new Error('How many do you need?');
  if (!phoneOk(phone)) throw new Error('Write a phone number suppliers can call.');
  const ctl = ctx.deps.control;
  const n = (await ctl`select count(*)::int as n from erp_market_wanted where source = ${src} and business_id = ${ctx.biz} and status = 'open'`)[0].n;
  if (n >= 30) throw new Error('You have 30 open posts - close some first.');
  const c = await conf(ctx.tx, ctx.biz);
  await phoneSave(ctx, phone);
  const w = (await ctl`insert into erp_market_wanted (source, business_id, buyer_name, city, phone, item, qty, note, until, posted_by)
                       values (${src}, ${ctx.biz}, ${str(ctx.s.businessName) || 'A business'}, ${c.city || null}, ${phone}, ${item}, ${qty},
                               ${str(p.note).slice(0, 500) || null}, ${todayStr(new Date(ctx.now.getTime() + days * 86400e3))}::date, ${str(ctx.s.name)}) returning *`)[0];
  return { wanted: wantedView(w, true, 0) };
}

export async function erpWantedClose(ctx, payload) {
  need(ctx, 'manager', 'close a wanted post');
  const src = needMarket(ctx);
  const got = await ctx.deps.control`update erp_market_wanted set status = 'closed', closed_at = now()
                                      where id = ${str(payload && payload.id)}::uuid and source = ${src} and business_id = ${ctx.biz} and status = 'open' returning *`;
  if (!got.length) throw new Error('That post was not found (or is already closed).');
  return { wanted: wantedView(got[0], true) };
}

export async function erpWantedOffer(ctx, payload) {
  need(ctx, 'manager', 'offer a price');
  const src = needMarket(ctx);
  const p = payload || {};
  const ctl = ctx.deps.control;
  if (!/^[0-9a-f-]{36}$/i.test(str(p.id))) throw new Error('That post was not found.');
  const w = (await ctl`select w.* from erp_market_wanted w left join erp_tenants t on w.source <> 'self' and t.id::text = w.source
                       where w.id = ${str(p.id)} and w.status = 'open' and w.until >= ${todayStr(ctx.now)}::date
                         and (w.source = 'self' or t.status = 'active')`)[0];
  if (!w || (w.source === src && w.business_id === ctx.biz)) throw new Error('That post is no longer open.');
  const prod = (await ctx.tx`select id, name, unit from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${str(p.sku).toLowerCase()} limit 1`)[0];
  if (!prod) throw new Error('Choose which of your products you offer.');
  if (!(Number(p.price) > 0)) throw new Error('Write the price for one piece.');
  if (!phoneOk(p.phone)) throw new Error('Write a phone number the buyer can call.');
  const dup = await ctl`select 1 from erp_market_requests where wanted_id = ${w.id} and seller_source = ${src} and seller_business = ${ctx.biz} and status in ('asked', 'quoted', 'accepted')`;
  if (dup.length) throw new Error('You already offered on this post - see Requests.');
  const c = await conf(ctx.tx, ctx.biz);
  const r = (await ctl`insert into erp_market_requests (buyer_source, buyer_business, buyer_name, buyer_city, buyer_phone, buyer_by,
                         seller_source, seller_business, seller_city, product_id, product_name, unit, qty, note, wanted_id)
                       values (${w.source}, ${w.business_id}, ${w.buyer_name}, ${w.city}, ${w.phone}, ${w.posted_by},
                         ${src}, ${ctx.biz}, ${c.city || null}, ${prod.id}, ${prod.name}, ${prod.unit}, ${Number(w.qty)},
                         ${'Wanted: ' + w.item + (w.note ? ' - ' + w.note : '')}, ${w.id}) returning id`)[0];
  try {
    return await erpMarketQuote(ctx, { id: r.id, price: p.price, delivery: p.delivery, days: p.days, phone: p.phone, note: p.note });
  } catch (e) {
    await ctl`delete from erp_market_requests where id = ${r.id} and status = 'asked'`;   // no half offer left behind
    throw e;
  }
}

export const HANDLERS = { erpMarket, erpMarketMine, erpMarketSave, erpMarketAsk, erpMarketRequests, erpMarketQuote, erpMarketAccept,
  erpMarketInvoice, erpMarketReceive, erpMarketClose, erpMarketRate, erpMarketHints, erpMarketNames, erpWanted, erpWantedPost,
  erpWantedClose, erpWantedOffer, erpMarketWaiting, erpMarketTold };
