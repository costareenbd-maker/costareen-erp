// FilaDash merge P3: a cost that arrives after the goods (111_late_cost.sql, erpShipmentLateCost).
// Run: TEST_SCRIPT=latecost_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const near = (a, b) => Math.abs(Number(a) - Number(b)) < 0.011;
const month = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, weight_g) values
  (${B}, 'LC-A', 'Late A', 'Filaments', 'T', 'PLA', 0, 250, 'Active', 1000),
  (${B}, 'LC-B', 'Late B', 'Filaments', 'T', 'PLA', 0, 500, 'Active', 3000)`;
let r = await mgr('erpReceiveShipment', [{ reference: 'LC-1', supplier: 'Dragon', mode: 'none', lines: [{ sku: 'LC-A', qty: 10, unitBdt: 100 }, { sku: 'LC-B', qty: 10, unitBdt: 300 }] }]);
check('shipment in: A 10 at 100, B 10 at 300', r.ok, r);
const cost = async (sku) => Number((await sql`select l.unit_cost from stock_lots l join products p on p.id = l.product_id where p.business_id = ${B} and p.sku = ${sku} and l.reference = 'LC-1'`)[0].unit_cost);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'LC-A', qty: 4 }], payMode: 'full' }]);
check('4 of A sold at 100', r.ok, r);
const INV1 = r.result.invoiceNo;
const pnl = async () => (await owner('erpPnl', [{ months: 1 }])).result.months.find((x) => x.month === month);
const p0 = await pnl();

// ---- refusals
r = await sales('erpShipmentLateCost', [{ reference: 'LC-1', label: 'Duty', amount: 400 }]);
check('sales staff cannot add costs', !r.ok, r);
r = await mgr('erpShipmentLateCost', [{ reference: 'LC-1', label: '', amount: 400 }]);
check('a bill needs a label', !r.ok, r);
r = await mgr('erpShipmentLateCost', [{ reference: 'NOPE', label: 'Duty', amount: 400 }]);
check('an unknown shipment is refused', !r.ok, r);

// ---- 400 of duty by value: A has 1000 of value, B 3000 -> A 100, B 300
r = await mgr('erpShipmentLateCost', [{ reference: 'LC-1', label: 'Customs duty', amount: 400, basis: 'value' }]);
check('the duty is added', r.ok, r);
// A: 100 shared, 4 of 10 gone -> 40 is cost of sales now, 60 onto the 6 left (+10 each); B: none gone -> 300 onto 10 (+30)
check('the part for units already sold: 40', r.ok && near(r.result.soldPart, 40) && near(r.result.shelfPart, 360), r.result);
check('A\'s units on the shelf now cost 110', near(await cost('LC-A'), 110), await cost('LC-A'));
check('B\'s now cost 330', near(await cost('LC-B'), 330), await cost('LC-B'));
const p1 = await pnl();
check('this month\'s cost of goods rises by the sold part only (40)', near(p1.cost - p0.cost, 40), [p1.cost, p0.cost]);
check('the sale already made keeps its cost (100)', near((await sql`select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${B} and i.invoice_no = ${INV1}`)[0].unit_cost, 100), 0);
const sc = await sql`select label, amount::float as a from shipment_costs where business_id = ${B} and reference = 'LC-1'`;
check('the money is a shipment cost (it leaves an account, like freight)', sc.length === 1 && sc[0].a === 400 && /after the goods/.test(sc[0].label), sc);

// ---- the next sale carries it
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01812345678' }, items: [{ sku: 'LC-A', qty: 2 }], payMode: 'full' }]);
const c2 = Number((await sql`select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${B} and i.invoice_no = ${r.result.invoiceNo}`)[0].unit_cost);
check('the next sale of A costs 110 a unit', r.ok && near(c2, 110), c2);

// ---- the shipment's profit counts all of it
r = await mgr('erpShipments', [{}]);
const s = r.result.shipments.find((x) => x.reference === 'LC-1');
// sold 6 of A at 250: revenue 1500; cost 4 x 100 + 2 x 110 + the 40 sold part = 660
check('shipment: revenue 1500, cost 660 (sold units + the late sold part)', s.revenue === 1500 && s.cost === 660 && s.profit === 840, s);
r = await mgr('erpShipment', [{ reference: 'LC-1' }]);
check('the shipment page knows the late part', r.ok && r.result.lateSold === 40 && r.result.extra.some((x) => /after the goods/.test(x.label)), r.result);

// ---- by weight: A 1 kg, B 3 kg
r = await mgr('erpShipmentLateCost', [{ reference: 'LC-1', label: 'Freight top-up', amount: 160, basis: 'weight' }]);
// A 4 units left (1 kg) = weight 10 kg shipped, B 10 x 3 = 30 kg: A 40, B 120. A: 6 of 10 gone -> 24 sold, 16 onto 4 (+4); B: 120 onto 10 (+12)
check('by weight: A 40 (24 sold), B 120', r.ok && near(r.result.soldPart, 24), r.result);
check('A now 114, B 342', near(await cost('LC-A'), 114) && near(await cost('LC-B'), 342), [await cost('LC-A'), await cost('LC-B')]);

// ---- the other business is untouched
const other = await sql`select count(*)::int as n from late_costs where business_id = ${FIX.B2}`;
check('nothing in the other business', other[0].n === 0, other);

await done();
