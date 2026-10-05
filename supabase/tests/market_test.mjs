// Stage 2: the open market - who sees what, what is copied, the timer, the refusals.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { sql, FIX, owner, mgr, sales, call, check, done, deps, fnDir } from './harness.mjs';
const { saveTenant } = await import(pathToFileURL(path.join(fnDir, 'lib', 'bridge.js')));
const { runJob } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));

const other = (name, args) => call(name, args, { authHeader: 'Bearer owner:' + FIX.U.other });   // owner of B2 ("Elsewhere")
const L = () => sql`select * from erp_market_listings order by name`;

// 1. refusals and the empty start
let r = await mgr('erpMarketSave', [{ on: true, city: 'Dhaka' }]);
check('only the owner changes what is shared', !r.ok, r);
r = await owner('erpMarketMine', []);
check('owner sees every product, nothing shared yet', r.ok && !r.result.on && r.result.products.length === 2 && r.result.products.every((p) => !p.shared), r);
const prod = Object.fromEntries(r.result.products.map((p) => [p.sku, p.id]));
r = await owner('erpMarketSave', [{ on: true }]);
check('a city is required when sharing', !r.ok && /city/.test(r.error), r);

// 2. the provider's own business shares: price for one, "ask" for the other
r = await owner('erpMarketSave', [{ on: true, city: 'Dhaka', products: [{ id: prod['FIL-SUN-PLA-BLA-001'], shared: true }, { id: prod['PRT-BAM-A1-001'], shared: true, mode: 'ask' }] }]);
check('saved and listed at once', r.ok && r.result.on && r.result.listed === 2, r);
let rows = await L();
check('two listings from the provider (source self)', rows.length === 2 && rows.every((x) => x.source === 'self' && x.city === 'Dhaka'), rows);
check('"ask" has no price; the other shows its sell price', rows.find((x) => x.name === 'Bambu A1').price === null && Number(rows.find((x) => x.name === 'Sunlu PLA Black').price) === 1350, rows);
check('nothing private copied (no cost, no stock number, no SKU)', !('cost_price' in rows[0]) && !('stock' in rows[0]) && !('sku' in rows[0]));

// 3. a business that does not share sees the provider's stock only, unlabelled
r = await other('erpMarket', []);
check('non-sharing business sees the provider\'s stock', r.ok && !r.result.sharing && r.result.items.length === 2, r);
check('seller shown as "Supplier · city" only', r.result.items.every((x) => x.seller === 'Supplier · Dhaka' && !('business_id' in x)), r.result.items);
r = await owner('erpMarket', []);
check('a seller does not see its own listings', r.ok && r.result.items.length === 0, r);
r = await sales('erpMarket', [{ q: 'sunlu' }]);
check('sales staff can search the market', r.ok, r);

// 4. a company on the provider's server (bridged) lists too
const KEY = randomBytes(32).toString('base64');
const T = '00000000-0000-4000-8000-0000000000f2';
await sql`insert into erp_installs (id, company, owner_name, owner_email, status, step, ref, secret_hash) values (${T}, 'Far Co', 'F', 'f@f.test', 'active', 'done', 'fref', 'x')`;
await saveTenant(sql, KEY, T, { url: 'https://fref.supabase.co', anon: 'A', service: 'S', dbUrl: 'postgresql://x' });
const fb = '00000000-0000-4000-8000-0000000000f3';
await sql`insert into erp_market_listings (source, business_id, product_id, name, category, band, price, city) values (${T}, ${fb}, gen_random_uuid(), 'Creality K1', 'Printers', 'low', 60000, 'Chattogram')`;
await sql`insert into erp_market_listings (source, business_id, product_id, name, band, city, updated_at) values (${T}, ${fb}, gen_random_uuid(), 'Old stale thing', 'in', 'Chattogram', now() - interval '5 days')`;
r = await other('erpMarket', []);
check('...not visible to a business that does not share', r.result.items.length === 2 && !r.result.items.some((x) => x.name === 'Creality K1'), r.result.items.map((x) => x.name));
r = await owner('erpMarket', []);
check('...visible to a sharing business, with its city and band', r.result.items.length === 1 && r.result.items[0].name === 'Creality K1' && r.result.items[0].band === 'low' && r.result.items[0].seller === 'Supplier · Chattogram', r.result.items);
check('a seller not refreshed for days drops out', !r.result.items.some((x) => x.name === 'Old stale thing'));
r = await owner('erpMarket', [{ category: 'Filaments' }]);
check('category filter', r.ok && r.result.items.length === 0 && r.result.categories.includes('Printers'), r.result);

// 5. B2 starts sharing: now it sees everyone, and everyone sharing sees it
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) select business_id, id, 'RECEIVE', 'IN', 50 from products where sku = 'X-OTHER'`;
const xo = (await sql`select id from products where sku = 'X-OTHER'`)[0].id;
r = await other('erpMarketSave', [{ on: true, city: 'Sylhet', products: [{ id: xo, shared: true }, { id: prod['FIL-SUN-PLA-BLA-001'], shared: true }] }]);
check('another business cannot share someone else\'s product', r.ok && r.result.listed === 1, r);
r = await other('erpMarket', []);
check('sharing on: provider + every sharing company, own excluded', r.result.sharing && r.result.items.length === 3 && !r.result.items.some((x) => x.name === 'Other shop item'), r.result.items.map((x) => x.name));
r = await owner('erpMarket', []);
check('the provider\'s business sees the new seller', r.result.items.some((x) => x.name === 'Other shop item' && x.seller === 'Supplier · Sylhet'), r.result.items);

// 6. a switched-off company leaves the market at once
await sql`update erp_tenants set status = 'locked' where id = ${T}`;
r = await owner('erpMarket', []);
check('a switched-off company\'s listings are hidden', !r.result.items.some((x) => x.name === 'Creality K1'), r.result.items.map((x) => x.name));
await sql`update erp_tenants set status = 'active' where id = ${T}`;

// 7. the 15-minute timer: stock goes low, product sold out
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${FIX.B}, ${prod['PRT-BAM-A1-001']}, 'SALE', 'OUT', 1)`;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${FIX.B}, ${prod['FIL-SUN-PLA-BLA-001']}, 'SALE', 'OUT', 7)`;
const job = await runJob(deps, 'websync');
rows = await sql`select name, band from erp_market_listings where source = 'self' and business_id = ${FIX.B}`;
check('timer: the printer is now "low"; the sold-out filament left the market', rows.length === 1 && rows[0].name === 'Bambu A1' && rows[0].band === 'low', { rows, job });

// 8. sharing off removes every listing of that business
r = await owner('erpMarketSave', [{ on: false }]);
rows = await sql`select 1 from erp_market_listings where source = 'self' and business_id = ${FIX.B}`;
check('sharing off: its listings are gone', r.ok && rows.length === 0, r);
r = await owner('erpMarket', []);
check('...and it sees the provider\'s stock only again (B2 is a provider business too)', r.ok && !r.result.sharing && !r.result.items.some((x) => x.name === 'Creality K1'), r.result.items.map((x) => x.name));

// 9. an old stand-alone copy (its own server) has no market
const had = deps.install; deps.install = { id: 'old-copy' };
r = await owner('erpMarket', []);
check('an old stand-alone copy is refused politely', !r.ok && /provider/.test(r.error), r);
deps.install = had;
await done();
