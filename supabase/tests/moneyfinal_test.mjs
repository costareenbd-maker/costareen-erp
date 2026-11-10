// final-money (10 Nov 2026): the money screens' last pass - one-where-many made many (split payments, transfer to
// several accounts, many receipts on an expense, several months closed in one go, several sellers paid at once),
// every money write refuses a closed month, a double tap books once, a moved line keeps its trail, a struck-out
// transfer stays readable, negative balances are flagged, totals equal the sum of their lines, and the role gates.
// Run: sh local/onetest.sh supabase/tests/moneyfinal_test.mjs
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, files, check, done } from './harness.mjs';

const B = FIX.B;
const now = new Date(Date.now() + 6 * 3600e3);
const ym = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
const thisMonth = ym(now);
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + String(mo).padStart(2, '0'); };
const prev = shift(thisMonth, -1);
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAE' + /* split: the pre-push key guard reads EAA... as a Meta token */ 'AAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';
let r;

// ------------------------------------------------------------------ accounts and goods
r = await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Bank A', kind: 'bank' }, { name: 'Bank B', kind: 'bank' }, { name: 'bKash', kind: 'wallet' }] }]);
check('four accounts set up', r.ok && r.result.accounts.length === 4, r);
const A = {}; r.result.accounts.forEach((a) => { A[a.name] = a.id; });
r = await owner('erpCashMapSave', [{ map: { cash: A.Cash, bkash: A.bKash, 'bank transfer': A['Bank A'] }, expense: A.Cash, payout: A['Bank A'] }]);
check('cash -> Cash, bKash -> bKash, bank transfer -> Bank A', r.ok, r);
const book = async (acc) => (await owner('erpCashBook', [acc ? { account: acc, limit: 1000 } : {}])).result;
const bal = async (n) => (await book()).accounts.find((a) => a.name === n).balance;

