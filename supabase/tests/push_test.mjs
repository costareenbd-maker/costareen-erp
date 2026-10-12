// What to push next (handlers/push.js): the four lists from the shop's own sales and stock; the offer that keeps a
// margin; the rules; and the "Only me" switch: off for every company until the provider opens it.
import { sql, FIX, owner, mgr, sales, check, done, deps, web } from './harness.mjs';

const add = (sku, name, cost, sell, stock) => mgr('erpSaveProduct', [{ isNew: true, sku, product_name: name, brand: 'Sunlu', category: 'Filaments', unit: 'Roll', cost_price: cost, sell_price: sell, opening_stock: stock }]);
let r;
for (const [s, n, c, p, q] of [['HOT', 'Hot seller', 1000, 1500, 60], ['DEAD', 'Dead stock', 1000, 1500, 12], ['LOW', 'Low stock seller', 1000, 1500, 20], ['UP', 'Rising one', 1000, 1500, 40]]) { r = await add(s, n, c, p, q); check('fixture ' + s, r.ok, r); }
// sales: HOT 10 in the last 30 days and 10 before; LOW 18 of 20 recently (2 left, ~10 days of cover); UP 6 now, 2 before; DEAD never
const sell = async (sku, qty, daysAgo) => { const d = new Date(Date.now() - daysAgo * 86400000).toISOString().slice(0, 10); const x = await mgr('erpCreateInvoice', [{ customer: { name: 'Buyer', phone: '01712345678' }, items: [{ sku, qty }], payMode: 'full', paymentMethod: 'Cash', date: d }]); if (!x.ok) throw new Error(x.error); };
await sell('HOT', 10, 5); await sell('HOT', 10, 40); await sell('LOW', 18, 3); await sell('UP', 6, 4); await sell('UP', 2, 45);

r = await sales('erpPushList', []);
check('sales staff cannot', !r.ok, r);
r = await mgr('erpPushList', []);
check('the lists come back with the rules', r.ok && r.result.rules.coverDays === 30 && Array.isArray(r.result.advertise), r);
const L = r.result;
const has = (list, sku) => list.some((x) => x.sku === sku);
check('HOT: sells, 40 left (~180 days of cover), 33% margin -> advertise', has(L.advertise, 'HOT') && !has(L.hold, 'HOT'), L.advertise.map((x) => x.sku + ':' + x.why));
check('DEAD: never sold, 12 x 1000 on the shelf -> clear out, offer keeps 10% over cost', has(L.clear, 'DEAD') && L.clear.find((x) => x.sku === 'DEAD').offer === 1100 && L.clear.find((x) => x.sku === 'DEAD').offPct === 27, L.clear);
check('LOW: sells but would run out -> not now, reorder first', has(L.hold, 'LOW') && !has(L.advertise, 'LOW'), L.hold.map((x) => x.sku + ':' + x.why));
check('UP: 6 now vs 2 before -> rising', has(L.rising, 'UP'), L.rising.map((x) => x.sku + ':' + x.why));
check('money tied up counts the dead stock', L.tied >= 12000, L.tied);

// the rules
r = await mgr('erpPushRulesSave', [{ coverDays: 30, slowDays: 60, minValue: 2000, marginFloor: 15, keepMargin: 25, lowCover: 14 }]);
check('a manager cannot change the rules', !r.ok, r);
r = await owner('erpPushRulesSave', [{ coverDays: 30, slowDays: 60, minValue: 2000, marginFloor: 15, keepMargin: 25, lowCover: 14 }]);
check('the owner raises the kept margin: the offer follows (1250)', r.ok && r.result.rules.keepMargin === 25 && r.result.clear.find((x) => x.sku === 'DEAD').offer === 1250, r.ok ? r.result.clear : r);

// "Only me": off for everyone until the provider opens it
r = await owner('erpApps', []);
const push = r.result.apps.find((a) => a.key === 'push');
check('the app exists, marked labs, off for everyone by default', push && push.labs === true && push.on === false, push);
r = await owner('erpAppSet', [{ key: 'push', on: true, scope: 'all' }]);
check('not the provider: cannot open it', !r.ok, r);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
r = await owner('erpAppSet', [{ key: 'push', on: true, scope: 'all' }]);
check('the provider opens it to everyone', r.ok && r.result.apps.find((a) => a.key === 'push').on === true, r);
r = await owner('erpAppSet', [{ key: 'push', on: false, scope: 'all' }]);
check('...and closes it again', r.ok && r.result.apps.find((a) => a.key === 'push').on === false, r);

// the full in-stock list for customers
check('the in-stock product list comes along, sorted by category and name', L.all.length >= 4 && ['DEAD', 'HOT', 'LOW', 'UP'].every((k) => L.all.some((x) => x.sku === k)) && L.all.every((x) => x.sell > 0 && x.stock > 0), L.all.map((x) => x.sku + ':' + x.sell + ':' + x.stock));

// Advertisement: the AI writes a caption from the facts; owner only; no key = plain refusal
let seen = null;
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => { seen = JSON.parse(opts.body); return { status: 200, body: { candidates: [{ content: { parts: [{ text: 'Dead stock now BDT 1,250. Only 12 left.' }] } }] } }; });
deps.geminiKey = '';
r = await owner('erpAdDraft', [{ channel: 'offer', name: 'Dead stock', sell: 1500, offer: 1250, offPct: 17, stock: 12 }]);
check('no key: a plain refusal', !r.ok && /not set up/.test(r.error), r);
deps.geminiKey = 'k';
r = await mgr('erpAdDraft', [{ channel: 'offer', name: 'Dead stock', sell: 1500 }]);
check('a manager cannot ask for advertisements', !r.ok, r);
r = await owner('erpAdDraft', [{ channel: 'offer', name: 'Dead stock', sell: 1500, offer: 1250, offPct: 17, stock: 12, lang: 'bn', notes: 'mention free delivery' }]);
const sent = seen ? JSON.stringify(seen) : '';
check('the caption comes back, the facts and the language went to the model', r.ok && /1,250/.test(r.result.text) && r.result.channel === 'offer' && /Offer price: BDT 1250/.test(sent) && /Bangla/.test(sent) && /free delivery/.test(sent), r.ok ? sent.slice(0, 300) : r);
r = await owner('erpAdDraft', [{ channel: 'nonsense', name: 'Dead stock', sell: 1500 }]);
check('an unknown channel falls back to a post', r.ok && r.result.channel === 'post', r);
await done();
