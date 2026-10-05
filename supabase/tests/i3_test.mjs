// installer-3: "Connect Supabase" (OAuth), the company's own web address from the install page, no provider name for customers.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, check, done, web, deps, fnDir } from './harness.mjs';
const { installRoute, cleanHost } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'installer.js')));
deps.install = {};
deps.installEnv = { controlUrl: 'https://ctl.test/erp', appUrl: 'https://app.test/', publicUrl: 'https://office-erp.pages.dev/',
  oauth: { clientId: 'CID', clientSecret: 'CSEC', redirect: 'https://ctl.test/erp?install=oauth_back' },
  cloudflare: { token: 'CFT', account: 'ACC', project: 'office-erp' } };
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const route = async (q, body, method = 'POST') => installRoute(deps, new Request('https://ctl.test/erp?' + q, { method, headers: { 'content-type': 'application/json' }, body: method === 'POST' ? JSON.stringify(body) : undefined }));
await sql`insert into erp_releases (version, files) values ('v3', ${JSON.stringify({ 'fn/index.ts': 'x', 'sql/001_a.sql': 'A', 'deploy/cron.sql': '' })}::jsonb) on conflict do nothing`;

let r = (await route('install=caps', null, 'GET')).body;
check('the page learns what is switched on, and where addresses point', r.ok && r.oauth && r.domains && r.target === 'office-erp.pages.dev', r);
r = await owner('erpInstallInvite', [{}]);
const code = r.result.code;
check('install links use the neutral address, no company name', r.result.link === 'https://office-erp.pages.dev/#/install/' + code, r.result.link);

// Connect Supabase: off to Supabase with PKCE, back with a code, exchanged for tokens
r = (await route('install=oauth', { code: 'nope' })).body;
check('only with a valid install link', !r.ok, r);
r = (await route('install=oauth', { code })).body;
const au = new URL(r.url);
const state = au.searchParams.get('state');
check('sent to Supabase\'s own sign-in with a one-time state and PKCE', au.origin + au.pathname === 'https://api.supabase.com/v1/oauth/authorize' && au.searchParams.get('client_id') === 'CID' &&
  au.searchParams.get('code_challenge_method') === 'S256' && au.searchParams.get('redirect_uri') === 'https://ctl.test/erp?install=oauth_back' && state, r.url);
let tokenCalls = [];
web.on(/api\.supabase\.com\/v1\/oauth\/token$/, (u, o) => { const f = new URLSearchParams(o.body); tokenCalls.push(Object.fromEntries(f)); return { status: 201, body: f.get('grant_type') === 'refresh_token'
  ? { access_token: 'ACC2', refresh_token: 'REF2', expires_in: 3600 } : { access_token: 'ACC1', refresh_token: 'REF1', expires_in: 1 } }; });
r = await route('install=oauth_back&state=' + state + '&code=AUTHCODE', null, 'GET');
check('back from Supabase: tokens kept, the person sent back to the same install page', r.status === 302 && r.location === 'https://office-erp.pages.dev/#/install/' + code + '/' + state &&
  tokenCalls[0].code === 'AUTHCODE' && tokenCalls[0].code_verifier && tokenCalls[0].grant_type === 'authorization_code', [r, tokenCalls[0]]);
r = await route('install=oauth_back&state=' + state + '&error=access_denied', null, 'GET');
check('said no at Supabase: back with "cancelled"', r.location.endsWith('/cancelled'), r.location);