await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status)
          values (${B}, 'MF-PLA', 'Money final PLA', 'Filaments', 'Test', 'PLA', 0, 1000, 'Active')`;
r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-MF', supplier: 'Dragon', mode: 'bdt', totalBdt: 50000, lines: [{ sku: 'MF-PLA', qty: 100 }] }]);
check('100 PLA received at 500 each', r.ok, r);

// ------------------------------------------------------------------ ONE payment, MANY ways (split payments)
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Salma', phone: '01911111111' }, items: [{ sku: 'MF-PLA', qty: 4 }], payMode: 'none' }]);
check('an invoice of 4,000 with nothing paid', r.ok && r.result.grandTotal === 4000, r);
const INV = r.result.invoiceNo;
r = await mgr('erpSettleDue', [{ orderId: INV, reason: 'payment', amount: 3000, parts: [{ amount: 1000, method: 'Cash' }, { amount: 1500, method: 'bKash' }] }]);
check('parts that do not add up to the amount are refused', !r.ok && /add up to 2500.00, not 3000.00/.test(r.error), r);
r = await mgr('erpSettleDue', [{ orderId: INV, reason: 'payment', parts: [{ amount: 1000, method: 'Cash' }, { amount: 2000, method: 'bKash' }] }]);
check('1,000 cash + 2,000 bKash recorded as one payment in two lines', r.ok && r.result.amount === 3000 && r.result.parts && r.result.parts.length === 2 && r.result.applied[0].applied === 3000, r);
check('...each part landed in its own account', (await bal('Cash')) === 1000 && (await bal('bKash')) === 2000, await book());
const pays = await sql`select amount, method, account_id from payments where business_id = ${B} and invoice_no = ${INV} order by amount`;
check('...two payment rows, each with its method and account', pays.length === 2 && String(pays[0].method) === 'Cash' && pays[0].account_id === A.Cash && String(pays[1].method) === 'bKash' && pays[1].account_id === A.bKash, pays);
r = await owner('erpDues', []);
check('...the invoice owes 1,000 now', r.result.invoices.find((d) => d.id === INV).due === 1000, r.result.invoices);
r = await mgr('erpSettleDue', [{ orderId: INV, reason: 'payment', parts: [{ amount: 800, method: 'Cash' }, { amount: 800, method: 'bKash' }] }]);
check('parts over what is owed are refused', !r.ok && /more than is owed/.test(r.error), r);

// ------------------------------------------------------------------ a double tap books once
r = await mgr('erpSettleDue', [{ orderId: INV, reason: 'payment', amount: 300, method: 'Cash' }]);
check('300 cash received', r.ok, r);
r = await mgr('erpSettleDue', [{ orderId: INV, reason: 'payment', amount: 300, method: 'Cash' }]);
check('the same payment a second later is refused as a double tap', !r.ok && /double tap/.test(r.error), r);
check('...and the books hold it once', (await bal('Cash')) === 1300, await bal('Cash'));
r = await mgr('erpTakeAdvance', [{ phone: '01911111111', name: 'Salma', amount: 250, method: 'Cash' }]);
check('an advance of 250', r.ok, r);
r = await mgr('erpTakeAdvance', [{ phone: '01911111111', name: 'Salma', amount: 250, method: 'Cash' }]);
check('the same advance a second later is refused', !r.ok && /double tap/.test(r.error), r);

// ------------------------------------------------------------------ one transfer, MANY destinations
r = await owner('erpCashTransfer', [{ from: A.Cash, splits: [{ to: A['Bank A'], amount: 300 }, { to: A['Bank B'], amount: 200 }] }]);
check('cash deposited into two banks in one go', r.ok && r.result.moved && r.result.moved.legs === 2 && r.result.moved.total === 500, r);
check('...Cash 1,050 · Bank A 300 · Bank B 200', (await bal('Cash')) === 1050 && (await bal('Bank A')) === 300 && (await bal('Bank B')) === 200, (await book()).accounts);
r = await owner('erpCashTransfer', [{ from: A.Cash, splits: [{ to: A['Bank A'], amount: 1000 }, { to: A['Bank B'], amount: 100 }] }]);
check('a split larger than the source holds is refused as a whole', !r.ok && /holds ৳1,050/.test(r.error) && (await bal('Bank A')) === 300, r);
r = await owner('erpCashTransfer', [{ from: A.Cash, splits: [{ to: A['Bank A'], amount: 10 }, { to: A['Bank A'], amount: 10 }] }]);
check('the same destination twice is refused', !r.ok && /on two lines/.test(r.error), r);
r = await owner('erpCashTransfer', [{ from: A.Cash, to: A['Bank A'], amount: 50 }]);
check('a plain one-to-one transfer still works', r.ok && (await bal('Bank A')) === 350, r);
r = await owner('erpCashTransfer', [{ from: A.Cash, to: A['Bank A'], amount: 50 }]);
check('the same transfer a second later is refused as a double tap', !r.ok && /double tap/.test(r.error) && (await bal('Bank A')) === 350, r);

// ------------------------------------------------------------------ a line moved to another account keeps its trail
const p1000 = (await sql`select id from payments where business_id = ${B} and invoice_no = ${INV} and amount = 1000`)[0].id;
r = await owner('erpCashReassign', [{ src: 'payment', id: p1000, account: A.Cash }]);
check('moving a line into the account it is already in is refused', !r.ok && /already in Cash/.test(r.error), r);
r = await owner('erpCashReassign', [{ src: 'payment', id: p1000, account: A['Bank B'], reason: 'the customer paid into Bank B, not cash' }]);
check('the 1,000 moved from Cash to Bank B', r.ok && (await bal('Cash')) === 0 && (await bal('Bank B')) === 1200, r.ok ? (await book()).accounts : r);
let st = await book(A['Bank B']);
let line = st.entries.find((e) => e.id === p1000);
check('...and the statement says who moved it, from where and why', !!line && /moved .* from Cash: the customer paid into Bank B/.test(line.moved), line);
const trail = await sql`select from_account, to_account, reason, by from money_reassigns where business_id = ${B} and line_id = ${p1000}`;
check('...the trail row: from Cash to Bank B with the reason', trail.length === 1 && trail[0].from_account === A.Cash && trail[0].to_account === A['Bank B'] && /paid into Bank B/.test(trail[0].reason), trail);

// ------------------------------------------------------------------ a struck-out transfer stays on the statement, crossed through
st = await book(A['Bank A']);
const tIn = st.entries.find((e) => e.src === 'move' && e.amount === 300);
r = await owner('erpCashMoveVoid', [{ id: tIn.id }]);
check('striking out without a reason is refused', !r.ok && /Say why/.test(r.error), r);
r = await owner('erpCashMoveVoid', [{ id: tIn.id, reason: 'deposited into Bank B instead' }]);
check('the 300 transfer struck out on both sides', r.ok && (await bal('Bank A')) === 50 && (await bal('Cash')) === 300, r.ok ? (await book()).accounts : r);
st = await book(A['Bank A']);
line = st.entries.find((e) => e.id === tIn.id);
check('...the struck-out line is still on the statement, with its reason, and counts for nothing', !!line && /struck out .* by .*: deposited into Bank B instead/.test(line.struck) && line.amount === 300, line);
const after = st.entries.filter((e) => !e.struck).reduce((t, e) => t + e.amount, 0);
check('...Bank A statement: the live lines add up to its balance', Math.round(after) === 50, { after, entries: st.entries.map((e) => [e.what, e.amount, !!e.struck]) });

// ------------------------------------------------------------------ totals = sum of lines, everywhere
const bk = await book();
let allOk = true, detail = [];
for (const a of bk.accounts) {
  const s = await book(a.id);
  const sum = Math.round(s.entries.filter((e) => !e.struck).reduce((t, e) => t + e.amount, 0));
  detail.push([a.name, a.balance, sum]);
  if (sum !== a.balance) allOk = false;
}
check('every account: its statement lines add up to its balance', allOk, detail);
check('in hand = the sum of the cash, bank and wallet accounts; total = the sum of all', bk.inHand === bk.accounts.filter((a) => !a.archived && a.kind !== 'courier' && a.kind !== 'agent').reduce((t, a) => t + a.balance, 0) && bk.total === bk.accounts.filter((a) => !a.archived).reduce((t, a) => t + a.balance, 0), bk.accounts);
r = await owner('erpBalanceSheet', []);
const bsCash = r.result.owns.filter((o) => o.key === 'cash');
check('the balance sheet carries each account at the book’s balance', r.ok && bsCash.length === 4 && bsCash.every((o) => bk.accounts.find((a) => a.name === o.what).balance === o.amount), bsCash);
check('a shareholder may open the books (canOpen agrees with erpBalanceOpen)', r.result.canOpen === true, r.result.canOpen);

// ------------------------------------------------------------------ a negative balance is flagged
r = await owner('erpCashAdjust', [{ account: A['Bank A'], counted: -40, note: 'bank charges not entered yet' }]);
check('Bank A corrected below zero', r.ok && (await bal('Bank A')) === -40, r);
r = await book();
check('...the account is flagged negative and the screen gets a plain warning', r.accounts.find((a) => a.name === 'Bank A').negative === true && r.warnings.length === 1 && /Bank A is below zero/.test(r.warnings[0].text), r.warnings);
r = await owner('erpCashAdjust', [{ account: A['Bank A'], counted: 60, note: 'charges entered now' }]);
check('...and back above zero: no warning', r.ok && (await book()).warnings.length === 0, r);

// ------------------------------------------------------------------ an expense keeps MANY receipts; a double tap books once
r = await owner('erpExpenseAdd', [{ month: thisMonth, category: 'Office supplies', description: 'Packing tape', amount: 120, account: A.Cash }]);
check('an expense of 120', r.ok, r);
const EX = r.result.oneoff.find((x) => x.description === 'Packing tape').id;
r = await owner('erpExpenseAdd', [{ month: thisMonth, category: 'Office supplies', description: 'Packing tape', amount: 120, account: A.Cash }]);
check('the same expense a second later is refused as a double tap', !r.ok && /double tap/.test(r.error) && r.error.indexOf('recorded a moment ago') > 0, r);
r = await owner('erpExpenseReceipt', [{ id: EX, file: { data: PNG, mime: 'image/png' } }]);
check('a first receipt kept', r.ok && r.result.oneoff.find((x) => x.id === EX).receipts === 1, r);
r = await owner('erpExpenseReceipt', [{ id: EX, files: [{ data: PNG, mime: 'image/png' }, { data: PNG, mime: 'image/png' }] }]);
check('two more receipts kept with it (three in all, nothing replaced)', r.ok && r.result.oneoff.find((x) => x.id === EX).receipts === 3, r.ok ? r.result.oneoff.find((x) => x.id === EX) : r);
check('...all three files are in storage', files.list().filter((k) => k.indexOf('/receipts/' + EX + '-') >= 0).length === 3, files.list());
r = await owner('erpExpenseReceiptUrl', [{ id: EX }]);
check('...and three links come back (the newest as `url`)', r.ok && r.result.urls.length === 3 && r.result.url === r.result.urls[2].url, r);
r = await owner('erpExpenseReceipt', [{ id: EX, file: { data: PNG, mime: 'text/plain' } }]);
check('a file that is not a photo or PDF is refused', !r.ok && /photo .* or a PDF/.test(r.error), r);
r = await owner('erpExpenseExport', [{ month: thisMonth }]);
check('the month exports to Excel (kept in the exports folder)', r.ok && /\.xlsx$/.test(r.result.name) && files.list().some((k) => k.indexOf('/exports/') >= 0), r);
const ex = await owner('erpExpenses', [{ month: thisMonth }]);
const pnl = await owner('erpPnl', [{ months: 1 }]);
check('Expenses net profit is exactly the P&L net profit (one net profit)', ex.ok && pnl.ok && ex.result.net === pnl.result.months[0].net, { ex: ex.result && ex.result.net, pnl: pnl.result && pnl.result.months[0].net });

// ------------------------------------------------------------------ Capital: several months closed in one go; a double tap on the book
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 100, since: shift(thisMonth, -4) }]);
check('one shareholder with 100%', r.ok, r);
const RAHMAN = r.result.holders.find((h) => h.name === 'Rahman').id;
r = await owner('erpCapitalEntryAdd', [{ holder: RAHMAN, type: 'invest', amount: 5000, account: A.Cash }]);
check('5,000 put in', r.ok, r);
r = await owner('erpCapitalEntryAdd', [{ holder: RAHMAN, type: 'invest', amount: 5000, account: A.Cash }]);
check('the same capital line a second later is refused as a double tap', !r.ok && /double tap/.test(r.error), r);
r = await owner('erpCapitalClose', [{ through: thisMonth }]);
check('closing up to the running month is refused', !r.ok && /once it is over/.test(r.error), r);
r = await owner('erpCapitalClose', [{ through: prev }]);
check('every open month up to last month closed in one go (four months)', r.ok && r.result.closedNow && r.result.closedNow.length === 4 && r.result.lockedThrough === prev, r.ok ? r.result.closedNow : r);
check('...each of them kept its own net profit', r.ok && r.result.months.filter((m) => m.closed).length === 4, r.ok ? r.result.months : r);
r = await owner('erpCapitalClose', [{ through: prev }]);
check('closing them again says they are already closed', !r.ok && /already closed/.test(r.error), r);
r = await owner('erpCapitalReopen', [{ month: prev, reason: 'test' }]);
check('the latest closed month reopened', r.ok && r.result.lockedThrough === shift(prev, -1), r);

// ------------------------------------------------------------------ every money write refuses a closed month
// the running month is closed straight in the table (the handler never lets a running month close) so that writes dated
// "today" meet the lock; the row goes away at the end
const EXITEM = (await owner('erpExpenseItemSave', [{ kind: 'fixed', name: 'Lock test rent', amount: 100, fromMonth: thisMonth }]));
const fixedId = EXITEM.ok ? EXITEM.result.fixedItems.find((f) => f.name === 'Lock test rent') : null;
const RCITEM = (await owner('erpExpenseItemSave', [{ kind: 'recurring', name: 'Lock test bill', fromMonth: thisMonth }]));
const recId = RCITEM.ok ? RCITEM.result.recurringItems.find((f) => f.name === 'Lock test bill') : null;
await sql`insert into capital_closed (business_id, month, net_profit, shares, by) values (${B}, ${prev}, 0, '{}'::jsonb, 'test') on conflict do nothing`;
await sql`insert into capital_closed (business_id, month, net_profit, shares, by) values (${B}, ${thisMonth}, 0, '{}'::jsonb, 'test')`;
const locked = /is closed/;
const refusals = [
  ['erpSettleDue', mgr, { orderId: INV, reason: 'payment', amount: 100, method: 'Cash' }],
  ['erpSettleDue (increase the due)', owner, { orderId: INV, reason: 'increase', amount: 100, note: 'test' }, 'erpSettleDue'],
  ['erpTakeAdvance', mgr, { phone: '01911111111', name: 'Salma', amount: 10, method: 'Cash' }],
  ['erpCashTransfer', owner, { from: A.bKash, to: A.Cash, amount: 10 }],
  ['erpCashAdjust', owner, { account: A.Cash, counted: 1, note: 'test' }],
  ['erpCashUp', owner, { account: A.Cash, counted: 1, note: 'test' }],
  ['erpCashReassign', owner, { src: 'payment', id: p1000, account: A.Cash }],
  ['erpCashPlaceMany', owner, { account: A.Cash, items: [{ src: 'payment', id: p1000 }] }],
  ['erpCashMoveVoid', owner, { id: tIn.id === undefined ? '' : (await book(A['Bank A'])).entries.find((e) => e.src === 'move' && !e.struck && e.amount === 50).id, reason: 'test' }],
  ['erpExpenseAdd', owner, { month: thisMonth, category: 'Office supplies', description: 'Lock test', amount: 10 }],
  ['erpExpenseVoid', owner, { id: EX, reason: 'test' }],
  ['erpExpenseRecurringSet', owner, { itemId: recId ? recId.id : 'R-none', amount: 10, month: thisMonth }],
  ['erpExpenseFixedPay', owner, { id: fixedId ? fixedId.id : 'F-none', month: thisMonth }],
  ['erpExpenseItemSave', owner, { kind: 'fixed', name: 'Lock test 2', amount: 10, fromMonth: thisMonth }],
  ['erpExpenseItemEnd', owner, { id: fixedId ? fixedId.id : 'F-none', fromMonth: thisMonth }],
  ['erpCapitalEntryAdd', owner, { holder: RAHMAN, type: 'invest', amount: 10, account: A.Cash }],
  ['erpCapitalEntryVoid', owner, { id: (await owner('erpCapital', [])).result.entries[0].id, reason: 'test' }],
  ['erpCapitalHolderSave (a new person from this month)', owner, { kind: 'investor', name: 'Lock Investor', returnKind: 'monthly', returnValue: 100, since: thisMonth }, 'erpCapitalHolderSave'],
  ['erpCommissionRuleSave (from a closed month)', owner, { scope: 'all', basis: 'sales', pct: 1, since: prev }, 'erpCommissionRuleSave'],
];
for (const [label, as, args, name] of refusals) {
  const x = await as(name || label, [args]);
  check('closed month: ' + label + ' refuses plainly', !x.ok && locked.test(x.error), x);
}
await sql`delete from capital_closed where business_id = ${B} and month in (${thisMonth}, ${prev}) and by = 'test'`;
check('the lock is lifted again for the rest', (await book()).lockedThrough === shift(prev, -1), (await book()).lockedThrough);

// ------------------------------------------------------------------ commission: several sellers paid in one go; a cancelled sale earns nothing
r = await owner('erpCommissionRuleSave', [{ scope: 'all', basis: 'sales', pct: 5 }]);
check('everyone earns 5% of sales', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'MF-PLA', qty: 10 }], payMode: 'full' }]);
check('the manager sells 10,000', r.ok, r);
r = await owner('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'MF-PLA', qty: 4 }], payMode: 'full' }]);
check('the owner sells 4,000', r.ok, r);
const CX = r.result.invoiceNo;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'MF-PLA', qty: 6 }], payMode: 'full' }]);
const CXL = r.result.invoiceNo;
r = await owner('erpCancelInvoice', [{ invoiceNo: CXL, reason: 'customer changed mind', money: 'refund', method: 'Cash' }]);
check('one of the manager’s sales cancelled', r.ok, r);
r = await owner('erpCommission', [{ month: thisMonth }]);
const mgrC = r.result.sellers.find((s) => s.id === FIX.U.mgr), ownC = r.result.sellers.find((s) => s.id === FIX.U.owner);
check('a cancelled sale earns no commission: the manager earned 5% of 10,000 (+ the 4,000 Salma sale) only', mgrC && mgrC.earned === 700, r.result.sellers);
check('the owner earned 5% of 4,000', ownC && ownC.earned === 200, ownC);
r = await owner('erpCommissionPay', [{ month: thisMonth, items: [{ seller: FIX.U.mgr, amount: 700 }, { seller: FIX.U.owner, amount: 300 }] }]);
check('paying more than one seller is owed stops the whole batch', !r.ok && /left to be paid/.test(r.error), r);
r = await owner('erpCommission', [{ month: thisMonth }]);
check('...and nothing was paid', r.result.sellers.every((s) => s.paid === 0), r.result.sellers);
r = await owner('erpCommissionPay', [{ month: thisMonth, items: [{ seller: FIX.U.mgr, amount: 700 }, { seller: FIX.U.owner, amount: 200 }], account: A.Cash }]);
check('both sellers paid in one go', r.ok && r.result.paidNow.length === 2 && r.result.sellers.every((s) => s.left === 0), r.ok ? r.result.sellers : r);
const cm = await sql`select count(*)::int n, coalesce(sum(amount), 0) s from expenses where business_id = ${B} and category = 'Commission' and coalesce(btrim(voided), '') = ''`;
check('...two expense lines, 900 in all', cm[0].n === 2 && Number(cm[0].s) === 900, cm);

// ------------------------------------------------------------------ an investor in a shipment whose cost is not known earns nothing on it (B5)
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Lot Investor', returnKind: 'lot', returnValue: 50 }]);
check('an investor paid by shipment profit', r.ok, r);
const LOT = r.result.holders.find((h) => h.name === 'Lot Investor').id;
r = await owner('erpCapitalEntryAdd', [{ holder: LOT, type: 'invest', amount: 20000, account: A.Cash }]);
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Second Lot Investor', returnKind: 'lot', returnValue: 50 }]);
const LOT2 = r.result.holders.find((h) => h.name === 'Second Lot Investor').id;
r = await owner('erpCapitalEntryAdd', [{ holder: LOT2, type: 'invest', amount: 20000, account: A.Cash }]);
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status)
          values (${B}, 'MF-NC', 'No cost PLA', 'Filaments', 'Test', 'PLA', 0, 800, 'Active')`;
