// Dashboard, Profitability, Product cost (handlers/dashboard.js, spec 01).
// Run: TEST_SCRIPT=dashboard_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done } from './harness.mjs';

const B = FIX.B;
const near = (a, b) => Math.abs(a - b) < 0.0001;

// ---- a clean slate of sales, then a small worked example ---------------------
await sql`delete from invoices where business_id = ${B}`;
await sql`update products set reorder_level = 0 where business_id = ${B} and sku = 'FIL-SUN-PLA-BLA-001'`;
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'FIL-ESU-PETG-WHI-001', 'eSun PETG White', 'Filaments', 'eSun', 'PETG', 0, 1500, 'Active'),
  (${B}, 'MISC-001', 'Loose bits', null, null, null, 0, 200, 'Active'),
  (${B}, 'FIL-SUN-SILK-001', 'Sunlu Silk', 'Filaments', 'Sunlu', 'Silk', 0, 1600, 'Discontinued'),
  (${B}, 'ACC-NOZ-001', 'Nozzle', 'Accessories', 'Generic', 'Nozzle', 0, 300, 'Active'),
  (${B}, 'FIL-OLD-001', 'eSun PETG Old', 'Filaments', 'eSun', 'PETG', 0, 1500, 'Active')`;
const pid = Object.fromEntries((await sql`select sku, id from products where business_id = ${B}`).map((r) => [r.sku, r.id]));
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty) values (${B}, ${pid['FIL-ESU-PETG-WHI-001']}, 'RECEIVE', 'IN', 2), (${B}, ${pid['FIL-OLD-001']}, 'RECEIVE', 'IN', 2)`;

async function invoice(no, at, f, lines) {
  const r = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, created_at,
                        discount, grand_total, advance_paid, payment_status, delivery_status)
                      values (${B}, ${no}, ${f.name || 'Karim'}, ${f.phone || '01712345678'}, ${at},
                              ${f.discount || 0}, ${f.grand || 0}, 0, ${f.status || 'Pending'}, ${f.ds || 'Processing'})
                      returning id`;
  let n = 1;
  for (const [sku, name, qty, unit, total] of lines) {
    await sql`insert into invoice_lines (business_id, invoice_id, sku, name, qty, unit_price, line_total, line_no)
              values (${B}, ${r[0].id}, ${sku}, ${name}, ${qty}, ${unit}, ${total}, ${n++})`;
  }
}
const now = (await sql`select now() as t`)[0].t;
const prevMonthEnd = (await sql`select ((date_trunc('month', now() at time zone 'Asia/Dhaka') - interval '1 day') at time zone 'Asia/Dhaka') as t`)[0].t;
await invoice('INV-A', now, { discount: 200, grand: 4060 }, [
  ['FIL-SUN-PLA-BLA-001', 'Sunlu PLA Black', 2, 1350, 2700],
  ['FIL-ESU-PETG-WHI-001', 'eSun PETG White', 1, 1500, 1500]]);
await invoice('INV-B', now, { grand: 500, status: 'Paid', ds: 'Delivered' }, [
  ['MISC-001', 'Loose bits', 1, 200, 200],
  ['ACC-NOZ-001', 'Nozzle', 1, 300, 300]]);
await invoice('RTN-A', now, { status: 'Paid' }, [['FIL-SUN-PLA-BLA-001', 'Sunlu PLA Black', -1, 1350, -1350]]);
await invoice('INV-P', prevMonthEnd, { grand: 52000, status: 'Paid' }, [['PRT-BAM-A1-001', 'Bambu A1', 1, 52000, 52000]]);

await sql`insert into payments (business_id, payment_no, invoice_no, customer, paid_at, amount, method, note) values
  (${B}, 'P1', 'INV-A', 'Karim', now(), 1000, 'COD (Steadfast)', ''),
  (${B}, 'A1', null, 'Salma', now(), 700, 'Cash', 'x [advance] [acct:1711111111]')`;

const thisMonth = (await sql`select to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM') as m`)[0].m;
await sql`insert into expense_items (business_id, item_no, kind, name, category, amount, from_month) values
  (${B}, 'I1', 'fixed', 'Shop rent', 'Rent', 10000, ${thisMonth}),
  (${B}, 'I2', 'fixed', 'Wages', 'Salaries & wages', 20000, ${thisMonth})`;
await sql`insert into expenses (business_id, expense_no, month, kind, category, amount, item_no, voided) values
  (${B}, 'E1', ${thisMonth}, 'fixed', 'Rent', 10000, 'I1', null),
  (${B}, 'E2', ${thisMonth}, 'recurring', 'Utilities', 1500, null, null),
  (${B}, 'E3', ${thisMonth}, 'oneoff', 'Miscellaneous', 500, null, 'typed twice')`;

