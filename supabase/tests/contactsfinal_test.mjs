// final-contacts (10 Nov 2026): the "one where many" fixes of the contacts area and their refusals.
//   customers.js  other phone numbers (save, search, duplicate check, merge), statement closing = account balance
//   leads.js      a number abroad is a lead's phone; CSV import reports each bad row, saves the rest, dry run saves nothing
//   notes.js      several files on one note; a bad file leaves nothing half-saved
//   loyalty.js    refill reminder text in Bangla beside the English one
import { sql, FIX, owner, mgr, sales, check, done, files } from './harness.mjs';

const B = FIX.B, B2 = FIX.B2;
const PLA = 'FIL-SUN-PLA-BLA-001';
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const find = (list, name) => (list || []).find((c) => c.name === name);
let r;

// ------------------------------------------------------------------ other phone numbers
r = await sales('erpSaveCustomer', [{ row: 0, name: 'Dhaka Print Shop', phone: '01711000111', otherPhones: '01811-000 222, +86 139 0000 0000 / 01711000111', address: 'Mirpur' }]);
check('new customer with two other numbers (the main one repeated is dropped)', r.ok && !r.result.updated, r);
r = await sales('erpCustomers', []);
let shop = find(r.result, 'Dhaka Print Shop');
check('other phones kept clean: BD as 01…, abroad as +digits', shop && shop.otherPhones === '01811000222, +8613900000000', shop);

r = await sales('erpSaveCustomer', [{ row: 0, name: 'Same Shop Again', phone: '+8801811000222' }]);
check('a second card under the shop\'s other number is refused, naming the shop', !r.ok && /already a number of Dhaka Print Shop/.test(r.error), r);
r = await sales('erpSaveCustomer', [{ row: 0, name: 'Third Try', phone: '01911000333', otherPhones: '8613900000000' }]);
check('a new customer whose OTHER number is already the shop\'s is refused too', !r.ok && /already a number of Dhaka Print Shop/.test(r.error), r);

r = await sales('erpCustomerList', [{ q: '0181100' }]);
check('the list finds the shop by its second number', r.ok && r.result.rows.length === 1 && r.result.rows[0].name === 'Dhaka Print Shop', r.result && r.result.rows.map((x) => x.name));
r = await sales('erpCustomerList', [{ q: '+86 139' }]);
check('…and by the foreign one, typed with spaces', r.ok && r.result.rows.some((x) => x.name === 'Dhaka Print Shop'), r.result && r.result.matched);

r = await sales('erpSaveCustomer', [{ row: shop.row, name: 'Dhaka Print Shop', phone: '01711000111', otherPhones: '0155' }]);
check('a bad other number is refused in plain words (nothing saved)', !r.ok && /11 digits starting 013-019/.test(r.error), r);
r = await sales('erpSaveCustomer', [{ row: shop.row, name: 'Dhaka Print Shop', phone: '01711000111', otherPhones: '01712345678' }]);
check('another customer\'s main number cannot become this shop\'s other number', !r.ok && /already belongs to Karim/.test(r.error), r);
r = await sales('erpSaveCustomer', [{ row: shop.row, name: 'Dhaka Print Shop Ltd', phone: '01711000111', address: 'Mirpur 10' }]);
shop = find((await sales('erpCustomers', [])).result, 'Dhaka Print Shop Ltd');
check('editing without sending otherPhones keeps them', r.ok && shop && shop.otherPhones === '01811000222, +8613900000000', shop);
r = await sales('erpSaveCustomer', [{ row: shop.row, name: 'Dhaka Print Shop Ltd', phone: '01711000111', otherPhones: '' }]);
shop = find((await sales('erpCustomers', [])).result, 'Dhaka Print Shop Ltd');
check('sending an empty list clears them', r.ok && shop && shop.otherPhones === '', shop);
r = await sales('erpSaveCustomer', [{ row: shop.row, name: 'Dhaka Print Shop Ltd', phone: '01711000111', otherPhones: ['01811000222', '01811000223', '01811000224', '01811000225', '01811000226', '01811000227'] }]);
check('more than five other numbers is refused', !r.ok && /At most 5/.test(r.error), r);
await sales('erpSaveCustomer', [{ row: shop.row, name: 'Dhaka Print Shop Ltd', phone: '01711000111', otherPhones: ['01811000222'] }]);

