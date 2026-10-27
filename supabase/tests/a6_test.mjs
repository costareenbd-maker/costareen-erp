// Plan A6: an investor's return belongs to the month it was earned in, on that month's money;
// no profit without an owner; a closed month is closed for the whole books.
import { sql, FIX, owner, mgr, shareholder, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();
const B = FIX.B;
const now = new Date(Date.now() + 6 * 3600e3);
const pad = (n) => String(n).padStart(2, '0');
const ym = (d) => d.getUTCFullYear() + '-' + pad(d.getUTCMonth() + 1);
const thisMonth = ym(now), today = now.getUTCDate();
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + pad(mo); };
const days = (m) => new Date(Date.UTC(+m.slice(0, 4), +m.slice(5, 7), 0)).getUTCDate();
const prev = shift(thisMonth, -1), prev2 = shift(thisMonth, -2), prev3 = shift(thisMonth, -3);
const inv = (r, name) => r.result.holders.find((h) => h.name === name);

// ---------------------------------------------------------------- the return follows the money, month by month
await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 100, since: prev3 }]);
let r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Kamal', returnKind: 'percent', returnValue: 2, since: prev2, invested: 100000, investedOn: prev2 + '-01' }]);
check('2% a month on 100000 in for two whole months = 4000 due', r.ok && inv(r, 'Kamal').returnDue === 4000, inv(r, 'Kamal'));
check('this month is still building, on the days so far', inv(r, 'Kamal').returnBuilding === Math.round(100000 * 0.02 * today / days(thisMonth)), inv(r, 'Kamal'));
const KAM = inv(r, 'Kamal').id;
// more money on the 16th of last month: it earns from the 16th, and does not rewrite the month before
r = await owner('erpCapitalEntryAdd', [{ holder: KAM, type: 'invest', amount: 100000, date: prev + '-16' }]);
const D = days(prev), want = 2000 + Math.round(100000 * 0.02 + 100000 * 0.02 * (D - 15) / D);
check('money added mid-month earns from that day; the earlier month is untouched', r.ok && inv(r, 'Kamal').returnDue === want && inv(r, 'Kamal').capital === 200000, [inv(r, 'Kamal').returnDue, want]);
check('the monthly figure shown is on the money in now', inv(r, 'Kamal').monthlyReturn === 4000, inv(r, 'Kamal'));
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Salma', returnKind: 'monthly', returnValue: 3000, since: prev }]);
check('a fixed monthly return: one month over = 3000 due', inv(r, 'Salma').returnDue === 3000 && inv(r, 'Salma').returnBuilding === Math.round(3000 * today / days(thisMonth)), inv(r, 'Salma'));
check('the totals add both up', r.result.totals.returnDue === want + 3000 && r.result.totals.returnBuilding === inv(r, 'Kamal').returnBuilding + inv(r, 'Salma').returnBuilding, r.result.totals);

// ---------------------------------------------------------------- it is a cost of the month it fell due in
r = await owner('erpPnl', [{ months: 3 }]);
const pm = (m) => r.result.months.find((x) => x.month === m);
check('profit and loss: each month carries what investors earned in it', pm(prev2).byCat['Investor returns'] === 2000 && pm(prev).byCat['Investor returns'] === want - 2000 + 3000 &&
  pm(prev2).expenses >= 2000, [pm(prev2).byCat, pm(prev).byCat]);
const netBefore = pm(thisMonth).net;
r = await owner('erpCapitalEntryAdd', [{ holder: KAM, type: 'ret', amount: 4000 }]);
check('paying a return settles what is owed', r.ok && inv(r, 'Kamal').returnOwed === want - 4000 && inv(r, 'Kamal').returnPaid === 4000, inv(r, 'Kamal'));
r = await owner('erpPnl', [{ months: 3 }]);
check('...and does not cost the month a second time', pm(thisMonth).net === netBefore, [pm(thisMonth).net, netBefore]);
r = await owner('erpExpenses', [{ month: prev }]);
check('the Expenses screen shows the same figure, and the same net', r.ok && r.result.investorReturns === want - 2000 + 3000 && r.result.byCategory.some((c) => c.name === 'Investor returns') &&
  r.result.net === (await owner('erpPnl', [{ months: 3 }])).result.months.find((x) => x.month === prev).net, r.result && [r.result.investorReturns, r.result.net]);
r = await owner('erpCapital', []);
const capPrev = r.result.months.find((m) => m.month === prev).net;
check('Capital shares out that same net', capPrev === (await owner('erpPnl', [{ months: 3 }])).result.months.find((x) => x.month === prev).net, capPrev);

