// Expenses + website orders (handlers/expenses.js, handlers/weborders.js).
// Run: TEST_SCRIPT=expenses_web_test.mjs ... erp_server_test.py (see docs/PORTING.md)
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done, web, files, deps, fnDir,
} from './harness.mjs';
import { formatDate } from '../functions/erp/lib/time.js';

const W = await import(pathToFileURL(path.join(fnDir, 'handlers', 'weborders.js')));
const E = await import(pathToFileURL(path.join(fnDir, 'handlers', 'expenses.js')));
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001', A1 = 'PRT-BAM-A1-001', PETG = 'FIL-SUN-PETG-001';

/** Run a non-page function (the 15-minute sync) the way the cron handler will. */
async function asOwner(fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' })}, true)`;
    const ctx = { tx, sql, s: { userId: FIX.U.owner, name: 'Owner', role: 'owner', businessId: B, businessName: 'Costareen' },
                  biz: B, now: new Date(), memo: {}, deps };
    return fn(ctx);
  });
}

// =========================================================== seed
await makeShareholder();
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price)
          values (${B}, ${PETG}, 'Sunlu PETG', 'Filaments', 'Sunlu', 'PETG', 0, 1000)`;
await sql`insert into cost_book (business_id, category, brand, type, buy_rmb, handling)
          values (${B}, 'Filaments', 'Sunlu', 'PETG', 50, null)`;
await sql`insert into business_config (business_id, key, value) values (${B}, 'cost_rate', '17'), (${B}, 'cost_handling', '30')`;
const pid = {};
for (const r of await sql`select sku, id from products where business_id = ${B}`) pid[r.sku] = r.id;

// March 2025 (Dhaka): the month's gross, worked by hand
async function seedInvoice(no, at, discount, lines) {
  const r = await sql`insert into invoices (business_id, invoice_no, customer_name, created_at, discount, payment_status)
                      values (${B}, ${no}, 'Old', ${at}, ${discount}, 'Paid') returning id`;
  let n = 1;
  for (const [sku, qty, unit, total] of lines) {
    await sql`insert into invoice_lines (business_id, invoice_id, sku, qty, unit_price, line_total, line_no)
              values (${B}, ${r[0].id}, ${sku}, ${qty}, ${unit}, ${total}, ${n++})`;
  }
}
// old-style: invoice discount 100 NOT inside the line totals -> 2700 - 100 = 2600, cost 2 x 900
await seedInvoice('INV-M1', '2025-03-10T10:00:00+06:00', 100, [[PLA, 2, 1350, 2700]]);
// new-style: discount 50 already inside the line -> 950, cost = price book 50 x 17 + 30 = 880
await seedInvoice('INV-M2', '2025-03-15T10:00:00+06:00', 50, [[PETG, 1, 1000, 950]]);
// a return note: -1350 revenue, -900 cost
await seedInvoice('RTN-M1', '2025-03-20T10:00:00+06:00', 0, [[PLA, -1, 1350, -1350]]);
// last minutes of 31 March in Dhaka count; 00:30 on 1 April (still 31 March in UTC) does not
await seedInvoice('INV-M3', '2025-03-31T23:50:00+06:00', 0, [[PLA, 0, 0, 0]]);
await seedInvoice('INV-M4', '2025-04-01T00:30:00+06:00', 0, [[PLA, 1, 1350, 1350]]);

// =========================================================== EXPENSES
let r = await shareholder('erpExpenses', [{ month: '2025-03' }]);
let e = r.result;
check('expenses: March 2025 label, past month', r.ok && e.label === 'March 2025' && e.month === '2025-03' && !e.isCurrent && !e.isFuture, r);
check('month gross: revenue 2600+950-1350 = 2200, cost 1800+880-900 = 1780, gross 420',
  e && e.revenue === 2200 && e.goodsCost === 1780 && e.gross === 420 && e.net === 420 && e.total === 0, e);
check('categories are the three fixed lists', e && e.categories.fixed[0] === 'Rent' && e.categories.oneoff.length === 7 && e.categories.recurring.length === 6);
const g = await asOwner((ctx) => E.monthGross(ctx, '2025-04'));
check('monthGross export: April has only INV-M4', g.revenue === 1350 && g.cost === 900 && g.gross === 450, g);

r = await shareholder('erpExpenses', [{}]);
check('no month -> current month, isCurrent', r.ok && r.result.month === formatDate(new Date(), 'yyyy-MM') && r.result.isCurrent, r.result && r.result.month);
r = await shareholder('erpExpenses', [{ month: '2999-01' }]);
check('future month flagged', r.ok && r.result.isFuture && r.result.label === 'January 2999', r);
r = await mgr('erpExpenses', [{ month: '2025-03' }]);
check('manager refused expenses', !r.ok && r.error === 'Your account does not have access to that.', r);

// ---- one-off
r = await shareholder('erpExpenseAdd', [{ month: '2025-03', category: 'Equipment', description: ' Printer repair ', amount: '500.456' }]);
e = r.result;
check('one-off recorded, amount to 2 places', r.ok && e.oneoff.length === 1 && e.oneoff[0].amount === 500.46 &&
  e.oneoff[0].description === 'Printer repair' && e.oneoff[0].by === 'Shami' && /^E\d{12}-\d{3}$/.test(e.oneoff[0].id) && e.oneoffTotal === 500 && e.total === 500 && e.net === -80, e);
const oneoffId = e.oneoff[0].id;
check('when is "d MMM, h:mm a"', /^\d{1,2} [A-Z][a-z]{2}, \d{1,2}:\d{2} (AM|PM)$/.test(e.oneoff[0].when), e.oneoff[0].when);
r = await shareholder('erpExpenseAdd', [{ month: '2025-03', description: 'Tape', amount: 40 }]);
check('blank category -> Miscellaneous', r.ok && r.result.all[0].category === 'Miscellaneous' && r.result.byCategory[0].name === 'Equipment', r.result && r.result.byCategory);
const tapeId = r.result.all[0].id;
r = await shareholder('erpExpenseAdd', [{ month: '2025-03', description: 'x', amount: 0 }]);
check('add: no amount', !r.ok && r.error === 'How much was spent?', r);
r = await shareholder('erpExpenseAdd', [{ month: '2025-03', description: ' ', amount: 5 }]);
check('add: no description', !r.ok && r.error === 'What was it for? A few words is enough.', r);
r = await shareholder('erpExpenseAdd', [{ month: '2999-01', description: 'x', amount: 5 }]);
check('add: future month', !r.ok && r.error === 'That month has not begun yet.', r);

// ---- fixed
r = await shareholder('erpExpenseItemSave', [{ kind: 'fixed', name: 'Shop rent', category: 'Rent', amount: 15000, fromMonth: '2025-03', viewMonth: '2025-03' }]);
e = r.result;
let rent = e && e.fixedItems[0];
check('fixed item: #1, since, not paid, unpaid counted apart', r.ok && rent.no === 1 && rent.amount === 15000 && rent.since === '2025-03' &&
  !rent.paid && e.fixedUnpaid === 15000 && e.fixed === 0 && e.netAfterUnpaid === 420 - 540 - 15000 && /^F\d{12}-\d{3}$/.test(rent.id), e);
r = await shareholder('erpExpenseItemSave', [{ kind: 'fixed', name: 'shop RENT', amount: 1, fromMonth: '2025-03' }]);
check('duplicate name refused', !r.ok && r.error === '"shop RENT" is already on the list.', r);
r = await shareholder('erpExpenseItemSave', [{ kind: 'fixed', name: '', amount: 1 }]);
check('no name', !r.ok && r.error === 'What is this expense called?', r);
r = await shareholder('erpExpenseItemSave', [{ kind: 'fixed', name: 'Salary', amount: 0 }]);
check('fixed needs an amount', !r.ok && r.error === 'How much is it each month?', r);
r = await shareholder('erpExpenses', [{ month: '2025-02' }]);
check('item not active before its first month', r.ok && r.result.fixedItems.length === 0, r.result && r.result.fixedItems);

r = await shareholder('erpExpenseFixedPay', [{ id: rent.id, month: '2025-03' }]);
e = r.result;
check('rent paid: counts as expense, in the book as fixed', r.ok && e.fixedItems[0].paid && e.fixed === 15000 && e.fixedPaid === 15000 &&
  e.fixedUnpaid === 0 && e.all[0].kind === 'fixed' && e.all[0].itemId === rent.id && e.fixedItems[0].paidBy === 'Shami', e);
r = await shareholder('erpExpenseFixedPay', [{ id: rent.id, month: '2025-03' }]);
check('paying twice refused', !r.ok && r.error === 'Shop rent is already marked as paid for this month.', r);
r = await shareholder('erpExpenseFixedPay', [{ id: rent.id, month: '2025-03', undo: true }]);
e = r.result;
const struck = e && e.all.find((x) => x.kind === 'fixed');
check('undo paid: struck out with reason, unpaid again', r.ok && !e.fixedItems[0].paid && e.fixed === 0 &&
  /^struck out \d{1,2} [A-Z][a-z]{2} \d\d by Shami: marked paid by mistake$/.test(struck.voided), e && e.all);
r = await shareholder('erpExpenseFixedPay', [{ id: rent.id, month: '2025-03', undo: true }]);
check('undo when not paid', !r.ok && r.error === 'It is not marked as paid.', r);
r = await shareholder('erpExpenseFixedPay', [{ id: 'F-nope', month: '2025-03' }]);
check('pay unknown item', !r.ok && r.error === 'That fixed expense is not on the list for this month.', r);
r = await shareholder('erpExpenseFixedPay', [{ id: rent.id, month: '2999-01' }]);
check('pay a future month', !r.ok && r.error === 'That month has not begun yet.', r);
await shareholder('erpExpenseFixedPay', [{ id: rent.id, month: '2025-03' }]);

// ---- recurring
r = await shareholder('erpExpenseItemSave', [{ kind: 'recurring', name: 'Electricity', category: 'Utilities', amount: 2000, fromMonth: '2025-03', viewMonth: '2025-03' }]);
e = r.result;
const elec = e && e.recurringItems[0];
check('recurring set up with this month\'s figure', r.ok && elec.amount === 2000 && e.recurring === 2000 && e.missing === 0 && /^R\d{12}-\d{3}$/.test(elec.id), e);
r = await shareholder('erpExpenseItemSave', [{ kind: 'recurring', name: 'Ads', category: 'Marketing & advertising', amount: 0, fromMonth: '2025-03', viewMonth: '2025-03' }]);
e = r.result;
const ads = e && e.recurringItems[1];
check('recurring without a figure: missing 1, amount null, #2', r.ok && ads.no === 2 && ads.amount === null && ads.when === '' && e.missing === 1, e && e.recurringItems);
r = await shareholder('erpExpenseRecurringSet', [{ itemId: ads.id, amount: 3000, month: '2025-03' }]);
check('recurring figure entered', r.ok && r.result.missing === 0 && r.result.recurring === 5000, r);
r = await shareholder('erpExpenseRecurringSet', [{ itemId: elec.id, amount: 2500, month: '2025-03' }]);
e = r.result;
const replaced = e && e.all.find((x) => x.itemId === elec.id && x.voided);
check('second figure replaces the first (struck out, kept)', r.ok && e.recurring === 5500 && e.recurringItems[0].amount === 2500 &&
  replaced && /^replaced \d{1,2} [A-Z][a-z]{2} \d\d by Shami: was 2000$/.test(replaced.voided), e && e.all);
r = await shareholder('erpExpenseRecurringSet', [{ itemId: '', amount: 1 }]);
check('recurring: which bill', !r.ok && r.error === 'Which bill?', r);
r = await shareholder('erpExpenseRecurringSet', [{ itemId: elec.id, amount: 0 }]);
check('recurring: no amount', !r.ok && r.error === 'How much was the bill this month?', r);
r = await shareholder('erpExpenseRecurringSet', [{ itemId: rent.id, amount: 1, month: '2025-03' }]);
check('recurring: a fixed id is not a bill', !r.ok && r.error === 'That recurring bill was not found.', r);
r = await shareholder('erpExpenseRecurringSet', [{ itemId: elec.id, amount: 1, month: '2025-02' }]);
check('recurring: not active that month', !r.ok && r.error === 'Electricity does not apply in that month.', r);

// totals for March: one-off 500.46+40, fixed 15000, recurring 5500
r = await shareholder('erpExpenses', [{ month: '2025-03' }]);
e = r.result;
check('March totals and net', e.total === 21040 && e.net === 420 - 21040 && e.oneoffTotal === 540 && e.fixed === 15000 && e.recurring === 5500, e);
check('byCategory sorted, rounded', JSON.stringify(e.byCategory) === JSON.stringify([
  { name: 'Rent', amount: 15000 }, { name: 'Marketing & advertising', amount: 3000 }, { name: 'Utilities', amount: 2500 },
  { name: 'Equipment', amount: 500 }, { name: 'Miscellaneous', amount: 40 }]), e.byCategory);
check('all = every row incl. struck, newest first', e.all.length === 7 && e.all.every((x, i) => i === 0 || e.all[i - 1].ts >= x.ts), e.all.length);

// ---- change amount
r = await shareholder('erpExpenseFixedPay', [{ id: rent.id, month: '2025-05' }]);
check('rent paid for May', r.ok && r.result.fixed === 15000, r);
r = await shareholder('erpExpenseItemSave', [{ id: rent.id, kind: 'fixed', name: 'Shop rent', amount: 16000, fromMonth: '2025-05', viewMonth: '2025-05' }]);
e = r.result;
check('change from May: new line carries on, May payment struck', r.ok && e.fixedItems.length === 1 && e.fixedItems[0].amount === 16000 &&
  e.fixedItems[0].id !== rent.id && !e.fixedItems[0].paid && e.fixed === 0 &&
  e.all[0].voided === 'struck out: the amount was changed from 2025-05', e);
const rent2 = e.fixedItems[0].id;
let it = await sql`select * from expense_items where business_id = ${B} order by seq`;
check('old line closed at April, new line notes the old figure',
  it[0].to_month === '2025-04' && it[it.length - 1].note === 'was 15000' && it[it.length - 1].from_month === '2025-05' && it[it.length - 1].set_by === 'Shami', it);
r = await shareholder('erpExpenses', [{ month: '2025-03' }]);
check('March keeps the old figure, still paid', r.result.fixedItems[0].amount === 15000 && r.result.fixedItems[0].paid, r.result.fixedItems);
r = await shareholder('erpExpenseItemSave', [{ id: rent2, kind: 'fixed', name: 'Shop rent', amount: 16500, fromMonth: '2025-05', viewMonth: '2025-05' }]);
it = await sql`select * from expense_items where business_id = ${B} and item_no = ${rent2}`;
check('change in its first month: amount overwritten in place', r.ok && r.result.fixedItems[0].amount === 16500 && it[0].amount === 16500 && !it[0].to_month, r);
r = await shareholder('erpExpenseItemSave', [{ id: elec.id, kind: 'fixed', name: 'x', amount: 5 }]);
check('only fixed amounts change', !r.ok && r.error === 'Only a fixed expense has a set amount to change.', r);
r = await shareholder('erpExpenseItemSave', [{ id: 'F-none', kind: 'fixed', name: 'x', amount: 5 }]);
check('change unknown item', !r.ok && r.error === 'That item was not found.', r);

// ---- stop
r = await shareholder('erpExpenseItemEnd', [{ id: elec.id, fromMonth: '2025-04' }]);
check('stop electricity from April', r.ok && r.result.month === '2025-04' && !r.result.recurringItems.find((x) => x.id === elec.id), r);
r = await shareholder('erpExpenses', [{ month: '2025-03' }]);
check('March still has it', r.result.recurringItems.find((x) => x.id === elec.id).amount === 2500);
await shareholder('erpExpenseFixedPay', [{ id: rent2, month: '2025-06' }]);
r = await shareholder('erpExpenseItemEnd', [{ id: rent2, fromMonth: '2025-06' }]);
const jun = await sql`select voided from expenses where business_id = ${B} and month = '2025-06'`;
check('stopping a fixed one strikes what it posted from then', r.ok && jun.length === 1 && jun[0].voided === 'struck out: the expense was stopped from 2025-06', jun);
r = await shareholder('erpExpenseItemEnd', [{ id: 'nope' }]);
check('stop unknown', !r.ok && r.error === 'That item was not found.', r);

// ---- strike out (owner only)
r = await shareholder('erpExpenseVoid', [{ id: tapeId, reason: 'x' }]);
check('shareholder cannot strike out', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await owner('erpExpenseVoid', [{ id: tapeId, reason: '' }]);
check('strike out needs a reason', !r.ok && r.error === 'Say why it is being struck out, so the books can be read later.', r);
r = await owner('erpExpenseVoid', [{ id: '', reason: 'x' }]);
check('strike out: which entry', !r.ok && r.error === 'Which entry?', r);
r = await owner('erpExpenseVoid', [{ id: tapeId, reason: 'typed twice' }]);
const tape = r.result && r.result.all.find((x) => x.id === tapeId);
check('struck out, returns its month', r.ok && r.result.month === '2025-03' && /^struck out \d{1,2} [A-Z][a-z]{2} \d\d by .+: typed twice$/.test(tape.voided) && r.result.oneoffTotal === 500, r);
r = await owner('erpExpenseVoid', [{ id: tapeId, reason: 'again' }]);
check('already struck out', !r.ok && r.error === 'That entry is already struck out.', r);
const fixedRow = (await sql`select expense_no from expenses where business_id = ${B} and kind = 'fixed' and voided is null limit 1`)[0].expense_no;
r = await owner('erpExpenseVoid', [{ id: fixedRow, reason: 'x' }]);
check('fixed rows are not struck out here', !r.ok && r.error === 'A fixed expense is changed or stopped from its own line, not struck out.', r);
r = await owner('erpExpenseVoid', [{ id: 'E-none', reason: 'x' }]);
check('strike out unknown', !r.ok && r.error === 'That entry was not found.', r);

// ---- export
r = await shareholder('erpExpenseExport', [{ month: '2025-03' }]);
const fname = 'Costareen expenses 2025-03.xlsx';
check('export: name, id, url, month', r.ok && r.result.name === fname && r.result.month === '2025-03' && r.result.id && /^https:\/\//.test(r.result.url), r);
await shareholder('erpExpenseExport', [{ month: '2025-03' }]);
const saved = files.list().filter((k) => k.endsWith('/' + fname));
check('one copy kept in exports (older same-name replaced)', saved.length === 1 && saved[0] === `${B}/exports/${fname}`, saved);
const f = files.get(saved[0]);
check('xlsx mime', f && f.mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', f && f.mime);

// read the zip back (stored entries) and check every CRC
const zlib = await import('node:zlib');
function unzip(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out = {};
  let p = 0;
  while (dv.getUint32(p, true) === 0x04034b50) {
    const crc = dv.getUint32(p + 14, true), size = dv.getUint32(p + 18, true);
    const nlen = dv.getUint16(p + 26, true), xlen = dv.getUint16(p + 28, true);
    const name = new TextDecoder().decode(bytes.slice(p + 30, p + 30 + nlen));
    const data = bytes.slice(p + 30 + nlen + xlen, p + 30 + nlen + xlen + size);
    out[name] = { text: new TextDecoder().decode(data), crcOk: !zlib.crc32 || (zlib.crc32(data) >>> 0) === crc };
    p += 30 + nlen + xlen + size;
  }
  return out;
}
const z = unzip(f.bytes);
check('xlsx parts present, CRCs right', ['[Content_Types].xml', '_rels/.rels', 'xl/workbook.xml', 'xl/_rels/workbook.xml.rels',
  'xl/styles.xml', 'xl/worksheets/sheet1.xml', 'xl/worksheets/sheet2.xml'].every((n) => z[n] && z[n].crcOk), Object.keys(z));
check('two sheets Summary, Entries', /<sheet name="Summary" sheetId="1"/.test(z['xl/workbook.xml'].text) && /<sheet name="Entries" sheetId="2"/.test(z['xl/workbook.xml'].text));
const s1 = z['xl/worksheets/sheet1.xml'].text;
check('Summary: title bold 14 at A1, label, NET PROFIT on row 16 bold, widths',
  /<c r="A1" s="2" t="inlineStr"><is><t xml:space="preserve">Costareen - expenses<\/t>/.test(s1) &&
  /<c r="A2" t="inlineStr"><is><t xml:space="preserve">March 2025</.test(s1) &&
  /<c r="A16" s="1" t="inlineStr"><is><t xml:space="preserve">NET PROFIT<\/t><\/is><\/c><c r="B16" s="1"><v>-20580<\/v>/.test(s1) &&
  /<c r="A4" t="inlineStr"><is><t xml:space="preserve">Sold \(after discounts\)<\/t><\/is><\/c><c r="B4"><v>2200<\/v>/.test(s1) &&
  /<col min="1" max="1" width="39.29" customWidth="1"\/>/.test(s1) && /<c r="A18" t="inlineStr"><is><t xml:space="preserve">By category/.test(s1) &&
  /<c r="A19" t="inlineStr"><is><t xml:space="preserve">Rent<\/t><\/is><\/c><c r="B19"><v>15000<\/v>/.test(s1), s1.slice(0, 1500));
const s2 = z['xl/worksheets/sheet2.xml'].text;
check('Entries: bold frozen header, oldest first, one-off, struck text, & escaped',
  /<pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"\/>/.test(s2) &&
  /<c r="A1" s="1" t="inlineStr"><is><t xml:space="preserve">Recorded<\/t>/.test(s2) &&
  /<c r="B2" t="inlineStr"><is><t xml:space="preserve">one-off<\/t>/.test(s2) && /<c r="E2"><v>500.46<\/v>/.test(s2) &&
  /typed twice/.test(s2) && /Marketing &amp; advertising/.test(s2), s2.slice(0, 1500));
r = await mgr('erpExpenseExport', [{ month: '2025-03' }]);
check('manager cannot export', !r.ok && r.error === 'Your account does not have access to that.', r);

// =========================================================== WEBSITE ORDERS
const today = formatDate(new Date(), 'yyyy-MM-dd');
let feed = [
  { number: 1001, created: '2026-09-28 15:40:11', status: 'processing', sku: PLA, product: 'Sunlu PLA Black', qty: 2, line_total: 2500,
    customer: 'Nadia', phone: '+8801555123456', address: 'Banani', payment: 'Cash on delivery', total: 54620 },
  { number: 1001, created: '2026-09-28 15:40:11', status: 'processing', sku: A1, product: 'Bambu A1', qty: 1, line_total: 52000,
    customer: 'Nadia', phone: '+8801555123456', address: 'Banani', payment: 'Cash on delivery', total: 54620 },
  { number: 1002, created: '2026-09-29 09:00:00', status: 'processing', sku: '', product: 'Gift card', qty: 1, line_total: 500,
    customer: 'Omar', phone: '01811000222', address: 'Uttara', payment: 'bKash', total: 1850 },
  { number: 1002, created: '2026-09-29 09:00:00', status: 'processing', sku: PLA, product: 'Sunlu PLA Black', qty: 1, line_total: 1350,
    customer: 'Omar', phone: '01811000222', address: 'Uttara', payment: 'bKash', total: 1850 },
  { number: 1003, created: '2026-09-30 10:00:00', status: 'processing', sku: PLA.toLowerCase(), product: 'Sunlu PLA Black', qty: 1, line_total: 1350,
    customer: 'Karim', phone: '01712345678', address: 'Dhaka', payment: 'Pay online (EPS)', total: 1350 },
];
web.on(/\/orders\?/, () => ({ body: { items: feed } }));
let stockBody = null;
web.on(/\/stock$/, (url, opts) => { stockBody = JSON.parse(opts.body); return { body: { changed: [{ sku: PLA, from: 9, to: 3, status_to: 'instock' }], changed_count: 1, unchanged: 2, missing_count: 0 } }; });

let p = await asOwner((ctx) => W.pullWebOrders(ctx)).catch((x) => ({ err: x.message }));
check('pull without the sync key', p.err === 'Website sync key not set. Run "Setup Website Sync" from the menu first.', p);
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'CZ_SYNC_KEY', 'sekrit')`;
web.calls.length = 0;
p = await asOwner((ctx) => W.pullWebOrders(ctx));
const call0 = web.calls[0];
check('pull: 5 lines fetched, 5 added', p.ok && p.fetched === 5 && p.added === 5, p);
check('pull: week look-back, limit 100, key header, default base', call0 &&
  /^https:\/\/costareen\.com\/wp-json\/cz\/v1\/orders\?limit=100&since=\d{4}-\d{2}-\d{2}T\d{2}%3A\d{2}%3A\d{2}$/.test(call0.url) &&
  call0.opts.headers['x-cz-key'] === 'sekrit', call0);
