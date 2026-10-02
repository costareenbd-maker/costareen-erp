// Plan A3: money accounts - where the money is.
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const PLA = 'FIL-SUN-PLA-BLA-001';
const book = async (who, p) => (await (who || owner)('erpCashBook', [p || {}]));
const bal = async (name) => (await book()).result.accounts.find((a) => a.name === name).balance;

// ---------------------------------------------------------------- set up
let r = await mgr('erpCashBook', [{}]);
check('money is for shareholders and the owner', !r.ok, r);
r = await book(shareholder);
check('nothing set up yet', r.ok && r.result.setup === true && r.result.accounts.length === 0, r.result);
r = await shareholder('erpCashSetup', [{}]);
check('only the owner sets the accounts up', !r.ok, r);
r = await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Islami Bank', kind: 'bank' }, { name: 'BRAC Bank', kind: 'bank' },
                                              { name: 'bKash', kind: 'wallet' }, { name: 'Steadfast', kind: 'courier' }] }]);
check('five accounts, all at zero', r.ok && r.result.accounts.length === 5 && r.result.accounts.every((a) => a.balance === 0) && !r.result.setup, r.result && r.result.accounts);
const A = {}; r.result.accounts.forEach((a) => { A[a.name] = a.id; });
const rules = r.result.rules;
check('each payment method has a home', rules.map.cash === A.Cash && rules.map.bkash === A.bKash && rules.map['bank transfer'] === A['Islami Bank'] &&
  rules.map['cod (steadfast)'] === A.Steadfast && rules.expense === A.Cash && rules.payout === A['Islami Bank'], rules);
r = await owner('erpCashSetup', [{}]);
check('set-up runs once', !r.ok && /already set up/.test(r.error), r);

// ---------------------------------------------------------------- money in
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
const INV1 = r.result.invoiceNo;
check('a cash sale lands in Cash', r.ok && (await bal('Cash')) === 2700, await book());
r = await sales('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01811111111' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'bKash' }]);
check('a bKash sale lands in bKash - saved by sales staff, who cannot see the accounts', r.ok && (await bal('bKash')) === 1350 && (await bal('Cash')) === 2700, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Salma', phone: '01911111111' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none', paymentMethod: 'Bank Transfer' }]);
const INV3 = r.result.invoiceNo;
check('a sale on credit moves no money', r.ok && (await bal('Islami Bank')) === 0);
r = await mgr('erpRecordPayment', [{ orderId: INV3, amount: 1000, method: 'Bank Transfer' }]);
check('a later payment by bank transfer lands in the mapped bank', r.ok && (await bal('Islami Bank')) === 1000, r);

// ---------------------------------------------------------------- what is not money
r = await mgr('erpRecordPayment', [{ orderId: INV3, amount: 100, method: 'Cheque' }]);
r = await book();
check('money taken by a method with no account is listed, and is in no balance', r.result.loose.length === 1 && r.result.loose[0].amount === 100 && r.result.loose[0].method === 'Cheque' &&
  (await bal('Islami Bank')) === 1000, r.result.loose);
r = await owner('erpCashReassign', [{ src: 'payment', id: r.result.loose[0].id, account: A['BRAC Bank'] }]);
check('...until the owner says where it went', r.ok && r.result.loose.length === 0 && (await bal('BRAC Bank')) === 100, r.result && r.result.loose);
await owner('erpCashTransfer', [{ from: A['BRAC Bank'], to: A['Islami Bank'], amount: 100 }]);
await owner('erpCashTransfer', [{ from: A['Islami Bank'], to: A['BRAC Bank'], amount: 100 }]);
await owner('erpCashReassign', [{ src: 'payment', id: (await sql`select id from payments where method = 'Cheque'`)[0].id, account: A['Islami Bank'] }]);
await sql`delete from payments where method = 'Cheque'`;

// ---------------------------------------------------------------- money out
r = await shareholder('erpExpenseAdd', [{ amount: 500, description: 'tea', category: 'Miscellaneous' }]);
check('an expense leaves the usual account (Cash)', r.ok && (await bal('Cash')) === 2200 && r.result.accounts.some((a) => a.name === 'BRAC Bank') && r.result.accountDefault === A.Cash, r.result && r.result.accounts);
r = await shareholder('erpExpenseAdd', [{ amount: 300, description: 'bank charge', category: 'Bank & platform fees', account: A['BRAC Bank'] }]);
check('...or the one that is named', r.ok && (await bal('BRAC Bank')) === -300 && (await bal('Cash')) === 2200);
const EX = r.result.oneoff.find((x) => x.description === 'tea');
r = await owner('erpExpenseVoid', [{ id: EX.id, reason: 'entered twice' }]);
check('a struck-out expense gives the money back', r.ok && (await bal('Cash')) === 2700, r);
r = await owner('erpReturnGoods', [{ invoiceNo: INV1, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'refund', method: 'Cash', reason: 'changed mind' }]);
check('a refund leaves Cash', r.ok && (await bal('Cash')) === 1350, [r, await bal('Cash')]);

