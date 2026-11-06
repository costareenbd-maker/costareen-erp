// tooldoor-1 (6 Nov 2026): the app door. Every toolCall path is faked with web.on: not set up, no key, a refused key,
// a 404 / 500 with the app's own words, an app that cannot be reached, an app that does not answer in time; Shlink
// short links (UTM, tags, a taken short name, captions shortened per network, the list with clicks), OpenShorts
// (no Gemini key, a job made and listed with its clips), the Tools status page, the "Only me" gate, manager/sales
// refusals, keys never read back, and the other business untouched. Made-up addresses and keys only.
import { sql, FIX, owner, mgr, sales, check, done, web, deps } from './harness.mjs';

const B = FIX.B, B2 = FIX.B2;
const SH = 'http://shlink.test:8080', OS = 'http://shorts.test', OC = 'http://cut.test:3000';
const SKEY = 'test-shlink-key-1234', GKEY = 'test-gemini-key-5678';

// ---- the fake apps
const made = [];
let shlinkDown = false, shlinkSlow = false;
web.on(/^http:\/\/shlink\.test:8080\//, async (url, opts) => {
  if (shlinkDown) throw new Error('connect ECONNREFUSED');
  if (shlinkSlow) { await new Promise((ok) => setTimeout(ok, 400)); return { body: { status: 'pass' } }; }
  if (url.includes('/boom/')) return { status: 500, body: { title: 'Internal', detail: 'database is locked' } };
  if (url.includes('/nothing/')) return { status: 404, body: { detail: 'No route' } };
  if (url.endsWith('/rest/health')) return { body: { status: 'pass', version: '5.1.8' } };
  if ((opts.headers || {})['X-Api-Key'] !== SKEY) return { status: 401, body: { title: 'Invalid API key', detail: 'Provided API key does not exist' } };
  if (url.endsWith('/rest/v3/short-urls') && opts.method === 'POST') {
    const b = JSON.parse(opts.body);
    if (b.customSlug === 'taken') return { status: 400, body: { type: 'https://shlink.io/api/error/non-unique-slug', title: 'Invalid custom slug', detail: 'Provided slug "taken" is already in use.' } };
    const code = b.customSlug || ('c' + (made.length + 1));
    const x = { shortCode: code, shortUrl: 'https://go.example.test/' + code, longUrl: b.longUrl, tags: b.tags, dateCreated: '2026-11-06T20:00:00+00:00', visitsSummary: { total: 3, nonBots: 2, bots: 1 } };
    made.push(x); return { body: x };
  }
  if (/\/rest\/v3\/short-urls\?/.test(url)) {
    const u = new URL(url), want = u.searchParams.getAll('tags[]');
    const data = made.filter((x) => want.every((t) => x.tags.includes(t)));
    return { body: { shortUrls: { data, pagination: { currentPage: 1, pagesCount: 1, totalItems: data.length } } } };
  }
  return { status: 404, body: { detail: 'No route' } };
});
const osCalls = [];
web.on(/^http:\/\/shorts\.test\//, (url, opts) => {
  osCalls.push({ url, key: (opts.headers || {})['X-Gemini-Key'], body: opts.body ? JSON.parse(opts.body) : null });
  if (url.endsWith('/health')) return { body: { status: 'ok' } };
  if (url.endsWith('/api/process')) return (opts.headers || {})['X-Gemini-Key'] ? { body: { job_id: 'job-1', status: 'queued' } } : { status: 400, body: { detail: 'Missing X-Gemini-Key header' } };
  if (url.endsWith('/api/status/job-1')) return { body: { status: 'completed', result: { clips: [{ title: 'Silk PLA in 30 seconds', video_url: '/videos/job-1/clip_1.mp4' }] } } };
  return { status: 404, body: { detail: 'Job not found' } };
});
web.on(/^http:\/\/cut\.test:3000\//, () => ({ body: '<html>OpenCut</html>' }));

// ---- 1. the Only-me gate: closed until the flag row says so (the test owner is not the platform admin)
await sql`delete from erp_app_flags where key = 'tooldoor'`;
let r = await owner('erpTools', []);
check('the Tools list works without the door (nothing set up)', r.ok && r.result.tools.length === 3 && r.result.tools.every((t) => t.state === 'off'), r);
check('Twenty is not an app of the door (D23 retired)', r.ok && !r.result.tools.some((t) => t.key === 'twenty'), r);
r = await owner('erpToolSet', [{ tool: 'shlink', url: SH }]);
const plat = await sql`select 1 from platform_admins p join memberships m on m.user_id = p.user_id where m.business_id = ${B} and m.role = 'owner'`.catch(() => []);
if (!plat.length) check('the door is shut while the Only-me flag is off', !r.ok && /not open/.test(r.error), r);
await sql`insert into erp_app_flags (key, enabled) values ('tooldoor', true) on conflict (key) do update set enabled = true`;

// ---- 2. toolCall: not set up / no key
r = await owner('erpShortLink', [{ url: 'https://shop.example.test/p/silk' }]);
check('not set up: a plain sentence naming where to fix it', !r.ok && /Shlink is not connected yet/.test(r.error) && /Connections/.test(r.error), r);
r = await owner('erpToolSet', [{ tool: 'shlink', url: 'ftp://x.test' }]);
check('a non-web address is refused', !r.ok, r);
r = await owner('erpToolSet', [{ tool: 'shlink', url: 'http://user:pw@x.test' }]);
check('an address with a password inside is refused', !r.ok, r);
r = await owner('erpToolSet', [{ tool: 'nope', url: SH }]);
check('an unknown app is refused', !r.ok, r);
r = await owner('erpToolSet', [{ tool: 'shlink', url: SH + '/', open: 'https://links.example.test', short: 'https://go.example.test/' }]);
check('the address is saved without the last slash', r.ok && r.result.tools.find((t) => t.key === 'shlink').url === SH, r);
const shortCfg = await sql`select value from business_config where business_id = ${B} and key = 'tool_short_shlink'`;
check('the short-link domain is kept as a plain name', shortCfg[0] && shortCfg[0].value === 'go.example.test', shortCfg);
r = await owner('erpToolSet', [{ tool: 'shlink', short: 'not a domain' }]);
check('a bad short-link domain is refused', !r.ok, r);
r = await owner('erpShortLink', [{ url: 'https://shop.example.test/p/silk' }]);
check('no key: says to paste it', !r.ok && /needs its key/.test(r.error), r);

// ---- 3. keys: sealed, never read back; a wrong key is refused in plain words
r = await owner('erpToolSet', [{ tool: 'shlink', key: 'bad key' }]);
check('a key with a space is refused', !r.ok, r);
r = await owner('erpToolSet', [{ tool: 'shlink', key: 'wrong-key-000000' }]);
check('a key is saved', r.ok && r.result.tools.find((t) => t.key === 'shlink').keySet === true, r);
r = await owner('erpShortLink', [{ url: 'https://shop.example.test/p/silk' }]);
check('a refused key: plain sentence', !r.ok && /refused the key/.test(r.error), r);
r = await owner('erpToolSet', [{ tool: 'shlink', key: SKEY }]);
check('the key never comes back in an answer', r.ok && !JSON.stringify(r.result).includes(SKEY), r);
const sec = await sql`select value from business_secrets where business_id = ${B} and key = 'TOOL_SHLINK_KEY'`;
check('the key sits in business_secrets', sec.length === 1 && sec[0].value === SKEY, sec);
r = await owner('erpToolSet', [{ tool: 'opencut', key: 'anything-1234' }]);
check('an app without keys refuses a key', !r.ok, r);

// ---- 4. Shlink short links
r = await owner('erpShortLink', [{ url: 'not a link' }]);
check('a non-link is refused', !r.ok, r);
r = await owner('erpShortLink', [{ url: 'https://shop.example.test/p/silk', slug: 'Bad Slug!' }]);
check('a bad short name is refused', !r.ok, r);
const POST = '5a1d2c3b-0000-4000-8000-000000000001';
r = await owner('erpShortLink', [{ url: 'https://shop.example.test/p/silk', slug: 'silk-pla', network: 'facebook', post: POST, sku: 'PLA-SILK' }]);
const sent = made[made.length - 1];
check('a short link is made', r.ok && r.result.link.short === 'https://go.example.test/silk-pla' && r.result.link.clicks === 2, r);
check('UTM is added for the network and the post', sent && /utm_source=facebook/.test(sent.longUrl) && /utm_campaign=post-/.test(sent.longUrl) && /utm_medium=social/.test(sent.longUrl), sent);
check('tags carry the business, post, sku and network', sent && sent.tags.includes('erp:' + B) && sent.tags.includes('post:' + POST) && sent.tags.includes('sku:PLA-SILK') && sent.tags.includes('net:facebook'), sent);
r = await owner('erpShortLink', [{ url: 'https://shop.example.test/p/x', slug: 'taken' }]);
check('a taken short name: plain sentence', !r.ok && /is taken/.test(r.error), r);
r = await mgr('erpShortLink', [{ url: 'https://shop.example.test/p/m' }]);
check('a manager may make a short link', r.ok, r);
r = await sales('erpShortLink', [{ url: 'https://shop.example.test/p/s' }]);
check('sales is refused', !r.ok, r);

r = await owner('erpShortenText', [{ post: POST, captions: { facebook: 'Buy now https://shop.example.test/a, fast.', instagram: 'Link: https://go.example.test/old and https://shop.example.test/b' } }]);
check('captions: every long link becomes a short one per network', r.ok && /https:\/\/go\.example\.test\/c\d+, fast\./.test(r.result.captions.facebook) && r.result.made.length === 2, r);
check('a link that is already short is left alone', r.ok && r.result.captions.instagram.includes('https://go.example.test/old'), r);
const igMade = made.find((x) => x.tags.includes('net:instagram'));
check('the Instagram link says utm_source=instagram', igMade && /utm_source=instagram/.test(igMade.longUrl), igMade);

r = await owner('erpShortLinks', [{ post: POST }]);
check('the post’s links with clicks', r.ok && r.result.links.length === 3 && r.result.links.every((l) => l.post === POST && l.clicks === 2), r);
r = await owner('erpShortLinks', [{}]);
check('all this business’s links', r.ok && r.result.links.length === 4, r);

// ---- 5. errors: 404 / 500 with the app's words, unreachable, too slow
await sql`update business_config set value = ${SH + '/boom'} where business_id = ${B} and key = 'tool_url_shlink'`;
r = await owner('erpShortLinks', [{}]);
check('a 500: the app’s own words', !r.ok && /Shlink answered 500: database is locked/.test(r.error), r);
await sql`update business_config set value = ${SH + '/nothing'} where business_id = ${B} and key = 'tool_url_shlink'`;
r = await owner('erpShortLinks', [{}]);
check('a 404: does not know that', !r.ok && /Shlink does not know that/.test(r.error), r);
await sql`update business_config set value = ${SH} where business_id = ${B} and key = 'tool_url_shlink'`;
shlinkDown = true;
r = await owner('erpShortLinks', [{}]);
check('unreachable: check the server is on', !r.ok && /could not be reached/.test(r.error), r);
r = await owner('erpToolTest', [{ tool: 'shlink' }]);
check('Test says down without throwing', r.ok && r.result.ok === false && r.result.state === 'down', r);
shlinkDown = false; shlinkSlow = true; deps.toolTimeoutMs = 100;
r = await owner('erpShortLinks', [{}]);
check('too slow: did not answer in time', !r.ok && /did not answer/.test(r.error), r);
shlinkSlow = false; delete deps.toolTimeoutMs;
r = await owner('erpToolTest', [{ tool: 'shlink' }]);
check('Test: working, with the version', r.ok && r.result.ok && r.result.version === '5.1.8', r);

// ---- 6. OpenShorts
await owner('erpToolSet', [{ tool: 'openshorts', url: OS, open: 'https://shorts.example.test' }]);
const hadG = await sql`select value_enc from erp_provider_secrets where key = 'GEMINI_KEY'`.catch(() => []);
const gDep = deps.geminiKey; deps.geminiKey = '';
if (!hadG.length) {
  r = await owner('erpShortsMake', [{ url: 'https://www.youtube.com/watch?v=abc' }]);
  check('no Gemini key: says where to add one', !r.ok && /needs a Gemini key/.test(r.error), r);
}
r = await owner('erpShortsMake', [{ url: 'http://plain.test/v' }]);
check('a plain http video link is refused', !r.ok, r);
r = await owner('erpToolSet', [{ tool: 'openshorts', key: GKEY }]);
check('the OpenShorts Gemini key is saved', r.ok && r.result.tools.find((t) => t.key === 'openshorts').keySet, r);
r = await owner('erpShortsMake', [{ url: 'https://www.youtube.com/watch?v=abc', clips: 4 }]);
const proc = osCalls.find((c) => c.url.endsWith('/api/process'));
check('a shorts job is made', r.ok && r.result.job.id === 'job-1', r);
check('the key goes in X-Gemini-Key and the clip count is sent', proc && proc.key === GKEY && proc.body.target_clips === '4' && proc.body.url.includes('youtube'), proc);
r = await owner('erpShortsJobs', []);
check('the job is listed with its clip and a full link', r.ok && r.result.jobs[0].status === 'completed' && r.result.jobs[0].clips[0].link === 'https://shorts.example.test/videos/job-1/clip_1.mp4', r);
r = await mgr('erpShortsMake', [{ url: 'https://www.youtube.com/watch?v=abc' }]);
check('a manager cannot make shorts', !r.ok, r);
deps.geminiKey = gDep;

// ---- 7. status page
await owner('erpToolSet', [{ tool: 'opencut', url: OC, open: 'https://cut.example.test/projects' }]);
r = await owner('erpToolsStatus', []);
const st = r.ok ? Object.fromEntries(r.result.tools.map((t) => [t.key, t])) : {};
check('status: all three on', r.ok && st.shlink.state === 'on' && st.openshorts.state === 'on' && st.opencut.state === 'on', r);
check('status never carries a key', r.ok && !JSON.stringify(r.result).includes(SKEY) && !JSON.stringify(r.result).includes(GKEY), r);
const hc = osCalls.filter((c) => c.url.endsWith('/health')).pop();
check('the health call does not send the Gemini key', hc && !hc.key, hc);
r = await mgr('erpToolsStatus', []);
check('a manager cannot see the status page', !r.ok, r);
r = await mgr('erpToolSet', [{ tool: 'shlink', url: SH }]);
check('a manager cannot set an app', !r.ok, r);

// ---- 8. the other business is untouched
const other = await sql`select key from business_config where business_id = ${B2} and key like 'tool_%'`;
const otherS = await sql`select key from business_secrets where business_id = ${B2} and key like 'TOOL_%'`;
check('the other business has no tool settings', other.length === 0 && otherS.length === 0, { other, otherS });
r = await owner('erpToolSet', [{ tool: 'shlink', clearKey: true }]);
check('the key can be removed', r.ok && !r.result.tools.find((t) => t.key === 'shlink').keySet, r);

await sql`delete from erp_app_flags where key = 'tooldoor'`;
await done();
