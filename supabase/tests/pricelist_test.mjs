// Easy mode price list (handlers/pricelist.js): the website reads what is on the shelf, behind its sync key.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, check, done, deps, fnDir } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q, key) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, {
  method: 'GET', headers: { 'x-forwarded-for': '198.51.100.' + (++N % 250), ...(key ? { 'x-cz-key': key } : {}) } }), R)).body;
const B = 'self:' + FIX.B;
const KEY = 'test-sync-key-0123456789';

let r = await get('pub=pricelist&b=' + encodeURIComponent(B), KEY);
check('no website key set: refused', !r.ok, r);

await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, 'CZ_SYNC_KEY', ${KEY})
          on conflict (business_id, key) do update set value = excluded.value`;
r = await get('pub=pricelist&b=' + encodeURIComponent(B));
check('no key in the request: refused', !r.ok && !r.items, r);
r = await get('pub=pricelist&b=' + encodeURIComponent(B), 'wrong-key-0123456789000');
check('a wrong key: refused', !r.ok && !r.items, r);

r = await get('pub=pricelist&b=' + encodeURIComponent(B), KEY);
check('the right key: the list', r.ok && Array.isArray(r.items) && r.items.length > 0, r);
const items = r.ok ? r.items : [];
check('only things in stock, with a price', items.every((x) => x.price > 0), items.slice(0, 3));
check('never the cost or the count', items.every((x) => !('cost' in x) && !('stock' in x) && !('qty' in x) && !('available' in x)), items[0]);
check('every row says what it is', items.every((x) => x.code && x.name && 'category' in x && 'brand' in x && 'type' in x), items[0]);

const zero = (await sql`select p.sku from products p left join product_stock ps on ps.product_id = p.id
                        where p.business_id = ${FIX.B} and coalesce(ps.stock, 0) <= 0 limit 1`)[0];
if (zero) check('an empty shelf row is left out', !items.some((x) => x.code.toLowerCase() === String(zero.sku).toLowerCase()), zero);
const other = (await sql`select sku from products where business_id = ${FIX.B2} limit 1`)[0];
if (other) check('another business\'s products never show', !items.some((x) => x.code === other.sku), other);

done();
