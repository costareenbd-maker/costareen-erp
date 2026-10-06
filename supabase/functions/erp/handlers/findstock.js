// Stage N5 (docs/NETWORK-BLUEPRINT.md section 4.1): Find stock - the public side of the market.
//
// A shop that shares its stock on the market can also show it to everyone (Market > What I share > "Show my shop to
// everyone"). Then anyone, with no account, searches a product, brand or colour and sees which shops have it now
// (in stock / low), the price or "ask", the city; opens the shop's page; orders straight into that shop's web
// orders (the shop sees it under Web orders like a website order); or leaves a number for "tell me when it is back",
// which the shops that list the product answer themselves (Market > Waiting buyers).
//
// Public (passport.js pubRoute, rate limited per address):
//   GET  ?pub=find&q=<words>[&brand=&colour=&cat=]   items grouped by product, each with its shops
//   GET  ?pub=shop&s=<slug>                           a shop's page: profile and its public listings
//   POST ?pub=order  {s, items: [{productId, qty}], name, phone, address, note, consent: true}
//   POST ?pub=alert  {name, phone, consent: true}
// Shop side (market.js): erpMarketWaiting, erpMarketTold

import { formatDate, num, round2 } from '../lib/time.js';
import { phone11 } from '../lib/phone.js';
import { pubBase, limit } from './passport.js';
import { words, STALE_DAYS } from './market.js';

const str = (v) => String(v == null ? '' : v).trim();
const ago = (d) => { const m = Math.round((Date.now() - new Date(d).getTime()) / 60000); return m < 60 ? m + ' min' : m < 1440 ? Math.round(m / 60) + ' h' : Math.round(m / 1440) + ' d'; };
export const CONSENT_ORDER = 'The shop keeps my name, number and address to deliver this order and to reach me about it. Nothing else is done with them.';
export const CONSENT_ALERT = 'The shops that sell this product may message me on this number when it is back in stock. Nothing else is done with it.';

