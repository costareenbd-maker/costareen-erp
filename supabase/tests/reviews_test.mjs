// review-1 (owner 10 Nov 2026): after a chat order is delivered, a review card goes in the same chat (Messenger card +
// star buttons; WhatsApp link + "reply 1-5"); one tap rates the shop; review.html rates each product with optional
// words; the reviews go to the website as verified buyers; the team sees the list and can hide one. Made-up data only.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const ib2 = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox2.js')));
const rv = await import(pathToFileURL(path.join(fnDir, 'handlers', 'reviews.js')));
const chm = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inboxch.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.hookBase = 'https://fn.test/functions/v1/erp';

const fb = [], wa = [], site = [];
let siteDown = false;
web.on(/graph\.facebook\.com/, (url, opts) => { fb.push(JSON.parse(opts.body)); return { status: 200, body: { message_id: 'm' + fb.length } }; });
web.on(/evo\.test/, (url, opts) => { if (/message\/send/.test(url)) wa.push(JSON.parse(opts.body)); return { status: 201, body: { key: { id: 'W' + wa.length } } }; });
web.on(/shop\.test/, (url, opts) => {
  if (siteDown) return { status: 502, body: 'down' };
  const b = JSON.parse(opts.body); site.push(b);
  return { status: 200, body: { ok: true, saved: b.reviews.filter((r) => r.kind === 'shop' || r.sku !== 'NOT-ON-SITE').map((r) => r.ref), missing: b.reviews.filter((r) => r.kind === 'product' && r.sku === 'NOT-ON-SITE').map((r) => r.ref) } };
});
await owner('erpInboxFeatures', [{ save: { leads: true } }]);
await asB(async (ctx) => {
  const { setSecret, setConfig } = await import(pathToFileURL(path.join(fnDir, 'lib', 'ext.js')));
  await setSecret(ctx, 'CZ_SYNC_KEY', 'site-key');
  await setConfig(ctx, 'website_api', 'https://shop.test/wp-json/cz/v1');
});
await owner('erpInboxProfile', [{ save: { name: 'Testa Shop', style: 'vai', lang: 'both', review_on: true, review_link: 'https://facebook.com/testa/reviews' } }]);

// two chats: Messenger (a man, writes Banglish) and WhatsApp (a woman, writes Bangla)
let r = await owner('erpInboxChannelSave', [{ kind: 'messenger', name: 'Page', externalId: 'PAGE7', secrets: { TOKEN: 'tok', APP_SECRET: 'sec' } }]);
const M = (await sql`select * from inbox_channels where id = ${r.result.channels[0].id}`)[0];
await sql`update inbox_channels set status = 'live' where id = ${M.id}`;
const W = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings) values (${FIX.B}, 'wa_evo', 'Shop WA', 'inst1', 'live', false, '{"purpose":"chat"}'::jsonb) returning *`)[0];
await asB(async (ctx) => { await chm.chSecretSet(ctx, W, 'URL', 'https://evo.test'); await chm.chSecretSet(ctx, W, 'KEY', 'k1'); });
const cM = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name, gender) values (${FIX.B}, ${M.id}, 'PSID1', 'Rafi Ahmed', 'm') returning *`)[0];
const cW = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name, gender) values (${FIX.B}, ${W.id}, '8801712000002', 'Mim Akter', 'f') returning *`)[0];
const vM = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id, last_in_at) values (${FIX.B}, ${M.id}, ${cM.id}, now()) returning *`)[0];
const vW = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id, last_in_at) values (${FIX.B}, ${W.id}, ${cW.id}, now()) returning *`)[0];
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${FIX.B}, ${vM.id}, 'in', 'customer', 'text', 'PLA ache bhai? dam koto')`;
await sql`insert into inbox_messages (business_id, conversation_id, direction, author, kind, text) values (${FIX.B}, ${vW.id}, 'in', 'customer', 'text', 'লাল PLA আছে? দাম কত?')`;
const sku = (await sql`select sku, name from products where business_id = ${FIX.B} order by sku limit 1`)[0];
const mkOrder = async (v, no, inv) => (await sql`insert into chat_orders (business_id, no, conversation_id, name, phone, address, items, delivery_charge, status, invoice_no, approved_at)
  values (${FIX.B}, ${no}, ${v.id}, ${v === vM ? 'Rafi Ahmed' : 'Mim Akter'}, ${v === vM ? '01711000001' : '01712000002'}, 'House 3, Mirpur 2, Dhaka',
          ${sql.json([{ sku: sku.sku, name: sku.name, qty: 1, price: 1290 }, { sku: 'NOT-ON-SITE', name: 'Old nozzle', qty: 1, price: 200 }])}, 90, 'approved', ${inv}, now()) returning *`)[0];
