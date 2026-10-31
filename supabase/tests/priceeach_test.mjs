// price-each-1 (owner 1 Nov 2026, a joint shipment: two colours took the whole goods total, 53 others only their
// freight): each line's own price (from the invoice) shares the goods total out; a mix of priced and unpriced lines is
// refused; the Review step's preview works the costs out with the same engine and writes nothing.
import { sql, FIX, mgr, check, done } from './harness.mjs';
const B = FIX.B;
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, unit) values
  (${B}, 'PE-A', 'Price Each A', 'Zz', 'Nobook', 'Odd', 0, 3000, 'Active', 'Piece'),
  (${B}, 'PE-B', 'Price Each B', 'Zz', 'Nobook', 'Odd', 0, 3000, 'Active', 'Piece'),
  (${B}, 'PE-C', 'Price Each C', 'Zz', 'Nobook', 'Odd', 500, 3000, 'Active', 'Piece')`;
const base = { supplier: 'Overseas Co', mode: 'fx', currency: 'USD', totalFx: 100, rate: 100, payment: 'later' };
const moves = async (ref) => (await sql`select count(*)::int n from stock_movements where business_id = ${B} and reference = ${ref}`)[0].n;

// 1. each line's USD price shares the 10,000 TK goods total: A 2 x $30, B 4 x $10 -> 60 : 40
let r = await mgr('erpReceivePreview', [{ ...base, reference: 'PE-1', lines: [{ sku: 'PE-A', qty: 2, priceFx: 30 }, { sku: 'PE-B', qty: 4, priceFx: 10 }] }]);
const pa = r.ok && r.result.lines.find((l) => l.sku === 'PE-A'), pb = r.ok && r.result.lines.find((l) => l.sku === 'PE-B');
check('preview: A 3,000 a unit, B 1,000 a unit (by each line\'s price)', pa && pb && Math.abs(pa.unitCost - 3000) < 0.05 && Math.abs(pb.unitCost - 1000) < 0.05, r.ok ? r.result.lines : r.error);
check('preview: total 10,000 and nothing written', r.ok && Math.round(r.result.totalBdt) === 10000 && (await moves('PE-1')) === 0, r.ok && r.result.totalBdt);
r = await mgr('erpReceiveShipment', [{ ...base, reference: 'PE-1', lines: [{ sku: 'PE-A', qty: 2, priceFx: 30 }, { sku: 'PE-B', qty: 4, priceFx: 10 }] }]);
const got = await sql`select p.sku, m.unit_price from stock_movements m join products p on p.id = m.product_id where m.business_id = ${B} and m.reference = 'PE-1' order by p.sku`;
check('received: the same costs as the preview', r.ok && got.length === 2 && Math.abs(Number(got[0].unit_price) - 3000) < 0.05 && Math.abs(Number(got[1].unit_price) - 1000) < 0.05, r.ok ? got : r.error);

// 2. one line priced, one with no price, no book and no cost: refused (it would get none of the goods)
await sql`update products set cost_price = 0 where business_id = ${B} and sku = 'PE-B'`;
r = await mgr('erpReceiveShipment', [{ ...base, reference: 'PE-2', lines: [{ sku: 'PE-A', qty: 1, priceFx: 30 }, { sku: 'PE-B', qty: 1 }] }]);
check('a line with no price beside priced ones is refused, by name', !r.ok && /No price for Price Each B/.test(r.error) && (await moves('PE-2')) === 0, r.error);
r = await mgr('erpReceivePreview', [{ ...base, reference: 'PE-2', lines: [{ sku: 'PE-A', qty: 1, priceFx: 30 }, { sku: 'PE-B', qty: 1 }] }]);
check('...the preview says so too', !r.ok && /No price for/.test(r.error), r.error);

r = await mgr('erpReceivePreview', [{ ...base, reference: 'PE-2b', lines: [{ sku: 'PE-A', qty: 1, priceFx: 30 }, { sku: 'PE-C', qty: 1 }] }]);
check('an invoice price beside a line with only an old cost is refused too', !r.ok && /No price for Price Each C/.test(r.error), r.ok ? r.result.lines : r.error);
// 3. an old cost still counts as a value (C has 500) - no price typed, still accepted, shared by value
r = await mgr('erpReceivePreview', [{ ...base, reference: 'PE-3', lines: [{ sku: 'PE-C', qty: 2 }] }]);
check('a line with an old cost and no typed price is shared by that cost', r.ok && Math.abs(r.result.lines[0].unitCost - 5000) < 0.05, r.ok ? r.result.lines : r.error);

// 4. no shipment total: each line's taka price is its unit cost; preview with a new product writes no product
r = await mgr('erpReceivePreview', [{ supplier: 'Local', mode: 'none', reference: 'PE-4', lines: [{ sku: 'PE-A', qty: 1, unitBdt: 1234 },
  { isNew: true, qty: 2, product: { product_name: 'Preview Only', category: 'Zz', cost_price: 50 }, unitBdt: 777 }] }]);
check('no total: the typed price is the cost; a new product is only previewed', r.ok && Math.abs(r.result.lines[0].unitCost - 1234) < 0.05 && Math.abs(r.result.lines[1].unitCost - 777) < 0.05 &&
  (await sql`select count(*)::int n from products where business_id = ${B} and name = 'Preview Only'`)[0].n === 0, r.ok ? r.result.lines : r.error);
r = await mgr('erpReceivePreview', [{ ...base, reference: 'PE-5', lines: [{ sku: 'PE-A', qty: 1, priceFx: -1 }] }]);
check('a price below zero is refused', !r.ok && /below zero/.test(r.error), r.error);
done();