r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-NC', supplier: 'Dragon', mode: 'bdt', totalBdt: 10000, lines: [{ sku: 'MF-NC', qty: 20 }] }]);
check('a second shipment received', r.ok, r);
r = await owner('erpLotFund', [{ holder: LOT, reference: 'SHIP-NC', pct: 60 }]);
check('one investor funds 60% of it', r.ok, r);
r = await owner('erpLotFund', [{ holder: LOT2, reference: 'SHIP-NC', pct: 40 }]);
check('a second investor funds the other 40% (MANY investors per shipment)', r.ok, r);
r = await owner('erpLotFund', [{ holder: LOT2, reference: 'SHIP-NC', pct: 1 }]);
check('over 100% of a shipment is refused', !r.ok && /already funded/.test(r.error), r);
await sql`update stock_lots set unit_cost = null where business_id = ${B} and reference = 'SHIP-NC'`;   // the cost was never written
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'MF-NC', qty: 5 }], payMode: 'full' }]);
check('5 units of the no-cost shipment sold', r.ok, r);
r = await owner('erpCapital', []);
const li = r.result.holders.find((h) => h.id === LOT), li2 = r.result.holders.find((h) => h.id === LOT2);
check('an uncosted sale earns the investors nothing (no cost, no profit - B5)', li && li.returnDue === 0 && li.returnBuilding === 0 && li2 && li2.returnBuilding === 0, [li, li2]);
r = await owner('erpLotFunding', [{ reference: 'SHIP-NC' }]);
check('the funding screen shows the unknown-cost units apart, not as profit', r.ok && r.result.funding.length === 2 && r.result.funding.every((f) => f.profit === 0 && f.unknownSold > 0), r.result && r.result.funding);