// ---------------------------------------------------------------- capital
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 60 }]);
const H = r.result.holders[0].id;
check('capital screen offers the accounts', r.ok && r.result.accounts.length === 4 && !r.result.accounts.some((a) => a.name === 'Steadfast'), r.result.accounts);
r = await owner('erpCapitalEntryAdd', [{ holder: H, type: 'invest', amount: 100000, account: A['Islami Bank'] }]);
check('capital put in arrives in the bank named', r.ok && (await bal('Islami Bank')) === 101000, r);
r = await owner('erpCapitalEntryAdd', [{ holder: H, type: 'profit', amount: 5000, account: A.Cash }]);
check('profit paid out leaves the account named', r.ok && (await bal('Cash')) === 1350 - 5000, r);
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Inv', returnKind: 'monthly', returnValue: 1000, invested: 0 }]);
const IV = r.result.holders.find((h) => h.name === 'Inv').id;
r = await owner('erpCapitalEntryAdd', [{ holder: IV, type: 'ret', amount: 1000, account: A['Islami Bank'] }]);
check('an investor return is one payment, counted once', r.ok && (await bal('Islami Bank')) === 100000, await bal('Islami Bank'));
const pr = await sql`select count(*)::int n from payments where business_id = ${FIX.B} and method = 'Returned' and account_id is not null`;
check('goods returned is not money: it touches no account', pr[0].n === 0);

// ---------------------------------------------------------------- transfers and corrections
r = await shareholder('erpCashTransfer', [{ from: A['Islami Bank'], to: A['Islami Bank'], amount: 10 }]);
check('transfer needs two accounts', !r.ok && r.error === 'Choose two different accounts.', r);
r = await shareholder('erpCashTransfer', [{ from: A['Islami Bank'], to: A.Cash, amount: 20000, note: 'for the drawer' }]);
check('bank to drawer: one goes down, the other up, the total stays', r.ok && (await bal('Islami Bank')) === 80000 && (await bal('Cash')) === 16350, r.result && r.result.accounts);
const total = (await book()).result.total;
r = await shareholder('erpCashAdjust', [{ account: A.Cash, counted: 16000, note: 'short' }]);
check('only the owner corrects a balance', !r.ok, r);
r = await owner('erpCashAdjust', [{ account: A.Cash, counted: 16000, note: '' }]);
check('a correction needs a reason', !r.ok && /why the book was wrong/.test(r.error), r);
r = await owner('erpCashAdjust', [{ account: A.Cash, counted: 16000, note: 'drawer counted, 350 short' }]);
check('counted 16,000: the book follows, and says why', r.ok && (await bal('Cash')) === 16000 && r.result.entries[0].what === 'Correction after counting' &&
  /counted 16000, book said 16350/.test(r.result.entries[0].ref) && r.result.entries[0].after === 16000, r.result && r.result.entries[0]);
const mv = r.result.entries[0];
r = await owner('erpCashMoveVoid', [{ id: mv.id, reason: 'found the 350' }]);
check('a correction can be struck out', r.ok && (await bal('Cash')) === 16350 && (await book()).result.total === total, r);

// ---------------------------------------------------------------- the statement
r = await book(owner, { account: A.Cash });
const E = r.result.entries;
check('statement: newest first, each line with the balance after it', E[0].after === 16350 && E[E.length - 1].amount === 2700 && E[E.length - 1].after === 2700 &&
  E.some((e) => e.what === 'Transfer in' && /from Islami Bank/.test(e.ref)) && E.some((e) => /^Refund to/.test(e.what) && e.amount === -1350), E);
check('a sale line names its invoice', E.some((e) => e.invoice === INV1), E.map((e) => e.invoice));

