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

const str = (v) => String(v == null ? '' : v).trim();
const MGMT = 'https://api.supabase.com/v1';
const REGION = 'ap-southeast-1';
const STEPS = ['project', 'wait', 'keys', 'db', 'storage', 'secrets', 'function', 'cron', 'finish'];
const SAY = {
  project: 'Making the project in your Supabase account', wait: 'Waiting for Supabase to start it (1-2 minutes)', keys: 'Reading its keys',
  db: 'Building the database', storage: 'Making file storage', secrets: 'Setting its private settings', function: 'Putting the ERP server in place',
  cron: 'Starting its timers', finish: 'Making your business and your owner login', done: 'Ready',
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
  const r = await (deps.fetch || fetch)(MGMT + path, {
    method, headers: raw ? { Authorization: 'Bearer ' + token } : { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: raw ? body : body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await r.text();
  let json = null; try { json = JSON.parse(text); } catch (_) { json = null; }
  if (r.status === 401 || r.status === 403) throw new Error('Supabase refused the access token (' + r.status + '). Make a new token and start again.');
  if (r.status >= 300) throw new Error('Supabase answered ' + r.status + ': ' + str((json && (json.message || json.error)) || text).slice(0, 240));
  return json;
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
  const ownerEmail = str(b.ownerEmail).toLowerCase(), token = str(b.token);
  const inv = (await sql`select * from erp_install_invites where code_hash = ${await sha256(code)}`)[0];
  if (!inv || inv.used_at || new Date(inv.expires_at) < new Date()) throw new Error('This install link is not valid any more. Ask for a new one.');
  if (!company) throw new Error('What is the company called?');
  if (!ownerName) throw new Error('Who is the owner? Type the name.');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) throw new Error('Type the owner’s e-mail address - the login is made for it.');
  if (!/^sbp_[A-Za-z0-9]{20,}$/.test(token)) throw new Error('That does not look like a Supabase access token (it starts with sbp_).');
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
  await sql`insert into erp_installs (id, company, owner_name, owner_email, status, step, org_id, ref, mgmt_token, secret_hash)
            values (${id}, ${company}, ${ownerName}, ${ownerEmail}, 'installing', ${ref ? 'wait' : 'project'}, ${orgId || null}, ${ref || null}, ${token}, ${await sha256(secret)})`;
  await sql`update erp_install_invites set used_at = now(), install_id = ${id} where code_hash = ${inv.code_hash}`;
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
  const tok = row.mgmt_token;
  try {
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
        return set({ step: 'db', step_n: 0, anon_key: anon, api_url: 'https://' + row.ref + '.supabase.co/functions/v1/erp' });
      }
      case 'db': {
        const list = Object.keys(files).filter((k) => /^sql\/\d{3}_.+\.sql$/.test(k)).sort();
        if (row.step_n >= list.length) return set({ step: 'storage', step_n: 0, detail: '' });
        const name = list[row.step_n].slice(4);
        const done = (await runSql("select 1 from public._erp_migrations where name = '" + name.replace(/'/g, "''") + "'")) || [];
        if (!done.length) {
          await runSql(files[list[row.step_n]]);
          await runSql("insert into public._erp_migrations (name) values ('" + name.replace(/'/g, "''") + "') on conflict do nothing");
        }
        return set({ step_n: row.step_n + 1, detail: (row.step_n + 1) + ' of ' + list.length });
      }
      case 'storage': {
        if (files['deploy/storage.sql']) await runSql(files['deploy/storage.sql']);
        return set({ step: 'secrets', detail: '' });
      }
      case 'secrets': {
        const env = deps.installEnv || {};
        const key = rand(), cron = rand();
        await mgmt(deps, tok, 'POST', '/projects/' + row.ref + '/secrets', [
          { name: 'ERP_INSTALL_ID', value: row.id }, { name: 'ERP_INSTALL_KEY', value: key }, { name: 'ERP_CONTROL_URL', value: str(env.controlUrl) },
          { name: 'ERP_RELEASE', value: rel.version }, { name: 'CRON_KEY', value: cron }, { name: 'ERP_APP_URL', value: str(env.appUrl) || 'https://erp.costareen.com/' },
          ...(env.renderUrl ? [{ name: 'RENDER_URL', value: env.renderUrl }, { name: 'RENDER_KEY', value: str(env.renderKey) }] : []),
        ]);
        // the cron key is needed once more (timers), the install key once more (finish): kept until then, then wiped
        return set({ step: 'function', key_hash: await sha256(key), install_key: key + '|' + cron, detail: '' });
      }
      case 'function': {
        const form = new FormData();
        form.append('metadata', JSON.stringify({ entrypoint_path: 'index.ts', name: 'erp', verify_jwt: false }));
        for (const k of Object.keys(files).filter((x) => x.startsWith('fn/'))) {
          form.append('file', new Blob([files[k]], { type: k.endsWith('.ts') ? 'application/typescript' : 'application/javascript' }), k.slice(3));
        }
        await mgmt(deps, tok, 'POST', '/projects/' + row.ref + '/functions/deploy?slug=erp', form, true);
        return set({ step: 'cron', version: rel.version, detail: '' });
      }
      case 'cron': {
        const cron = str(row.install_key).split('|')[1];
        let q = files['deploy/cron.sql'] || '';
        q = q.split('__FN_URL__').join(row.api_url).split('__CRON_KEY__').join(cron);
        if (q) await runSql(q);
        return set({ step: 'finish', detail: '' });
      }
      case 'finish': {
        const key = str(row.install_key).split('|')[0];
        const r = await (deps.fetch || fetch)(row.api_url + '?install=finish', {
          method: 'POST', headers: { 'Content-Type': 'application/json', 'x-install-key': key },
          body: JSON.stringify({ company: row.company, ownerName: row.owner_name, ownerEmail: row.owner_email }),
        });
        let j = null; try { j = await r.json(); } catch (_) { j = null; }
        if (!j || !j.ok) {
          // a function just deployed can take a few seconds to answer
          if (r.status >= 500 || r.status === 404) return set({ detail: 'waiting for the new server to answer' });
          throw new Error('The new ERP did not finish: ' + str(j && j.error).slice(0, 200));
        }
        return set({ step: 'done', status: 'active', install_key: '', detail: j.mailed ? 'owner e-mailed' : 'owner made - e-mail not sent', error: '' });
      }
      default: return view(row);
    }
  } catch (e) {
    return set({ status: 'failed', error: str((e && e.message) || e).slice(0, 400) });
  }
}

export async function installInfo(deps, id) {
  const r = (await sqlOf(deps)`select company, api_url, anon_key, ref, status from erp_installs where id = ${str(id)}::uuid`)[0];
  if (!r || r.status !== 'active') throw new Error('That ERP is not ready, or not known.');
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
    if (req.method !== 'POST') return { status: 405, body: { ok: false } };
    const b = await req.json();
    if (what === 'start') return { status: 200, body: { ok: true, ...(await installStart(deps, b)) } };
    if (what === 'step') return { status: 200, body: { ok: true, ...(await installStep(deps, b)) } };
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
  const rows = await ctx.sql`select id, company, owner_name, owner_email, status, step, step_n, detail, error, ref, version, stats, last_seen, reason, made_at
                             from erp_installs order by made_at desc`;
  const rel = (await ctx.sql`select version, made_at from erp_releases order by made_at desc limit 1`)[0];
  const invites = await ctx.sql`select note, made_at, expires_at, used_at from erp_install_invites order by made_at desc limit 20`;
  return { release: rel ? { version: rel.version, at: rel.made_at } : null, installs: rows.map((r) => ({ ...r, say: SAY[r.step] || r.step,
    stats: typeof r.stats === 'string' ? JSON.parse(r.stats) : r.stats, late: r.status === 'active' && (!r.last_seen || Date.now() - new Date(r.last_seen).getTime() > 3 * 3600e3) })), invites };
}

export async function erpInstallInvite(ctx, payload) {
  await needAdmin(ctx);
  const code = rand(18);
  await ctx.sql`insert into erp_install_invites (code_hash, note, made_by, expires_at) values (${await sha256(code)}, ${str(payload && payload.note).slice(0, 120) || null}, ${ctx.s.userId}, now() + interval '14 days')`;
  return { code, link: str(ctx.deps && ctx.deps.installEnv && ctx.deps.installEnv.appUrl || 'https://erp.costareen.com/') + '#/install/' + code };
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
  return { ok: true, status };
}

export async function erpInstallRetry(ctx, payload) {
  await needAdmin(ctx);
  const r = await ctx.sql`update erp_installs set status = 'installing', error = null, updated_at = now() where id = ${str(payload && payload.id)}::uuid and status = 'failed' returning id`;
  if (!r.length) throw new Error('Only a failed install can carry on.');
  return { ok: true };
}

export const HANDLERS = { erpInstalls, erpInstallInvite, erpInstallSet, erpInstallRetry };
