// Plan A1: the cost of a sale is fixed on the day of the sale.
import { sql, FIX, owner, mgr, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001';        // cost 900, sells at 1350
const now = new Date(Date.now() + 6 * 3600e3);
const month = now.getUTCFullYear() + '-' + String(now.getUTCMonth() + 1).padStart(2, '0');

const figures = async () => {
  const pnl = (await owner('erpPnl', [{ months: 1 }])).result.months[0];
  const drill = (await owner('erpPnlMonth', [{ month }])).result.totals;
  const exp = (await owner('erpExpenses', [{ month }])).result;
  const dash = (await owner('erpBundle', [['dash'], { fresh: true }])).result.dash.profit;
  const money = (await owner('erpMoney', [{ days: 30 }])).result;
  return { pnl: pnl.cost, drill: drill.cost, expenses: exp.goodsCost, dash: dash.monthCost, money: money.cost, gross: pnl.gross, uncosted: pnl.uncosted };
};
const same = (f, v) => f.pnl === v && f.drill === v && f.expenses === v && f.dash === v;

// the fixture's old lines were typed straight into the database with no cost on them;
// give them one the way 029_sale_cost.sql does for lines that predate this change
await sql`update invoice_lines l set unit_cost = p.cost_price from products p
          where (l.unit_cost is null or l.unit_cost = 0) and p.cost_price > 0
            and p.business_id = l.business_id and lower(btrim(p.sku)) = lower(btrim(l.sku))`;
const before = await figures();
let r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full' }]);
const INV = r.result.invoiceNo;
const line = (await sql`select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.invoice_no = ${INV}`)[0];
check('the cost is written on the line when it is sold', Number(line.unit_cost) === 900, line);
const sold = await figures();
check('every screen counts 2 x 900 for it', same(sold, before.pnl + 1800) && sold.money === before.money + 1800, [before, sold]);

// a shipment arrives at a much higher price: the product now costs more
r = await owner('erpProduct', [PLA]);
r = await owner('erpSaveProduct', [{ ...r.result, cost_price: 1500 }]);
check('fixture: cost raised to 1500', r.ok && (await owner('erpProduct', [PLA])).result.cost_price === 1500, r);
const after = await figures();
check('the sale already made still cost 900 each - on every screen', same(after, sold.pnl) && after.money === sold.money && after.gross === sold.gross, [sold, after]);

r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
const next = await figures();
check('a sale made after the rise costs 1500', same(next, after.pnl + 1500) && next.money === after.money + 1500, [after, next]);

// one of the first two comes back: it leaves the cost at what it went out at
r = await owner('erpReturnGoods', [{ invoiceNo: INV, lines: [{ sku: PLA, qty: 1, condition: 'good' }], money: 'refund', method: 'Cash', reason: 'changed mind' }]);
check('fixture: one returned', r.ok, r);
const rl = (await sql`select l.unit_cost, l.qty from invoice_lines l join invoices i on i.id = l.invoice_id where i.invoice_no like 'RTN-%' and i.note like ${'%' + INV + '%'}`)[0];
check('the return line carries the cost of the sale, not today’s', Number(rl.unit_cost) === 900 && Number(rl.qty) === -1, rl);
const back = await figures();
check('...so the cost falls by 900, not 1500', same(back, next.pnl - 900), [next, back]);

// something sold before its cost was known: filling the cost in completes the past
r = await owner('erpSaveProduct', [{ isNew: true, product_name: 'No Cost Yet', category: 'Parts', brand: 'BIQU', unit: 'Piece', cost_price: 0, sell_price: 500, opening_stock: 5, status: 'Active' }]);
const NC = r.result.sku;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: NC, qty: 2 }], payMode: 'full' }]);
const unk = await figures();
check('sold with no cost: left out of the cost and named as not costed', same(unk, back.pnl) && unk.uncosted === back.uncosted + 1000, [back, unk]);
r = await owner('erpProduct', [NC]);
r = await owner('erpSaveProduct', [{ ...r.result, cost_price: 300 }]);
const filled = await figures();
check('once its cost is typed in, that sale is costed', same(filled, unk.pnl + 600) && filled.uncosted === back.uncosted, [unk, filled]);

// a product with no cost of its own, priced by the price book: the book's figure is what is kept
await sql`insert into cost_book (business_id, sort_order, category, brand, type, buy_bdt, handling) values (${FIX.B}, 999, 'Booked', 'BK', 'T1', 200, 0)`;
r = await owner('erpSaveProduct', [{ isNew: true, product_name: 'Book Priced', category: 'Booked', brand: 'BK', type: 'T1', unit: 'Piece', cost_price: 0, sell_price: 400, opening_stock: 5, status: 'Active' }]);
const BK = r.result.sku;
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: BK, qty: 1 }], payMode: 'full' }]);
const bl = (await sql`select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.invoice_no = ${r.result.invoiceNo}`)[0];
check('the price book cost is written on the line', Number(bl.unit_cost) === 200, bl);
const b1 = await figures();
await sql`update cost_book set buy_bdt = 350 where business_id = ${FIX.B} and category = 'Booked'`;
const b2 = await figures();
check('changing the price book later does not move that sale', same(b2, b1.pnl), [b1, b2]);

// the one-off repair for sales made before any of this
await sql`update invoice_lines set unit_cost = 0 where business_id = ${FIX.B}`;
r = await mgr('erpFreezeSaleCosts', []);
check('only the owner runs the repair', !r.ok, r);
r = await owner('erpFreezeSaleCosts', []);
const left = (await sql`select count(*)::int n from invoice_lines where business_id = ${FIX.B} and coalesce(unit_cost,0) = 0`)[0].n;
check('repair writes a cost on every line whose product has one', r.ok && r.result.fixed > 0 && r.result.stillWithoutCost === left, r.result);
const b3 = await figures();
await sql`update cost_book set buy_bdt = 999 where business_id = ${FIX.B} and category = 'Booked'`;
check('...and after it the old sales stay put too', same(await figures(), b3.pnl), b3);
const o2 = await sql`select count(*)::int n from invoice_lines where business_id = ${FIX.B2} and unit_cost > 0`;
check('another business is not touched', o2[0].n === 0);

await done();
