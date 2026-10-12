// Stage N5: Find stock - a shop shows its shared stock to everyone, a stranger finds it, opens the shop's page,
// orders into the shop's web orders, leaves a number for "tell me when it is back"; the shop answers.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) } }), R)).body;
const post = async (q, body, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) }, body: JSON.stringify(body) }), R)).body;
const FIL = 'FIL-SUN-PLA-BLA-001', A1 = 'PRT-BAM-A1-001';

// 1. sharing on the market (Stage 2) but not public: nothing on Find stock
let m = await owner('erpMarketMine', []);
const fil = m.result.products.find((p) => p.sku === FIL), a1 = m.result.products.find((p) => p.sku === A1);
let r = await owner('erpMarketSave', [{ on: true, city: 'Dhaka', products: [{ id: fil.id, shared: true, mode: 'price' }, { id: a1.id, shared: true, mode: 'ask' }] }]);
check('shared on the market: 2 products', r.ok && r.result.listed === 2, r);
r = await get('pub=find&q=sunlu');
check('not public yet: nothing found', r.ok && r.items.length === 0 && r.total === 0, r);
m = await owner('erpMarketMine', []);
check('the share tab shows the public switch off and the shop link', m.ok && m.result.publicOn === false && m.result.orders === false && /\/find\?s=/.test(m.result.shopUrl), m.ok ? m.result.shopUrl : m);
const SLUG = m.result.shopUrl.split('s=')[1];

// 2. switched on
r = await mgr('erpMarketSave', [{ publicOn: true }]);
check('only the owner switches the shop public', !r.ok, r);
r = await owner('erpMarketSave', [{ publicOn: true, orders: true, note: 'Delivery in Dhaka 80 taka, outside by courier.' }]);
check('public, taking orders', r.ok && r.result.publicOn === true && r.result.orders === true, r);
r = await get('pub=find&q=sunlu pla');
check('found: one product, our shop named, in stock, the price, orders on, the brand facet', r.ok && r.items.length === 1 && r.items[0].shops.length === 1 && r.items[0].shops[0].shop === 'Costareen' && r.items[0].shops[0].city === 'Dhaka' && r.items[0].shops[0].band === 'in' && r.items[0].shops[0].price === 1350 && r.items[0].shops[0].orders === true && r.items[0].inStock === 1 && r.items[0].low === 1350 && r.facets.brands.includes('Sunlu'), r);
r = await get('pub=find&q=bambu');
check('the printer: price "ask"', r.ok && r.items.length === 1 && r.items[0].shops[0].price === null, r);
r = await get('pub=find&q=');
check('no words: everything public, newest in stock first', r.ok && r.items.length === 2 && r.facets.categories.length >= 1, r);
r = await get('pub=find&q=&brand=Bambulab');
check('a brand filter', r.ok && r.items.length === 1 && /Bambu/.test(r.items[0].name), r);
r = await get('pub=find&q=unobtainium');
check('a product nobody lists: empty', r.ok && r.items.length === 0, r);

// 3. the shop's page
r = await get('pub=shop&s=' + SLUG);
check('the shop page: name, city, note, WhatsApp, its two listings, the consent line', r.ok && r.shop.name === 'Costareen' && r.shop.city === 'Dhaka' && /80 taka/.test(r.shop.note) && r.shop.orders === true && r.items.length === 2 && r.items[0].band === 'in' && /deliver/.test(r.consent), r);
r = await get('pub=shop&s=no-such-shop');
check('an unknown shop', !r.ok, r);
const PID = r.ok ? null : (await get('pub=shop&s=' + SLUG)).items.find((x) => /Sunlu/.test(x.name)).productId;

