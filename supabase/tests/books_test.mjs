// night-books (6 Nov 2026): Wave 1 money bugs B1-B8. Made-up figures only.
// Run: TEST_SCRIPT=books_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const head = async (who, view) => { const x = await who('erpFdHead', [{ view }]); return x.ok ? Object.fromEntries(x.result.cards.map((c) => [c.key, c])) : x; };

// ---- B1: the Suppliers head card is the list's own sum (opening balances in, advances not netted)
await sql`insert into suppliers (business_id, name, opening_owed) values (${B}, 'Night Sup A', 1000), (${B}, 'Night Sup B', 0)`;
await sql`insert into supplier_bills (business_id, supplier, amount) values (${B}, 'Night Sup A', 5000), (${B}, 'Night Sup B', 1000)`;
await sql`insert into supplier_payments (business_id, supplier, amount) values (${B}, 'Night Sup A', 2000), (${B}, 'Night Sup B', 3000)`;
{
  const list = (await owner('erpSuppliers', [])).result;
  const h = await head(owner, 'suppliers');
  check('B1 list: A owes 4000 (1000 opening + 5000 - 2000), B paid 2000 ahead', list.suppliers.find((s) => s.name === 'Night Sup A').owed === 4000
    && list.suppliers.find((s) => s.name === 'Night Sup B').owed === -2000, list.suppliers);
  check('B1 head card "We owe suppliers" equals the list total (not bills - payments = 1000)', h.owed && h.owed.v === Math.round(list.owedTotal) && h.owed.v === 4000, [h.owed, list.owedTotal]);
  check('B1 head card carries what was paid ahead apart', h.owed.ahead === 2000, h.owed);
}

// ---- B2: the "cannot be costed" warning counts only rows whose currency has no rate
await sql`delete from currencies where business_id = ${B} and code = 'RMB'`.catch(() => {});
await sql`delete from business_config where business_id = ${B} and key = 'cost_rate'`.catch(() => {});
await sql`insert into currencies (business_id, code, name, rate) values (${B}, 'USD', 'US dollar', 120)
          on conflict do nothing`.catch((e) => console.log('usd:', e.message));
await sql`insert into cost_book (business_id, sort_order, category, brand, type, buy_amount, buy_cur) values
  (${B}, 901, 'NightCat', 'NB', 'Taka row', 500, 'BDT'),
  (${B}, 902, 'NightCat', 'NB', 'Yuan row', 10, 'RMB'),
  (${B}, 903, 'NightCat', 'NB', 'Yuan row 2', 12, 'RMB'),
  (${B}, 904, 'NightCat', 'NB', 'Dollar row', 2, 'USD')`;
{
  const cb = (await owner('erpCostBook', [])).result;
  const row = (t) => cb.rows.find((r) => r.type === t);
  check('B2 a BDT row and a USD row are costed with no RMB rate', row('Taka row').landed > 0 && row('Dollar row').landed > 0, cb.rows.filter((r) => r.category === 'NightCat'));
  check('B2 noRate names RMB with exactly its 2 rows (not "nothing can be costed")', cb.noRate && cb.noRate.RMB === 2 && !cb.noRate.BDT && !cb.noRate.USD, cb.noRate);
  const h = await head(owner, 'costs');
  check('B2 head "Cost book rows priced" = the book\'s own priced count, and says how many wait for a rate', h.rows.v === cb.priced && h.rows.of === cb.rows.length && h.rows.noRate === 2, [h.rows, cb.priced, cb.rows.length]);
  await sql`insert into currencies (business_id, code, name, rate) values (${B}, 'RMB', 'Chinese yuan', 17)`;
  const cb2 = (await owner('erpCostBook', [])).result;
  check('B2 once RMB has a rate nothing waits', !Object.keys(cb2.noRate).length && cb2.rows.find((r) => r.type === 'Yuan row').landed > 0, cb2.noRate);
}

// ---- B3: Expenses shows the one net profit (with a kept pre-order deposit, which its own sum left out)
const thisMonth = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
await sql`insert into preorders (business_id, no, customer, customer_key, status, forfeited, forfeit_month)
          values (${B}, 'PO-NIGHT-1', 'Night Buyer', 'night', 'cancelled', 700, ${thisMonth})`;
{
  const pnl = (await owner('erpPnl', [{ months: 1 }])).result.months.find((m) => m.month === thisMonth);
  const e = (await owner('erpExpenses', [{ month: thisMonth }])).result;
  check('B3 the P&L counts the kept deposit', pnl.forfeited === 700, pnl);
  check('B3 Expenses net profit = Profitability net profit', e.net === pnl.net, [e.net, pnl.net]);
  check('B3 netAfterUnpaid = that net less fixed costs not paid', e.netAfterUnpaid === pnl.net - e.fixedUnpaid, [e.netAfterUnpaid, e.fixedUnpaid]);
}

