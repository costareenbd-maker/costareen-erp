// FilaDash merge P3: sales commission (110_commission.sql, handlers/commission.js, the P&L cost).
// Run: TEST_SCRIPT=commission_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const month = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'CM-PLA', 'Commission PLA', 'Filaments', 'Sunlu', 'PLA', 400, 1000, 'Active'),
  (${B}, 'CM-PRN', 'Commission Printer', 'Printers', 'Bambu', 'Printer', 50000, 60000, 'Active')`;
for (const sku of ['CM-PLA', 'CM-PRN']) {
  const id = (await sql`select id from products where business_id = ${B} and sku = ${sku}`)[0].id;
  await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price) values (${B}, ${id}, 'RECEIVE', 'IN', 20, ${sku === 'CM-PLA' ? 400 : 50000})`;
}
const pnl = async () => (await owner('erpPnl', [{ months: 1 }])).result.months.find((x) => x.month === month);
const base = await pnl();

// ---- rules
let r = await mgr('erpCommissionRuleSave', [{ scope: 'all', basis: 'sales', pct: 2 }]);
check('only the owner sets commission', !r.ok, r);
r = await owner('erpCommissionRuleSave', [{ scope: 'brand', basis: 'sales', pct: 0 }]);
check('a rule needs a %', !r.ok, r);
r = await owner('erpCommissionRuleSave', [{ scope: 'brand', basis: 'sales', pct: 2 }]);
check('a brand rule needs the brand', !r.ok, r);
r = await owner('erpCommissionRuleSave', [{ scope: 'all', basis: 'sales', pct: 2 }]);
check('everyone: 2% of sales', r.ok && r.result.rules.length === 1, r);
r = await owner('erpCommissionRuleSave', [{ scope: 'category', match: 'Printers', basis: 'profit', pct: 10 }]);
check('printers: 10% of the profit', r.ok, r);
r = await owner('erpCommissionRuleSave', [{ seller: FIX.U.mgr, scope: 'sku', match: 'CM-PLA', basis: 'sales', pct: 5 }]);
check('the manager on CM-PLA: 5% of sales', r.ok && r.result.rules.length === 3, r);

// ---- sales by two people
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'CM-PLA', qty: 10 }, { sku: 'CM-PRN', qty: 1 }], payMode: 'full' }]);
check('the manager sells 10 PLA + 1 printer', r.ok, r);
const INV = r.result.invoiceNo;
r = await sales('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01812345678' }, items: [{ sku: 'CM-PLA', qty: 5 }], payMode: 'full' }]);
check('sales staff sell 5 PLA', r.ok, r);

r = await owner('erpCommission', [{ month }]);
const M = r.result.sellers.find((s) => s.id === FIX.U.mgr), S = r.result.sellers.find((s) => s.id === FIX.U.sales);
// manager: PLA 10 x 1000 x 5% (their own product rule) = 500; printer (60000 - 50000) x 10% = 1000 -> 1500
check('the manager: 5% of PLA sales (their rule) + 10% of the printer profit', M && M.earned === 1500, M);
// sales staff: PLA 5 x 1000 x 2% (everyone) = 100
check('sales staff: 2% of their PLA sales (everyone\'s rule)', S && S.earned === 100, S);
check('the month\'s total', r.result.total === 1600, r.result.total);

// ---- a cost of the month
let p = await pnl();
check('commission is a cost of the month (P&L expenses + 1600)', p.expenses - base.expenses === 1600, [p.expenses, base.expenses]);
check('...under Commission', p.byCat.Commission === 1600, p.byCat);
r = await owner('erpExpenses', [{ month }]);
check('the Expenses screen shows it too', r.ok && r.result.commission === 1600 && r.result.byCategory.some((c) => c.name === 'Commission' && c.amount === 1600), r.result && r.result.byCategory);

