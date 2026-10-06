// The bridge (docs/PLATFORM-BLUEPRINT.md section 2): the provider's server runs every company's ERP;
// a company's own Supabase holds only its data, files and logins. For each company the provider keeps
// its project address, public key and - encrypted - its database URL and service key (erp_tenants).
//
//   sealJSON(key, obj) / openJSON(key, text)   AES-GCM with the provider's ERP_BRIDGE_KEY (base64, 32 bytes)
//   connectProject(deps, token, ref)           sets a new database password through Supabase's Management API
//                                              and returns { url, anon, service, dbUrl } for the company
//   saveTenant(sql, key, id, conn)             stores (or replaces) a company's bridge
//   tenantSource(sql, key, build, ttlMs)       -> get(id): the company's deps, built once and kept a while;
//                                              throws Locked when the company is not active

const MGMT = 'https://api.supabase.com/v1';
const str = (v) => String(v == null ? '' : v).trim();
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export class Locked extends Error {}
export const LOCK_SAY = {
  disconnected: 'This ERP lost its connection to the provider. The owner can reconnect it from the install page; until then it cannot be used.',
  locked: 'This ERP is switched off by its provider.',
  unknown: 'This ERP is not known here.',
};

async function aesKey(keyB64) {
  const raw = unb64(str(keyB64));
  if (raw.length !== 32) throw new Error('ERP_BRIDGE_KEY must be 32 bytes (base64).');
  return crypto.subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
}
export async function sealJSON(keyB64, obj) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(keyB64), new TextEncoder().encode(JSON.stringify(obj)));
  return 'v1.' + b64(iv) + '.' + b64(ct);
}
export async function openJSON(keyB64, text) {
  const [v, iv, ct] = str(text).split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('Unknown sealed value.');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, await aesKey(keyB64), unb64(ct));
  return JSON.parse(new TextDecoder().decode(pt));
}

function randPw(n = 30) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return b64(a).replace(/\+/g, 'A').replace(/\//g, 'B').replace(/=+$/, '');
}
async function mgmt(deps, token, method, path, body) {
  const OPTS = {
    method, headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
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
  if (r.status === 401 || r.status === 403) throw new Error('Supabase refused the access token (' + r.status + ').');
  if (r.status >= 300) throw new Error('Supabase answered ' + r.status + ': ' + str((json && (json.message || json.error)) || text).slice(0, 200));
  return json;
}

/** A fresh database password for the company's project (only the provider's server knows it), and its keys. */
export async function connectProject(deps, token, ref) {
  const keys = (await mgmt(deps, token, 'GET', '/projects/' + ref + '/api-keys?reveal=true')) || [];
  const anon = str((keys.find((k) => k.name === 'anon') || {}).api_key);
  const service = str((keys.find((k) => k.name === 'service_role') || {}).api_key);
  if (!anon || !service) throw new Error('Supabase did not give the project keys.');
  const pc = await mgmt(deps, token, 'GET', '/projects/' + ref + '/config/database/pooler');
  const p = Array.isArray(pc) ? (pc.find((x) => x.database_type === 'PRIMARY') || pc[0]) : pc;
  const host = str(p && p.db_host), port = Number(p && p.db_port) || 6543;
  if (!host) throw new Error('Supabase did not give the database address.');
  const pw = randPw();
  await mgmt(deps, token, 'PATCH', '/projects/' + ref + '/database/password', { password: pw });
  const dbUrl = 'postgresql://postgres.' + ref + ':' + encodeURIComponent(pw) + '@' + host + ':' + port + '/postgres';
  return { url: 'https://' + ref + '.supabase.co', anon, service, dbUrl };
}

export async function saveTenant(sql, key, id, conn) {
  const sealed = await sealJSON(key, { dbUrl: conn.dbUrl, service: conn.service });
  await sql`insert into erp_tenants (id, status, url, anon_key, secret_enc, reason, checked_at, check_error)
            values (${id}, 'active', ${conn.url}, ${conn.anon}, ${sealed}, null, now(), null)
            on conflict (id) do update set status = 'active', url = excluded.url, anon_key = excluded.anon_key,
              secret_enc = excluded.secret_enc, reason = null, checked_at = now(), check_error = null`;
}

/** The company's working parts, built once (connections are expensive) and kept for ttlMs. */
export function tenantSource(sql, key, build, ttlMs = 5 * 60e3) {
  const cache = new Map();
  async function get(id, opts) {
    id = str(id);
    const any = !!(opts && opts.any);                       // the compliance view: a switched-off company too
    const hit = cache.get(id);
    if (hit && Date.now() - hit.at < ttlMs && (!hit.locked || !any)) { if (hit.locked) throw new Locked(hit.locked); return hit.deps; }
    const row = (await sql`select t.id, t.status, t.url, t.anon_key, t.secret_enc, t.reason, i.domain, i.company
                           from erp_tenants t left join erp_installs i on i.id = t.id where t.id::text = ${id}`)[0];
    if (!row) throw new Locked(LOCK_SAY.unknown);
    if (row.status !== 'active' && !(any && row.status === 'locked')) {
      const say = row.status === 'locked' ? LOCK_SAY.locked + (row.reason ? ' ' + row.reason : '') : LOCK_SAY.disconnected;
      cache.set(id, { at: Date.now(), locked: say });
      throw new Locked(say);
    }
    const secret = await openJSON(key, row.secret_enc);
    if (hit && hit.deps && hit.deps.close) { try { hit.deps.close(); } catch (_) { /* old pool */ } }
    const deps = await build({ id: row.id, url: row.url, anon: row.anon_key, service: secret.service, dbUrl: secret.dbUrl,
                               domain: str(row.domain), company: str(row.company) });
    if (row.status === 'active') cache.set(id, { at: Date.now(), deps });   // a locked company's parts are not kept
    return deps;
  }
  get.forget = (id) => { const h = cache.get(str(id)); if (h && h.deps && h.deps.close) { try { h.deps.close(); } catch (_) { /* gone */ } } cache.delete(str(id)); };
  return get;
}

/** Can the provider still reach the company's database? (The hourly check; a removed key = disconnected.) */
export async function checkTenant(sql, key, id, tryQuery) {
  const row = (await sql`select id, status, secret_enc from erp_tenants where id = ${id}`)[0];
  if (!row || row.status === 'locked') return row ? row.status : 'unknown';
  let err = '', got = null;
  try { const s = await openJSON(key, row.secret_enc); got = await tryQuery(s.dbUrl); } catch (e) { err = str((e && e.message) || e).slice(0, 300); }
  const status = err ? 'disconnected' : 'active';
  await sql`update erp_tenants set status = ${status}, checked_at = now(), check_error = ${err || null} where id = ${id}`;
  // what the check read over the bridge (usage figures) is what the provider's list shows
  if (!err && got && typeof got === 'object') await sql`update erp_installs set stats = ${sql.json(got)}, last_seen = now() where id = ${id}`;
  return status;
}
