// The master catalogue (handlers/catalogue.js): two shops list the same physical thing under different names; the
// job links both to one item from the words; Find stock shows one item with two shops; a name without a brand waits;
// the AI reader settles the unsure ones in a batch; the provider unlinks and renames; an admin decision stays.
import { sql, FIX, owner, mgr, check, done, deps, web, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { catalogSync, fieldsOf, keyOf, nameOf } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'catalogue.js')));
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': '198.51.100.' + (++N % 250) } }), R)).body;

// 1. the words
let f = fieldsOf({ name: 'Bambulab Pla Basic Jade White', brand: 'Bambulab', color: 'Jade White' });
check('fields from a Costareen-style name (no size written = the 1 kg spool)', f.brand === 'bambulab' && f.line === 'pla basic' && f.colour === 'jade white' && f.size === '1kg' && f.variant === '', f);
let f2 = fieldsOf({ name: 'Bambu Lab PLA Basic Refill - Jade White 1kg', brand: '', color: '' });
check('the same thing written another way: same brand, line, colour; refill and 1kg seen', f2.brand === 'bambulab' && f2.line === 'pla basic' && f2.colour === 'jade white' && f2.size === '1kg' && f2.variant === 'refill', f2);
check('a shown name in one style', nameOf(f2) === 'Bambu Lab PLA Basic Jade White 1 kg (refill)', nameOf(f2));
check('keys: the refill is not the spool', keyOf(f) !== keyOf(f2), [keyOf(f), keyOf(f2)]);

// 2. two public shops list the same spool under different names, plus one name with no brand
const P1 = crypto.randomUUID(), P2 = crypto.randomUUID(), P3 = crypto.randomUUID(), P4 = crypto.randomUUID();
await sql`insert into erp_market_shops (source, business_id, slug, name, city, public, orders) values ('self', ${FIX.B}, 'costareen-t', 'Costareen', 'Dhaka', true, false), ('self', ${FIX.B2}, 'other-t', 'Other Shop', 'Chittagong', true, false) on conflict (source, business_id) do update set public = true`;
await sql`insert into erp_market_listings (source, business_id, product_id, name, category, brand, color, unit, band, price, city) values
  ('self', ${FIX.B}, ${P1}, 'Bambulab Pla Basic Jade White', 'Filaments', 'Bambulab', 'Jade White', 'Roll', 'in', 1700, 'Dhaka'),
  ('self', ${FIX.B2}, ${P2}, 'BBL PLA Basic - Jade White 1kg', 'Filament', '', '', 'pc', 'in', 1650, 'Chittagong'),
  ('self', ${FIX.B2}, ${P3}, 'PLA Black', '', '', '', 'pc', 'in', 900, 'Chittagong'),
  ('self', ${FIX.B2}, ${P4}, 'SL Silk Rnbw 1kg', 'Filament', '', '', 'pc', 'low', 1800, 'Chittagong')`;
let r = await catalogSync(deps, { ai: false });
check('the job without AI: the two Jade White names linked to one item, "PLA Black" and the typo left', r.linked === 2 && r.created === 1 && r.left === 2, r);
const items = await sql`select i.id, i.name, (select count(*)::int from erp_catalog_links k where k.item_id = i.id) as n from erp_catalog_items i order by i.id`;
const jade = items.find((i) => /Jade White/.test(i.name));
check('one item "Bambu Lab PLA Basic Jade White 1 kg"... with both shops', !!jade && jade.n === 2 && !/refill/.test(jade.name), items);
const loose = await sql`select l.name from erp_market_listings l left join erp_catalog_links k on k.source = l.source and k.product_id = l.product_id where k.item_id is null`;
check('"PLA Black" (no brand) is not linked', loose.some((x) => x.name === 'PLA Black'), loose);

// 3. Find stock shows one item with two shops, under the catalogue name
r = await get('pub=find&q=jade');
const it = r.ok ? r.result || r : r;
const found = (r.items || []).find((x) => /Jade White/.test(x.name));
check('Find stock: one item, two shops, the catalogue’s name', r.ok && (r.items || []).length === 1 && found && found.shops.length === 2 && found.item > 0, r.items);

// 4. the AI reader: the typo "SL Silk Rnbw 1kg" is Sunlu PLA Silk Rainbow; "PLA Black" has no brand and stays loose
deps.geminiKey = 'k';
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const lines = JSON.parse(opts.body).contents[0].parts[0].text.split('\n').filter((l) => /^\d+\. /.test(l));
  const ans = lines.map((l) => { const i = Number(l.split('.')[0]); return /Rnbw/.test(l) ? { i, brand: 'Sunlu', line: 'PLA Silk', colour: 'Rainbow', size: '1kg', variant: '' } : { i, brand: '', line: 'PLA', colour: 'Black', size: '', variant: '' }; });
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(ans) }] } }] } };
});
r = await catalogSync(deps, { ai: true });
const silk = (await sql`select i.name, i.made_by from erp_catalog_items i join erp_catalog_links k on k.item_id = i.id where k.product_id = ${P4}`)[0];
check('the AI reader’s answer made the item and the link; the brand-less one stayed loose', r.ai === 1 && r.left === 1 && silk && silk.name === 'Sunlu PLA Silk Rainbow 1 kg' && silk.made_by === 'ai', { r, silk });
deps.geminiKey = '';

// 5. the provider: the card, unlink, rename; an admin decision survives the next run
r = await mgr('erpCatalogue', []);
check('not the provider: refused', !r.ok, r);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
r = await owner('erpCatalogue', []);
check('counts, the loose list, the log', r.ok && r.result.items >= 2 && r.result.linked >= 3 && r.result.loose.some((x) => x.name === 'PLA Black') && r.result.log.length >= 2, r);
r = await owner('erpCatalogueAct', [{ action: 'unlink', source: 'self', productId: P2 }]);
check('unlinked by the provider', r.ok && r.result.linked === 2, r.ok ? r.result.linked : r);
r = await catalogSync(deps, { ai: false });
const again = (await sql`select item_id, how from erp_catalog_links where product_id = ${P2}`)[0];
check('the next run leaves the admin’s decision alone', again && again.how === 'admin' && again.item_id === null, again);
r = await owner('erpCatalogueAct', [{ action: 'rename', item: jade.id, name: 'Bambu Lab PLA Basic Jade White (1 kg spool)' }]);
check('renamed', r.ok && r.result.list.some((x) => x.name === 'Bambu Lab PLA Basic Jade White (1 kg spool)' && x.madeBy === 'admin'), r);
r = await get('pub=find&q=jade');
check('Find stock shows the new name, now one shop (the other was unlinked and shows under its own name)', r.ok && r.items.some((x) => x.name === 'Bambu Lab PLA Basic Jade White (1 kg spool)' && x.shops.length === 1) && r.items.some((x) => x.name === 'BBL PLA Basic - Jade White 1kg'), r.items.map((x) => x.name + ':' + x.shops.length));
// a renamed listing is looked at again; a 'self' listing with a changed name
await sql`update erp_market_listings set name = 'Bambulab Pla Basic Black', color = 'Black' where product_id = ${P1}`;
r = await catalogSync(deps, { ai: false });
const moved = (await sql`select i.name from erp_catalog_items i join erp_catalog_links k on k.item_id = i.id where k.product_id = ${P1}`)[0];
check('a shop renames its product: re-linked to the right item', moved && /Black/.test(moved.name), moved);
await done();
