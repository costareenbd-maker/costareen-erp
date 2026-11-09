// crit3-fig (10 Nov 2026): the forecast line under net profit - "If this month's fixed costs are paid". `fixedDue`
// (this month's fixed costs not marked paid yet, item by item) on the dashboard, Profitability, the FilaDash dashboard,
// the Profitability head cards and Expenses. Net profit itself never changes. Struck-out payments count as not paid,
// a stopped item is out, any other month or a closed month has none, another business's items never show.
// Run: sh local/onetest.sh supabase/tests/figfinal_test.mjs
import { sql, FIX, owner, sales, check, done } from './harness.mjs';

const B = FIX.B, B2 = FIX.B2;
const now = new Date(Date.now() + 6 * 3600e3);
const ym = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
const thisMonth = ym(now);
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + String(mo).padStart(2, '0'); };
const prev = shift(thisMonth, -1);
let r;

const exp = async (month) => (await owner('erpExpenses', [month ? { month } : {}])).result;
const base = (await exp()).fixedDue;
check('Expenses carries fixedDue for the running month', base && base.month === thisMonth && typeof base.total === 'number' && Array.isArray(base.items), base);
const t0 = base.total;

// three fixed items this month (one is paid, then its payment is struck out), one recurring, one stopped last month
r = await owner('erpExpenseItemSave', [{ kind: 'fixed', name: 'Fig rent', category: 'Rent', amount: 10000, fromMonth: thisMonth }]);
check('fixed item: rent 10,000', r.ok, r);
r = await owner('erpExpenseItemSave', [{ kind: 'fixed', name: 'Fig salary', category: 'Salaries & wages', amount: 5000, fromMonth: thisMonth }]);
check('fixed item: salary 5,000', r.ok, r);
r = await owner('erpExpenseItemSave', [{ kind: 'fixed', name: 'Fig wifi', category: 'Wi-Fi bill', amount: 1200, fromMonth: thisMonth }]);
check('fixed item: wifi 1,200', r.ok, r);
r = await owner('erpExpenseItemSave', [{ kind: 'recurring', name: 'Fig power', category: 'Utilities', fromMonth: thisMonth }]);
check('a recurring item (not a fixed cost)', r.ok, r);
const items = r.result.fixedItems;
const id = (n) => items.find((f) => f.name === n).id;
// an item that ended last month never counts this month
await sql`insert into expense_items (business_id, item_no, kind, name, category, amount, from_month, to_month)
          values (${B}, 'F-FIG-OLD', 'fixed', 'Fig old rent', 'Rent', 7000, ${shift(thisMonth, -3)}, ${prev})`;

let e = await exp();
check('all three unpaid: 16,200 more than before', e.fixedDue.total === t0 + 16200, e.fixedDue);
check('...item by item, by name', ['Fig rent', 'Fig salary', 'Fig wifi'].every((n) => e.fixedDue.items.some((x) => x.name === n)), e.fixedDue.items);
check('...the stopped item and the recurring one are not in it', !e.fixedDue.items.some((x) => /old rent|power/.test(x.name)), e.fixedDue.items);
check('...it equals Expenses\' own "Still to pay this month"', e.fixedDue.total === e.fixedUnpaid, { due: e.fixedDue.total, unpaid: e.fixedUnpaid });
const net0 = e.net;

r = await owner('erpExpenseFixedPay', [{ id: id('Fig wifi'), month: thisMonth }]);
check('wifi marked paid', r.ok, r);
e = await exp();
check('paid wifi drops out: 15,000 more than before', e.fixedDue.total === t0 + 15000 && !e.fixedDue.items.some((x) => x.name === 'Fig wifi'), e.fixedDue);
check('net profit took the paid wifi (the one net profit, no forecast in it)', e.net === net0 - 1200, { before: net0, after: e.net });

// strike the wifi payment out: it is unpaid again
const row = (await sql`select expense_no from expenses where business_id = ${B} and item_no = ${id('Fig wifi')} and voided is null order by seq desc limit 1`)[0];
r = await owner('erpExpenseFixedPay', [{ id: id('Fig wifi'), month: thisMonth, undo: true }]);
check('the wifi payment undone (struck out)', r.ok, r);
const vd = (await sql`select voided from expenses where business_id = ${B} and expense_no = ${row.expense_no}`)[0];
check('...the row stays, struck out with a reason', vd && vd.voided, vd);
e = await exp();
check('a struck-out payment counts as not paid: back to 16,200', e.fixedDue.total === t0 + 16200, e.fixedDue);
check('...and net profit is back where it was', e.net === net0, { before: net0, after: e.net });

