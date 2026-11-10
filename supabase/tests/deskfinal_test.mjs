// crit6-desk (10 Nov 2026): money said to people is in words with ৳ and South-Asian grouping, never a raw number.
// The balance sheet's joint line used to read "paid in 1163265 + profit share 0 - joint goods we sold 0".
// Also the cash and capital refusals that name an amount, and the book-correction note kept on the money move.
import { sql, FIX, owner, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));

const RAW = /(^|[^0-9,.])\d{6,}(?![0-9])/;           // 6+ digits in a row, not part of ৳11,63,265
const rawIn = (s) => RAW.test(String(s || ''));

// a joint stock with goods worth more than ৳1,00,000 paid in by this company
const PU = crypto.randomUUID();
await sql`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'deskpartner@t.test', ${sql.json({ full_name: 'Desk Partner' })})`;
const B3 = (await sql.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Desk partner test') as id`;
}))[0].id;
const proto = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + PU });
await sql`insert into joint_flags (business_id) values (${FIX.B}), (${B3}) on conflict do nothing`;
let r = await owner('erpJointStart', [{ action: 'create', name: 'Desk JV', displayName: 'Us', tier: 'retail' }]);
const POOL = r.result.created.id;
await proto('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Them', tier: 'retail' }]);
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'DESK-P1', name: 'Desk printer', category: 'Printer', brand: 'X', retail: 50000, floor: 45000, cost: 40000 }]);
r = await owner('erpJointReceive', [{ pool: POOL, sku: 'DESK-P1', qty: 29, unitCost: 40112 }]);
check('joint shipment received (29 x 40,112 = 11,63,248)', r.ok, r.error);

r = await owner('erpBalanceSheet', []);
check('balance sheet reads', r.ok, r.error);
const rows = r.ok ? r.result.owns.concat(r.result.owes) : [];
const jl = rows.find((x) => x.key === 'joint');
check('the joint line is there with its parts as numbers', jl && jl.parts && typeof jl.parts.paidIn === 'number' && jl.parts.paidIn >= 100000, jl);
check('the joint sub line is words with ৳ and grouping', jl && /^Paid in ৳[0-9,]+ · profit share −?৳[0-9,]+ · our joint goods sold ৳[0-9,]+$/.test(jl.sub) && /৳\d{1,2},\d{2},\d{3}/.test(jl.sub), jl && jl.sub);
check('no raw 6+ digit number in any what/sub line of the balance sheet', rows.every((x) => !rawIn(x.what) && !rawIn(x.sub)), rows.filter((x) => rawIn(x.what) || rawIn(x.sub)));
check('no raw 6+ digit number in the reasons list', (r.result.why || []).every((w) => !rawIn(w.what)), r.result.why);

// cash: moving more than the account holds names the balance in ৳
await owner('erpCashSetup', [{ accounts: [{ name: 'Desk Cash', kind: 'cash', opening: 250000 }, { name: 'Desk Bank', kind: 'bank', opening: 0 }] }]);
const acc = (await owner('erpCashBook', [{}])).result.accounts;
const C = acc.find((a) => a.name === 'Desk Cash'), BK = acc.find((a) => a.name === 'Desk Bank');
r = await owner('erpCashTransfer', [{ from: C.id, to: BK.id, amount: 9000000 }]);
check('a transfer above the balance is refused with the balance in ৳', !r.ok && /holds ৳[0-9,]+\./.test(r.error) && !rawIn(r.error), r.error);
// the book correction note
r = await owner('erpCashAdjust', [{ account: C.id, counted: 249000, note: 'counted the drawer' }]);
const mv = (await sql`select note from money_moves where business_id = ${FIX.B} and account_id = ${C.id} and kind = 'adjust' order by at desc limit 1`)[0];
check('the correction note says the money in ৳', r.ok && mv && /counted ৳2,49,000, book said ৳[0-9,]+/.test(mv.note) && !rawIn(mv.note), r.error || mv);

// capital: taking back more than is in names the amount in ৳
await owner('erpCapitalHolderSave', [{ name: 'Desk Investor', kind: 'investor', returnKind: 'none' }]);
const h = (await owner('erpCapital', [])).result.holders.find((x) => x.name === 'Desk Investor');
await owner('erpCapitalEntryAdd', [{ holder: h.id, type: 'invest', amount: 150000, account: C.id }]);
r = await owner('erpCapitalEntryAdd', [{ holder: h.id, type: 'withdraw', amount: 900000, account: C.id }]);
check('taking back more than is in: the amount in ৳', !r.ok && /has ৳1,50,000 in the business/.test(r.error), r.error);
await done();
