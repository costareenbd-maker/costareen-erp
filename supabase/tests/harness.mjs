// Shared setup for every group's server tests (run through erp_server_test.py
// with TEST_SCRIPT=<file>.mjs). Gives you:
//   sql                privileged connection to the throwaway database
//   FIX                { U: {owner,mgr,sales,other}, B, B2 } from the fixture
//   owner/mgr/sales    (name, args) => erpCall result, as that person
//   check / done       assertions and the exit code
//   web                fake outside world: web.on(urlRegex, (url, opts) => ({status, body}))
//   files              fake storage (files.list() to inspect what was saved)
//   pdfs               every HTML sent to the PDF renderer
//
// The fixture (erp_server_test.py) has: business B "Costareen" with owner,
// manager Mehedi (code 111111, device dev-mgr) and sales Rina (222222,
// dev-sales); products FIL-SUN-PLA-BLA-001 (cost 900, sell 1350, stock 7)
// and PRT-BAM-A1-001 (cost 40000, sell 52000, stock 3); customer Karim
// 01712345678; lookups; business B2 belongs to someone else.
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(path.join(process.env.ERP_NODE_CWD || process.cwd(), 'package.json'));
const postgres = require('postgres');
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
export const fnDir = path.join(here, '..', 'functions', 'erp');
const { connect } = await import(pathToFileURL(path.join(fnDir, 'db.js')));
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));

export const FIX = JSON.parse(process.env.FIX);
export const sql = connect(postgres, process.env.DB_URL);
const sqlAux = connect(postgres, process.env.DB_URL, { max: 2 });

// ---- fake outside world ----------------------------------------------------
const routes = [];
export const web = {
  calls: [],
  on(re, fn) { routes.unshift({ re, fn }); },
  reset() { routes.length = 0; this.calls.length = 0; },
};
async function fakeFetch(url, opts = {}) {
  web.calls.push({ url, opts });
  const hit = routes.find((r) => r.re.test(url));
  if (!hit) return new Response('no route for ' + url, { status: 404 });
  const out = await hit.fn(url, opts);
  const body = typeof out.body === 'string' ? out.body : JSON.stringify(out.body ?? {});
  return new Response(body, { status: out.status ?? 200, headers: out.headers || {} });
}

const store = new Map();   // `${biz}/${folder}/${name}` -> {bytes, mime, at}
export const files = {
  list: () => [...store.keys()],
  get: (k) => store.get(k),
};
const storage = {
  async save(biz, folder, name, bytes, mime) {
    store.set(`${biz}/${folder}/${name}`, { bytes, mime, at: Date.now() });
    return { id: `${folder}/${name}`, name, url: `https://files.test/${biz}/${folder}/${encodeURIComponent(name)}` };
  },
  async find(biz, folder, part) {
    return [...store.entries()].filter(([k]) => k.startsWith(`${biz}/${folder}/`) && k.includes(part))
      .sort((a, b) => b[1].at - a[1].at)
      .map(([k]) => { const name = k.split('/').slice(2).join('/'); return { id: `${folder}/${name}`, name, url: `https://files.test/${biz}/${folder}/${encodeURIComponent(name)}` }; });
  },
  async remove(biz, folder, name) { store.delete(`${biz}/${folder}/${name}`); },
  async signUpload(biz, folder, name) { store.set(`${biz}/${folder}/${name}`, { bytes: new Uint8Array(0), mime: 'application/octet-stream', at: Date.now() }); return { url: `https://files.test/upload/${biz}/${folder}/${name}`, token: 'signed', path: `${folder}/${name}` }; },
  async url(biz, folder, name) { return `https://files.test/${biz}/${folder}/${encodeURIComponent(name)}`; },
  async read(biz, folder, name) { const f = store.get(`${biz}/${folder}/${name}`); return f ? f.bytes : null; },
};
export const pdfs = [];
async function renderPdf(html, opts) {
  pdfs.push({ html, opts });
  return new TextEncoder().encode('%PDF-1.4 fake ' + html.length);
}

export const deps = {
  mgmtRetryMs: 0,        // Supabase management API retries: no waiting in tests
  sfRetryMs: 0,          // Steadfast retries: no waiting in tests
  sql,
  sqlAux,
  control: connect(postgres, process.env.DB_URL, { max: 2 }),   // the provider's own tables (market list): same test database, own pool as live
  verifyUser: async (h) => (/^Bearer owner:(.+)$/.exec(h) || [])[1] || null,
  fetch: fakeFetch,
  storage,
  renderPdf,
  mails: [],
  async createOwner(email, name) {
    const had = await sql`select 1 from auth.users where email = ${email}`;
    if (had.length) throw new Error('That e-mail already has a login here. They can sign in as Owner and join your pool with the invite code.');
    const r = await sql`insert into auth.users (id, email, raw_user_meta_data)
                        values (gen_random_uuid(), ${email}, ${sql.json({ full_name: name })}) returning id`;
    return r[0].id;
  },
  async removeUser(id) { await sql`delete from auth.users where id = ${id}`; },
  async sendReset(email) { deps.mails.push(email); },
  resets: [],
  async sendResetTo(email, to) { deps.resets.push({ email, to }); },
  links: [],
  async recoveryLink(email, to) { deps.links.push({ email, to }); return 'https://auth.test/verify?type=recovery&email=' + encodeURIComponent(email) + '&redirect_to=' + encodeURIComponent(to || ''); },
  magic: [],
  async sendMagic(email, to) { deps.magic.push({ email, to }); },
  async createAuthUser(name) {
    const r = await sql`insert into auth.users (id, email, raw_user_meta_data)
                        values (gen_random_uuid(), null, ${sql.json({ full_name: name })}) returning id`;
    return r[0].id;
  },
};

export const call = (name, args, who) => erpCall(deps, { name, args, ...who });
export const owner = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + FIX.U.owner });
export const mgr = (name, args) => erpCall(deps, { name, args, token: { code: '111111', device: 'dev-mgr' } });
export const sales = (name, args) => erpCall(deps, { name, args, token: { code: '222222', device: 'dev-sales' } });
/** A shareholder: makes FIX.U.other a shareholder of B with an approved code 333333. */
export async function makeShareholder() {
  await sql`insert into memberships (business_id, user_id, role) values (${FIX.B}, ${FIX.U.other}, 'shareholder')
            on conflict (business_id, user_id) do update set role = 'shareholder'`;
  await sql`insert into erp_people (user_id, home_business, name, code) values (${FIX.U.other}, ${FIX.B}, 'Shami', '333333')
            on conflict (user_id) do nothing`;
  await sql`insert into erp_devices (device_id, user_id, status) values ('dev-sh', ${FIX.U.other}, 'approved')
            on conflict (device_id, user_id) do nothing`;
  // their own business B2 must not become the active one
  await sql`insert into erp_prefs (user_id, active_business) values (${FIX.U.other}, ${FIX.B})
            on conflict (user_id) do update set active_business = ${FIX.B}`;
}
export const shareholder = (name, args) => erpCall(deps, { name, args, token: { code: '333333', device: 'dev-sh' } });

let fails = 0, passes = 0;
export function check(label, ok, extra) {
  console.log((ok ? 'PASS ' : 'FAIL ') + label +
    (extra !== undefined && !ok ? '  [' + JSON.stringify(extra).slice(0, 400) + ']' : ''));
  if (ok) passes++; else fails++;
}
export async function done() {
  await sql.end();
  await sqlAux.end();
  console.log('\n' + passes + ' passed, ' + fails + ' failure(s)');
  process.exit(fails ? 1 : 0);
}