await sql`insert into courier_recon (business_id, consignment_id, invoice_no, action, amount) values
  (${B}, 'C1', 'INV-A', 'review', 0), (${B}, 'C4', 'X', 'writeoff', 40), (${B}, 'C5', 'Y', 'extra', 15)`;
await sql`insert into courier_payout_lines (business_id, payout_id, consignment_id, status, invoice_no, match) values
  (${B}, 'PO1', 'C1', 'delivered', 'INV-A', 'phone'),
  (${B}, 'PO1', 'C2', 'Delivered', 'INV-A', 'phone'),
  (${B}, 'PO1', 'C3', 'delivered', 'INV-B', 'phone'),
  (${B}, 'PO1', 'C6', 'cancelled', 'INV-A', 'phone')`;
await sql`insert into courier_payouts (business_id, payout_id, created_src, paid_at, delivery_charges, cod_fee) values
  (${B}, 'PO1', '', ${thisMonth + '-02 10:00'}, 120, 10)`;
await sql`insert into business_config (business_id, key, value) values (${B}, 'sf_night', ${JSON.stringify({ at: 1, error: 'Steadfast said no' })})`;

const w1 = await sql`insert into web_orders (business_id, order_no, entered) values (${B}, 'W1', false) returning id`;
const w2 = await sql`insert into web_orders (business_id, order_no, entered) values (${B}, 'W2', true) returning id`;
await sql`insert into web_order_lines (business_id, web_order_id, line_total) values
  (${B}, ${w1[0].id}, 1000), (${B}, ${w1[0].id}, 500), (${B}, ${w2[0].id}, 900)`;