function shopRow(s) { return { slug: str(s.slug), name: str(s.name), city: str(s.city), phone: str(s.phone), address: str(s.address), note: str(s.note), orders: !!s.orders, whatsapp: wa(s.phone) }; }
function wa(phone) { const d = str(phone).replace(/[^0-9]/g, ''); return d ? 'https://wa.me/' + (d.startsWith('0') ? '88' + d : d) : ''; }
async function publicListings(deps, where) {
  return deps.control`
    select l.*, s.slug, s.name as shop_name, s.city as shop_city, s.orders as shop_orders
      from erp_market_listings l
      join erp_market_shops s on s.source = l.source and s.business_id = l.business_id and s.public
      left join erp_tenants t on l.source <> 'self' and t.id::text = l.source
     where l.updated_at > now() - make_interval(days => ${STALE_DAYS})
       and (l.source = 'self' or t.status = 'active') ${where}
     limit 3000`;
}
export async function find(deps, params, ip) {
  await limit(deps, ip, 'find', 120);
  const q = str(params.get('q')).slice(0, 80), brand = str(params.get('brand')).toLowerCase(), colour = str(params.get('colour')).toLowerCase(), cat = str(params.get('cat')).toLowerCase();
  const qw = words(q);
  const rows = (await publicListings(deps, deps.control``)).filter((l) =>
    (!brand || str(l.brand).toLowerCase() === brand) && (!colour || str(l.color).toLowerCase() === colour) && (!cat || str(l.category).toLowerCase() === cat) &&
    (!qw.length || qw.every((w) => (str(l.name) + ' ' + str(l.brand) + ' ' + str(l.color) + ' ' + str(l.category)).toLowerCase().indexOf(w) >= 0)));
  const groups = {}, facets = { brands: {}, colours: {}, categories: {} };
  for (const l of rows) {
    const key = words(l.name).join(' ');
    const g = groups[key] || (groups[key] = { key, name: str(l.name), brand: str(l.brand), category: str(l.category), colour: str(l.color), unit: str(l.unit), shops: [] });
    g.shops.push({ slug: str(l.slug), shop: str(l.shop_name), city: str(l.shop_city), band: str(l.band), price: l.price == null ? null : num(l.price), orders: !!l.shop_orders, productId: l.product_id, updated: ago(l.updated_at), hex: str(l.color_hex) });
    if (!g.hex && str(l.color_hex)) g.hex = str(l.color_hex);
    if (l.brand) facets.brands[str(l.brand)] = (facets.brands[str(l.brand)] || 0) + 1;
    if (l.color) facets.colours[str(l.color)] = (facets.colours[str(l.color)] || 0) + 1;
    if (l.category) facets.categories[str(l.category)] = (facets.categories[str(l.category)] || 0) + 1;
  }
  const items = Object.values(groups).map((g) => {
    g.shops.sort((a, b) => (a.band === 'in' ? 0 : 1) - (b.band === 'in' ? 0 : 1) || (a.price == null ? 1 : 0) - (b.price == null ? 1 : 0) || (a.price || 0) - (b.price || 0));
    g.inStock = g.shops.filter((s) => s.band === 'in').length;
    const prices = g.shops.map((s) => s.price).filter((p) => p > 0);
    g.low = prices.length ? Math.min(...prices) : null;
    return g;
  }).sort((a, b) => b.inStock - a.inStock || a.name.localeCompare(b.name));
  const top = (o) => Object.keys(o).sort((a, b) => o[b] - o[a]).slice(0, 30);
  return { q, items: items.slice(0, 100), total: items.length, facets: { brands: top(facets.brands), colours: top(facets.colours), categories: top(facets.categories) } };
}
export async function shopPage(deps, params, ip) {
  await limit(deps, ip, 'find', 120);
  const slug = str(params.get('s')).toLowerCase();
  if (!/^[a-z0-9-]{3,80}$/.test(slug)) throw new Error('This shop link is not complete.');
  const s = (await deps.control`select * from erp_market_shops where slug = ${slug} and public`)[0];
  if (!s) throw new Error('This shop is not on Find stock (any more).');
  const rows = await publicListings(deps, deps.control`and l.source = ${s.source} and l.business_id = ${s.business_id}`);
  const items = rows.map((l) => ({ productId: l.product_id, name: str(l.name), brand: str(l.brand), category: str(l.category), colour: str(l.color), hex: str(l.color_hex), unit: str(l.unit), band: str(l.band), price: l.price == null ? null : num(l.price), updated: ago(l.updated_at) }))
    .sort((a, b) => (a.band === 'in' ? 0 : 1) - (b.band === 'in' ? 0 : 1) || a.name.localeCompare(b.name));
  return { shop: shopRow(s), items, consent: CONSENT_ORDER };
}
async function shopOf(deps, R, slug) {
  const s = (await deps.control`select * from erp_market_shops where slug = ${str(slug).toLowerCase()} and public`)[0];
  if (!s) throw new Error('This shop is not on Find stock (any more).');
  let d = deps;
  if (s.source !== 'self') { if (!R || !R.tenantDeps) throw new Error('This shop is not available right now.'); d = await R.tenantDeps(s.source); }
  const rows = await R.owners(d.sql, [s.business_id]);
  if (!rows.length) throw new Error('This shop is not available right now.');
  return { s, d, row: rows[0] };
}
export async function order(deps, R, body, ip) {
  await limit(deps, ip, 'findorder', 10);
  const b = body || {};
  const { s, d, row } = await shopOf(deps, R, b.s);
  if (!s.orders) throw new Error('This shop does not take orders here - message it on WhatsApp instead.');
  const name = str(b.name).slice(0, 60); if (name.length < 2) throw new Error('Your name.');
  let phone = ''; try { phone = phone11(b.phone); } catch (e) { throw new Error('Your mobile number: ' + e.message); }
  if (!phone) throw new Error('Your mobile number, so the shop can reach you.');
  const address = str(b.address).slice(0, 300); if (address.length < 5) throw new Error('Where should it be delivered? Area and address.');
  const note = str(b.note).slice(0, 300);
  if (b.consent !== true) throw new Error('Tick the line: the shop keeps your name, number and address to deliver.');
  const wanted = Array.isArray(b.items) ? b.items.slice(0, 30) : [];
  if (!wanted.length) throw new Error('Pick at least one product.');
  const listed = {};
  for (const l of await deps.control`select * from erp_market_listings where source = ${s.source} and business_id = ${s.business_id}`) listed[String(l.product_id)] = l;
  const lines = [];
  for (const it of wanted) {
    const l = listed[str(it && it.productId)];
    if (!l) throw new Error('One of the products is no longer listed by this shop. Refresh the page.');
    const qty = Math.round(num(it.qty));
    if (!(qty >= 1 && qty <= 50)) throw new Error('Quantity 1 to 50 for ' + str(l.name) + '.');
    lines.push({ sku: '', name: str(l.name), qty, price: l.price == null ? 0 : num(l.price) });   // no SKU on the market: the shop's matcher goes by name
  }
  const no = 'FS-' + formatDate(new Date(), 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const total = round2(lines.reduce((a, x) => a + x.price * x.qty, 0));
  const out = await R.asBusiness(d, { ...row, who: 'Find stock' }, 'pub:order', async (ctx) => {
    ctx.s.name = 'Find stock';
    const W = await import('./weborders.js');
    const items = lines.map((x) => ({ number: no, created: new Date().toISOString().slice(0, 19), status: 'processing', customer: name, phone, address: address + (note ? ' · Note: ' + note : ''),
      payment: 'Find stock (to arrange)', total, sku: x.sku, product: x.name, qty: x.qty, line_total: round2(x.price * x.qty) }));
    const added = await W.addWebLines(ctx, items);
    return { added };
  });
  if (out && out.error) throw new Error(out.error);
  const askCount = lines.filter((x) => !(x.price > 0)).length;
  return { orderNo: no, lines: lines.length, total, ask: askCount, shop: shopRow(s), message: 'Order ' + no + ' from Find stock: ' + lines.map((x) => x.qty + ' x ' + x.name).join(', ') + '. ' + name + ', ' + address };
}
export async function alert(deps, body, ip) {
  await limit(deps, ip, 'findalert', 10);
  const b = body || {};
  const name = str(b.name).slice(0, 120); if (name.length < 3) throw new Error('Which product?');
  let phone = ''; try { phone = phone11(b.phone); } catch (e) { throw new Error('Your mobile number: ' + e.message); }
  if (!phone) throw new Error('Your mobile number, so a shop can message you.');
  if (b.consent !== true) throw new Error('Tick the line: shops that sell it may message you when it is back.');
  const key = words(name).join(' ');
  if (!key) throw new Error('Which product?');
  const dup = await deps.control`select 1 from erp_stock_alerts where name_key = ${key} and phone = ${phone} and told_at is null`;
  if (!dup.length) await deps.control`insert into erp_stock_alerts (name_key, name, phone, consent) values (${key}, ${name}, ${phone}, ${deps.control.json({ at: new Date().toISOString(), text: CONSENT_ALERT, ip: str(ip) })})`;
  return { noted: true, name };
}
/** passport.js pubRoute hands the Find stock routes here. */
export async function route(deps, R, what, method, params, body, ip) {
  if (what === 'find' && method === 'GET') return find(deps, params, ip);
  if (what === 'shop' && method === 'GET') return shopPage(deps, params, ip);
  if (what === 'order' && method === 'POST') return order(deps, R, body, ip);
  if (what === 'alert' && method === 'POST') return alert(deps, body, ip);
  return null;
}