// ---------------------------------------------------------------- courier
await sql`insert into payments (business_id, payment_no, invoice_no, customer, amount, method, account_id) values (${FIX.B}, 'S1', 'INV-9', 'Buyer', 5000, 'COD (Steadfast)', ${A.Steadfast})`;
check('cash collected by the courier sits with the courier', (await bal('Steadfast')) === 5000);
await sql`insert into courier_payouts (business_id, payout_id, created_src, paid_at, cod_collected, delivery_charges, cod_fee, paid_to_bank) values (${FIX.B}, 'P-7', '2026-10-01 10:00', '2026-10-01 10:00', 5000, 120, 50, 4830)`;
r = await book();
check('a payout nobody gave a bank is listed, and is in no bank yet', r.result.unassigned.length === 1 && r.result.unassigned[0].amount === 4830 &&
  (await bal('Steadfast')) === 0 && (await bal('Islami Bank')) === 80000, r.result.unassigned);
r = await owner('erpCashReassign', [{ src: 'payout', id: r.result.unassigned[0].id, account: A['BRAC Bank'] }]);
check('the owner says which bank it reached', r.ok && (await bal('BRAC Bank')) === 4530 && r.result.unassigned.length === 0, r.result && r.result.accounts);

// ---------------------------------------------------------------- changing the set-up
r = await owner('erpCashMapSave', [{ map: { ...rules.map, 'bank transfer': A['BRAC Bank'] }, expense: A.Cash, payout: A['BRAC Bank'] }]);
check('bank transfers now go to BRAC', r.ok && r.result.rules.map['bank transfer'] === A['BRAC Bank'], r.result && r.result.rules);
const before = await bal('Islami Bank');
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Bank Transfer' }]);
check('new money follows the new rule; what was already written stays where it was', r.ok && (await bal('BRAC Bank')) === 4530 + 1350 && (await bal('Islami Bank')) === before, [await bal('BRAC Bank'), before]);
const pay = (await sql`select id from payments where business_id = ${FIX.B} and invoice_no = ${r.result.invoiceNo}`)[0];
r = await owner('erpCashReassign', [{ src: 'payment', id: pay.id, account: A['Islami Bank'] }]);
check('one line can be moved to the bank it really reached', r.ok && (await bal('Islami Bank')) === before + 1350 && (await bal('BRAC Bank')) === 4530, r.result && r.result.accounts);
r = await owner('erpCashAccountSave', [{ name: 'Nagad', kind: 'wallet', opening: 2500, openingDate: '2026-09-01' }]);
check('a new account with an opening balance', r.ok && (await bal('Nagad')) === 2500, r.result && r.result.accounts);
r = await owner('erpCashAccountSave', [{ name: 'nagad', kind: 'wallet' }]);
check('no two accounts with one name', !r.ok && /already an account/.test(r.error), r);
r = await owner('erpCashAccountSave', [{ id: A.bKash, name: 'bKash merchant', kind: 'wallet', archived: true }]);
check('an account that still holds money cannot be retired', !r.ok && /still holds 1350/.test(r.error), r);
await owner('erpCashTransfer', [{ from: A.bKash, to: A['BRAC Bank'], amount: 1350 }]);
r = await owner('erpCashAccountSave', [{ id: A.bKash, name: 'bKash merchant', kind: 'wallet', archived: true }]);
check('emptied, it can be - renamed too', r.ok && r.result.accounts.find((a) => a.id === A.bKash).archived === true && r.result.accounts.find((a) => a.id === A.bKash).name === 'bKash merchant', r);
r = await owner('erpCashTransfer', [{ from: A.Cash, to: A.bKash, amount: 5 }]);
check('nothing moves into a retired account', !r.ok && /retired/.test(r.error), r);
const other = await sql`select count(*)::int n from money_accounts where business_id = ${FIX.B2}`;
check('another business has none of this', other[0].n === 0);

// a payout whose date came through the import as a spreadsheet serial number is still read
await sql`insert into courier_payouts (business_id, payout_id, created_src, paid_at, cod_collected, delivery_charges, cod_fee, paid_to_bank, account_id) values (${FIX.B}, 'P-8', '46272.48', '46272.52', 1000, 60, 10, 930, ${A['BRAC Bank']})`;
const b0 = await bal('BRAC Bank');
r = await book(owner, { account: A['BRAC Bank'] });
check('a payout dated as a spreadsheet number counts, on the right day', r.result.entries.some((e) => e.ref === 'Payout P-8' && e.amount === 930 && /^7 Sep 2026/.test(e.when)), r.result.entries.slice(0, 3));
const pn = (await owner('erpPnl', [{ months: 3 }])).result.months.find((m) => m.month === '2026-09');
check('...and its courier fees are in that month of the P&L', pn && pn.courier === 70, pn);

await done();