p = await asOwner((ctx) => W.pullWebOrders(ctx));
check('pull again: nothing new (the no-SKU line is not duplicated)', p.ok && p.fetched === 5 && p.added === 0, p);
const wl = await sql`select sku from web_order_lines where business_id = ${B} order by seq`;
check('no-SKU line stored as (no sku)', wl.length === 5 && wl[2].sku === '(no sku)', wl);

r = await mgr('erpWebOrders', []);
const wo = r.result || [];
check('web orders: grouped, newest first', r.ok && wo.map((o) => o.no).join() === '1003,1002,1001', wo.map((o) => o.no));
const o1 = wo.find((o) => o.no === '1001');
check('order 1001 fields', o1 && o1.date === '2026-09-28 15:40' && o1.customer === 'Nadia' && o1.phone === '01555123456' &&
  o1.orderTotal === 54620 && o1.payment === 'Cash on delivery' && o1.entered === false && o1.status === 'processing' &&
  o1.lines.length === 2 && o1.lines[0].lineTotal === 2500 && o1.lines[1].sku === A1 && !('lineId' in o1.lines[0]) && !('orderId' in o1), o1);
r = await sales('erpWebOrders', []);
check('sales refused web orders', !r.ok && r.error === 'Your account does not have access to that.', r);

p = await asOwner((ctx) => W.pushStockToWebsite(ctx, 'dry'));
const qty = {};
for (const x of (stockBody && stockBody.items) || []) qty[x.sku] = x.qty;
check('push dry: stock minus orders not entered (PLA 7-4, A1 3-1, PETG 0)', p.ok && p.sent === 3 && stockBody.mode === 'dry' &&
  stockBody.zero_policy === 'outofstock' && qty[PLA] === 3 && qty[A1] === 2 && qty[PETG] === 0 && p.changed_count === 1, [p, stockBody]);