// 4. an order into the shop's web orders
const good = (o) => ({ s: SLUG, items: [{ productId: PID, qty: 2 }], name: 'Rina', phone: '01799999999', address: 'House 5, Road 2, Mirpur 10, Dhaka', note: 'Call before delivery', consent: true, ...(o || {}) });
r = await post('pub=order', good({ consent: false }));
check('an order needs the consent line', !r.ok && /Tick/.test(r.error), r);
r = await post('pub=order', good({ phone: '12' }));
check('...a real mobile number', !r.ok && /mobile/i.test(r.error), r);
r = await post('pub=order', good({ address: 'x' }));
check('...an address', !r.ok && /deliver/i.test(r.error), r);
r = await post('pub=order', good({ items: [{ productId: '00000000-0000-0000-0000-000000000000', qty: 1 }] }));
check('...a product the shop lists', !r.ok && /no longer listed/.test(r.error), r);
r = await post('pub=order', good({ items: [{ productId: PID, qty: 0 }] }));
check('...a sensible quantity', !r.ok && /Quantity/.test(r.error), r);
r = await post('pub=order', good());
check('ordered: a number, the total from the listed price, the shop’s details', r.ok && /^FS-\d{6}-[A-Z0-9]{4}$/.test(r.orderNo) && r.lines === 1 && r.total === 2700 && r.ask === 0 && r.shop.name === 'Costareen' && /Rina/.test(r.message), r);
const ORDER = r.orderNo;
r = await owner('erpWebOrders', []);
check('the shop sees it under Web orders with the customer and the address', r.ok && JSON.stringify(r.result).includes(ORDER) && JSON.stringify(r.result).includes('Rina') && JSON.stringify(r.result).includes('Mirpur 10'), r.ok ? 'ok' : r);
check('...the note travels with the address', JSON.stringify(r.result).includes('Call before delivery'));
await owner('erpMarketSave', [{ orders: false }]);
r = await post('pub=order', good());
check('orders switched off: refused with "WhatsApp instead"', !r.ok && /WhatsApp/.test(r.error), r);
await owner('erpMarketSave', [{ orders: true }]);

// 5. tell me when it is back
r = await post('pub=alert', { name: 'Sunlu PLA Black', phone: '01788888888', consent: false });
check('an alert needs the consent line', !r.ok, r);
r = await post('pub=alert', { name: 'Sunlu PLA Black 1kg', phone: '01788888888', consent: true });
check('noted', r.ok && r.noted, r);
r = await post('pub=alert', { name: 'Sunlu PLA Black', phone: '01788888888', consent: true });
check('the same number for the same product is not noted twice', r.ok && (await sql`select count(*)::int n from erp_stock_alerts`)[0].n === 1);
r = await post('pub=alert', { name: 'Elegoo PLA Red', phone: '01777777777', consent: true });
r = await sales('erpMarketWaiting', []);
check('the shop sees the buyer waiting for a product it lists - not the one it does not', r.ok && r.result.waiting.length === 1 && r.result.waiting[0].phone === '01788888888' && /Sunlu/.test(r.result.waiting[0].name) && /wa\.me\/8801788888888/.test(r.result.waiting[0].whatsapp), r);
const ALERT = r.result.waiting[0].id;
r = await sales('erpMarketTold', [{ id: ALERT }]);
check('"told them": gone from the list', r.ok && (await sales('erpMarketWaiting', [])).result.waiting.length === 0, r);
m = await owner('erpMarketMine', []);
check('the share tab counts waiting buyers (none now)', m.result.waiting === 0, m.result.waiting);

// 6. switched off again: nothing public, the shop page is gone, the market itself still works
await owner('erpMarketSave', [{ publicOn: false }]);
r = await get('pub=find&q=sunlu');
check('off: nothing found', r.ok && r.items.length === 0, r);
r = await get('pub=shop&s=' + SLUG);
check('...the shop page is closed', !r.ok, r);
r = await owner('erpMarketMine', []);
check('...the market sharing itself is still on', r.result.on === true);

// 7. floods are slowed down
let last = null;
for (let i = 0; i < 11; i++) last = await post('pub=order', good({ consent: false }), '203.0.113.40');
check('the eleventh order attempt from one address in an hour is refused', !last.ok && /Too many/.test(last.error), last);
await done();
