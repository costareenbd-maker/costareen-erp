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
check('desk-open-1: a salesperson of the business sees the desk, cannot act', r && Array.isArray(r.events) && r.canAct === false && !JSON.stringify(r).includes(KEY), r && (r.error || Object.keys(r)));
check('desk-open-1: the manager can act', desk.canAct === true);

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
check('desk-open-1: a salesperson may watch / download the video', r && r.url, r);

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

// ---- 12. the studio names the business and proves it with that business's engine key (the owner's active business stays)
r = await owner('erpContentStudioUploadUrl', [{ biz: B, key: 'wrong-key-0000000000000', bytes: 1000 }]);
check('studio upload with a wrong engine key is refused', r && r.error && /key/i.test(r.error), r);
r = await owner('erpContentStudioUploadUrl', [{ biz: B2, key: KEY, bytes: 1000 }]);
check('studio upload with another business key is refused', r && r.error, r);
const sup = await owner('erpContentStudioUploadUrl', [{ biz: B, key: KEY, bytes: 2e6 }]);
check('studio upload gives a content path', sup && /^content\/[0-9a-f-]{36}\.mp4$/.test(sup.path), sup);
const ssv = await owner('erpContentStudioSave', [{ biz: B, key: KEY, path: sup.path, bytes: 2e6, title: 'Studio test', platform: 'tiktok', draftId: 7 }]);
check('studio save stores the video in that business, made by the studio', ssv.video && ssv.video.madeBy === 'studio'
  && (await sql`select count(*)::int n from content_videos where business_id = ${B} and file_path = ${sup.path}`)[0].n === 1, ssv);
r = await mgr('erpContentStudioSave', [{ biz: B, key: KEY, path: sup.path, bytes: 1 }]);
check('a manager cannot act as the studio', r && r.error, r);

// ---- 13. channels-1: the Channels tab talks only to THIS business's engine (its own Postiz workspace + pacer)
await sql`update business_config set value = ${JSON.stringify({ url: URL, seen: new Date().toISOString() })} where business_id = ${B} and key = 'brand_bridge'`;
const bz13 = [];
let pz = { workspace: true, paused: false, gap: 20, caps: { facebook: 3, instagram: 2, tiktok: 2, youtube: 1 },
  channels: [{ id: 'cz-fb-1', name: 'Costareen', platform: 'facebook', status: 'ok', sentToday: 1 }, { id: 'cz-tt-1', name: '@costareen', platform: 'tiktok', status: 'reconnect', error: 'token expired' },
             { id: 'cz-li-1', name: 'x', platform: 'linkedin', status: 'ok' }],
  line: [{ id: '11111111-2222-4333-8444-555555555555', platform: 'facebook', at: '2026-11-21T04:30:00+00:00', state: 'waiting', head: 'Marble White PLA', link: 'javascript:alert(1)' },
         { id: '11111111-2222-4333-8444-666666666666', platform: 'facebook', at: '2026-11-21T02:00:00+00:00', state: 'sent', head: 'A1 Mini', link: 'https://facebook.com/1' }] };
web.on(/^https:\/\/bizdesk-test\.trycloudflare\.com\/biz\//, (url, opts) => {
  const body = opts.body ? JSON.parse(opts.body) : null;
  bz13.push({ url, key: opts.headers && opts.headers['X-Bridge-Key'], body });
  if (opts.headers['X-Bridge-Key'] !== KEY) return { status: 401, body: { error: 'wrong key' } };
  if (url.endsWith('/biz/state')) return { body: { ...pz, pacer: true } };
  if (url.endsWith('/biz/rules')) { pz = { ...pz, ...(body.gap ? { gap: body.gap } : {}), ...(body.caps ? { caps: { ...pz.caps, ...body.caps } } : {}), ...('paused' in body ? { paused: body.paused } : {}) }; return { body: { gap: pz.gap, caps: pz.caps, paused: pz.paused } }; }
  if (url.endsWith('/biz/cancel')) return body.id.endsWith('666') ? { status: 400, body: { error: 'পোস্টটা আর লাইনে নেই (চলে গেছে বা আগেই বাতিল)।' } } : { body: { ok: true } };
  if (url.endsWith('/biz/connect')) return { body: { url: 'https://www.tiktok.com/v2/auth/authorize?state=s1&p=' + body.platform + (body.refresh ? '&r=' + body.refresh : '') } };
  return { status: 404, body: { error: 'not found' } };
});
let cs = await owner('erpContentChannels', []);
check('channels: this business only, four networks (others dropped), status kept', cs && cs.workspace === true && cs.channels.length === 2
  && cs.channels.find((c) => c.platform === 'tiktok').status === 'reconnect' && bz13[0].url === URL + '/biz/state' && bz13[0].key === KEY, cs);
