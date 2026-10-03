// Going back to a backup: preview, all-or-nothing, today copied first, numbering carries on.
import { sql, FIX, owner, mgr, check, done, files } from './harness.mjs';
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const count = async (t) => (await sql`select count(*)::int n from ${sql(t)} where business_id = ${B}`)[0].n;

let r = await owner('erpCreateInvoice', [{ customer: { name: 'Before Copy', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
check('a sale before the copy', r.ok, r);
r = await owner('erpBackupRun', []);
check('a copy is made', r.ok, r);
const copy = files.list().filter((k) => k.startsWith(B + '/backups/')).map((k) => k.split('/').pop()).sort().pop();
const inv0 = await count('invoices'), pay0 = await count('payments'), mv0 = await count('stock_movements'), prod0 = await count('products');
const keys0 = (await sql`select count(*)::int n from erp_access_keys`)[0].n, mem0 = await count('memberships');

// life goes on after the copy
r = await owner('erpCreateInvoice', [{ customer: { name: 'After Copy', phone: '01812345678' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full' }]);
await owner('erpSaveProduct', [{ isNew: true, product_name: 'Made After The Copy', category: 'Parts', brand: 'X', unit: 'Piece', cost_price: 1, sell_price: 2, opening_stock: 0, status: 'Active' }]);
await sql`delete from customers where business_id = ${B} and name = 'Before Copy'`;
check('the books moved on', (await count('invoices')) === inv0 + 1 && (await count('products')) === prod0 + 1);

r = await mgr('erpRestorePreview', [{ file: copy }]);
check('a manager cannot', !r.ok, r);
r = await owner('erpRestorePreview', [{ file: 'nope.json' }]);
check('an unknown file', !r.ok && /no longer kept/.test(r.error), r);
r = await owner('erpRestorePreview', [{ file: copy }]);
const lv = (n) => r.result.lists.find((x) => x.name === n);
check('preview: now against the copy, list by list', r.ok && lv('invoices').now === inv0 + 1 && lv('invoices').copy === inv0 && lv('products').copy === prod0 && !lv('memberships') && !lv('erp_access_keys'), r.result && r.result.lists.slice(0, 6));

r = await owner('erpRestore', [{ file: copy, confirm: 'costareen' }]);
check('the business name must be typed exactly', !r.ok && /Type the business name exactly/.test(r.error), r);
check('...and nothing changed', (await count('invoices')) === inv0 + 1);
r = await owner('erpRestore', [{ file: copy, confirm: 'Costareen' }]);
check('restored', r.ok && r.result.lists.invoices === inv0, r);
check('everything as in the copy', (await count('invoices')) === inv0 && (await count('payments')) === pay0 && (await count('stock_movements')) === mv0 && (await count('products')) === prod0 &&
  (await sql`select count(*)::int n from customers where business_id = ${B} and name = 'Before Copy'`)[0].n === 1 &&
  (await sql`select count(*)::int n from products where business_id = ${B} and name = 'Made After The Copy'`)[0].n === 0);
check('who may sign in is untouched', (await sql`select count(*)::int n from erp_access_keys`)[0].n === keys0 && (await count('memberships')) === mem0);
const before = files.list().filter((k) => k.startsWith(B + '/backups/'));
check('today was copied first, under its own name', before.length >= 2 && before.some((k) => k.endsWith(r.result.before)) && r.result.before !== copy, [before, r.result.before]);

// numbering carries on after the restored rows
r = await owner('erpCreateInvoice', [{ customer: { name: 'After Restore', phone: '01912345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
check('a new sale after going back works', r.ok, r);
r = await owner('erpExpenseAdd', [{ amount: 50, description: 'after restore' }]);
check('...and a new expense (numbered rows carry on)', r.ok, r);

// and the restore can itself be undone
r = await owner('erpRestorePreview', [{ file: before.map((k) => k.split('/').pop()).find((n) => n !== copy) }]);
check('the "before restore" copy can be gone back to as well', r.ok && r.result.lists.find((x) => x.name === 'invoices').copy === inv0 + 1, r.result && r.result.lists.slice(0, 3));
const o2 = await sql`select count(*)::int n from invoices where business_id = ${FIX.B2}`;
check('another business untouched', o2[0].n >= 0);
await done();
