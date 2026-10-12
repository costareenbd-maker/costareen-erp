// tidy-1: paid now / cash on delivery / part paid / due; delivery types; delivered & collected; COD not "at risk".
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
let n = 0;
// enough stock for every sale below
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference)
          select business_id, id, 'RECEIVE', 'IN', 50, 900, 45000, 't1 top-up' from products where business_id = ${B} and sku = ${PLA}`;
const sale = (payMode, extra = {}) => owner('erpCreateInvoice', [{ customer: { name: 'T1 Buyer ' + (++n), phone: '0171100' + String(1000 + n), address: 'Road ' + n, source: extra.source || 'Steadfast courier' },
  items: [{ sku: PLA, qty: 1 }], deliveryCharge: 100, payMode, ...extra }]);
const inv = async (no) => (await sql`select payment_method, payment_status, advance_paid, due_amount, grand_total from invoices where business_id = ${B} and invoice_no = ${no}`)[0];
const pays = async (no) => sql`select method, amount, note from payments where business_id = ${B} and invoice_no = ${no} order by paid_at`;

// paid now
let r = await sale('full', { paymentMethod: 'COD' });
check('paid now with COD as the method is refused', !r.ok && /its own choice/.test(r.error), r);
r = await sale('full', { paymentMethod: 'bKash' });
let i = await inv(r.result.invoiceNo), p = await pays(r.result.invoiceNo);
check('paid now: Paid, the money by bKash', r.ok && i.payment_status === 'Paid' && i.payment_method === 'bKash' && p.length === 1 && p[0].method === 'bKash' && Number(p[0].amount) === Number(i.grand_total), [i, p]);

// due
r = await sale('none', { paymentMethod: 'Cash' });
i = await inv(r.result.invoiceNo);
check('due: Pending, no method, nothing received', r.ok && i.payment_status === 'Pending' && i.payment_method === '' && (await pays(r.result.invoiceNo)).length === 0, i);

// part paid
r = await sale('part', { paidNow: 0, paymentMethod: 'Cash' });
i = await inv(r.result.invoiceNo);
check('part paid with 0 is a due', r.ok && i.payment_status === 'Pending' && i.payment_method === '', i);
r = await sale('part', { paidNow: 500, paymentMethod: 'Cash' });
i = await inv(r.result.invoiceNo);
check('part paid 500: Partial, 500 by Cash', r.ok && i.payment_status === 'Partial' && Number(i.advance_paid) === 500 && i.payment_method === 'Cash', i);
r = await sale('part', { paidNow: 999999, paymentMethod: 'Cash' });
i = await inv(r.result.invoiceNo);
check('part paid with everything is paid', r.ok && i.payment_status === 'Paid' && Number(i.due_amount) === 0, i);

// cash on delivery
r = await sale('cod', { source: 'Customer pickup' });
check('COD on a pickup is refused', !r.ok && /pickup/.test(r.error), r);
r = await sale('cod', { paidNow: 100 });
check('COD advance without a method is refused', !r.ok && /advance/.test(r.error), r);
r = await sale('cod', { paidNow: 100, advanceMethod: 'COD' });
check('...and COD is not a method for the advance', !r.ok, r);
r = await sale('cod', { paidNow: 100, advanceMethod: 'bKash' });
const codNo = r.result && r.result.invoiceNo;
i = await inv(codNo); p = await pays(codNo);
check('COD + 100 advance by bKash: method COD, Partial, the advance by bKash', r.ok && i.payment_method === 'COD' && i.payment_status === 'Partial' && p.length === 1 && p[0].method === 'bKash' && Number(p[0].amount) === 100, [i, p]);
r = await sale('cod');
const cod2 = r.result.invoiceNo;
i = await inv(cod2);
check('COD with nothing now: Pending, all owed', r.ok && i.payment_method === 'COD' && i.payment_status === 'Pending' && Number(i.due_amount) === Number(i.grand_total), i);

// at risk: COD is with the courier, not the customer
await sql`update invoices set created_at = now() - interval '20 days' where business_id = ${B} and invoice_no = ${cod2}`;
r = await mgr('erpRisks', []);
check('COD dues are "with the courier", not overdue customers; 20 days old is late', r.ok && !r.result.overdue.some((x) => x.invoice === cod2) &&
  r.result.withCourier.some((x) => x.invoice === cod2 && x.late) && r.result.totals.withCourier > 0, r.result && [r.result.withCourier.slice(0, 3), r.result.rules]);
r = await owner('erpAlerts', []);
const al = JSON.stringify(r.result || {});
check('an alert for COD not collected after 14 days, no "customer owes" for it', r.ok && al.includes('cod:' + cod2) && !al.includes('due7:' + cod2), al.slice(0, 300));

// delivered & collected
r = await sales('erpCodCollected', [{ invoiceNo: cod2, by: 'courier' }]);
i = await inv(cod2); p = await pays(cod2);
check('delivered & collected by the courier: paid, "COD (Steadfast courier)"', r.ok && i.payment_status === 'Paid' && p.some((x) => x.method === 'COD (Steadfast courier)' && x.note.startsWith('delivered & collected')), [r, p]);
r = await sales('erpCodCollected', [{ invoiceNo: cod2, by: 'courier' }]);
check('...not twice', !r.ok && /already paid/.test(r.error), r);
r = await sales('erpCodCollected', [{ invoiceNo: codNo, by: 'shop' }]);
p = await pays(codNo);
check('the rider brought the cash: the rest by Cash', r.ok && Number(r.result.amount) === Number((await inv(codNo)).grand_total) - 100 && p.some((x) => x.method === 'Cash'), [r, p]);
const notCod = (await sql`select invoice_no from invoices where business_id = ${B} and payment_method = '' and payment_status = 'Pending' limit 1`)[0].invoice_no;
r = await sales('erpCodCollected', [{ invoiceNo: notCod }]);
check('only for COD sales', !r.ok && /not a cash-on-delivery/.test(r.error), r);

// delivery options with types
r = await sales('erpDeliveryOptionsSave', [{ options: [{ name: 'X', type: 'pickup' }] }]);
check('sales staff cannot change the delivery list', !r.ok, r);
r = await mgr('erpDeliveryOptionsSave', [{ options: [{ name: 'Shop counter', type: 'pickup' }, { name: 'Our Bike', type: 'rider' }, { name: 'RedX', type: 'courier' }, { name: 'Steadfast courier', type: 'courier' }] }]);
check('delivery list saved with types', r.ok && r.result.options.length === 4 && r.result.options[1].type === 'rider', r.result);
r = await owner('erpFormOptions', []);
check('the invoice form gets the list and the types', r.ok && r.result.sources.join() === 'Shop counter,Our Bike,RedX,Steadfast courier' && r.result.deliveryTypes['Our Bike'] === 'rider', r.result);
r = await sale('cod', { source: 'Our Bike' });
check('COD by our own rider is allowed', r.ok, r);
r = await sale('cod', { source: 'Shop counter' });
check('COD at the shop counter (pickup) is refused', !r.ok, r);

// old invoices: "Cash" where nothing was paid shows as nothing
await sql`update invoices set payment_method = 'Cash' where business_id = ${B} and invoice_no = ${notCod}`;
r = await owner('erpDues', []);
const old = r.result.invoices.find((x) => x.id === notCod);
check('"Cash" on an unpaid invoice is shown as nothing (the record is not changed)', old && old.method === '' &&
  (await sql`select payment_method from invoices where business_id = ${B} and invoice_no = ${notCod}`)[0].payment_method === 'Cash', old);

// a website COD order enters as cash on delivery
const wo = (await sql`insert into web_orders (business_id, order_no, customer_name, customer_phone, customer_address, payment, order_total, status)
                     values (${B}, 'T1-W1', 'Web Cod', '01811000999', 'Road W', 'Cash on delivery', 1430, 'processing') returning id`)[0].id;
await sql`insert into web_order_lines (business_id, web_order_id, sku, product_name, qty, line_total, status, entered) values (${B}, ${wo}, ${PLA}, 'PLA', 1, 1350, 'processing', false)`;
r = await mgr('erpEnterWebOrder', ['T1-W1']);
i = r.ok && await inv(r.result.invoiceNo);
check('website COD order -> COD invoice, nothing received', r.ok && i.payment_method === 'COD' && i.payment_status === 'Pending', [r, i]);

// a new business with its own currency
r = await owner('erpCreateBusiness', [{ name: 'T1 Second Shop', currency: 'usd' }]);
const nb = r.ok && (await sql`select value from business_config c join businesses b on b.id = c.business_id where b.name = 'T1 Second Shop' and c.key = 'currency'`)[0];
check('a new business gets the currency chosen', r.ok && nb && nb.value === 'USD', [r, nb]);
await done();
