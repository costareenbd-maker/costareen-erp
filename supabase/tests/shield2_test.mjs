// The fair shield, risky orders asked instead of refused, and the clean Meta pixel (136; handlers/landing.js, pixel.js):
// one cancellation never makes a customer risky, the shop's own faults never count, old returns fade, good deliveries
// since count for the buyer; RISKY orders warned / asked an advance / held for a call; the pixel hears Lead at the order
// (not for a risky one) and Purchase only when delivered (or approved), OrderReturned after a return; never a cancelled one.
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const lp = await import(pathToFileURL(path.join(fnDir, 'handlers', 'landing.js')));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const px = await import(pathToFileURL(path.join(fnDir, 'handlers', 'pixel.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
const PLA = 'FIL-SUN-PLA-BLA-001';
const price = Number((await sql`select sell_price from products where business_id = ${FIX.B} and sku = ${PLA}`)[0].sell_price);
const risk = (o) => asB((ctx) => lp.orderRisk(ctx, { name: 'Real Name', address: 'House 1, Road 2, Mirpur, Dhaka', items: [{ qty: 1 }], ...o }));
// plenty of PLA for the invoices below
const pid = (await sql`select id from products where business_id = ${FIX.B} and sku = ${PLA}`)[0].id;
await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, txn_no, operator, product_name)
          values (${FIX.B}, ${pid}, 'RECEIVE', 'IN', 500, 100, 50000, 'test stock', 'TXN-S2-1', 'test', 'PLA')`;
const sha = (v) => createHash('sha256').update(v).digest('hex');
const events = [];
web.on(/graph\.facebook\.com\/v21\.0\/\d+\/events/, (url, opts) => { const b = JSON.parse(opts.body); events.push(...b.data.map((e) => ({ ...e, url, test: b.test_event_code }))); return { status: 200, body: { events_received: b.data.length } }; });
const invFor = async (phone, status, daysAgo) => {
  const r = await owner('erpCreateInvoice', [{ customer: { name: 'Buyer ' + phone.slice(-3), phone, address: 'Dhaka' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none', delivery: 'Steadfast' }]);
  if (!r.ok) throw new Error('invoice: ' + r.error);
  await sql`update invoices set delivery_status = ${status}, created_at = now() - (${daysAgo || 0} || ' days')::interval where business_id = ${FIX.B} and invoice_no = ${r.result.invoiceNo}`;
  return r.result.invoiceNo;
};

// ---- 1. fair history
await sql`insert into chat_orders (business_id, no, name, phone, address, items, status, cancel_reason) values (${FIX.B}, 'CO-C1', 'One Cancel', '01700100001', 'Dhaka', ${sql.json([{ qty: 1 }])}, 'cancelled', 'customer changed mind')`;
let r = await risk({ phone: '01700100001' });
check('one cancelled order never makes a customer risky (stays OK)', r.level === 'ok' && r.reasons.some((x) => /1 earlier order cancelled/.test(x)), r);
await sql`insert into chat_orders (business_id, no, name, phone, address, items, status, cancel_reason) values (${FIX.B}, 'CO-C2', 'Ours', '01700100002', 'Dhaka', ${sql.json([{ qty: 1 }])}, 'cancelled', 'out of stock')`;
r = await risk({ phone: '01700100002' });
check('a cancellation for our own reason (out of stock) is not counted', r.level === 'ok' && r.reasons.some((x) => /our own fault - not counted/.test(x)), r);
const R1 = await invFor('01700100003', 'Returned'), R2 = await invFor('01700100003', 'Returned');
r = await risk({ phone: '01700100003' });
check('two returns: RISKY, and the returns are listed so the team can say which were our fault', r.level === 'risky' && r.returns.length === 2 && r.returns.some((x) => x.ref === R1), r);
let s = await mgr('erpOrderShieldSet', [{ excuse: { ref: R1, reason: 'we sent the wrong colour' } }]);
r = await risk({ phone: '01700100003' });
check('one marked "our fault": it no longer counts - only CHECK now', s.ok && r.level === 'watch' && r.reasons.some((x) => /our own fault/.test(x)) && s.result.excuses.some((e) => e.ref === R1), [r, s.ok]);
await invFor('01700100004', 'Returned', 400); await invFor('01700100004', 'Returned', 390);
r = await risk({ phone: '01700100004' });
check('returns more than a year old are forgotten', r.level === 'ok', r);
await invFor('01700100005', 'Returned', 250); await invFor('01700100005', 'Returned', 240);
r = await risk({ phone: '01700100005' });
check('returns 6-12 months old count half (CHECK, not RISKY)', r.level === 'watch', r);
await invFor('01700100006', 'Returned', 40); await invFor('01700100006', 'Returned', 30); await invFor('01700100006', 'Delivered', 20); await invFor('01700100006', 'Delivered', 10);
r = await risk({ phone: '01700100006' });
check('two returns but two deliveries since: the good deliveries count for the buyer', r.level !== 'risky' && r.reasons.some((x) => /2 delivered since the last return/.test(x)), r);

// ---- 2. RISKY orders: warn / advance / confirm (never refused unless blocked)
r = await mgr('erpOrderShieldSet', [{ settings: { risky: 'advance', advanceHow: 'bKash 01711111111' } }]);
check('only the owner decides what happens to risky orders', !r.ok, r);
r = await owner('erpOrderShieldSet', [{ settings: { risky: 'advance' } }]);
check('an advance needs the way to pay it', !r.ok && /how to pay/.test(r.error), r);
r = await owner('erpOrderShieldSet', [{ settings: { risky: 'advance', advanceHow: 'bKash 01711111111 (Send money)' } }]);
check('saved: RISKY orders are asked an advance', r.ok && r.result.settings.risky === 'advance', r.result && r.result.settings);
const pg = (await mgr('erpLandingSave', [{ sku: PLA }])).result.saved, TOK = /p=([0-9a-f]{32})/.exec(pg.link)[1];
const buy = (b, ip) => asB((ctx) => lp.landingAct(ctx, TOK, { a: 'buy', qty: 1, area: 'inside', address: 'House 9, Road 9, Uttara, Dhaka', ...b }, ip || '10.2.2.2'));
await buy({ name: 'Ok One', phone: '01800200001' }, '10.5.5.5'); await buy({ name: 'Ok Two', phone: '01800200002' }, '10.5.5.5');
let b = await buy({ name: 'zz', phone: '01800200003', qty: 8 }, '10.5.5.5');
const ro = (await sql`select status, hold_reason, risk from chat_orders where no = ${b.body.no}`)[0];
check('a RISKY landing order is taken, but on hold until the advance comes; the page is told how to pay (and nothing about the shield)',
  b.body.ok && b.body.advance && b.body.advance.how === 'bKash 01711111111 (Send money)' && b.body.advance.ref === b.body.no && b.body.pixel === false && !b.body.risk &&
  ro.status === 'hold' && /Advance asked/.test(ro.hold_reason) && ro.risk.level === 'risky', [b.body, ro]);
await owner('erpOrderShieldSet', [{ settings: { risky: 'confirm' } }]);
b = await buy({ name: 'zz', phone: '01800200004', qty: 8 }, '10.5.5.5');
const rc = (await sql`select status, hold_reason from chat_orders where no = ${b.body.no}`)[0];
check('"hold until we call": on hold, the page says they will be called first', b.body.ok && b.body.confirm === true && rc.status === 'hold' && /Call to confirm/.test(rc.hold_reason), [b.body, rc]);
await sql`insert into chat_orders (business_id, no, name, phone, address, items, taken_by) values (${FIX.B}, 'CO-AI-R', 'x', '01700100003', 'Dhaka', ${sql.json([{ sku: PLA, name: 'PLA', qty: 9, price }])}, 'ai')`;
await sales('erpChatOrders', [{ status: 'pending' }]);
const ai = (await sql`select status, hold_reason from chat_orders where no = 'CO-AI-R'`)[0];
check('a RISKY order the AI took in a chat is held the same way when Orders opens', ai.status === 'hold' && /Call to confirm/.test(ai.hold_reason), ai);
await owner('erpOrderShieldSet', [{ settings: { risky: 'warn' } }]);
b = await buy({ name: 'zz', phone: '01800200005', qty: 8 }, '10.5.5.5');
check('"take it, just mark it": a RISKY order comes in as pending', b.body.ok && (await sql`select status from chat_orders where no = ${b.body.no}`)[0].status === 'pending', b.body);

// ---- 3. the pixel: only real orders
r = await mgr('erpPixelSet', [{ pixel: '1234567890123456' }]);
check('only the owner sets the pixel', !r.ok, r);
r = await owner('erpPixelSet', [{ pixel: '1234567890123456', token: 'CAPI-SECRET-TOKEN', when: 'delivered', test: 'TEST777' }]);
check('pixel saved; the token sealed and never shown', r.ok && r.result.pixel === '1234567890123456' && r.result.token === 'own' && !JSON.stringify(r.result).includes('CAPI-SECRET-TOKEN'), r.result);
const page = await asB((ctx) => lp.landingPage(ctx, TOK));
check('the landing page gets the pixel id (for PageView / ViewContent / Lead only)', page.body.pixel === '1234567890123456', page.body.pixel);
await sql`update chat_orders set meta = jsonb_build_object('sent', jsonb_build_object('skipLead', 'x', 'skipPurchase', 'x')) where business_id = ${FIX.B} and meta is null or (meta->'sent') is null`;
events.length = 0;
const good = await buy({ name: 'Rafiq Hasan', phone: '01911300001', meta: { fbp: 'fb.1.1.111', fbc: 'fb.1.2.abc', ua: 'Mozilla/5.0 Test', url: 'https://shop/land.html?p=x' } }, '10.7.7.1');
const badB = await buy({ name: 'zz', phone: '01911300002', qty: 9 }, '10.6.6.6'); await buy({ name: 'Two', phone: '01911300003' }, '10.6.6.6'); const bad = await buy({ name: 'zz', phone: '01911300004', qty: 9 }, '10.6.6.6');
let t = await asB((ctx) => px.pixelTick(ctx));
const lead = events.find((e) => e.event_name === 'Lead' && e.custom_data.order_id === good.body.no);
check('Lead sent from the server for the real order: same id as the page\'s, hashed phone 8801..., fbp / fbc / browser, the test code',
  lead && lead.event_id === 'lead-' + good.body.no && lead.user_data.ph[0] === sha('8801911300001') && lead.user_data.fbp === 'fb.1.1.111' && lead.user_data.fbc === 'fb.1.2.abc' &&
  lead.user_data.client_ip_address === '10.7.7.1' && lead.action_source === 'website' && lead.test === 'TEST777' && lead.user_data.fn[0] === sha('rafiq'), lead);
const badNo = (await sql`select no, risk from chat_orders where phone = '01911300004'`)[0];
check('no Lead for a RISKY order (it would teach Meta the wrong buyers)', badNo.risk.level === 'risky' && !events.some((e) => e.custom_data.order_id === badNo.no), badNo.risk);
check('no Purchase at the order', !events.some((e) => e.event_name === 'Purchase'), events.map((e) => e.event_name));
const go = (await sql`select id from chat_orders where no = ${good.body.no}`)[0].id;
r = await mgr('erpChatOrderAct', [{ id: go, action: 'approve' }]);
events.length = 0; await asB((ctx) => px.pixelTick(ctx));
check('approved but not delivered yet: still no Purchase (default: when delivered)', r.ok && !events.some((e) => e.event_name === 'Purchase'), events);
const inv = (await sql`select invoice_no from chat_orders where id = ${go}`)[0].invoice_no;
await sql`update invoices set delivery_status = 'Delivered' where business_id = ${FIX.B} and invoice_no = ${inv}`;
events.length = 0; await asB((ctx) => px.pixelTick(ctx));
const pur = events.find((e) => e.event_name === 'Purchase');
check('delivered: Purchase from the server with its value and the product', pur && pur.event_id === 'purchase-' + good.body.no && pur.custom_data.value === price && pur.custom_data.content_ids[0] === PLA, pur);
events.length = 0; await asB((ctx) => px.pixelTick(ctx));
check('...once only', !events.some((e) => e.event_name === 'Purchase'), events);
await sql`update invoices set delivery_status = 'Returned' where business_id = ${FIX.B} and invoice_no = ${inv}`;
events.length = 0; await asB((ctx) => px.pixelTick(ctx));
check('returned after it was counted: OrderReturned, so the returner can be left out of audiences', events.length === 1 && events[0].event_name === 'OrderReturned' && events[0].event_id === 'returned-' + good.body.no, events);
// a cancelled order: never a Purchase; the "approved" choice
const two = (await sql`select id, no from chat_orders where phone = '01911300003'`)[0];
await mgr('erpChatOrderAct', [{ id: two.id, action: 'cancel', reason: 'customer did not pick up' }]);
await owner('erpPixelSet', [{ when: 'approved' }]);
events.length = 0; await asB((ctx) => px.pixelTick(ctx));
check('a cancelled order never becomes a Purchase', !events.some((e) => e.event_name === 'Purchase' && e.custom_data.order_id === two.no), events);
const three = await buy({ name: 'Mitu Akter', phone: '01911300009' }, '10.8.8.8');
const id3 = (await sql`select id from chat_orders where no = ${three.body.no}`)[0].id;
await asB((ctx) => px.pixelTick(ctx));
await mgr('erpChatOrderAct', [{ id: id3, action: 'approve' }]);
events.length = 0; await asB((ctx) => px.pixelTick(ctx));
check('"when we approve": Purchase right after approval', events.some((e) => e.event_name === 'Purchase' && e.custom_data.order_id === three.body.no), events);
r = await mgr('erpPixel', [{}]);
check('the pixel card: what was sent and what was kept out', r.ok && r.result.counts.lead >= 2 && r.result.counts.purchase >= 2 && r.result.counts.returned === 1 && r.result.counts.kept_out >= 1 && !r.result.last.error, r.result);
r = await owner('erpPixelTest', [{}]);
check('a test event reaches Meta', r.ok && r.result.received === 1, r);
web.on(/graph\.facebook\.com\/v21\.0\/\d+\/events/, () => ({ status: 400, body: { error: { message: 'Invalid OAuth access token', error_user_msg: 'The access token is invalid' } } }));
await buy({ name: 'Nadia Islam', phone: '01911300010' }, '10.9.1.1');
await asB((ctx) => px.pixelTick(ctx));
r = await mgr('erpPixel', [{}]);
check('Meta refusing is shown on the card (and tried again next minute)', /access token is invalid/.test(r.result.last.error), r.result.last);

await done();
