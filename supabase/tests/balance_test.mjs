// The balance sheet (owner 17 Oct 2026): owns - owes = net worth; after the books are opened, net worth must equal the
// opening + profit since + capital in - capital out. A shipment entered properly never makes a difference.
import { sql, FIX, owner, mgr, shareholder, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const PLA = 'FIL-SUN-PLA-BLA-001';
const SUP = 'Balance Supplier';
await owner('erpSupplierSave', [{ name: SUP }]);
await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash', opening: 100000 }, { name: 'Bank', kind: 'bank', opening: 50000 }] }]);
const acc = (await owner('erpCashBook', [{}])).result.accounts;
const CASH = acc.find((a) => a.name === 'Cash').id, BANK = acc.find((a) => a.name === 'Bank').id;
const bs = async () => { const r = await owner('erpBalanceSheet', []); if (!r.ok) throw new Error(r.error); return r.result; };

let r = await mgr('erpBalanceSheet', []);
check('a manager does not see the balance sheet', !r.ok, r.ok);
let b = await bs();
check('before opening: owns, owes, net worth, not opened', !b.opened && b.net === b.ownsTotal - b.owesTotal && b.owns.some((x) => x.key === 'stock') && b.canOpen, b);
r = await shareholder('erpBalanceOpen', [{}]);
check('only the owner opens the books', !r.ok, r.ok);
r = await owner('erpBalanceOpen', [{ note: 'start' }]);
b = r.result;
check('opened: the difference is 0 on the day', r.ok && b.opened && Math.abs(b.difference) < 1 && b.opening.net === b.net, r.error || b);
const net0 = b.net;

// 1. pay the supplier in advance: money becomes "paid to suppliers"; net worth unchanged
await owner('erpSupplierPay', [{ name: SUP, amount: 20000, account: BANK }]);
b = await bs();
check('an advance moves money, net worth is the same', b.net === net0 && Math.abs(b.difference) < 1 && b.owns.find((x) => x.key === 'ahead').amount === 20000, b);
// 2. the goods arrive against the advance: "paid ahead" becomes stock
r = await owner('erpReceiveShipment', [{ reference: 'BS-1', supplier: SUP, mode: 'bdt', totalBdt: 20000, payment: 'advance', shippingBdt: 1000, shippingAccount: CASH, lines: [{ sku: PLA, qty: 10 }] }]);
b = await bs();
check('received: stock up, advance gone, freight paid from cash - still balances', r.ok && b.owns.find((x) => x.key === 'ahead').amount === 0 && Math.abs(b.difference) < 1, r.error || b);
// 3. pay later: stock up, owed to the supplier up - still balances
await owner('erpReceiveShipment', [{ reference: 'BS-2', supplier: SUP, mode: 'bdt', totalBdt: 3000, payment: 'later', lines: [{ sku: PLA, qty: 2 }] }]);
b = await bs();
check('pay later: owed to suppliers 3,000, still balances', b.owes.find((x) => x.key === 'suppliers').amount === 3000 && Math.abs(b.difference) < 1, b);
// 4. a freight cost nobody said who paid: stock up, no money down -> a difference, and the reason is listed
await owner('erpReceiveShipment', [{ reference: 'BS-3', supplier: SUP, mode: 'bdt', totalBdt: 500, payment: 'now', paidFrom: CASH, shippingBdt: 400, lines: [{ sku: PLA, qty: 1 }] }]);
b = await bs();
check('a freight with no account shows as a difference of 400 with its reason', Math.round(b.difference) === 400 && b.why.some((w) => /shipment costs with no account/.test(w.what) && w.amount === 400), b.difference + ' ' + JSON.stringify(b.why));

// 5. money in from an investor: cash up, explained by "money put in"
await owner('erpCapitalHolderSave', [{ name: 'Investor A', kind: 'investor', returnKind: 'none' }]);
const h = (await owner('erpCapital', [])).result.holders.find((x) => x.name === 'Investor A');
r = await owner('erpCapitalEntryAdd', [{ holder: h && h.id, type: 'invest', amount: 15000, account: BANK }]);
b = await bs();
check('an investor’s money is explained, the difference stays 400', r.ok && b.explain.invest === 15000 && Math.round(b.difference) === 400, r.error || b);
check('another business is untouched', (await sql`select count(*)::int n from business_config where business_id = ${FIX.B2} and key = 'balance_opening'`)[0].n === 0);
await done();
