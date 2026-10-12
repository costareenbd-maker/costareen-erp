// Any website: the open door (?shop=...) and matching website products whose SKUs differ.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir } from './harness.mjs';
const { shopDoor } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'shop.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const { likeness, extKey } = await import(pathToFileURL(path.join(fnDir, 'lib', 'match.js')));
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const pla = (await sql`select name, sell_price from products where business_id = ${B} and sku = ${PLA}`)[0];
const stockOf = async (sku) => Number((await sql`select coalesce(ps.stock, 0) s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${B} and p.sku = ${sku}`)[0].s);

const door = async (what, key, method = 'GET', body) => {
  const req = new Request('https://fn.test/erp?shop=' + what, { method, headers: { 'x-shop-key': key || '', 'content-type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body) });
  return shopDoor(deps, asBusiness, owners, req);
};

// names alike
check('likeness: same product, other words', likeness('Sunlu PLA Black 1kg 1.75mm', 'SUNLU PLA filament 1.75mm black 1kg') >= 0.6, likeness('Sunlu PLA Black 1kg 1.75mm', 'SUNLU PLA filament 1.75mm black 1kg'));
check('likeness: another size is held back', likeness('Sunlu PLA Black 1kg', 'Sunlu PLA Black 3kg') < likeness('Sunlu PLA Black 1kg', 'Sunlu PLA Black 1kg spool'));
check('a website item is known by its SKU, or its name', extKey(' AB-1 ', 'x') === 'ab-1' && extKey('', 'Sunlu  PLA!') === 'name:sunlu pla');

// the key
let r = await mgr('erpShopKey', [{ make: true }]);
check('only the owner makes the key', !r.ok, r);
r = await owner('erpShopKey', [{ make: true }]);
const key = r.ok && r.result.key;
check('the key is shown once, kept as a hash', r.ok && /^shop_/.test(key) &&
  (await sql`select value from business_secrets where business_id = ${B} and key = 'SHOP_KEY_HASH'`)[0].value.length === 64 &&
  !(await sql`select 1 from business_secrets where value = ${key}`).length, r);
r = await owner('erpShopKey', []);
check('...and never shown again', r.ok && r.result.hasKey && !r.result.key, r.result);

// the door
r = await door('ping', 'shop_wrongwrongwrongwrongwrong');
check('a wrong key is refused', r.status === 401, r);
r = await door('ping', '');
check('no key is refused', r.status === 401, r);
r = await door('ping', key);
check('ping says which business', r.status === 200 && r.body.ok && r.body.business === 'Costareen', r);
r = await door('nope', key);
check('an unknown door', r.status === 404, r);
r = await door('order', key, 'GET');
check('the wrong method', r.status === 405, r);

r = await door('stock', key);
const plaRow = r.body.items && r.body.items.find((x) => x.sku === PLA);
check('stock: every product with qty and price', r.status === 200 && plaRow && plaRow.qty === Math.max(0, Math.round(await stockOf(PLA))) && plaRow.price === Number(pla.sell_price), plaRow);

// an order whose SKU is the website's own
const order = { number: 'W-1001', created: '2026-10-03T10:00:00', status: 'processing', customer: 'Door Buyer', phone: '01711000111', address: 'Road 1',
  payment: 'Cash on delivery', total: Number(pla.sell_price) * 2 + 80,
  items: [{ sku: 'SUN-PLA-BLK-1KG', name: pla.name + ' (website)', qty: 2, line_total: Number(pla.sell_price) * 2 }] };
r = await door('order', key, 'POST', order);
check('an order comes in, its item not matched yet', r.status === 200 && r.body.ok && r.body.added === 1 && r.body.unmatched.length === 1, r);
r = await door('order', key, 'POST', order);
check('sent twice: kept once', r.body.ok && r.body.duplicate === true && (await sql`select count(*)::int n from web_orders where business_id = ${B} and order_no = 'W-1001'`)[0].n === 1, r);
r = await door('order', key, 'POST', { number: 'bad no', items: [] });
check('a broken order is refused with the reason', r.status === 400 && /number/.test(r.body.error), r);
r = await door('order', key, 'POST', { number: 'W-1002', items: [{ sku: 'X', qty: 0 }] });
check('qty 0 is refused', r.status === 400 && /qty/.test(r.body.error), r);

r = await owner('erpEnterWebOrder', ['W-1001']);
check('entering an unmatched order says what to match', !r.ok && /Not matched to a product yet: SUN-PLA-BLK-1KG/.test(r.error), r);

// matching
r = await sales('erpWebMatches', []);
check('sales staff cannot match', !r.ok, r);
r = await mgr('erpWebMatches', []);
const item = r.ok && r.result.unmatched.find((x) => x.key === 'sun-pla-blk-1kg');
check('the item waits, with the right product suggested first', item && item.orders === 1 && item.suggest[0] && item.suggest[0].sku === PLA, item);
r = await mgr('erpWebMatchSet', [{ key: 'sun-pla-blk-1kg', sku: 'NOPE' }]);
check('linking to a product that is not there', !r.ok, r);
r = await mgr('erpWebMatchSet', [{ key: 'sun-pla-blk-1kg', sku: PLA, name: item.name }]);
check('linked once', r.ok && r.result.sku === PLA, r);
r = await mgr('erpWebMatches', []);
check('...and no longer waiting', r.ok && !r.result.unmatched.some((x) => x.key === 'sun-pla-blk-1kg') && r.result.links.some((l) => l.key === 'sun-pla-blk-1kg' && l.sku === PLA), r.result);

// stock goes out under the website's SKU too, less the order not entered yet
const before = await stockOf(PLA);
r = await door('stock', key);
const alias = r.body.items.find((x) => x.sku === 'SUN-PLA-BLK-1KG'), own = r.body.items.find((x) => x.sku === PLA);
check('stock under the website SKU as well, the waiting order held back', alias && own && alias.qty === own.qty && own.qty === Math.max(0, Math.round(before - 2)), [alias, own, before]);

r = await owner('erpEnterWebOrder', ['W-1001']);
check('entered: a real invoice, stock deducted from the matched product', r.ok && (await stockOf(PLA)) === before - 2, r);

// a cancelled order: status updated, nothing held for it
await door('order', key, 'POST', { number: 'W-1003', customer: 'C', items: [{ sku: 'SUN-PLA-BLK-1KG', name: 'x', qty: 5, line_total: 1 }] });
let s1 = (await door('stock', key)).body.items.find((x) => x.sku === PLA).qty;
await door('order', key, 'POST', { number: 'W-1003', status: 'cancelled', customer: 'C', items: [{ sku: 'SUN-PLA-BLK-1KG', name: 'x', qty: 5, line_total: 1 }] });
let s2 = (await door('stock', key)).body.items.find((x) => x.sku === PLA).qty;
check('a cancelled order shows cancelled and holds no stock', (await sql`select status from web_orders where business_id = ${B} and order_no = 'W-1003'`)[0].status === 'cancelled' && s2 === s1 + 5, [s1, s2]);

// a website with no SKUs: matched by name, remembered by name
r = await door('order', key, 'POST', { number: 'W-1004', customer: 'N', items: [{ name: 'Sunlu Black PLA spool', qty: 1, price: 900 }] });
check('no SKU: comes in by name', r.body.ok && r.body.unmatched[0] === 'Sunlu Black PLA spool', r);
r = await mgr('erpWebMatchSet', [{ key: 'name:sunlu black pla spool', sku: PLA }]);
r = await owner('erpEnterWebOrder', ['W-1004']);
check('...and enters once linked by name', r.ok, r);

// barcode in the SKU field matches by itself
await sql`update products set barcode = '8801234567890' where business_id = ${B} and sku = ${PLA}`;
r = await door('order', key, 'POST', { number: 'W-1005', customer: 'Bc', items: [{ sku: '8801234567890', name: 'whatever', qty: 1, price: 1 }] });
check('a barcode matches without a link', r.body.ok && r.body.unmatched.length === 0, r);

// the website's product list, matched before any order
r = await door('products', key, 'POST', { items: [{ sku: PLA.toLowerCase(), name: 'same sku other case' }, { sku: 'WEB-ONLY-9', name: 'A Thing Only The Website Has', price: 5 }] });
check('product list: same SKU (any case) matched, the other waits', r.status === 200 && r.body.matched === 1 && r.body.unmatched === 1, r);
r = await mgr('erpWebMatches', []);
check('...shown as on the website, no orders', r.result.unmatched.some((x) => x.key === 'web-only-9' && x.onSite && x.orders === 0), r.result.unmatched.slice(0, 3));

// unlink
r = await mgr('erpWebMatchClear', [{ key: 'sun-pla-blk-1kg' }]);
check('a link can be undone', r.ok && !(await sql`select 1 from web_product_links where business_id = ${B} and ext_key = 'sun-pla-blk-1kg'`).length, r);

// key replaced / removed: the old one stops
r = await owner('erpShopKey', [{ make: true }]);
check('a new key stops the old one', (await door('ping', key)).status === 401 && (await door('ping', r.result.key)).status === 200);
await owner('erpShopKey', [{ remove: true }]);
check('removed: the door is shut', (await door('ping', r.result.key)).status === 401);
check('the other business has no links', (await sql`select count(*)::int n from web_product_links where business_id = ${FIX.B2}`)[0].n === 0);
await done();
