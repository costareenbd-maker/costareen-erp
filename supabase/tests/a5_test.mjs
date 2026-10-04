// Plan A5: currencies with dated rates, a shipment in any currency, the other costs of a shipment, the price book in any currency.
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const PLA = 'FIL-SUN-PLA-BLA-001';
const costOf = async (sku) => (await owner('erpProduct', [sku])).result.cost_price;

// ---------------------------------------------------------------- currencies
let r = await sales('erpCurrencies', []);
check('currencies are for managers and up', !r.ok, r);
r = await mgr('erpCurrencies', []);
check('RMB and USD are offered before anything is saved', r.ok && r.result.currencies.some((c) => c.code === 'RMB') && r.result.currencies.some((c) => c.code === 'USD' && !c.saved) && !('accounts' in r.result), r.result);
r = await sales('erpCurrencySave', [{ code: 'USD', rate: 121 }]);
check('sales cannot set rates', !r.ok, r);
r = await shareholder('erpCurrencySave', [{ code: 'usd', rate: 0 }]);
check('a rate must be above 0', !r.ok && /What is 1 USD in taka/.test(r.error), r);
r = await shareholder('erpCurrencySave', [{ code: 'BDT', rate: 1 }]);
check('taka is not a foreign currency', !r.ok, r);
r = await shareholder('erpCurrencySave', [{ code: 'usd', rate: 121 }]);
check('USD at 121', r.ok && r.result.currencies.find((c) => c.code === 'USD').rate === 121 && r.result.currencies.find((c) => c.code === 'USD').history.length === 1, r.result);
r = await shareholder('erpCurrencySave', [{ code: 'USD', rate: 122.5 }]);
check('a new rate is added to the history, the old one kept', r.ok && r.result.currencies.find((c) => c.code === 'USD').rate === 122.5 && r.result.currencies.find((c) => c.code === 'USD').history.length === 2, r.result.currencies);
r = await shareholder('erpCurrencySave', [{ code: 'RMB', rate: 17 }]);
check('saving RMB keeps the old setting in step', r.ok && (await owner('erpCostBook', [])).result.rate === 17, r);

// ---------------------------------------------------------------- a shipment in dollars, with duty and an agent
const before = await costOf(PLA);
const sup = (await mgr('erpSuppliers', [])).result.suppliers[0].name;
r = await mgr('erpReceiveShipment', [{ reference: 'US-1', supplier: sup, mode: 'fx', currency: 'USD', totalFx: 100, rate: 9999, lines: [{ sku: PLA, qty: 10 }] }]);
check('a rate far from the usual one is refused', !r.ok && /looks wrong/.test(r.error) && /usual rate is 122.5/.test(r.error), r);
r = await mgr('erpReceiveShipment', [{ reference: 'US-1', supplier: sup, mode: 'fx', currency: 'USD', totalFx: 100, rate: 123, shippingBdt: 700,
  costs: [{ label: 'Customs duty', amount: 2000 }, { label: 'C&F agent', amount: 300 }, { label: '', amount: 0 }], lines: [{ sku: PLA, qty: 10 }] }]);
check('received in USD', r.ok && r.result.currency === 'USD' && r.result.totalCost === 12300 && r.result.shipping === 3000 && r.result.costs === 3, r.result);
check('unit cost = goods + freight + duty + agent, spread over the units', r.result.lines[0].unitCost === 1530, r.result.lines[0]);
r = await mgr('erpSupplierPage', [{ name: sup }]);
check('the supplier is owed the goods only, in dollars and taka', r.result.owed === 12300 && /USD 100 @ 123/.test(r.result.lines[0].fx), r.result.lines[0]);
const sc = await sql`select label, amount, account_id from shipment_costs where business_id = ${FIX.B} and reference = 'US-1' order by label`;
check('each other cost is written down', sc.length === 3 && sc.map((c) => c.label).join('|') === 'C&F agent|Customs duty|Freight' && Number(sc[1].amount) === 2000 && sc.every((c) => c.account_id === null), sc);
r = await mgr('erpReceiveShipment', [{ reference: 'US-2', mode: 'fx', currency: 'USD', totalFx: 10, rate: 123, costs: [{ label: '', amount: 50 }], lines: [{ sku: PLA, qty: 1 }] }]);
check('an extra cost needs a name', !r.ok && /Say what each extra cost was/.test(r.error), r);
r = await mgr('erpReceiveShipment', [{ reference: 'US-2', mode: 'fx', currency: 'USD', totalFx: 10, rate: 124, saveRate: true, lines: [{ sku: PLA, qty: 1 }] }]);
check('"make this my usual rate" works for any currency', r.ok && r.result.rateSaved && (await mgr('erpCurrencies', [])).result.currencies.find((c) => c.code === 'USD').rate === 124, r.result);