const oM = await mkOrder(vM, 'CO-R1', 'INV-R1'), oW = await mkOrder(vW, 'CO-R2', 'INV-R2');
await sql`insert into invoices (business_id, invoice_no, customer_name, subtotal, grand_total, delivery_status) values (${FIX.B}, 'INV-R1', 'Rafi', 1490, 1580, 'In transit'), (${FIX.B}, 'INV-R2', 'Mim', 1490, 1580, 'In transit')`;

// ---- 1. nothing until delivered; delivered: the update tick, then the review card on the next tick
await asB((ctx) => ib2.orderUpdates(ctx));
check('review-1: no review card while the parcel is on the way', !(await sql`select 1 from review_asks`).length);
await sql`update invoices set delivery_status = 'Delivered' where business_id = ${FIX.B}`;
await asB((ctx) => ib2.orderUpdates(ctx));
check('review-1: not on the same tick as "delivered" (the delivered note goes first)', !(await sql`select 1 from review_asks`).length);
fb.length = 0; wa.length = 0;
await asB((ctx) => ib2.orderUpdates(ctx));
const asks = await sql`select * from review_asks order by chat_order_id = ${oM.id} desc`;
check('review-1: the tick after delivery makes one review ask per order', asks.length === 2 && asks.every((a) => /^[0-9a-f]{32}$/.test(a.token)), asks.length);
const aM = asks.find((a) => a.chat_order_id === oM.id), aW = asks.find((a) => a.chat_order_id === oW.id);
const card = fb.find((b) => b.message && b.message.attachment), stars = fb.find((b) => b.message && b.message.quick_replies);
check('review-1: Messenger gets a card with a "Star din" button to the review page, in Banglish, with bhai',
  card && /review\.html\?r=/.test(card.message.attachment.payload.elements[0].buttons[0].url) && /bhai/.test(card.message.attachment.payload.elements[0].title) && /star/i.test(card.message.attachment.payload.elements[0].buttons[0].title), JSON.stringify(card));
check('review-1: ...and five star buttons, five stars first', stars && stars.message.quick_replies.length === 5 && stars.message.quick_replies[0].payload === 'REVIEW:5' && stars.message.quick_replies[0].title === '⭐⭐⭐⭐⭐', stars);
check('review-1: WhatsApp gets the link (shown as a card) and "reply 1 to 5", in Bangla, with আপু, never স্যার',
  wa.length === 1 && /review\.html\?r=/.test(wa[0].text) && /আপু/.test(wa[0].text) && /১ থেকে ৫/.test(wa[0].text) && !/স্যার/.test(wa[0].text), wa[0] && wa[0].text);
fb.length = 0; wa.length = 0;
await asB((ctx) => ib2.orderUpdates(ctx));
check('review-1: asked once only', (await sql`select count(*)::int n from review_asks`)[0].n === 2 && !fb.length && !wa.length);

