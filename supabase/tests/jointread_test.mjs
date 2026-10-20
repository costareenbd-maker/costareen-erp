// smart-read-3 on the joint Receive page (owner 21 Oct 2026: "do the same for the joint stock receive page"):
// a supplier's file read into the joint stock gets what the own Receive page got - the supplier's code as the SKU and
// matched next time, no selling price needed while the file does not give one, new colours/brands into the own Lists.
import { sql, FIX, owner, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'partnerjr@t.test', ${sql.json({ full_name: 'Partner Owner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Partner Shop') as id`;
}))[0].id;
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
const A = FIX.B;
await sql`insert into joint_flags (business_id) values (${A}), (${B3}) on conflict do nothing`;
let r = await owner('erpJointStart', [{ action: 'create', name: 'Read JV', displayName: 'Costareen', tier: 'retail' }]);
const POOL = r.result.created.id;
await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Partner Shop', tier: 'wholesale' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black', brand: 'Polymaker', type: 'PLA', retail: 2000, cost: 1400 }]);

// 1. the suggestion: the supplier's code as SKU, the joint products as the siblings
r = await owner('erpProductSuggest', [{ pool: POOL, name: 'Panchroma PLA Matte Wood Brown', brand: 'Polymaker', colour: 'Matte Wood Brown', code: 'cao4077', price: 4.20, currency: 'USD', rate: 122 }]);
check('joint: the supplier\'s code is the SKU, cost = price x rate, siblings are the joint products', r.ok && r.result.product.sku === 'CA04077' && r.result.product.cost_price === 512 &&
  r.result.examples.includes('Polymaker PLA Black'), r.result);

// 2. a new joint product from the file: no selling price yet is fine; the code is kept; the colour joins the own Lists
r = await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'CA04077', name: 'Polymaker PLA Matte Wood Brown', brand: 'Polymaker', type: 'PLA', color: 'Matte Wood Brown',
                                      retail: 0, cost: 0, supplierSku: 'CA04077' }]);
check('joint: a new product from a file is made without a selling price', r.ok && r.result.saved === 'CA04077', r);
const row = (await sql`select supplier_sku, sell_price from products where business_id = ${POOL} and sku = 'CA04077'`)[0];
check('...with the supplier\'s code kept', row && row.supplier_sku === 'CA04077' && Number(row.sell_price) === 0, row);
const lk = await sql`select 1 from lookups where business_id = ${A} and kind = 'colors' and value = 'Matte Wood Brown'`;
check('...and its new colour is in this company\'s own Settings > Lists', lk.length === 1, lk);
r = await owner('erpJointProduct', [{ pool: POOL, sku: 'CA04077', name: 'Polymaker PLA Matte Wood Brown', retail: 0 }]);
check('changing an existing joint product still needs the selling price', !r.ok && /retail selling price/.test(r.error), r);
r = await owner('erpJointProduct', [{ pool: POOL, isNew: true, name: 'Bad', retail: 1000, floor: 1200 }]);
check('the floor above the price is still refused', !r.ok && /floor price/.test(r.error), r);

// 3. the next file matches it by the supplier's code, inside the joint stock only
r = await owner('erpReceiveMatch', [{ pool: POOL, rows: ['10 CA04077 Panchroma™ PLA Matte 20.000 PCS 4.20 USD 84.00 NA', 'Wood Brown/1.75mm/1.00kg'], kind: 'text', reader: 'ocr' }]);
const L = r.ok ? r.result.lines : [];
check('joint: the next file finds it (its SKU is the code)', r.ok && L.length === 1 && L[0].sku === 'CA04077' && L[0].qty === 20, L);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-SILK-GLD', name: 'Polymaker PLA Silk Gold', brand: 'Polymaker', retail: 2200, cost: 0, supplierSku: 'CA03039' }]);
r = await owner('erpReceiveMatch', [{ pool: POOL, rows: ['360 CA03039 Panchroma™ PLA Silk 10.000 PCS 5.35 USD 53.50 NA', 'Gold/1.75mm/1.00kg'], kind: 'text', reader: 'ocr' }]);
check('joint: a product with its own SKU is found by the supplier\'s code kept on it', r.ok && r.result.lines[0].sku === 'PM-SILK-GLD' && r.result.lines[0].how === 'supplier code', r.result && r.result.lines);
r = await owner('erpReceiveMatch', [{ rows: ['10 CA04077 Panchroma™ PLA Matte 20.000 PCS 4.20 USD 84.00 NA', 'Wood Brown/1.75mm/1.00kg'], kind: 'text', reader: 'ocr' }]);
check('...and the own Receive page does not see the joint product', r.ok && r.result.lines.length === 1 && r.result.lines[0].sku !== 'CA04077', r.result && r.result.lines);

// 4. a code already taken in the joint stock is not given again
r = await owner('erpProductSuggest', [{ pool: POOL, name: 'Panchroma PLA Matte Wood Brown', brand: 'Polymaker', code: 'CA04077' }]);
check('joint: a code already in the joint stock is not suggested twice', r.ok && r.result.product.sku !== 'CA04077', r.result && r.result.product);

await done();