// the other business never sees the shop, and its own customer with the same other number is its own affair
r = await sql`select count(*)::int as n from customers where business_id = ${B2} and other_phones <> ''`;
check('other business untouched', r[0].n === 0, r);

// merge: a duplicate card's other numbers land on the kept card
await sql`insert into customers (business_id, name, phone, other_phones) values (${B}, 'Dhaka Print Shop (dup)', '8801711000111', '+971500000001')`;
r = await owner('erpMergeCustomers', [true]);
shop = (await sales('erpCustomers', [])).result.find((c) => c.phone === '01711000111');
check('merge keeps every other number of every copy', r.ok && shop && shop.otherPhones === '01811000222, +971500000001', shop);
await sales('erpSaveCustomer', [{ row: shop.row, name: 'Dhaka Print Shop Ltd', phone: '01711000111' }]);

// ------------------------------------------------------------------ statement closing = the account's balance
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Dhaka Print Shop Ltd', phone: '01711000111' }, items: [{ sku: PLA, qty: 2 }], payMode: 'part', paidNow: 700, paymentMethod: 'Cash' }]);
check('an invoice with a part payment for the shop', r.ok && r.result.grandTotal === 2700, r);
const st = await mgr('erpCustomerStatement', [{ phone: '01711000111', name: 'Dhaka Print Shop Ltd', days: 90 }]);
const acc = await mgr('erpCustomerAccount', [{ phone: '01711000111', name: 'Dhaka Print Shop Ltd' }]);
check('statement closing balance equals the account balance (2000 owed)', st.ok && acc.ok && st.result.closing === 2000 && Math.round(acc.result.balance) === 2000, { st: st.result && st.result.closing, acc: acc.result && acc.result.balance });
check('statement rows sum: charged - paid = closing - opening', st.ok && st.result.totalDebit - st.result.totalCredit === st.result.closing - st.result.opening, st.result);

// ------------------------------------------------------------------ leads: numbers abroad, import with bad rows
await sql`insert into erp_app_flags (key, enabled) values ('leads', true) on conflict (key) do update set enabled = true`;
r = await mgr('erpLeadUpsert', [{ kind: 'supplier', source: 'b2b', company: 'Shenzhen Nozzle Works', phone: '+86 139 0000 0001', country: 'China' }]);
check('a supplier lead keeps its foreign number', r.ok && r.result.added, r);
let ld = (await mgr('erpLeads', [{ kind: 'supplier', q: 'Nozzle' }])).result.leads[0];
check('…stored as +digits', ld && ld.phone === '+8613900000001', ld);
r = await mgr('erpLeadUpsert', [{ kind: 'customer', name: 'Bad Number', phone: '12ab' }]);
check('a non-number is refused plainly', !r.ok && /11 digits starting 013-019/.test(r.error), r);

const before = (await sql`select count(*)::int as n from inbox_leads where business_id = ${B}`)[0].n;
const rows = [['Name', 'Company', 'Phone', 'City'],
  ['Rina Akter', 'Rina Prints', '01722-000 111', 'Dhaka'],
  ['Li Wei', 'Shenzhen Parts', '+86 139 2222 3333', 'Shenzhen'],
  ['Broken Row', '', '12ab', ''],
  ['', '', '', ''],
  ['Rina again', 'Rina Prints', '+8801722000111', 'Dhaka'],
  ['No contact at all', '', '', 'Sylhet']];
