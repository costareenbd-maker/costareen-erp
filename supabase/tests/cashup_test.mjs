// FilaDash merge: daily cash-up, the agent's advance account, asking prices (114_cash_up.sql, handlers/cashup.js).
// Run: TEST_SCRIPT=cashup_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done } from './harness.mjs';

const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
let r = await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Bank', kind: 'bank' }] }]);
const A = {}; r.result.accounts.forEach((a) => { A[a.name] = a.id; });
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
const bal = async (n) => (await owner('erpCashBook', [{}])).result.accounts.find((a) => a.name === n).balance;
const cash = await bal('Cash');
check('a cash sale is in the drawer', cash > 0, cash);

// ---- cash-up
r = await mgr('erpCashUp', [{ account: A.Cash, counted: cash }]);
check('a manager does not see the accounts, so cannot count them', !r.ok, r);
const notes = {}; let left = cash;
for (const n of [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1]) { notes[n] = Math.floor(left / n); left -= notes[n] * n; }
r = await owner('erpCashUp', [{ account: A.Cash, notes }]);
check('counted by notes, equal to the book: nothing to correct', r.ok && r.result.variance === 0 && !r.result.corrected && r.result.counted === cash, r.result);
r = await owner('erpCashUp', [{ account: A.Cash, counted: cash - 100 }]);
check('100 short needs a reason', !r.ok && /less than the book by 100/.test(r.error), r);
r = await owner('erpCashUp', [{ account: A.Cash, counted: cash - 100, note: 'change given twice' }]);
check('100 short with a reason: booked as a correction', r.ok && r.result.variance === -100 && r.result.corrected, r.result);
check('the book now equals the drawer', (await bal('Cash')) === cash - 100, await bal('Cash'));
check('the history keeps both counts, the last first, with the difference', r.result.history.length === 2 && r.result.history[0].variance === -100 && r.result.history[0].note === 'change given twice' && r.result.history[1].byNotes, r.result.history);
r = await owner('erpCashUp', [{ account: A.Cash }]);
check('nothing counted is refused', !r.ok, r);

// ---- the agent's advance
r = await owner('erpCashAccountSave', [{ name: 'Fast Cargo advance', kind: 'agent' }]);
check('an agent advance account', r.ok && r.result.accounts.some((a) => a.name === 'Fast Cargo advance' && a.kind === 'agent'), r.result && r.result.accounts);
const AG = r.result.accounts.find((a) => a.name === 'Fast Cargo advance').id;
const inHand0 = (await owner('erpCashBook', [{}])).result.inHand;
r = await owner('erpCashTransfer', [{ from: A.Cash, to: AG, amount: 300 }]);
check('300 advanced to the agent', r.ok && (await bal('Fast Cargo advance')) === 300, r);
check('...and it is no longer money in hand', (await owner('erpCashBook', [{}])).result.inHand === inHand0 - 300, 0);
r = await owner('erpReceiveShipment', [{ reference: 'AG-1', mode: 'bdt', totalBdt: 1000, shippingBdt: 200, shippingAccount: AG, lines: [{ sku: PLA, qty: 10 }] }]);
check('freight paid from the agent\'s advance', r.ok && (await bal('Fast Cargo advance')) === 100, await bal('Fast Cargo advance'));

// ---- asking prices
await sql`update products set brand = 'Sunlu', sell_price = 100 where business_id = ${B} and sku = ${PLA}`;
r = await sales('erpAskingPrices', [{ reference: 'AG-1' }]);
check('sales staff do not see landed costs', !r.ok, r);
r = await mgr('erpAskingPrices', [{ reference: 'AG-1' }]);
// landed 120 (1000 + 200 over 10) x 1.40 = 168 -> 170
check('usual markup 40%: 120 landed -> asks 170 (rounded up to 10)', r.ok && r.result.lines[0].landed === 120 && r.result.lines[0].asking === 170 && r.result.lines[0].now === 100, r.result.lines);
r = await mgr('erpAskingSave', [{ def: 30, brands: { Sunlu: 50 } }]);
check('only the owner sets markups', !r.ok, r);
r = await owner('erpAskingSave', [{ def: 30, brands: { sunlu: 50 }, reference: 'AG-1' }]);
check('Sunlu at 50%: 120 -> 180', r.ok && r.result.lines[0].markup === 50 && r.result.lines[0].asking === 180, r.result.lines);
r = await sales('erpAskingApply', [{ items: [{ sku: PLA, price: 180 }] }]);
check('sales staff cannot change prices', !r.ok, r);
r = await mgr('erpAskingApply', [{ items: [{ sku: PLA, price: 180 }] }]);
const sp = Number((await sql`select sell_price from products where business_id = ${B} and sku = ${PLA}`)[0].sell_price);
check('the ticked price is set', r.ok && r.result.changed === 1 && sp === 180, sp);

// ---- the other business is untouched
const other = await sql`select count(*)::int as n from cash_ups where business_id = ${FIX.B2}`;
check('no cash-ups in the other business', other[0].n === 0, other);

await done();
