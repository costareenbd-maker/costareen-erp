// Courier (Steadfast) group: parcels, payouts, the parcel-by-parcel check.
// Run: TEST_SCRIPT=courier_test.mjs ... erp_server_test.py
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, web, deps, fnDir } from './harness.mjs';

const courier = await import(pathToFileURL(path.join(fnDir, 'handlers', 'courier.js')));
const B = FIX.B;
const SF = 'https://portal.packzy.com/api/v1';

// ---- seed: invoices as the sheet would hold them --------------------------------
async function inv(no, o) {
  const r = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, customer_address,
                        grand_total, delivery_charge, due_amount, payment_status, note, source, created_at)
    values (${B}, ${no}, ${o.name ?? ''}, ${o.phone ?? ''}, ${o.address ?? ''}, ${o.grand}, ${o.delivery || 0},
            ${o.grand}, 'Pending', ${o.note || ''}, 'Steadfast courier', now() - interval '2 days') returning id`;
  await sql`insert into invoice_lines (business_id, invoice_id, sku, name, qty, unit_price, line_total)
            values (${B}, ${r[0].id}, 'FIL-SUN-PLA-BLA-001', 'Sunlu PLA Black', 1, ${o.grand}, ${o.grand})`;
}
await inv('INV-A', { name: 'Karim', phone: '01712345678', address: 'Dhaka', grand: 1500, delivery: 100 });
await inv('INV-B', { name: 'Rahim', phone: '01811111111', address: 'Mirpur', grand: 2000 });
await inv('INV-C', { name: 'Salma', phone: '01922222222', address: 'Uttara', grand: 3000 });
await inv('INV-D', { name: 'Dipu', phone: '01733333333', address: 'Banani', grand: 1000 });
await inv('INV-E', { name: 'Emon', phone: '01744444444', address: '', grand: 500 });
await inv('INV-F', { name: 'Nasir', phone: '01633333333', address: 'Khulna', grand: 800 });
await inv('INV-G', { name: 'Tania', phone: '01544444444', address: 'Sylhet', grand: 900 });
await inv('INV-H', { name: 'Hasan', phone: '01755555555', address: 'Gulshan', grand: 2000 });
await inv('INV-K', { name: 'Kona', phone: '01766666666', address: 'Badda', grand: 600 });
await inv('INV-L', { name: 'Lina', phone: '01777777777', address: 'Rampura', grand: 400 });
await inv('INV-W', { name: 'Web Buyer', phone: '01788888888', address: 'Comilla', grand: 700, note: 'WEB-555' });
// INV-B: 500 already received
await sql`insert into payments (business_id, payment_no, invoice_no, customer, amount, method, note, paid_at)
          values (${B}, 'P-B1', 'INV-B', 'Rahim', 500, 'bKash', 'advance at order', now() - interval '2 days')`;
await sql`update invoices set advance_paid = 500, due_amount = 1500, payment_status = 'Partial'
          where business_id = ${B} and invoice_no = 'INV-B'`;

const logCount = async () => (await sql`select count(*)::int as n from courier_log where business_id = ${B}`)[0].n;
const status = async (no) => (await sql`select payment_status, due_amount from invoices where business_id = ${B} and invoice_no = ${no}`)[0];

// ---- fake Steadfast ---------------------------------------------------------------
let createMode = 'ok', cidNext = 1001;
const created = [];
web.on(/\/create_order$/, (url, opts) => {
  const b = JSON.parse(opts.body);
  created.push({ body: b, headers: opts.headers });
  if (createMode === '401') return { status: 401, body: { message: 'Unauthorized' } };
  if (createMode === 'invalid') return { status: 422, body: { status: 422, errors: { recipient_phone: ['The recipient phone must be 11 digits.'], x: ['y'] } } };
  if (createMode === 'nocid') return { status: 200, body: { status: 200, message: 'queued' } };
  if (createMode === 'junk') return { status: 502, body: '<html>Bad gateway</html>' };
  return { status: 200, body: { status: 200, message: 'Consignment has been created successfully.',
    consignment: { consignment_id: cidNext++, invoice: b.invoice, tracking_code: 'TRK' + b.invoice, status: 'in_review' } } };
});
let balanceMode = 'ok';
web.on(/\/get_balance$/, () => {
  if (balanceMode === '401') return { status: 401, body: { message: 'invalid api credentials' } };
  if (balanceMode === 'odd') return { status: 200, body: { status: 500, message: 'oops' } };
  return { status: 200, body: { status: 200, current_balance: 4321.4 } };
});
web.on(/\/status_by_cid\//, (url) => {
  if (url.endsWith('/1001')) return { status: 200, body: { status: 200, delivery_status: 'delivered' } };
  if (url.endsWith('/1005')) return { status: 200, body: { status: 200, delivery_status: 'in_review' } };
  return { status: 401, body: { status: 401, message: 'Consignment not found' } };   // not ours: not a key problem
});

// ---- keys ----------------------------------------------------------------------------
let r = await mgr('erpCourierKeyStatus', []);
check('key status: none yet, business name', r.ok && r.result.hasKey === false && r.result.hasSecret === false && r.result.business === 'Costareen', r);
r = await mgr('erpParcelPreview', [{ invoiceNo: 'INV-A' }]);
check('preview without keys: hasKeys false, ready', r.ok && r.result.hasKeys === false && r.result.ready === true &&
  r.result.collect === 1500 && r.result.total === 1500 && r.result.received === 0 && r.result.alreadyBooked === '', r);
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500 }]);
check('book without keys refused', !r.ok && /^This business has no courier keys yet\. Settings → Courier/.test(r.error), r);
r = await owner('erpCourierTest', []);
check('test without keys -> ok:false with the reason', r.ok && r.result.ok === false && /no courier keys yet/.test(r.result.error), r);

r = await mgr('erpCourierSetKeys', [{ apiKey: 'K1', apiSecret: 'S1' }]);
check('manager cannot set keys', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await owner('erpCourierSetKeys', [{ apiKey: 'K1', apiSecret: '' }]);
check('both keys needed', !r.ok && r.error === 'Both the API key and the secret key are needed.', r);
r = await owner('erpCourierSetKeys', [{ apiKey: ' K1 ', apiSecret: 'S1' }]);
check('owner sets keys', r.ok && r.result.ok && r.result.hasKey && r.result.hasSecret, r);
const sec = await sql`select key, value from business_secrets where business_id = ${B} order by key`;
check('keys stored per business, trimmed', sec.length === 2 && sec.find((s) => s.key === 'ERP_SF_KEY').value === 'K1', sec);
r = await mgr('erpCourierKeyStatus', []);
check('key status: set, and the keys are not in the reply', r.ok && r.result.hasKey && r.result.hasSecret &&
  !JSON.stringify(r.result).includes('K1') && !JSON.stringify(r.result).includes('S1'), r);
r = await owner('erpCourierTest', []);
check('test: 200 with balance -> ok', r.ok && r.result.ok === true && r.result.reply === 'connected' && r.result.balance === 4321.4, r);
const balCall = web.calls.find((c) => /get_balance/.test(c.url));
check('Steadfast headers api-key / secret-key', balCall && balCall.opts.headers['api-key'] === 'K1' && balCall.opts.headers['secret-key'] === 'S1', balCall && balCall.opts.headers);
balanceMode = '401';
r = await owner('erpCourierTest', []);
check('test: 401 -> keys refused', r.ok && r.result.ok === false && r.result.error === 'Steadfast refused the keys for this business. Check them in Settings → Courier.', r);
balanceMode = 'odd';
r = await owner('erpCourierTest', []);
check('test: answer without balance', r.ok && r.result.ok === false && r.result.error === 'Steadfast answered, but not with the account balance.', r);
balanceMode = 'ok';
r = await mgr('erpCourierTest', []);
check('manager cannot test keys', !r.ok && r.error === 'Your account does not have access to that.', r);

// ---- preview + booking --------------------------------------------------------------------
r = await mgr('erpParcelPreview', [{ invoiceNo: '' }]);
check('preview: which invoice', !r.ok && r.error === 'Which invoice?', r);
r = await mgr('erpParcelPreview', [{ invoiceNo: 'INV-NOPE' }]);
check('preview: unknown invoice', !r.ok && r.error === 'No invoice called INV-NOPE.', r);
r = await mgr('erpParcelPreview', [{ invoiceNo: 'INV-E' }]);
check('preview: missing address, not ready', r.ok && JSON.stringify(r.result.missing) === '["address"]' && r.result.ready === false && r.result.hasKeys === true, r);
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-E', expect: 500 }]);
check('book: missing field sentence (as original)', !r.ok && r.error === 'The courier needs a address. Add it to the invoice first.', r);
r = await mgr('erpParcelPreview', [{ invoiceNo: 'INV-B' }]);
check('preview: part paid -> collect the rest', r.ok && r.result.collect === 1500 && r.result.received === 500 && r.result.total === 2000, r);

r = await sales('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500 }]);
check('sales cannot book', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1000 }]);
check('book: amount drift refused', !r.ok && r.error === 'The amount changed while you were looking: this parcel would collect 1500, not 1000. Open it again.', r);
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500, phone: '0171' }]);
check('book: phone too short', !r.ok && r.error === 'That phone number is too short for the courier.', r);

createMode = 'invalid';
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500 }]);
check('book: validation error -> first field message', !r.ok && r.error === 'Steadfast would not take it. recipient_phone: The recipient phone must be 11 digits.', r);
createMode = '401';
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500 }]);
check('book: 401 -> keys refused', !r.ok && r.error === 'Steadfast refused the keys for this business. Check them in Settings → Courier.', r);
createMode = 'nocid';
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500 }]);
check('book: 200 without consignment', !r.ok && r.error === 'Steadfast would not take it. {"status":200,"message":"queued"}', r);
createMode = 'junk';
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500 }]);
check('book: unreadable reply', !r.ok && r.error === 'Steadfast replied with something unreadable (HTTP 502).', r);
check('failed bookings logged nothing', (await logCount()) === 0);
createMode = 'ok';

r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500, name: '', phone: '', address: '' }]);
check('book INV-A: consignment 1001, not changed', r.ok && r.result.consignment === '1001' && r.result.collect === 1500 &&
  r.result.total === 1500 && r.result.customer === 'Karim' && r.result.address === 'Dhaka' && r.result.changed === false, r);
const sent = created[created.length - 1];
check('create_order body: invoice ref, 0+last10 phone, cod = owed', sent.body.invoice === 'INV-A' && sent.body.recipient_phone === '01712345678' &&
  sent.body.cod_amount === 1500 && sent.body.recipient_name === 'Karim' && sent.body.recipient_address === 'Dhaka' &&
  sent.headers['api-key'] === 'K1', sent);
let log = (await sql`select * from courier_log where business_id = ${B} and invoice_no = 'INV-A'`)[0];
check('COURIER_LOG row', log && log.consignment_id === '1001' && log.cod_amount === 1500 && log.invoice_total === 1500 &&
  log.booked_by === 'Mehedi' && log.note === '', log);
r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-A', expect: 1500 }]);
check('book twice refused', !r.ok && r.error === 'Invoice INV-A already has a parcel (consignment 1001). Booking it again would send two.', r);
r = await mgr('erpParcelPreview', [{ invoiceNo: 'INV-A' }]);
check('preview shows alreadyBooked', r.ok && r.result.alreadyBooked === '1001' && r.result.ready === false, r);

r = await mgr('erpBookParcel', [{ invoiceNo: 'INV-B', expect: 1500, phone: '+880 1811-111111', address: 'Office, Motijheel', note: 'fragile' }]);
check('book INV-B to a one-off address', r.ok && r.result.consignment === '1002' && r.result.changed === true && r.result.collect === 1500, r);
check('one-off phone sent as 0 + last 10', created[created.length - 1].body.recipient_phone === '01811111111' && created[created.length - 1].body.note === 'fragile');
log = (await sql`select * from courier_log where business_id = ${B} and invoice_no = 'INV-B'`)[0];
check('one-off noted in COURIER_LOG, typed phone kept', log.note === 'sent to a one-off address. fragile' && log.phone === '+880 1811-111111' && log.address === 'Office, Motijheel', log);
for (const [no, ex] of [['INV-C', 3000], ['INV-D', 1000], ['INV-H', 2000], ['INV-K', 600]]) {
  r = await mgr('erpBookParcel', [{ invoiceNo: no, expect: ex }]);
  if (!r.ok) check('book ' + no, false, r);
}
const cids = Object.fromEntries((await sql`select invoice_no, consignment_id from courier_log where business_id = ${B}`).map((x) => [x.invoice_no, x.consignment_id]));
check('consignments 1003 C, 1004 D, 1005 H, 1006 K', cids['INV-C'] === '1003' && cids['INV-D'] === '1004' && cids['INV-H'] === '1005' && cids['INV-K'] === '1006', cids);

// ---- set aside / put back --------------------------------------------------------------
r = await mgr('erpParcelHandled', [{ invoiceNo: 'INV-L', consignment: ' 77 88 ' }]);
check('handled with a number: tracked, spaces stripped', r.ok && r.result.tracked === true && r.result.consignment === '7788', r);
log = (await sql`select * from courier_log where business_id = ${B} and invoice_no = 'INV-L'`)[0];
check('handled row: cod = owed, by hand note', log.cod_amount === 400 && log.note === 'booked outside the ERP. [by hand]', log);
r = await mgr('erpParcelHandled', [{ invoiceNo: 'INV-L', consignment: '' }]);
check('handled twice refused', !r.ok && r.error === 'Invoice INV-L is already off the list.', r);
r = await mgr('erpParcelPutBack', [{ invoiceNo: 'INV-L' }]);
check('put back a by-hand row', r.ok && r.result.ok && r.result.invoiceNo === 'INV-L' && !(await sql`select 1 from courier_log where business_id = ${B} and invoice_no = 'INV-L'`).length, r);
r = await mgr('erpParcelPutBack', [{ invoiceNo: 'INV-L' }]);
check('put back: not set aside', !r.ok && r.error === 'Invoice INV-L is not set aside.', r);
r = await mgr('erpParcelPutBack', [{ invoiceNo: 'INV-K' }]);
check('put back a real booking refused', !r.ok && r.error === 'That parcel was booked with Steadfast (consignment 1006). Cancel it in their portal first.', r);
r = await mgr('erpParcelHandled', [{ invoiceNo: 'INV-L', consignment: '', note: 'customer collected' }]);
check('handled without a number: not tracked, cod 0', r.ok && r.result.tracked === false, r);
log = (await sql`select * from courier_log where business_id = ${B} and invoice_no = 'INV-L'`)[0];
check('no-parcel note', log.cod_amount === 0 && log.note === 'no parcel needed. customer collected [by hand]' && log.consignment_id === '', log);
r = await mgr('erpParcelHandled', [{ invoiceNo: 'INV-NOPE' }]);
check('handled: unknown invoice', !r.ok && r.error === 'No invoice called INV-NOPE.', r);

// ---- booked parcels (status + paid-since warning) -----------------------------------------
await mgr('erpSettleDue', [{ orderId: 'INV-H', amount: 100, method: 'Cash' }]);
r = await mgr('erpBookedParcels', [{}]);
const bp = r.ok ? r.result.parcels : [];
const pA = bp.find((p) => p.invoiceNo === 'INV-A'), pH = bp.find((p) => p.invoiceNo === 'INV-H'), pK = bp.find((p) => p.invoiceNo === 'INV-K');
check('booked parcels newest first, courier words', r.ok && bp[0].invoiceNo === 'INV-L' && pA.courierLabel === 'Delivered' && pA.tone === 'ok' &&
  pH.courierLabel === 'With the courier' && r.result.hasKeys === true, r.result);
check("status 401 for a parcel that is not ours -> 'No answer yet', not a key error", pK && pK.courier === '' && pK.courierLabel === 'No answer yet', pK);
check('warning: paid 100 after the parcel went out', r.result.warnings.length === 1 && r.result.warnings[0].invoiceNo === 'INV-H' &&
  r.result.warnings[0].paidSince === 100 && r.result.warnings[0].collect === 2000, r.result.warnings);

// ---- payouts ------------------------------------------------------------------------------
const processing = Array.from({ length: 9 }, (_, i) => ({ payment_id: 'Q' + i, status_label: 'Processing', amount: 100, total: 90 }));
let payoutsBroken = false;
web.on(/\/payments\?page=/, (url) => {
  if (payoutsBroken) return { status: 500, body: 'Server Error' };
  const page = Number(/page=(\d+)/.exec(url)[1]);
  if (page === 1) return { status: 200, body: { status: 200, payments: [{ payment_id: 'P1', status_label: 'Paid', amount: 10000, total: 9300 }, ...processing] } };
  if (page === 2) return { status: 200, body: { status: 200, payments: [{ payment_id: 'P2', status_label: 'paid', amount: 500, total: 435 }] } };
  return { status: 200, body: { status: 200, payments: [] } };
});
const today = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 10) + ' 10:00:00';
const line = (cid, phone, cod, extra = {}) => ({ consignment_id: cid, tracking_code: 'T' + cid, cod_amount: cod, status: 'delivered',
  recipient_name: 'R' + cid, recipient_phone: phone, created_at: today, ...extra });
web.on(/\/payments\/P1$/, () => ({ status: 200, body: { status: 200, payment: {
  payment_id: 'P1', created_at: '2026-10-01 18:00:00', paid_at: '2026-10-02 11:00:00', amount: 10000, due_bills: 600, charges: 100, total: 9300,
  consignments: [
    line(1001, '01712345678', 1500, { delivery_charge: 60, cod_charge: 15 }),
    line(1002, '01811111111', 1400, { delivery_fee: 70 }),
    line(1003, '01922222222', 2500),
    line(1004, '01733333333', 1200),
    line(1005, '01755555555', 1000),
    line(2001, '8801633333333', 800),               // booked by hand: phone + amount agree
    line(2002, '01544444444', 850),                 // phone agrees, amount does not
    line(2004, '01544444444', 300, { created_at: '2020-01-01 10:00:00' }),   // before any invoice: no match
    line(3001, '01000000000', 450),                 // nobody
    line(4001, '01788888888', 700),                 // the website booked it
  ] } } }));
web.on(/\/payments\/P2$/, () => ({ status: 200, body: { status: 200, payment: {
  payment_id: 'P2', created_at: '2026-10-02 18:00:00', paid_at: '', amount: 500, due_bills: 60, charges: 5, total: 435,
  consignments: [line(5001, '01399999999', 500)] } } }));
// the website knows website orders' consignments
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'CZ_SYNC_KEY', 'czk') on conflict do nothing`;
web.on(/costareen\.com\/wp-json\/cz\/v1\/cod\?days=120/, (url, opts) =>
  ({ status: opts.headers['x-cz-key'] === 'czk' ? 200 : 403, body: { orders: [{ order_no: '555', consignment: '4001' }] } }));

