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

done();
