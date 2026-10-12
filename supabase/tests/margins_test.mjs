// The invoice's low-profit warning (erpLineMargins): under 10 % profit after discounts, FIFO cost; never blocks a sale;
// the % only for people who may see cost.
import { sql, FIX, owner, sales, check, done } from './harness.mjs';

const B = FIX.B, PLA = 'FIL-SUN-PLA-BLA-001';
const sell = Number((await sql`select sell_price from products where business_id = ${B} and sku = ${PLA}`)[0].sell_price);
let r = await owner('erpLineMargins', [{ items: [{ sku: PLA, qty: 1 }] }]);
const full = r.result.lines[0];
check('the owner sees the margin at the full price', r.ok && typeof full.margin === 'number' && !full.unknown, r.result);
const cost = sell * (1 - full.margin / 100);
// a discount that leaves about 5 % profit
const disc = Math.round(sell - cost / 0.95);
r = await owner('erpLineMargins', [{ items: [{ sku: PLA, qty: 1, discEach: disc }] }]);
check('a deep discount is flagged low (under 10 %)', r.ok && r.result.lines[0].low === true && r.result.lines[0].margin < 10, r.result);
r = await owner('erpLineMargins', [{ items: [{ sku: PLA, qty: 1 }], invoiceDiscount: disc }]);
check('...the invoice discount counts too', r.ok && r.result.lines[0].low === true, r.result);
r = await sales('erpLineMargins', [{ items: [{ sku: PLA, qty: 1, discEach: disc }] }]);
check('sales staff learn only "low", never the %', r.ok && r.result.lines[0].low === true && r.result.lines[0].margin === undefined, r.result);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1, discEach: disc }], payMode: 'full', paymentMethod: 'Cash' }]);
check('the sale still saves - it is only a warning (no discount limit)', r.ok, r);
r = await owner('erpLineMargins', [{ items: [{ sku: 'NOPE', qty: 1 }] }]);
check('an unknown product is not flagged', r.ok && r.result.lines[0].low === false && r.result.lines[0].unknown, r.result);
await done();
