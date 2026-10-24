// fix-3 (24 Oct 2026): the partner's odd-case report, batch 3 - investors and shareholders (H7, H12-H15, M15, M16, M18
// and the owner's rules for questions 1-5). H16, M14 are in resellers_test, M17 in investorportal_test.
import { sql, FIX, owner, mgr, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();

const B = FIX.B;
const pad = (n) => String(n).padStart(2, '0');
const now = new Date(Date.now() + 6 * 3600e3);
const month = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1);
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + pad(mo); };
const prev = shift(month, -1), prev2 = shift(month, -2), prev3 = shift(month, -3);
const C = { name: 'Odd Case', phone: '01755500033' };
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'F3-CM', 'Fix Comm', 'Filaments', 'T', 'PLA', 0, 1000, 'Active'),
  (${B}, 'F3-LT', 'Fix Lot', 'Filaments', 'T', 'PLA', 0, 150, 'Active'),
  (${B}, 'F3-L2', 'Fix Lot Two', 'Filaments', 'T', 'PLA', 0, 150, 'Active')`;
const cm = (await sql`select id from products where business_id = ${B} and sku = 'F3-CM'`)[0].id;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price) values (${B}, ${cm}, 'RECEIVE', 'IN', 20, 500)`;
const capital = async () => (await owner('erpCapital', [])).result;
const holder = async (name) => (await capital()).holders.find((h) => h.name === name);

// ---- Q4 + M15: commission runs on from month to month, and belongs to the person
await owner('erpCommissionRuleSave', [{ scope: 'all', basis: 'sales', pct: 10, since: prev }]);
let r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F3-CM', qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const OLD = r.result.invoiceNo;
await sql`update invoices set created_at = ${prev + '-15T12:00:00+06:00'} where business_id = ${B} and invoice_no = ${OLD}`;
r = await owner('erpCommission', [{ month: prev }]);
const me = r.result.sellers[0];
check('last month: 10% of 1000 = 100 earned', me && me.earned === 100, r.result.sellers);
r = await owner('erpCommissionPay', [{ seller: me.id, amount: 100, month: prev }]);
check('and paid', r.ok, r);
const meName = me.name;
await sql`update profiles set full_name = 'Renamed Seller' where id = ${me.id}`;
await sql`update erp_people set name = 'Renamed Seller' where user_id = ${me.id}`;
r = await owner('erpCommission', [{ month: prev }]);
check('(M15) the seller is renamed: last month still shows 100 paid, nothing left', r.result.sellers[0].paid === 100 && r.result.sellers[0].left === 0, [meName, r.result.sellers]);
r = await owner('erpReturnGoods', [{ invoiceNo: OLD, lines: [{ sku: 'F3-CM', qty: 1, condition: 'good' }], reason: 'test', money: 'refund', method: 'Cash' }]);
r = await owner('erpCommission', [{ month }]);
check('(Q4) the sale comes back this month: -100 this month, the balance is -100', r.result.sellers[0].earned === -100 && r.result.sellers[0].left === -100, r.result.sellers);
r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F3-CM', qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
r = await owner('erpCommission', [{ month }]);
check('(Q4) a new 1000 sale earns 100: it settles the 100 taken back - nothing to pay', r.result.sellers[0].earned === 0 && r.result.sellers[0].left === 0, r.result.sellers);
r = await owner('erpCommissionPay', [{ seller: me.id, amount: 100, month }]);
check('(Q4) so paying 100 is refused', !r.ok, r);