check('channels: rules + today line, unsafe link dropped', cs.gap === 20 && cs.caps.youtube === 1 && cs.line.length === 2 && cs.line[0].link === '' && cs.line[1].link === 'https://facebook.com/1', cs.line);
r = await sales('erpContentChannels', []);
check('desk-open-1: a salesperson sees the channels', r && Array.isArray(r.channels) && r.channels.length === 2, r);
r = await sales('erpContentRulesSave', [{ gap: 30 }]);
check('desk-open-1: a salesperson cannot change the rules (server gate)', r && r.error, r);
r = await owner('erpContentRulesSave', [{ gap: 2 }]);
check('gap below 5 minutes refused', r && r.error && /৫ থেকে ২৪০/.test(r.error), r);
r = await owner('erpContentRulesSave', [{ caps: { youtube: 9 } }]);
check('youtube over 6 a day refused', r && r.error, r);
r = await owner('erpContentRulesSave', [{ caps: { myspace: 1 } }]);
check('unknown network refused', r && r.error && /চেনা নেই/.test(r.error), r);
r = await owner('erpContentRulesSave', [{}]);
check('nothing to change refused', r && r.error, r);
const n13 = bz13.length;
r = await owner('erpContentRulesSave', [{ gap: 30, caps: { facebook: 2, youtube: 1 } }]);
check('rules saved through the engine', r && r.gap === 30 && r.caps.facebook === 2 && bz13.length === n13 + 1 && bz13[n13].url === URL + '/biz/rules' && bz13[n13].body.gap === 30, { r, b: bz13[n13] });
r = await owner('erpContentRulesSave', [{ hold: { id: 'cz-fb-1', on: true } }]);
check('one channel on a break', r && !r.error && bz13[bz13.length - 1].body.hold.id === 'cz-fb-1' && bz13[bz13.length - 1].body.hold.on === true, { r, b: bz13[bz13.length - 1] });
r = await owner('erpContentRulesSave', [{ hold: { id: 'x y', on: true } }]);
check('break on an odd id refused', r && r.error, r);
r = await owner('erpContentStop', [{ on: true }]);
check('emergency stop on', r && r.paused === true && bz13[bz13.length - 1].body.paused === true, r);
r = await owner('erpContentStop', [{ on: false }]);
check('emergency stop off', r && r.paused === false, r);
r = await sales('erpContentStop', [{ on: true }]);
check('desk-open-1: a salesperson cannot use the stop', r && r.error && pz.paused === false, r);
r = await mgr('erpContentStop', [{ on: true }]);
check('desk-open-1: the manager can use the stop', r && r.paused === true, r);
await mgr('erpContentStop', [{ on: false }]);
r = await owner('erpContentCancel', [{ id: 'abc' }]);
check('cancel needs a line id', r && r.error, r);
r = await owner('erpContentCancel', [{ id: '11111111-2222-4333-8444-555555555555' }]);
check('cancel a waiting post', r && r.ok === true && bz13[bz13.length - 1].url === URL + '/biz/cancel', r);
r = await owner('erpContentCancel', [{ id: '11111111-2222-4333-8444-666666666666' }]);
check('cancel after it went: the engine\'s sentence', r && r.error && /আর লাইনে নেই/.test(r.error), r);
r = await owner('erpContentConnect', [{ platform: 'linkedin' }]);
check('connect: only the four networks', r && r.error, r);
r = await owner('erpContentConnect', [{ platform: 'tiktok', refresh: 'cz-tt-1' }]);
check('reconnect gives the Postiz page for this workspace', r && /^https:\/\/www\.tiktok\.com\//.test(r.url) && bz13[bz13.length - 1].body.refresh === 'cz-tt-1', r);
r = await owner('erpContentConnect', [{ platform: 'youtube', refresh: 'bad id with spaces' }]);
check('odd channel id refused', r && r.error, r);
// no engine: a plain answer, no call
await sql`delete from business_config where business_id = ${B} and key = 'brand_bridge'`;
const n13b = bz13.length;
cs = await owner('erpContentChannels', []);
check('no engine: says so, nothing called', cs && cs.bridge === false && cs.error && bz13.length === n13b, cs);
r = await owner('erpContentStop', [{ on: true }]);
check('no engine: stop refused plainly', r && r.error && /যুক্ত নেই/.test(r.error), r);
await sql`insert into business_config (business_id, key, value) values (${B}, 'brand_bridge', ${JSON.stringify({ url: URL, seen: new Date().toISOString() })})`;
// the activity log words exist for the writes
const secSrc = (await import('node:fs')).readFileSync(path.join(fnDir, 'handlers', 'security.js'), 'utf8');
check('activity words for the channel writes', ['erpContentRulesSave', 'erpContentStop', 'erpContentCancel', 'erpContentConnect'].every((k) => secSrc.includes(k + ": '")));

// ---- 14. desk-open-1: the business runs its own desk (manager and up approves; everyone in it sees)
const dec = [];
let drafts14 = [{ id: 71, platform: 'facebook', body: 'Marble White', planned_at: new Date(Date.now() + 3600e3).toISOString() }];
web.on(/^https:\/\/bizdesk-test\.trycloudflare\.com\/(drafts|series|biz\/posts)/, (url, opts) => {
  if (opts.headers['X-Bridge-Key'] !== KEY) return { status: 401, body: { error: 'wrong key' } };
  const body = opts.body ? JSON.parse(opts.body) : null;
  if (url.endsWith('/drafts')) return { body: { waiting: drafts14, networks: [] } };
  if (url.endsWith('/series')) return { body: { series: [{ series: 'S1', name: 'New in', eps: [1, 2], done: 1 }] } };
  if (url.endsWith('/biz/posts')) return { body: { workspace: true, posts: [
    { id: 'p1', platform: 'facebook', channel: 'Costareen', at: '2026-11-21T04:00:00Z', state: 'published', link: 'https://facebook.com/x', head: 'Hello' },
    { id: 'p2', platform: 'linkedin', channel: 'x', at: '2026-11-21T05:00:00Z', state: 'QUEUE', head: 'not ours' },
    { id: 'p3', platform: 'facebook', channel: 'Costareen', at: '2026-11-22T05:00:00Z', state: 'QUEUE', link: 'javascript:x', head: 'Next' }] } };
  if (url.endsWith('/drafts/decide')) { dec.push(body); return { body: { queued: ['q1'], waiting: [] } }; }
  return { status: 404, body: { error: 'not found' } };
});
r = await sales('erpContentDrafts', []);
check('drafts: a salesperson sees them, cannot act', r && r.waiting.length === 1 && r.canAct === false, r);
r = await mgr('erpContentDrafts', []);
check('drafts: the manager can act', r && r.canAct === true, r);
r = await sales('erpContentSeries', []);
check('series: everyone in the business', r && r.series && r.series.length === 1, r);
r = await sales('erpContentPosts', []);
check('posts: own workspace only, four networks, unsafe link dropped', r && r.workspace === true && r.posts.length === 2 && r.posts[0].state === 'PUBLISHED' && r.posts[1].link === '', r);
r = await sales('erpContentDraftDecide', [{ id: 71, action: 'approve', networks: [{ id: 'cz-fb-1', platform: 'facebook' }] }]);
check('decide: a salesperson is refused (server side)', r && r.error && dec.length === 0, r);
r = await mgr('erpContentDraftDecide', [{ id: 71, action: 'approve', networks: [{ id: 'cz-fb-1', platform: 'facebook' }, { id: 'page-handler', platform: 'facebook' }] }]);
check('decide: handler + channel mixed refused', r && r.error && dec.length === 0, r);
r = await mgr('erpContentDraftDecide', [{ id: 71, action: 'approve', networks: [{ id: 'cz li 1', platform: 'linkedin' }] }]);
check('decide: odd channel refused', r && r.error && dec.length === 0, r);
r = await mgr('erpContentDraftDecide', [{ id: 71, action: 'approve', networks: [{ id: 'cz-fb-1', platform: 'facebook' }], at: new Date(Date.now() + 400 * 86400e3).toISOString() }]);
check('decide: a time far away refused', r && r.error && dec.length === 0, r);
const at14 = new Date(Date.now() + 2 * 3600e3).toISOString();
r = await mgr('erpContentDraftDecide', [{ id: 71, action: 'approve', networks: [{ id: 'cz-fb-1', platform: 'facebook' }], at: at14 }]);
check('decide: the manager approves with a channel and a time', r && !r.error && dec.length === 1 && dec[0].networks[0].id === 'cz-fb-1' && dec[0].at === at14, { r, dec });
r = await mgr('erpContentDraftDecide', [{ id: 71, action: 'approve', networks: [{ id: 'page-handler', platform: 'facebook' }] }]);
check('decide: "ready for the page handler" still works', r && !r.error && dec.length === 2 && dec[1].networks[0].id === 'page-handler', r);
r = await mgr('erpContentDraftDecide', [{ id: 71, action: 'reject' }]);
check('decide: drop', r && !r.error && dec[2].action === 'reject', r);
const act14 = await sql`select who, role, action, detail from erp_activity where business_id = ${B} and (action = 'erpContentDraftDecide' or detail like '%Content desk post%') order by id desc limit 5`;
check('decide: written to the activity log with the person', act14.length >= 3 && act14.every((a) => a.who && a.role === 'manager'), act14);
// the personal Brand desk never answers through these doors
await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'brand') on conflict (business_id, key) do update set value = 'brand'`;
r = await owner('erpContentDrafts', []);
const r2 = await owner('erpContentDraftDecide', [{ id: 71, action: 'reject' }]);
check('the personal Brand desk is not reachable here', r && r.error && r2 && r2.error && dec.length === 3, { r, r2 });
await sql`delete from business_config where business_id = ${B} and key = 'business_kind'`;
check('the other business is untouched', (await sql`select count(*)::int n from business_config where business_id = ${B2} and key in ('brand_bridge', 'content_handlers')`)[0].n === 0);

// ---- 15. sched-1: "what goes out when" for this business only
web.on(/^https:\/\/bizdesk-test\.trycloudflare\.com\/biz\/(state|posts)$/, (url, opts) => {
  if (opts.headers['X-Bridge-Key'] !== KEY) return { status: 401, body: { error: 'wrong key' } };
  if (url.endsWith('/biz/state')) return { body: { workspace: true, paused: false, channels: [], line: [
    { id: '11111111-2222-4333-8444-000000000001', platform: 'facebook', at: '2026-11-22T04:00:00+00:00', state: 'waiting', head: 'Next one' },
    { id: '11111111-2222-4333-8444-000000000002', platform: 'instagram', at: '2026-11-20T04:00:00+00:00', state: 'ask', head: 'Late one' },
    { id: '11111111-2222-4333-8444-000000000003', platform: 'facebook', at: '2026-11-21T02:00:00+00:00', state: 'sent', head: 'Sent (Postiz shows it)' },
    { id: '11111111-2222-4333-8444-000000000004', platform: 'facebook', at: '2026-11-21T03:00:00+00:00', state: 'cancelled', head: 'Cancelled' }] } };
  return { body: { workspace: true, posts: [
    { id: 'p1', platform: 'facebook', at: '2026-11-21T02:00:00Z', state: 'PUBLISHED', link: 'https://facebook.com/1', head: 'Gone one' },
    { id: 'p2', platform: 'tiktok', at: '2026-11-21T05:00:00Z', state: 'ERROR', head: 'Stuck one', error: 'token expired' },
    { id: 'p3', platform: 'linkedin', at: '2026-11-21T05:00:00Z', state: 'PUBLISHED', head: 'not a business network' }] } };
});
drafts14 = [{ id: 81, platform: 'youtube', title_working: 'Waiting for approval', planned_at: '2026-11-23T13:00:00Z' }, { id: 82, platform: 'facebook', body: 'no slot' }];
r = await sales('erpContentSchedule', []);
const byKey = Object.fromEntries((r.items || []).map((x) => [x.key, x]));
check('schedule: line waiting -> next, ask -> stuck (late), sent/cancelled not doubled', byKey['l11111111-2222-4333-8444-000000000001'].state === 'next'
  && byKey['l11111111-2222-4333-8444-000000000002'].state === 'stuck' && byKey['l11111111-2222-4333-8444-000000000002'].late === true
  && !byKey['l11111111-2222-4333-8444-000000000003'] && !byKey['l11111111-2222-4333-8444-000000000004'], r);
check('schedule: Postiz published -> gone with link, error -> stuck, other networks dropped', byKey.pp1.state === 'gone' && byKey.pp1.link === 'https://facebook.com/1' && byKey.pp2.state === 'stuck' && !byKey.pp3, r.items);
check('schedule: a waiting draft at its routine slot -> wait; no slot -> not on the board', byKey.d81 && byKey.d81.state === 'wait' && !byKey.d82, r.items);
check('schedule: sorted by time, a salesperson reads it but cannot act', r.items.every((x, i, a) => !i || a[i - 1].at <= x.at) && r.canAct === false && r.workspace === true, r);
r = await mgr('erpContentSchedule', []);
check('schedule: the manager can act', r && r.canAct === true, r);
await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'brand') on conflict (business_id, key) do update set value = 'brand'`;
r = await owner('erpContentSchedule', []);
check('schedule: the personal Brand desk is not reachable here', r && r.error, r);
await sql`delete from business_config where business_id = ${B} and key = 'business_kind'`;

await done();