let seenAuth = '';
web.on(/api\.supabase\.com\/v1\/organizations$/, (u, o) => { seenAuth = o.headers.Authorization; return { status: 200, body: [{ id: 'org1', name: 'XYZ' }] }; });
r = (await route('install=start', { code, company: 'XYZ Enterprise', ownerName: 'X', ownerEmail: 'x@xyz.test', website: 'https://www.XYZenterprise.test/about', oauthState: state, agree: true, terms: '2026-10.2' })).body;
check('started with the connected account, no token pasted', r.ok && r.id && seenAuth === 'Bearer ACC1', [r, seenAuth]);
const { id, secret } = r;
const row = (await sql`select mgmt_kind, oauth_refresh, website from erp_installs where id = ${id}`)[0];
check('the connection is kept as connected, the website cleaned', row.mgmt_kind === 'oauth' && row.oauth_refresh === 'REF1' && row.website === 'xyzenterprise.test', row);
check('the one-time state is gone', !(await sql`select 1 from erp_install_oauth where state = ${state}`).length);
// the first step renews the short-lived token by itself
web.on(/api\.supabase\.com\/v1\/projects$/, (u, o) => { seenAuth = o.headers.Authorization; return { status: 201, body: { id: 'xref' } }; });
await new Promise((res) => setTimeout(res, 1200));
r = (await route('install=step', { id, secret })).body;
check('an expiring connection is renewed before use', r.ok && seenAuth === 'Bearer ACC2' && tokenCalls.some((t) => t.grant_type === 'refresh_token' && t.refresh_token === 'REF1'), [r, seenAuth]);

// the company's own address
check('addresses are checked', cleanHost('erp.xyzenterprise.test') === 'erp.xyzenterprise.test' && (() => { try { cleanHost('erp.costareen.com'); return false; } catch (_) { return true; } })());
const cfCalls = [];
web.on(/api\.cloudflare\.com\/client\/v4\/accounts\/ACC\/pages\/projects\/office-erp\/domains$/, (u, o) => { cfCalls.push(JSON.parse(o.body)); return { status: 200, body: { success: true } }; });
r = (await route('install=domain', { id, secret: 'wrong', domain: 'erp.xyzenterprise.test' })).body;
check('only the install page itself sets the address', !r.ok, r);
r = (await route('install=domain', { id, secret, domain: 'erp.xyzenterprise.test' })).body;
check('the exact record to add: CNAME erp -> the neutral page; added to Pages by itself', r.ok && r.record.type === 'CNAME' && r.record.name === 'erp' && r.record.value === 'office-erp.pages.dev' &&
  r.record.parent === 'xyzenterprise.test' && r.auto && cfCalls.some((c) => c.name === 'erp.xyzenterprise.test'), r);
let dns = [];
web.on(/cloudflare-dns\.com\/dns-query/, () => ({ status: 200, body: { Answer: dns } }));
let pagesStatus = 'pending';
web.on(/pages\/projects\/office-erp\/domains\/erp\.xyzenterprise\.test$/, () => ({ status: 200, body: { result: { status: pagesStatus } } }));
web.on(/api\.supabase\.com\/v1\/projects\/xref\/secrets$/, () => ({ status: 201, body: {} }));
r = (await route('install=domaincheck', { id, secret })).body;
check('no record yet: waiting', r.ok && r.state === 'waiting' && !r.ready && r.free === 'https://office-erp.pages.dev/#/use/' + id, r);
dns = [{ data: 'office-erp.pages.dev.' }];
r = (await route('install=domaincheck', { id, secret })).body;
check('record found, the address being secured', r.state === 'seen' && !r.ready, r);
pagesStatus = 'active';
r = (await route('install=domaincheck', { id, secret })).body;
check('ready: the address opens their ERP', r.state === 'ready' && r.ready && r.url === 'https://erp.xyzenterprise.test/', r);
r = (await route('install=host&h=erp.xyzenterprise.test', null, 'GET')).body;
check('...once the install is done (not before)', !r.ok, r);

// no provider name for customers
const conn = await owner('erpWebsiteSet', [{ kind: 'plugin' }]);
check('the website kinds name no company', conn.ok && conn.result.website.kindLabel === 'WordPress sync plugin', conn.result && conn.result.website);
await sql`delete from business_config where key = 'delivery_options' and business_id = ${FIX.B}`;
r = await owner('erpFormOptions', []);
check('the built-in delivery list names no company', r.ok && r.result.sources.includes('Own delivery') && !r.result.sources.some((x) => /costareen/i.test(x)), r.result.sources);
await done();