// the same figure everywhere
r = await owner('erpDashboardData', []);
check('dashboard: profit.fixedDue = Expenses\'', r.ok && r.result.profit.fixedDue.total === e.fixedDue.total, r.ok ? r.result.profit.fixedDue : r);
r = await owner('erpPnl', [{ months: 6 }]);
check('Profitability: fixedDue = Expenses\'', r.ok && r.result.fixedDue.total === e.fixedDue.total && r.result.fixedDue.month === thisMonth, r.ok ? r.result.fixedDue : r);
const pnlNet = r.result.months.find((m) => m.month === thisMonth).net;
check('...and its net profit is Expenses\' net (one net profit)', pnlNet === e.net, { pnl: pnlNet, exp: e.net });
r = await owner('erpFdDash', [{ months: 1 }]);
check('FilaDash dashboard "This month": kpi.net.fixedDue', r.ok && r.result.kpi.net.fixedDue && r.result.kpi.net.fixedDue.total === e.fixedDue.total, r.ok ? r.result.kpi.net : r);
check('...the tile\'s net profit itself is unchanged', r.result.kpi.net.v === e.net, r.result.kpi.net);
r = await owner('erpFdDash', [{ months: 3 }]);
check('3 months: no forecast line (not the running month alone)', r.ok && !r.result.kpi.net.fixedDue, r.ok ? r.result.kpi.net : r);
r = await owner('erpFdDash', [{ months: 1, to: prev }]);
check('an earlier month: no forecast line', r.ok && !r.result.kpi.net.fixedDue, r.ok ? r.result.kpi.net : r);
r = await owner('erpFdHead', [{ view: 'profit' }]);
const nc = r.ok && r.result.cards.find((c) => c.key === 'net');
check('Profitability head card: fixedDue on the net card', nc && nc.fixedDue && nc.fixedDue.total === e.fixedDue.total, nc || r);

// another month has none
e = await exp(prev);
check('last month: fixedDue is 0 (forecast is for the running month only)', e.fixedDue.total === 0 && e.fixedDue.items.length === 0, e.fixedDue);
e = await exp(shift(thisMonth, 1));
check('next month: 0', e.fixedDue.total === 0, e.fixedDue);

// a closed month shows none (closed straight in the table - the handler never closes a running month)
await sql`insert into capital_closed (business_id, month, net_profit, shares, by) values (${B}, ${prev}, 0, '{}'::jsonb, 'test') on conflict do nothing`;
await sql`insert into capital_closed (business_id, month, net_profit, shares, by) values (${B}, ${thisMonth}, 0, '{}'::jsonb, 'test') on conflict do nothing`;
e = await exp();
check('running month closed: fixedDue 0, nothing shown', e.fixedDue.total === 0 && e.fixedDue.items.length === 0, e.fixedDue);
r = await owner('erpPnl', [{ months: 3 }]);
check('...Profitability too', r.ok && r.result.fixedDue.total === 0, r.ok ? r.result.fixedDue : r);
await sql`delete from capital_closed where business_id = ${B} and month in (${thisMonth}, ${prev}) and by = 'test'`;
e = await exp();
check('reopened: back to 16,200', e.fixedDue.total === t0 + 16200, e.fixedDue);

// the other business: its items never show here, and nothing of it changed
const b2before = (await sql`select count(*)::int n from expense_items where business_id = ${B2}`)[0].n;
await sql`insert into expense_items (business_id, item_no, kind, name, category, amount, from_month)
          values (${B2}, 'F-FIG-B2', 'fixed', 'Other shop rent', 'Rent', 99000, ${thisMonth})`;
e = await exp();
check('another business\'s fixed cost is not in ours', e.fixedDue.total === t0 + 16200 && !e.fixedDue.items.some((x) => x.name === 'Other shop rent'), e.fixedDue);
const b2 = await sql`select count(*)::int n from expense_items where business_id = ${B2}`;
const b2e = await sql`select count(*)::int n from expenses where business_id = ${B2}`;
check('...the other business keeps only its own rows (one added by this test, no expenses written)', b2[0].n === b2before + 1 && b2e[0].n === 0, { items: b2[0].n, exps: b2e[0].n });
await sql`delete from expense_items where business_id = ${B2} and item_no = 'F-FIG-B2'`;

// below shareholder: no money figures at all
r = await sales('erpFdDash', [{ months: 1 }]);
check('a sales login gets no net profit and no forecast (refused, or built without it)', !r.ok || !r.result.kpi.net, r.ok ? r.result.kpi : r);
r = await sales('erpPnl', [{ months: 1 }]);
check('a sales login cannot read Profitability', !r.ok, r);

await sql`delete from expense_items where business_id = ${B} and item_no = 'F-FIG-OLD'`;
await done();