await asOwner((ctx) => W.pushStockToWebsite(ctx, 'apply'));
check('push apply', stockBody.mode === 'apply');

check('payment words', JSON.stringify(['Cash on delivery', 'COD', 'EPS', 'Visa card', 'bKash', 'Nagad', 'Rocket', 'Bank transfer', 'Cash', 'Crypto', '']
  .map((x) => W.webPayment(x))) === JSON.stringify([
  { method: 'COD', status: 'Pending' }, { method: 'COD', status: 'Pending' }, { method: 'Bangla QR', status: 'Paid' },
  { method: 'Bangla QR', status: 'Paid' }, { method: 'bKash', status: 'Pending' }, { method: 'Nagad', status: 'Pending' },
  { method: 'Rocket', status: 'Pending' }, { method: 'Bank Transfer', status: 'Pending' }, { method: 'Cash', status: 'Paid' },
  { method: 'Crypto', status: 'Pending' }, { method: 'Cash', status: 'Pending' }]));

// ---- enter as invoice
const stockOf = async (sku) => (await mgr('erpCatalog', [])).result.find((x) => x.sku === sku).stock;
r = await mgr('erpEnterWebOrder', ['1001']);
check('order 1001 entered', r.ok && r.result.ok && r.result.orderNo === '1001' && /^INV-\d{8}-\d{3,}$/.test(r.result.invoiceNo) && 'pdfUrl' in r.result, r);
const inv1001 = r.result.invoiceNo;
let row = (await sql`select * from invoices where invoice_no = ${inv1001}`)[0];
check('invoice: priced by the website (discount 200 from the line, delivery 120), COD pending, WEB note',
  row.grand_total === 54620 && row.discount === 200 && row.delivery_charge === 120 && row.payment_method === 'COD' &&
  row.payment_status === 'Pending' && row.note === 'WEB-1001' && row.source === 'Website order' &&
  row.web_order_no === '1001' && row.customer_phone === '01555123456', row);
