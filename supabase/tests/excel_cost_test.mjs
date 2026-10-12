// Excel out: the cost the ERP uses (own cost, else the price book's landed cost); customers' notes; the price book's
// landed cost and margin; reading the export back does not turn a price-book cost into a product cost.
import { owner, sql, files, FIX, check, done } from './harness.mjs';

const SKU = 'FIL-SUN-PLA-BLA-001';
const p = (await sql`select category, brand, type from products where business_id = ${FIX.B} and sku = ${SKU}`)[0];
await sql`update products set cost_price = 0 where business_id = ${FIX.B} and sku = ${SKU}`;
await sql`delete from cost_book where business_id = ${FIX.B}`;
await sql`insert into cost_book (business_id, sort_order, category, brand, type, buy_bdt, handling) values (${FIX.B}, 1, ${p.category}, ${p.brand}, ${p.type}, 1000, 50)`;
await sql`update customers set note = 'pays by bKash only' where business_id = ${FIX.B} and id = (select id from customers where business_id = ${FIX.B} order by name limit 1)`;

const text = (name) => { const k = files.list().filter((x) => x.includes('/exports/') && x.includes(name)).pop(); return k ? new TextDecoder().decode(files.get(k).bytes) : ''; };

let r = await owner('erpExport', [{ what: 'products' }]);
let t = text('products');
check('products: a product with no cost of its own shows the price book\'s landed cost', r.ok && t.includes('price book (landed)') && t.includes('1050'), r);
r = await owner('erpExport', [{ what: 'customers' }]);
check('customers: the notes are in the file', r.ok && text('customers').includes('pays by bKash only'), r);
r = await owner('erpExport', [{ what: 'costbook' }]);
t = text('price book');
check('price book: landed cost and margin columns, with the landed figure', r.ok && t.includes('Landed cost') && t.includes('Margin') && t.includes('1050'), r);

// reading the products file back: the landed cost is not taken as a new product cost
r = await owner('erpImport', [{ what: 'products', rows: [{ SKU: SKU, Cost: '1050' }] }]);
check('import: the price book\'s landed cost read back is not a change', r.ok && r.result.change.length === 0, r.ok && r.result);
r = await owner('erpImport', [{ what: 'products', rows: [{ SKU: SKU, Cost: '980' }] }]);
check('import: a different cost is still a change', r.ok && r.result.change.length === 1 && /cost/.test(r.result.change[0].text), r.ok && r.result);
await done();
