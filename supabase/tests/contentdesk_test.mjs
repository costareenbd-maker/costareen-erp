// content-desk-1 (19 Nov 2026): the business Content desk, server side. Events are written only when the business has
// the "Only me" app contentdesk AND its own content engine (brand_bridge); products made close together become one
// event; a supplier order becomes "coming" (10 days before its ETA, else 30 days after the order, never in the past);
// a received shipment becomes "arrived" (and the order's "coming" is skipped); the timer hands due events to the
// engine and marks them sent / failed (one retry); the handlers' list, video upload/save/send with refusals; the
// business switch carries desk:true; the other business is never touched.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner as owner0, mgr as mgr0, sales as sales0, check, done, web, deps, fnDir } from './harness.mjs';

const un = (x) => (x && x.ok && 'result' in x ? x.result : x);   // the answer, or {ok:false, error}
const owner = async (n, a) => un(await owner0(n, a)), mgr = async (n, a) => un(await mgr0(n, a)), sales = async (n, a) => un(await sales0(n, a));

const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const { contentTick, eventText } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'contentdesk.js')));

const B = FIX.B, B2 = FIX.B2, KEY = 'c'.repeat(40), URL = 'https://bizdesk-test.trycloudflare.com';
const events = async (kind) => sql`select * from content_events where business_id = ${B} ${kind ? sql`and kind = ${kind}` : sql``} order by id`;
let n = 0;
const newProduct = (name, extra) => owner('erpSaveProduct', [{ isNew: true, product_name: name, category: 'Filaments', brand: 'Sunlu', type: 'PETG', color: 'C' + (++n), sell_price: 1500, ...(extra || {}) }]);

// ---- 1. app off, no bridge: nothing
let r = await newProduct('Sunlu PETG Off');
check('product saved with the desk closed', r && r.ok && r.created, r);
check('no event while the app is off and there is no bridge', (await events()).length === 0);

// bridge set, app still off: nothing
await sql`insert into business_config (business_id, key, value) values (${B}, 'brand_bridge', ${JSON.stringify({ url: URL, seen: new Date().toISOString() })})
          on conflict (business_id, key) do update set value = excluded.value`;
await newProduct('Sunlu PETG Off2');
check('no event while the app is off (bridge set)', (await events()).length === 0);
const desk0 = await owner('erpContentDesk', []);
check('the desk is refused while the app is off', desk0 && desk0.error && /চালু হয়নি/.test(desk0.error), desk0);

// app on, bridge removed: nothing
await sql`insert into erp_app_flags (key, enabled) values ('contentdesk', true) on conflict (key) do update set enabled = true`;
await sql`delete from business_config where business_id = ${B} and key = 'brand_bridge'`;
await newProduct('Sunlu PETG NoBridge');
check('no event without a bridge (app on)', (await events()).length === 0);