// ---- 2. one tap / a reply of "5" rates the shop; the AI does not answer it; the thanks carries the page link
let done1 = await asB(async (ctx) => rv.chatStars(ctx, M, cM, vM, '⭐⭐⭐⭐⭐', 'REVIEW:5'));
check('review-1: a star tap on Messenger rates the shop (5)', done1 && (await sql`select rating from chat_reviews where ask_id = ${aM.id} and kind = 'shop'`)[0]?.rating === 5);
check('review-1: ...and the thanks goes out with the link for the product', fb.some((b) => /dhonnobad/.test(b.message.text || '') && /review\.html/.test(b.message.text || '')), fb.map((b) => b.message.text));
done1 = await asB(async (ctx) => rv.chatStars(ctx, W, cW, vW, '৫', ''));
check('review-1: a reply of "৫" on WhatsApp rates the shop too', done1 && (await sql`select rating from chat_reviews where ask_id = ${aW.id} and kind = 'shop'`)[0]?.rating === 5);
done1 = await asB(async (ctx) => rv.chatStars(ctx, W, cW, vW, '2', ''));
check('review-1: a later typed number is an ordinary message (only one typed rating)', !done1 && (await sql`select rating from chat_reviews where ask_id = ${aW.id} and kind = 'shop'`)[0]?.rating === 5);
check('review-1: "5 kg" or a phone number is not a rating', rv.starsIn('5 kg lagbe', '') === 0 && rv.starsIn('01711000001', '') === 0 && rv.starsIn('4 star', '') === 4 && rv.starsIn('⭐⭐⭐', '') === 3);
const other = (await sql`insert into inbox_contacts (business_id, channel_id, external_id, name) values (${FIX.B}, ${W.id}, '8801712000099', 'No order') returning *`)[0];
const vO = (await sql`insert into inbox_conversations (business_id, channel_id, contact_id) values (${FIX.B}, ${W.id}, ${other.id}) returning *`)[0];
check('review-1: "5" in a chat that was never asked is left to the AI', !(await asB(async (ctx) => rv.chatStars(ctx, W, other, vO, '5', ''))));

// ---- 3. the page: stars for the shop and each product, words optional; nothing pre-filled for a new one
let pg = await asB((ctx) => rv.reviewPage(ctx, aW.token));
check('review-1: the page lists what was bought, in the chat\'s script, with আপু', pg.status === 200 && pg.body.items.length === 2 && pg.body.lang === 'bn' && pg.body.you.word === 'আপু' && pg.body.you.name === 'Mim', pg.body);
check('review-1: ...it shows the shop rating already given, and no product stars filled in', pg.body.shopGiven && pg.body.shopGiven.rating === 5 && pg.body.items.every((i) => !i.given));
check('review-1: a wrong token is a plain 404', (await asB((ctx) => rv.reviewPage(ctx, 'f'.repeat(32)))).status === 404);
let act = await asB((ctx) => rv.reviewAct(ctx, aW.token, { items: [] }, '1.1.1.1'));
check('review-1: Send with no stars asks for a tap', act.body.ok === false && /stars/.test(act.body.error));
site.length = 0;
act = await asB((ctx) => rv.reviewAct(ctx, aW.token, { shop: { rating: 5, text: 'খুব ভালো সার্ভিস' }, items: [{ sku: sku.sku, rating: 4, text: 'রং সুন্দর' }, { sku: 'NOT-ON-SITE', rating: 5 }, { sku: 'NOT-MINE', rating: 1 }] }, '1.1.1.1'));
check('review-1: Send saves the shop and each product rated (not a product they did not buy)', act.body.ok && (await sql`select count(*)::int n from chat_reviews where ask_id = ${aW.id}`)[0].n === 3, act.body);
check('review-1: ...the Facebook page link is offered after a good review', act.body.facebook === 'https://facebook.com/testa/reviews');
check('review-1: ...the chat gets a note of the review', (await sql`select text from inbox_messages where conversation_id = ${vW.id} and direction = 'note' order by created_at desc limit 1`)[0]?.text.includes('রং সুন্দর'));

