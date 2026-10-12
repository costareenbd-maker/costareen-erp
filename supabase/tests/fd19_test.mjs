// fd-19: erpFd19Profit (handlers/fd19.js) - gross profit per invoice for his Orders list and drawer, read only.
// Run: TEST_SCRIPT=fd19_test.mjs ... erp_server_test.py
// The handler is not registered in handlers/index.js yet (the page block brings the registration lines), so the
// test calls it directly with the same ctx shape core.js gives a handler.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, mgr, owner, fnDir, check, done } from './harness.mjs';

const { erpFd19Profit, HANDLERS, MAX_IDS } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'fd19.js')));
const B = FIX.B, B2 = FIX.B2;
const PLA = 'FIL-SUN-PLA-BLA-001';
const ctxAs = (role, powers, biz) => ({ tx: sql, sql, s: { role, powers }, biz: biz || B, now: new Date(), memo: {}, deps: {} });
const call = (role, payload, powers, biz) => erpFd19Profit(ctxAs(role, powers, biz), payload);

check('exports one read-only handler', HANDLERS && Object.keys(HANDLERS).join() === 'erpFd19Profit' && MAX_IDS === 100, Object.keys(HANDLERS || {}));

// ---- real invoices through the ERP
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'FD19-NOZ-001', 'FD19 Nozzle', 'Accessories', 'Generic', 'Nozzle', 100, 300, 'Active'),
  (${B}, 'FD19-NOCOST', 'FD19 No cost', 'Accessories', 'Generic', 'Other', 0, 500, 'Active')`;
for (const sku of ['FD19-NOZ-001', 'FD19-NOCOST']) {
  const id = (await sql`select id from products where business_id = ${B} and sku = ${sku}`)[0].id;
  await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${B}, ${id}, 'RECEIVE', 'IN', 10)`;
}
const sell = Number((await sql`select sell_price from products where business_id = ${B} and sku = ${PLA}`)[0].sell_price);
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }, { sku: 'FD19-NOZ-001', qty: 1 }], payMode: 'full' }]);
check('invoice A (2 PLA + 1 nozzle, no discount)', r.ok, r);
const A = r.result.invoiceNo;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01811111111' }, items: [{ sku: PLA, qty: 2 }], invoiceDiscount: 100, deliveryCharge: 60, payMode: 'none' }]);
check('invoice D (2 PLA, invoice discount 100, delivery 60)', r.ok, r);
const D = r.result.invoiceNo;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'FD19-NOCOST', qty: 1 }], payMode: 'full' }]);
check('invoice U (a product with no cost anywhere)', r.ok, r);
const U = r.result.invoiceNo;

// the cost each line carries, as written on the day it was sold
const costOf = async (no) => (await sql`select coalesce(sum(l.qty * l.unit_cost), 0)::float as c from invoice_lines l join invoices i on i.id = l.invoice_id
                                        where i.business_id = ${B} and i.invoice_no = ${no}`)[0].c;
const counts = async () => (await sql`select (select count(*) from invoices where business_id = ${B})::int as i,
                                              (select count(*) from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${B})::int as l,
                                              (select count(*) from stock_movements where business_id = ${B})::int as m,
                                              (select count(*) from payments where business_id = ${B})::int as p`)[0];
const before = await counts();

let d = await call('owner', { ids: [A, D, U] });
check('read only: invoices, lines, movements and payments unchanged by the call', JSON.stringify(await counts()) === JSON.stringify(before), [before, await counts()]);
check('owner sees money for every asked invoice', d.hidden === false && d.rows[A] && d.rows[D] && d.rows[U], d);
const cA = await costOf(A);
check('A: revenue = the goods (2 x PLA + 300), delivery none', d.rows[A].revenue === 2 * sell + 300, d.rows[A]);
check('A: cost = the unit costs fixed on its lines', d.rows[A].known === true && d.rows[A].cost === Math.round(cA), [d.rows[A], cA]);
check('A: profit = revenue - cost', d.rows[A].profit === d.rows[A].revenue - d.rows[A].cost, d.rows[A]);
const cD = await costOf(D);
check('D: revenue leaves out the delivery charge and takes off the discount', d.rows[D].revenue === 2 * sell - 100, d.rows[D]);
check('D: profit = revenue - cost', d.rows[D].known && d.rows[D].profit === d.rows[D].revenue - Math.round(cD), [d.rows[D], cD]);
check('U: a line with no cost makes the profit unknown (never counted)', d.rows[U].known === false && d.rows[U].profit === null && d.rows[U].cost === null, d.rows[U]);
check('lines are only sent for a single invoice (the drawer)', !d.rows[A].lines, d.rows[A]);

d = await call('owner', { ids: [A] });
check('one invoice: its lines with the unit cost of the day', d.rows[A].lines.length === 2 && d.rows[A].lines.some((l) => l.sku === PLA.toLowerCase() && l.qty === 2 && l.unitCost > 0), d.rows[A].lines);
check('...line revenues add up to the invoice revenue', Math.round(d.rows[A].lines.reduce((t, l) => t + l.revenue, 0)) === d.rows[A].revenue, d.rows[A]);

// one formula: the revenue over this month's invoices = the dashboard's revenue (the fixture's own old sample
// invoices carry costs without revenue, so the profit is checked per invoice above, not summed against the P&L)
const nos = (await sql`select invoice_no from invoices where business_id = ${B} and voided_at is null and invoice_no not like 'RTN-%'
                       and to_char(public.dhaka_date(created_at), 'YYYY-MM') = to_char(public.dhaka_date(now()), 'YYYY-MM')`).map((x) => x.invoice_no);
d = await call('owner', { ids: nos });
const dash = await owner('erpFdDash', [{ months: 1 }]);
const sumRev = Object.values(d.rows).reduce((t, x) => t + x.revenue, 0);
check('Σ revenue of this month\'s invoices = the dashboard revenue (same discount sharing, delivery left out)', dash.ok && Math.abs(sumRev - dash.result.kpi.revenue.v) <= nos.length, [sumRev, dash.result && dash.result.kpi.revenue]);

// ---- who sees it
d = await call('sales', { ids: [A] });
check('sales staff without the costs ability: hidden, no figures', d.hidden === true && Object.keys(d.rows).length === 0, d);
d = await call('manager', { ids: [A] });
check('a manager has the costs ability by default', d.hidden === false && d.rows[A] && d.rows[A].profit !== undefined, d);
d = await call('manager', { ids: [A] }, { costs: false });
check('...unless the owner took it away', d.hidden === true, d);
d = await call('sales', { ids: [A] }, { costs: true });
check('...and sales staff the owner gave it to see it', d.hidden === false && !!d.rows[A], d);

// ---- the other business
d = await call('owner', { ids: [A] }, null, B2);
check('another business cannot read this one\'s invoice', d.hidden === false && !d.rows[A], d);

// ---- bad input
d = await call('owner', {});
check('no ids: nothing', d.hidden === false && Object.keys(d.rows).length === 0, d);
d = await call('owner', { ids: ['INV-NOPE'] });
check('an unknown invoice is simply not in the answer', !d.rows['INV-NOPE'], d);
let err = '';
try { await call('owner', { ids: Array.from({ length: 101 }, (_, i) => 'X' + i) }); } catch (e) { err = e.message; }
check('more than 100 invoices is refused in plain words', /at most 100/.test(err), err);

await done();
