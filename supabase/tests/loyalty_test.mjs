// Stage N6: the keep-customers kit - points that follow what was paid, levels and perks, bonus and redeem,
// consent and refill reminders from the customer's own rhythm, the delivery-history check, and the customer's
// own page (points, the reminder switch).
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': '198.51.100.' + (++N % 250) } }), R)).body;
const post = async (q, body) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': '198.51.100.' + (++N % 250) }, body: JSON.stringify(body) }), R)).body;
const FIL = 'FIL-SUN-PLA-BLA-001';
const K = { name: 'Karim', phone: '01712345678' }, RH = { name: 'Rahim', phone: '01811111111' };
const pts = async (who) => (await sales('erpCustomerPoints', [who])).result;
const backdate = async (no, days) => sql`update invoices set created_at = now() - make_interval(days => ${days}) where business_id = ${FIX.B} and invoice_no = ${no}`;

// 1. the rules
let r = await sales('erpLoyaltySave', [{ rate: 2 }]);
check('only a manager changes the points rules', !r.ok, r);
r = await mgr('erpLoyaltySave', [{ rate: 1, silver: 20, gold: 50, taka: 1, silverPerk: 'Priority on new colours', goldPerk: 'Free delivery in the city' }]);
check('rules saved: 1 point per 100 taka, Silver from 20, Gold from 50', r.ok && r.result.settings.rate === 1 && r.result.settings.silver === 20 && r.result.settings.gold === 50, r);
r = await mgr('erpLoyaltySave', [{ gold: 10 }]);
check('Gold below Silver is refused, and nothing was changed', !r.ok && (await sales('erpLoyalty', [])).result.settings.gold === 50, r);

// 2. a paid invoice earns; an unpaid one earns when it is paid; a refund takes back
r = await sales('erpCreateInvoice', [{ customer: K, items: [{ sku: FIL, qty: 1 }], payMode: 'full' }]);
check('invoice 1 paid in full', r.ok, r);
const INV1 = r.result.invoiceNo;
let p = await pts(K);
check('13 points for 1350 taka paid; Bronze, 7 to Silver', p.on && p.total === 13 && p.lifetime === 13 && p.level === 'Bronze' && p.next === 'Silver' && p.toNext === 7 && p.ledger.length === 1 && p.ledger[0].kind === 'order', p);
r = await sales('erpCreateInvoice', [{ customer: K, items: [{ sku: FIL, qty: 1 }], payMode: 'none' }]);
const INV2 = r.result.invoiceNo;
p = await pts(K);
check('an unpaid invoice earns nothing yet', p.total === 13, p.total);
r = await mgr('erpRecordPayment', [{ orderId: INV2, amount: 1350, method: 'Cash' }]);
check('paid later', r.ok, r);
p = await pts(K);
check('...now 26 points and Silver with its perk', p.total === 26 && p.level === 'Silver' && /colours/.test(p.perk) && p.next === 'Gold' && p.toNext === 24, p);
r = await owner('erpReturnGoods', [{ invoiceNo: INV2, lines: [{ sku: FIL, qty: 1, condition: 'good' }], money: 'refund', method: 'Cash', reason: 'changed mind' }]);
check('refunded', r.ok, r);
p = await pts(K);
check('the refund took the invoice’s points back: 13, Bronze again', p.total === 13 && p.lifetime === 13 && p.level === 'Bronze', p);

// 3. bonus and redeem
r = await sales('erpPointsAdjust', [{ ...K, kind: 'bonus', points: 50, note: 'photo review' }]);
check('only a manager gives points', !r.ok, r);
r = await mgr('erpPointsAdjust', [{ ...K, kind: 'bonus', points: 50 }]);
check('a reason is needed', !r.ok && /why/i.test(r.error), r);
r = await mgr('erpPointsAdjust', [{ ...K, kind: 'bonus', points: 50, note: 'photo review' }]);
check('bonus 50: 63 points, Gold', r.ok && r.result.total === 63 && r.result.level === 'Gold' && /delivery/i.test(r.result.perk), r);
r = await mgr('erpPointsAdjust', [{ ...K, kind: 'redeem', points: 20, note: 'redeemed on ' + INV1 + ' as 20 taka off' }]);
check('redeem 20: 43 left, still Gold (lifetime 63)', r.ok && r.result.total === 43 && r.result.lifetime === 63 && r.result.level === 'Gold', r);
r = await mgr('erpPointsAdjust', [{ ...K, kind: 'redeem', points: 100, note: 'too many' }]);
check('cannot redeem more than they have', !r.ok && /Only 43/.test(r.error), r);