// ---- 4. the website: sent at once (verified buyers), short names, no product the website lacks sent twice
const sent = site.flatMap((b) => b.reviews);
check('review-1: the reviews went to the website with the sync key', sent.length >= 3 && sent.some((x) => x.kind === 'shop' && x.text === 'খুব ভালো সার্ভিস') && sent.some((x) => x.kind === 'product' && x.sku === sku.sku && x.rating === 4), sent);
check('review-1: ...the name is short (Mim A.), the phone goes for the verified mark', sent.every((x) => x.name === 'Mim A.' || x.name === 'Rafi A.') && sent.some((x) => x.phone === '01712000002'), sent.map((x) => x.name));
const left = await sql`select push_error from chat_reviews where pushed_at is null`;
check('review-1: everything is marked sent; a product not on the website is marked so, not resent', left.length === 0 && (await sql`select push_error from chat_reviews where sku = 'NOT-ON-SITE'`)[0].push_error === 'not on the website', left);
siteDown = true;
await asB((ctx) => rv.reviewAct(ctx, aM.token, { shop: { rating: 4, text: 'fast delivery' } }, '2.2.2.2'));
check('review-1: the website down: the review waits (with the reason)', (await sql`select push_error from chat_reviews where ask_id = ${aM.id} and kind = 'shop'`)[0].push_error === 'website HTTP 502');
siteDown = false; site.length = 0;
await asB((ctx) => rv.reviewTick(ctx));
check('review-1: ...and goes on the next tick', site.length === 1 && !(await sql`select 1 from chat_reviews where pushed_at is null`).length);

// ---- 5. low rating -> a task for the team; the list; hide / show
await asB((ctx) => rv.reviewAct(ctx, aM.token, { items: [{ sku: sku.sku, rating: 2, text: 'jam hoye geche' }] }, '2.2.2.2'));
check('review-1: a low rating opens a task to call the customer', (await sql`select text from inbox_tasks where conversation_id = ${vM.id} and status = 'open' order by created_at desc limit 1`)[0]?.text.includes('01711000001'));
const list = await sales('erpChatReviews', [{}]);
check('review-1: the team sees the average, how many were asked and answered, and the reviews', list.ok && list.result.asked === 2 && list.result.answered === 2 && list.result.count === 2 && list.result.avg === 4.5 && list.result.reviews.length >= 4, list.result && { a: list.result.avg, c: list.result.count });
const one = list.result.reviews.find((x) => x.text === 'রং সুন্দর');
const sHide = await sales('erpChatReviews', [{ action: 'hide', id: one.id }]);
check('review-1: sales staff cannot hide a review', !sHide.ok);
site.length = 0;
const h = await mgr('erpChatReviews', [{ action: 'hide', id: one.id }]);
check('review-1: a manager hides one: it goes to the website as hidden', h.ok && site.some((b) => b.reviews.some((x) => x.text === 'রং সুন্দর' && x.hidden === true)), site);
check('review-1: the other business sees none of it', !(await sql`select 1 from chat_reviews where business_id = ${FIX.B2}`).length && !(await sql`select 1 from review_asks where business_id = ${FIX.B2}`).length);

// ---- 6. the inbound path: a quick-reply tap reaches chatStars before the AI
const before = (await sql`select count(*)::int n from inbox_messages where conversation_id = ${vM.id}`)[0].n;
fb.length = 0;
const ing = await asB((ctx) => ib.ingest(ctx, M, { from: 'PSID1', name: 'Rafi Ahmed', text: '⭐⭐⭐', payload: 'REVIEW:3', id: 'mid-r3' }));
check('review-1: a star tap that comes in from Messenger is saved as the shop rating (no AI reply due)', (await sql`select rating from chat_reviews where ask_id = ${aM.id} and kind = 'shop'`)[0].rating === 3 && !(ing && ing.due), ing);
check('review-1: ...the tap and a thanks are in the chat', (await sql`select count(*)::int n from inbox_messages where conversation_id = ${vM.id}`)[0].n >= before + 2);

// ---- 7. the template outside 24 h uses our review page as its button
check('review-1: the review template button opens the review page (base + token)', /review\.html\?r=$/.test(await asB(async (ctx) => rv.reviewBase(ctx))));
done();
