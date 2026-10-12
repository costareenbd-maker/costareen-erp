// FilaDash merge P3: investors per shipment (109_lot_investors.sql, handlers/returns.js, handlers/lots.js).
// Run: TEST_SCRIPT=lotinvest_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status)
          values (${B}, 'LI-1', 'Lot investor PLA', 'Filaments', 'Test', 'PLA', 0, 250, 'Active')`;
let r = await mgr('erpReceiveShipment', [{ reference: 'SHIP-L', supplier: 'Dragon', mode: 'bdt', totalBdt: 1000, lines: [{ sku: 'LI-1', qty: 10 }] }]);
check('shipment of 10 at 100 each', r.ok, r);
const month = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
const pnlExp = async () => (await owner('erpPnl', [{ months: 1 }])).result.months.find((x) => x.month === month).expenses;
const expBefore = await pnlExp();

// ---- the investor: paid by the profit on what they fund
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Lot Investor', returnKind: 'lot', returnValue: 50, invested: 600 }]);
check('an investor paid by shipment profit (50% of it)', r.ok, r);
const H = (await sql`select holder_no from capital_holders where business_id = ${B} and name = 'Lot Investor'`)[0].holder_no;
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Too Greedy', returnKind: 'lot', returnValue: 150 }]);
check('more than 100% of the profit is refused', !r.ok, r);
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Monthly Man', returnKind: 'percent', returnValue: 2 }]);
const M = (await sql`select holder_no from capital_holders where business_id = ${B} and name = 'Monthly Man'`)[0].holder_no;

// ---- funding a shipment
r = await mgr('erpLotFund', [{ holder: H, reference: 'SHIP-L', pct: 60 }]);
check('only the owner records funding', !r.ok, r);
r = await owner('erpLotFund', [{ holder: M, reference: 'SHIP-L', pct: 10 }]);
check('a monthly investor cannot fund by shipment', !r.ok && /not paid by shipment profit/.test(r.error), r);
r = await owner('erpLotFund', [{ holder: H, reference: 'NO-SUCH', pct: 10 }]);
check('an unknown shipment is refused', !r.ok && /No shipment/.test(r.error), r);
r = await owner('erpLotFund', [{ holder: H, reference: 'SHIP-L', pct: 60 }]);
check('60% of SHIP-L funded', r.ok && r.result.funding.length === 1 && r.result.funding[0].funded === 600, r.result);
r = await owner('erpLotFund', [{ holder: H, reference: 'SHIP-L', pct: 50 }]);
check('more than 100% of a shipment is refused', !r.ok && /at most 40% is free/.test(r.error), r);

// ---- sales from that shipment earn the investor their share
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'LI-1', qty: 4 }], payMode: 'full' }]);
check('4 sold at 250', r.ok, r);
const INV = r.result.invoiceNo;
// profit 4 x (250 - 100) = 600; their 60% = 360; they get 50% of it = 180
let cap = (await owner('erpCapital', [])).result.holders.find((h) => h.id === H);
check('the investor\'s return this month is building: 4 x 150 x 60% x 50% = 180', cap.returnBuilding === 180, cap);
check('...and it is a cost of this month (P&L investor returns)', (await pnlExp()) - expBefore === 180, [await pnlExp(), expBefore]);
r = await owner('erpLotFunding', [{ reference: 'SHIP-L' }]);
let f = r.result.funding[0];
check('the funding: 2.4 units of theirs sold, 240 of their money recovered, 360 profit on their part, 180 earned', f.soldUnits === 2.4 && f.recovered === 240 && f.profit === 360 && f.earned === 180, f);

// ---- a return takes it back
r = await owner('erpReturnGoods', [{ invoiceNo: INV, lines: [{ sku: 'LI-1', qty: 1, condition: 'good' }], money: 'refund', method: 'Cash', reason: 'one too many' }]);
cap = (await owner('erpCapital', [])).result.holders.find((h) => h.id === H);
check('one returned: 3 x 150 x 60% x 50% = 135', r.ok && cap.returnBuilding === 135, cap);

// ---- who sees it
r = await mgr('erpLotFunding', [{}]);
check('a manager does not see investors', !r.ok, r);

// ---- struck out
const fid = (await owner('erpLotFunding', [{}])).result.funding[0].id;
r = await owner('erpLotFundVoid', [{ id: fid }]);
check('striking out needs a reason', !r.ok, r);
r = await owner('erpLotFundVoid', [{ id: fid, reason: 'typed the wrong shipment' }]);
cap = (await owner('erpCapital', [])).result.holders.find((h) => h.id === H);
check('struck out: nothing earned, nothing building', r.ok && r.result.funding.length === 0 && !cap.returnBuilding, cap);
check('the cost of the month is back where it was', (await pnlExp()) === expBefore, await pnlExp());

// ---- the other business is untouched
const other = await sql`select count(*)::int as n from lot_funding where business_id = ${FIX.B2}`;
check('no funding in the other business', other[0].n === 0, other);

await done();
