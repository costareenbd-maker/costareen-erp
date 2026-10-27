// Phase 5: activity log, a partner's company and login, wholesale price on the product.
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const PLA = 'FIL-SUN-PLA-BLA-001';

// ---------------------------------------------------------------- activity
let r = await mgr('erpSecurity', [{}]);
check('only the owner opens Security', !r.ok && /does not have permission/.test(r.error), r);
await erpCall(deps, { name: 'erpHello', args: [], token: { code: '111111', device: 'dev-mgr', label: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' }, ip: '10.0.0.7' });
await erpCall(deps, { name: 'erpHello', args: [], token: { code: '111111', device: 'dev-mgr' }, ip: '10.0.0.7' });
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
const INV = r.result.invoiceNo;
await mgr('erpCatalog', []);
await mgr('erpSetTheme', ['light']);
await owner('erpConfigSet', ['default_reorder', '6']);
await sales('erpStockCount', [{ lines: [{ sku: PLA, counted: 1 }] }]);   // refused: must not be logged
r = await owner('erpSecurity', [{}]);
const A = r.result.activity;
check('sign-in logged once per half hour, with device and address', A.filter((a) => a.signIn && a.who === 'Mehedi').length === 1 &&
  A.find((a) => a.signIn && a.who === 'Mehedi').device === 'Android · Chrome' && A.find((a) => a.signIn && a.who === 'Mehedi').ip === '10.0.0.7', A);
check('a write is logged in plain words, by whom', A.some((a) => a.what === 'Saved an invoice' && a.who === 'Mehedi' && a.role === 'manager'), A);
check('reads, theme changes and refused calls are not logged', !A.some((a) => /catalog|theme|stock count/i.test(a.what)), A.map((a) => a.what));
check('a setting change is logged without its value', A.some((a) => a.what === 'Changed a setting' && a.detail === ''), A);
check('detail names the invoice that was saved', A.some((a) => a.what === 'Saved an invoice' && a.detail === INV), A);
check('people summary', r.result.people.some((p) => p.name === 'Mehedi' && p.actions >= 2), r.result.people);
await owner('erpSaveCourierKeys', ['secret-api-key-value', 'secret-secret-value']);
const raw = await sql`select action, detail from erp_activity where business_id = ${FIX.B}`;
check('no key or code ever reaches the log', !JSON.stringify(raw).includes('secret-'), raw);
const other = await sql`select count(*)::int n from erp_activity where business_id = ${FIX.B2}`;
check('nothing logged against another business', other[0].n === 0);

// ---------------------------------------------------------------- partner company
r = await mgr('erpPartnerCompany', [{ business: 'X', ownerName: 'Y', email: 'a@b.co' }]);
check('only the owner creates a partner company', !r.ok, r);
r = await owner('erpPartnerCompany', [{ business: '', ownerName: 'Y', email: 'a@b.co' }]);
check('company name required', !r.ok && /company called/.test(r.error), r);
r = await owner('erpPartnerCompany', [{ business: 'Partner Shop', ownerName: 'Salim', email: 'not-an-email' }]);
check('a real e-mail is required', !r.ok && /e-mail address/.test(r.error), r);
r = await owner('erpPartnerCompany', [{ business: 'Partner Shop', ownerName: 'Salim', email: 'Salim@Partner.test' }]);
check('partner company created, mail sent, and a link of their own', r.ok && r.result.mailed === true && r.result.email === 'salim@partner.test' && deps.mails.includes('salim@partner.test') &&
  /^[A-Za-z0-9_-]{40,}$/.test(r.result.link.key) && r.result.link.label === 'Salim', r);
const pkey = r.result.link.key;
const pu = (await sql`select id from auth.users where email = 'salim@partner.test'`)[0];
const pb = await sql`select b.id, b.name, m.role from memberships m join businesses b on b.id = m.business_id where m.user_id = ${pu.id}`;
check('the partner owns it', pb.length === 1 && pb[0].name === 'Partner Shop' && pb[0].role === 'owner', pb);
const mine = await sql`select count(*)::int n from memberships where business_id = ${pb[0].id} and user_id = ${FIX.U.owner}`;
check('the creator is NOT let into it', mine[0].n === 0);
r = await owner('erpBusinesses', []);
check('...and does not see it in the menu', r.ok && !r.result.businesses.some((b) => b.id === pb[0].id), r.result);
r = await owner('erpCatalog', []);
check('the creator is still in their own business afterwards', r.ok && r.result.some((p) => p.sku === PLA), r);
const { keyHash, newKey } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
async function ownerKey() { const k = newKey(); await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(k)}, ${FIX.U.owner}, 'Owner')`; return k; }
const partner = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + pu.id });
// plan B1: with the sign-in screen off the partner gets in by a link of their own
const live = { ...deps, linkOnly: true };
const byKey = (key, name, args) => erpCall(live, { name, args, token: { key, device: 'partner-phone' }, authHeader: '' });
r = await byKey(pkey, 'erpHello', []);
check('the partner link opens THEIR company, as its owner', r.ok && r.result.ok && r.result.role === 'owner' && r.result.name === 'Salim', r);
r = await byKey(pkey, 'erpBusinesses', []);
check('...and shows nothing of the creator business', r.ok && r.result.businesses.length === 1 && r.result.businesses[0].id === pb[0].id, r.result);
r = await byKey(pkey, 'erpCatalog', []);
check('...not its products either', r.ok && r.result.length === 0, r);
const mailsBefore = deps.mails.length;
r = await erpCall(live, { name: 'erpPartnerCompany', args: [{ business: 'No Mail Shop', ownerName: 'Babu' }], authHeader: 'Bearer owner:' + FIX.U.owner, token: { key: (await ownerKey()), device: 'o' } });
check('link-only: no e-mail is needed, none is sent, a link comes back', r.ok && r.result.mailed === false && r.result.email === '' && r.result.link.key.length >= 40 && deps.mails.length === mailsBefore, r);
r = await byKey(r.result.link.key, 'erpBusinesses', []);
check('...which opens only that company', r.ok && r.result.businesses.length === 1 && r.result.businesses[0].name === 'No Mail Shop', r.result);
r = await partner('erpSettingsFull', []);
check('the partner can open their company, lists seeded', r.ok && r.result.lists.categories.length > 0, r);
r = await partner('erpCatalog', []);
check('it starts empty', r.ok && r.result.length === 0, r);
r = await owner('erpPartnerCompany', [{ business: 'Again', ownerName: 'Salim', email: 'salim@partner.test' }]);
check('an e-mail that already has a login is refused', !r.ok && /already has a login/.test(r.error), r);
const leftover = await sql`select count(*)::int n from businesses where name = 'Again'`;
check('...and nothing is left behind', leftover[0].n === 0);

// ---------------------------------------------------------------- wholesale price
r = await owner('erpProduct', [PLA]);
check('product form carries the wholesale price', r.ok && r.result.wholesale_price === 0, r.result);
r = await owner('erpSaveProduct', [{ ...r.result, wholesale_price: 1200 }]);
check('wholesale price saved', r.ok && (await owner('erpProduct', [PLA])).result.wholesale_price === 1200, r);
r = await owner('erpProduct', [PLA]);
const { wholesale_price, ...old } = r.result;
r = await owner('erpSaveProduct', [old]);
check('an older page that does not send it leaves it alone', r.ok && (await owner('erpProduct', [PLA])).result.wholesale_price === 1200, r);
r = await owner('erpSaveProduct', [{ ...old, wholesale_price: -5 }]);
check('negative refused', !r.ok && r.error === 'Prices cannot be negative.', r);
r = await owner('erpSaveProduct', [{ isNew: true, product_name: 'New Thing', category: 'Parts', brand: 'BIQU', unit: 'Piece', cost_price: 10, sell_price: 20, wholesale_price: 15, status: 'Active' }]);
check('new product keeps its wholesale price', r.ok && (await owner('erpProduct', [r.result.sku])).result.wholesale_price === 15, r);
r = await owner('erpProductPage', [{ sku: PLA }]);
check('wholesale change is in the price history', r.ok && r.result.wholesale === 1200 && r.result.changes.some((c) => c.field === 'Wholesale price' && c.now === '1200'), r.result && r.result.changes);

// ---------------------------------------------------------------- theme library
r = await mgr('erpSetLook', ['ocean']);
check('a theme is saved per person', r.ok && r.result.look === 'ocean' && (await mgr('erpBusinesses', [])).result.look === 'ocean' && (await owner('erpBusinesses', [])).result.look === '', r);
r = await mgr('erpSetLook', ['custom|#1f6feb|#0a7ea4']);
check('own colours are kept', r.ok && (await mgr('erpBusinesses', [])).result.look === 'custom|#1f6feb|#0a7ea4', r);
r = await mgr('erpSetLook', ['custom|red;}</style><script>|#000000']);
check('anything that is not a name or two colours is refused', !r.ok && r.error === 'That theme is not known.' && (await mgr('erpBusinesses', [])).result.look === 'custom|#1f6feb|#0a7ea4', r);
r = await mgr('erpSetLook', ['']);
check('back to the standard look', r.ok && (await mgr('erpBusinesses', [])).result.look === '', r);

// ---------------------------------------------------------------- no standstill under load
// Eight page loads at once, each reading the kept dashboard and a secret from
// inside its own transaction. With one shared pool of three this stopped forever.
const many = Promise.all(Array.from({ length: 8 }, (_, i) => (i % 2 ? owner('erpBundle', [['dash', 'settings']]) : owner('erpCourierKeyStatus', []))));
const res = await Promise.race([many, new Promise((ok) => setTimeout(() => ok('STUCK'), 20000))]);
check('eight calls at once all come back', res !== 'STUCK' && res.every((x) => x.ok), res === 'STUCK' ? res : res.filter((x) => !x.ok));
if (res === 'STUCK') { console.log('standstill - stopping'); process.exit(1); }

await done();
