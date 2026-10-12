// Deleting a business of your own (a copy first), and bringing it back in one click.
import { sql, FIX, owner, mgr, check, done, files } from './harness.mjs';
const B = FIX.B;
let r = await owner('erpCreateBusiness', [{ name: 'Del Co', currency: 'BDT' }]);
check('a second business', r.ok, r);
const id = (await sql`select id from businesses where name = 'Del Co'`)[0].id;
await owner('erpSetBusiness', [id]);
r = await owner('erpSaveProduct', [{ isNew: true, sku: 'DEL-1', product_name: 'Del Thing', category: 'Parts', brand: 'X', unit: 'Piece', cost_price: 10, sell_price: 20, opening_stock: 5, status: 'Active' }]);
check('a product in it', r.ok, r);
r = await owner('erpCreateInvoice', [{ customer: { name: 'Del Buyer', phone: '01711000888' }, items: [{ sku: 'DEL-1', qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('a sale in it', r.ok, r);
const inv0 = (await sql`select count(*)::int n from invoices where business_id = ${id}`)[0].n;

r = await owner('erpBusinessDelete', [{ id, confirm: 'Del Co' }]);
check('not the business you are working in', !r.ok && /Switch to another business first/.test(r.error), r);
await owner('erpSetBusiness', [B]);
r = await mgr('erpBusinessDelete', [{ id, confirm: 'Del Co' }]);
check('not by a manager', !r.ok, r);
r = await owner('erpBusinessDelete', [{ id, confirm: 'del co' }]);
check('the name must be typed exactly', !r.ok && /exactly/.test(r.error), r);
r = await owner('erpBusinessDelete', [{ id: B, confirm: 'Costareen' }]);
check('the business in use cannot go', !r.ok, r);

r = await owner('erpBusinessDelete', [{ id, confirm: 'Del Co' }]);
check('deleted, with its copy named', r.ok && r.result.copy && r.result.keptDays === 90, r);
check('every record of it is gone', !(await sql`select 1 from businesses where id = ${id}`).length && (await sql`select count(*)::int n from invoices where business_id = ${id}`)[0].n === 0 &&
  (await sql`select count(*)::int n from products where business_id = ${id}`)[0].n === 0 && (await sql`select count(*)::int n from memberships where business_id = ${id}`)[0].n === 0);
check('its copy is kept', files.list().some((k) => k.startsWith(id + '/backups/') && k.endsWith(r.result.copy)), files.list().filter((k) => k.startsWith(id)));
check('the other business untouched', (await sql`select count(*)::int n from invoices where business_id = ${B}`)[0].n > 0);
r = await owner('erpBusinessesDeleted', []);
check('listed as deleted, for 90 days', r.ok && r.result.deleted.some((x) => x.id === id && x.name === 'Del Co' && x.until), r.result);
r = await mgr('erpBusinessRestore', [{ id }]);
check('only the one who deleted it brings it back', !r.ok, r);

r = await owner('erpBusinessRestore', [{ id }]);
const nid = r.ok && r.result.id;
check('back again, as a business', r.ok && r.result.name === 'Del Co' && nid !== id, r);
check('with its records', (await sql`select count(*)::int n from invoices where business_id = ${nid}`)[0].n === inv0 &&
  (await sql`select count(*)::int n from products where business_id = ${nid} and sku = 'DEL-1'`)[0].n === 1, inv0);
check('and its owner', (await sql`select count(*)::int n from memberships where business_id = ${nid} and user_id = ${FIX.U.owner} and role = 'owner'`)[0].n === 1);
await owner('erpSetBusiness', [nid]);
r = await owner('erpCreateInvoice', [{ customer: { name: 'After', phone: '01711000889' }, items: [{ sku: 'DEL-1', qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('it works again (a new sale)', r.ok, r);
await owner('erpSetBusiness', [B]);
r = await owner('erpBusinessesDeleted', []);
check('no longer in the deleted list', r.ok && !r.result.deleted.some((x) => x.id === id), r.result);
await done();