r = await sales('erpSfPayouts', [{}]);
check('sales cannot see courier money', !r.ok && r.error === 'Your account does not have access to that.', r);
web.calls.length = 0;
r = await mgr('erpSfPayouts', [{}]);
const S = r.result || {};
check('payouts ran', r.ok, r);
check('read two pages (stopped under 10)', web.calls.filter((c) => /payments\?page=/.test(c.url)).map((c) => c.url.slice(-1)).join(',') === '1,2', web.calls.map((c) => c.url));
check('two paid payouts added, newest first', S.added === 2 && S.payouts.length === 2 && S.payouts[0].id === 'P2' && S.payouts[1].id === 'P1', S.payouts);
const P1 = S.payouts && S.payouts[1];
check('payout P1 figures', P1 && P1.paidAt === '2026-10-02' && P1.collected === 10000 && P1.delivery === 600 && P1.fee === 100 &&
  P1.paid === 9300 && P1.parcels === 10, P1);
check('P1 matched: 6 exact, 2 by phone, 2 unknown', P1 && P1.matched.exact === 6 && P1.matched.phone === 2 && P1.matched.none === 2, P1 && P1.matched);
check('P1 charged = delivery on its 8 invoices (100 on INV-A)', P1 && P1.charged === 100 && P1.chargedOn === 8, P1);
check('P2 paidAt falls back to created_at', S.payouts[0].paidAt === '2026-10-02' && S.payouts[0].matched.none === 1, S.payouts[0]);
check('totals', S.totals.paid === 9735 && S.totals.delivery === 660 && S.totals.fee === 105 && S.totals.collected === 10500, S.totals);
check('coming: the 9 unpaid payouts', S.coming.length === 9 && S.coming[0].status === 'Processing' && S.coming[0].paid === 90, S.coming);
check('auto-recorded 7 invoices, 8900', S.autoRecorded === 7 && S.autoAmount === 8900 && S.autoChecked === 7, [S.autoRecorded, S.autoAmount, S.autoChecked]);
check('recon summary: 3 ok, 1 writeoff 100, 1 extra 200, 2 review', S.recon.ok === 3 && S.recon.writeoff === 1 && S.recon.writeoffSum === 100 &&
  S.recon.extra === 1 && S.recon.extraSum === 200 && S.recon.review.length === 2 && S.recon.limit === 200, S.recon);