// ---------------------------------------------------------------- paid there and then, from named accounts
await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'BRAC Bank', kind: 'bank' }] }]);
const acc = (await owner('erpCashBook', [{}])).result.accounts;
const CASH = acc.find((a) => a.name === 'Cash').id, BANK = acc.find((a) => a.name === 'BRAC Bank').id;
const bal = async (id) => (await owner('erpCashBook', [{}])).result.accounts.find((a) => a.id === id).balance;
r = await shareholder('erpCurrencies', []);
check('those who see money are offered the accounts', r.ok && r.result.accounts.length === 2, r.result.accounts);
r = await shareholder('erpReceiveShipment', [{ reference: 'LOCAL-1', supplier: sup, mode: 'bdt', totalBdt: 5000, paidFrom: CASH, shippingBdt: 200, shippingAccount: CASH,
  costs: [{ label: 'Customs duty', amount: 1000, account: BANK }], lines: [{ sku: PLA, qty: 5 }] }]);
check('a local purchase paid on the spot', r.ok && r.result.paidNow === 5000 && r.result.billed, r.result);
check('cash paid the goods and the freight; the bank paid the duty', (await bal(CASH)) === -5200 && (await bal(BANK)) === -1000, [await bal(CASH), await bal(BANK)]);
r = await mgr('erpSupplierPage', [{ name: sup }]);
check('...so that shipment leaves nothing more owed', r.result.owed === 12300, r.result.owed);
r = await owner('erpCashBook', [{ account: BANK }]);
check('the bank statement says what it paid for', r.result.entries[0].what === 'Customs duty on a shipment' && r.result.entries[0].ref === 'LOCAL-1', r.result.entries[0]);
r = await mgr('erpReceiveShipment', [{ reference: 'LOCAL-2', supplier: sup, mode: 'bdt', totalBdt: 100, paidFrom: BANK, lines: [{ sku: PLA, qty: 1 }] }]);
check('someone who cannot see the accounts cannot pay from one', r.ok && r.result.paidNow === 0 && (await bal(BANK)) === -1000, r.result);

// ---------------------------------------------------------------- the price book in any currency
r = await owner('erpCostBook', []);
const row = r.result.rows.find((x) => x.category === 'Filaments');
check('price book rows carry an amount and its currency', r.ok && row && 'amount' in row && 'cur' in row && r.result.rates.USD === 124, row);
r = await shareholder('erpSaveCostRows', [{ rows: [{ category: row.category, brand: row.brand, type: row.type, amount: 5, cur: 'EUR' }] }]);
check('a currency with no rate is refused', !r.ok && /no rate for EUR/.test(r.error), r);
r = await shareholder('erpSaveCostRows', [{ rows: [{ category: row.category, brand: row.brand, type: row.type, amount: 5, cur: 'USD', handling: 30 }] }]);
const saved = r.result.rows.find((x) => x.category === row.category && x.brand === row.brand && x.type === row.type);
check('a row priced in dollars lands at amount x rate + handling', r.ok && saved.cur === 'USD' && saved.amount === 5 && saved.landed === 5 * 124 + 30 && saved.rmb === null && saved.bdt === null, saved);
await shareholder('erpCurrencySave', [{ code: 'USD', rate: 130 }]);
r = await owner('erpCostBook', []);
check('a new rate moves what the price book lands at', r.result.rows.find((x) => x.category === row.category && x.brand === row.brand && x.type === row.type).landed === 5 * 130 + 30, r.result.rows[0]);
r = await shareholder('erpSaveCostRows', [{ rows: [{ category: row.category, brand: row.brand, type: row.type, rmb: 40 }] }]);
const old = r.result.rows.find((x) => x.category === row.category && x.brand === row.brand && x.type === row.type);
check('the older way of saving (RMB column) still works', r.ok && old.cur === 'RMB' && old.amount === 40 && old.landed === 40 * 17 + 30, old);
const o2 = await sql`select count(*)::int n from currencies where business_id = ${FIX.B2}`;
check('another business has none of this', o2[0].n === 0);

await done();
