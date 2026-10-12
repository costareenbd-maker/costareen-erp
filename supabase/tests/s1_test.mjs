// Sheet build b261003-0358: Steadfast Express, consignment numbers on invoices, delivered parcels clear their due.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, web, deps, fnDir } from './harness.mjs';
const { runJob } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const B = FIX.B;
async function inv(no, o) {
  const r = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, customer_address,
                        grand_total, delivery_charge, due_amount, payment_status, note, source, created_at)
    values (${B}, ${no}, ${o.name}, ${o.phone}, ${o.address || 'Dhaka'}, ${o.grand}, ${o.delivery || 0},
            ${o.grand}, 'Pending', ${o.note || ''}, ${o.source || 'Steadfast courier'}, now() - interval '1 day') returning id`;
  await sql`insert into invoice_lines (business_id, invoice_id, sku, name, qty, unit_price, line_total)
            values (${B}, ${r[0].id}, 'FIL-SUN-PLA-BLA-001', 'Sunlu PLA Black', 1, ${o.grand}, ${o.grand})`;
}
await inv('INV-X1', { name: 'Karim', phone: '01712345678', grand: 1500, source: 'Steadfast Express' });
await inv('INV-X2', { name: 'Rahim', phone: '01811111111', grand: 2000, source: 'Steadfast Express' });
await inv('INV-X3', { name: 'Salma', phone: '01922222222', grand: 900 });
await inv('INV-X4', { name: 'Dipu', phone: '01733333333', grand: 700 });
await inv('INV-W1', { name: 'Web Buyer', phone: '01788888888', grand: 1550, note: 'WEB-777' });
const status = async (no) => (await sql`select payment_status, due_amount, grand_total, delivery_charge from invoices where business_id = ${B} and invoice_no = ${no}`)[0];
const says = { 9001: 'delivered', 9002: 'in_review', 9003: 'cancelled', 9004: 'partial_delivered' };
web.on(/\/status_by_cid\//, (url) => {
  const cid = url.split('/').pop();
  return says[cid] ? { status: 200, body: { status: 200, delivery_status: says[cid] } } : { status: 401, body: { status: 401, message: 'Consignment not found' } };
});
web.on(/\/get_balance$/, () => ({ status: 200, body: { status: 200, current_balance: 1 } }));

// ---------------------------------------------------------------- the delivery list
let r = await sales('erpFormOptions', []);
check('Steadfast Express is a way to deliver', r.ok && r.result.sources.includes('Steadfast Express') && r.result.sources.includes('Steadfast courier'), r.result && r.result.sources);

// ---------------------------------------------------------------- the consignment number on an invoice
r = await sales('erpExpressLink', [{ invoiceNo: '', consignment: '9001' }]);
check('which invoice?', !r.ok && r.error === 'Which invoice?', r);
r = await sales('erpExpressLink', [{ invoiceNo: 'INV-X1', consignment: 'x!' }]);
check('a consignment number looks like one', !r.ok && /does not look like a consignment number/.test(r.error), r);
r = await sales('erpExpressLink', [{ invoiceNo: 'INV-NOPE', consignment: '9001' }]);
check('unknown invoice', !r.ok && /No invoice called INV-NOPE/.test(r.error), r);
r = await sales('erpExpressLink', [{ invoiceNo: 'INV-X1', consignment: ' 90 01 ' }]);
check('linked without courier keys: written down, Steadfast not asked', r.ok && r.result.consignment === '9001' && r.result.asked === false && r.result.found === false && r.result.collect === 1500, r);
const log = await sql`select consignment_id, cod_amount, note from courier_log where business_id = ${B} and invoice_no = 'INV-X1'`;
check('the parcel is in the courier log, marked express', log.length === 1 && log[0].consignment_id === '9001' && Number(log[0].cod_amount) === 1500 && /^\[express\]/.test(log[0].note), log);
r = await sales('erpExpressLink', [{ invoiceNo: 'INV-X1', consignment: '9009' }]);
check('one invoice, one parcel', !r.ok && /already has a parcel: consignment 9001/.test(r.error), r);
r = await sales('erpExpressLink', [{ invoiceNo: 'INV-X2', consignment: '9001' }]);
check('one parcel, one invoice', !r.ok && /Consignment 9001 is already on invoice INV-X1/.test(r.error), r);
await owner('erpCourierSetKeys', [{ apiKey: 'K1', apiSecret: 'S1' }]);
r = await sales('erpExpressLink', [{ invoiceNo: 'INV-X2', consignment: '9002' }]);
check('with keys Steadfast is asked, and its answer shown', r.ok && r.result.asked && r.result.found && r.result.status === 'in_review' && !!r.result.statusLabel, r);
r = await mgr('erpExpressLink', [{ invoiceNo: 'INV-X3', consignment: '9003', express: false }]);
check('a regular parcel booked in the panel is tied the same way', r.ok && /^\[panel\]/.test((await sql`select note from courier_log where business_id = ${B} and invoice_no = 'INV-X3'`)[0].note), r);
r = await mgr('erpExpressLink', [{ invoiceNo: 'INV-X4', consignment: '9004', express: false }]);
r = await mgr('erpExpressLink', [{ invoiceNo: 'INV-W1', consignment: '99999' }]);
check('a number Steadfast does not know is still written down', r.ok && r.result.asked === true && r.result.found === false, r);
r = await mgr('erpInvoice', [{ invoiceNo: 'INV-X1' }]);
check('the invoice page: Express is not a parcel to post, and shows its consignment', r.ok && r.result.courier === false && r.result.parcel && r.result.parcel.consignment === '9001', r.result && [r.result.courier, r.result.parcel]);

// ---------------------------------------------------------------- delivered parcels clear their due
r = await sales('erpCheckDeliveries', []);
check('checking deliveries records payments: managers and up', !r.ok, r);
r = await mgr('erpCheckDeliveries', []);
check('asked about every parcel on an unpaid invoice', r.ok && r.result.checked === 5, r.result);
check('the delivered one is collected: due cleared', r.result.collected.length === 1 && r.result.collected[0].invoice === 'INV-X1' && r.result.collected[0].amount === 1500 &&
  (await status('INV-X1')).payment_status === 'Paid', [r.result.collected, await status('INV-X1')]);
check('came back and part delivered are listed for a person, not guessed at', r.result.back.length === 1 && r.result.back[0].invoice === 'INV-X3' && r.result.part.length === 1 && r.result.part[0].invoice === 'INV-X4' &&
  (await status('INV-X3')).payment_status === 'Pending', [r.result.back, r.result.part]);
const pay = await sql`select amount, method, note, recorded_by from payments where business_id = ${B} and invoice_no = 'INV-X1'`;
check('the payment says where the money is', pay.length === 1 && Number(pay[0].amount) === 1500 && pay[0].method === 'COD (Steadfast)' && /\[sf:9001\]/.test(pay[0].note) && pay[0].recorded_by === 'Courier', pay);
r = await mgr('erpCheckDeliveries', []);
check('asked again: nothing is collected twice', r.ok && r.result.collected.length === 0 && (await sql`select count(*)::int n from payments where business_id = ${B} and invoice_no = 'INV-X1'`)[0].n === 1, r.result);
const dc = await sql`select by, asked, collected, came_back, part, said from delivery_checks where business_id = ${B} order by id`;
check('every round is written down', dc.length === 2 && dc[0].collected === 'INV-X1' && dc[0].came_back === 'INV-X3' && dc[0].part === 'INV-X4' && /INV-X2 9002 in_review/.test(dc[0].said) && dc[0].by === 'Mehedi', dc);
await sql`delete from erp_dash_cache`;
r = await owner('erpBundle', [['dash']]);
check('the dashboard counts the parcels that came back', r.ok && r.result.dash.alerts.courier && r.result.dash.alerts.courier.back === 2, r.result && r.result.dash && r.result.dash.alerts);

// ---------------------------------------------------------------- the hourly visit
says[9002] = 'delivered';
r = await runJob(deps, 'deliveries');
check('the hourly job collects what was delivered since', r && r.Costareen && r.Costareen.collected === 1 && (await status('INV-X2')).payment_status === 'Paid', r);
const none = await sql`select count(*)::int n from delivery_checks where business_id = ${FIX.B2}`;
check('a business with no courier and no parcels is left alone', none[0].n === 0);
await done();
