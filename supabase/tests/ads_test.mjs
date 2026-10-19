// Paid ads (132_ad_campaigns.sql, handlers/ads.js): settings and caps, the interest search, the customer audience,
// building a campaign PAUSED on a published post, the owner's Start, pause/stop, the hourly tick (results, spend into
// Expenses, auto-pause, the monthly cap), refusals.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, web, fnDir } from './harness.mjs';

const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const ads = await import(pathToFileURL(path.join(fnDir, 'handlers', 'ads.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
deps.geminiKey = 'k';
deps.render = { url: 'https://render.test/render', key: 'rk' };

// the Meta login as metaconnect leaves it: a user key, a page, an ad account
await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, 'META_USER_TOKEN', 'USERTOK') on conflict (business_id, key) do update set value = excluded.value`;
await sql`insert into business_config (business_id, key, value) values (${FIX.B}, 'meta_assets', ${JSON.stringify({ pages: [{ id: 'PAGE9', name: 'Demo Page', ig: null }], wabas: [], adAccounts: [{ id: 'act_1', name: 'Costareen ads', currency: 'BDT', active: true }] })}) on conflict (business_id, key) do update set value = excluded.value`;
const graph = [];
let spend = 120, results = 10, ctr = 1.5, impressions = 3000;
web.on(/graph\.facebook\.com\/v21\.0\//, (url, opts) => {
  const u = new URL(url), p = u.pathname.replace(/^\/v21\.0/, ''), body = opts.body ? JSON.parse(opts.body) : null, method = opts.method || 'GET';
  graph.push({ p, method, body, q: u.search });
  if (p === '/act_1') return { status: 200, body: { name: 'Costareen ads', currency: 'BDT', amount_spent: '12000', balance: '0', account_status: 1 } };
  if (p === '/search') return { status: 200, body: { data: [{ id: '6003', name: '3D printing', audience_size_lower_bound: 120000 }, { id: '6004', name: 'Arduino', audience_size_lower_bound: 80000 }] } };
  if (p === '/act_1/customaudiences') return { status: 200, body: { id: body.subtype === 'LOOKALIKE' ? 'LAL1' : 'AUD1' } };
  if (p === '/AUD1/users') return { status: 200, body: { audience_id: 'AUD1', num_received: body.payload.data.length } };
  if (p === '/act_1/campaigns') return { status: 200, body: { id: 'C1' } };
  if (p === '/act_1/adsets') return { status: 200, body: { id: 'S1' } };
  if (p === '/act_1/adcreatives') return { status: 200, body: { id: 'CR1' } };
  if (p === '/act_1/ads') return { status: 200, body: { id: 'A1' } };
  if (p === '/A1/previews') return { status: 200, body: { data: [{ body: '<iframe src="https://www.facebook.com/ads/preview"></iframe>' }] } };
  if (/^\/(C1|S1|A1)$/.test(p) && method === 'POST') return { status: 200, body: { success: true } };
  if (p === '/C1/insights' && /time_increment=1/.test(u.search)) return { status: 200, body: { data: [{ date_start: '2026-10-19', spend: '70' }, { date_start: '2026-10-20', spend: String(spend - 70) }] } };
  if (p === '/C1/insights') return { status: 200, body: { data: [{ spend: String(spend), impressions: String(impressions), reach: '2100', clicks: '45', cpm: '40', ctr: String(ctr), actions: [{ action_type: 'onsite_conversion.messaging_conversation_started_7d', value: String(results) }, { action_type: 'link_click', value: '40' }] }] } };
  return { status: 404, body: { error: { message: 'no route ' + p } } };
});
// a published post on the Page to boost
const POST = (await sql`insert into social_posts (business_id, title, captions, targets, state, published_at, results, created_by) values (${FIX.B}, 'Black PLA post', '{"facebook":"x"}', '{"facebook":true}', 'published', now(), ${sql.json({ facebook: { id: 'PAGE9_777', link: 'https://www.facebook.com/PAGE9_777' } })}, 'x') returning id`)[0].id;

// ---- 1. settings and caps
let r = await sales('erpAds', [{}]);
check('sales staff cannot see paid ads', !r.ok, r);
r = await mgr('erpAds', [{}]);
check('a manager sees the screen: connected, the ad account on the login, no account chosen, default caps 500 / 10,000', r.ok && r.result.connected && r.result.accounts[0].id === 'act_1' && !r.result.settings.account && r.result.settings.dailyCap === 500 && r.result.settings.monthlyCap === 10000 && !r.result.canStart, r);
r = await mgr('erpAdsSettings', [{ account: 'act_1' }]);
check('only the owner changes the settings', !r.ok, r);
r = await owner('erpAdsSettings', [{ account: 'act_9' }]);
check('an ad account not on the login is refused', !r.ok, r);
r = await owner('erpAdsSettings', [{ account: 'act_1', dailyCap: 300, monthlyCap: 2000, maxCostPerResult: 20, minCtr: 0.8 }]);
check('the owner sets the account, the caps and the auto-pause rules; the account balance is read', r.ok && r.result.settings.account === 'act_1' && r.result.settings.dailyCap === 300 && r.result.balance && r.result.balance.spent === 120 && r.result.canStart, r);

// ---- 2. interests, the customer audience
r = await mgr('erpAdsInterests', [{ q: '3d' }]);
check('the interest search comes from Meta', r.ok && r.result.interests[0].name === '3D printing' && r.result.interests[0].size === 120000, r);
r = await owner('erpAdsAudience', [{}]);
check('fewer than 100 customers with a phone: Meta would refuse, so the ERP says so', !r.ok && /at least 100/.test(r.error), r);
for (let i = 0; i < 120; i++) await sql`insert into customers (business_id, name, phone) values (${FIX.B}, ${'C' + i}, ${'017' + String(10000000 + i)})`;
graph.length = 0;
r = await owner('erpAdsAudience', [{}]);
const users = graph.find((g) => g.p === '/AUD1/users');
check('the customers go to Meta hashed (SHA-256 of 880...), never as numbers; a lookalike is made', r.ok && r.result.audience.id === 'AUD1' && r.result.audience.lookalike === 'LAL1' && r.result.audience.n >= 120 && users && users.body.payload.schema[0] === 'PHONE_SHA256' && /^[0-9a-f]{64}$/.test(users.body.payload.data[0][0]) && !JSON.stringify(graph).includes('01710000001'), [r, users && users.body.payload.data[0]]);

// ---- 3. building a campaign, paused
r = await mgr('erpAdsPlan', [{ postId: POST, objective: 'messages', dailyBudget: 400, days: 7 }]);
check('the daily budget may not pass the daily cap', !r.ok && /daily cap/.test(r.error), r);
r = await mgr('erpAdsPlan', [{ postId: POST, objective: 'messages', dailyBudget: 200, days: 30 }]);
check('the month may not pass the monthly cap', !r.ok && /monthly cap/.test(r.error), r);
r = await mgr('erpAdsPlan', [{ postId: POST, objective: 'sales', dailyBudget: 100, days: 5 }]);
check('sales ads need the pixel', !r.ok && /pixel/.test(r.error), r);
graph.length = 0;
r = await mgr('erpAdsPlan', [{ postId: POST, objective: 'messages', dailyBudget: 100, days: 5, targeting: { ageMin: 20, ageMax: 45, interests: [{ id: '6003', name: '3D printing' }], lookalike: true } }]);
const camp = r.ok && r.result.campaign;
const cp = graph.find((g) => g.p === '/act_1/campaigns'), as = graph.find((g) => g.p === '/act_1/adsets'), cr = graph.find((g) => g.p === '/act_1/adcreatives'), ad = graph.find((g) => g.p === '/act_1/ads');
check('a manager builds it: campaign, ad set, creative on the post, ad - all PAUSED; the preview and the total come back', camp && camp.status === 'ready' && r.result.total === 500 && cp.body.status === 'PAUSED' && cp.body.objective === 'OUTCOME_ENGAGEMENT' && as.body.status === 'PAUSED' && as.body.daily_budget === 10000 && cr.body.object_story_id === 'PAGE9_777' && ad.body.status === 'PAUSED' && /facebook\.com\/ads\/preview/.test(camp.preview), [r, cp && cp.body, as && as.body]);
check('the audience: Bangladesh, 20-45, the interest, the lookalike, Messenger as the destination', as.body.targeting.geo_locations.countries[0] === 'BD' && as.body.targeting.age_min === 20 && as.body.targeting.age_max === 45 && as.body.targeting.flexible_spec[0].interests[0].id === '6003' && as.body.targeting.custom_audiences[0].id === 'LAL1' && as.body.destination_type === 'MESSENGER' && as.body.promoted_object.page_id === 'PAGE9' && as.body.optimization_goal === 'CONVERSATIONS', as.body);
check('nothing ran: no status change was sent', !graph.some((g) => /^\/(C1|S1|A1)$/.test(g.p) && g.method === 'POST'));

// ---- 4. only the owner starts; pause and stop
r = await mgr('erpAdsAct', [{ id: camp.id, action: 'start' }]);
check('a manager cannot start', !r.ok && /owner/.test(r.error), r);
graph.length = 0;
r = await owner('erpAdsAct', [{ id: camp.id, action: 'start' }]);
check('the owner starts it: campaign, ad set and ad set ACTIVE', r.ok && r.result.campaign.status === 'running' && r.result.campaign.startedBy && graph.filter((g) => /^\/(C1|S1|A1)$/.test(g.p) && g.body.status === 'ACTIVE').length === 3, [r, graph.map((g) => g.p + ' ' + JSON.stringify(g.body))]);
r = await mgr('erpAdsAct', [{ id: camp.id, action: 'pause' }]);
check('a manager may pause', r.ok && r.result.campaign.status === 'paused', r);
r = await owner('erpAdsAct', [{ id: camp.id, action: 'resume' }]);
check('the owner resumes', r.ok && r.result.campaign.status === 'running', r);

// ---- 5. the hourly tick: results, the spend into Expenses, auto-pause rules, the monthly cap
let t = await asB((ctx) => ads.adsTick(ctx));
r = await owner('erpAds', [{}]);
let c = r.result.campaigns.find((x) => x.id === camp.id);
check('results read: spend, messages started, cost each, reach, click rate', t.read === 1 && c.spend === 120 && c.results.results === 10 && c.results.costPerResult === 12 && c.results.reach === 2100 && c.results.ctr === 1.5 && c.statsAt, [t, c]);
const exp = await sql`select description, amount, category, month from expenses where business_id = ${FIX.B} and category = 'Advertising' order by description`;
check('the days\' spend is in Expenses under Advertising, one line per day', t.expenses === 2 && exp.length === 2 && Number(exp[0].amount) === 70 && /Meta ads · .* · 2026-10-19/.test(exp[0].description) && exp[0].month === '2026-10', exp);
check('this month\'s spend counts the days', r.result.monthSpend === 120, r.result.monthSpend);
t = await asB((ctx) => ads.adsTick(ctx));
check('read again only after an hour; no second expense line', t.read === 0 && (await sql`select count(*)::int n from expenses where business_id = ${FIX.B} and category = 'Advertising'`)[0].n === 2, t);
await sql`update ad_campaigns set stats_at = null where id = ${camp.id}`;
spend = 150; results = 5;   // 30 each, above the 20 limit
graph.length = 0;
t = await asB((ctx) => ads.adsTick(ctx));
c = (await owner('erpAds', [{}])).result.campaigns.find((x) => x.id === camp.id);
check('auto-pause: cost per result above the limit -> paused by the ERP, with the reason', t.paused === 1 && c.status === 'paused' && /cost per result 30/.test(c.autoNote) && graph.some((g) => g.p === '/C1' && g.body.status === 'PAUSED'), [t, c.status, c.autoNote]);
r = await owner('erpAdsAct', [{ id: camp.id, action: 'resume' }]);
await sql`update ad_campaigns set stats_at = null where id = ${camp.id}`;
spend = 2100; results = 200;   // past the 2,000 monthly cap
t = await asB((ctx) => ads.adsTick(ctx));
c = (await owner('erpAds', [{}])).result.campaigns.find((x) => x.id === camp.id);
check('the monthly cap reached -> everything running is paused', c.status === 'paused' && /monthly cap/.test(c.autoNote), [t, c.status, c.autoNote]);
r = await owner('erpAdsAct', [{ id: camp.id, action: 'resume' }]);
check('…and cannot be resumed until the cap is raised', !r.ok && /monthly cap/.test(r.error), r);
r = await owner('erpAdsSettings', [{ monthlyCap: 50000 }]);
r = await owner('erpAdsAct', [{ id: camp.id, action: 'resume' }]);
check('raised cap: it runs again', r.ok && r.result.campaign.status === 'running', r);
r = await mgr('erpAdsAct', [{ id: camp.id, action: 'stop' }]);
check('only the owner stops', !r.ok, r);
graph.length = 0;
r = await owner('erpAdsAct', [{ id: camp.id, action: 'stop' }]);
check('stopped: paused on Meta and archived, kept here', r.ok && r.result.campaign.status === 'stopped' && graph.some((g) => g.p === '/C1' && g.body.status === 'ARCHIVED'), r);
r = await owner('erpAdsPlan', [{ postId: POST, objective: 'reach', dailyBudget: 100, days: 3 }]);
check('a reach campaign: OUTCOME_AWARENESS, REACH goal, no Messenger destination', r.ok && graph.some((g) => g.p === '/act_1/campaigns' && g.body.objective === 'OUTCOME_AWARENESS') && graph.some((g) => g.p === '/act_1/adsets' && g.body.optimization_goal === 'REACH' && !g.body.destination_type), r);
check('the other business has no campaigns', (await sql`select count(*)::int n from ad_campaigns where business_id = ${FIX.B2}`)[0].n === 0);

await done();
