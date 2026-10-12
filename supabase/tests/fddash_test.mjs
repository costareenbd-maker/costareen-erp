// FilaDash merge P2: the FilaDash dashboard's figures (handlers/fddash.js).
// Run: TEST_SCRIPT=fddash_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';

// a few real invoices through the ERP itself
await sql`update products set category = 'Filaments' where business_id = ${B} and sku = ${PLA}`;
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'FD-NOZ-001', 'Nozzle 0.4', 'Accessories', 'Generic', 'Nozzle', 100, 300, 'Active')`;
const noz = (await sql`select id from products where business_id = ${B} and sku = 'FD-NOZ-001'`)[0].id;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${B}, ${noz}, 'RECEIVE', 'IN', 10)`;
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }, { sku: 'FD-NOZ-001', qty: 1 }], payMode: 'full' }]);
check('invoice 1', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01812345678' }, items: [{ sku: 'FD-NOZ-001', qty: 2 }], payMode: 'none' }]);
check('invoice 2 (unpaid)', r.ok, r);

// ---- who may ask
r = await sales('erpFdDash', [{}]);
check('sales staff do not see the dashboard', !r.ok, r);
r = await mgr('erpFdDash', [{}]);
check('nor a manager (as the old dashboard: shareholder and up)', !r.ok, r);

// ---- the whole business = the P&L
r = await owner('erpFdDash', [{ months: 1 }]);
check('answers', r.ok, r);
const d = r.result;
const p = await owner('erpPnl', [{ months: 1 }]);
const m = p.result.months[p.result.months.length - 1];
check('revenue is the P&L net sales', d.kpi.revenue.v === m.netSales, [d.kpi.revenue, m.netSales]);
check('gross profit is the P&L gross', d.kpi.gross.v === m.gross, [d.kpi.gross, m.gross]);
check('net profit is the P&L net profit (one net profit everywhere)', d.kpi.net.v === m.net, [d.kpi.net, m.net]);
check('expenses are the P&L expenses', d.kpi.expenses.v === m.expenses, [d.kpi.expenses, m.expenses]);
check('every money figure shows its calculation, ending on the figure', d.calc.net[d.calc.net.length - 1][1] === d.kpi.net.v && d.calc.gross[2][1] === d.kpi.gross.v, d.calc);
check('two orders, five units this month (at least)', d.kpi.orders.v >= 2 && d.kpi.units.v >= 5, d.kpi);
check('a 6-month curve even for one month', d.series.length === 6 && d.series[5].revenue === m.netSales, d.series);
check('groups from the product categories', d.groups.some((g) => g.label === 'Filaments') && d.groups.some((g) => g.label === 'Accessories'), d.groups);
check('dues include the unpaid invoice', d.kpi.dues.v >= 600 && d.duesByAge[0].count >= 1, [d.kpi.dues, d.duesByAge]);
check('recent invoices, newest first', d.recent.length >= 2 && d.recent[0].customer === 'Rahim' && d.recent[0].owed === d.recent[0].total, d.recent);
check('revenue by group adds up to the revenue', Math.abs(d.donuts.byGroup.reduce((s, x) => s + x.value, 0) - d.kpi.revenue.v) <= 2, d.donuts.byGroup);

// ---- one product group
r = await owner('erpFdDash', [{ months: 1, group: 'accessories' }]);
const g = r.result;
check('a group: its own sales only', r.ok && g.group === 'accessories' && g.groupLabel === 'Accessories' && g.kpi.units.v === 3 && g.kpi.revenue.v === 900, g.kpi);
check('a group: gross = revenue - the cost written on its lines', g.kpi.gross.v === 900 - 300, g.kpi.gross);
check('a group: no net profit, expenses, dues or cash (they belong to the whole business)', !g.kpi.net && !g.kpi.expenses && !g.kpi.dues && !g.kpi.cashIn && !g.donuts.byGroup, g.kpi);
check('a group: its stock value', g.kpi.stockValue.v === 7 * 100, g.kpi.stockValue);
check('a group: recent invoices with its lines only', g.recent.every((x) => ['Karim', 'Rahim'].includes(x.customer)), g.recent);
r = await owner('erpFdDash', [{ months: 1, group: 'moon' }]);
check('an unknown group reads as the whole business', r.ok && r.result.group === '' && r.result.kpi.net, r.result.group);

// ---- ranges
for (const n of [3, 6, 12]) {
  r = await owner('erpFdDash', [{ months: n }]);
  const pp = await owner('erpPnl', [{ months: n }]);
  const net = pp.result.months.reduce((s, x) => s + x.net, 0);
  check(n + ' months: net profit is the sum of the P&L months', r.ok && r.result.months === n && Math.abs(r.result.kpi.net.v - net) <= n, [r.result.kpi.net.v, net]);
}
r = await owner('erpFdDash', [{ months: 7 }]);
check('an odd range falls back to one month', r.ok && r.result.months === 1, r.result.months);

// ---- the other business is untouched and unseen
const other = (await sql`select count(*)::int as n from invoices where business_id = ${FIX.B2}`)[0].n;
check('the other business has its own books (not counted here)', d.recent.every((x) => !/B2/.test(x.id)) && other >= 0, other);

// ---- the four cards on top of each list screen (erpFdHead)
const head = async (who, view) => { const x = await who('erpFdHead', [{ view }]); return x.ok ? Object.fromEntries(x.result.cards.map((c) => [c.key, c])) : x; };
let h = await head(owner, 'sales');
check('Sales: revenue (hero), orders, dues, units', h.revenue && h.revenue.hero && h.orders && h.dues && h.units && h.revenue.v === d.kpi.revenue.v, h);
h = await head(sales, 'sales');
check('Sales for sales staff: counts only, no money', !h.revenue && !h.dues && h.orders && h.orders.hero && h.duesN && h.duesN.v >= 1, h);
h = await head(owner, 'customers');
check('Customers: count, new, repeat %, owed', h.customers.v >= 2 && h.fresh && h.repeat && h.repeat.pct && h.dues.v === d.kpi.dues.v, h);
h = await head(sales, 'customers');
check('Customers for sales staff: no money', !h.dues && h.duesN, h);
h = await head(owner, 'products');
check('Products: stock value, units, out, low', h.stockValue && h.units && h.out && h.low && h.stockValue.v === d.kpi.stockValue.v, h);
await sql`update memberships set powers = '{"costs": false}'::jsonb where business_id = ${B} and user_id = ${FIX.U.mgr}`;
h = await head(mgr, 'stock');
check('Stock without the Product cost ability: no stock value', !h.stockValue && h.units.hero, h);
await sql`update memberships set powers = '{}'::jsonb where business_id = ${B} and user_id = ${FIX.U.mgr}`;
h = await head(owner, 'expenses');
check('Expenses: this month = the P&L expenses', h.expenses && h.expenses.v === d.kpi.expenses.v && h.unpaid && h.last, h);
r = await sales('erpFdHead', [{ view: 'expenses' }]);
check('Expenses for sales staff: nothing', r.ok && r.result.cards.length === 0, r);
h = await head(owner, 'profit');
check('Profit: net = the P&L net', h.net.v === m.net && h.revenue.v === m.netSales, h);
r = await mgr('erpFdHead', [{ view: 'cash' }]);
check('Money for a manager: nothing', r.ok && r.result.cards.length === 0, r);
h = await head(owner, 'cash');
check('Money for the owner: in hand, received, loose, dues', h.inHand && h.cashIn && h.loose && h.dues, h);

await done();