// ---- 2. app on + bridge: one event, then three more products merge into it
await sql`insert into business_config (business_id, key, value) values (${B}, 'brand_bridge', ${JSON.stringify({ url: URL, seen: new Date().toISOString() })})`;
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'BRAND_BRIDGE_KEY', ${KEY}) on conflict (business_id, key) do update set value = excluded.value`;
r = await newProduct('Sunlu PETG Red', { opening_stock: 5 });
let ev = await events('new_product');
check('one waiting event for a new product', ev.length === 1 && ev[0].state === 'waiting', ev);
const due0 = new Date(ev[0].due_at).getTime(), made0 = new Date(ev[0].created_at).getTime();
check('due 2 hours after the first product', Math.abs(due0 - made0 - 2 * 3600e3) < 60e3, { due0, made0 });
const p0 = ev[0].payload.products[0];
check('facts only from the ERP: name, brand, sku, price, stock', p0.name === 'Sunlu PETG Red' && p0.brand === 'Sunlu' && p0.sku === r.sku && p0.price === 1500 && p0.stock === 5, p0);
await newProduct('Sunlu PETG Blue'); await newProduct('Sunlu PETG Green'); await newProduct('Sunlu PETG White');
ev = await events('new_product');
check('three more products join the same event', ev.length === 1 && ev[0].payload.products.length === 4 && ev[0].payload.count === 4, ev.map((e) => e.payload));
check('the merged event keeps its first due time', new Date(ev[0].due_at).getTime() === due0);
// a batch that is already due takes no more: the next product starts a new event
await sql`update content_events set due_at = now() - interval '1 minute' where business_id = ${B} and kind = 'new_product'`;
await newProduct('Sunlu PETG Grey');
ev = await events('new_product');
check('after the batch is due, a new product starts a new event', ev.length === 2 && ev[1].payload.products[0].name === 'Sunlu PETG Grey', ev.length);
await sql`update content_events set state = 'skipped' where id = ${ev[1].id}`;
// the Excel / receive / order path makes products through addProduct too: one more check via an order with a new product
check('no event of the other business', (await sql`select count(*)::int n from content_events where business_id = ${B2}`)[0].n === 0);

// ---- 3. a supplier order -> coming (no ETA: 30 days after the order)
r = await owner('erpPoCreate', [{ shipBy: 'Sea', supplier: 'Sunlu Direct', lines: [{ sku: 'FIL-SUN-PLA-BLA-001', qty: 40 }, { sku: 'PRT-BAM-A1-001', qty: 2 }] }]);
check('order written', r && r.ok && r.poId, r);
const po = r.poId;
let co = await events('shipment_coming');
check('a coming event for the order', co.length === 1 && co[0].ref === po && co[0].state === 'waiting', co);
const d30 = new Date(co[0].due_at).getTime() - Date.now();
check('no ETA: due about 30 days after the order', d30 > 29.9 * 86400e3 && d30 < 30.1 * 86400e3, d30 / 86400e3);
check('coming facts: products with quantity and stock', co[0].payload.products.length === 2 && co[0].payload.products.find((p) => p.sku === 'FIL-SUN-PLA-BLA-001').qty === 40 && co[0].payload.products.find((p) => p.sku === 'FIL-SUN-PLA-BLA-001').name === 'Sunlu PLA Black', co[0].payload);
// the ETA set later moves it to 10 days before
const eta = new Date(Date.now() + 40 * 86400e3).toISOString().slice(0, 10);
r = await owner('erpPoStage', [{ poId: po, stage: 'in_transit', eta }]);
co = await events('shipment_coming');
const d10 = new Date(co[0].due_at).getTime() - new Date(eta + 'T06:00:00Z').getTime();
check('an ETA moves "coming" to 10 days before it', Math.abs(d10 + 10 * 86400e3) < 60e3 && co[0].payload.eta === eta, { r, d10, p: co[0].payload });
// an ETA in 3 days: never before now
r = await owner('erpPoCreate', [{ shipBy: 'Air', supplier: 'Sunlu Direct', eta: new Date(Date.now() + 3 * 86400e3).toISOString().slice(0, 10), lines: [{ sku: 'PRT-BAM-A1-001', qty: 1 }] }]);
const po2 = r.poId;
const co2 = (await events('shipment_coming')).find((e) => e.ref === po2);
check('an ETA closer than 10 days: due now, never in the past', co2 && Math.abs(new Date(co2.due_at).getTime() - Date.now()) < 120e3, co2 && co2.due_at);
// the same order again makes no second event (dedupe)
check('one coming event per order', (await events('shipment_coming')).filter((e) => e.ref === po).length === 1);

// ---- 4. received -> arrived, and its coming is skipped
r = await owner('erpReceiveShipment', [{ poId: po, reference: 'SHIP-T1', from: 'shipment', mode: 'none', lines: [{ sku: 'FIL-SUN-PLA-BLA-001', qty: 40 }, { sku: 'PRT-BAM-A1-001', qty: 2 }] }]);
check('shipment received', r && r.ok, r);
let ar = await events('shipment_arrived');
check('an arrived event, due now', ar.length === 1 && ar[0].ref === po && Math.abs(new Date(ar[0].due_at).getTime() - Date.now()) < 120e3, ar);
check('arrived facts carry qty and the stock after receiving', ar[0].payload.products[0].qty === 40 && ar[0].payload.products[0].stock === 47, ar[0].payload.products);
co = await events('shipment_coming');
check('the order\'s "coming" is skipped once it arrived', co.find((e) => e.ref === po).state === 'skipped');
// a local buy without an order makes no arrived event
r = await owner('erpReceiveShipment', [{ from: 'local', mode: 'none', lines: [{ sku: 'FIL-SUN-PLA-BLA-001', qty: 1 }] }]);
check('a local buy makes no arrived event', r && r.ok && (await events('shipment_arrived')).length === 1, r);
const txt = eventText(ar[0]);
check('Bangla text from the facts', /^শিপমেন্ট চলে এসেছে: Sunlu PLA Black, Bambu A1।/.test(txt) && /দাম ৳1,350/.test(txt) && /এসেছে 40টি/.test(txt), txt);

// ---- 5. the timer: due events go to the engine
const seen = [];
let fail = false;
web.on(/^https:\/\/bizdesk-test\.trycloudflare\.com\//, (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  seen.push({ url, key: opts.headers && opts.headers['X-Bridge-Key'], body });
  if (opts.headers['X-Bridge-Key'] !== KEY) return { status: 401, body: { error: 'wrong key' } };
  if (fail) return { status: 500, body: { error: 'engine busy' } };
  return { body: { job: 'j' + seen.length, idea_id: 100 + seen.length } };
});
const [row] = await owners(sql, [B]);
const tick = () => asBusiness(deps, row, 'content:tick', (ctx) => contentTick(ctx));
// Mac off: nothing sent, nothing failed
await sql`update business_config set value = ${JSON.stringify({ url: URL, seen: new Date(Date.now() - 3600e3).toISOString() })} where business_id = ${B} and key = 'brand_bridge'`;
let t = await tick();
check('Mac off: nothing sent and nothing failed', t.offline && seen.length === 0 && (await events()).every((e) => e.state !== 'failed'), t);
await sql`update business_config set value = ${JSON.stringify({ url: URL, seen: new Date().toISOString() })} where business_id = ${B} and key = 'brand_bridge'`;
t = await tick();
const sentNow = (await events()).filter((e) => e.state === 'sent');
check('due events sent to the engine', t.sent >= 2 && sentNow.length === t.sent, { t, st: (await events()).map((e) => [e.kind, e.state, e.error]) });
const call0 = seen.find((s) => /শিপমেন্ট চলে এসেছে/.test(s.body.text));
check('the call: /drafts/make with key, topic, 4 networks, video', call0 && call0.url === URL + '/drafts/make' && call0.key === KEY && call0.body.topic === 'cz_stock' && call0.body.video === true
      && JSON.stringify(call0.body.platforms) === JSON.stringify(['facebook', 'instagram', 'tiktok', 'youtube']), call0);
const callNews = seen.find((s) => s.body.event.kind === 'shipment_coming');
check('"coming" goes as cz_news', callNews && callNews.body.topic === 'cz_news' && /শিপমেন্ট আসছে/.test(callNews.body.text), callNews && callNews.body);
check('sent events keep the job and idea id', sentNow.every((e) => e.bridge_job && e.idea_id > 100 && e.sent_at));
const callNp = seen.find((s) => s.body.event.kind === 'new_product');
check('the new-product text names all four, with stock read at send time', callNp && /^নতুন এসেছে: Sunlu PETG Red, Sunlu PETG Blue, Sunlu PETG Green, Sunlu PETG White।/.test(callNp.body.text) && /এখন স্টকে 5টি/.test(callNp.body.text), callNp && callNp.body.text);
// failure: marked failed, retried once after an hour, then left failed
fail = true;
await newProduct('Sunlu PETG Fail');
await sql`update content_events set due_at = now() - interval '1 minute' where business_id = ${B} and state = 'waiting' and kind = 'new_product'`;
t = await tick();
let fe = (await events('new_product')).find((e) => e.payload.products[0].name === 'Sunlu PETG Fail');
check('a failed send is marked failed with the error, retry in an hour', fe.state === 'failed' && fe.tries === 1 && /engine busy/.test(fe.error) && new Date(fe.due_at) > new Date(Date.now() + 50 * 60e3), fe);
t = await tick();
check('not retried before the hour', (await events('new_product')).find((e) => e.id === fe.id).tries === 1);
await sql`update content_events set due_at = now() - interval '1 minute' where id = ${fe.id}`;
t = await tick();
fe = (await events('new_product')).find((e) => e.id === fe.id);
check('retried once, then left failed', fe.state === 'failed' && fe.tries === 2, fe);
await sql`update content_events set due_at = now() - interval '1 minute' where id = ${fe.id}`;
const before = seen.length; await tick();
check('no third try', seen.length === before);
fail = false;

// ---- 6. reads, roles
let desk = await mgr('erpContentDesk', []);
check('the manager opens the desk', desk && Array.isArray(desk.events) && desk.events.length >= 5 && desk.online === true && desk.whatsapp === false, desk && (desk.error || Object.keys(desk)));
check('the desk never shows the bridge key', !JSON.stringify(desk).includes(KEY));
r = await sales('erpContentDesk', []);
check('a salesperson is refused the desk', r && r.error, r);

// ---- 7. handlers' list
r = await mgr('erpContentHandlersSave', [{ handlers: [{ name: 'Page Admin', phone: '01711111111' }, { name: 'Reel Maker', phone: '+8801822222222' }] }]);
check('handlers saved, phones normalised', r && r.handlers && r.handlers[1].phone === '01822222222', r);
r = await mgr('erpContentHandlersSave', [{ handlers: [{ name: 'Bad', phone: '12345' }] }]);
check('a wrong phone refused', r && r.error && /নম্বরটা ঠিক নেই/.test(r.error), r);
r = await mgr('erpContentHandlersSave', [{ handlers: [{ name: '', phone: '01711111111' }] }]);
check('a nameless handler refused', r && r.error, r);
r = await mgr('erpContentHandlersSave', [{ handlers: Array.from({ length: 11 }, (_, i) => ({ name: 'P' + i, phone: '0171111111' + (i % 10) })) }]);
check('more than 10 refused', r && r.error && /১০/.test(r.error), r);
r = await mgr('erpContentHandlersSave', [{ handlers: [{ name: 'A', phone: '01711111111' }, { name: 'B', phone: '01711111111' }] }]);
check('the same phone twice refused', r && r.error, r);
r = await sales('erpContentHandlersSave', [{ handlers: [] }]);
check('a salesperson cannot change the list', r && r.error, r);
desk = await owner('erpContentDesk', []);
check('the list kept the good save', desk.handlers.length === 2 && desk.handlers[0].name === 'Page Admin', desk.handlers);

// ---- 8. videos: upload address, save, refusals
r = await mgr('erpContentVideoUploadUrl', [{ bytes: 1000 }]);
check('a manager cannot upload a video', r && r.error, r);
r = await owner('erpContentVideoUploadUrl', [{ bytes: 81 * 1024 * 1024 }]);
check('over 80 MB refused', r && r.error && /MB/.test(r.error), r);
const up = await owner('erpContentVideoUploadUrl', [{ bytes: 12e6 }]);
check('upload address in content/<uuid>.mp4', up && /^content\/[0-9a-f-]{36}\.mp4$/.test(up.path) && up.url, up);
r = await owner('erpContentVideoSave', [{ path: 'social/x.mp4', bytes: 1000, title: 'x' }]);
check('a path outside content/ refused', r && r.error, r);
r = await owner('erpContentVideoSave', [{ path: up.path, bytes: 90 * 1024 * 1024, title: 'x' }]);
check('save over 80 MB refused', r && r.error, r);
r = await owner('erpContentVideoSave', [{ path: up.path, bytes: 12e6, title: 'PETG এসেছে', platform: 'pinterest' }]);
check('an unknown network refused', r && r.error, r);
r = await mgr('erpContentVideoSave', [{ path: up.path, bytes: 12e6, title: 'PETG' }]);
check('a manager cannot save a video', r && r.error, r);
const sv = await owner('erpContentVideoSave', [{ path: up.path, bytes: 12e6, title: 'PETG এসেছে', platform: 'facebook', draftId: 55, madeBy: 'studio' }]);
check('video saved', sv && sv.video && sv.video.id && sv.video.platform === 'facebook' && sv.video.draftId === 55, sv);
const vid = sv.video.id;
r = await mgr('erpContentVideoUrl', [{ id: vid }]);
check('a 1-hour download link', r && r.url && r.url.includes(B + '/content/') && r.expiresIn === 3600, r);
r = await sales('erpContentVideoUrl', [{ id: vid }]);
check('a salesperson gets no link', r && r.error, r);

// ---- 9. send by the business's own WhatsApp
r = await mgr('erpContentVideoSend', [{ id: vid, phone: '01711111111' }]);
check('no WhatsApp channel: a plain Bangla refusal', r && r.error && /WhatsApp নম্বর ERP-তে যুক্ত নেই/.test(r.error), r);
const ch = (await sql`insert into inbox_channels (business_id, kind, name, external_id, status) values (${B}, 'wa_evo', 'Shop WhatsApp', 'shop1', 'live') returning id`)[0].id;
await sql`insert into business_secrets (business_id, key, value) values (${B}, ${'INBOX_' + ch + '_URL'}, 'https://evo.test'), (${B}, ${'INBOX_' + ch + '_KEY'}, 'evokey')`;
const wa = [];
web.on(/^https:\/\/evo\.test\//, (url, opts) => { wa.push({ url, body: JSON.parse(opts.body) }); return { body: { key: { id: 'm1' } } }; });
r = await mgr('erpContentVideoSend', [{ id: vid, phone: '01799999999' }]);
check('a phone not on the list refused', r && r.error && /তালিকায় নেই/.test(r.error) && wa.length === 0, r);
r = await sales('erpContentVideoSend', [{ id: vid, phone: '01711111111' }]);
check('a salesperson cannot send', r && r.error && wa.length === 0, r);
r = await mgr('erpContentVideoSend', [{ id: vid, phone: '01711111111' }]);
check('sent on the business\'s own number', r && r.ok && wa.length === 1 && wa[0].url === 'https://evo.test/message/sendMedia/shop1' && wa[0].body.mediatype === 'video' && wa[0].body.number === '8801711111111' && /content\//.test(wa[0].body.media), { r, wa });
const vrow = (await sql`select sent from content_videos where id = ${vid}`)[0];
check('the send is recorded on the video', vrow.sent.length === 1 && vrow.sent[0].phone === '01711111111' && vrow.sent[0].via === 'Shop WhatsApp', vrow.sent);
r = await mgr('erpContentVideoSend', [{ id: 999999, phone: '01711111111' }]);
check('a video that is not here refused', r && r.error, r);

// ---- 10. the other business is untouched; a video of B cannot be read from B2's side
check('B2 has no events, videos or handler list', (await sql`select (select count(*) from content_events where business_id = ${B2}) + (select count(*) from content_videos where business_id = ${B2}) + (select count(*) from business_config where business_id = ${B2} and key = 'content_handlers') as n`)[0].n == 0);
check('videos are stored under the business id', sv.video.path.startsWith('content/') && r !== null);

// ---- 11. the business switch: desk flag
let bz = await owner('erpBusinesses', []);
check('the business with a bridge carries desk:true', bz.businesses.find((b) => b.id === B).desk === true, bz.businesses);
await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'brand') on conflict (business_id, key) do update set value = 'brand'`;
bz = await owner('erpBusinesses', []);
check('the personal brand desk is not a Content desk', !bz.businesses.find((b) => b.id === B).desk && bz.businesses.find((b) => b.id === B).kind === 'brand', bz.businesses);
await newProduct('Brand kind product');
check('no event on a brand-kind business', !(await events('new_product')).some((e) => e.payload.products.some((p) => p.name === 'Brand kind product')));
await sql`delete from business_config where business_id = ${B} and key = 'business_kind'`;

await done();