check('stock deducted (PLA 7 -> 5, A1 3 -> 2)', (await stockOf(PLA)) === 5 && (await stockOf(A1)) === 2);
const wrow = (await sql`select entered, invoice_id from web_orders where business_id = ${B} and order_no = '1001'`)[0];
check('order ticked and tied to its invoice', wrow.entered && wrow.invoice_id === row.id, wrow);
r = await mgr('erpEnterWebOrder', ['1001']);
check('entered twice refused', !r.ok && r.error === 'Order 1001 is already entered.', r);
r = await mgr('erpEnterWebOrder', ['9999']);
check('unknown order', !r.ok && r.error === 'Order 9999 not found.', r);
r = await mgr('erpEnterWebOrder', ['']);
check('no order', !r.ok && r.error === 'Which order?', r);
r = await mgr('erpEnterWebOrder', ['1002']);
check('unknown SKU refused, nothing written', !r.ok && /^Not matched to a product yet: Gift card. Match them under Web orders/.test(r.error) &&
  (await stockOf(PLA)) === 5, r);
r = await mgr('erpEnterWebOrder', ['1003']);
row = r.ok && (await sql`select * from invoices where invoice_no = ${r.result.invoiceNo}`)[0];
const pay3 = r.ok && await sql`select * from payments where invoice_no = ${r.result.invoiceNo}`;
check('online-paid order: Bangla QR, Paid, payment recorded, sku matched case-insensitively', r.ok && row.payment_method === 'Bangla QR' &&
  row.payment_status === 'Paid' && pay3.length === 1 && pay3[0].amount === 1350 && row.delivery_charge === 0, [r, row]);

