// brand-1 (3 Nov 2026): the brand desk. The PC checks in with the bridge key and its tunnel address; the desk is open
// for 3 minutes after the last check-in; posts go to the PC's bridge with the key; a wrong key, a business that is not
// the owner's, a manager and a closed PC are refused; the key never comes back in an answer.
import { sql, FIX, owner, mgr, check, done, web } from './harness.mjs';

const B = FIX.B, B2 = FIX.B2, KEY = 'k'.repeat(40), URL = 'https://desk-test.trycloudflare.com';
await sql`insert into erp_app_flags (key, enabled) values ('branddesk', true) on conflict (key) do update set enabled = true`;

const seen = [];
web.on(/^https:\/\/desk-test\.trycloudflare\.com\//, (url, opts) => {
  seen.push({ url, key: opts.headers && opts.headers['X-Bridge-Key'], body: opts.body ? JSON.parse(opts.body) : null });
  if (opts.headers['X-Bridge-Key'] !== KEY) return { status: 401, body: { error: 'wrong key' } };
  if (url.endsWith('/today')) return { body: { pacer: { lines: { linkedin: { waiting: 1 } } }, posts: { posts: [] }, networks: [{ id: 'n1', platform: 'linkedin', name: 'Rahman' }] } };
  if (url.endsWith('/post')) return { body: { queued: ['a', 'b'] } };
  if (url.endsWith('/decide')) return { body: { ok: true } };
  if (/\/board(\/(card|move|done))?$/.test(url)) return { body: { columns: [{ id: 1, title: 'Idea', cards: [{ id: 7, title: 'Why I started', tags: ['story'] }] }, { id: 2, title: 'Script', cards: [] }] } };
  return { status: 404, body: {} };
});

// 1. before set-up: closed, no key
let r = await owner('erpBrandDesk', []);
check('desk starts closed without a key', r.ok && r.result.online === false && r.result.keySet === false, r);
r = await mgr('erpBrandDesk', []);
check('a manager is refused', !r.ok, r);
r = await owner('erpBrandDeskSetup', [{ key: 'short' }]);
check('a short key is refused', !r.ok, r);
r = await owner('erpBrandDeskSetup', [{ key: KEY }]);
check('the key is saved and never returned', r.ok && r.result.keySet === true && !JSON.stringify(r.result).includes(KEY), r);
r = await owner('erpBusinesses', []);
check('set-up marks the business as a brand desk', r.ok && r.result.businesses.find((b) => b.id === B).kind === 'brand', r.result && r.result.businesses);
check('the other business keeps no kind', r.ok && !(r.result.businesses.find((b) => b.id === B2) || {}).kind, r.result && r.result.businesses);

// 2. the PC checks in
r = await owner('erpBrandDeskHello', [{ biz: B, url: URL, key: 'wrong'.repeat(5) }]);
check('a wrong bridge key cannot check in', !r.ok && /Wrong bridge key/.test(r.error), r);
r = await owner('erpBrandDeskHello', [{ biz: B, url: 'http://plain.test', key: KEY }]);
check('a plain http address is refused', !r.ok, r);
r = await owner('erpBrandDeskHello', [{ biz: '00000000-0000-0000-0000-000000000000', url: URL, key: KEY }]);
check('a business that is not his is refused', !r.ok && /not yours/.test(r.error), r);
r = await owner('erpBrandDeskHello', [{ biz: B, url: URL + '/', key: KEY }]);
check('the PC checks in', r.ok, r);

// 3. open: today's lines come from the PC
r = await owner('erpBrandDesk', []);
check('the desk is open with the PC\'s day', r.ok && r.result.online && r.result.today && r.result.today.networks[0].id === 'n1', r);
check('the bridge got the key in the header', seen.length && seen[seen.length - 1].key === KEY, seen);

// 4. a post goes to the bridge
r = await owner('erpBrandDeskPost', [{ networks: [], content: 'x' }]);
check('no network is refused', !r.ok, r);
r = await owner('erpBrandDeskPost', [{ networks: [{ id: 'n1', platform: 'linkedin' }], content: '  ' }]);
check('an empty post is refused', !r.ok, r);
r = await owner('erpBrandDeskPost', [{ networks: [{ id: 'n1', platform: 'linkedin' }, { id: 'n2', platform: 'x' }], content: 'Hello', urgent: true }]);
const sent = seen.filter((s) => s.url.endsWith('/post')).pop();
check('the post is queued on the PC', r.ok && r.result.queued === 2 && sent.body.networks.length === 2 && sent.body.urgent === true, r);
r = await owner('erpBrandDeskDecide', [{ id: 'a', action: 'fire' }]);
check('a strange answer is refused', !r.ok, r);
r = await owner('erpBrandDeskDecide', [{ id: 'a', action: 'drop' }]);
check('a late post can be dropped', r.ok, r);

// 4b. the content board (brand-2)
r = await owner('erpBrandDeskBoard', []);
check('the board comes from the PC', r.ok && r.result.board.columns[0].cards[0].id === 7 && r.result.pillars.length === 5, r);
r = await owner('erpBrandDeskCard', [{ title: '' }]);
check('a card without a title is refused', !r.ok, r);
r = await owner('erpBrandDeskCard', [{ title: 'Why I started Costareen', tags: ['Story', 'customer', ''], column: 1 }]);
const card = seen.filter((x) => x.url.endsWith('/board/card')).pop();
check('a card goes to the PC with clean tags', r.ok && card.body.tags.join() === 'story,customer' && card.body.column === 1, card && card.body);
r = await owner('erpBrandDeskMove', [{ id: 'x', column: 2 }]);
check('a move without a card is refused', !r.ok, r);
r = await owner('erpBrandDeskMove', [{ id: 7, column: 2 }]);
check('a card moves', r.ok && seen.filter((x) => x.url.endsWith('/board/move')).pop().body.column === 2, r);
r = await mgr('erpBrandDeskBoard', []);
check('a manager does not see the board', !r.ok, r);

// 5. the PC goes quiet: closed after 3 minutes
await sql`update business_config set value = ${JSON.stringify({ url: URL, seen: new Date(Date.now() - 4 * 60e3).toISOString() })} where business_id = ${B} and key = 'brand_bridge'`;
r = await owner('erpBrandDesk', []);
check('4 minutes without a check-in: closed', r.ok && r.result.online === false && r.result.today === null, r);
r = await owner('erpBrandDeskPost', [{ networks: [{ id: 'n1', platform: 'linkedin' }], content: 'Hello' }]);
check('posting while the PC is off says so', !r.ok && /PC is off/.test(r.error), r);

// 6. the other business is untouched
const other = await sql`select count(*)::int as n from business_config where business_id = ${B2} and key = 'brand_bridge'`;
check('the other business has nothing', other[0].n === 0, other);
await done();
