// fix-6 (27 Oct 2026): a manager receiving a priced shipment was always refused ("Only 0 TK was paid ahead ...")
// because the page sent its default "paid in advance" while a manager may not see the money accounts.
import { sql, FIX, owner, mgr, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const PLA = 'FIL-SUN-PLA-BLA-001';
const SUP = 'Local Dealer';

// the manager's page sends what the live page sent on 26-27 Oct 2026
let r = await mgr('erpReceiveShipment', [{ reference: 'LOC-1', supplier: SUP, mode: 'bdt', totalBdt: 74380, payment: 'advance', advanceFrom: '', advanceDate: '',
  lines: [{ sku: PLA, qty: 10 }] }]);
check('(fix-6) a manager receives a priced local shipment', r.ok && r.result.billed === true && r.result.payment === 'later' && /owed to the supplier/.test(r.result.paymentNote), r);
r = await mgr('erpSupplierPage', [{ name: SUP }]);
check('(fix-6) the goods are owed to the supplier, nothing invented as paid', r.ok && r.result.owed === 74380, r.result);
const paid = await sql`select count(*)::int n from supplier_payments where business_id = ${FIX.B} and lower(supplier) = 'local dealer'`;
check('(fix-6) no payment row was written by the manager', paid[0].n === 0, paid);

// "paid now" from a manager is the same: owed, the owner records the money
r = await mgr('erpReceiveShipment', [{ reference: 'LOC-2', supplier: SUP, mode: 'bdt', totalBdt: 1000, payment: 'now', paidFrom: 'any-id', lines: [{ sku: PLA, qty: 1 }] }]);
check('(fix-6) "paid now" from a manager becomes owed', r.ok && r.result.payment === 'later' && r.result.paidNow === 0, r);

// the owner is still asked, since he can answer
r = await owner('erpReceiveShipment', [{ reference: 'LOC-3', supplier: SUP, mode: 'bdt', totalBdt: 500, payment: 'advance', lines: [{ sku: PLA, qty: 1 }] }]);
check('(fix-6) the owner choosing "advance" with no advance recorded is still asked', !r.ok && /paid ahead/.test(r.error), r);
r = await owner('erpReceiveShipment', [{ reference: 'LOC-3', supplier: SUP, mode: 'bdt', totalBdt: 500, payment: 'later', lines: [{ sku: PLA, qty: 1 }] }]);
check('(fix-6) the owner choosing "not paid yet" goes through', r.ok && r.result.payment === 'later', r);

// ---- fix-7: the "every action, like the owner" switch reaches the money rows (147_act_money_rls.sql)
r = await mgr('erpMoney', [{}]);
check('(fix-7) a refusal says what and whom to ask', !r.ok && /does not have permission/.test(r.error) && /ask the owner/.test(r.error), r);
r = await owner('erpUserPowers', [{ userId: FIX.U.mgr, powers: { act: true } }]);
check('(fix-7) owner switches "every action" on for the manager', r.ok, r.error);
r = await owner('erpCashSetup', [{ accounts: [{ name: 'Cash drawer', kind: 'cash' }] }]);
const ACC = ((await owner('erpCashBook', [{}])).result.accounts.find((a) => a.name === 'Cash drawer') || {}).id;
check('(fix-7) owner makes an account', r.ok && ACC, r);
r = await mgr('erpCurrencies', []);
check('(fix-7) acting manager sees the account NAMES on the receive screen', r.ok && (r.result.accounts || []).some((a) => a.id === ACC), r.ok ? r.result.accounts : r.error);
r = await mgr('erpSupplierPage', [{ name: SUP }]);
check('(fix-7) supplier page offers him the accounts to pay from', r.ok && r.result.canPay && r.result.accounts.some((a) => a.id === ACC), r.ok ? r.result.accounts : r.error);
r = await mgr('erpSupplierPay', [{ name: SUP, amount: 380, account: ACC }]);
check('(fix-7) acting manager pays a supplier from an account', r.ok, r);
r = await mgr('erpReceiveShipment', [{ reference: 'LOC-4', supplier: SUP, mode: 'bdt', totalBdt: 2000, payment: 'now', paidFrom: ACC, lines: [{ sku: PLA, qty: 2 }] }]);
check('(fix-7) acting manager receives "paid now from Cash drawer"', r.ok && r.result.payment === 'now' && r.result.paidNow === 2000, r);
r = await mgr('erpReceiveShipment', [{ reference: 'LOC-5', supplier: SUP, mode: 'bdt', totalBdt: 300, payment: 'advance', advanceFrom: ACC, advanceDate: '2026-01-05', lines: [{ sku: PLA, qty: 1 }] }]);
check('(fix-7) acting manager writes an advance that was never recorded', r.ok && r.result.payment === 'advance' && r.result.advanceWritten === 300, r);
r = await mgr('erpMoney', [{}]);
check('(fix-7) the balances stay closed to him', !r.ok && /does not have permission/.test(r.error), r.ok ? 'opened!' : r.error);
r = await mgr('erpCashBook', [{}]);
check('(fix-7) the cash book too', !r.ok, r.ok ? 'opened!' : r.error);
r = await mgr('erpDashboardData', [{}]);
check('(fix-7) and the dashboard', !r.ok, r.ok ? 'opened!' : r.error);

done();