// ---- tick off with no invoice
r = await mgr('erpMarkWebOrderEntered', ['1002']);
check('order 1002 ticked off', r.ok && r.result.orderNo === '1002' && r.result.rows === 2, r);
r = await mgr('erpMarkWebOrderEntered', ['1999']);
check('tick unknown', !r.ok && r.error === 'Order 1999 not found.', r);
r = await mgr('erpWebOrders', []);
check('all three entered now', r.result.every((o) => o.entered));
await asOwner((ctx) => W.pushStockToWebsite(ctx, 'dry'));
check('push: nothing held back once entered (PLA 4)', stockBody.items.find((x) => x.sku === PLA).qty === 4, stockBody.items);

// ---- link a hand-typed invoice
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rumi', phone: '01666777888' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
const handInv = r.result.invoiceNo;
const old = new Date(Date.now() - 20 * 86400000);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rumi', phone: '01666777888' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none', date: formatDate(old, 'yyyy-MM-dd') }]);
const oldInv = r.result.invoiceNo;
feed = [{ number: 1004, created: today + ' 09:00:00', status: 'processing', sku: PLA, product: 'Sunlu PLA Black', qty: 1, line_total: 1350,
  customer: 'Rumi', phone: '8801666777888', address: 'Mirpur', payment: 'Cash on delivery', total: 1420 }];