const rvC = S.recon.review.find((x) => x.consignment === '1003');
check('review row for INV-C: expected 3000, collected 2500, short 500', rvC && rvC.invoice === 'INV-C' && rvC.expected === 3000 && rvC.collected === 2500 && rvC.amount === 500 && rvC.customer === 'Salma', rvC);
check('pending phone match: INV-G owes 900, rider 850', S.pending.length === 1 && S.pending[0].invoice === 'INV-G' && S.pending[0].owed === 900 &&
  S.pending[0].cod === 850 && S.pending[0].consignment === '2002' && S.pending[0].payout === 'P1', S.pending);
check('waiting: INV-K only (no-parcel row not tracked)', S.waiting.length === 1 && S.waiting[0].invoice === 'INV-K' && S.waiting[0].cod === 600 && S.waitingCod === 600, S.waiting);
check('balance from Steadfast, rounded', S.balance === 4321, S.balance);
check('no night run yet', S.night === null, S.night);

const pays = await sql`select payment_no, invoice_no, amount, method, note, recorded_by from payments where business_id = ${B} and (note like '%[sf:%' or note like '%[sfadj:%') order by seq`;
const payA = pays.find((p) => p.invoice_no === 'INV-A');
check('COD payment row for INV-A', payA && payA.amount === 1500 && payA.method === 'COD (Steadfast)' && /^S\d{12}-\d+$/.test(payA.payment_no) &&
  payA.note === 'paid out by Steadfast in P1 [payment] [sf:1001]' && payA.recorded_by === 'Mehedi', payA);