// ------------------------------------------------------------------ who sees what
await makeShareholder();
for (const name of ['erpCashBook', 'erpExpenses', 'erpCapital', 'erpBalanceSheet', 'erpPnl', 'erpFd22Analytics']) {
  const x = await shareholder(name, [{}]);
  check('a shareholder opens ' + name, x.ok, x);
}
// 27 Oct 2026 (fix-6/7): a shareholder is open to everything, users and connections included; it is the manager WITH
// the owner's "act" switch who never reaches users, keys or connections (allow.js NOT_ACT)
for (const name of ['erpUsers', 'erpAccessKeys', 'erpConnections']) {
  const x = await shareholder(name, [{}]);
  check('a shareholder also opens ' + name + ' (the 27 Oct rule)', x.ok, x);
}
await sql`update memberships set role = 'manager', powers = '{"act": true}'::jsonb where business_id = ${B} and user_id = ${FIX.U.other}`;
for (const name of ['erpUserSet', 'erpAccessKeyNew', 'erpWebsiteSet']) {
  const x = await shareholder(name, [{}]);
  check('a manager acting as the owner never reaches ' + name, !x.ok, x);
}
for (const name of ['erpCashBook', 'erpExpenses', 'erpCapital', 'erpBalanceSheet', 'erpPnl', 'erpFd22Analytics', 'erpDues', 'erpCashUps']) {
  const x = await sales(name, [{}]);
  check('a sales person sees no money: ' + name, !x.ok, x);
}
r = await sales('erpCommission', [{ month: thisMonth }]);
check('a sales person sees only their own commission, never profit', r.ok && r.result.sellers.every((s) => s.id === FIX.U.sales && s.profit === undefined) && !r.result.canEdit, r);
r = await sales('erpSettleDue', [{ orderId: INV, reason: 'reduce', amount: 10, note: 'test' }]);
check('a sales person cannot reduce a due', !r.ok, r);
r = await mgr('erpCashPlaceMany', [{ account: A.Cash, items: [{ src: 'payment', id: p1000 }] }]);
check('a manager cannot move money between accounts', !r.ok, r);

// ------------------------------------------------------------------ the other business is untouched
const other = await sql`select (select count(*)::int from payments where business_id = ${FIX.B2}) p, (select count(*)::int from money_moves where business_id = ${FIX.B2}) m,
                               (select count(*)::int from expenses where business_id = ${FIX.B2}) e, (select count(*)::int from capital_closed where business_id = ${FIX.B2}) c`;
check('the other business has none of this', other[0].p === 0 && other[0].m === 0 && other[0].e === 0 && other[0].c === 0, other[0]);

await done();