r = await mgr('erpLeadImport', [{ rows, kind: 'customer', check: true }]);
const afterCheck = (await sql`select count(*)::int as n from inbox_leads where business_id = ${B}`)[0].n;
check('dry run reports: 3 to add, 1 already there (inside the file), 1 bad row; saves nothing', r.ok && r.result.check && r.result.added === 3 && r.result.same === 1 && r.result.skipped === 1 && afterCheck === before, r);
check('the bad row is named with its line number and the reason', r.ok && r.result.errors.length === 1 && r.result.errors[0].row === 4 && /11 digits/.test(r.result.errors[0].why), r.result && r.result.errors);
r = await mgr('erpLeadImport', [{ rows, kind: 'customer' }]);
const after = (await sql`select count(*)::int as n from inbox_leads where business_id = ${B}`)[0].n;
check('the real import saves the good rows and skips the bad one (nothing lost after it)', r.ok && r.result.added === 3 && r.result.same === 1 && r.result.skipped === 1 && after === before + 3, r);
check('the row with a name but no contact is still added (a lead can be a name)', r.ok && (await sql`select count(*)::int as n from inbox_leads where business_id = ${B} and name = 'No contact at all'`)[0].n === 1, r);
r = await mgr('erpLeadImport', [{ rows, kind: 'customer' }]);
check('importing the same file again adds nobody twice (a name-only lead included)', r.ok && r.result.added === 0 && r.result.same === 4, r);
r = await sales('erpLeadImport', [{ rows, kind: 'customer' }]);
check('sales may not import', !r.ok && /permission|manager/.test(r.error), r);

// converting a lead finds the customer by phone, not by name
await mgr('erpLeadUpsert', [{ kind: 'customer', source: 'referral', name: 'Karim', phone: '01712345678', city: 'Dhaka' }]);
ld = (await mgr('erpLeads', [{ kind: 'customer', q: '01712345678' }])).result.leads[0];
r = await mgr('erpLeadAct', [{ id: ld.id, convert: 'customer' }]);
const karimId = (await sql`select id from customers where business_id = ${B} and phone = '01712345678'`)[0].id;
const linked = (await sql`select customer_id from inbox_leads where id = ${ld.id}`)[0].customer_id;
check('convert links the lead to the existing customer with that phone (no second Karim)', r.ok && linked === karimId &&
  (await sql`select count(*)::int as n from customers where business_id = ${B} and phone = '01712345678'`)[0].n === 1, { linked, karimId });

// ------------------------------------------------------------------ notes: several files at once
const n0 = (await sql`select count(*)::int as n from record_notes where business_id = ${B} and kind = 'customer'`)[0].n;
r = await sales('erpNoteAdd', [{ kind: 'customer', ref: '1711000111', body: 'Three photos of the broken part',
  files: [{ data: png, mime: 'image/png', name: 'a.png' }, { data: png, mime: 'image/png', name: 'b.png' }, { data: png, mime: 'image/jpeg', name: 'c.jpg' }] }]);
check('a note with three files: three rows, the text on the first', r.ok && r.result.notes.length === n0 + 3 && r.result.notes.filter((x) => x.file).length >= 3 && r.result.notes.some((x) => x.body === 'Three photos of the broken part'), r);
const f0 = files.list().filter((k) => k.indexOf(B + '/notes/') === 0).length;
r = await sales('erpNoteAdd', [{ kind: 'customer', ref: '1711000111', body: 'x', files: [{ data: png, mime: 'image/png', name: 'ok.png' }, { data: png, mime: 'text/html', name: 'evil.html' }] }]);
const n1 = (await sql`select count(*)::int as n from record_notes where business_id = ${B} and kind = 'customer'`)[0].n;
check('one bad file: refused naming it, nothing saved (no row, no file)', !r.ok && /File 2 \(evil\.html\)/.test(r.error) && n1 === n0 + 3 && files.list().filter((k) => k.indexOf(B + '/notes/') === 0).length === f0, r);
r = await sales('erpNoteAdd', [{ kind: 'customer', ref: '1711000111', body: '', files: new Array(7).fill({ data: png, mime: 'image/png', name: 'p.png' }) }]);
check('seven files is too many', !r.ok && /At most 6/.test(r.error), r);
r = await sales('erpNoteAdd', [{ kind: 'customer', ref: '1711000111', body: 'old page, one file', file: { data: png, mime: 'image/png', name: 'one.png' } }]);
check('the old single-file shape still works', r.ok && r.result.notes[0].file === 'one.png', r);

// ------------------------------------------------------------------ refill reminders in Bangla
r = await sales('erpRefillDue', []);
check('refill list answers (rows carry both texts when there are rows)', r.ok && Array.isArray(r.result.ready) && Array.isArray(r.result.askFirst) &&
  r.result.ready.concat(r.result.askFirst).every((x) => !x.whatsapp || (x.whatsappBn && /%E0%A6/.test(x.whatsappBn))), r);

await done();
