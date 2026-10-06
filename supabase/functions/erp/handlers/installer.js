// The installer, on the provider's system (Costareen's): a company builds its
// own copy of the ERP in its own Supabase account, and the provider keeps
// control of every copy.
//
// Public (no sign-in) - index.ts routes ?install= and ?control=:
//   POST ?install=start  {code, company, ownerName, ownerEmail, token, orgId?, ref?}
//                         -> {id, secret} or {needOrg: [...]}; the invite code is used up
//   POST ?install=step   {id, secret} -> one step done: {status, step, detail, done, error, use}
//   GET  ?install=info&id=  -> {name, api, url, anon} of an active copy (what the page needs to open it)
//   POST ?control=beat   {id, key, version, stats} -> {ok, status, message} (the copy's hourly check-in)
// Signed in, platform admin only:
//   erpInstalls()                          every copy, with how it is doing
//   erpInstallInvite({note})               a single-use install link (14 days)
//   erpInstallSet({id, status, reason})    switch a copy off ('suspended') or on ('active')
//   erpInstallRetry({id})                  a failed install carries on from the step that failed
//
// Each step is short (one Management API call or one database file), so the
// install page simply calls ?install=step until it is done - no long request.
//
// The bridge (2026-10-05, docs/PLATFORM-BLUEPRINT.md): a company's project gets tables, storage and sign-in
// only. No server code is copied there any more: the provider's server runs the company's ERP over an
// encrypted database connection (lib/bridge.js, erp_tenants). Copies made before keep working until
// erpInstallBridge moves them (it also removes the server code and timers from their project).

import { connectProject, saveTenant } from '../lib/bridge.js';
import { makeCompany } from '../lib/control.js';

const str = (v) => String(v == null ? '' : v).trim();
const MGMT = 'https://api.supabase.com/v1';
// the provider's own server, which runs every bridged company's ERP
const controlApi = (deps) => str(deps.installEnv && deps.installEnv.controlUrl);
// Stage 1b: the permanent link (/start = invite code 'open'), the terms every new owner agrees to, the sign-up limits
export const TERMS_VERSION = '2026-10.2';   // .2: section 9, the market
const OPEN = 'open', PER_IP_HOUR = 3, PER_DAY = 30;
// the provider's zone where each company gets <name>.<zone> by itself (e.g. acme.3dowala.com)
const freeZone = (deps) => str(deps.installEnv && deps.installEnv.freeZone).toLowerCase();
const RESERVED = new Set(['erp', 'www', 'mail', 'app', 'api', 'admin', 'start', 'shop', 'store', 'blog', 'help', 'support', 'status', 'mx', 'ns1', 'ns2', 'smtp', 'ftp']);
// the database files a company gets: all of them except the provider's own control tables
function companySql(files) {
  return Object.keys(files).filter((k) => /^sql\/\d{3}_.+\.sql$/.test(k) && !/^\s*--\s*control-only/.test(String(files[k]))).sort();
}
const REGION = 'ap-southeast-1';
const STEPS = ['project', 'wait', 'keys', 'db', 'storage', 'bridge', 'finish'];
const SAY = {
  project: 'Making the project in your Supabase account', wait: 'Waiting for Supabase to start it (1-2 minutes)', keys: 'Reading its keys',
  db: 'Building the database', storage: 'Making file storage', bridge: 'Connecting it to the ERP server',
  secrets: 'Connecting it to the ERP server', function: 'Connecting it to the ERP server', cron: 'Connecting it to the ERP server',
  finish: 'Making your business and your owner login', done: 'Ready',
};

async function sha256(t) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(t)));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
function rand(n = 24) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
const sqlOf = (deps) => deps.sqlAux || deps.sql;

/** One Management API call with the company's own token. */
async function mgmt(deps, token, method, path, body, raw) {
  const OPTS = {
    method, headers: raw ? { Authorization: 'Bearer ' + token } : { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  };
  // Supabase limits how fast one account may call it (429) and its gateway sometimes stumbles (502-504):
  // wait and try again a few times before it counts as a failure
  let r;
  for (let t = 0; ; t++) {
    r = await (deps.fetch || fetch)(MGMT + path, OPTS);
    if (!(r.status === 429 || r.status === 502 || r.status === 503 || r.status === 504) || t >= 3) break;
    const after = Number(r.headers && r.headers.get && r.headers.get('retry-after')) || 0;
    const ms = deps.mgmtRetryMs !== undefined ? deps.mgmtRetryMs : Math.min(20000, after > 0 ? after * 1000 : [3000, 7000, 12000][t]);
    await new Promise((ok) => setTimeout(ok, ms));
  }
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) { json = null; }
  if (r.status === 401 || r.status === 403) throw new Error('Supabase refused the access token (' + r.status + '). Make a new token and start again.');
  if (r.status >= 300) throw new Error('Supabase answered ' + r.status + ': ' + str((json && (json.message || json.error)) || text).slice(0, 240));
  return json;
}

