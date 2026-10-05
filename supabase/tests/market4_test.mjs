// Stage 4: low-stock hints, price guide, shared product names, wanted board.
import { sql, FIX, owner, mgr, sales, call, check, done } from './harness.mjs';

const other = (name, args) => call(name, args, { authHeader: 'Bearer owner:' + FIX.U.other });   // owner of B2 ("Elsewhere")

// the provider's business B shares; B2 has a nearly-same product running low
let r = await owner('erpMarketMine', []);
const prod = Object.fromEntries(r.result.products.map((p) => [p.sku, p.id]));
await owner('erpMarketSave', [{ on: true, city: 'Dhaka', products: [{ id: prod['FIL-SUN-PLA-BLA-001'], shared: true }, { id: prod['PRT-BAM-A1-001'], shared: true, mode: 'ask' }] }]);
await sql`insert into products (business_id, sku, name, sell_price, reorder_level) values (${FIX.B2}, 'B2-PLA', 'Sunlu PLA Black 1kg', 1500, 3), (${FIX.B2}, 'B2-PLAW', 'Sunlu PLA White', 1500, 3), (${FIX.B2}, 'B2-PLAT', 'Sunlu PLA Twinkling Black', 1500, 3)`;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) select business_id, id, 'RECEIVE', 'IN', 1 from products where sku in ('B2-PLA', 'B2-PLAW', 'B2-PLAT')`;

// 1. low-stock hints
r = await other('erpMarketHints', []);
check('a low product with a match on the market is hinted, with the lowest price', r.ok && r.result.items.length === 1 && r.result.items[0].name === 'Sunlu PLA Black 1kg' && r.result.items[0].from === 1350 && r.result.items[0].stock === 1, r.result);
check('a different colour or kind is not a match', !r.result.items.some((x) => x.name === 'Sunlu PLA White' || x.name === 'Sunlu PLA Twinkling Black'));

// 2. price guide (only what this business may see: B2 does not share, so the provider's listings)
await other('erpMarketSave', [{ on: true, city: 'Sylhet', products: [{ id: (await sql`select id from products where sku = 'B2-PLA'`)[0].id, shared: true }] }]);
r = await owner('erpMarketMine', []);
const g = r.result.products.find((p) => p.sku === 'FIL-SUN-PLA-BLA-001').guide;
check('price guide: the market\'s range for my product (others only)', g && g.sellers === 1 && g.low === 1500 && g.high === 1500, g);
check('no guide where nothing matches', r.result.products.find((p) => p.sku === 'PRT-BAM-A1-001').guide === null);

// 3. shared names (suggestions when adding a product)
r = await sales('erpMarketNames', [{ q: 'sunlu' }]);
check('names on the market, no prices or sellers', r.ok && r.result.names.some((n) => n.name === 'Sunlu PLA Black') && !('price' in r.result.names[0]), r.result);

// 4. wanted board
r = await sales('erpWantedPost', [{ item: 'Bambu P1S', qty: 2, phone: '01711111111' }]);
check('only a manager or the owner posts', !r.ok && /manager/.test(r.error), r);
r = await other('erpWantedPost', [{ item: 'Bambu A1 printer', qty: 2, phone: '01711111111', note: 'For a school', days: 10 }]);
check('posted', r.ok && r.result.wanted.status === 'open', r);
const wid = r.result.wanted.id;
r = await owner('erpWanted', []);
let w = r.result.others.find((x) => x.id === wid);
check('others see it as "Buyer · city", without name or phone', w && w.who === 'Buyer' && w.city === 'Sylhet' && !('phone' in w) && !w.offered, w);
r = await other('erpWanted', []);
check('the poster sees its own post, not in "others"', r.result.mine.some((x) => x.id === wid) && !r.result.others.some((x) => x.id === wid), r.result);

// 5. a supplier answers with a price: a request already priced, in both ERPs
r = await mgr('erpWantedOffer', [{ id: wid, sku: 'NOPE', price: 50000, phone: '01999999999' }]);
check('the offered product must be one of mine', !r.ok && /Choose/.test(r.error), r);
r = await mgr('erpWantedOffer', [{ id: wid, sku: 'PRT-BAM-A1-001', price: 50000, delivery: 500, phone: '01999999999', note: 'In stock now' }]);
check('offer made: a priced request', r.ok && r.result.request.status === 'quoted' && r.result.request.total === 100500, r);
const rid = r.result.request.id;
check('...and a quotation in the supplier\'s Quotations', (await sql`select 1 from quotations where business_id = ${FIX.B} and id = ${rid}`).length === 1);
r = await mgr('erpWantedOffer', [{ id: wid, sku: 'PRT-BAM-A1-001', price: 49000, phone: '01999999999' }]);
check('one open offer per supplier per post', !r.ok && /already offered/.test(r.error), r);
r = await other('erpMarketRequests', []);
let q = r.result.mine.find((x) => x.id === rid);
check('the poster sees the offer under Requests, seller named', q && q.status === 'quoted' && q.who === 'Costareen' && q.phone === '01999999999' && /Wanted: Bambu A1 printer/.test(q.note), q);
r = await other('erpWanted', []);
check('...and the post counts the offer', r.result.mine.find((x) => x.id === wid).offers === 1);
r = await owner('erpWanted', []);
check('the supplier sees it offered', r.result.others.find((x) => x.id === wid).offered === true);
r = await other('erpMarketAccept', [{ id: rid }]);
check('from here it is a normal deal (accept)', r.ok && r.result.request.status === 'accepted', r);

// 6. close
r = await owner('erpWantedClose', [{ id: wid }]);
check('only the poster closes its post', !r.ok, r);
r = await other('erpWantedClose', [{ id: wid }]);
check('closed', r.ok && r.result.wanted.status === 'closed', r);
r = await owner('erpWanted', []);
check('a closed post leaves the board', !r.result.others.some((x) => x.id === wid));
r = await mgr('erpWantedOffer', [{ id: wid, sku: 'PRT-BAM-A1-001', price: 1, phone: '01999999999' }]);
check('no offers on a closed post', !r.ok && /no longer open/.test(r.error), r);
await sql`update erp_market_wanted set status = 'open', until = current_date - 2 where id = ${wid}`;
r = await owner('erpWanted', []);
check('an expired post leaves the board', !r.result.others.some((x) => x.id === wid));
await done();