await asOwner((ctx) => W.pullWebOrders(ctx));
r = await mgr('erpWebOrderInvoices', [{ orderNo: '1004' }]);
check('suggestions: same phone, near the date only', r.ok && r.result.linked === '' && r.result.suggest.length === 1 &&
  r.result.suggest[0].id === handInv && r.result.suggest[0].total === 1350 && r.result.suggest[0].customer === 'Rumi' &&
  r.result.suggest[0].when === today && r.result.total === 1420 && r.result.phone === '01666777888', r);
check('old invoice exists but is outside the window', oldInv && oldInv !== handInv);
r = await mgr('erpWebOrderInvoices', [{ orderNo: '77' }]);
check('invoices for unknown order', !r.ok && r.error === 'Order 77 not found.', r);

r = await mgr('erpLinkWebOrder', [{ orderNo: '1004', invoiceNo: handInv }]);
check('linked', r.ok && r.result.ok && r.result.rows === 1 && r.result.already === false && r.result.invoiceNo === handInv, r);
row = (await sql`select note, web_order_no from invoices where invoice_no = ${handInv}`)[0];
check('note gets WEB- at the front', row.note === 'WEB-1004 Invoice submission' && row.web_order_no === '1004', row);
const fx = await sql`select * from invoice_fixes where invoice_no = ${handInv}`;
check('logged in INVOICE_FIXES', fx.length === 1 && fx[0].field === 'website order' && fx[0].was === 'Invoice submission' &&
  fx[0].now === 'WEB-1004 Invoice submission' && fx[0].fixed_by === 'Mehedi', fx);
