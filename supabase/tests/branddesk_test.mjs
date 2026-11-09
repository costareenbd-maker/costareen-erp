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
  // brand-7: the claim check and the settings in the brand core database
  if (url.endsWith('/drafts') || url.endsWith('/drafts/make') || url.endsWith('/drafts/decide')) return { body: { waiting: [{ id: 5, platform: 'linkedin', lang: 'en', body: 'Draft', legal_flags: [] }], ideas: [{ id: 3, title_working: 'How to tell a genuine product' }], jobs: {}, networks: [], queued: url.endsWith('/decide') ? ['q1'] : undefined } };
  if (url.endsWith('/lint')) { const t = (opts.body && JSON.parse(opts.body).text) || ''; return { body: { hits: /treats acne/i.test(t) ? [{ rule_id: 3, severity: 'block', reason: 'Health claim', match: 'treats' }] : (/#a #b #c #d/.test(t) ? [{ rule_id: 15, severity: 'warn', reason: 'More than 3 hashtags', match: '#a' }] : []) } }; }
  if (url.endsWith('/settings') || url.endsWith('/settings/weights') || url.endsWith('/settings/cadence')) return { body: { topics: [{ key: 'beauty_wholesale', label_en: 'Wholesale' }, { key: 'printing_3d', label_en: '3D' }], weights: { linkedin: { beauty_wholesale: 100 } }, cadence: [], settings: { cadence_level: 'start' }, connectors: [] } };
  if (url.endsWith('/decide')) return { body: { ok: true } };
  if (url.endsWith('/shorts')) return { body: { jobs: { '18181596-5276-4153-9412-2f441efac82b': { state: 'making' } } } };
  if (/\/videos(\?q=.*)?$/.test(url)) return { body: { videos: [{ id: 'v1', name: 'clip01.mp4', duration: 2800, thumb: 'data:image/webp;base64,AAAA' }], q: decodeURIComponent((url.split('q=')[1] || '')) } };
  if (url.endsWith('/people')) return { body: { people: [{ id: 'p1', name: 'Kim Supplier', email: 'kim@example.com', phone: '', job: 'Export manager', audience: 'supplier', about: 'k-beauty', source: 'LinkedIn post' }] } };
  if (url.endsWith('/ideas') || url.endsWith('/ideas/board')) return { body: { ideas: [{ id: 'abcd1234', content: 'Why I started', at: '2026-11-03T00:00:00Z', tags: [] }] } };
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
// 4a. brand-7: the claim check stops a blocked post before it is queued; warnings do not stop it
const before = seen.filter((x) => x.url.endsWith('/post')).length;
r = await owner('erpBrandDeskPost', [{ networks: [{ id: 'n1', platform: 'linkedin' }], content: 'This serum treats acne fast' }]);
check('a post the claim check blocks is refused and not queued', !r.ok && /claim check/.test(r.error) && seen.filter((x) => x.url.endsWith('/post')).length === before, r);
r = await owner('erpBrandDeskPost', [{ networks: [{ id: 'n1', platform: 'linkedin' }], content: 'Sourcing day #a #b #c #d' }]);
check('a warning alone does not stop the post', r.ok && r.result.queued === 2, r);
r = await owner('erpBrandDeskLint', [{ text: 'treats acne' }]);
check('the claim check answers on its own', r.ok && r.result.hits[0].severity === 'block', r);
r = await owner('erpBrandDeskLint', [{ text: '' }]);
check('an empty text has nothing to check', r.ok && r.result.hits.length === 0, r);
r = await owner('erpBrandDeskSettings', []);
check('the rules come from the brand database', r.ok && r.result.weights.linkedin.beauty_wholesale === 100, r);
r = await owner('erpBrandDeskWeights', [{ platform: 'facebook', weights: { beauty_wholesale: 70, printing_3d: 20 } }]);
check('a mix that does not add up to 100 is refused', !r.ok && /add up to 90/.test(r.error), r);
r = await owner('erpBrandDeskWeights', [{ platform: 'facebook', weights: { beauty_wholesale: 75.5, printing_3d: 24.5 } }]);
check('shares must be whole numbers', !r.ok, r);
r = await owner('erpBrandDeskWeights', [{ platform: 'facebook', weights: { 'bad key!': 100 } }]);
check('a strange topic name is refused', !r.ok, r);
r = await owner('erpBrandDeskWeights', [{ platform: 'facebook', weights: { beauty_wholesale: 75, printing_3d: 25 } }]);
const wsent = seen.filter((x) => x.url.endsWith('/settings/weights')).pop();
check('a good mix goes to the brand database', r.ok && wsent && wsent.body.platform === 'facebook' && wsent.body.weights.printing_3d === 25, wsent);
r = await owner('erpBrandDeskCadence', [{ level: 'max' }]);
check('only start or scale', !r.ok, r);
r = await owner('erpBrandDeskCadence', [{ level: 'scale' }]);
check('the posting level changes', r.ok && seen.filter((x) => x.url.endsWith('/settings/cadence')).pop().body.level === 'scale', r);
r = await mgr('erpBrandDeskSettings', []);
check('a manager does not see the rules', !r.ok, r);
r = await mgr('erpBrandDeskWeights', [{ platform: 'facebook', weights: { beauty_wholesale: 100 } }]);
check('a manager cannot change the mix', !r.ok, r);

// 4a2. brand-8: drafts from the idea bank; nothing goes out without an approval naming the account
r = await owner('erpBrandDeskDrafts', []);
check('drafts waiting come from the brand database', r.ok && r.result.waiting[0].id === 5, r);
r = await owner('erpBrandDeskMakeDrafts', [{}]);
check('no idea and no text is refused', !r.ok, r);
r = await owner('erpBrandDeskMakeDrafts', [{ idea_id: 3, platforms: ['LinkedIn', 'facebook', 'myspace', 'facebook'] }]);
const mk = seen.filter((x) => x.url.endsWith('/drafts/make')).pop();
check('drafts are asked for known platforms only, once each', r.ok && mk.body.idea_id === 3 && mk.body.platforms.join() === 'linkedin,facebook', mk && mk.body);
r = await owner('erpBrandDeskMakeDrafts', [{ text: 'Why I ask for the purchase invoice', topic: 'beauty_proof' }]);
check('a new idea in words goes with its topic', r.ok && seen.filter((x) => x.url.endsWith('/drafts/make')).pop().body.topic === 'beauty_proof', r);
r = await owner('erpBrandDeskDraftDecide', [{ id: 5, action: 'approve', networks: [] }]);
check('approve without an account is refused', !r.ok && /account/.test(r.error), r);
r = await owner('erpBrandDeskDraftDecide', [{ id: 5, action: 'publish' }]);
check('only approve or reject', !r.ok, r);
r = await owner('erpBrandDeskDraftDecide', [{ id: 5, action: 'approve', networks: [{ id: 'n1', platform: 'linkedin' }], body: 'Edited text' }]);
const dc = seen.filter((x) => x.url.endsWith('/drafts/decide')).pop();
check('an approval carries the account and the edited text', r.ok && dc.body.networks[0].id === 'n1' && dc.body.body === 'Edited text', dc && dc.body);
r = await owner('erpBrandDeskDraftDecide', [{ id: 5, action: 'manual', url: 'ftp://x' }]);
check('posted by hand: a strange link is refused', !r.ok && /https/.test(r.error), r);
r = await owner('erpBrandDeskDraftDecide', [{ id: 5, action: 'manual', url: 'https://facebook.com/rahman/posts/1', body: 'As posted' }]);
const man = seen.filter((x) => x.url.endsWith('/drafts/decide')).pop();
check('posted by hand needs no account and keeps the link', r.ok && man.body.action === 'manual' && !man.body.networks && man.body.url.includes('facebook.com'), man && man.body);
r = await mgr('erpBrandDeskMakeDrafts', [{ idea_id: 3 }]);
check('a manager cannot ask for drafts', !r.ok, r);

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

// 4c. the idea bank (brand-3)
r = await owner('erpBrandDeskIdeas', []);
check('the ideas come from the PC', r.ok && r.result.ideas[0].id === 'abcd1234', r);
r = await owner('erpBrandDeskIdea', [{ content: ' ' }]);
check('an empty idea is refused', !r.ok, r);
r = await owner('erpBrandDeskIdea', [{ content: 'Show the warehouse' }]);
check('an idea goes to the PC', r.ok && seen.filter((x) => x.url.endsWith('/ideas') && x.body).pop().body.content === 'Show the warehouse', r);
r = await owner('erpBrandDeskIdeaToBoard', [{ id: '../../x' }]);
check('a strange idea id is refused', !r.ok, r);
r = await owner('erpBrandDeskIdeaToBoard', [{ id: 'abcd1234' }]);
check('an idea becomes a card', r.ok && seen.filter((x) => x.url.endsWith('/ideas/board')).pop().body.id === 'abcd1234', r);

// 4d. people (brand-4) - B is the brand desk now, so the owner gets a shop to hand people to
r = await owner('erpCreateBusiness', [{ name: 'Brand Test Shop' }]);
check('the owner has a shop beside the brand desk', r.ok, r);
await owner('erpSetBusiness', [B]);
r = await owner('erpBrandDeskPeople', []);
check('the people come from the PC with the businesses to hand them to', r.ok && r.result.people[0].id === 'p1' && r.result.businesses.length >= 1, r);
const targets = r.ok ? r.result.businesses : [];
r = await owner('erpBrandDeskPerson', [{ name: '' }]);
check('a person without a name is refused', !r.ok, r);
r = await owner('erpBrandDeskPerson', [{ name: 'Lee', email: 'not-mail' }]);
check('a broken e-mail is refused', !r.ok, r);
r = await owner('erpBrandDeskPerson', [{ name: 'Lee Brand', audience: 'brand', source: 'YouTube video' }]);
check('a person goes to the PC', r.ok && seen.filter((x) => x.url.endsWith('/people') && x.body).pop().body.audience === 'brand', r);
r = await owner('erpBrandDeskToLeads', [{ id: 'p1', business: '00000000-0000-0000-0000-000000000000' }]);
check('a business that is not his is refused', !r.ok, r);
const tgt = targets.find((b) => b.name === 'Brand Test Shop');
check('the brand desk itself is not a place for leads', !targets.some((b) => b.id === B), targets);
r = await owner('erpBrandDeskToLeads', [{ id: 'p1', business: tgt.id }]);
const lead = await sql`select kind, name, email, note from inbox_leads where business_id = ${tgt.id} and source_ref = 'branddesk:p1'`;
check('the person becomes a supplier lead of that business', r.ok && r.result.added && lead.length === 1 && lead[0].kind === 'supplier' && /LinkedIn post/.test(lead[0].note), lead);
r = await owner('erpBrandDeskToLeads', [{ id: 'p1', business: tgt.id }]);
check('handing the same person twice adds nothing', r.ok && r.result.added === false, r);

// 4e. videos (brand-5)
r = await owner('erpBrandDeskVideos', [{}]);
check('the newest videos come from the PC', r.ok && r.result.videos[0].id === 'v1' && r.result.q === '', r);
r = await owner('erpBrandDeskVideos', [{ q: 'me talking & shop' }]);
check('a search goes to the PC, safely encoded', r.ok && r.result.q === 'me talking & shop' && seen.some((x) => /q=me%20talking%20%26%20shop$/.test(x.url)), seen.map((x) => x.url).slice(-2));

// 4f. shorts (brand-6)
r = await owner('erpBrandDeskMakeShorts', [{ id: 'not a video' }]);
check('a strange video id is refused', !r.ok, r);
r = await owner('erpBrandDeskMakeShorts', [{ id: '18181596-5276-4153-9412-2f441efac82b' }]);
check('shorts are asked of the PC', r.ok && r.result.jobs['18181596-5276-4153-9412-2f441efac82b'].state === 'making', r);
r = await owner('erpBrandDeskShorts', []);
check('the shorts state comes back', r.ok && !!r.result.jobs, r);

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
