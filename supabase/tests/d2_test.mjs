// Plan D2: repair / service jobs.
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const stock = async (sku) => Number((await sql`select ps.stock from products p join product_stock ps on ps.product_id = p.id where p.business_id = ${B} and p.sku = ${sku}`)[0].stock);

// a printer sold with a serial, so the job can find it
let r = await owner('erpSaveProduct', [{ isNew: true, product_name: 'Bambu A1 Mini', category: 'Printers', brand: 'Bambulab', unit: 'Piece', cost_price: 20000, sell_price: 32000, opening_stock: 0, status: 'Active' }]);
const PR = r.result.sku;
await mgr('erpSerialSetup', [{ sku: PR, serialised: true, warrantyMonths: 12 }]);
await mgr('erpReceiveShipment', [{ reference: 'PRN-1', mode: 'bdt', totalBdt: 40000, lines: [{ sku: PR, qty: 2, serials: ['SN-A', 'SN-B'] }] }]);
await sales('erpCreateInvoice', [{ customer: { name: 'Printer Buyer', phone: '01712345678' }, items: [{ sku: PR, qty: 1, serials: ['SN-A'] }], payMode: 'full' }]);

// ---------------------------------------------------------------- opening a job
r = await sales('erpJobs', [{}]);
check('no jobs yet', r.ok && r.result.jobs.length === 0 && r.result.counts.open === 0 && r.result.canMoney === false, r);
r = await sales('erpJobOpen', [{ customer: { name: 'X' }, item: 'Printer', problem: '' }]);
check('the problem is required', !r.ok && /What is wrong/.test(r.error), r);
r = await sales('erpJobOpen', [{ serial: 'sn-a', problem: 'Nozzle clogged, prints stop after 2 minutes' }]);
check('a serial this system sold fills in the machine, the customer and the warranty', r.ok && r.result.job.item === 'Bambu A1 Mini' && r.result.job.customer === 'Printer Buyer' && r.result.job.sku === PR &&
  r.result.job.underWarranty === true && /20\d\d/.test(r.result.job.warrantyUntil) && /^JOB-\d{6}-01$/.test(r.result.job.jobNo) && r.result.job.status === 'received', r.result && r.result.job);
const J1 = r.result.job.jobNo;
r = await sales('erpJobOpen', [{ customer: { name: 'Walk In', phone: '01811111111' }, item: 'Creality Ender 3', problem: 'Bed not heating', accessories: 'power cable' }]);
check('a machine never sold here: typed by hand, no warranty', r.ok && r.result.job.underWarranty === false && r.result.job.phone === '01811111111' && /-02$/.test(r.result.job.jobNo), r.result && r.result.job);
const J2 = r.result.job.jobNo;
r = await sales('erpJobs', [{ status: 'open' }]);
check('two open jobs', r.ok && r.result.jobs.length === 2 && r.result.counts.open === 2, r.result && r.result.counts);

// ---------------------------------------------------------------- parts, labour, the charge
const s0 = await stock(PLA);
r = await sales('erpJobSave', [{ jobNo: J2, status: 'diagnosed', diagnosis: 'Thermistor dead', parts: [{ sku: PLA, qty: 2 }], labour: 500 }]);
check('parts leave the shelf at the selling price; charge = labour + parts', r.ok && r.result.job.status === 'diagnosed' && r.result.job.parts.length === 1 && r.result.job.parts[0].qty === 2 &&
  r.result.job.parts[0].price > 0 && r.result.job.charge === 500 + 2 * r.result.job.parts[0].price && (await stock(PLA)) === s0 - 2, r.result && r.result.job);
