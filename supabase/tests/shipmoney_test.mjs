// How a shipment's goods were paid (owner 17 Oct 2026): in advance (the normal case), now from an account, or later;
// and what was bought from each supplier from a set day on.
import { sql, FIX, owner, mgr, shareholder, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const PLA = 'FIL-SUN-PLA-BLA-001';
const SUP = 'Advance Traders';
await owner('erpSupplierSave', [{ name: SUP, country: 'China' }]);
await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Islami Bank', kind: 'bank' }] }]);
const acc = (await owner('erpCashBook', [{}])).result.accounts;
const CASH = acc.find((a) => a.name === 'Cash').id, BANK = acc.find((a) => a.name === 'Islami Bank').id;
const bal = async (id) => (await owner('erpCashBook', [{}])).result.accounts.find((a) => a.id === id).balance;
const owedTo = async () => (await owner('erpSupplierPage', [{ name: SUP }])).result.owed;
let today = '';

today = (await owner('erpSupplierPage', [{ name: SUP }])).result.today;
// ---- 1. paid in advance, recorded when it was sent: money left the bank, the supplier owes us goods
let r = await owner('erpSupplierPay', [{ name: SUP, amount: 10000, account: BANK, note: 'TT for the next order' }]);
check('an advance: the bank goes down, the supplier is "paid ahead"', r.ok && (await bal(BANK)) === -10000 && (await owedTo()) === -10000, r.error);
let s = (await owner('erpSuppliers', [])).result;
check('the suppliers list shows money paid for goods not received yet', s.aheadTotal === 10000, s.aheadTotal);

// the goods arrive: the bill uses the advance up, no new money moves
r = await owner('erpReceiveShipment', [{ reference: 'ADV-1', supplier: SUP, mode: 'bdt', totalBdt: 8000, payment: 'advance', lines: [{ sku: PLA, qty: 4 }] }]);
check('received against the advance', r.ok && r.result.advanceUsed === 8000 && r.result.advanceWritten === 0 && r.result.paidNow === 0, r.error || r.result);
check('no new money moved; 2,000 still paid ahead', (await bal(BANK)) === -10000 && (await owedTo()) === -2000, [await bal(BANK), await owedTo()]);

// ---- 2. the advance is bigger than what was paid ahead and nobody wrote it down: refused until we say where it came from
r = await owner('erpReceiveShipment', [{ reference: 'ADV-2', supplier: SUP, mode: 'bdt', totalBdt: 5000, payment: 'advance', lines: [{ sku: PLA, qty: 2 }] }]);
check('only 2,000 paid ahead for 5,000 of goods: asks for the account and day', !r.ok && /Only 2000 TK was paid ahead/.test(r.error), r.error);
check('...and nothing was received (one transaction)', (await sql`select count(*)::int n from supplier_bills where business_id = ${FIX.B} and reference = 'ADV-2'`)[0].n === 0);
r = await owner('erpReceiveShipment', [{ reference: 'ADV-2', supplier: SUP, mode: 'bdt', totalBdt: 5000, payment: 'advance', advanceFrom: CASH, advanceDate: '2099-01-01', lines: [{ sku: PLA, qty: 2 }] }]);
check('an advance cannot be dated in the future', !r.ok && /On which day/.test(r.error), r.error);
r = await owner('erpReceiveShipment', [{ reference: 'ADV-2', supplier: SUP, mode: 'bdt', totalBdt: 5000, payment: 'advance', advanceFrom: CASH, advanceDate: today, lines: [{ sku: PLA, qty: 2 }] }]);
check('the missing 3,000 of advance is written from Cash', r.ok && r.result.advanceWritten === 3000 && (await bal(CASH)) === -3000 && (await owedTo()) === 0, r.error || [await bal(CASH), await owedTo()]);
const note = (await sql`select note from supplier_payments where business_id = ${FIX.B} and supplier = ${SUP} order by created_at desc limit 1`)[0].note;
check('the written advance says what it was for', note === 'advance for ADV-2', note);

// ---- 3. paid now, and 4. pay later
r = await owner('erpReceiveShipment', [{ reference: 'NOW-1', supplier: SUP, mode: 'bdt', totalBdt: 1200, payment: 'now', paidFrom: CASH, lines: [{ sku: PLA, qty: 1 }] }]);
check('paid now from Cash', r.ok && r.result.paidNow === 1200 && (await bal(CASH)) === -4200 && (await owedTo()) === 0, r.error || r.result);
r = await owner('erpReceiveShipment', [{ reference: 'LATER-1', supplier: SUP, mode: 'bdt', totalBdt: 700, payment: 'later', shippingBdt: 100, shippingAccount: CASH, lines: [{ sku: PLA, qty: 1 }] }]);
check('pay later: owed to the supplier, no money moved for the goods', r.ok && r.result.paidNow === 0 && (await owedTo()) === 700 && (await bal(CASH)) === -4300, r.error || [await owedTo(), await bal(CASH)]);
r = await owner('erpReceiveShipment', [{ reference: 'X-1', mode: 'bdt', totalBdt: 700, payment: 'advance', lines: [{ sku: PLA, qty: 1 }] }]);
check('paid in advance needs a supplier', !r.ok && /Paid in advance to whom/.test(r.error), r.error);
r = await owner('erpReceiveShipment', [{ reference: 'OLD-1', supplier: SUP, mode: 'bdt', totalBdt: 300, paidFrom: BANK, lines: [{ sku: PLA, qty: 1 }] }]);
check('an older page (no payment field, an account named) still means paid now', r.ok && r.result.payment === 'now' && r.result.paidNow === 300, r.error || r.result);

// ---- 5. what was bought from the supplier since the day counting started
r = await owner('erpSupplierPage', [{ name: SUP }]);
const pu = r.result.purchases;
check('purchases since the start day: shipments, units, goods, other costs, total cost, paid', pu && pu.since === today && pu.shipments === 5 && pu.units === 9 &&
  pu.goods === 8000 + 5000 + 1200 + 700 + 300 && pu.extras === 100 && pu.landed === pu.goods + 100 && pu.paid === 10000 + 3000 + 1200 + 300, pu);
check('one line per shipment, newest first', pu.rows.length === 5 && pu.rows[0].ref === 'OLD-1' && pu.rows.find((x) => x.ref === 'LATER-1').extras === 100, pu.rows);
s = (await owner('erpSuppliers', [])).result;
check('the suppliers list shows goods bought since the day', s.since === today && s.suppliers.find((x) => x.name === SUP).boughtSince === 15200, s.suppliers.find((x) => x.name === SUP));
const cfg = await sql`select value from business_config where business_id = ${FIX.B} and key = 'supplier_totals_from'`;
check('the start day is kept for the business', cfg.length === 1 && String(cfg[0].value) === today, cfg);
const other = await sql`select count(*)::int n from supplier_bills where business_id = ${FIX.B2}`;
check('another business has none of this', other[0].n === 0);
// ---- 6. an order (shipment) created on the day it is PAID, with the PI; the goods come later
const SUP2 = 'PI Supplier';
await owner('erpSupplierSave', [{ name: SUP2, country: 'China' }]);
r = await mgr('erpPoCreate', [{ supplier: SUP2, shipBy: 'Sea', rate: 17, lines: [{ sku: PLA, qty: 10, rmbUnit: 50 }], paid: { amount: 8500, account: BANK, date: today, pi: 'PI-2026-77' } }]);
check('a manager cannot record the money (owner or shareholder only)', !r.ok && /Only the owner or a shareholder/.test(r.error), r.error);
const bank0 = await bal(BANK);
r = await owner('erpPoCreate', [{ supplier: SUP2, shipBy: 'Sea', rate: 17, lines: [{ sku: PLA, qty: 10, rmbUnit: 50 }], paid: { amount: 8500, account: BANK, date: today, pi: 'PI-2026-77' } }]);
const PO = r.result && r.result.poId;
check('the order is created with its payment: the bank goes down, the supplier is paid ahead', r.ok && r.result.paid === 8500 && (await bal(BANK)) === bank0 - 8500 &&
  (await owner('erpSupplierPage', [{ name: SUP2 }])).result.owed === -8500, r.error || r.result);
let pl = (await owner('erpPoList', [])).result;
let o = pl.orders.find((x) => x.id === PO);
check('the order shows what was paid, and the PI in its note', o && o.paid === 8500 && /PI PI-2026-77/.test(o.note) && pl.accounts.length === 2, o);
check('a manager sees the order but not the money', (await mgr('erpPoList', [])).result.orders.find((x) => x.id === PO).paid === 0);
r = await owner('erpPoPay', [{ po: PO, amount: 500, account: CASH, date: today }]);
check('paying more before the goods come', r.ok && r.result.paid === 9000, r.error || r.result);
r = await owner('erpPoPay', [{ po: 'PO-NOPE', amount: 5, account: CASH }]);
check('an unknown order is refused', !r.ok, r.ok);
// the goods arrive: billed at 10 x 50 x 17 = 8,500; 9,000 was paid -> 500 still paid ahead, no money moved on arrival
const cash0 = await bal(CASH), bank1 = await bal(BANK);
r = await mgr('erpPoArrive', [{ poId: PO, lines: [{ sku: PLA, qty: 10 }], shipment: { date: today } }]);
check('arrival uses what was paid: 500 still ahead, no money moved', r.ok && (await owner('erpSupplierPage', [{ name: SUP2 }])).result.owed === -500 &&
  (await bal(CASH)) === cash0 && (await bal(BANK)) === bank1, r.error || (await owner('erpSupplierPage', [{ name: SUP2 }])).result.owed);

await done();
