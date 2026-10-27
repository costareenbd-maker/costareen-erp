// Plan A4: suppliers as records, and what is owed to them.
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const PLA = 'FIL-SUN-PLA-BLA-001';

let r = await sales('erpSuppliers', []);
check('suppliers are for managers and up', !r.ok, r);
r = await mgr('erpSuppliers', []);
const names = r.result.suppliers.map((s) => s.name);
check('names from the old list are already here, nothing owed', r.ok && names.length > 0 && r.result.suppliers.every((s) => s.owed === 0 && !s.hasRecord) && r.result.owedTotal === 0, r.result);
const SUP = names[0];

// ---- a shipment received from a supplier is a bill for the goods, not the freight
r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-9', supplier: SUP, mode: 'rmb', totalRmb: 1000, rate: 17, shippingBdt: 800, lines: [{ sku: PLA, qty: 10 }] }]);
check('shipment received and billed', r.ok && r.result.billed === true, r.result);
r = await mgr('erpSupplierPage', [{ name: SUP.toUpperCase() }]);
const P = r.result;
check('the supplier is owed the goods (17,000), freight left out', r.ok && P.owed === 17000 && P.lines.length === 1 && P.lines[0].what === 'Goods received' &&
  P.lines[0].ref === 'SHIP-9' && /RMB 1,000 @ 17/.test(P.lines[0].fx), P);
r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-10', mode: 'bdt', totalBdt: 500, lines: [{ sku: PLA, qty: 1 }] }]);
check('a shipment with no supplier named bills nobody', r.ok && r.result.billed === false, r.result);

// ---- details, and what was owed at the start
r = await mgr('erpSupplierSave', [{ name: SUP, phone: '+86 138 0000', country: 'China', currency: 'rmb', openingOwed: 5000 }]);
check('a manager cannot set what was owed at the start', !r.ok, r);
r = await shareholder('erpSupplierSave', [{ name: SUP, phone: '+86 138 0000', country: 'China', currency: 'rmb', openingOwed: 5000 }]);
check('details saved, opening balance counted', r.ok && r.result.owed === 22000 && r.result.currency === 'RMB' && r.result.hasRecord && r.result.lines[r.result.lines.length - 1].kind === 'opening', r.result);

// ---- paying
r = await mgr('erpSupplierPay', [{ name: SUP, amount: 1000 }]);
check('a manager cannot pay a supplier', !r.ok, r);
r = await shareholder('erpSupplierPay', [{ name: SUP, amount: 0 }]);
check('payment needs an amount', !r.ok && /How much was paid/.test(r.error), r);
r = await shareholder('erpSupplierPay', [{ name: SUP, amount: 12000, fxAmount: 700, fxCurrency: 'rmb', note: 'through agent Karim' }]);
check('with no money accounts yet a payment is still recorded', r.ok && r.result.owed === 10000 && r.result.lines[0].kind === 'payment' && r.result.lines[0].amount === -12000 &&
  r.result.lines[0].after === 10000 && /RMB 700/.test(r.result.lines[0].fx), r.result && r.result.lines[0]);
await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Islami Bank', kind: 'bank' }] }]);
const acc = (await owner('erpCashBook', [{}])).result.accounts;
const BANK = acc.find((a) => a.name === 'Islami Bank').id;
const bankBal = async () => (await owner('erpCashBook', [{}])).result.accounts.find((a) => a.id === BANK).balance;
r = await shareholder('erpSupplierPay', [{ name: SUP, amount: 4000 }]);
check('once accounts exist, a payment must name one', !r.ok && /Choose the account/.test(r.error), r);
r = await shareholder('erpSupplierPay', [{ name: SUP, amount: 4000, account: BANK }]);
check('paid from the bank: owed falls, the bank falls', r.ok && r.result.owed === 6000 && (await bankBal()) === -4000, r.result && r.result.owed);
r = await owner('erpCashBook', [{ account: BANK }]);
check('the bank statement names the supplier', r.result.entries[0].what === 'Paid to supplier ' + SUP && r.result.entries[0].amount === -4000, r.result.entries[0]);
r = await shareholder('erpSupplierPay', [{ name: SUP, amount: 9000, account: BANK }]);
check('paying more than is owed is an advance', r.ok && r.result.owed === -3000, r.result && r.result.owed);
r = await mgr('erpSuppliers', []);
const row = r.result.suppliers.find((s) => s.name === SUP);
check('the list shows who is owed and who is paid ahead', row.owed === -3000 && r.result.aheadTotal === 3000 && r.result.owedTotal === 0 && row.billed === 17000 && row.paid === 25000, r.result);

// ---- a bill typed in, and striking out
r = await shareholder('erpSupplierBill', [{ name: SUP, amount: 8000, reference: 'INV-7781', note: 'spare nozzles, sent by post' }]);
check('a bill typed by hand', r.ok && r.result.owed === 5000 && r.result.lines[0].what === 'Bill', r.result && r.result.lines[0]);
const bill = r.result.lines[0], pay = r.result.lines.find((l) => l.kind === 'payment' && l.amount === -9000);
r = await mgr('erpSupplierVoid', [{ kind: 'bill', id: bill.id, reason: 'x' }]);
check('a manager cannot strike out', !r.ok, r);
r = await owner('erpSupplierVoid', [{ kind: 'bill', id: bill.id, reason: '' }]);
check('striking out needs a reason', !r.ok, r);
r = await owner('erpSupplierVoid', [{ kind: 'bill', id: bill.id, reason: 'entered twice' }]);
check('a struck-out bill no longer counts, and stays readable', r.ok && r.result.owed === -3000 && /struck out/.test(r.result.lines.find((l) => l.id === bill.id).voided), r.result);
r = await owner('erpSupplierVoid', [{ kind: 'payment', id: pay.id, reason: 'bank returned it' }]);
check('a struck-out payment gives the money back to the bank', r.ok && r.result.owed === 6000 && (await bankBal()) === -4000, r.result && r.result.owed);

// ---- a rename follows through
r = await shareholder('erpSupplierSave', [{ name: SUP, rename: 'Sunlu Shenzhen Ltd', phone: '+86 138 0000', country: 'China', currency: 'RMB', openingOwed: 5000 }]);
check('renamed: the account comes along', r.ok && r.result.name === 'Sunlu Shenzhen Ltd' && r.result.owed === 6000 && r.result.lines.length >= 4, r.result);
r = await mgr('erpSuppliers', []);
check('the old name is gone from the list', !r.result.suppliers.some((s) => s.name === SUP) && r.result.suppliers.some((s) => s.name === 'Sunlu Shenzhen Ltd'), r.result.suppliers.map((s) => s.name));
const mv = await sql`select count(*)::int n from stock_movements where business_id = ${FIX.B} and supplier = 'Sunlu Shenzhen Ltd'`;
check('stock movements carry the new name', mv[0].n >= 1, mv);
r = await shareholder('erpSupplierSave', [{ name: 'Brand New Supplier', country: 'BD', currency: 'BDT' }]);
check('a new supplier joins the list the product form offers', r.ok && r.result.name === 'Brand New Supplier' && r.result.owed === 0 &&
  (await owner('erpSettingsFull', [])).result.lists.suppliers.includes('Brand New Supplier'), r.result);
const other = await sql`select count(*)::int n from supplier_bills where business_id = ${FIX.B2}`;
check('another business has none of this', other[0].n === 0);

await done();