// 4. consent and the refill rhythm
r = await sales('erpConsentSet', [{ ...K, reminders: true, how: 'asked on WhatsApp' }]);
check('consent recorded with who and how', r.ok && r.result.consent.reminders && r.result.consent.how === 'asked on WhatsApp' && r.result.consent.at, r);
await backdate(INV1, 65); await backdate(INV2, 35);
r = await sales('erpCreateInvoice', [{ customer: RH, items: [{ sku: FIL, qty: 2 }], payMode: 'full' }]); await backdate(r.result.invoiceNo, 70);
r = await sales('erpCreateInvoice', [{ customer: RH, items: [{ sku: FIL, qty: 1 }], payMode: 'full' }]); await backdate(r.result.invoiceNo, 40);
r = await sales('erpRefillDue', []);
check('refill: Karim (agreed) is ready - every ~30 days, last 35 days ago, due; Rahim (not asked) under ask-first; both with a WhatsApp link', r.ok && r.result.ready.length === 1 && r.result.ready[0].name === 'Karim' && r.result.ready[0].avgDays === 30 && r.result.ready[0].buys === 2 && r.result.ready[0].items[0].name === 'Sunlu PLA Black' && /wa\.me\/8801712345678/.test(r.result.ready[0].whatsapp) && /more/.test(decodeURIComponent(r.result.ready[0].whatsapp)) &&
  r.result.askFirst.length === 1 && r.result.askFirst[0].name === 'Rahim' && /may we message you/.test(decodeURIComponent(r.result.askFirst[0].whatsapp)) && r.result.tracked === 2, r.ok ? { ready: r.result.ready, ask: r.result.askFirst } : r);
p = await pts(K);
check('the customer page knows the rhythm', p.refill && p.refill.avgDays === 30 && p.refill.due === true && p.refill.nextAt, p.refill);
r = await sales('erpReminderSent', [{ ...K, note: 'WhatsApp' }]);
check('marked as sent: off the list for two weeks', r.ok && (await sales('erpRefillDue', [])).result.ready.length === 0, r);

// 5. delivery history, own parcels only
r = await sales('erpDeliveryHistory', [K]);
check('no parcels yet: "new"', r.ok && r.result.risk === 'new' && r.result.parcels === 0 && r.result.orders === 2, r);
await sql`update invoices set delivery_status = 'Delivered' where business_id = ${FIX.B} and invoice_no = ${INV1}`;
await sql`update invoices set delivery_status = 'Returned' where business_id = ${FIX.B} and invoice_no = ${INV2}`;
await sql`insert into courier_log (business_id, invoice_no, consignment_id, customer, phone) values (${FIX.B}, ${INV1}, 'C1', 'Karim', '01712345678'), (${FIX.B}, ${INV2}, 'C2', 'Karim', '01712345678')`;
r = await sales('erpDeliveryHistory', [K]);
check('one delivered, one returned: "watch" with advice', r.ok && r.result.delivered === 1 && r.result.returned === 1 && r.result.risk === 'watch' && /WhatsApp/.test(r.result.advice), r);
r = await sales('erpCreateInvoice', [{ customer: K, items: [{ sku: FIL, qty: 1 }], payMode: 'none' }]);
const INV3 = r.result.invoiceNo;
await sql`update invoices set delivery_status = 'Cancelled' where business_id = ${FIX.B} and invoice_no = ${INV3}`;
await sql`insert into courier_log (business_id, invoice_no, consignment_id, customer, phone) values (${FIX.B}, ${INV3}, 'C3', 'Karim', '01712345678')`;
r = await sales('erpDeliveryHistory', [K]);
check('two returned of three: "risky", ask an advance', r.ok && r.result.returned === 2 && r.result.risk === 'risky' && /advance/.test(r.result.advice), r);
r = await sales('erpDeliveryHistoryMany', [{ phones: [K.phone, RH.phone, '0199'] }]);
check('many at once: Karim risky, Rahim new', r.ok && r.result.history[K.phone].risk === 'risky' && r.result.history[RH.phone].risk === 'new', r);
r = await sales('erpDeliveryHistory', [{ phone: '', name: '' }]);
check('no number: nothing to check', r.ok && r.result.risk === 'none', r);

// 6. the customer’s own page
r = await sales('erpMyLink', [K]);
const T = r.result.url.split('t=')[1];
r = await get('pub=my&t=' + T);
check('the page shows points, level, the perk, the reminder switch on, the next refill', r.ok && r.points && r.points.total === 43 && r.points.level === 'Gold' && /delivery/i.test(r.points.perk) && r.reminders === true && r.refill && r.refill.nextAt, r.ok ? { points: r.points, reminders: r.reminders, refill: r.refill } : r);
r = await post('pub=my', { t: T, action: 'reminders', on: false });
check('the customer switches reminders off', r.ok && r.reminders === false, r);
r = await get('pub=my&t=' + T);
check('...and the page follows', r.reminders === false);
check('...recorded as the customer’s own choice', (await sql`select by, how from customer_consent where business_id = ${FIX.B} and customer_key = '1712345678'`)[0].by === 'the customer');
r = await post('pub=my', { t: 'short', action: 'reminders', on: true });
check('a broken link is refused', !r.ok, r);
check('the other business has no points', (await sql`select count(*)::int n from customer_points where business_id = ${FIX.B2}`)[0].n === 0);
await done();
