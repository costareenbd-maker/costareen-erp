// Plan D1: serial numbers and warranty.
import { sql, FIX, owner, mgr, sales, makeShareholder, shareholder, check, done } from './harness.mjs';
await makeShareholder();
const B = FIX.B;
const ymd = (d) => d.toISOString().slice(0, 10);
const addMonths = (d, m) => { const x = new Date(d); x.setUTCMonth(x.getUTCMonth() + m); return x; };
const todayDhaka = new Date(Date.now() + 6 * 3600e3);

// a printer
let r = await owner('erpSaveProduct', [{ isNew: true, product_name: 'Bambu A1 Mini', category: 'Printers', brand: 'Bambulab', unit: 'Piece', cost_price: 20000, sell_price: 32000, opening_stock: 0, status: 'Active' }]);
check('printer created', r.ok, r);
const PR = r.result.sku;
r = await sales('erpSerialSetup', [{ sku: PR, serialised: true, warrantyMonths: 24 }]);
check('setting up serials is a manager matter', !r.ok, r);
r = await mgr('erpSerialSetup', [{ sku: PR, serialised: true, warrantyMonths: 130 }]);
check('warranty is 0 to 120 months', !r.ok && /0 to 120/.test(r.error), r);
r = await mgr('erpSerialSetup', [{ sku: PR, serialised: true, warrantyMonths: 24 }]);
check('serialised, 24 months warranty from now on', r.ok && r.result.serialised && r.result.warrantyMonths === 24 && r.result.stock === 0 && r.result.unnumbered === 0, r.result);
r = await sales('erpCatalog', []);
check('the catalogue says so', r.ok && r.result.find((p) => p.sku === PR).serialised === true && r.result.find((p) => p.sku === PR).warrantyMonths === 24, r.result && r.result.find((p) => p.sku === PR));

// numbers come with the shipment
r = await mgr('erpSerialsAdd', [{ sku: PR, serials: ['SN-A', 'SN-B'] }]);
check('no stock yet: numbers cannot be added', !r.ok && /has 0 in stock/.test(r.error), r);
r = await mgr('erpReceiveShipment', [{ reference: 'PRN-1', mode: 'bdt', totalBdt: 60000, lines: [{ sku: PR, qty: 3, serials: ['SN-A', 'sn-b', 'SN-C', 'SN-D'] }] }]);
check('more numbers than units: refused', !r.ok && /4 serial numbers for 3 unit/.test(r.error), r);
r = await mgr('erpReceiveShipment', [{ reference: 'PRN-1', mode: 'bdt', totalBdt: 60000, lines: [{ sku: PR, qty: 3, serials: ['SN-A', 'sn-b'] }] }]);
check('received with two numbers (the third unit still unnumbered)', r.ok && r.result.numbered === 2, r.result);
r = await mgr('erpSerialsFor', [{ sku: PR }]);
check('two on the shelf, upper-cased; one unit without a number', r.ok && r.result.inStock.map((x) => x.serial).join(',') === 'SN-A,SN-B' && r.result.unnumbered === 1 && r.result.inStock[0].ref === 'PRN-1', r.result);
r = await mgr('erpSerialsAdd', [{ sku: PR, serials: 'SN-C\nSN-A' }]);
check('a number already on the list is refused by name', !r.ok && /Already on the list: SN-A/.test(r.error), r);
r = await mgr('erpSerialsAdd', [{ sku: PR, serials: 'SN-C, SN-E' }]);
check('only as many numbers as there are units', !r.ok && /at most 1 more/.test(r.error), r);
r = await mgr('erpSerialsAdd', [{ sku: PR, serials: ' SN-C ' }]);
check('the third unit numbered from the product page', r.ok && r.result.added === 1 && r.result.inStock.length === 3 && r.result.unnumbered === 0, r.result);

