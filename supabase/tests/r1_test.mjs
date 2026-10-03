// No money lost: the Sales "unpaid and at risk" box and the money alerts.
import { sql, FIX, owner, mgr, sales, makeShareholder, shareholder, check, done } from './harness.mjs';
await makeShareholder();
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const kinds = (r) => r.result.alerts.map((a) => a.kind || 'system');
const find = (r, k, re) => !r.ok ? (console.log('NOT OK', r.error), undefined) : r.result.alerts.find((a) => a.kind === k && (!re || re.test(a.title + ' ' + a.detail)));

async function inv(no, o) {
  const r = await sql`insert into invoices (business_id, invoice_no, customer_name, customer_phone, grand_total, due_amount, payment_status, source, created_at)
    values (${B}, ${no}, ${o.name}, ${o.phone || ''}, ${o.grand}, ${o.grand}, 'Pending', ${o.source || 'Walk-in'}, now() - make_interval(days => ${o.days || 0})) returning id`;
  await sql`insert into invoice_lines (business_id, invoice_id, sku, name, qty, unit_price, line_total) values (${B}, ${r[0].id}, ${PLA}, 'Sunlu PLA Black', 1, ${o.grand}, ${o.grand})`;
}
await inv('INV-OLD30', { name: 'Late Payer', phone: '01710000001', grand: 4000, days: 30 });
await inv('INV-OLD8', { name: 'Slow Payer', phone: '01710000002', grand: 900, days: 8 });

// ---------------------------------------------------------------- who may see what
let r = await sales('erpRisks', []);
check('the risk box is for managers and up', !r.ok, r);
r = await sales('erpAlerts', []);
check('sales staff get no alerts', !r.ok, r);
r = await mgr('erpRisks', []);
check('risk box: overdue invoices with totals by age', r.ok && r.result.overdue.some((i) => i.invoice === 'INV-OLD30' && i.days === 30) && r.result.totals.over30 >= 4000 &&
  r.result.totals.over7 >= 4900 && r.result.over7Count >= 2 && r.result.overdueCount >= r.result.over7Count, r.result && r.result.totals);

// ---------------------------------------------------------------- the alerts, one by one
r = await owner('erpAlerts', []);
check('a due crossing 30 days is an alert', r.ok && find(r, 'due_age', /Late Payer owes ৳4,000 for 30 days/), kinds(r));
check('...and one crossing 7 days', find(r, 'due_age', /Slow Payer owes ৳900 for 7 days/), kinds(r));

r = await shareholder('erpSettleDue', [{ orderId: 'INV-OLD30', amount: 500, reason: 'reduce', note: 'agreed discount on the phone' }]);
check('a shareholder reduces a due', r.ok, r);
r = await owner('erpAlerts', []);
check('the owner is told: who, how much, why', find(r, 'due_change', /Due reduced by ৳500 .*agreed discount/), r.result.alerts.filter((a) => a.kind === 'due_change'));
r = await mgr('erpAlerts', []);
check('a manager is not (that rule is the owner\'s)', r.ok && !find(r, 'due_change'), kinds(r));

r = await owner('erpCreateInvoice', [{ customer: { name: 'Bargain Hunter', phone: '01810000003' }, items: [{ sku: PLA, qty: 2 }], invoiceDiscount: 2600, payMode: 'full' }]);
check('the owner sells far under cost', r.ok, r);
const CHEAP = r.result.invoiceNo;
r = await owner('erpAlerts', []);
check('a sale below cost is an alert', find(r, 'below_cost', new RegExp(CHEAP)), r.result.alerts.map((a) => a.title));

r = await mgr('erpCancelInvoice', [{ invoiceNo: CHEAP, reason: 'test', money: 'advance', condition: 'good' }]);
r = r.ok ? r : await owner('erpCancelInvoice', [{ invoiceNo: CHEAP, reason: 'test', money: 'refund', condition: 'good' }]);
check('the invoice is cancelled', r.ok, r);
r = await owner('erpAlerts', []);
check('a cancelled invoice is an alert', find(r, 'cancel', new RegExp(CHEAP + ' cancelled')), kinds(r));

await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }] }]);
const CASH = (await owner('erpCashBook', [{}])).result.accounts.find((a) => a.name === 'Cash');
r = await owner('erpCashAdjust', [{ account: CASH.id, counted: CASH.balance - 750, note: 'drawer count' }]);
check('the drawer is counted 750 short', r.ok, r);
r = await owner('erpAlerts', []);
check('money found short is an alert', find(r, 'cash_short', /Cash was ৳750 short/), kinds(r));

