// FilaDash merge P3: chargeable weight, freight per kg, cost lines by weight / value / units, order stages (108).
// Run: TEST_SCRIPT=shipweight_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const near = (a, b, e = 0.011) => Math.abs(Number(a) - Number(b)) < e;
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'SW-SPOOL', 'Spool PLA 1kg', 'Filaments', 'Test', 'PLA', 0, 1500, 'Active'),
  (${B}, 'SW-PRINTER', 'Printer X1', 'Printers', 'Test', 'Printer', 0, 90000, 'Active'),
  (${B}, 'SW-NOWEIGHT', 'Loose part', 'Parts', 'Test', 'Part', 0, 100, 'Active')`;
const lot = async (sku, ref) => Number((await sql`select l.unit_cost from stock_lots l join products p on p.id = l.product_id
                                                  where p.business_id = ${B} and p.sku = ${sku} and l.reference = ${ref}`)[0].unit_cost);

// ---- sizes
let r = await sales('erpProductSizes', [{ skus: ['SW-SPOOL'], weight_g: 1300 }]);
check('sales staff cannot set sizes', !r.ok, r);
r = await mgr('erpProductSizes', [{ skus: ['SW-SPOOL'], weight_g: 1300, length_mm: 210, width_mm: 210, height_mm: 80 }]);
check('a spool: 1300 g in a 210 x 210 x 80 box', r.ok && r.result.changed === 1, r);
r = await mgr('erpProductSizes', [{ category: 'Printers', weight_g: 12200, length_mm: 600, width_mm: 600, height_mm: 500 }]);
check('every printer by its category', r.ok && r.result.changed >= 1, r);
const sz = (await sql`select weight_g::float as g, length_mm::float as l from products where business_id = ${B} and sku = 'SW-PRINTER'`)[0];
check('the printer keeps its size', sz.g === 12200 && sz.l === 600, sz);
r = await mgr('erpProductSizes', [{ skus: ['SW-SPOOL'], weight_g: -5 }]);
check('a negative weight is refused', !r.ok, r);

// ---- receiving: freight per chargeable kg, shared by weight; duty by value; labour by units
// spool: 1300 g real, box 210*210*80/6000 = 588 g  -> 1300 g chargeable
// printer: 12200 g real, box 600*600*500/6000 = 30000 g -> 30000 g chargeable (the box is heavier)
r = await mgr('erpReceiveShipment', [{ reference: 'SW-1', supplier: 'Dragon', mode: 'none', freightPerKg: 244, freightBasis: 'weight',
  costs: [{ label: 'Customs', amount: 5000, basis: 'value' }, { label: 'Labour', amount: 1100, basis: 'units' }],
  lines: [{ sku: 'SW-SPOOL', qty: 10, unitBdt: 1000 }, { sku: 'SW-PRINTER', qty: 1, unitBdt: 40000 }] }]);
check('received', r.ok, r);
const kg = (10 * 1300 + 30000) / 1000, freight = kg * 244;
check('freight = chargeable kg x rate (43 kg x 244)', r.ok && near(r.result.chargeKg, 43) && near(r.result.freight, freight), r.result && [r.result.chargeKg, r.result.freight]);
check('the calculation per line (chargeable, real, box weight)', r.result.calc[1].chargeG === 30000 && r.result.calc[1].volG === 30000 && r.result.calc[0].chargeG === 1300 && r.result.calc[0].volG === 588, r.result.calc);
const spool = 1000 + freight * 13000 / 43000 / 10 + 5000 * 10000 / 50000 / 10 + 1100 / 11;
const printer = 40000 + freight * 30000 / 43000 + 5000 * 40000 / 50000 + 1100 / 11;
check('spool landed = goods + freight by weight + customs by value + labour by units', near(await lot('SW-SPOOL', 'SW-1'), spool, 0.02), [await lot('SW-SPOOL', 'SW-1'), spool]);
check('printer landed the same way', near(await lot('SW-PRINTER', 'SW-1'), printer, 0.02), [await lot('SW-PRINTER', 'SW-1'), printer]);
const costRows = await sql`select label, amount::float as a from shipment_costs where business_id = ${B} and reference = 'SW-1' order by label`;
check('the costs are kept with the freight\'s working', costRows.length === 3 && costRows.some((c) => /43 kg/.test(c.label) && near(c.a, freight)), costRows);
check('every taka is shared out (goods + costs = lots)', near(10 * await lot('SW-SPOOL', 'SW-1') + await lot('SW-PRINTER', 'SW-1'), 10000 + 40000 + freight + 5000 + 1100, 0.2), 0);

r = await mgr('erpReceiveShipment', [{ reference: 'SW-2', mode: 'none', freightPerKg: 244, lines: [{ sku: 'SW-NOWEIGHT', qty: 2, unitBdt: 50 }] }]);
check('freight per kg needs every line\'s weight', !r.ok && /Give the weight .*Loose part/.test(r.error), r);
r = await mgr('erpReceiveShipment', [{ reference: 'SW-3', mode: 'none', shippingBdt: 100, freightBasis: 'kilos', lines: [{ sku: 'SW-SPOOL', qty: 1, unitBdt: 50 }] }]);
check('an unknown basis is refused', !r.ok && /weight, by value or by units/.test(r.error), r);
r = await mgr('erpReceiveShipment', [{ reference: 'SW-4', mode: 'none', shippingBdt: 300, lines: [{ sku: 'SW-SPOOL', qty: 1, unitBdt: 100 }, { sku: 'SW-NOWEIGHT', qty: 1, unitBdt: 200 }] }]);
check('nothing said: shared by value as before (100 + 100, 200 + 200)', r.ok && near(await lot('SW-SPOOL', 'SW-4'), 200) && near(await lot('SW-NOWEIGHT', 'SW-4'), 400), r);

// ---- order stages
r = await mgr('erpPoCreate', [{ supplier: 'Dragon', shipBy: 'Air', rate: 17, planned: true, lines: [{ sku: 'SW-SPOOL', qty: 20, rmbUnit: 50 }, { sku: 'SW-PRINTER', qty: 1, rmbUnit: 2000 }] }]);
check('a planned order', r.ok && r.result.stage === 'planned', r);
const PO = r.result.poId;
let list = (await mgr('erpPoList', [])).result.orders.find((o) => o.id === PO);
check('listed as Planned', list && list.stage.key === 'planned' && list.stage.label === 'Planned', list && list.stage);
r = await sales('erpPoStage', [{ poId: PO, stage: 'ordered' }]);
check('sales staff cannot move orders', !r.ok, r);
r = await mgr('erpPoStage', [{ poId: PO, stage: 'received' }]);
check('Received only by receiving', !r.ok, r);
r = await mgr('erpPoStage', [{ poId: PO, stage: 'in_transit', shipmentNo: 'AWB-77', agent: 'Fast Cargo', shipBy: 'Air', kg: 56, freightPerKg: 780, eta: '2026-11-01' }]);
check('in transit with the shipment\'s details and a freight estimate', r.ok && r.result.stage.key === 'in_transit' && r.result.stage.freightEstimate === 56 * 780 && r.result.stage.eta === '2026-11-01', r);
// part of it arrives: freight from the stage's rate per kg (by weight), the rest still Ordered
r = await mgr('erpPoArrive', [{ poId: PO, lines: [{ sku: 'SW-SPOOL', qty: 20 }], shipment: { date: '2026-10-13' } }]);
check('part arrived', r.ok, r);
const ref = (await sql`select reference from stock_lots l join products p on p.id = l.product_id where p.business_id = ${B} and p.sku = 'SW-SPOOL' order by l.seq desc limit 1`)[0].reference;
check('the shipment number from the stage is the reference', ref === 'AWB-77', ref);
check('freight = 20 x 1.3 kg x 780 on top of 50 RMB x 17', near(await lot('SW-SPOOL', 'AWB-77'), 50 * 17 + 1.3 * 780, 0.02), await lot('SW-SPOOL', 'AWB-77'));
list = (await mgr('erpPoList', [])).result.orders.find((o) => o.id === PO);
check('the rest is still on order', list && list.stage.key === 'ordered', list && list.stage);
r = await mgr('erpPoArrive', [{ poId: PO, lines: [{ sku: 'SW-PRINTER', qty: 1 }], shipment: { no: 'AWB-78', shippingBdt: 5000 } }]);
const st = (await sql`select stage from po_stages where business_id = ${B} and po_no = ${PO}`)[0];
check('all arrived: Received; a typed freight amount wins over the rate', r.ok && st.stage === 'received' && near(await lot('SW-PRINTER', 'AWB-78'), 2000 * 17 + 5000), [st, r.ok && await lot('SW-PRINTER', 'AWB-78')]);
r = await mgr('erpPoCreate', [{ supplier: 'Dragon', shipBy: 'Sea', rate: 17, lines: [{ sku: 'SW-SPOOL', qty: 5, rmbUnit: 50 }] }]);
check('an order placed straight away is Ordered', r.ok && r.result.stage === 'ordered', r);

// ---- the other business is untouched
const other = await sql`select count(*)::int as n from po_stages where business_id = ${FIX.B2}`;
check('no stages in the other business', other[0].n === 0, other);

await done();
