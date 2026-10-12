// Plan D6: Excel out, spreadsheet in.
import { sql, FIX, owner, mgr, sales, check, done, files } from './harness.mjs';
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';

// ---------------------------------------------------------------- export
let r = await sales('erpExport', [{ what: 'products' }]);
check('exporting is a manager matter', !r.ok, r);
for (const what of ['products', 'customers', 'invoices', 'suppliers', 'serials', 'jobs', 'stock']) {
  r = await mgr('erpExport', [{ what }]);
  check('export ' + what + ': an .xlsx file with a link', r.ok && /\.xlsx$/.test(r.result.name) && /^https:\/\/files\.test\//.test(r.result.url) && r.result.rows >= 0, r);
}
await sql`update memberships set powers = '{"costs": false}'::jsonb where business_id = ${FIX.B} and user_id = ${FIX.U.mgr}`;   // since 058 a manager has Product cost unless switched off
r = await mgr('erpExport', [{ what: 'costbook' }]);
check('the price book is for shareholders and up', !r.ok, r);
await sql`update memberships set powers = '{}'::jsonb where business_id = ${FIX.B} and user_id = ${FIX.U.mgr}`;
r = await owner('erpExport', [{ what: 'costbook' }]);
check('...and exports for them', r.ok && r.result.rows >= 0, r);
r = await mgr('erpExport', [{ what: 'moon' }]);
check('unknown list', !r.ok && /Nothing called "moon"/.test(r.error), r);
check('one file per list, old copies replaced', files.list().filter((k) => k.includes('/exports/') && k.includes('products')).length === 1, files.list());

// ---------------------------------------------------------------- import: products
r = await mgr('erpImport', [{ what: 'products', rows: [] }]);
check('an empty file is said so', !r.ok && /no rows/.test(r.error), r);
const typeBefore = (await sql`select type from products where business_id = ${B} and sku = ${PLA}`)[0].type;
const stockBefore = Number((await sql`select ps.stock from products p join product_stock ps on ps.product_id = p.id where p.business_id = ${B} and p.sku = ${PLA}`)[0].stock);
const rows = [
  { 'SKU': PLA, 'Product Name': 'Sunlu PLA Black', 'Sell price': 1234, 'Stock': 999 },           // a change, and a stock figure that must be ignored
  { 'Product': 'Imported Nozzle 0.4', 'Category': 'Parts', 'Brand': 'Generic', 'Type': 'Nozzle', 'Colour': '', 'Unit': 'Piece', 'Cost': 50, 'Price': 150, 'Qty': 10, 'Warranty months': 6, 'Serialised': 'yes' },
  { 'SKU': '', 'Product': '', 'Price': 5 },                                                        // empty
  { 'SKU': 'NEW-NONAME', 'Price': 5 },                                                             // no name
  { 'SKU': PLA, 'Product Name': 'Sunlu PLA Black', 'Price': 'abc' },                                // bad number
];
r = await mgr('erpImport', [{ what: 'products', rows }]);
check('preview: what would change, what would be added, what is refused - nothing written', r.ok && !r.result.apply && r.result.change.length === 1 && /sell price: .* → 1234/.test(r.result.change[0].text) &&
  r.result.add.length === 1 && /Imported Nozzle 0.4 .*opening stock 10/.test(r.result.add[0].text) && r.result.errors.length === 2 && r.result.skip.length === 2 &&
  r.result.columns.some((c) => c.column === 'Product Name' && c.as === 'name') &&
  !(await sql`select 1 from products where business_id = ${B} and name = 'Imported Nozzle 0.4'`).length, r.result);
check('the stock figure in the file is pointed out, not applied', r.result.skip.some((s) => /stock is not changed by an import/.test(s.text)), r.result.skip);
r = await mgr('erpImport', [{ what: 'products', rows, apply: true }]);
check('applied: one changed, one added, the bad rows reported', r.ok && r.result.added === 1 && r.result.changed === 1 && r.result.errors.length === 2, r.result);
const np = (await sql`select * from products p where business_id = ${B} and name = 'Imported Nozzle 0.4'`)[0];
check('the new product with its warranty, serial flag, cost hidden from a manager (0)', np && np.serialised === true && Number(np.warranty_months) === 6 && Number(np.sell_price) === 150 && np.category === 'Parts' && np.sku, np);
const npStock = Number((await sql`select ps.stock from product_stock ps where ps.product_id = ${np.id}`)[0].stock);
check('opening stock 10 for the new one; the old one keeps its shelf', npStock === 10 && Number((await sql`select ps.stock from products p join product_stock ps on ps.product_id = p.id where p.business_id = ${B} and p.sku = ${PLA}`)[0].stock) === stockBefore, npStock);
check('the changed product sells at 1234 now, type and others untouched', Number((await sql`select sell_price from products where business_id = ${B} and sku = ${PLA}`)[0].sell_price) === 1234 &&
  (await sql`select type from products where business_id = ${B} and sku = ${PLA}`)[0].type === typeBefore, 0);
r = await owner('erpImport', [{ what: 'products', rows: [{ 'SKU': PLA, 'Name': 'Sunlu PLA Black', 'Cost': 777 }], apply: true }]);
check('a shareholder\'s file changes the cost', r.ok && r.result.changed === 1 && Number((await sql`select cost_price from products where business_id = ${B} and sku = ${PLA}`)[0].cost_price) === 777, r.result);
await sql`update memberships set powers = '{"costs": false}'::jsonb where business_id = ${FIX.B} and user_id = ${FIX.U.mgr}`;   // since 058 a manager has Product cost unless switched off
r = await mgr('erpImport', [{ what: 'products', rows: [{ 'SKU': PLA, 'Name': 'Sunlu PLA Black', 'Cost': 1 }], apply: true }]);
check('a manager\'s file cannot', r.ok && r.result.skip.length === 1 && Number((await sql`select cost_price from products where business_id = ${B} and sku = ${PLA}`)[0].cost_price) === 777, r.result);
await sql`update memberships set powers = '{}'::jsonb where business_id = ${FIX.B} and user_id = ${FIX.U.mgr}`;

// ---------------------------------------------------------------- import: customers
const crows = [
  { 'Customer name': 'Import Karim', 'Mobile': '+880 1712-999999', 'Address': 'Mirpur' },
  { 'Customer name': 'Bad Phone', 'Mobile': '123' },
  { 'Customer name': 'Import Karim', 'Mobile': '01712999999', 'Address': 'Mirpur 10' },
];
r = await mgr('erpImport', [{ what: 'customers', rows: crows }]);
check('customers preview: one to add, one bad phone named, the same phone twice: the later row wins', r.ok && r.result.add.length === 1 && r.result.errors.length === 1 && /11 digits/.test(r.result.errors[0].text) && r.result.skip.length === 1 && /later row wins/.test(r.result.skip[0].text), r.result);
r = await mgr('erpImport', [{ what: 'customers', rows: crows, apply: true }]);
const kc = await sql`select name, phone, address from customers where business_id = ${B} and phone = '01712999999'`;
check('applied: the customer, phone in the house style, latest address', r.ok && kc.length === 1 && kc[0].address === 'Mirpur 10', [r.result, kc]);

// ---------------------------------------------------------------- import: suppliers
r = await mgr('erpImport', [{ what: 'suppliers', rows: [{ 'Supplier': 'Shenzhen Parts Co', 'Country': 'China', 'Currency': 'usd' }, { 'Supplier': '' }], apply: true }]);
check('a supplier added with its country and currency', r.ok && r.result.added === 1 && (await mgr('erpSuppliers', [])).result.suppliers.some((s) => s.name === 'Shenzhen Parts Co' && s.currency === 'USD'), r.result);
r = await mgr('erpImport', [{ what: 'money', rows: [{ a: 1 }] }]);
check('only the three lists', !r.ok && /Products, customers or suppliers/.test(r.error), r);
const o2 = await sql`select count(*)::int n from products where business_id = ${FIX.B2} and name = 'Imported Nozzle 0.4'`;
check('another business untouched', o2[0].n === 0);
await done();
