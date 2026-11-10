// crit7-trust (10 Nov 2026): money received but not yet in an account counts - Money in hand includes it (with how much
// of it is unplaced), the balance sheet shows it on its own row, and placing it moves it into the account without the
// totals changing (nothing counted twice). The joint line names its pool once.
// Run: sh local/onetest.sh supabase/tests/trustfinal_test.mjs
import { sql, FIX, owner, mgr, check, done } from './harness.mjs';

const PLA = 'FIL-SUN-PLA-BLA-001';
let r = await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash', opening: 5000 }, { name: 'Bank', kind: 'bank', opening: 10000 }] }]);
check('accounts set up', r.ok, r.error);
const A = {}; r.result.accounts.forEach((a) => { A[a.name] = a.id; });
const book = async () => (await owner('erpCashBook', [{}])).result;
const bs = async () => { const x = await owner('erpBalanceSheet', []); if (!x.ok) throw new Error(x.error); return x.result; };

let b0 = await bs(), k0 = await book();
check('nothing unplaced yet: no row, in hand = in the accounts', !b0.owns.some((o) => o.key === 'loose') && k0.inHand === k0.inAccounts && k0.looseTotal === 0, { owns: b0.owns, k0 });

// two payments by a method with no account (cheque): 400 + 700
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Trust Buyer', phone: '01922222222' }, items: [{ sku: PLA, qty: 2 }], payMode: 'none', paymentMethod: 'Bank Transfer' }]);
check('an invoice on credit', r.ok, r.error);
const INV = r.result.invoiceNo;
for (const amt of [400, 700]) { const p = await mgr('erpRecordPayment', [{ orderId: INV, amount: amt, method: 'Cheque' }]); check('cheque payment ' + amt + ' recorded', p.ok, p.error); }

let k1 = await book(), b1 = await bs();
const row1 = b1.owns.find((o) => o.key === 'loose');
check('the book: 2 unplaced, ৳1,100, counted in money in hand', k1.looseN === 2 && k1.looseTotal === 1100 && k1.inHand === k1.inAccounts + 1100, { looseN: k1.looseN, looseTotal: k1.looseTotal, inHand: k1.inHand, inAccounts: k1.inAccounts });
check('the balance sheet row: "Received, not yet in an account", 1,100, 2 payments, linked to placing', row1 && row1.amount === 1100 && row1.n === 2 && row1.go === 'place' && /^Received, not yet in an account$/.test(row1.what) && /^2 payments - put them in an account$/.test(row1.sub), row1);
check('net worth = owns - owes with the row in', b1.net === b1.ownsTotal - b1.owesTotal && b1.ownsTotal === b1.owns.reduce((t, o) => t + o.amount, 0), b1);
check('no "money with no account" reason any more (it is counted, not a difference)', !(b1.why || []).some((w) => /no account/i.test(w.what) && !/shipment|courier/i.test(w.what)), b1.why);

// the dashboard Money tiles read the same figure
r = await owner('erpFdHead', [{ view: 'cash' }]);
const tile = r.ok && (r.result.cards || []).find((c) => c.key === 'inHand');
check('Money in hand tile = the book, says how much is not yet placed', tile && tile.v === k1.inHand && /incl\. ৳1,100 not yet in an account/.test(tile.note), tile || r.error);

// place ONE payment in the bank: the row shrinks by it, the bank grows by it, totals unchanged
const one = k1.loose.find((p) => p.amount === 400);
r = await owner('erpCashPlaceMany', [{ account: A.Bank, items: [{ src: 'payment', id: one.id }] }]);
check('one payment placed', r.ok && r.result.placed === 1, r.error);
const k2 = await book(), b2 = await bs();
const row2 = b2.owns.find((o) => o.key === 'loose');
const bank = (b) => b.owns.find((o) => o.key === 'cash' && o.what === 'Bank').amount;
check('the row shrinks by 400 (1 payment left)', row2 && row2.amount === 700 && row2.n === 1 && /^1 payment - /.test(row2.sub), row2);
check('the bank grows by the same 400', bank(b2) - bank(b1) === 400, [bank(b1), bank(b2)]);
check('total owned and net worth unchanged (nothing counted twice)', b2.ownsTotal === b1.ownsTotal && b2.net === b1.net, [b1.ownsTotal, b2.ownsTotal]);
check('money in hand unchanged; in the accounts +400', k2.inHand === k1.inHand && k2.inAccounts === k1.inAccounts + 400 && k2.looseTotal === 700, [k1.inHand, k2.inHand, k2.inAccounts]);

// the last one: the row goes
r = await owner('erpCashPlaceMany', [{ account: A.Cash, items: [{ src: 'payment', id: k2.loose[0].id }] }]);
const b3 = await bs(), k3 = await book();
check('all placed: no row, totals still the same', r.ok && !b3.owns.some((o) => o.key === 'loose') && b3.ownsTotal === b1.ownsTotal && k3.inHand === k1.inHand && k3.looseTotal === 0, { owns: b3.owns, inHand: k3.inHand });

// an opening made now balances on the day; a later unplaced payment does not make a difference (it is counted)
r = await owner('erpBalanceOpen', [{}]);
check('books opened: difference 0', r.ok && Math.abs(r.result.difference) < 1, r.error || r.result);
await mgr('erpRecordPayment', [{ orderId: INV, amount: 300, method: 'Cheque' }]);
const b4 = await bs();
check('a new unplaced payment shows on its row', (b4.owns.find((o) => o.key === 'loose') || {}).amount === 300, b4.owns);

// an old opening (written before the row existed) is not thrown out by the newly counted money
const op = JSON.parse((await sql`select value from business_config where business_id = ${FIX.B} and key = 'balance_opening'`)[0].value);
await sql`update payments set paid_at = now() - interval '3 days' where business_id = ${FIX.B} and account_id is null and amount = 300`;
op.owns = (op.owns || []).filter((o) => o.key !== 'loose');
op.date = new Date(Date.now() - 864e5 + 6 * 3600e3).toISOString().slice(0, 10);
op.net = Math.round(op.net - 0);   // the old opening did not count the 300 that was then in no account
await sql`update business_config set value = ${JSON.stringify(op)} where business_id = ${FIX.B} and key = 'balance_opening'`;
const b5 = await bs();
check('old opening: the unplaced money from before it is added to the start (explain.looseAtOpening = 300)', b5.explain && b5.explain.looseAtOpening === 300, b5.explain);

check('a manager still cannot read the balance sheet', !(await mgr('erpBalanceSheet', [])).ok);
check('the other business is untouched', (await sql`select count(*)::int n from payments where business_id = ${FIX.B2} and account_id = ${A.Bank}`)[0].n === 0);
await done();
