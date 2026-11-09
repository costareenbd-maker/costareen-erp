// crit5-books (10 Nov 2026): erpPayMethods - every member (sales too) can read where each payment method lands, so the
// sale / payment forms can say "Nagad · no account yet" before the money is taken. Same resolution as the server's
// accountForMethod: the owner's rule, then the same-name open account, else none. Ids + names only, no balances.
// Run: sh local/onetest.sh supabase/tests/booksfinal_test.mjs
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
let r;

// before any account: every method resolves to none, the call still answers (staff too)
r = await sales('erpPayMethods', [{}]);
check('sales can read the methods with no accounts yet', r.ok && Array.isArray(r.result.methods) && r.result.methods.length > 0, r);
check('...none has an account', r.ok && r.result.methods.every((m) => !m.account), r.ok ? r.result.methods : r);
check('...sales cannot add an account', r.ok && r.result.canAdd === false, r.ok ? r.result : r);

for (const a of [['Cash', 'cash'], ['bKash', 'wallet'], ['City Bank', 'bank']]) {
  r = await owner('erpCashAccountSave', [{ name: a[0], kind: a[1] }]);
  check('account ' + a[0] + ' made', r.ok, r);
}
const A = {};
(await sql`select id, name from money_accounts where business_id = ${B}`).forEach((a) => { A[a.name] = a.id; });

r = await sales('erpPayMethods', [{ methods: ['Cash', 'BKASH', 'Nagad', 'COD (Steadfast)', 'Adjusted', 'x'.repeat(200)] }]);
check('sales reads the methods', r.ok, r);
const by = {};
(r.ok ? r.result.methods : []).forEach((m) => { by[m.method.toLowerCase()] = m; });
check('Cash -> the Cash account by name', by.cash && by.cash.account === A.Cash && by.cash.accountName === 'Cash', by.cash);
check('BKASH -> the bKash account (any spelling)', by.bkash && by.bkash.account === A.bKash, by.bkash);
check('Nagad -> no account', by.nagad && by.nagad.account === '' && !by.nagad.courier, by.nagad);
check('COD (Steadfast) -> no account, marked courier', by['cod (steadfast)'] && by['cod (steadfast)'].courier === true && !by['cod (steadfast)'].account, by['cod (steadfast)']);
check('Adjusted is not money', by.adjusted && by.adjusted.notMoney === true && !by.adjusted.account, by.adjusted);
check('a long name is cut to 60', r.ok && r.result.methods.every((m) => m.method.length <= 60), r.ok ? r.result.methods.map((m) => m.method.length) : r);
check('no balance is handed to staff', r.ok && !JSON.stringify(r.result).includes('balance'), r.ok ? r.result : r);

// the owner's rule wins over the name
r = await owner('erpCashMapSave', [{ map: { cash: A['City Bank'] } }]);
check('owner says Cash lands in City Bank', r.ok, r);
r = await mgr('erpPayMethods', [{ methods: ['Cash'] }]);
const cash2 = r.ok ? r.result.methods.find((m) => m.method === 'Cash') : null;
check('...the methods list follows the rule', cash2 && cash2.account === A['City Bank'] && cash2.accountName === 'City Bank', cash2);

// a rule pointing at an archived account: shown as no account (the money would be lost otherwise)
await sql`update money_accounts set archived = true where id = ${A['City Bank']}`;
r = await mgr('erpPayMethods', [{ methods: ['Cash'] }]);
const cash3 = r.ok ? r.result.methods.find((m) => m.method === 'Cash') : null;
check('a rule to a retired account is skipped: Cash falls back to the Cash account by name', cash3 && cash3.account === A.Cash, cash3);
// and the real write follows the same rule (a retired account takes no new money)
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status)
          values (${B}, 'BF-PLA', 'Books final PLA', 'Filaments', 'Test', 'PLA', 0, 1000, 'Active')`;
r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-BF', supplier: 'Dragon', mode: 'bdt', totalBdt: 5000, lines: [{ sku: 'BF-PLA', qty: 10 }] }]);
check('10 PLA received', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim Store', phone: '01811111111' }, items: [{ sku: 'BF-PLA', qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('a Cash sale while the rule points at the retired City Bank', r.ok, r);
const pay = r.ok ? await sql`select account_id from payments where business_id = ${B} and invoice_no = ${r.result.invoiceNo}` : [];
check('...the money lands in the open Cash account, not the retired one', pay.length === 1 && pay[0].account_id === A.Cash, pay);
// only one account left and it is retired: no account at all (the owner sees it under "no account")
await sql`update money_accounts set archived = true where business_id = ${B}`;
r = await sales('erpPayMethods', [{ methods: ['Cash'] }]);
check('every account retired: Cash has no account', r.ok && r.result.methods[0].account === '' && r.result.accounts === 0, r.ok ? r.result : r);
await sql`update money_accounts set archived = false where business_id = ${B}`;

r = await owner('erpPayMethods', [{}]);
check('the owner can add an account', r.ok && r.result.canAdd === true, r.ok ? r.result : r);

// the other business sees only its own accounts
r = await sql`select count(*)::int as n from money_accounts where business_id = ${FIX.B2}`;
check('other business has no accounts made here', r[0].n === 0, r);

await done();
