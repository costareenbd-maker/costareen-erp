// Stage N1b: the community base - the ideas board with votes and a status on every idea, the public updates page,
// guides and credits; the platform admin answers, writes updates, keeps the guides.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) } }), R)).body;
const post = async (q, body, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) }, body: JSON.stringify(body) }), R)).body;

// 1. the empty board
let r = await get('pub=ideas');
check('the board: no ideas, no updates, no guides, the consent line, the statuses', r.ok && r.ideas.length === 0 && r.updates.length === 0 && r.credits.guides.length === 0 && /first name/.test(r.consent) && r.statuses.includes('building'), r);

// 2. proposing
const good = (o) => ({ title: 'Filament dryer rental', text: 'Let shops rent out filament dryers for the monsoon weeks, booked from Find stock.', name: 'Sumon', contact: '01712345678', consent: true, ...(o || {}) });
r = await post('pub=idea', good({ title: 'Hi' }));
check('an idea needs a title', !r.ok && /title/i.test(r.error), r);
r = await post('pub=idea', good({ text: 'short' }));
check('...and a sentence', !r.ok, r);
r = await post('pub=idea', good({ name: '' }));
check('...and a first name', !r.ok, r);
r = await post('pub=idea', good({ consent: false }));
check('...and consent', !r.ok && /Tick/.test(r.error), r);
r = await post('pub=idea', good());
check('proposed: new', r.ok && r.id && r.status === 'new', r);
const IDEA = r.id;
r = await post('pub=idea', good({ title: 'Bangla voice for the Print Doctor', text: 'Read the steps aloud in Bangla for people who cannot read well.', name: 'Rina', contact: '' }));
const IDEA2 = r.id;
r = await get('pub=ideas');
check('both on the board, newest first, no contact shown', r.ideas.length === 2 && r.ideas[0].id === IDEA2 && r.ideas[0].status === 'new' && r.ideas[0].votes === 0 && !('contact' in r.ideas[0]) && !JSON.stringify(r).includes('01712345678'), r.ideas);

// 3. votes
r = await post('pub=ideavote', { id: 'nope' });
check('a vote needs an idea', !r.ok, r);
r = await post('pub=ideavote', { id: IDEA }, '203.0.113.1');
check('voted: 1', r.ok && r.votes === 1, r);
r = await post('pub=ideavote', { id: IDEA }, '203.0.113.1');
check('the same address again: not counted twice', r.ok && r.already && r.votes === 1, r);
r = await post('pub=ideavote', { id: IDEA }, '203.0.113.2');
check('another address: 2', r.ok && r.votes === 2, r);
r = await get('pub=ideas');
check('the board orders by votes among the new ones', r.ideas[0].id === IDEA && r.ideas[0].votes === 2, r.ideas.map((i) => i.title + ' ' + i.votes));

// 4. the admin answers
r = await mgr('erpPlatformCommunity', []);
check('a manager is not the platform admin', !r.ok, r);
r = await owner('erpPlatformCommunity', []);
check('the admin sees the ideas with contacts, the count of new ones, the board link', r.ok && r.result.ideas.length === 2 && r.result.newIdeas === 2 && r.result.ideas.some((i) => i.contact === '01712345678') && /\/ideas$/.test(r.result.boardUrl), r.ok ? r.result.newIdeas : r);
r = await owner('erpPlatformIdeaSet', [{ id: IDEA, status: 'building', reply: 'Good one - the dryer rental goes into Find stock as a "rent" band next month.' }]);
check('set to building with a reply', r.ok && r.result.status === 'building', r);
r = await get('pub=ideas');
check('the board shows "being built" first with the reply', r.ideas[0].id === IDEA && r.ideas[0].status === 'building' && /rent/.test(r.ideas[0].reply), r.ideas[0]);
check('credits: the author of an idea taken up', r.credits.contributors.some((c) => c.name === 'Sumon' && c.ideas === 1), r.credits);
r = await owner('erpPlatformIdeaSet', [{ id: IDEA2, status: 'declined', reply: 'Not yet - voices need a reader we do not have.' }]);
r = await get('pub=ideas');
check('declined sits last, with the reason', r.ideas[r.ideas.length - 1].id === IDEA2 && r.ideas[r.ideas.length - 1].status === 'declined', r.ideas.map((i) => i.status));

// 5. an update, with the credit and an announcement inside the ERPs
r = await owner('erpPlatformUpdateAdd', [{ title: 'Dryer rental on Find stock', text: 'Shops can now list dryers for rent; search "dryer".', ideaId: IDEA, announce: true, days: 7 }]);
check('update written and announced', r.ok && r.result.id && r.result.announced, r);
r = await get('pub=ideas');
check('the updates page shows it with "from an idea by Sumon"; the idea is done', r.updates.length === 1 && /Dryer rental/.test(r.updates[0].title) && r.updates[0].credit === 'from an idea by Sumon' && r.ideas.find((i) => i.id === IDEA).status === 'done', r.updates);
check('...and every ERP got the announcement', (await sql`select count(*)::int n from erp_news where text like 'Dryer rental%'`)[0].n === 1);
r = await owner('erpPlatformUpdateAdd', [{ title: 'Faster search', text: 'Find stock answers in under a second now.', credit: 'the team' }]);
r = await get('pub=ideas');
check('a second update, newest first, with its own credit', r.updates.length === 2 && r.updates[0].title === 'Faster search' && r.updates[0].credit === 'the team', r.updates.map((u) => u.title));
r = await owner('erpPlatformUpdateRemove', [{ id: r.updates[0].id }]);
check('an update can be taken down', r.ok && (await get('pub=ideas')).updates.length === 1, r);

// 6. guides and the credits page
r = await owner('erpPlatformGuideSet', [{ name: 'Tanvir', area: 'Print Doctor cases' }]);
check('a guide added', r.ok && r.result.id, r);
const G = r.result.id;
await sql`insert into erp_doctor_tips (problem, text, credit) values ('stringing', 'Dry it first.', 'Sumon, Mirpur')`;
await sql`insert into erp_doctor_settings (printer, material, name, status) values ('A1', 'PLA', 'Rina', 'approved')`;
r = await get('pub=ideas');
check('credits: the guide with the badge, contributors with what they did (Sumon: 1 idea + 1 case; Rina: 1 settings)', r.credits.guides.length === 1 && r.credits.guides[0].name === 'Tanvir' && /Doctor/.test(r.credits.guides[0].area) &&
  r.credits.contributors[0].name === 'Sumon' && r.credits.contributors[0].ideas === 1 && r.credits.contributors[0].cases === 1 && r.credits.contributors.some((c) => c.name === 'Rina' && c.settings === 1), r.credits);
r = await owner('erpPlatformGuideSet', [{ id: G, active: false }]);
check('a guide can be retired', r.ok && (await get('pub=ideas')).credits.guides.length === 0, r);

// 7. removing an idea
r = await owner('erpPlatformIdeaSet', [{ id: IDEA2, remove: true }]);
check('removed: off the board, votes refused', r.ok && (await get('pub=ideas')).ideas.length === 1 && !(await post('pub=ideavote', { id: IDEA2 })).ok, r);

// 8. a flood is slowed down
let last = null;
for (let i = 0; i < 6; i++) last = await post('pub=idea', good({ consent: false }), '203.0.113.50');
check('the sixth idea from one address in an hour is refused', !last.ok && /Too many/.test(last.error), last);
await done();