const OAUTH = 'https://api.supabase.com/v1/oauth';
const b64url = (bytes) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
async function oauthToken(deps, form) {
  const o = deps.installEnv && deps.installEnv.oauth || {};
  const r = await (deps.fetch || fetch)(OAUTH + '/token', {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(o.clientId + ':' + o.clientSecret) },
    body: new URLSearchParams(form).toString(),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j || !j.access_token) throw new Error('Supabase did not give access (' + r.status + '): ' + str(j && (j.error_description || j.message || j.error)).slice(0, 160));
  return { access: j.access_token, refresh: j.refresh_token, expires: new Date(Date.now() + (Number(j.expires_in) || 3600) * 1000) };
}
/** The token to reach the company's Supabase: the pasted one, or the connected one (renewed when it is about to run out). */
async function tokenOf(deps, row) {
  if (row.mgmt_kind !== 'oauth') return row.mgmt_token;
  if (row.oauth_expires && new Date(row.oauth_expires).getTime() - Date.now() > 120000) return row.mgmt_token;
  const t = await oauthToken(deps, { grant_type: 'refresh_token', refresh_token: row.oauth_refresh });
  await sqlOf(deps)`update erp_installs set mgmt_token = ${t.access}, oauth_refresh = ${t.refresh || row.oauth_refresh}, oauth_expires = ${t.expires} where id = ${row.id}`;
  row.mgmt_token = t.access; row.oauth_refresh = t.refresh || row.oauth_refresh; row.oauth_expires = t.expires;
  return t.access;
}
// where a company's own address points: the neutral page's address (its pages.dev name can differ from the project name)
/** The login system's settings for a copy: where its e-mails send people, and the owner-approval e-mail. */
export function authConfig(site, allowBase) {
  return { site_url: site, uri_allow_list: [site, String(allowBase).replace(/\/?$/, '/') + '**'].join(',') };
}
/** The approval e-mail's own words (Supabase allows this only with the company's own mail service; tried, never required). */
export function authMailText() {
  return {
    mailer_subjects_magic_link: 'Confirm a change in your ERP',
    mailer_templates_magic_link_content: '<h2>Confirm a change in your ERP</h2><p>An owner wants to change who may use your ERP. Open this link to see the change and agree or refuse:</p><p><a href="{{ .ConfirmationURL }}">Review the change</a></p><p>If you did not expect this, do not agree - and tell the other owner.</p>',
  };
}
const pagesTarget = (deps) => {
  const e = deps.installEnv || {};
  const m = /^https?:\/\/([^/]+\.pages\.dev)/i.exec(str(e.publicUrl));
  return m ? m[1].toLowerCase() : ((e.cloudflare && e.cloudflare.project) || 'costareen-erp') + '.pages.dev';
};
const publicUrl = (deps) => str(deps.installEnv && (deps.installEnv.publicUrl || deps.installEnv.appUrl)) || 'https://erp.costareen.com/';
async function cf(deps, method, path, body) {
  const c = deps.installEnv && deps.installEnv.cloudflare;
  if (!c || !c.token || !c.account || !c.project) return null;
  const r = await (deps.fetch || fetch)('https://api.cloudflare.com/client/v4/accounts/' + c.account + '/pages/projects/' + c.project + path, {
    method, headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { status: r.status, json: await r.json().catch(() => null) };
}

async function latestRelease(sql) {
  const r = (await sql`select version, files from erp_releases order by made_at desc limit 1`)[0];
  if (!r) throw new Error('No release has been published yet (deploy.py release).');
  return { version: r.version, files: typeof r.files === 'string' ? JSON.parse(r.files) : r.files };
}

// ------------------------------------------------------------- the page's side

export async function installStart(deps, b) {
  const sql = sqlOf(deps);
  const code = str(b.code), company = str(b.company).slice(0, 80), ownerName = str(b.ownerName).slice(0, 80);
  const ownerEmail = str(b.ownerEmail).toLowerCase();
  const website = str(b.website).toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').slice(0, 120);
  let token = str(b.token), oauth = null;
  if (b.oauthState) {
    oauth = (await sql`select * from erp_install_oauth where state = ${str(b.oauthState)} and invite = ${code}`)[0];
    if (!oauth || !oauth.access) throw new Error('Supabase was not connected. Press "Connect Supabase" again.');
    token = oauth.access;
  }
  const open = code === OPEN;
  const inv = open ? null : (await sql`select * from erp_install_invites where code_hash = ${await sha256(code)}`)[0];
  if (!open && (!inv || inv.used_at || new Date(inv.expires_at) < new Date())) throw new Error('This install link is not valid any more. Ask for a new one.');
  if (b.agree !== true || str(b.terms) !== TERMS_VERSION) throw new Error('Read and agree to the terms first (the tick box).');
  const ip = str(b.__ip).slice(0, 64);
  if (open) {   // the public link: a few sign-ups per address, and a daily ceiling that protects the free plan
    const n = (await sql`select count(*) filter (where signup_ip = ${ip} and made_at > now() - interval '1 hour')::int ip1,
                                count(*) filter (where made_at > now() - interval '1 day' and signup_ip is not null)::int day_n
                         from erp_installs`)[0];
    if (ip && n.ip1 >= PER_IP_HOUR) throw new Error('Too many sign-ups from this connection. Try again in an hour.');
    if (n.day_n >= PER_DAY) throw new Error('Too many new ERPs today. Try again tomorrow.');
  }
  if (!company) throw new Error('What is the company called?');
  if (!ownerName) throw new Error('Who is the owner? Type the name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('Type the owner’s e-mail address - the login is made for it.');
  if (!oauth && !/^sbp_[A-Za-z0-9]{20,}$/.test(token)) throw new Error('That does not look like a Supabase access token (it starts with sbp_).');
  const orgs = (await mgmt(deps, token, 'GET', '/organizations')) || [];
  if (!orgs.length) throw new Error('This Supabase account has no organisation yet. Open supabase.com, make one, and start again.');
  let orgId = str(b.orgId), ref = str(b.ref);
  if (!ref && !orgId) {
    if (orgs.length > 1) return { needOrg: orgs.map((o) => ({ id: o.id, name: o.name })) };
    orgId = orgs[0].id;
  }
  if (ref) {
    const p = await mgmt(deps, token, 'GET', '/projects/' + encodeURIComponent(ref));
    if (!p || !p.id) throw new Error('That project was not found in this account.');
  }
  const secret = rand(), id = crypto.randomUUID();
  await sql`insert into erp_installs (id, company, owner_name, owner_email, status, step, org_id, ref, mgmt_token, secret_hash, mgmt_kind, oauth_refresh, oauth_expires, website,
                                      terms_version, terms_at, signup_ip)
            values (${id}, ${company}, ${ownerName}, ${ownerEmail}, 'installing', ${ref ? 'wait' : 'project'}, ${orgId || null}, ${ref || null}, ${token}, ${await sha256(secret)},
                    ${oauth ? 'oauth' : 'pat'}, ${oauth ? oauth.refresh : null}, ${oauth ? oauth.expires_at : null}, ${website || null},
                    ${TERMS_VERSION}, now(), ${open ? (ip || 'unknown') : null})`;
  if (oauth) await sql`delete from erp_install_oauth where state = ${oauth.state}`;
  if (inv) await sql`update erp_install_invites set used_at = now(), install_id = ${id} where code_hash = ${inv.code_hash}`;
  return { id, secret };
}

function view(row, extra) {
  return { id: row.id, company: row.company, status: row.status, step: row.step, say: SAY[row.step] || row.step, n: row.step_n,
           detail: str(row.detail), error: str(row.error), done: row.status === 'active', steps: STEPS.length, at: STEPS.indexOf(row.step), ...extra };
}

export async function installStep(deps, b) {
  const sql = sqlOf(deps);
  const row = (await sql`select * from erp_installs where id = ${str(b.id)}::uuid`)[0];
  if (!row || row.secret_hash !== (await sha256(str(b.secret)))) throw new Error('Unknown install.');
  if (b.retry && row.status === 'failed') { await sql`update erp_installs set status = 'installing', error = null where id = ${row.id}`; row.status = 'installing'; row.error = null; }
  if (row.status !== 'installing') return view(row);
  const set = async (f) => {
    const r = { ...row, ...f };
    await sql`update erp_installs set step = ${r.step}, step_n = ${r.step_n}, detail = ${r.detail || null}, error = ${r.error || null}, status = ${r.status},
              ref = ${r.ref || null}, api_url = ${r.api_url || null}, anon_key = ${r.anon_key || null}, version = ${r.version || null},
              key_hash = ${r.key_hash || null}, install_key = ${r.install_key || null}, updated_at = now() where id = ${row.id}`;
    return view(r);
  };
  try {
    const tok = await tokenOf(deps, row);
    const rel = await latestRelease(sql);
    const files = rel.files;
    const runSql = (q) => mgmt(deps, tok, 'POST', '/projects/' + row.ref + '/database/query', { query: q });
    switch (row.step) {
      case 'project': {
        const slug = row.company.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'erp';
        const p = await mgmt(deps, tok, 'POST', '/projects', { name: slug + '-erp', organization_id: row.org_id, region: REGION, db_pass: rand(24) + 'Aa1!' });
        if (!p || !p.id) throw new Error('Supabase did not make the project.');
        return set({ step: 'wait', ref: p.id, detail: 'project ' + p.id });
      }
      case 'wait': {
        const p = await mgmt(deps, tok, 'GET', '/projects/' + row.ref);
        if (str(p && p.status) !== 'ACTIVE_HEALTHY') return set({ detail: 'Supabase says: ' + str(p && p.status).toLowerCase().replace(/_/g, ' ') });
        return set({ step: 'keys', detail: '' });
      }
      case 'keys': {
        const keys = (await mgmt(deps, tok, 'GET', '/projects/' + row.ref + '/api-keys?reveal=true')) || [];
        const anon = (keys.find((k) => k.name === 'anon') || {}).api_key;
        if (!anon) throw new Error('Supabase did not give the project’s public key.');
        await runSql('create table if not exists public._erp_migrations (name text primary key, at timestamptz default now()); alter table public._erp_migrations enable row level security;');
        return set({ step: 'db', step_n: 0, anon_key: anon, api_url: controlApi(deps) });
      }
      case 'db': {
        const list = companySql(files);
        if (row.step_n >= list.length) return set({ step: 'storage', step_n: 0, detail: '' });
        const name = list[row.step_n].slice(4);
        const done = (await runSql("select 1 from public._erp_migrations where name = '" + name.replace(/'/g, "''") + "'")) || [];
        if (!done.length) {
          await runSql(files[list[row.step_n]] + '\n;\ninsert into public._erp_migrations (name) values (\'' + name.replace(/'/g, "''") + '\') on conflict do nothing;');
        }
        return set({ step_n: row.step_n + 1, detail: (row.step_n + 1) + ' of ' + list.length });
      }
      case 'storage': {
        if (files['deploy/storage.sql']) await runSql(files['deploy/storage.sql']);
        return set({ step: 'secrets', detail: '' });
      }
      case 'secrets': case 'function': case 'cron':   // an install started before the bridge: carry on with it
      case 'bridge': {
        if (!deps.bridgeKey || !deps.tenantDeps) throw new Error('The ERP server is not set up for new companies yet (bridge key missing).');
        const conn = await connectProject(deps, tok, row.ref);
        await saveTenant(sqlOf(deps), deps.bridgeKey, row.id, conn);
        deps.tenantDeps.forget(row.id);
        // their login e-mails (password, approvals) come back to their own page
        try { await mgmt(deps, tok, 'PATCH', '/projects/' + row.ref + '/config/auth', authConfig(publicUrl(deps) + '?use=' + row.id, publicUrl(deps))); } catch (_) { /* set again when their address is ready */ }
        try { await mgmt(deps, tok, 'PATCH', '/projects/' + row.ref + '/config/auth', authMailText()); } catch (_) { /* free plan with the built-in mailer: Supabase's own wording */ }
        return set({ step: 'finish', api_url: controlApi(deps), version: rel.version, detail: '' });
      }
      case 'finish': {
        let r;
        try { r = await makeCompany(await deps.tenantDeps(row.id), { company: row.company, ownerName: row.owner_name, ownerEmail: row.owner_email }); }
        catch (e) {   // the new database password is still on its way to the pooler: the page simply asks again
          if (/password authentication|ECONNREFUSED|timeout/i.test(str(e && e.message))) { deps.tenantDeps.forget(row.id); return set({ detail: 'waiting for the database to accept the new connection' }); }
          throw e;
        }
        if (!r.body || !r.body.ok) throw new Error('The new ERP did not finish: ' + str(r.body && r.body.error).slice(0, 200));
        // every copy opens on <company>.<provider zone> - made here, nothing for the company to choose or add
        if (freeZone(deps)) try { await freeDomainFor(deps, row); } catch (_) { /* the page still opens on the provider's own link; the address can be made later */ }
        return set({ step: 'done', status: 'active', install_key: '', detail: r.body.mailed ? 'owner e-mailed' : 'owner made - e-mail not sent', error: '' });
      }
      default: return view(row);
    }
  } catch (e) {
    const msg = str((e && e.message) || e);
    if (/answered (429|502|503|504)\b/.test(msg)) return set({ detail: 'Supabase asked us to slow down - carrying on by itself in a moment', error: '' });
    return set({ status: 'failed', error: msg.slice(0, 400) });
  }
}

/** The install page: the company's own web address for its ERP (e.g. erp.xyzenterprise.com). */
async function rowFor(deps, b) {
  const row = (await sqlOf(deps)`select * from erp_installs where id = ${str(b.id)}::uuid`)[0];
  if (!row || row.secret_hash !== (await sha256(str(b.secret)))) throw new Error('Unknown install.');
  return row;
}
export function cleanHost(v) {
  const d = str(v).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
  if (!/^([a-z0-9]([a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/.test(d)) throw new Error('A web address is like erp.yourcompany.com');
  if (/(^|\.)costareen\.com$|\.pages\.dev$|\.supabase\.co$/.test(d)) throw new Error('Use an address of your own company.');
  return d;
}
export async function domainSet(deps, b) {
  const row = await rowFor(deps, b);
  const d = cleanHost(b.domain);
  if ((await sqlOf(deps)`select 1 from erp_installs where lower(domain) = ${d} and id <> ${row.id}`).length) throw new Error(d + ' is already used by another ERP.');
  await sqlOf(deps)`update erp_installs set domain = ${d}, domain_state = 'waiting', updated_at = now() where id = ${row.id}`;
  const r = await cf(deps, 'POST', '/domains', { name: d });
  const host = d.split('.')[0], parent = d.split('.').slice(1).join('.');
  return { domain: d, record: { type: 'CNAME', name: host, full: d, value: pagesTarget(deps), parent }, auto: !!r };
}
/** The free address: <company>.<zone> on the provider's own domain - the DNS record and the page address are made here. */
export async function freeDomain(deps, b) { return freeDomainFor(deps, await rowFor(deps, b)); }
async function freeDomainFor(deps, row) {
  const zone = freeZone(deps), zid = str(deps.installEnv && deps.installEnv.freeZoneId), c = deps.installEnv && deps.installEnv.cloudflare;
  if (!zone || !zid || !c || !c.token) throw new Error('Free addresses are not set up on this server.');
  if (row.domain && row.domain.endsWith('.' + zone)) return { domain: row.domain, auto: true };
  let base = str(row.company).toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'erp';
  if (RESERVED.has(base)) base = base + '-erp';
  let d = '', n = 1;
  for (; n < 50; n++) {
    d = (n === 1 ? base : base + '-' + n) + '.' + zone;
    if (!(await sqlOf(deps)`select 1 from erp_installs where lower(domain) = ${d}`).length) break;
  }
  const r = await (deps.fetch || fetch)('https://api.cloudflare.com/client/v4/zones/' + zid + '/dns_records', {
    method: 'POST', headers: { Authorization: 'Bearer ' + c.token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'CNAME', name: d, content: pagesTarget(deps), proxied: true, comment: 'ERP of ' + str(row.company).slice(0, 60) }) });
  const j = await r.json().catch(() => null);
  if (!r.ok && !(j && (j.errors || []).some((e) => /already exists/i.test(str(e.message))))) throw new Error('The address could not be made (' + r.status + ').');
  await cf(deps, 'POST', '/domains', { name: d });
  await sqlOf(deps)`update erp_installs set domain = ${d}, domain_state = 'seen', updated_at = now() where id = ${row.id}`;
  return { domain: d, auto: true };
}

/** Is the record there yet, and is the address ready (certificate made)? */
export async function domainCheck(deps, b) { return domainCheckFor(deps, await rowFor(deps, b)); }
async function domainCheckFor(deps, row) {
  if (!row.domain) throw new Error('Set the address first.');
  const target = pagesTarget(deps);
  let seen = !!freeZone(deps) && row.domain.endsWith('.' + freeZone(deps));   // on the provider's own zone the record was made here
  if (!seen) try {
    const r = await (deps.fetch || fetch)('https://cloudflare-dns.com/dns-query?name=' + encodeURIComponent(row.domain) + '&type=CNAME', { headers: { accept: 'application/dns-json' } });
    const j = await r.json();
    seen = ((j && j.Answer) || []).some((a) => str(a.data).replace(/\.$/, '').toLowerCase() === target);
  } catch (_) { seen = false; }
  let state = seen ? 'seen' : 'waiting', ready = false;
  if (seen) {
    const c = await cf(deps, 'GET', '/domains/' + encodeURIComponent(row.domain));
    if (c && c.json && c.json.result && c.json.result.status === 'active') { state = 'ready'; ready = true; }
    if (c && c.status === 404) await cf(deps, 'POST', '/domains', { name: row.domain });
  }
  if (ready && row.domain_state !== 'ready') {
    // the copy's own links (alerts, e-mails) now use its address
    try { await mgmt(deps, await tokenOf(deps, row), 'POST', '/projects/' + row.ref + '/secrets', [{ name: 'ERP_APP_URL', value: 'https://' + row.domain + '/' }]); } catch (_) { /* best effort */ }
    try { await mgmt(deps, await tokenOf(deps, row), 'PATCH', '/projects/' + row.ref + '/config/auth', authConfig('https://' + row.domain + '/', 'https://' + row.domain + '/')); } catch (_) { /* best effort */ }
  }
  await sqlOf(deps)`update erp_installs set domain_state = ${state}, updated_at = now() where id = ${row.id}`;
  return { domain: row.domain, state, ready, auto: !!(deps.installEnv && deps.installEnv.cloudflare && deps.installEnv.cloudflare.token), url: 'https://' + row.domain + '/', free: publicUrl(deps) + '#/use/' + row.id };
}

/** The hourly timer: addresses still being made are checked here too, so the copy's links switch over even when nobody keeps the install page open. */
export async function domainsAll(deps) {
  const out = {};
  for (const row of await sqlOf(deps)`select * from erp_installs where status = 'active' and domain is not null and coalesce(domain_state, 'waiting') <> 'ready' limit 50`) {
    try { out[row.domain] = (await domainCheckFor(deps, row)).state; } catch (e) { out[row.domain] = 'error: ' + str((e && e.message) || e).slice(0, 120); }
  }
  return out;
}

/** "Connect Supabase": where to send the person, with a one-time state (PKCE). */
export async function oauthStart(deps, b) {
  const o = deps.installEnv && deps.installEnv.oauth || {};
  if (!o.clientId) throw new Error('Connecting with one click is not set up yet - use the access token instead.');
  const code = str(b.code);
  const inv = code === OPEN ? { expires_at: new Date(Date.now() + 86400e3) } : (await sqlOf(deps)`select used_at, expires_at from erp_install_invites where code_hash = ${await sha256(code)}`)[0];
  if (!inv || inv.used_at || new Date(inv.expires_at) < new Date()) throw new Error('This install link is not valid any more. Ask for a new one.');
  const state = rand(24), verifier = rand(48);
  const challenge = b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
  await sqlOf(deps)`insert into erp_install_oauth (state, invite, verifier) values (${state}, ${code}, ${verifier})`;
  await sqlOf(deps)`delete from erp_install_oauth where made_at < now() - interval '1 day'`;
  const q = new URLSearchParams({ client_id: o.clientId, redirect_uri: o.redirect, response_type: 'code', state, code_challenge: challenge, code_challenge_method: 'S256' });
  return { url: OAUTH + '/authorize?' + q.toString() };
}
/** Supabase sends the person back here; the token is kept for the install page, which carries on. */
export async function oauthBack(deps, q) {
  const o = deps.installEnv && deps.installEnv.oauth || {};
  const row = (await sqlOf(deps)`select * from erp_install_oauth where state = ${str(q.state)}`)[0];
  if (!row) return publicUrl(deps) + '#/install/expired';
  const back = publicUrl(deps) + '#/install/' + row.invite;
  if (q.error || !q.code) return back + '/cancelled';
  try {
    const t = await oauthToken(deps, { grant_type: 'authorization_code', code: str(q.code), redirect_uri: o.redirect, code_verifier: row.verifier });
    await sqlOf(deps)`update erp_install_oauth set access = ${t.access}, refresh = ${t.refresh || null}, expires_at = ${t.expires} where state = ${row.state}`;
    return back + '/' + row.state;
  } catch (_) { return back + '/cancelled'; }
}

export async function brandOf(sql) {
  const r = (await sql`select name, sponsor, accent, logo from erp_brand where id = 1`)[0] || {};
  return { name: str(r.name) || 'ERP', sponsor: str(r.sponsor), accent: str(r.accent), logo: str(r.logo) };
}
/** "Check now": can the provider reach the company, and its latest figures. */
export async function erpInstallHealth(ctx, payload) {
  await needAdmin(ctx);
  const id = str(payload && payload.id);
  if (!ctx.deps.checkTenantNow) throw new Error('This server does not run company ERPs.');
  if (!(await ctx.sql`select 1 from erp_tenants where id::text = ${id}`).length) throw new Error('That company is not on the provider\u2019s server yet.');
  return { id, status: await ctx.deps.checkTenantNow(id) };
}

// ---- announcements: a message the provider writes, shown inside every company's ERP until it ends
export async function newsActive(sql) {
  return (await sql`select id, text, level from erp_news where ended_at is null and (until is null or until > now()) order by made_at desc limit 5`)
    .map((r) => ({ id: r.id, text: str(r.text), level: str(r.level) }));
}
export async function erpNews(ctx) {
  await needAdmin(ctx);
  return { items: (await ctx.sql`select id, text, level, until, made_at, ended_at from erp_news order by made_at desc limit 30`)
    .map((r) => ({ ...r, live: !r.ended_at && (!r.until || new Date(r.until) > new Date()) })) };
}
export async function erpNewsAdd(ctx, payload) {
  await needAdmin(ctx);
  const p = payload || {};
  const text = str(p.text).slice(0, 400), level = p.level === 'warn' ? 'warn' : 'info', days = Math.max(0, Math.min(90, Number(p.days) || 0));
  if (!text) throw new Error('Write the message first.');
  await ctx.sql`insert into erp_news (text, level, until) values (${text}, ${level}, ${days ? new Date(Date.now() + days * 86400e3) : null})`;
  return erpNews(ctx);
}
export async function erpNewsEnd(ctx, payload) {
  await needAdmin(ctx);
  await ctx.sql`update erp_news set ended_at = now() where id = ${Number(payload && payload.id) || 0} and ended_at is null`;
  return erpNews(ctx);
}

export async function erpBrand(ctx) { await needAdmin(ctx); return { ...(await brandOf(ctx.sql)), terms: TERMS_VERSION }; }
export async function erpBrandSet(ctx, payload) {
  await needAdmin(ctx);
  const p = payload || {};
  const name = str(p.name).slice(0, 40), sponsor = str(p.sponsor).slice(0, 80), accent = str(p.accent), logo = str(p.logo);
  if (!name) throw new Error('Give the ERP a name.');
  if (accent && !/^#[0-9a-f]{6}$/i.test(accent)) throw new Error('A colour is like #2756c9.');
  if (logo && (!/^data:image\/(png|jpeg|webp|svg\+xml);base64,/.test(logo) || logo.length > 345000)) throw new Error('The logo must be a PNG, JPG, WebP or SVG under 250 KB.');
  await ctx.sql`update erp_brand set name = ${name}, sponsor = ${sponsor || null}, accent = ${accent || null}, logo = ${logo || null}, updated_at = now() where id = 1`;
  return erpBrand(ctx);
}

export async function installInfo(deps, id) {
  const r = (await sqlOf(deps)`select i.company, i.api_url, i.anon_key, i.ref, i.status, t.id as tenant
                                 from erp_installs i left join erp_tenants t on t.id = i.id where i.id = ${str(id)}::uuid`)[0];
  // a switched-off copy still opens its sign-in page, which then says why
  if (!r || !['active', 'suspended'].includes(r.status)) throw new Error('That ERP is not ready, or not known.');
  if (r.tenant) return { name: r.company, api: controlApi(deps), url: 'https://' + r.ref + '.supabase.co', anon: r.anon_key, tenant: str(id) };
  return { name: r.company, api: r.api_url, url: 'https://' + r.ref + '.supabase.co', anon: r.anon_key };
}

export async function controlBeat(deps, b) {
  const sql = sqlOf(deps);
  const r = (await sql`select id, key_hash, status, reason from erp_installs where id = ${str(b.id)}::uuid`)[0];
  if (!r || !r.key_hash || r.key_hash !== (await sha256(str(b.key)))) return { ok: false, error: 'Unknown copy.' };
  await sql`update erp_installs set last_seen = now(), stats = ${JSON.stringify(b.stats || {})}::jsonb, version = coalesce(nullif(${str(b.version)}, ''), version) where id = ${r.id}`;
  return { ok: true, status: r.status === 'suspended' ? 'suspended' : 'active', message: r.status === 'suspended' ? str(r.reason) : '' };
}

/** index.ts: the public routes. Returns {status, body}. */
export async function installRoute(deps, req) {
  const u = new URL(req.url);
  if (deps.install && deps.install.id) return { status: 404, body: { ok: false, error: 'Not here.' } };   // a copy never installs others
  try {
    if (u.searchParams.get('control') === 'beat') return { status: 200, body: await controlBeat(deps, await req.json()) };
    const what = u.searchParams.get('install');
    if (what === 'info') return { status: 200, body: { ok: true, ...(await installInfo(deps, u.searchParams.get('id'))) } };
    if (what === 'brand') return { status: 200, body: { ok: true, ...(await brandOf(sqlOf(deps))), terms: TERMS_VERSION } };
    if (what === 'news') return { status: 200, body: { ok: true, items: await newsActive(sqlOf(deps)) } };
    if (what === 'caps') {
      const e = deps.installEnv || {};
      return { status: 200, body: { ok: true, oauth: !!(e.oauth && e.oauth.clientId), domains: !!(e.cloudflare && e.cloudflare.token), target: pagesTarget(deps), zone: freeZone(deps), free: !!(freeZone(deps) && e.freeZoneId && e.cloudflare && e.cloudflare.token) } };
    }
    if (what === 'oauth_back') return { status: 302, location: await oauthBack(deps, Object.fromEntries(u.searchParams.entries())), body: null };
    // a page opened on a company's own web address finds its copy
    if (what === 'host') {
      const h = str(u.searchParams.get('h')).toLowerCase();
      const r = (await sqlOf(deps)`select id from erp_installs where lower(domain) = ${h} and status in ('active', 'suspended')`)[0];
      if (!r) return { status: 200, body: { ok: false, error: 'No ERP at this address.' } };
      return { status: 200, body: { ok: true, id: r.id, ...(await installInfo(deps, r.id)) } };
    }
    if (req.method !== 'POST') return { status: 405, body: { ok: false } };
    const b = await req.json();
    if (what === 'start') {
      const ip = str(req.headers.get('cf-connecting-ip') || str(req.headers.get('x-forwarded-for')).split(',')[0]);
      return { status: 200, body: { ok: true, ...(await installStart(deps, { ...b, __ip: ip })) } };
    }
    if (what === 'freedomain') return { status: 200, body: { ok: true, ...(await freeDomain(deps, b)) } };
    if (what === 'step') return { status: 200, body: { ok: true, ...(await installStep(deps, b)) } };
    if (what === 'oauth') return { status: 200, body: { ok: true, ...(await oauthStart(deps, b)) } };
    // (2026-10-06) no own-domain choice at install any more: every copy gets <company>.<provider zone> by itself
    if (what === 'domaincheck') return { status: 200, body: { ok: true, ...(await domainCheck(deps, b)) } };
    return { status: 404, body: { ok: false, error: 'Unknown.' } };
  } catch (e) { return { status: 200, body: { ok: false, error: str((e && e.message) || e) } }; }
}

// ------------------------------------------------------------- the provider's screen

async function needAdmin(ctx) {
  const r = await ctx.sql`select 1 from platform_admins where user_id = ${ctx.s.userId}`;
  if (!r.length) throw new Error('Only the platform admin manages installs.');
}

export async function erpInstalls(ctx) {
  await needAdmin(ctx);
  const rows = await ctx.sql`select i.id, i.company, i.owner_name, i.owner_email, i.status, i.step, i.step_n, i.detail, i.error, i.ref, i.version, i.stats, i.last_seen, i.reason, i.made_at,
                                    i.domain, i.domain_state, i.website, i.mgmt_kind, i.upd_step, i.upd_error, i.updated_to_at, i.terms_version,
                                    t.status as bridge, t.checked_at, t.check_error, coalesce(t.joint, false) as joint
                             from erp_installs i left join erp_tenants t on t.id = i.id order by i.made_at desc`;
  const rel = (await ctx.sql`select version, made_at from erp_releases order by made_at desc limit 1`)[0];
  const invites = await ctx.sql`select note, made_at, expires_at, used_at from erp_install_invites order by made_at desc limit 20`;
  return { release: rel ? { version: rel.version, at: rel.made_at } : null, installs: rows.map((r) => ({ ...r, say: SAY[r.step] || r.step,
    stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats, late: r.status === 'active' && (!r.last_seen || Date.now() - new Date(r.last_seen).getTime() > 3 * 3600e3) })), invites };
}

export async function erpInstallInvite(ctx, payload) {
  await needAdmin(ctx);
  const code = rand(18);
  await ctx.sql`insert into erp_install_invites (code_hash, note, made_by, expires_at) values (${await sha256(code)}, ${str(payload && payload.note).slice(0, 120) || null}, ${ctx.s.userId}, now() + interval '14 days')`;
  return { code, link: publicUrl(ctx.deps) + '#/install/' + code };
}

export async function erpInstallSet(ctx, payload) {
  await needAdmin(ctx);
  payload = payload || {};
  const status = str(payload.status), reason = str(payload.reason).slice(0, 300);
  if (status !== 'active' && status !== 'suspended') throw new Error('Switch it on or off?');
  if (status === 'suspended' && !reason) throw new Error('Say why it is switched off. The company sees the reason.');
  const r = await ctx.sql`update erp_installs set status = ${status}, reason = ${status === 'suspended' ? reason : null}, updated_at = now()
                          where id = ${str(payload.id)}::uuid and status in ('active', 'suspended') returning id`;
  if (!r.length) throw new Error('That copy is not installed yet.');
  // a bridged company: its ERP on the provider's server locks (or opens) at once
  await ctx.sql`update erp_tenants set status = ${status === 'suspended' ? 'locked' : 'active'}, reason = ${status === 'suspended' ? reason : null}
                where id = ${str(payload.id)}::uuid and (status <> 'disconnected' or ${status} = 'suspended')`;
  if (ctx.deps && ctx.deps.tenantDeps) ctx.deps.tenantDeps.forget(str(payload.id));
  return { ok: true, status };
}

export async function erpInstallRetry(ctx, payload) {
  await needAdmin(ctx);
  const r = await ctx.sql`update erp_installs set status = 'installing', error = null, updated_at = now() where id = ${str(payload && payload.id)}::uuid and status = 'failed' returning id`;
  if (!r.length) throw new Error('Only a failed install can carry on.');
  return { ok: true };
}

// ------------------------------------------------------------- updates (installer-2)

/**
 * erpInstallUpdate({id}) - one step of bringing a copy up to the newest release.
 * The Platform page calls it until it says done: new database files first (only
 * the ones the copy has not had), then the server, then the timers with a fresh key.
 * Nothing is changed when the copy is already on the newest release.
 */
export async function erpInstallUpdate(ctx, payload) {
  await needAdmin(ctx);
  return updateStep(ctx, str(payload && payload.id));
}
/** One step of the update, for the Platform button and for the timer (updateAll). */
async function updateStep(ctx, idText) {
  const sql = ctx.sql;
  const row = (await sql`select * from erp_installs where id = ${idText}::uuid`)[0];
  if (!row || !['active', 'suspended'].includes(row.status)) throw new Error('Only an installed copy can be updated.');
  const rel = await latestRelease(sql);
  const files = rel.files;
  let tok;
  try { tok = await tokenOf(ctx.deps, row); } catch (e) { return { id: row.id, done: false, step: row.upd_step || 'db', error: str(e && e.message) }; }
  const save = async (f) => {
    const r = { ...row, ...f };
    await sql`update erp_installs set upd_to = ${r.upd_to || null}, upd_step = ${r.upd_step || null}, upd_n = ${r.upd_n || 0}, upd_error = ${r.upd_error || null},
              version = ${r.version || null}, updated_to_at = ${r.updated_to_at || null}, updated_at = now() where id = ${row.id}`;
    return { id: row.id, step: r.upd_step || 'done', n: r.upd_n || 0, version: r.version, to: r.upd_to || r.version, done: !r.upd_step, error: str(r.upd_error) };
  };
  if (!row.upd_step) {
    if (row.version === rel.version) return { id: row.id, done: true, step: 'done', version: row.version, to: rel.version, already: true };
    row.upd_step = 'db'; row.upd_n = 0; row.upd_to = rel.version; row.upd_error = null;
  }
  if (row.upd_to !== rel.version) { row.upd_step = 'db'; row.upd_n = 0; row.upd_to = rel.version; }   // a newer release came out meanwhile
  const runSql = (q) => mgmt(ctx.deps, tok, 'POST', '/projects/' + row.ref + '/database/query', { query: q });
  try {
    if (row.upd_step === 'db') {
      const have = new Set(((await runSql('select name from public._erp_migrations')) || []).map((r) => r.name));
      const todo = companySql(files).filter((k) => !have.has(k.slice(4)));
      if (!todo.length) {
        const bridged = (await ctx.sql`select 1 from erp_tenants where id = ${row.id}`).length > 0;
        if (bridged) return save({ upd_step: null, upd_n: 0, version: rel.version, updated_to_at: new Date(), upd_error: null });   // its server is the provider's: already new
        return save({ upd_step: 'function', upd_n: 0, upd_error: null });
      }
      const name = todo[0].slice(4);
      await runSql(files[todo[0]]);
      await runSql("insert into public._erp_migrations (name) values ('" + name.replace(/'/g, "''") + "') on conflict do nothing");
      return save({ upd_n: (row.upd_n || 0) + 1, upd_error: null });
    }
    if (row.upd_step === 'function') {
      const form = new FormData();
      form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: 'erp', verify_jwt: false }));
      for (const k of Object.keys(files).filter((x) => x.startsWith('fn/'))) {
        form.append('file', new Blob([files[k]], { type: k.endsWith('.ts') ? 'application/typescript' : 'application/javascript' }), k.slice(3));
      }
      await mgmt(ctx.deps, tok, 'POST', '/projects/' + row.ref + '/functions/deploy?slug=erp', form, true);
      return save({ upd_step: 'cron', upd_error: null });
    }
    if (row.upd_step === 'cron') {
      const cron = rand();
      await mgmt(ctx.deps, tok, 'POST', '/projects/' + row.ref + '/secrets', [{ name: 'CRON_KEY', value: cron }, { name: 'ERP_RELEASE', value: rel.version }]);
      const q = (files['deploy/cron.sql'] || '').split('__FN_URL__').join(row.api_url).split('__CRON_KEY__').join(cron);
      if (q) await runSql(q);
      return save({ upd_step: null, upd_n: 0, version: rel.version, updated_to_at: new Date(), upd_error: null });
    }
    return save({ upd_step: null });
  } catch (e) {
    return save({ upd_error: str((e && e.message) || e).slice(0, 400) });
  }
}

/** Run fn over the bridge, waiting (up to ~40 s) for a freshly set database password to be accepted. */
async function reachable(deps, id, fn) {
  let last = null;
  for (let i = 0; i < 9; i++) {
    try { return await fn(await deps.tenantDeps(id)); }
    catch (e) { last = e; if (!/password authentication|ECONNREFUSED|timeout|terminated/i.test(str(e && e.message))) throw e; deps.tenantDeps.forget(id); await new Promise((ok) => setTimeout(ok, 4500)); }
  }
  throw last;
}

/** Move a copy made before the bridge onto it: its ERP then runs on the provider's server, and the server code
 *  and timers are taken out of the company's project (nothing of the logic stays there). */
export async function erpInstallBridge(ctx, payload) {
  await needAdmin(ctx);
  const deps = ctx.deps;
  if (!deps.bridgeKey || !deps.tenantDeps) throw new Error('The bridge key is not set on this server.');
  const row = (await ctx.sql`select * from erp_installs where id = ${str(payload && payload.id)}::uuid`)[0];
  if (!row || !row.ref || !['active', 'suspended'].includes(row.status)) throw new Error('Only an installed copy can be moved.');
  const tok = await tokenOf(deps, row);
  const conn = await connectProject(deps, tok, row.ref);
  await saveTenant(ctx.sql, deps.bridgeKey, row.id, conn);
  deps.tenantDeps.forget(row.id);
  // it must answer over the bridge before anything is taken away (a new password takes a few seconds to reach the pooler)
  const biz = await reachable(deps, row.id, (td) => td.sql`select count(*)::int n from businesses`.then((r) => r[0].n));
  const runSql = (q) => mgmt(deps, tok, 'POST', '/projects/' + row.ref + '/database/query', { query: q });
  let removed = [];
  try { await runSql("select cron.unschedule(jobid) from cron.job where command like '%functions/v1/erp%'"); removed.push('timers'); } catch (_) { /* no timers */ }
  try { await mgmt(deps, tok, 'DELETE', '/projects/' + row.ref + '/functions/erp'); removed.push('server code'); } catch (_) { /* already gone */ }
  if (row.status === 'suspended') await ctx.sql`update erp_tenants set status = 'locked', reason = ${row.reason || null} where id = ${row.id}`;
  await ctx.sql`update erp_installs set api_url = ${controlApi(deps)}, key_hash = null, updated_at = now() where id = ${row.id}`;
  return { ok: true, id: row.id, businesses: biz, removed };
}

/** The company sent a new Supabase access token (the old one was removed or expired). */
export async function erpInstallToken(ctx, payload) {
  await needAdmin(ctx);
  const token = str(payload && payload.token);
  if (!/^sbp_[A-Za-z0-9]{20,}$/.test(token)) throw new Error('That does not look like a Supabase access token (it starts with sbp_).');
  const row = (await ctx.sql`select ref from erp_installs where id = ${str(payload.id)}::uuid`)[0];
  if (!row || !row.ref) throw new Error('That copy has no project yet.');
  await mgmt(ctx.deps, token, 'GET', '/projects/' + row.ref);   // the token must reach that very project
  await ctx.sql`update erp_installs set mgmt_token = ${token}, upd_error = null, updated_at = now() where id = ${payload.id}::uuid`;
  return { ok: true };
}

/** The company's own web address for its copy, e.g. erp.theirshop.com (they point it at the provider's page). */
export async function erpInstallDomain(ctx, payload) {
  await needAdmin(ctx);
  const d = str(payload && payload.domain).toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  if (!d && freeZone(ctx.deps)) {   // empty = the free address <company>.<provider zone>, made here (DNS + page address)
    const row = (await ctx.sql`select * from erp_installs where id = ${str(payload && payload.id)}::uuid`)[0];
    if (!row) throw new Error('That copy is not known.');
    if (row.domain && !row.domain.endsWith('.' + freeZone(ctx.deps))) { await ctx.sql`update erp_installs set domain = null, domain_state = null, updated_at = now() where id = ${row.id}`; row.domain = null; }
    const f = await freeDomainFor(ctx.deps, row);
    return { ok: true, domain: f.domain, free: true, cname: pagesTarget(ctx.deps), auto: true };
  }
  if (d && !/^([a-z0-9-]+\.)+[a-z]{2,}$/.test(d)) throw new Error('A web address is like erp.theirshop.com');
  if (d && /(^|\.)costareen\.com$/.test(d)) throw new Error('That is the provider\u2019s own address.');
  if (d && (await ctx.sql`select 1 from erp_installs where lower(domain) = ${d} and id <> ${str(payload.id)}::uuid`).length) throw new Error('Another copy already uses ' + d + '.');
  const r = await ctx.sql`update erp_installs set domain = ${d || null}, domain_state = ${d ? 'waiting' : null}, updated_at = now() where id = ${str(payload.id)}::uuid returning id`;
  if (!r.length) throw new Error('That copy is not known.');
  const auto = d ? !!(await cf(ctx.deps, 'POST', '/domains', { name: d })) : false;
  return { ok: true, domain: d, cname: pagesTarget(ctx.deps), auto };
}

/**
 * Every company copy is brought to the newest release by itself (the hourly timer): the provider deploys once and
 * nothing is pressed. A copy whose update stopped with an error (a refused token) is left for the Platform screen.
 */
export async function updateAll(deps) {
  const sql = deps.sqlAux || deps.sql, out = { done: [], busy: [], errors: [] };
  const rel = (await sql`select version from erp_releases order by made_at desc limit 1`)[0];
  if (!rel) return out;
  const rows = await sql`select id, company, version, upd_error from erp_installs where status in ('active', 'suspended') and ref is not null
                         and coalesce(version, '') <> ${rel.version} order by made_at`;
  const ctx = { sql, deps, s: { userId: null, name: 'Timer' }, biz: null, now: new Date(), memo: {} };
  for (const r of rows) {
    if (r.upd_error) { out.errors.push(str(r.company) + ': ' + str(r.upd_error).slice(0, 120)); continue; }   // a person has to look (Platform)
    let last = null;
    for (let i = 0; i < 40; i++) {                                 // enough steps for every database file of one release
      last = await updateStep(ctx, r.id);
      if (last.done || last.error) break;
    }
    if (last && last.done) out.done.push(str(r.company) + ' -> ' + last.version);
    else if (last && last.error) out.errors.push(str(r.company) + ': ' + last.error.slice(0, 120));
    else out.busy.push(str(r.company));
  }
  return out;
}

export const HANDLERS = { erpInstalls, erpInstallInvite, erpInstallSet, erpInstallRetry, erpInstallUpdate, erpInstallToken, erpInstallDomain, erpInstallBridge, erpBrand, erpBrandSet, erpInstallHealth, erpNews, erpNewsAdd, erpNewsEnd };
