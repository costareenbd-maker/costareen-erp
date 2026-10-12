// Stage N5b: the Colour Finder's maths (CIEDE2000 against the published test pairs), the colour-name dictionary,
// and the shop's swatches carried on the market listing to the public page.
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import { sql, FIX, owner, check, done, deps, fnDir } from './harness.mjs';
const require = createRequire(import.meta.url);
const webDir = path.join(fnDir, '..', '..', '..', 'web');
const C = require(path.join(webDir, 'colour-math.js'));
const D = require(path.join(webDir, 'colour-data.js'));
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': '198.51.100.' + (++N % 250) } }), R)).body;

// 1. CIEDE2000 against Sharma, Wu and Dalal's published pairs
const pairs = [
  [[50, 2.6772, -79.7751], [50, 0, -82.7485], 2.0425],
  [[50, 3.1571, -77.2803], [50, 0, -82.7485], 2.8615],
  [[50, 2.8361, -74.0200], [50, 0, -82.7485], 3.4412],
  [[50, -1.3802, -84.2814], [50, 0, -82.7485], 1.0000],
  [[50, 0, 0], [50, -1, 2], 2.3669],
  [[50, -1, 2], [50, 0, 0], 2.3669],
  [[50, 2.4900, -0.0010], [50, -2.4900, 0.0009], 7.1792],
  [[50, 2.5, 0], [73, 25, -18], 27.1492],
  [[60.2574, -34.0099, 36.2677], [60.4626, -34.1751, 39.4387], 1.2644],
];
for (const [a, b, want] of pairs) {
  const got = C.deltaE2000(a, b);
  check('dE2000 ' + JSON.stringify(a) + ' vs ' + JSON.stringify(b) + ' = ' + want, Math.abs(got - want) < 0.01, got);
}
check('the same colour is distance 0', C.deltaE2000([50, 10, 10], [50, 10, 10]) === 0);
check('hex to Lab: white is L 100, black is L 0', Math.abs(C.hexToLab('#ffffff')[0] - 100) < 0.01 && Math.abs(C.hexToLab('#000000')[0]) < 0.01, [C.hexToLab('#ffffff'), C.hexToLab('#000000')]);
check('a bad hex is null', C.hexToLab('red') === null && C.parseHex('#12345') === null);
check('labels: under 6 very close, under 13 close, else roughly', C.labelFor(3) === 'very close' && C.labelFor(9) === 'close' && C.labelFor(20) === 'roughly');
const near = C.closest([220, 40, 40], [{ hex: '#d42a2a', name: 'red' }, { hex: '#2b6fd6', name: 'blue' }, { hex: '#f5d327', name: 'yellow' }], 3);
check('closest: red first and very close; the other two far ("roughly"), in order of distance', near[0].name === 'red' && near[0].label === 'very close' && near[1].label === 'roughly' && near[2].label === 'roughly' && near[1].dE < near[2].dE, near);
const wb = C.whiteBalance([200, 180, 160], [230, 210, 190]);
check('white balance against a warm reference pulls the sample back towards neutral', Math.abs(wb[0] - wb[2]) < Math.abs(200 - 160), wb);

// 2. the dictionary
check('colour names: "Ice Blue 1kg" -> the ice blue value, Bangla "লাল" -> red, unknown -> empty', D.colourHexFor('Ice Blue 1kg') === '#a7d8f0' && D.colourHexFor('লাল') === '#d42a2a' && D.colourHexFor('Silk Gold') === '#d4af37' && D.colourHexFor('zzz') === '', [D.colourHexFor('Ice Blue 1kg'), D.colourHexFor('লাল')]);
check('the longest matching name wins ("dark blue" is not "blue")', D.colourHexFor('Dark Blue') === '#1b3a7a' && D.colourHexFor('Blue') === '#2b6fd6');

// 3. a shop's swatches travel to the public listing
let m = await owner('erpMarketMine', []);
const fil = m.result.products.find((p) => p.sku === 'FIL-SUN-PLA-BLA-001');
let r = await owner('erpMarketSave', [{ on: true, city: 'Dhaka', publicOn: true, products: [{ id: fil.id, shared: true, mode: 'price' }] }]);
check('shared and public', r.ok && r.result.listed === 1, r);
m = await owner('erpMarketMine', []);
check('the share tab lists the colour names of the shared products, swatch not set yet', m.result.colours.length === 1 && m.result.colours[0].name === 'Black' && m.result.colours[0].hex === '', m.result.colours);
r = await owner('erpMarketSave', [{ colours: { Black: 'dark' } }]);
check('a swatch must be a hex colour', !r.ok && /#1a2b3c/.test(r.error), r);
r = await owner('erpMarketSave', [{ colours: { Black: '#111111' } }]);
check('swatch saved', r.ok, r);
m = await owner('erpMarketMine', []);
check('...shown on the share tab', m.result.colours[0].hex === '#111111', m.result.colours);
r = await get('pub=find&q=sunlu');
check('the public listing carries the swatch', r.ok && r.items.length === 1 && r.items[0].hex === '#111111' && r.items[0].shops[0].hex === '#111111', r.items);
const SLUG = m.result.shopUrl.split('s=')[1];
r = await get('pub=shop&s=' + SLUG);
check('...and the shop page too', r.ok && r.items[0].hex === '#111111', r.items);
r = await owner('erpMarketSave', [{ colours: { Black: '' } }]);
check('a swatch can be cleared', r.ok && (await owner('erpMarketMine', [])).result.colours[0].hex === '', r);
check('no SKU, cost or stock number on the listing (unchanged)', (() => { const row = null; return true; })());
const row = (await sql`select * from erp_market_listings where business_id = ${FIX.B} limit 1`)[0];
check('...really: the listing row has no sku, no cost, no stock', row && !('sku' in row) && !('cost_price' in row) && !('stock' in row) && 'color_hex' in row, Object.keys(row || {}));
await done();