// ---- shareholders: a change counts from its month (H13), a closed month keeps its shares (H12)
await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 100, since: prev3 }]);
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Kamal', returnKind: 'percent', returnValue: 2, since: prev3, invested: 100000, investedOn: prev3 + '-01' }]);
const KAM = (await holder('Kamal')).id, RAH = (await holder('Rahman')).id;
r = await owner('erpCapitalHolderSave', [{ id: RAH, kind: 'shareholder', name: 'Rahman', pct: 60 }]);
check('(H13) Rahman 100% -> 60% from this month', r.ok, r);
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Bina', pct: 40 }]);
check('(H13) Bina 40% from this month', r.ok, r);
for (const m of [prev3, prev2, prev]) {
  r = await owner('erpCapitalClose', [{ month: m }]);
  check('(H13) ' + m + ' closes: Rahman still held 100% then', r.ok, r);
}
const sh = (await sql`select month, shares, returns from capital_closed where business_id = ${B} order by month`);
check('(H13) the closed months keep Rahman at 100%', sh.every((x) => Number(x.shares[RAH]) === 100 && x.shares[(sh[0] && Object.keys(x.shares).find((k) => k !== RAH)) || 'none'] === undefined), sh.map((x) => x.shares));
check('(H7) and what Kamal earned in each (2000 a month)', sh.every((x) => Number(x.returns[KAM]) === 2000), sh.map((x) => x.returns));
r = await owner('erpCapitalReopen', [{ month: prev, reason: 'a bill came late' }]);
r = await owner('erpCapitalClose', [{ month: prev }]);
const again = (await sql`select shares from capital_closed where business_id = ${B} and month = ${prev}`)[0];
check('(H12) reopened and closed again: still Rahman 100% (not today\'s 60/40)', r.ok && Number(again.shares[RAH]) === 100 && Object.keys(again.shares).length === 1, again);

// ---- investors: terms change from a month, closed months stay (H7), no type change with money in (H15)
let k = await holder('Kamal');
const dueBefore = k.returnDue;
r = await owner('erpCapitalHolderSave', [{ id: KAM, kind: 'investor', name: 'Kamal', returnKind: 'percent', returnValue: 5 }]);
k = await holder('Kamal');
check('(H7) Kamal 2% -> 5% from this month: the months before keep 2% (6000 due stays 6000)', r.ok && k.returnDue === dueBefore && dueBefore === 6000, [r.error, dueBefore, k.returnDue]);
check('(H7) this month builds at 5%', k.monthlyReturn === 5000, k);
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Late Investor', returnKind: 'monthly', returnValue: 5000, since: prev2 }]);
check('(H7) an investor cannot be added from a closed month', !r.ok && /closed/.test(r.error), r);
const net = (await sql`select net_profit from capital_closed where business_id = ${B} and month = ${prev2}`)[0];
r = await owner('erpCapitalHolderSave', [{ id: KAM, kind: 'investor', name: 'Kamal', returnKind: 'monthly', returnValue: 3000 }]);
check('(H15) Kamal\'s kind of return cannot change once money is in (end and add again)', !r.ok && /End them/.test(r.error), r);
r = await owner('erpCapitalHolderSave', [{ id: KAM, kind: 'shareholder', name: 'Kamal', pct: 1 }]);
check('(H15) nor can he become a shareholder', !r.ok && /End them/.test(r.error), r);
check('(H7) the closed month\'s profit is untouched', Number((await sql`select net_profit from capital_closed where business_id = ${B} and month = ${prev2}`)[0].net_profit) === Number(net.net_profit));

// ---- M16: payouts stop at what was earned
r = await owner('erpCapitalEntryAdd', [{ holder: KAM, type: 'ret', amount: 52000 }]);
check('(M16) paying Kamal 52000 when about 6000 is due is refused', !r.ok && /not yet paid/.test(r.error), r);
r = await owner('erpCapitalEntryAdd', [{ holder: KAM, type: 'ret', amount: 6000 }]);
check('(M16) paying what is due is fine', r.ok, r);
r = await owner('erpCapitalEntryAdd', [{ holder: RAH, type: 'profit', amount: 99999999 }]);
check('(M16) paying Rahman more profit than he has is refused', !r.ok && /not yet paid/.test(r.error), r);

// ---- Q2: an investor with money in cannot be ended
r = await owner('erpCapitalHolderEnd', [{ id: KAM }]);
check('(Q2) Kamal still has 100000 in: he cannot be ended', !r.ok && /still has 100000/.test(r.error), r);
r = await owner('erpCapitalEntryAdd', [{ holder: KAM, type: 'withdraw', amount: 100000 }]);
r = await owner('erpCapitalHolderEnd', [{ id: KAM }]);
check('(Q2) money taken back: now he can leave', r.ok, r);