// the sale names the unit
r = await sales('erpCreateInvoice', [{ customer: { name: 'Printer Buyer', phone: '01799100004' }, items: [{ sku: PR, qty: 1 }], payMode: 'full' }]);
check('a serialised product cannot be sold without naming the unit', !r.ok && /pick which unit goes out \(3 on the shelf\)/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Printer Buyer', phone: '01799100004' }, items: [{ sku: PR, qty: 2, serials: ['SN-A'] }], payMode: 'full' }]);
check('as many numbers as units', !r.ok && /2 sold but 1 serial/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Printer Buyer', phone: '01799100004' }, items: [{ sku: PR, qty: 1, serials: ['SN-Z'] }], payMode: 'full' }]);
check('a number not on the shelf', !r.ok && /Not on the shelf.*SN-Z/.test(r.error), r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Printer Buyer', phone: '01799100004' }, items: [{ sku: PR, qty: 1, serials: ['sn-a'] }], payMode: 'full' }]);
check('sold: the unit, with 24 months of warranty from today', r.ok && r.result.serials.length === 1 && r.result.serials[0].serial === 'SN-A' && r.result.serials[0].warrantyUntil === ymd(addMonths(todayDhaka, 24)), r.result && r.result.serials);
const INV1 = r.result.invoiceNo;
// the warranty changes from now on: the unit already sold keeps its 24
r = await mgr('erpSerialSetup', [{ sku: PR, serialised: true, warrantyMonths: 12 }]);
check('warranty cut to 12 months for future sales', r.ok && r.result.warrantyMonths === 12, r.result);
r = await mgr('erpSerialsFor', [{ sku: PR }]);
const soldA = r.result.sold.find((x) => x.serial === 'SN-A');
check('...the unit already sold keeps its 24 months', soldA && soldA.warrantyMonths === 24 && soldA.invoiceNo === INV1 && soldA.customer === 'Printer Buyer' && soldA.inWarranty && soldA.daysLeft > 700, soldA);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Second Buyer', phone: '01811111111' }, items: [{ sku: PR, qty: 1, serials: ['SN-B'], warrantyMonths: 6 }], payMode: 'none', paymentMethod: 'Cash', paid: 0 }]);
check('a special deal: 6 months typed on the line', r.ok && r.result.serials[0].warrantyUntil === ymd(addMonths(todayDhaka, 6)), r.result && r.result.serials);
const INV2 = r.result.invoiceNo;
r = await sales('erpInvoice', [{ invoiceNo: INV1 }]);
check('the invoice page shows the serial and the warranty', r.ok && r.result.lines[0].serials.length === 1 && r.result.lines[0].serials[0].serial === 'SN-A' && /20\d\d/.test(r.result.lines[0].serials[0].warrantyUntil), r.result && r.result.lines[0]);
r = await sales('erpInvoicePdf', [{ invoiceNo: INV1 }]);
check('...and the PDF', r.ok, r);

// look it up
r = await sales('erpSerialLookup', [{ q: 'sn-' }]);
check('look up by a few characters', r.ok && r.result.hits.length === 3 && r.result.hits.every((h) => h.product === 'Bambu A1 Mini'), r.result);
r = await sales('erpSerialLookup', [{ q: 'SN-A' }]);
check('the exact one first: who, when, warranty left', r.result.hits[0].serial === 'SN-A' && r.result.hits[0].status === 'sold' && r.result.hits[0].customer === 'Printer Buyer' && r.result.hits[0].inWarranty, r.result.hits[0]);
r = await sales('erpSearch', [{ q: 'SN-B' }]);
check('the top search finds serials too', r.ok && r.result.serials.length === 1 && r.result.serials[0].invoice === INV2, r.result && r.result.serials);

// a changed warranty on one sold unit
r = await mgr('erpSerialWarranty', [{ serial: 'SN-A', months: 36, reason: 'goodwill' }]);
check('changing a given warranty is for shareholders and up', !r.ok, r);
r = await shareholder('erpSerialWarranty', [{ serial: 'SN-A', months: 36 }]);
check('...with a reason', !r.ok && /Say why/.test(r.error), r);
r = await shareholder('erpSerialWarranty', [{ serial: 'SN-A', months: 36, reason: 'goodwill after a fault' }]);
const a36 = r.ok && r.result.sold.find((x) => x.serial === 'SN-A');
check('36 months from the sale date, with the reason kept', a36 && a36.warrantyMonths === 36 && a36.warrantyUntil === ymd(addMonths(todayDhaka, 36)) && /goodwill after a fault/.test(a36.note), a36 || r);

// back to the shelf
r = await mgr('erpReturnGoods', [{ invoiceNo: INV2, lines: [{ sku: PR, qty: 1, condition: 'good' }], money: 'due', reason: 'changed mind' }]);
check('the only unit of the line comes back without being named', r.ok, r);
r = await mgr('erpSerialsFor', [{ sku: PR }]);
check('SN-B is on the shelf again, SN-C still there', r.result.inStock.map((x) => x.serial).sort().join(',') === 'SN-B,SN-C', r.result.inStock);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Third', phone: '01922222222' }, items: [{ sku: PR, qty: 2, serials: ['SN-B', 'SN-C'] }], payMode: 'full' }]);
const INV3 = r.result.invoiceNo;
r = await mgr('erpReturnGoods', [{ invoiceNo: INV3, lines: [{ sku: PR, qty: 1, condition: 'damaged' }], money: 'advance', reason: 'broken' }]);
check('one of two back: it has to be named', !r.ok && /say which 1 of the 2 came back/.test(r.error), r);
r = await mgr('erpReturnGoods', [{ invoiceNo: INV3, lines: [{ sku: PR, qty: 1, condition: 'damaged', serials: ['SN-C'] }], money: 'advance', reason: 'broken' }]);
check('named: SN-C back as damaged, SN-B still with the customer', r.ok && (await mgr('erpSerialsFor', [{ sku: PR }])).result.sold.find((x) => x.serial === 'SN-C').status === 'damaged' &&
  (await mgr('erpSerialsFor', [{ sku: PR }])).result.sold.find((x) => x.serial === 'SN-B').status === 'sold', r);
r = await mgr('erpReturnGoods', [{ invoiceNo: INV3, lines: [{ sku: PR, qty: 1, condition: 'good' }], money: 'advance', reason: 'the other one too' }]);
check('the last unit of the line comes back unnamed: only one is left to name', r.ok && (await mgr('erpSerialsFor', [{ sku: PR }])).result.inStock.map((x) => x.serial).join(',') === 'SN-B', r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Fourth', phone: '01933333333' }, items: [{ sku: PR, qty: 1, serials: ['SN-B'] }], payMode: 'full' }]);
r = await owner('erpCancelInvoice', [{ invoiceNo: r.result.invoiceNo, reason: 'cancelled', money: 'refund' }]);
check('cancelling an invoice brings its units back', r.ok && (await mgr('erpSerialsFor', [{ sku: PR }])).result.inStock.map((x) => x.serial).join(',') === 'SN-B', r);
const other = await sql`select count(*)::int n from serials where business_id = ${FIX.B2}`;
check('another business has none', other[0].n === 0);
await done();