// ---- B4: a struck-out shipment bill is not summed
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'NB-A', 'Night costed', 'NightKnown', 'NB', 'K', 0, 250, 'Active'),
  (${B}, 'NB-U', 'Night no cost', 'NightNone', 'NB', 'U', 0, 500, 'Active')`;
let r = await mgr('erpReceiveShipment', [{ reference: 'NB-S1', supplier: 'Night Sup A', mode: 'none', lines: [{ sku: 'NB-A', qty: 10, unitBdt: 100 }] }]);
check('B4 shipment NB-S1 received (10 at 100)', r.ok, r);
await sql`insert into shipment_costs (business_id, reference, label, amount) values (${B}, 'NB-S1', 'Freight', 300)`;
await sql`insert into shipment_costs (business_id, reference, label, amount, voided) values (${B}, 'NB-S1', 'Wrong freight', 999, 'typed twice')`;
{
  const s = (await owner('erpShipments', [{}])).result.shipments.find((x) => x.reference === 'NB-S1');
  check('B4 the struck-out 999 is not in the shipment\'s other costs (300 only)', s && s.extraCosts === 300, s);
}

// ---- B5 (D1 = A): sales with no known cost are kept out of profit and shown apart
const pnl0 = (await owner('erpPnl', [{ months: 1 }])).result.months.find((m) => m.month === thisMonth);
const uid = (await sql`select id from products where business_id = ${B} and sku = 'NB-U'`)[0].id;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, reference) values (${B}, ${uid}, 'RECEIVE', 'IN', 5, 0, 'NB-S2')`;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Night Buyer', phone: '01712340001' }, items: [{ sku: 'NB-U', qty: 2 }, { sku: 'NB-A', qty: 3 }], payMode: 'full' }]);
check('B5 a sale of 2 no-cost units (500 each) and 3 costed (250, cost 100)', r.ok, r);
{
  const p = (await owner('erpPnl', [{ months: 1 }])).result.months.find((m) => m.month === thisMonth);
  check('B5 P&L: the 1000 of no-cost sales is still in sales', p.netSales - pnl0.netSales === 1750, [p.netSales, pnl0.netSales]);
  check('B5 P&L: ...but kept out of gross profit and shown apart (1 sale, 1000)', p.uncostedOut - (pnl0.uncostedOut || 0) === 1000 && p.uncostedN - (pnl0.uncostedN || 0) === 1, p);
  check('B5 P&L: gross profit grew by the costed part only (750 - 300 = 450)', p.gross - pnl0.gross === 450, [p.gross, pnl0.gross]);
  check('B5 P&L adds up: net sales - cost - kept out = gross', p.netSales - p.cost - p.uncostedOut === p.gross, p);
  const d = (await owner('erpFdDash', [{ months: 1 }])).result;
  check('B5 dashboard gross = P&L gross, with the no-cost sales apart', d.kpi.gross.v === p.gross && d.kpi.uncosted.v === p.uncostedOut && d.kpi.net.v === p.net, [d.kpi.gross, d.kpi.uncosted, p.gross]);
  const e = (await owner('erpExpenses', [{ month: thisMonth }])).result;
  check('B5 Expenses still the one net profit', e.net === p.net, [e.net, p.net]);
  const sh = (await owner('erpShipments', [{}])).result;
  const s2 = sh.shipments.find((x) => x.reference === 'NB-S2'), s1 = sh.shipments.find((x) => x.reference === 'NB-S1');
  check('B5 shipment with no cost: 1000 sold, profit 0 (not 1000), shown apart', s2 && s2.revenue === 1000 && s2.profit === 0 && s2.unknownRevenue === 1000 && s2.unknownSold === 2 && !s2.costKnown, s2);
  check('B5 costed shipment: profit 450', s1 && s1.profit === 450 && s1.unknownRevenue === 0, s1);
  check('B5 shipment totals carry the no-cost sales apart', sh.totals.unknownRevenue >= 1000 && sh.totals.uncostedShipments >= 1, sh.totals);
  const m = (await owner('erpMoney', [{ days: 30 }])).result;
  check('B5 product profitability: profit = sold - no-cost sales - cost', m.profit === m.revenue - m.unknownRevenue - m.cost && m.unknownRevenue >= 1000, [m.revenue, m.cost, m.unknownRevenue, m.profit]);
  const nu = m.products.find((x) => String(x.sku).toUpperCase() === 'NB-U');
  check('B5 the no-cost product shows no profit', nu && nu.profit === 0 && nu.unknownRevenue === 1000, nu);
  const sc = (await owner('erpSystemCheck', [])).result.checks.find((c) => c.id === 'P3');
  check('B5 System check has the "kept out of profit" line, as a warning', sc && sc.status === 'warn' && sc.count >= 1 && /kept out/.test(sc.detail), sc);
}

await done();