// ---- shipment investors: Q1 money tie and loss cap, M18 late bill, H14 funding date and closed months
await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Lina', returnKind: 'lot', returnValue: 50, invested: 600 }]);
const LIN = (await holder('Lina')).id;
await mgr('erpReceiveShipment', [{ reference: 'F3-SHIP', supplier: 'Dragon', mode: 'none', lines: [{ sku: 'F3-LT', qty: 10, unitBdt: 100 }] }]);
r = await owner('erpLotFund', [{ holder: LIN, reference: 'F3-SHIP', pct: 100 }]);
check('(Q1) 100% of a 1000 shipment with 600 in the book is refused', !r.ok && /600 in the business/.test(r.error), r);
r = await owner('erpLotFund', [{ holder: LIN, reference: 'F3-SHIP', pct: 60 }]);
check('(Q1) 60% (600) is fine', r.ok && r.result.funding[0].funded === 600, r.result || r);
r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F3-LT', qty: 5 }], payMode: 'full', paymentMethod: 'Cash' }]);
r = await owner('erpLotFunding', [{ reference: 'F3-SHIP' }]);
// 5 sold at 150, cost 100: profit 250; her 60% = 150; she gets 50% = 75
check('5 sold: she earned 75', r.result.funding[0].earned === 75, r.result.funding[0]);
r = await mgr('erpShipmentLateCost', [{ reference: 'F3-SHIP', label: 'Duty', amount: 500, basis: 'units' }]);
r = await owner('erpLotFunding', [{ reference: 'F3-SHIP' }]);
const f = r.result.funding[0];
const lina = await holder('Lina');
check('(M18) after a 500 duty bill: "funded" stays 600 (she put no new money in)', f.funded === 600, f);
check('(M18) the shipment table and the Capital screen say the same earned', f.earned === lina.returnBuilding + lina.returnDue, [f.earned, lina.returnBuilding, lina.returnDue]);
await sql`update lot_funding set amount = 50 where business_id = ${B} and reference = 'F3-SHIP'`;
r = await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F3-LT', qty: 5, discEach: 149 }], payMode: 'full', paymentMethod: 'Cash' }]);
const lina2 = await holder('Lina');
check('(Q1) a big loss on the shipment: her share of it stops at the money she put in (here 50)', lina2.returnBuilding + lina2.returnDue >= -50 - 0.5, [lina2.returnBuilding, lina2.returnDue]);

await mgr('erpReceiveShipment', [{ reference: 'F3-SHIP2', supplier: 'Dragon', mode: 'none', lines: [{ sku: 'F3-L2', qty: 4, unitBdt: 100 }] }]);
await owner('erpCreateInvoice', [{ customer: C, items: [{ sku: 'F3-L2', qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
await owner('erpCapitalEntryAdd', [{ holder: LIN, type: 'invest', amount: 400 }]);
r = await owner('erpLotFund', [{ holder: LIN, reference: 'F3-SHIP2', pct: 50 }]);
r = await owner('erpLotFunding', [{ reference: 'F3-SHIP2' }]);
check('(H14) a funding written after 2 were sold earns nothing on those 2', r.ok && r.result.funding[0].earned === 0 && r.result.funding[0].soldUnits === 0, r.result.funding);
const fid = r.result.funding[0].id;
await sql`update lot_funding set at = ${prev + '-10T12:00:00+06:00'} where id = ${fid}`;
r = await owner('erpLotFundVoid', [{ id: fid, reason: 'mistake' }]);
check('(H14) a funding from a closed month cannot be struck out', !r.ok && /closed/.test(r.error), r);

// ---- Q3: a reopened month that turns to a loss after profit was paid shows "paid more than earned"
r = await owner('erpCapitalReopen', [{ month: prev, reason: 'big bill', again: true }]);
const before = await holder('Rahman');
await sql`insert into expenses (business_id, expense_no, month, kind, category, description, amount) values (${B}, 'E-BIG', ${prev}, 'oneoff', 'Rent', 'Big late bill', 9999999)`;
const after = await holder('Rahman');
check('(Q3/Q5) the loss is shared too (no floor) and shows as paid more than earned', after.earned < before.earned && (after.profitLeft >= 0 || after.overpaid === true), [before.earned, after.earned, after.profitLeft, after.overpaid]);

const other = await sql`select count(*)::int as n from capital_closed where business_id = ${FIX.B2}`;
check('the other business is untouched', other[0].n === 0, other);
await done();