// ---- product cost ---------------------------------------------------------------
let r = await sales('erpCostBook', []);
check('sales cannot open the price book', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await owner('erpCostBook', []);
const book0 = r.result;
check('book: sync adds one row per category+brand+type of ACTIVE products', r.ok && book0.added === 5 && book0.rows.length === 5, r);
const rowOf = (b, c, br, t) => b.rows.find((x) => x.category === c && x.brand === br && x.type === t);
check('blank category/brand/type written as Uncategorised / - / -', !!rowOf(book0, 'Uncategorised', '-', '-'), book0.rows);
check('discontinued product gets no row', !rowOf(book0, 'Filaments', 'Sunlu', 'Silk'));
check('filament rows follow the default handling (null), others pinned at 0',
  rowOf(book0, 'Filaments', 'eSun', 'PETG').handling === null && rowOf(book0, 'Printers', 'Bambulab', 'A1').handling === 0, book0.rows);
check('derived columns: SKU count and typical sell', rowOf(book0, 'Filaments', 'Sunlu', 'PLA').products === 1 && rowOf(book0, 'Filaments', 'Sunlu', 'PLA').sell === 1350);
check('nothing priced yet, rows numbered from 2', book0.priced === 0 && book0.missing === 5 && book0.rows[0].row === 2 && book0.rate === 0, book0);
r = await owner('erpCostBook', []);
check('second read adds nothing', r.result.added === 0 && r.result.rows.length === 5);

r = await owner('erpSaveCostSettings', [{ rate: '-1' }]);
check('negative rate refused', !r.ok && r.error === 'A negative value does not make sense for rate.', r);
r = await owner('erpSaveCostSettings', [{ rate: '2000' }]);
check('silly rate refused', !r.ok && r.error === 'That rate looks wrong (2000 TK per RMB). Check it before saving.', r);
r = await owner('erpSaveCostSettings', [{ rate: '17.5', handling: '50', minMargin: '10' }]);
check('settings saved', r.ok && r.result.rate === 17.5 && r.result.handling === 50 && r.result.minMargin === 10, r);
r = await owner('erpSaveCostSettings', [{ rate: '', handling: null }]);
check('blank leaves a setting alone', r.ok && r.result.rate === 17.5 && r.result.handling === 50, r);

r = await owner('erpSaveCostRows', [{ rows: [{ category: 'Filaments', brand: 'eSun', type: 'PETG', rmb: '50' },
  { category: 'Filaments', brand: 'Sunlu', type: 'PLA', rmb: '-5' }] }]);
check('negative price refused', !r.ok && r.error === 'A price cannot be negative.', r);
r = await owner('erpCostBook', []);
check('...and nothing of that save was kept', rowOf(r.result, 'Filaments', 'eSun', 'PETG').rmb === null, r.result.rows);
r = await owner('erpSaveCostRows', [{ rows: [{ category: 'Printers', brand: 'Bambulab', type: 'A1', handling: '-1' }] }]);
check('negative handling refused', !r.ok && r.error === 'Handling cannot be negative.', r);
r = await owner('erpSaveCostRows', [{ rows: [] }]);
check('empty save returns the book', r.ok && r.result.rows.length === 5 && r.result.saved === undefined, r);

r = await owner('erpSaveCostRows', [{ rows: [
  { row: 99, category: 'filaments', brand: 'esun', type: 'petg', rmb: '50' },
  { category: 'Uncategorised', brand: '-', type: '-', bdt: '100' },
  { category: 'Filaments', brand: 'Sunlu', type: 'PLA', rmb: '40' },
  { category: 'Accessories', brand: 'Generic', type: 'Nozzle' },
  { category: 'Nope', brand: 'X', type: 'Y', rmb: '1' }] }]);
const book = r.result;
check('saved 3 (matched by name, case-insensitively), untouched row not counted, unknown named',
  r.ok && book.saved === 3 && JSON.stringify(book.notFound) === '["X Y"]', r);
const petg = rowOf(book, 'Filaments', 'eSun', 'PETG');
check('landed = 50 x 17.5 + default handling 50 = 925, margin 38.3', petg.landed === 925 && petg.margin === 38.3 && petg.rmb === 50, petg);
const misc = rowOf(book, 'Uncategorised', '-', '-');
check('landed = bdt 100 + pinned handling 0, margin 50', misc.landed === 100 && misc.margin === 50 && misc.bdt === 100, misc);
check('PLA landed 750, margin 44.4', rowOf(book, 'Filaments', 'Sunlu', 'PLA').landed === 750 && rowOf(book, 'Filaments', 'Sunlu', 'PLA').margin === 44.4);
check('unpriced row: landed 0, margin null', rowOf(book, 'Accessories', 'Generic', 'Nozzle').landed === 0 && rowOf(book, 'Accessories', 'Generic', 'Nozzle').margin === null);
check('priced 3 of 5', book.priced === 3 && book.missing === 2, book);
const stamped = await sql`select updated_at from cost_book where business_id = ${B} and type = 'PETG'`;
check('saved row stamped', stamped[0].updated_at instanceof Date);
r = await owner('erpSaveCostRows', [{ rows: [{ category: 'Filaments', brand: 'Sunlu', type: 'PLA', handling: '' }] }]);
check('blank handling = follow the default', r.ok && rowOf(r.result, 'Filaments', 'Sunlu', 'PLA').handling === null && r.result.saved === 1, r.result);

// ---- dashboard ----------------------------------------------------------------
r = await mgr('erpDashboardData', []);
check('manager cannot call erpDashboardData directly', !r.ok && r.error === 'Your account does not have access to that.', r);

r = await owner('erpDashboardData', []);
const D = r.result;
check('dashboard runs', r.ok && D.currency === 'BDT' && D.thisMonth === thisMonth, r);
const k = D.kpi;
check('today: revenue 3350, 2 orders (return note not an order), 4 units, 5 lines',
  k.todayRevenue === 3350 && k.todayOrders === 2 && k.todayUnits === 4 && k.todayLines === 5, k);
check('month: revenue 3350, orders 2, aov 1675, units 4', k.revenueMTD === 3350 && k.ordersMTD === 2 && k.aov === 1675 && k.unitsMTD === 4, k);
check('previous month (full month): 52000, 1 order', k.revenuePrev === 52000 && k.ordersPrev === 1, k);
check('customers 1, new 1', k.customers === 1 && k.newCustomers === 1, k);
// PLA 900 (own cost), PETG 925 (book), MISC 100 (book via blank key), nozzle uncosted, return -900
check('today gross: cogs 1925, gross 1425, margin 42.5', D.profit.todayCost === 1925 && D.profit.todayGross === 1425 && D.profit.todayMargin === 42.5, D.profit);
check('month gross (invoice discount shared): revenue 3150, cost 1925, gross 1225, margin 38.9',
  D.profit.monthRevenue === 3150 && D.profit.monthCost === 1925 && D.profit.monthGross === 1225 && D.profit.monthMargin === 38.9, D.profit);
check('uncosted revenue 300', D.profit.uncosted === 300, D.profit);
check('expenses: 11500 paid (voided left out), 20000 fixed still to pay', D.profit.monthExpenses === 11500 && D.profit.monthUnpaid === 20000, D.profit);
check('stock: 2 in, 2 at reorder, 3 out (discontinued counts)', D.stock.inStock === 2 && D.stock.reorder === 2 && D.stock.outOfStock === 3, D.stock);
check('retail stock value 171450 in 14 units', k.stockValue === 171450 && k.stockUnits === 14, k);
check('cover: stock at cost 130000, 466/day, 279 days, lead 60', D.cover.stockAtCost === 130000 && D.cover.dailyCost === 466 &&
  D.cover.days === 279 && D.cover.leadDays === 60 && D.cover.reorderNow === 2 && D.cover.outOfStock === 3, D.cover);
const fil = D.stockByCat.find((c) => c.cat === 'Filaments');
check('stock by category, cost first', D.stockByCat[0].cat === 'Printers' && D.stockByCat[0].cost === 120000 &&
  fil.cost === 10000 && fil.units === 11 && fil.skus === 4 && fil.value === 15450, D.stockByCat);
check('cash: owed 3060, courier 1000 (30 days), advances 700', D.cash.owedByCustomers === 3060 && D.cash.withCourier === 1000 && D.cash.advancesHeld === 700, D.cash);
check('courier balance: null while courier.js has no sfBalance (or a number)', D.cash.courierBalance === null || typeof D.cash.courierBalance === 'number', D.cash);
check('courier alerts: 1 review, 1 to match, last night\'s error', D.alerts.courier.review === 1 && D.alerts.courier.pending === 1 &&
  D.alerts.courier.error === 'Steadfast said no', D.alerts.courier);
check('web orders: 2 lines, 1500, 1 order', D.alerts.webPending === 2 && D.alerts.webPendingValue === 1500 && D.alerts.webOrders === 1, D.alerts);
check('quality: 7 products, 2 with no cost, 6 lines', D.quality.productCount === 7 && D.quality.costMissing === 2 &&
  D.quality.salesLines === 6 && D.quality.zeroValued === 0 && D.quality.badDates === 0, D.quality);
check('30 days, ending today', D.days.length === 30 && D.days[29].revenue === 3350 && D.days[29].orders === 2, D.days[29]);
check('years: this year has 12 slots', D.years[thisMonth.slice(0, 4)].length === 12 &&
  D.years[thisMonth.slice(0, 4)].find((m) => m.key === thisMonth).revenue === 3350);
check('recent orders: 4, INV-P last, totals rounded', D.recentOrders.length === 4 && D.recentOrders[3].id === 'INV-P' &&
  D.recentOrders.find((o) => o.id === 'INV-A').total === 4200 && D.recentOrders.find((o) => o.id === 'INV-A').lines === 2 && !('ts' in D.recentOrders[0]), D.recentOrders);
const plaTop = D.topProducts.find((t) => t.name === 'Sunlu PLA Black');
check('top products: 4, PLA nets the return (1 unit, 1350)', D.topProducts.length === 4 && plaTop.units === 1 && plaTop.revenue === 1350, D.topProducts);
check('monthLabel / generatedAt formats', /^[A-Z][a-z]{2} '\d\d$/.test(D.monthLabel) && /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}, \d{1,2}:\d\d [AP]M$/.test(D.generatedAt), D.generatedAt);

// ---- fix 1: below shareholder the money is never built ---------------------
r = await sales('erpBundle', [['dash']]);
const SD = r.result && r.result.dash;
check('sales gets the dashboard through the bundle', r.ok && SD && !r.result.errors.dash, r.result && r.result.errors);
check('...without profit, cover or cash', SD && !('profit' in SD) && !('cover' in SD) && !('cash' in SD) && SD.hideProfit === true, SD && Object.keys(SD));
check('...stock by category without cost', SD && SD.stockByCat.every((c) => !('cost' in c) && !('uncosted' in c)), SD && SD.stockByCat);
check('...no cost-gap count, sales figures still there', SD && SD.quality.costMissing === 0 && SD.kpi.todayRevenue === 3350 && SD.kpi.stockValue === 171450, SD && SD.kpi);
r = await mgr('erpBundle', [['dash', 'costs']]);
check('manager: same, and the price book never leaves', r.ok && !('profit' in r.result.dash) && !('cash' in r.result.dash) && !r.result.costs, r.result && Object.keys(r.result));
await makeShareholder();
r = await shareholder('erpBundle', [['dash', 'costs']]);
check('shareholder sees everything through the bundle', r.ok && r.result.dash.profit.monthGross === 1225 && r.result.dash.cash &&
  r.result.costs && r.result.costs.rows.length === 5 && !r.result.dash.hideProfit, r.result && r.result.errors);

// ---- day picker -----------------------------------------------------------------
r = await sales('erpDaySales', ['yesterday']);
check('bad date', !r.ok && r.error === 'Pick a date first.', r);
const todayStr = (await sql`select to_char(now() at time zone 'Asia/Dhaka', 'YYYY-MM-DD') as d`)[0].d;
r = await sales('erpDaySales', [todayStr]);
const DS = r.result;
check('day: revenue 3350, 3 orders (return note counted here), 4 units, 5 lines',
  r.ok && DS.revenue === 3350 && DS.orders === 3 && DS.units === 4 && DS.lines === 5 && DS.date === todayStr, DS);
check('day: invoices by total desc, return last', DS.invoices.length === 3 && DS.invoices[0].id === 'INV-A' && DS.invoices[0].total === 4200 &&
  DS.invoices[2].id === 'RTN-A' && /^\d{1,2}:\d\d [AP]M$/.test(DS.invoices[0].time), DS.invoices);
check('day: label EEE d MMM yyyy', /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2} \d{4}$/.test(DS.label), DS.label);
check('day: top by product name', DS.top.length === 4 && DS.top.find((t) => t.name === 'Sunlu PLA Black').units === 1, DS.top);
r = await sales('erpDaySales', ['2001-01-01']);
check('empty day', r.ok && r.result.revenue === 0 && r.result.top.length === 0 && r.result.label === 'Mon 1 Jan 2001', r.result);

// ---- P&L ------------------------------------------------------------------------
r = await mgr('erpPnl', [{ months: 6 }]);
check('manager cannot see the P&L', !r.ok, r);
r = await owner('erpPnl', [{ months: 6 }]);
const P = r.result;
const cur = P.months[5], prev = P.months[4];
check('6 months, current last', r.ok && P.months.length === 6 && cur.current && cur.month === thisMonth && !prev.current, P.months.map((m) => m.month));
check('P&L current: sales 4500, returns 1350, net 3150, cost 1925, gross 1225 (38.9%)',
  cur.sales === 4500 && cur.returns === 1350 && cur.netSales === 3150 && cur.cost === 1925 && cur.gross === 1225 && cur.grossMargin === 38.9, cur);
check('P&L delivery 60, courier 130, extra 15, short 40, uncosted 300', cur.delivery === 60 && cur.courier === 130 &&
  cur.courierExtra === 15 && cur.courierShort === 40 && cur.uncosted === 300, cur);
check('P&L expenses 11500 by category, net -10370 (-329.2%)', cur.expenses === 11500 && cur.byCat.Rent === 10000 && cur.byCat.Utilities === 1500 &&
  cur.net === -10370 && cur.netMargin === -329.2, cur);
check('P&L previous month: 52000 sales, cost 40000', prev.sales === 52000 && prev.cost === 40000 && prev.gross === 12000, prev);
check('P&L categories', JSON.stringify(P.categories) === '["Rent","Utilities"]', P.categories);
r = await owner('erpPnl', [{ months: 40 }]);
check('months clamped to 12', r.result.months.length === 12);
r = await owner('erpPnl', [{}]);
check('months default 6', r.result.months.length === 6);

// ---- product profitability ---------------------------------------------------
r = await mgr('erpMoney', [{ days: 90 }]);
check('manager cannot see product profit', !r.ok, r);
r = await owner('erpMoney', [{ days: 9999 }]);
const M = r.result;
// fix 2: PLA costs its own 900, not the book's 750
check('money: revenue 55150, cost 41925 (own cost first), profit 13225, margin 24',
  r.ok && M.revenue === 55150 && M.cost === 41925 && M.profit === 13225 && M.margin === 24, M);
check('money: unknown revenue 300, 1 unit', M.unknownRevenue === 300 && M.unknownUnits === 1, M);
const mPla = M.products.find((p) => p.sku === 'FIL-SUN-PLA-BLA-001');
check('money: PLA nets its return, cost 900', mPla.units === 1 && mPla.cost === 900 && near(mPla.revenue, Math.round(2700 - 200 * 2700 / 4200 - 1350)), mPla);
check('money: best earner first', M.products[0].sku === 'PRT-BAM-A1-001' && M.products.find((p) => p.sku === 'ACC-NOZ-001').unknown === true, M.products);
check('money: brand Unknown for a blank brand', !!M.brands.find((b) => b.name === 'Unknown') && M.brands[0].name === 'Bambulab', M.brands);
check('money: dead stock = old PETG never sold, 1850', M.deadCount === 1 && M.dead[0].sku === 'FIL-OLD-001' && M.dead[0].tied === 1850 &&
  M.dead[0].lastSoldDays === null && M.deadCash === 1850 && M.stockCash === 130000 && M.deadAfter === 90 && M.days === 9999, M);
r = await owner('erpMoney', [{}]);
check('money: default window 90', r.ok && r.result.days === 90);

await done();