const wB = pays.find((p) => p.invoice_no === 'INV-B' && p.method === 'Adjusted');
check('INV-B: 1400 paid + 100 written off automatically', pays.find((p) => p.invoice_no === 'INV-B' && p.method === 'COD (Steadfast)').amount === 1400 &&
  wB && wB.amount === 100 && wB.note === 'Steadfast collected 1400, the invoice expected 1500 - the courier figure stands [reduce] [sfadj:1002]', pays);
check('INV-D extra: only the owed 1000 recorded', pays.find((p) => p.invoice_no === 'INV-D').amount === 1000);
check('INV-W matched exactly through the website', pays.find((p) => p.invoice_no === 'INV-W') && pays.find((p) => p.invoice_no === 'INV-W').amount === 700);
check('INV-F matched by phone + amount', pays.find((p) => p.invoice_no === 'INV-F') && pays.find((p) => p.invoice_no === 'INV-F').amount === 800);
check('INV-G not recorded (amount differs)', !pays.find((p) => p.invoice_no === 'INV-G'));
let st = await status('INV-A');
check('INV-A Paid', st.payment_status === 'Paid' && st.due_amount === 0, st);
st = await status('INV-B');
check('INV-B Paid after the write-off', st.payment_status === 'Paid' && st.due_amount === 0, st);
st = await status('INV-C');
check('INV-C Partial, 500 still due (review)', st.payment_status === 'Partial' && st.due_amount === 500, st);
st = await status('INV-H');
check('INV-H owes 900 (2000 - 100 cash - 1000)', st.due_amount === 900, st);
const rec = await sql`select consignment_id, action, amount, gap, expected, collected, by from courier_recon where business_id = ${B} order by seq`;
check('recon rows written once each', rec.length === 7 && rec.find((x) => x.consignment_id === '1004').action === 'extra' &&
  rec.find((x) => x.consignment_id === '1004').amount === 200 && rec.find((x) => x.consignment_id === '1004').gap === -200 &&
  rec.find((x) => x.consignment_id === '1005').expected === 1900, rec);

