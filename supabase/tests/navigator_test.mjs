// ERP Navigator (FilaDash merge: his mind map on our data, handlers/navigator.js).
// Run: TEST_SCRIPT=navigator_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, shareholder, makeShareholder, check, done } from './harness.mjs';

const B = FIX.B;
await makeShareholder();
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, color, reorder_level) values
  (${B}, 'NV-RED', 'Nav Red', 'Filaments', 'Navco', 'PETG', 0, 300, 'Active', 'Red', 3),
  (${B}, 'NV-NOZ', 'Nav Nozzle', 'Accessories', 'Generic', 'Nozzle', 0, 200, 'Active', null, 2)`;
let r = await mgr('erpReceiveShipment', [{ reference: 'NV-SHIP-1', mode: 'bdt', totalBdt: 1000, lines: [{ sku: 'NV-RED', qty: 10 }] }]);
check('a shipment received', r.ok, r);
r = await mgr('erpReceiveShipment', [{ reference: 'NV-SHIP-2', mode: 'bdt', totalBdt: 500, lines: [{ sku: 'NV-NOZ', qty: 5 }] }]);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'NV-RED', qty: 8 }], payMode: 'full' }]);
check('invoice 1', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01812345678' }, items: [{ sku: 'NV-NOZ', qty: 1 }], payMode: 'none' }]);
check('invoice 2 (unpaid)', r.ok, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'NV-NOZ', qty: 1 }], payMode: 'full' }]);

// ---- the owner sees everything
r = await owner('erpNavigator', [{}]);
check('answers', r.ok, r);
const d = r.result;
const mod = (x, id) => x.modules.find((m) => m.id === id);
const leafOf = (n, id) => { if (n.id === id) return n; for (const c of n.children || []) { const f = leafOf(c, id); if (f) return f; } return null; };
const kpi = (x, k) => x.kpis.find((c) => c.key === k);
check('nine modules, ten flows, six KPI cards', d.modules.length === 9 && d.flows.length === 10 && d.kpis.length === 6, [d.modules.length, d.flows.length, d.kpis.length]);
check('every module has a view of ours and leaves for the owner', d.modules.every((m) => m.view && !m.locked && m.children.length >= 4), d.modules.map((m) => [m.id, m.locked, m.children && m.children.length]));
check('every leaf with a screen names one of our views', d.modules.every((m) => m.children.every((c) => !c.view || /^[a-z]+$/.test(c.view))), 0);

// figures equal the existing handlers'
const fd = await owner('erpFdDash', [{ months: 1 }]);
check('net profit is erpFdDash’s (one net profit everywhere)', kpi(d, 'net').v === fd.result.kpi.net.v && kpi(d, 'net').prev === fd.result.kpi.net.prev, [kpi(d, 'net'), fd.result.kpi.net]);
check('stock value is erpFdDash’s (FIFO)', kpi(d, 'stockValue').v === fd.result.kpi.stockValue.v, [kpi(d, 'stockValue'), fd.result.kpi.stockValue]);
check('the net profit calculation ends on the figure', kpi(d, 'net').calc[kpi(d, 'net').calc.length - 1][1] === kpi(d, 'net').v, kpi(d, 'net').calc);
check('open orders: the unpaid invoice, with its due', kpi(d, 'open').v >= 1 && /200/.test(kpi(d, 'open').note), kpi(d, 'open'));
const r3 = await owner('erpFdDash', [{ months: 3 }]);
const d3 = (await owner('erpNavigator', [{ range: '90d' }])).result;
check('90 days = 3 calendar months, net = erpFdDash(3)', d3.range.months === 3 && kpi(d3, 'net').v === r3.result.kpi.net.v, [d3.range, kpi(d3, 'net'), r3.result.kpi.net]);
const dc = (await owner('erpNavigator', [{ range: { from: d3.range.from, to: d3.range.to } }])).result;
check('a custom range of the same months gives the same net profit', dc.range.key === 'custom' && kpi(dc, 'net').v === kpi(d3, 'net').v, [dc.range, kpi(dc, 'net')]);
const sc = await owner('erpSystemCheck', []);
check('the audit module counts erpSystemCheck’s checks', mod(d, 'audit').count === sc.result.checks.length, [mod(d, 'audit').count, sc.result.checks.length]);
const cap = await owner('erpCapital', []);
check('investor payout due is erpCapital’s returns owed', kpi(d, 'payout').v === Math.round(cap.result.totals.returnDue - cap.result.totals.returnPaid), [kpi(d, 'payout'), cap.result.totals]);

// the map's own counts
const inv = mod(d, 'inventory');
check('inventory: brands leaf counts Navco', leafOf(inv, 'inv_brands').children.some((c) => c.label === 'Navco'), leafOf(inv, 'inv_brands'));
check('inventory: Nav Red is low (2 left, reorder at 3)', leafOf(inv, 'inv_low').children.some((c) => c.label === 'Nav Red' && c.value === 2), leafOf(inv, 'inv_low'));
check('procurement: both shipments received', leafOf(mod(d, 'procurement'), 'prc_received').value >= 2, leafOf(mod(d, 'procurement'), 'prc_received'));
const cus = mod(d, 'customers');
check('customers: Karim bought twice (repeat), Rahim owes', leafOf(cus, 'cus_repeat').children.some((c) => c.label === 'Karim' && c.value >= 2) && leafOf(cus, 'cus_dues').children.some((c) => c.label === 'Rahim' && c.value === 200), [leafOf(cus, 'cus_repeat'), leafOf(cus, 'cus_dues')]);
check('flows: units sold in the range', d.flows.find((f) => f.label === 'Stock sold to customers').count >= 10, d.flows);
check('health rows for every module', d.health.length === 9 && d.health.every((h) => h.status), d.health);
check('money flow for the owner', d.money && d.money.nodes && d.money.links.length === 13, d.money);
check('needs action lists the low stock', d.actions.some((a) => /low on stock/.test(a.title) && a.view === 'stock'), d.actions);
check('search index: invoices, customers, shipments, SKUs', d.search.invoices.length >= 3 && d.search.customers.length >= 2 && d.search.shipments.some((x) => x.ref === 'NV-SHIP-1') && d.search.skus.some((x) => x.sku === 'NV-RED'), d.search.shipments);
check('filter lists', d.filters.options.brand.some((x) => x.value === 'Navco') && d.filters.options.shipment.some((x) => x.value === 'NV-SHIP-2') && Array.isArray(d.filters.options.investor), d.filters.options);
check('the owner sees the audit trail of a module', Array.isArray(mod(d, 'orders').audit) && mod(d, 'orders').audit.some((a) => /invoice/i.test(a.what)), mod(d, 'orders').audit);

// ---- filters narrow the map, not the KPI cards
const f1 = (await owner('erpNavigator', [{ filters: { brand: 'Navco' } }])).result;
check('brand filter: one product, its invoice only', mod(f1, 'inventory').count === 1 && mod(f1, 'orders').count === 1 && kpi(f1, 'net').v === kpi(d, 'net').v, [mod(f1, 'inventory').count, mod(f1, 'orders').count]);
const f2 = (await owner('erpNavigator', [{ filters: { shipment: 'NV-SHIP-2' } }])).result;
check('shipment filter: invoices that drew from it (the two nozzle sales)', mod(f2, 'orders').count === 2, mod(f2, 'orders').count);

// ---- sales staff: no cost, profit, dues money or investors
r = await sales('erpNavigator', [{}]);
check('sales staff may open it', r.ok, r);
const s = r.result;
check('sales: stock value, net profit and investor payout are locked (no number)', kpi(s, 'stockValue').locked === 'cost' && kpi(s, 'net').locked === 'profit' && kpi(s, 'payout').locked === 'investor' &&
  kpi(s, 'stockValue').v === undefined && kpi(s, 'net').v === undefined && kpi(s, 'payout').v === undefined, s.kpis);
check('sales: investors, expenses, analytics, audit and procurement modules locked', ['investors', 'expenses', 'analytics', 'audit', 'procurement'].every((id) => mod(s, id).locked && mod(s, id).count === null && !mod(s, id).children.length), s.modules.map((m) => [m.id, m.locked]));
const moneyLeaves = [];
const walk = (n) => { if (n.money && n.value !== null && n.value !== undefined) moneyLeaves.push(n.id); (n.children || []).forEach(walk); };
s.modules.forEach(walk);
const moneyMinis = s.modules.flatMap((x) => (x.minis || []).filter((q) => q.money && q.v !== undefined).map((q) => x.id + ':' + q.label));
check('sales: inventory value leaf locked, no money figure on any leaf or mini card', leafOf(mod(s, 'inventory'), 'inv_value').locked === 'cost' && !moneyLeaves.length && !moneyMinis.length, [moneyLeaves, moneyMinis]);
const sj = JSON.stringify(s);
check('sales: no cost book or profit figure leaks (money flow locked, no dues amounts)', s.money.locked && !/still due/.test(kpi(s, 'open').note) && !sj.includes('"Dues","v"'), [s.money, kpi(s, 'open')]);
check('sales: customer dues leaf has names, not amounts', leafOf(mod(s, 'customers'), 'cus_dues').children.every((c) => c.value === null), leafOf(mod(s, 'customers'), 'cus_dues'));
check('sales: no investor filter, no audit trail', s.filters.options.investor === null && mod(s, 'orders').audit.locked === 'perm', [s.filters.options.investor, mod(s, 'orders').audit]);
r = await sales('erpNavigator', [{ filters: { investor: 'H123' } }]);
check('sales: an investor filter is ignored', r.ok && !r.result.filters.active.investor, r.result && r.result.filters.active);

// ---- a manager: costs yes, profit no
const m = (await mgr('erpNavigator', [{}])).result;
check('manager: stock value yes, net profit and investors locked', typeof kpi(m, 'stockValue').v === 'number' && kpi(m, 'net').locked === 'profit' && mod(m, 'investors').locked === 'investor', m.kpis);
const sh = (await shareholder('erpNavigator', [{}])).result;
check('shareholder: net profit and investors, but no audit trail rows', typeof kpi(sh, 'net').v === 'number' && !mod(sh, 'investors').locked && mod(sh, 'orders').audit.locked === 'perm', [kpi(sh, 'net'), mod(sh, 'investors').locked]);

// ---- the other business is untouched and unseen
const before = (await sql`select count(*)::int as n from invoices where business_id = ${FIX.B2}`)[0].n;
await owner('erpNavigator', [{ range: '12m' }]);
const after = (await sql`select count(*)::int as n from invoices where business_id = ${FIX.B2}`)[0].n;
check('the other business is untouched', before === after, [before, after]);
check('nothing of the other business in the search', !JSON.stringify(d.search).includes(String(FIX.B2)), 0);
check('reading it writes nothing to the activity log', (await sql`select count(*)::int as n from erp_activity where action = 'erpNavigator'`)[0].n === 0, 0);

await done();