await owner('erpAlertRulesSave', [{ rules: { write_off: { at: 1 } } }]);
r = await mgr('erpAdjustStock', [{ sku: PLA, qty: 2, direction: 'OUT', reason: 'Damaged', notes: 'dropped' }]);
check('two rolls written off', r.ok, r);
r = await owner('erpAlerts', []);
check('a write-off over the threshold is an alert', find(r, 'write_off', /2 × .* written off/), kinds(r));

await sql`insert into payments (business_id, payment_no, invoice_no, customer, paid_at, amount, method, note, recorded_by)
          values (${B}, 'DTEST', 'INV-OLD8', 'Slow Payer', now() - interval '12 days', 100, 'COD (Steadfast)', 'delivered - collected by the rider [payment] [sf:777]', 'Courier')`;
r = await owner('erpAlerts', []);
check('delivered 12 days ago and not paid out: alert', find(r, 'payout_late', /not paid out ৳100 for INV-OLD8/), kinds(r));
r = await mgr('erpRisks', []);
check('...and on the risk box', r.result.payoutLate.some((p) => p.consignment === '777' && p.days === 12), r.result.payoutLate);
await sql`insert into courier_payouts (business_id, payout_id) values (${B}, 'P-T')`.catch(() => {});
await sql`insert into courier_payout_lines (business_id, payout_id, consignment_id, cod_amount, status) values (${B}, 'P-T', '777', 100, 'delivered')`;
r = await owner('erpAlerts', []);
check('paid out: the alert is gone', !find(r, 'payout_late'), kinds(r));

await inv('INV-BACK', { name: 'Returner', grand: 1200, days: 6 });
await sql`insert into delivery_checks (business_id, at, asked, came_back) values (${B}, now() - interval '5 days', 1, 'INV-BACK')`;
r = await mgr('erpAlerts', []);
check('a parcel back 5 days without its goods taken back: the manager is told', find(r, 'return_waiting', /INV-BACK came back 5 days ago/), kinds(r));
await sql`insert into returns (business_id, return_no, invoice_no, sku, qty) values (${B}, 'RTN-T', 'INV-BACK', ${PLA}, 1)`;
r = await mgr('erpAlerts', []);
check('taken back: gone', !find(r, 'return_waiting'), kinds(r));

await sql`insert into web_orders (business_id, order_no, order_date, customer_name, order_total, entered) values (${B}, 'W-900', now() - interval '8 hours', 'Web Buyer', 1500, false)`;
r = await mgr('erpRisks', []);
check('a website order waiting 8 hours is on the risk box', r.result.webWaiting.some((w) => w.order === 'W-900' && w.hours >= 8), r.result.webWaiting);
r = await mgr('erpAlerts', []);
check('...and an alert for the manager', find(r, 'web_waiting', /W-900 not entered for 8 hours/), kinds(r));

// ---------------------------------------------------------------- the rules
r = await mgr('erpAlertRules', []);
check('the rules are not a manager\'s', !r.ok, r);
r = await shareholder('erpAlertRules', []);
check('a shareholder reads them', r.ok && r.result.rules.length === 10 && r.result.canEdit === false, r.result);
r = await shareholder('erpAlertRulesSave', [{ rules: { cancel: { on: false } } }]);
check('...but only the owner changes them', !r.ok, r);
r = await owner('erpAlertRulesSave', [{ rules: { cancel: { on: false }, return_waiting: { who: 'owner' }, discount: { at: -5 } } }]);
check('a nonsense threshold is refused', !r.ok && /not right/.test(r.error), r);
r = await owner('erpAlertRulesSave', [{ rules: { cancel: { on: false }, web_waiting: { who: 'owner' } } }]);
check('rules saved', r.ok && r.result.rules.find((x) => x.id === 'cancel').on === false && r.result.rules.find((x) => x.id === 'web_waiting').who === 'owner', r.result);
r = await owner('erpAlerts', []);
check('a rule switched off says nothing', !find(r, 'cancel'), kinds(r));
r = await mgr('erpAlerts', []);
check('a rule moved to the owner is no longer shown to the manager', !find(r, 'web_waiting'), kinds(r));
r = await owner('erpAlertPhone', [{ phone: '01711111111, 01822222222, 01933333333, 01644444444' }]);
check('at most three WhatsApp numbers', !r.ok && /three/.test(r.error), r);
r = await owner('erpAlertPhone', [{ phone: '01711111111, 01822222222' }]);
check('two numbers saved', r.ok && r.result.phone === '01711111111, 01822222222', r);
const o2 = await sql`select count(*)::int n from business_config where business_id = ${FIX.B2} and key = 'alert_rules'`;
check('another business untouched', o2[0].n === 0);
await done();