// second open: nothing new fetched, nothing recorded twice, balance cached
web.calls.length = 0;
r = await mgr('erpSfPayouts', [{}]);
check('second run: nothing added or recorded', r.ok && r.result.added === 0 && r.result.autoRecorded === 0 && r.result.recon.review.length === 2, r.result);
check('second run: payout detail not fetched again, balance cached', !web.calls.some((c) => /payments\/P/.test(c.url) || /get_balance/.test(c.url)), web.calls.map((c) => c.url));
check('no duplicate recon rows', (await sql`select count(*)::int as n from courier_recon where business_id = ${B}`)[0].n === 7);

// ---- payout lines ---------------------------------------------------------------------------
r = await mgr('erpSfPayoutLines', [{ payoutId: 'P1' }]);
const L = r.ok ? r.result.lines : [];
const l1 = L.find((x) => x.consignment === '1001'), l2 = L.find((x) => x.consignment === '1002'), l3 = L.find((x) => x.consignment === '3001');
check('lines of P1 in order', r.ok && r.result.payoutId === 'P1' && L.length === 10 && L[0].consignment === '1001', r.result);
check('line 1001: exact, ok, delivery 60 fee 15', l1.invoice === 'INV-A' && l1.match === 'exact' && l1.check === 'ok' && l1.delivery === 60 && l1.codFee === 15 && l1.expected === 1500, l1);
check('line 1002: delivery from delivery_fee, no fee -> null, written off 100', l2.delivery === 70 && l2.codFee === null && l2.check === 'writeoff' && l2.gap === 100, l2);
check('line 3001: no invoice, not checked', l3.invoice === '' && l3.match === '' && l3.check === '' && l3.gap === 0 && l3.expected === null && l3.delivery === null, l3);
check('line 2004: dated before the invoice -> no phone match', L.find((x) => x.consignment === '2004').invoice === '');
check('line 2001: phone match', L.find((x) => x.consignment === '2001').match === 'phone' && L.find((x) => x.consignment === '2001').invoice === 'INV-F');