r = await mgr('erpWebOrders', []);
check('linked order ticked', r.result.find((o) => o.no === '1004').entered);
r = await mgr('erpWebOrderInvoices', [{ orderNo: '1004' }]);
check('now reports the link', r.ok && r.result.linked === handInv && r.result.suggest.length === 0, r);
r = await mgr('erpLinkWebOrder', [{ orderNo: '1004', invoiceNo: handInv }]);
check('linking again: already', r.ok && r.result.already === true, r);
r = await mgr('erpLinkWebOrder', [{ orderNo: '1004', invoiceNo: oldInv }]);
check('order tied elsewhere', !r.ok && r.error === 'Website order 1004 is already tied to ' + handInv + '.', r);
r = await mgr('erpLinkWebOrder', [{ orderNo: '1005', invoiceNo: handInv }]);
check('invoice tied elsewhere', !r.ok && r.error === handInv + ' is already tied to website order 1004.', r);
r = await mgr('erpLinkWebOrder', [{ orderNo: '1005', invoiceNo: 'INV-NOPE' }]);
check('no such invoice', !r.ok && r.error === 'No invoice called INV-NOPE.', r);
r = await mgr('erpLinkWebOrder', [{ orderNo: '10 05', invoiceNo: 'x' }]);
check('order no with a space', !r.ok && r.error === 'That order number is not valid.', r);
r = await mgr('erpLinkWebOrder', [{ orderNo: '', invoiceNo: 'x' }]);
check('which website order', !r.ok && r.error === 'Which website order?', r);
r = await mgr('erpLinkWebOrder', [{ orderNo: '1', invoiceNo: '' }]);
check('which invoice', !r.ok && r.error === 'Which invoice?', r);

