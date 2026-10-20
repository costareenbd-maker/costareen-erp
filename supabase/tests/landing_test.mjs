// Order landing pages, unfinished orders and the fake-order shield (135, handlers/landing.js): one-click page from a
// product, the public page (offer price, views), a phone number typed but not sent kept to call back, an order through
// the page (into Orders, approved into an invoice like a chat order), the shield's reasons (double order, many numbers
// from one address, returned parcels before, a name that is not real), the block list, roles, another business.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir } from './harness.mjs';

const lp = await import(pathToFileURL(path.join(fnDir, 'handlers', 'landing.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
const PLA = 'FIL-SUN-PLA-BLA-001';
const price = Number((await sql`select sell_price from products where business_id = ${FIX.B} and sku = ${PLA}`)[0].sell_price);
const pub = (tok) => asB((ctx) => lp.landingPage(ctx, tok));
const act = (tok, b, ip) => asB((ctx) => lp.landingAct(ctx, tok, b, ip || '10.0.0.1'));
await sql`update products set notes = 'Smooth printing, no clogging.' where business_id = ${FIX.B} and sku = ${PLA}`;

// ---- 1. one click
let r = await sales('erpLandingSave', [{ sku: PLA }]);
check('sales staff do not make landing pages', !r.ok, r);
r = await mgr('erpLandingSave', [{ sku: PLA, offerPrice: price + 10 }]);
check('an offer above the normal price is refused', !r.ok && /below the normal price/.test(r.error), r);
r = await mgr('erpLandingSave', [{ sku: PLA, offerPrice: price - 100 }]);
const PG = r.ok && r.result.saved;
check('one click: the page from the product - its headline, selling points, offer, a link of its own', r.ok && PG.headline && PG.points.length >= 1 && PG.offer === price - 100 &&
  /\/land\.html\?p=[0-9a-f]{32}/.test(PG.link) && PG.active, r.result && PG);
const TOK = /p=([0-9a-f]{32})/.exec(PG.link)[1];

// ---- 2. the public page
let p = await pub(TOK);
check('the public page: shop, product, offer price with the old price, delivery charges', p.status === 200 && p.body.product.price === price - 100 && p.body.product.was === price &&
  p.body.product.points.length >= 1 && 'inside' in p.body.delivery && /Smooth printing/.test(p.body.product.about), p.body);
await act(TOK, { a: 'view', visitor: 'v1' }); await act(TOK, { a: 'view', visitor: 'v1' }, '10.0.0.2');
r = await mgr('erpLandingPages', [{}]);
check('views are counted', r.ok && r.result.pages[0].views === 2, r.result && r.result.pages[0]);

// ---- 3. unfinished orders
await act(TOK, { a: 'draft', visitor: 'v1', phone: '0171', name: 'Ra' });
check('a half-typed number is not kept', (await sql`select count(*)::int as n from landing_drafts`)[0].n === 0);
await act(TOK, { a: 'draft', visitor: 'v1', phone: '01711000111', name: 'Rafi', qty: 2, area: 'outside' });
await act(TOK, { a: 'draft', visitor: 'v1', phone: '01711000111', name: 'Rafi Ahmed', address: 'House 4, Road 2, Rajshahi', qty: 2, area: 'outside' });
r = await sales('erpLandingDrafts', [{}]);
const D1 = r.ok && r.result.drafts[0];
check('a real number typed and not sent: kept once (updated as they type), to call back', r.ok && r.result.drafts.length === 1 && D1.name === 'Rafi Ahmed' && D1.qty === 2 && /Rajshahi/.test(D1.address) && r.result.counts.open === 1, r.result);

// ---- 4. an order through the page
r = await act(TOK, { a: 'buy', visitor: 'v2', name: 'Karim', phone: '0181', address: 'Mirpur 10, Dhaka', qty: 1, area: 'inside' });
check('a wrong number is refused with a code the page shows in Bangla or English', r.body.ok === false && r.body.error === 'phone', r.body);
r = await act(TOK, { a: 'buy', visitor: 'v1', name: 'Rafi Ahmed', phone: '01711000111', address: 'House 4, Road 2, Rajshahi', qty: 2, area: 'outside' });
check('Rafi orders: an order number and the total (offer price x 2 + delivery outside Dhaka)', r.body.ok && /^CO-/.test(r.body.no) && r.body.total >= 2 * (price - 100), r.body);
const NO1 = r.body.no;
const o1 = (await sql`select * from chat_orders where no = ${NO1}`)[0];
check('...in Orders, from the landing page, at the offer price, with the shield\'s reading', o1 && o1.taken_by === 'landing page' && o1.landing_id && Number(o1.items[0].price) === price - 100 && o1.risk && o1.risk.level, o1 && o1.risk);
r = await sales('erpLandingDrafts', [{ status: 'ordered' }]);
check('his unfinished order is now marked ordered, with the order number', r.result.drafts.length === 1 && r.result.drafts[0].order === NO1, r.result.drafts);

// ---- 5. the shield
r = await act(TOK, { a: 'buy', visitor: 'v9', name: 'Rafi Ahmed', phone: '01711000111', address: 'House 4, Road 2, Rajshahi', qty: 1, area: 'outside' });
const o2 = (await sql`select risk from chat_orders where no = ${r.body.no}`)[0];
check('a second order on the same number: flagged as a double order', r.body.ok && o2.risk.level !== 'ok' && o2.risk.reasons.some((x) => /other open order/.test(x)), o2 && o2.risk);
await act(TOK, { a: 'buy', name: 'Sabbir Hasan', phone: '01811000222', address: 'Uttara Sector 7, Dhaka', qty: 1, area: 'inside' }, '10.9.9.9');
await act(TOK, { a: 'buy', name: 'Nayeem Islam', phone: '01911000333', address: 'Banani Road 11, Dhaka', qty: 1, area: 'inside' }, '10.9.9.9');
r = await act(TOK, { a: 'buy', name: 'aaaa', phone: '01611000444', address: 'xyz', qty: 1, area: 'inside' }, '10.9.9.9');
check('an address too short is refused before anything', r.body.ok === false && r.body.error === 'address', r.body);
r = await act(TOK, { a: 'buy', name: 'aaaa', phone: '01611000444', address: 'Gulshan 1, Dhaka', qty: 8, area: 'inside' }, '10.9.9.9');
const o3 = (await sql`select risk from chat_orders where no = ${r.body.no}`)[0];
check('three numbers from one internet address, a name that is not real, 8 pieces on COD: RISKY, every reason said', r.body.ok && o3.risk.level === 'risky' &&
  o3.risk.reasons.some((x) => /same internet address/.test(x)) && o3.risk.reasons.some((x) => /name does not look real/.test(x)) && o3.risk.reasons.some((x) => /8 pieces/.test(x)), o3 && o3.risk);
// a buyer who returned parcels before (own history)
for (let k = 0; k < 2; k++) {
  const iv = await owner('erpCreateInvoice', [{ customer: { name: 'Returner', phone: '01511000555', address: 'Khulna' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none', delivery: 'Steadfast' }]);
  await sql`update invoices set delivery_status = 'Returned' where business_id = ${FIX.B} and invoice_no = ${iv.result.invoiceNo}`;
}
const risk = await asB((ctx) => lp.orderRisk(ctx, { phone: '01511000555', name: 'Returner', address: 'Khulna Sadar, Khulna', items: [{ qty: 1 }] }));
check('a buyer whose parcels came back before: the shield says so', risk.level !== 'ok' && risk.reasons.some((x) => /Returned 2 of 2/.test(x)), risk);
// the block list
r = await sales('erpOrderShieldSet', [{ block: { kind: 'phone', value: '01611000444', reason: 'fake' } }]);
check('sales staff do not change the block list', !r.ok, r);
r = await mgr('erpOrderShieldSet', [{ block: { kind: 'phone', value: '016 1100 0444', reason: 'fake orders' } }]);
check('a manager blocks the number (written the usual way)', r.ok && r.result.blocks.length === 1 && r.result.blocks[0].value === '01611000444', r.result);
r = await act(TOK, { a: 'buy', name: 'Again', phone: '01611000444', address: 'Gulshan 1, Dhaka', qty: 1, area: 'inside' }, '10.1.1.1');
check('a blocked number cannot order online (the page asks them to call)', r.body.ok === false && r.body.error === 'blocked', r.body);
r = await mgr('erpOrderShield', [{}]);
check('the shield lists what it flagged, with the reasons', r.ok && r.result.flagged.some((o) => o.level === 'risky') && r.result.flagged.every((o) => o.reasons.length), r.result.flagged.map((o) => o.level));
// chat orders get the shield's reading too
await sql`insert into chat_orders (business_id, no, name, phone, address, items, taken_by) values (${FIX.B}, 'CO-TEST-1', 'Chat Buyer', '01611000444', 'Somewhere in Dhaka', ${sql.json([{ sku: PLA, name: 'PLA', qty: 1, price }])}, 'ai')`;
r = await sales('erpChatOrders', [{ status: 'pending' }]);
const co = r.ok && r.result.orders.find((o) => o.no === 'CO-TEST-1');
check('an order taken by the AI in a chat is checked too: blocked number', co && co.risk && co.risk.level === 'blocked', co && co.risk);
check('...and the landing orders are marked as such', r.result.orders.some((o) => o.landing), r.result.orders.map((o) => o.landing));

// ---- 6. finished by phone, approved into an invoice
r = await act(TOK, { a: 'draft', visitor: 'v5', phone: '01722000666', name: 'Mitu', qty: 1, area: 'inside' });
const D2 = (await sales('erpLandingDrafts', [{}])).result.drafts.find((d) => d.phone === '01722000666');
r = await sales('erpLandingDraftAct', [{ id: D2.id, action: 'called', note: 'will order after 6pm' }]);
check('called: the note is kept, it moves to Called', r.ok && (await sales('erpLandingDrafts', [{ status: 'called' }])).result.drafts.some((d) => d.id === D2.id && /6pm/.test(d.note)), r);
r = await sales('erpLandingDraftAct', [{ id: D2.id, action: 'order', address: 'Road 5, Dhanmondi, Dhaka' }]);
const o6 = (await sql`select * from chat_orders where business_id = ${FIX.B} and phone = '01722000666'`)[0];
check('"Make the order": the call finished it - an order in Orders, the draft marked ordered', r.ok && o6 && o6.taken_by === 'team (called back)' && /Dhanmondi/.test(o6.address) &&
  (await sql`select status from landing_drafts where id = ${D2.id}`)[0].status === 'ordered', o6);
r = await mgr('erpChatOrderAct', [{ id: o1.id, action: 'approve' }]);
check('a landing order is approved into an invoice like a chat order', r.ok && (await sql`select invoice_no from chat_orders where id = ${o1.id}`)[0].invoice_no, r);
r = await mgr('erpLandingPages', [{}]);
check('the page\'s figures: views, orders, unfinished, conversion', r.ok && r.result.pages[0].orders >= 5 && r.result.pages[0].conversion > 0, r.result.pages[0]);

// ---- 7. off, other business
r = await mgr('erpLandingSave', [{ id: PG.id, active: false }]);
p = await pub(TOK);
check('switched off: the page is gone', r.ok && p.status === 404, p);
check('the other business has no landing pages', (await sql`select count(*)::int as n from landing_pages where business_id = ${FIX.B2}`)[0].n === 0);

await done();
