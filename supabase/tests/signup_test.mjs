// Stage 1b: the permanent install link (/start = code 'open'), the terms, the sign-up limits, the brand,
// and the free address <company>.<zone> made by the installer itself.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, web, deps, fnDir } from './harness.mjs';
const { installRoute, TERMS_VERSION, domainsAll } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'installer.js')));

deps.install = {};
deps.installEnv = { controlUrl: 'https://ctl.test/erp', appUrl: 'https://app.test/', publicUrl: 'https://erp.zone.test/', freeZone: 'zone.test', freeZoneId: 'Z1',
  cloudflare: { token: 'CF', account: 'A', project: 'office-erp' } };
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const route = async (q, body, method = 'POST', ip = '1.1.1.1') => (await installRoute(deps, new Request('https://ctl.test/erp?' + q, {
  method, headers: { 'content-type': 'application/json', 'cf-connecting-ip': ip }, body: method === 'POST' ? JSON.stringify(body) : undefined }))).body;
web.on(/api\.supabase\.com\/v1\/organizations$/, () => ({ status: 200, body: [{ id: 'org1', name: 'X' }] }));
const TOKEN = 'sbp_' + 'd'.repeat(40);
const base = (n) => ({ code: 'open', company: 'Acme Prints ' + n, ownerName: 'A', ownerEmail: 'a' + n + '@acme.test', token: TOKEN });

// 1. the open link needs the terms ticked (the current version)
let r = await route('install=start', base(1));
check('no start without agreeing to the terms', !r.ok && /terms/.test(r.error), r);
r = await route('install=start', { ...base(1), agree: true, terms: 'old' });
check('...the current terms', !r.ok, r);
r = await route('install=start', { ...base(1), agree: true, terms: TERMS_VERSION });
check('the open link starts an install, no invite code needed', r.ok && r.id, r);
const row = (await sql`select terms_version, terms_at, signup_ip from erp_installs where id = ${r.id}`)[0];
check('...what was agreed, when, and from where is kept', row.terms_version === TERMS_VERSION && row.terms_at && row.signup_ip === '1.1.1.1', row);
const first = r;

// 2. limits: 3 an hour from one address
await route('install=start', { ...base(2), agree: true, terms: TERMS_VERSION });
await route('install=start', { ...base(3), agree: true, terms: TERMS_VERSION });
r = await route('install=start', { ...base(4), agree: true, terms: TERMS_VERSION });
check('a 4th sign-up from one address within the hour is refused', !r.ok && /Too many sign-ups/.test(r.error), r);
r = await route('install=start', { ...base(5), agree: true, terms: TERMS_VERSION }, 'POST', '2.2.2.2');
check('...another address still can', r.ok, r);

// 3. the brand: anyone reads it, only the platform admin changes it
r = await route('install=brand', null, 'GET');
check('the brand is public (name, terms version)', r.ok && r.name === '3D Owala ERP' && r.terms === TERMS_VERSION, r);
r = await mgr('erpBrandSet', [{ name: 'X' }]);
check('only the platform admin changes the brand', !r.ok, r);
r = await owner('erpBrandSet', [{ name: 'Filament ERP', accent: 'blue' }]);
check('a colour must be like #2756c9', !r.ok && /colour/.test(r.error), r);
r = await owner('erpBrandSet', [{ name: 'Filament ERP', sponsor: 'Sponsored by Someone', accent: '#2756C9', logo: 'data:image/png;base64,iVBORw0KGgo=' }]);
check('the brand is saved', r.ok && r.result.name === 'Filament ERP' && r.result.sponsor === 'Sponsored by Someone', r);
r = await route('install=brand', null, 'GET');
check('...and every install page sees it', r.name === 'Filament ERP' && r.accent === '#2756C9' && r.logo.startsWith('data:image/png'), r);

// 4. the free address: <company>.<zone>, made here (DNS record + page address); the next with the same name gets -2
const made = [];
web.on(/api\.cloudflare\.com\/client\/v4\/zones\/Z1\/dns_records$/, (u, o) => { made.push(JSON.parse(o.body)); return { status: 200, body: { success: true } }; });
web.on(/pages\/projects\/office-erp\/domains$/, () => ({ status: 200, body: { success: true } }));
r = await route('install=freedomain', { id: first.id, secret: first.secret });
check('the company gets acme-prints-1.zone.test, pointed at the ERP page', r.ok && r.domain === 'acme-prints-1.zone.test' && made[0].type === 'CNAME' && made[0].content === 'office-erp.pages.dev', [r, made]);
r = await route('install=freedomain', { id: first.id, secret: first.secret });
check('asking again keeps the same address', r.ok && r.domain === 'acme-prints-1.zone.test' && made.length === 1, r);
await sql`update erp_installs set company = 'Acme Prints 1' where id <> ${first.id} and company = 'Acme Prints 2'`;
const second = (await sql`select id from erp_installs where company = 'Acme Prints 1' and id <> ${first.id}`)[0];
const sec2 = 'sec2';
const { createHash } = await import('node:crypto');
await sql`update erp_installs set secret_hash = ${createHash('sha256').update(sec2).digest('hex')} where id = ${second.id}`;
r = await route('install=freedomain', { id: second.id, secret: sec2 });
check('a second company with the same name gets -2', r.ok && r.domain === 'acme-prints-1-2.zone.test', r);
r = await route('install=freedomain', { id: first.id, secret: 'wrong' });
check('only the install itself asks', !r.ok, r);
// 5. the platform moves a copy from its own (never finished) address to the free one; the hourly timer finishes it
await sql`update erp_installs set domain = 'erp.acme.test', domain_state = 'waiting', status = 'active' where id = ${first.id}`;
r = await owner('erpInstallDomain', [{ id: first.id, domain: '' }]);
check('empty = the free address, made here', r.ok && r.result.free && r.result.domain === 'acme-prints-1.zone.test', r);
web.on(/pages\/projects\/office-erp\/domains\/acme-prints-1\.zone\.test$/, () => ({ status: 200, body: { result: { status: 'active' } } }));
const hourly = await domainsAll(deps);
check('the hourly timer marks it ready without the install page open', hourly['acme-prints-1.zone.test'] === 'ready' &&
  (await sql`select domain_state from erp_installs where id = ${first.id}`)[0].domain_state === 'ready', hourly);
await done();