// ---- courier
web.on(/\/cod\?/, () => ({ body: { orders: [
  { order_no: '1001', date: '2026-09-28 15:40', customer: 'Nadia', phone: '01555123456', method: 'Cash on delivery', total: 54620, cod_amount: 54620, consignment: 'C1', courier: 'delivered' },
  { order_no: '1002', date: '2026-09-29', customer: 'Omar', phone: '01811000222', method: 'bKash', total: 1850, cod_amount: 1500, consignment: 'C2', courier: 'in_review' },
  { order_no: '1006', date: today, customer: 'Rumi', phone: '01666777888', method: 'COD', total: 700, cod_amount: 700, consignment: 'C3', courier: 'returned' },
  { order_no: '1007', date: today, customer: '', phone: '', method: 'card', total: 900, cod_amount: 0, consignment: '', courier: '' },
  { order_no: '1008', date: today, customer: 'X', phone: '01999888777', method: 'COD', total: 300, cod_amount: 300.4, consignment: 'C9', courier: 'Weird' },
] } }));
web.calls.length = 0;
r = await mgr('erpCourier', [{ days: 30 }]);
const c = r.result;
check('courier: asks /cod for 30 days, 200 max', r.ok && /\/cod\?days=30&limit=200$/.test(web.calls[0].url), web.calls[0]);
check('courier totals', c && c.collected === 54620 && c.lost === 700 && c.waiting === 1800 && c.count === 5 && c.days === 30, c);
const byNo = {};
for (const x of (c && c.orders) || []) byNo[x.orderNo] = x;
check('delivered COD order tied to its invoice', byNo['1001'].invoiceNo === inv1001 && byNo['1001'].isCod && byNo['1001'].tone === 'ok' &&
  byNo['1001'].courierLabel === 'Delivered' && byNo['1001'].collected && byNo['1001'].when === '2026-09-28' && byNo['1001'].suggest.length === 0, byNo['1001']);
check('ticked by hand, no invoice: handled', byNo['1002'].handled && byNo['1002'].invoiceNo === '' && !byNo['1002'].isCod && byNo['1002'].courierLabel === 'With the courier', byNo['1002']);
check('came back: bad tone; Rumi invoice already linked so not suggested', byNo['1006'].tone === 'bad' && byNo['1006'].courierLabel === 'Came back' && byNo['1006'].suggest.length === 0, byNo['1006']);
check('not booked', byNo['1007'].courierLabel === 'Not booked' && byNo['1007'].tone === 'info', byNo['1007']);
check('unknown word kept, warn when booked, cod rounded', byNo['1008'].courierLabel === 'weird' && byNo['1008'].tone === 'warn' && byNo['1008'].cod === 300, byNo['1008']);
check('generatedAt "d MMM yy, h:mm a"', /^\d{1,2} [A-Z][a-z]{2} \d\d, \d{1,2}:\d{2} (AM|PM)$/.test(c.generatedAt), c.generatedAt);
web.on(/\/cod\?/, () => ({ status: 500, body: 'oops' }));
r = await mgr('erpCourier', [{}]);
check('website error', !r.ok && r.error === 'Could not reach the website: Website returned HTTP 500: oops', r);
await sql`update business_config set value = 'https://shop.test/api/' where business_id = ${B} and key = 'website_api'`;
await sql`insert into business_config (business_id, key, value) values (${B}, 'website_api', 'https://shop.test/api/') on conflict do nothing`;
web.on(/^https:\/\/shop\.test\/api\/cod\?days=7&/, () => ({ body: { orders: [] } }));
r = await mgr('erpCourier', [{ days: 7 }]);
check('website base from config website_api', r.ok && r.result.count === 0 && r.result.days === 7, r);
await sql`delete from business_secrets where business_id = ${B} and key = 'CZ_SYNC_KEY'`;
r = await mgr('erpCourier', [{}]);
check('no key', !r.ok && r.error === 'Could not reach the website: Website sync key not set. Run "Setup Website Sync" from the menu first.', r);
r = await sales('erpCourier', [{}]);
check('sales refused courier', !r.ok && r.error === 'Your account does not have access to that.', r);

r = await mgr('erpBundle', [['weborders']]);
check('bundle weborders part', r.ok && r.result.weborders && r.result.weborders.length === 4, r.result && r.result.errors);

// another business sees none of it
const other = await sql`select count(*)::int as n from web_orders where business_id = ${FIX.B2}`;
check('nothing leaked to B2', other[0].n === 0);

await done();