// ---- confirm phone matches ------------------------------------------------------------------
r = await mgr('erpSfConfirmMatches', [{ consignments: ['zzz'] }]);
check('confirm nothing', !r.ok && r.error === 'Nothing to confirm.', r);
r = await mgr('erpSfConfirmMatches', [{ consignments: ['2002'] }]);
check('confirm INV-G: 850 recorded, 50 written off', r.ok && r.result.recorded === 1 && r.result.amount === 850 && r.result.tally.writeoff === 1, r);
st = await status('INV-G');
check('INV-G Paid', st.payment_status === 'Paid', st);
r = await mgr('erpSfConfirmMatches', [{ consignments: ['2002'] }]);
check('confirm again: checked once only', r.ok && r.result.recorded === 0 && r.result.checked === 0, r);

// ---- the owner decides the large shortfalls -------------------------------------------------
r = await mgr('erpSfReconDecide', [{ consignment: '1003', decision: 'writeoff' }]);
check('manager refused (shareholder+)', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await owner('erpSfReconDecide', [{ consignment: '1003', decision: 'maybe' }]);
check('decision must be writeoff or keep', !r.ok && r.error === 'Write it off, or keep it as due?', r);
r = await owner('erpSfReconDecide', [{ consignment: '1003', decision: 'writeoff' }]);
check('write off INV-C 500', r.ok && r.result.amount === 500 && r.result.decision === 'writeoff', r);
const wC = (await sql`select * from payments where business_id = ${B} and invoice_no = 'INV-C' and method = 'Adjusted'`)[0];
check('write-off payment row', wC && wC.amount === 500 && wC.note === 'Steadfast collected 2500, the invoice expected 3000 - written off by Owner [reduce] [sfadj:1003]' && /^A\d{12}$/.test(wC.payment_no), wC);
st = await status('INV-C');
check('INV-C Paid', st.payment_status === 'Paid' && st.due_amount === 0, st);
r = await owner('erpSfReconDecide', [{ consignment: '1003', decision: 'writeoff' }]);
check('decided once', !r.ok && r.error === 'That parcel is not waiting for a decision.', r);
r = await owner('erpSfReconDecide', [{ consignment: '1005', decision: 'keep' }]);
check('keep INV-H shortfall as due', r.ok && r.result.amount === 0 && r.result.decision === 'keep', r);
const kH = (await sql`select action, amount, note, by from courier_recon where business_id = ${B} and consignment_id = '1005'`)[0];
check('recon row kept, amount 900', kH.action === 'kept' && kH.amount === 900 && kH.note === 'kept as due: the customer still owes it' && kH.by === 'Owner', kH);
st = await status('INV-H');
check('INV-H still owes 900', st.due_amount === 900, st);

r = await mgr('erpSfPayouts', [{}]);
check('after decisions: no review, writeoff 3 (100+50+500), kept 1', r.ok && r.result.recon.review.length === 0 && r.result.recon.writeoff === 3 &&
  r.result.recon.writeoffSum === 650 && r.result.recon.kept === 1 && r.result.pending.length === 0, r.result.recon);

// ---- exports for other groups ---------------------------------------------------------------
async function asOwner(fn) {
  return sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true),
                    set_config('request.jwt.claims', ${JSON.stringify({ sub: FIX.U.owner, role: 'authenticated' })}, true)`;
    const ctx = { tx, sql, s: { name: 'Owner', role: 'owner', businessName: 'Costareen' }, biz: B, now: new Date(), memo: {}, deps };
    return fn(ctx);
  });
}
let x = await asOwner((ctx) => courier.sfNeeds(ctx));
check('sfNeeds: nothing needs a person', x.review === 0 && x.pending === 0 && x.error === '', x);
x = await asOwner((ctx) => courier.sfBooked(ctx));
check('sfBooked: by invoice, byHand flag', x['INV-A'].consignment === '1001' && x['INV-A'].cod === 1500 && x['INV-L'].byHand === true && x['INV-A'].byHand === false && x['INV-A'].when instanceof Date, x);
x = await asOwner((ctx) => courier.sfChargesByMonth(ctx));
check('charges by month', x['2026-10'] === 765, x);
x = await asOwner((ctx) => courier.sfReconByMonth(ctx));
const mon = Object.values(x)[0] || {};
check('recon by month: extra 200, short 650', mon.extra === 200 && mon.short === 650, x);

x = await asOwner((ctx) => courier.sfNightly(ctx));
check('nightly: ran, nothing new', x && x.added === 0 && x.recorded === 0 && !x.error, x);
let night = (await sql`select value from business_config where business_id = ${B} and key = 'sf_night'`)[0];
check('nightly note stored in sf_night', night && JSON.parse(night.value).at > 0, night);
payoutsBroken = true;
x = await asOwner(async (ctx) => {
  const n = await courier.sfNightly(ctx);
  // the call carries on after the failure
  const c = await ctx.tx`select count(*)::int as n from courier_recon where business_id = ${ctx.biz}`;
  return { n, recon: c[0].n };
});
check('nightly failure: error noted, the transaction survives', x.n.error === 'Steadfast replied with something unreadable (HTTP 500).' && x.recon === 8, x);
r = await mgr('erpSfPayouts', [{}]);
check('a broken Steadfast fails the screen with the reason', !r.ok && r.error === 'Steadfast replied with something unreadable (HTTP 500).', r);
x = await asOwner((ctx) => courier.sfNeeds(ctx));
check('sfNeeds shows the night error', x.error === 'Steadfast replied with something unreadable (HTTP 500).', x);
payoutsBroken = false;
r = await mgr('erpSfPayouts', [{}]);
check('night info on the screen', r.ok && r.result.night && /^\d+ \w{3}, \d+:\d{2} (AM|PM)$/.test(r.result.night.when) && r.result.night.error === 'Steadfast replied with something unreadable (HTTP 500).', r.result && r.result.night);

// balance: cache expiry, then the website fallback without keys
await sql`update business_config set value = ${JSON.stringify({ at: Date.now() - 31 * 60e3, v: 1 })} where business_id = ${B} and key = 'sf_balance_cache'`;
web.calls.length = 0;
x = await asOwner((ctx) => courier.sfBalance(ctx));
check('stale cache -> asked again', x === 4321 && web.calls.some((c) => /get_balance/.test(c.url)), x);
web.calls.length = 0;
x = await asOwner((ctx) => courier.sfBalance(ctx));
check('fresh cache -> not asked', x === 4321 && !web.calls.length, x);
r = await owner('erpCourierSetKeys', [{ clear: true }]);
check('owner clears keys', r.ok && r.result.cleared === true && r.result.hasKey === false, r);
r = await mgr('erpSfPayouts', [{}]);
check('no keys -> noKeys', r.ok && r.result.noKeys === true && r.result.payouts.length === 0, r);
await sql`delete from business_config where business_id = ${B} and key = 'sf_balance_cache'`;
web.on(/cz\/v1\/cod\?days=1&limit=1/, () => ({ status: 200, body: { orders: [], balance: 999.6 } }));
x = await asOwner((ctx) => courier.sfBalance(ctx));
check('no keys -> balance from the website', x === 1000, x);
x = await asOwner((ctx) => courier.sfNightly(ctx));
check('nightly skips a business without keys', x === null, x);

// another business never sees these rows
const other = await sql`select count(*)::int as n from courier_payouts where business_id <> ${B}`;
check('all courier rows belong to B', other[0].n === 0);

await done();