// ---- a return takes it back from the seller
r = await owner('erpReturnGoods', [{ invoiceNo: INV, lines: [{ sku: 'CM-PLA', qty: 2, condition: 'good' }], money: 'refund', method: 'Cash', reason: 'two too many' }]);
check('2 PLA returned', r.ok, r);
r = await owner('erpCommission', [{ month }]);
check('the manager loses 2 x 1000 x 5% = 100', r.result.sellers.find((s) => s.id === FIX.U.mgr).earned === 1400, r.result.sellers);

// ---- who sees what
r = await sales('erpCommission', [{ month }]);
check('sales staff see only their own', r.ok && r.result.sellers.length === 1 && r.result.sellers[0].id === FIX.U.sales && !r.result.canEdit, r.result);

// ---- paying it is not a second cost
r = await owner('erpCommissionPay', [{ seller: FIX.U.mgr, amount: 5000, month }]);
check('cannot pay more than earned', !r.ok, r);
p = await pnl();
const before = p.expenses;
r = await owner('erpCommissionPay', [{ seller: FIX.U.mgr, amount: 1400, month }]);
check('the manager paid 1400', r.ok && r.result.sellers.find((s) => s.id === FIX.U.mgr).left === 0, r.result && r.result.sellers);
p = await pnl();
check('paying does not add a second cost', p.expenses === before, [p.expenses, before]);

// ---- removing a rule
const rid = (await owner('erpCommission', [{ month }])).result.rules.find((x) => x.scope === 'all').id;
r = await owner('erpCommissionRuleVoid', [{ id: rid, month }]);
check('everyone\'s rule removed: sales staff earn nothing now', r.ok && !r.result.sellers.some((s) => s.id === FIX.U.sales && s.earned > 0), r.result.sellers);

// ---- who sold what, sale by sale
r = await owner('erpCommissionSales', [{ month }]);
const ms = r.ok && r.result.sales.find((x) => x.invoiceNo === INV);
check('the owner sees every sale with its seller, units and commission', r.ok && r.result.all === true && ms && ms.sellerId === FIX.U.mgr && ms.units === 11 && ms.commission === 1500, r.ok ? r.result.sales : r);
check('...and a total per seller (returns counted)', r.result.sellers.some((x) => x.id === FIX.U.mgr && x.commission > 0) && r.result.sellers.some((x) => x.id === FIX.U.sales), r.result.sellers);
check('no cost or profit in it', !JSON.stringify(r.result).includes('profit') && !JSON.stringify(r.result).includes('unit_cost'), r.result);
r = await sales('erpCommissionSales', [{ month }]);
check('sales staff see only their own sales', r.ok && r.result.all === false && r.result.sales.length > 0 && r.result.sales.every((x) => x.sellerId === FIX.U.sales), r.ok ? r.result : r);

// ---- a rule counts from its own month on: it never rewrites the months before
const prevM = (() => { const [y, m] = month.split('-').map(Number); return m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0'); })();
await sql`insert into invoices (business_id, invoice_no, customer_name, subtotal, grand_total, created_at, created_by)
          values (${FIX.B}, 'INV-OLD-COMM', 'Old', 1000, 1000, ${prevM + '-10T12:00:00+06:00'}, ${FIX.U.mgr})`;
await sql`insert into invoice_lines (business_id, invoice_id, sku, qty, line_total, unit_cost)
          select ${FIX.B}, id, 'CM-PLA', 1, 1000, 500 from invoices where business_id = ${FIX.B} and invoice_no = 'INV-OLD-COMM'`;
r = await owner('erpCommission', [{ month: prevM }]);
check('last month: rules made this month do not count there', r.ok && r.result.total === 0, r.result && r.result.total);
r = await owner('erpCommissionRuleSave', [{ scope: 'all', basis: 'sales', pct: 1, since: prevM }]);
check('a rule may start in an earlier open month', r.ok, r);
r = await owner('erpCommission', [{ month: prevM }]);
check('...and then counts there (1% of 1000)', r.ok && r.result.total === 10, r.result && r.result.total);

// ---- the other business is untouched
const other = await sql`select count(*)::int as n from commission_rules where business_id = ${FIX.B2}`;
check('no rules in the other business', other[0].n === 0, other);

await done();