const partPrice = r.result.job.parts[0].price;
r = await sales('erpJobSave', [{ jobNo: J2, parts: [{ sku: PLA, qty: 1, price: 100 }] }]);
check('one part taken off: it is back on the shelf; a price can be typed', r.ok && (await stock(PLA)) === s0 - 1 && r.result.job.parts[0].price === 100 && r.result.job.charge === 600, r.result && r.result.job);
r = await sales('erpJobSave', [{ jobNo: J2, parts: [{ sku: PLA, qty: 9999 }] }]);
check('not enough on the shelf', !r.ok && /Not enough/.test(r.error) && (await stock(PLA)) === s0 - 1, r);
r = await sales('erpJobSave', [{ jobNo: J1, parts: [{ sku: PLA, qty: 1 }], labour: 0 }]);
check('under warranty: parts start at 0', r.ok && r.result.job.parts[0].price === 0 && r.result.job.charge === 0, r.result && r.result.job);
const mv = await sql`select kind, direction, qty, reference from stock_movements m join products p on p.id = m.product_id where p.sku = ${PLA} and m.reference like 'Job: %' order by m.created_at`;
check('every part move is in the stock ledger, named by job', mv.length === 3 && mv[0].reference === 'Job: ' + J2 && mv[0].direction === 'OUT' && mv[1].direction === 'IN', mv);

// ---------------------------------------------------------------- money
r = await sales('erpJobPay', [{ jobNo: J2, amount: 600, method: 'Cash' }]);
check('money on a job: managers and up', !r.ok, r);
r = await mgr('erpJobPay', [{ jobNo: J2, amount: 700, method: 'Cash' }]);
check('not more than is owed', !r.ok && /Only 600 is owed/.test(r.error), r);
r = await mgr('erpJobPay', [{ jobNo: J2, amount: 400, method: 'bKash' }]);
check('part paid: due left', r.ok && r.result.job.paid === 400 && r.result.job.due === 200 && r.result.payments.length === 1 && r.result.payments[0].method === 'bKash', r.result && r.result.job);
r = await mgr('erpJobSave', [{ jobNo: J2, status: 'returned' }]);
check('returned with 200 still owed', r.ok && r.result.job.status === 'returned' && r.result.job.open === false && r.result.job.due === 200 && !!r.result.job.returned, r.result && r.result.job);
r = await sales('erpJobs', [{}]);
check('the list counts what returned jobs still owe', r.result.counts.owed === 200 && r.result.counts.open === 1 && r.result.counts.closed === 1, r.result.counts);
const pay = await sql`select invoice_no, customer_key, note from payments where business_id = ${B} and invoice_no = ${J2}`;
check('the payment carries the job number and no customer key (it is not an invoice)', pay.length === 1 && pay[0].customer_key === null && /\[job\]/.test(pay[0].note), pay);
r = await mgr('erpCustomerAccount', [{ phone: '01811111111', name: 'Walk In' }]);
check('...so the customer\'s invoice balance is untouched', r.ok && r.result.balance === 0, r.result);

// ---------------------------------------------------------------- the month's books
const month = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
r = await owner('erpPnl', [{ months: 1 }]);
const m = r.result.months.find((x) => x.month === month);
check('the P&L carries repair income and the parts used', m && m.serviceIncome === 600 && m.serviceParts > 0 && m.serviceJobs === 1, m);
r = await owner('erpExpenses', [{}]);
check('the Expenses screen agrees with it', r.ok && r.result.net === m.net, [r.result && r.result.net, m && m.net]);

// ---------------------------------------------------------------- cancelling
const s1 = await stock(PLA);
r = await sales('erpJobSave', [{ jobNo: J1, status: 'cancelled' }]);
check('cancelling is a manager matter', !r.ok, r);
r = await mgr('erpJobSave', [{ jobNo: J1, status: 'cancelled' }]);
check('cancelled: the part is back, charge 0', r.ok && r.result.job.status === 'cancelled' && (await stock(PLA)) === s1 + 1 && r.result.job.charge === 0, r.result && r.result.job);
r = await mgr('erpJobSave', [{ jobNo: J1, status: 'received' }]);
check('a cancelled job stays cancelled', !r.ok && /was cancelled/.test(r.error), r);
const o2 = await sql`select count(*)::int n from service_jobs where business_id = ${FIX.B2}`;
check('another business has none', o2[0].n === 0);
await done();