// ---------------------------------------------------------------- no profit without an owner
await owner('erpCapitalHolderSave', [{ id: inv(r, 'Rahman').id, kind: 'shareholder', name: 'Rahman', pct: 80, from: prev2 }]);   // fix-3: a share counts from the month given
r = await owner('erpCapitalClose', [{ month: prev2 }]);
check('80% given out: the month cannot be closed', !r.ok && /add up to 80%, not 100%/.test(r.error), r);
r = await owner('erpCapital', []);
await owner('erpCapitalHolderSave', [{ id: inv(r, 'Rahman').id, kind: 'shareholder', name: 'Rahman', pct: 100, from: prev2 }]);

// ---------------------------------------------------------------- a closed month is closed for everything
r = await owner('erpCapitalClose', [{ month: prev }]);
check('last month closed; everything up to it is locked', r.ok && r.result.lockedThrough === prev && r.result.months.find((m) => m.month === prev2).locked &&
  r.result.months.find((m) => m.month === prev).canReopen && !r.result.months.find((m) => m.month === thisMonth).locked, r.result && r.result.months);
r = await owner('erpExpenseAdd', [{ amount: 500, description: 'late bill', month: prev }]);
check('an expense cannot be written into a closed month', !r.ok && /is closed, so an expense cannot be written into it/.test(r.error), r);
r = await owner('erpExpenseAdd', [{ amount: 500, description: 'older bill', month: prev2 }]);
check('...nor into a month before it', !r.ok && /books are closed up to/.test(r.error), r);
r = await owner('erpExpenseAdd', [{ amount: 500, description: 'this month', month: thisMonth }]);
check('this month is open', r.ok, r);
r = await owner('erpCapitalEntryAdd', [{ holder: KAM, type: 'invest', amount: 1000, date: prev + '-10' }]);
check('a capital line cannot be dated into a closed month', !r.ok && /a capital line cannot be dated there/.test(r.error), r);
const old = (await owner('erpCapital', [])).result.entries.find((e) => e.type === 'invest' && e.amount === 100000 && !e.voided);
r = await owner('erpCapitalEntryVoid', [{ id: old.id, reason: 'oops' }]);
check('a capital line in a closed month cannot be struck out', !r.ok && /capital lines cannot be struck out/.test(r.error), r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Back Dated', phone: '01711111111' }, date: prev + '-20', items: [{ sku: 'FIL-SUN-PLA-BLA-001', qty: 1 }], paymentMethod: 'Cash', paid: 0 }]);
check('a sale cannot be dated into a closed month', !r.ok && /a sale cannot be dated there/.test(r.error), r);
r = await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Bank', kind: 'bank' }] }]);
const acc = (await owner('erpCashBook', [{}])).result.accounts;
r = await owner('erpCashTransfer', [{ from: acc[0].id, to: acc[1].id, amount: 100, date: prev + '-05' }]);
check('a transfer cannot be dated into a closed month', !r.ok && /a transfer cannot be dated there/.test(r.error), r);
const sup = (await mgr('erpSuppliers', [])).result.suppliers[0].name;
r = await owner('erpSupplierBill', [{ name: sup, amount: 100, date: prev + '-05' }]);
check('a supplier bill cannot be dated into a closed month', !r.ok && /a bill cannot be dated there/.test(r.error), r);
r = await owner('erpSupplierBill', [{ name: sup, amount: 100 }]);
check('...dated today it is fine', r.ok, r);

// ---------------------------------------------------------------- reopening
r = await mgr('erpCapitalReopen', [{ month: prev, reason: 'x' }]);
check('a manager cannot reopen', !r.ok, r);
r = await owner('erpCapitalReopen', [{ month: prev }]);
check('reopening needs a reason', !r.ok && /Say why/.test(r.error), r);
r = await owner('erpCapitalReopen', [{ month: prev2, reason: 'x' }]);
check('only the latest closed month can be reopened', !r.ok && /Only the latest closed month/.test(r.error), r);
r = await owner('erpCapitalReopen', [{ month: prev, reason: 'a bill came late' }]);
check('reopened: nothing is locked', r.ok && r.result.lockedThrough === '' && !r.result.months.find((m) => m.month === prev).closed, r.result && r.result.lockedThrough);
r = await owner('erpExpenseAdd', [{ amount: 500, description: 'late bill', month: prev }]);
check('...and the late bill goes in', r.ok, r);
const other = await sql`select count(*)::int n from capital_closed where business_id = ${FIX.B2}`;
check('another business has none of this', other[0].n === 0);

await done();
