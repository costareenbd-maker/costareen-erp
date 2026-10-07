// Supabase Edge Function `erp` - the one door every screen calls through.
// Deploy with JWT verification OFF: staff sign in with a code, not a Supabase
// session, so this function checks every caller itself (core.js).
//
// Environment (Supabase sets the first four; the rest are function secrets):
//   SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, SUPABASE_DB_URL
//   RENDER_URL  - HTML->PDF service, e.g. https://mcp.bendar.duckdns.org/render
//   RENDER_KEY  - its key (header X-Render-Key)
//   CRON_KEY    - shared with deploy/cron.sql; lets the scheduled jobs in

import { googleCallback } from './handlers/google.js';
import { wooKeysCallback } from './handlers/wooauth.js';
import { shopDoor } from './handlers/shop.js';
import { installRoute } from './handlers/installer.js';
import { pubRoute } from './handlers/passport.js';
import { signinRoute } from './handlers/signin.js';
import { installFinish, copyStats } from './lib/control.js';
import postgres from 'npm:postgres@3.4.5';
import { connect } from './db.js';
import { erpCall } from './core.js';
import { runJob, runHook, asBusiness, owners } from './jobs.js';
import { tenantSource, Locked, checkTenant } from './lib/bridge.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RENDER_URL = (Deno.env.get('RENDER_URL') ?? '').replace(/\/+$/, '');
const RENDER_KEY = Deno.env.get('RENDER_KEY') ?? '';
// the provider's AI reader for photos of supplier documents (handlers/receivefile.js); empty = photos read on the device only
const GEMINI_KEY = Deno.env.get('ERP_GEMINI_KEY') ?? '';
const CRON_KEY = Deno.env.get('CRON_KEY') ?? '';
// the bridge (lib/bridge.js): seals each company's database URL and service key in erp_tenants
const BRIDGE_KEY = Deno.env.get('ERP_BRIDGE_KEY') ?? '';
const FN_URL = SUPABASE_URL + '/functions/v1/erp';
const SMTP_NOTE = Deno.env.get('ERP_SMTP_NOTE') ?? '';
const GOOGLE = { clientId: Deno.env.get('GOOGLE_CLIENT_ID') ?? '', clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
                 redirect: SUPABASE_URL + '/functions/v1/erp?google=back', appUrl: Deno.env.get('ERP_APP_URL') ?? 'https://erp.costareen.com/' };   // set by deploy/set_smtp.py when a real mail service is in use   // pg_cron sends it as x-erp-cron
const BUCKET = 'erp-files';
// Through Supabase's connection pooler (transaction mode) when its host is set: a direct
// connection per running copy of this server ran the database out of connection slots
// ("remaining connection slots are reserved..."). Same user and password, pooler host, port 6543.
function poolUrl(direct: string): string {
  const host = Deno.env.get('ERP_POOL_HOST') ?? '';
  const ref = (/^https:\/\/([a-z0-9]+)\.supabase\.co/.exec(SUPABASE_URL) || [])[1] || '';
  if (!host || !ref || !direct) return direct;
  try {
    const u = new URL(direct);
    u.username = 'postgres.' + ref; u.hostname = host; u.port = '6543';
    return u.toString();
  } catch (_) { return direct; }
}
const DB_URL = poolUrl(Deno.env.get('SUPABASE_DB_URL') ?? '');
const sql = connect(postgres, DB_URL);
// a second, small pool for side-queries made from inside a transaction (see core.js)
const sqlAux = connect(postgres, DB_URL, { max: 1 });
// the provider's control tables (the market): their own pool, so a call that holds a business transaction on
// `sql` never waits for a second `sql` connection (two calls at once would each wait for the other)
const ctlSql = connect(postgres, DB_URL, { max: 2 });

const BUSY_DB = /EMAXCONN|max client connections|too many clients|remaining connection slots/i;

const ALLOWED_ORIGINS = [
  'https://erp.costareen.com',
  'http://localhost:8793',
  'http://127.0.0.1:8793',
];

// the page's own address (a company copy's ERP_APP_URL, the provider's public copy ERP_PUBLIC_URL) is always allowed
const OWN_ORIGINS = [Deno.env.get('ERP_APP_URL'), Deno.env.get('ERP_PUBLIC_URL')]
  .map((u) => { try { return u ? new URL(u).origin : ''; } catch (_) { return ''; } }).filter(Boolean);

// open: the public installer routes (no sign-in, nothing private) answer any page, wherever the install link was opened
function cors(origin: string | null, open = false) {
  const ok = origin && (open || ALLOWED_ORIGINS.includes(origin) || OWN_ORIGINS.includes(origin) ||
    /^https:\/\/([a-z0-9-]+\.)?(costareen-erp|office-erp)\.pages\.dev$/.test(origin) || inFreeZone(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-erp-session, x-region, x-erp-tenant',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Vary': 'Origin',
  };
}

// Stage 1e: a company's ERP answers only pages served from the provider's addresses (or the company's own domain).
// A browser always sends Origin and a page cannot change it, so a copy of the page put up elsewhere stops working.
// No Origin (server-to-server, the timers) is let through: those calls still need a valid sign-in or key.
const FREE_ZONE = (Deno.env.get('ERP_FREE_ZONE') ?? '').toLowerCase();
// a copy on the free address <company>.<zone> (https only); its page must be answered by the browser too (CORS)
function inFreeZone(origin: string): boolean {
  try { const u = new URL(origin); const h = u.hostname.toLowerCase(); return !!FREE_ZONE && u.protocol === 'https:' && (h === FREE_ZONE || h.endsWith('.' + FREE_ZONE)); } catch (_) { return false; }
}
function pageAllowed(origin: string | null, domain: string): boolean {
  if (!origin) return true;
  // https only: a copy run on someone's own computer (localhost) is refused too
  if ((ALLOWED_ORIGINS.includes(origin) || OWN_ORIGINS.includes(origin)) && origin.startsWith('https://')) return true;
  if (/^https:\/\/([a-z0-9-]+\.)?(costareen-erp|office-erp)\.pages\.dev$/.test(origin)) return true;
  let host = '';
  try { const u = new URL(origin); if (u.protocol !== 'https:') return false; host = u.hostname.toLowerCase(); } catch (_) { return false; }
  if (FREE_ZONE && (host === FREE_ZONE || host.endsWith('.' + FREE_ZONE))) return true;
  return !!domain && host === domain.toLowerCase();
}
const NOT_LICENSED = 'This ERP page is not licensed at this address. Open your ERP from its own link.';

/** One claim of a token Supabase Auth has just accepted (so it is not verified again here). */
function jwtClaim(token: string, key: string): string {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(part + '==='.slice((part.length + 3) % 4)));
    return String(json[key] ?? '');
  } catch (_) { return ''; }
}

// ------------------------------------------------------------- one project's parts
// The provider's own project, or a company's (the bridge): sign-in, files, logins and e-mailed links
// all talk to that project. The same ERP code then runs against whichever company is calling.
type Project = { url: string; anon: string; service: string; appUrl: string };

function projectParts(p: Project) {
  const SUPABASE_URL = p.url, ANON = p.anon, SERVICE = p.service;
/** A Supabase session -> its user id, or null. Asked of Supabase Auth itself. */
  async function verifyUser(authHeader: string): Promise<string | null> {
    const m = /^Bearer\s+(.+)$/i.exec(authHeader || '');
    if (!m || m[1] === ANON) return null;
    try {
      const r = await fetch(SUPABASE_URL + '/auth/v1/user', {
        headers: { Authorization: 'Bearer ' + m[1], apikey: ANON },
      });
      if (!r.ok) return null;
      const u = await r.json();
      if (!u || !u.id) return null;
      // An owner who has switched on the second step is only let in by a session
      // that has passed it (aal2). The password alone is not enough.
      const twoStep = Array.isArray(u.factors) && u.factors.some((f: any) => f && f.status === 'verified');
      if (twoStep && jwtClaim(m[1], 'aal') !== 'aal2') return null;
      return String(u.id);
    } catch (_) {
      return null;
    }
  }
  
  // ------------------------------------------------------------ file storage
  // One private bucket; every file lives under <business id>/<folder>/<name>,
  // so one business can never be handed another's file. Links are signed
  // and expire after a week (the page asks again when it needs one).
  
  const svc = { Authorization: 'Bearer ' + SERVICE, apikey: SERVICE };
  const enc = (p: string) => p.split('/').map(encodeURIComponent).join('/');
  
  const storage = {
    async save(biz: string, folder: string, name: string, bytes: Uint8Array, mime: string) {
      const path = `${biz}/${folder}/${name}`;
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${enc(path)}`, {
        method: 'POST',
        headers: { ...svc, 'Content-Type': mime || 'application/octet-stream', 'x-upsert': 'true' },
        body: bytes,
      });
      if (!r.ok) throw new Error('The file could not be saved (' + r.status + ').');
      return { id: `${folder}/${name}`, name, url: await storage.url(biz, folder, name) };
    },
    async url(biz: string, folder: string, name: string) {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/sign/${BUCKET}/${enc(`${biz}/${folder}/${name}`)}`, {
        method: 'POST',
        headers: { ...svc, 'Content-Type': 'application/json' },
        body: JSON.stringify({ expiresIn: 7 * 24 * 3600 }),
      });
      if (!r.ok) return '';
      const j = await r.json();
      return j.signedURL ? SUPABASE_URL + '/storage/v1' + j.signedURL : '';
    },
    async find(biz: string, folder: string, part: string) {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/list/${BUCKET}`, {
        method: 'POST',
        headers: { ...svc, 'Content-Type': 'application/json' },
        // no `search`: Storage now matches it against the START of the name only, and our names
        // ("Costareen - backup 2026-10-06 0300.json") carry the part in the middle - filtered below instead
        body: JSON.stringify({ prefix: `${biz}/${folder}/`, limit: 100,
                               sortBy: { column: 'created_at', order: 'desc' } }),
      });
      if (!r.ok) return [];
      const list = await r.json();
      const out = [];
      for (const f of list || []) {
        if (!f || !f.name || !String(f.name).includes(part)) continue;
        out.push({ id: `${folder}/${f.name}`, name: f.name, url: await storage.url(biz, folder, f.name) });
      }
      return out;
    },
    // Stage N7: the browser uploads a file straight into the bucket with a one-time signed address
    async signUpload(biz: string, folder: string, name: string) {
      const path = `${biz}/${folder}/${name}`;
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/upload/sign/${BUCKET}/${enc(path)}`, { method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' }, body: '{}' });
      if (!r.ok) throw new Error('The upload could not be prepared (' + r.status + ').');
      const j = await r.json();
      return { url: SUPABASE_URL + '/storage/v1' + j.url, token: j.token, path: `${folder}/${name}` };
    },
    async remove(biz: string, folder: string, name: string) {
      await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}`, {
        method: 'DELETE',
        headers: { ...svc, 'Content-Type': 'application/json' },
        body: JSON.stringify({ prefixes: [`${biz}/${folder}/${name}`] }),
      });
    },
    async read(biz: string, folder: string, name: string) {
      const r = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${enc(`${biz}/${folder}/${name}`)}`, { headers: svc });
      if (!r.ok) return null;
      return new Uint8Array(await r.arrayBuffer());
    },
  };

  // ----------------------------------------------------- staff sign-in people
  // A staff member signs in with a code, never a password, but RLS needs them
  // to be a real user. They get an auth user with an address nobody can use.
  
  async function createAuthUser(name: string): Promise<string> {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users', {
      method: 'POST',
      headers: { ...svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: 'p' + crypto.randomUUID().replace(/-/g, '') + '@people.erp.invalid',
        email_confirm: true,
        user_metadata: { full_name: name },
      }),
    });
    const j = await r.json();
    if (!r.ok || !j.id) throw new Error('Could not add the person (' + r.status + ').');
    return String(j.id);
  }
  
  // ------------------------------------------------- a partner company's owner
  // A real login with an e-mail address. No password is set here: the person
  // chooses one from the link they are sent.
  async function createOwner(email: string, name: string): Promise<string> {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/users', {
      method: 'POST',
      headers: { ...svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, email_confirm: true, user_metadata: { full_name: name } }),
    });
    const j = await r.json().catch(() => ({}));
    if (r.status === 422 || /already/i.test(String(j.msg || j.message || j.error_code || ''))) {
      throw new Error('That e-mail already has a login here. They can sign in as Owner and join your pool with the invite code.');
    }
    if (!r.ok || !j.id) throw new Error('Could not create the login (' + r.status + ').');
    return String(j.id);
  }
  async function removeUser(id: string) {
    await fetch(SUPABASE_URL + '/auth/v1/admin/users/' + encodeURIComponent(id), { method: 'DELETE', headers: svc });
  }
  async function sendMagic(email: string, redirectTo: string) {
    const r = await fetch(SUPABASE_URL + '/auth/v1/otp?redirect_to=' + encodeURIComponent(redirectTo), {
      method: 'POST', headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, create_user: false }),
    });
    if (!r.ok) throw new Error('The e-mail could not be sent (' + r.status + ').');
  }

  // where e-mailed links bring a person back: this ERP's own address (a company: its domain, or the shared page with ?use=<id>)
  function appBack(): string {
    const u = p.appUrl || 'https://erp.costareen.com/';
    const m = /^(.*?)#\/use\/([\w-]+)/.exec(u);
    return m ? m[1].replace(/\/?$/, '/') + '?use=' + m[2] : u.replace(/#.*$/, '');
  }
  async function sendReset(email: string) {
    const r = await fetch(SUPABASE_URL + '/auth/v1/recover?redirect_to=' + encodeURIComponent(appBack()), {
      method: 'POST',
      headers: { apikey: ANON, 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    if (!r.ok) throw new Error('mail ' + r.status);
  }
  // the same "choose your password" link, made without an e-mail (the platform admin hands it over, e.g. on WhatsApp)
  async function recoveryLink(email: string) {
    const r = await fetch(SUPABASE_URL + '/auth/v1/admin/generate_link', {
      method: 'POST', headers: { ...svc, 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'recovery', email, redirect_to: appBack() }),
    });
    const j: any = await r.json().catch(() => null);
    const link = j && (j.action_link || (j.properties && j.properties.action_link));
    if (!r.ok || !link) throw new Error('The link could not be made (' + r.status + (j && (j.msg || j.message) ? ': ' + String(j.msg || j.message).slice(0, 120) : '') + ').');
    return String(link);
  }
  return { verifyUser, storage, createAuthUser, createOwner, removeUser, sendMagic, sendReset, recoveryLink };
}

// --------------------------------------------------------------- PDF render

async function renderPdf(html: string, opts: { footer?: string } = {}) {
  if (!RENDER_URL || !RENDER_KEY) throw new Error('The PDF service is not set up yet.');
  const r = await fetch(RENDER_URL + '/pdf', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Render-Key': RENDER_KEY },
    body: JSON.stringify({ html, footer: opts.footer || '' }),
  });
  const bytes = new Uint8Array(await r.arrayBuffer());
  const head = new TextDecoder().decode(bytes.slice(0, 5));
  if (!r.ok || head !== '%PDF-' || bytes.length < 2000) {
    throw new Error('The PDF service did not return a PDF (' + r.status + ').');
  }
  return bytes;
}

// sign-in by e-mail + password is on again (per-person users); access keys still work for machines and old links
// a company's own copy knows who it is and where its provider is (set by the installer); the provider's system has none of these
const INSTALL = { id: Deno.env.get('ERP_INSTALL_ID') ?? '', key: Deno.env.get('ERP_INSTALL_KEY') ?? '', controlUrl: Deno.env.get('ERP_CONTROL_URL') ?? '', version: Deno.env.get('ERP_RELEASE') ?? '' };
const INSTALL_ENV = { controlUrl: SUPABASE_URL + '/functions/v1/erp', appUrl: Deno.env.get('ERP_APP_URL') ?? 'https://erp.costareen.com/', renderUrl: RENDER_URL, renderKey: RENDER_KEY,
  // the neutral address customers see (install links, a copy without its own address), set by deploy/set_installer.py
  publicUrl: Deno.env.get('ERP_PUBLIC_URL') ?? '',
  oauth: { clientId: Deno.env.get('SUPABASE_OAUTH_CLIENT_ID') ?? '', clientSecret: Deno.env.get('SUPABASE_OAUTH_CLIENT_SECRET') ?? '', redirect: SUPABASE_URL + '/functions/v1/erp?install=oauth_back' },
  cloudflare: { token: Deno.env.get('ERP_CF_TOKEN') ?? '', account: Deno.env.get('ERP_CF_ACCOUNT') ?? '', project: Deno.env.get('ERP_PUBLIC_PROJECT') ?? '' },
  // the provider's own domain where each company gets <name>.<zone> by itself (Stage 1b)
  freeZone: Deno.env.get('ERP_FREE_ZONE') ?? '', freeZoneId: Deno.env.get('ERP_FREE_ZONE_ID') ?? '' };
const own = projectParts({ url: SUPABASE_URL, anon: ANON, service: SERVICE, appUrl: Deno.env.get('ERP_APP_URL') ?? 'https://erp.costareen.com/' });
const deps: any = { install: INSTALL, installEnv: INSTALL_ENV, google: GOOGLE, smtpNote: SMTP_NOTE, linkOnly: false, sql, sqlAux, control: ctlSql, fetch: globalThis.fetch.bind(globalThis), renderPdf, geminiKey: GEMINI_KEY,
               ...own, hookBase: FN_URL };

// A company on the bridge: its own database, sign-in, files and e-mails; the provider's logic and PDF service.
// Callbacks (Google, WooCommerce, website door, WhatsApp) carry ?t=<company> so they come back to it.
const PUBLIC_URL = (Deno.env.get('ERP_PUBLIC_URL') ?? '').replace(/\/?$/, '/');
async function buildTenant(t: any) {
  const tsql = connect(postgres, t.dbUrl, { max: 2 });
  const tAux = connect(postgres, t.dbUrl, { max: 1 });
  const appUrl = t.domain ? 'https://' + t.domain + '/' : (PUBLIC_URL || 'https://erp.costareen.com/') + '#/use/' + t.id;
  const parts = projectParts({ url: t.url, anon: t.anon, service: t.service, appUrl });
  const fpHex = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(t.service + '|' + t.dbUrl)))].map((b) => b.toString(16).padStart(2, '0')).join('');
  return {
    providerFingerprint: fpHex.slice(0, 16).toUpperCase().match(/.{4}/g)!.join('-'),
    install: { id: t.id, key: '', controlUrl: '', version: Deno.env.get('ERP_RELEASE') ?? '', bridged: true, domain: String(t.domain || '') },
    installEnv: INSTALL_ENV,
    google: { ...GOOGLE, redirect: FN_URL + '?google=back&t=' + t.id, appUrl },
    // control: the provider's own tables (the market list, joint pools)
    smtpNote: '', linkOnly: false, sql: tsql, sqlAux: tAux, control: ctlSql, fetch: globalThis.fetch.bind(globalThis), renderPdf, geminiKey: GEMINI_KEY,
    ...parts, hookBase: FN_URL + '?t=' + t.id,
    close() { try { tsql.end({ timeout: 2 }); tAux.end({ timeout: 2 }); } catch (_) { /* gone */ } },
  };
}
const tenantDeps: any = BRIDGE_KEY ? tenantSource(sql, BRIDGE_KEY, buildTenant) : null;
if (tenantDeps) { deps.bridgeKey = BRIDGE_KEY; deps.tenantDeps = tenantDeps; }

/** Which company is calling: the page's x-erp-tenant header, or ?t= on a callback. Empty = the provider's own. */
function tenantOf(req: Request, q: URLSearchParams): string {
  const t = (req.headers.get('x-erp-tenant') || q.get('t') || '').trim();
  return /^[0-9a-f-]{36}$/i.test(t) ? t : '';
}

/** The hourly health check: can the provider still reach each company? (A removed key locks its ERP.) */
async function checkOne(id: string) {
  const st = await checkTenant(sql, BRIDGE_KEY, id, async (url: string) => {
    const c = connect(postgres, url, { max: 1 });
    try { await c`select 1`; return await copyStats(c); } finally { await c.end({ timeout: 2 }); }
  });
  if (st !== 'active') tenantDeps.forget(id);
  return st;
}
async function checkAll() {
  const ids = (await sql`select id from erp_tenants where status <> 'locked'`).map((r: any) => r.id);
  const out: any = {};
  for (const id of ids) out[id] = await checkOne(id);
  return out;
}
if (tenantDeps) deps.checkTenantNow = checkOne;

Deno.serve(async (req) => {
  const q0 = new URL(req.url).searchParams;
  const tid = tenantOf(req, q0);
  // public routes, a company on the bridge, and every company copy (calls carry their own sign-in, never a cookie) answer any page
  const headers = { ...cors(req.headers.get('origin'), !!(tid || q0.get('install') || q0.get('control') || q0.get('signin') || q0.get('pub') || (INSTALL && INSTALL.id))), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  if (tid && !(q0.get('install') || q0.get('control'))) {
    if (!tenantDeps) return new Response(JSON.stringify({ ok: false, error: 'This server does not run company ERPs.' }), { status: 200, headers });
    try {
      const td = await tenantDeps(tid);
      if (!pageAllowed(req.headers.get('origin'), td.install && td.install.domain || '')) {
        return new Response(JSON.stringify({ ok: false, unlicensed: true, error: NOT_LICENSED }), { status: 403, headers });
      }
      return await serveWith(td, req, q0, headers);
    }
    catch (e) {
      if (e instanceof Locked) return new Response(JSON.stringify({ ok: false, locked: true, error: (e as Error).message }), { status: 200, headers });
      return new Response(JSON.stringify({ ok: false, error: 'The ERP server could not reach this company\u2019s database. Try again in a minute.' }), { status: 200, headers });
    }
  }
  return serveWith(deps, req, q0, headers);
});

async function serveWith(deps: any, req: Request, q0: URLSearchParams, headers: any): Promise<Response> {
  // Google sends the owner back here after they allow Drive access (handlers/google.js)
  if (req.method === 'GET' && new URL(req.url).searchParams.get('google') === 'back') {
    const q = Object.fromEntries(new URL(req.url).searchParams.entries());
    let to = deps.google.appUrl + '#/settings?google=failed';
    try { to = await googleCallback(deps, q); } catch (e) { console.error('google callback', e); to += '&why=' + encodeURIComponent(String((e && (e as Error).message) || e).slice(0, 140)); }
    return new Response(null, { status: 302, headers: { Location: to } });
  }
  // WooCommerce sends the shop's keys here after the owner presses Approve on their own site (handlers/wooauth.js)
  if (req.method === 'POST' && new URL(req.url).searchParams.get('woo') === 'keys') {
    let b: any = {}; try { b = await req.json(); } catch (_) { try { b = Object.fromEntries(new URLSearchParams(await req.text())); } catch (_) { b = {}; } }
    try { const r = await wooKeysCallback(deps, b); return new Response(JSON.stringify(r.body), { status: r.status, headers }); }
    catch (e) { console.error('woo keys', e); return new Response('{"ok":false}', { status: 500, headers }); }
  }
  // the sign-in screen, step 1: what this e-mail needs - a password, a first password (the link is e-mailed now), or nothing here
  if (req.method === 'POST' && (q0.get('signin') === 'check' || q0.get('signin') === 'forgot')) {
    let b: any = {}; try { b = await req.json(); } catch (_) { b = {}; }
    return new Response(JSON.stringify(await signinRoute(deps, q0.get('signin'), b)), { status: 200, headers });
  }
  // the installer (handlers/installer.js) and a copy's last install step (lib/control.js)
  {
    const q = new URL(req.url).searchParams;
    if (q.get('install') === 'finish' && req.method === 'POST') {
      let b: any = {}; try { b = await req.json(); } catch (_) { /* empty */ }
      try { const r = await installFinish(deps, req.headers.get('x-install-key') ?? '', b); return new Response(JSON.stringify(r.body), { status: r.status, headers }); }
      catch (e) { return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), { status: 500, headers }); }
    }
    if (q.get('install') || q.get('control')) {
      const r: any = await installRoute(deps, req);   // (a company call never gets here: the router keeps these on the provider's own deps)
      if (r.location) return new Response(null, { status: 302, headers: { Location: r.location } });
      return new Response(JSON.stringify(r.body), { status: r.status, headers });
    }
  }
  // the public pages (handlers/passport.js): ?pub=check&s=<serial> (the register), ?pub=my&t=<token> (a customer's page)
  if (q0.get('pub')) {
    const r: any = await pubRoute(deps, req, { asBusiness, owners, tenantDeps });
    return new Response(JSON.stringify(r.body), { status: r.status, headers });
  }
  // any website (handlers/shop.js): ?shop=ping|stock|order|products with the x-shop-key header
  if (new URL(req.url).searchParams.get('shop')) {
    try {
      const r = await shopDoor(deps, asBusiness, owners, req);
      return new Response(JSON.stringify(r.body), { status: r.status, headers });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), { status: 500, headers });
    }
  }
  if (req.method !== 'POST') return new Response('{"ok":false}', { status: 405, headers });

  let body: any = {};
  try { body = await req.json(); } catch (_) { /* empty */ }

  // WhatsApp STOP replies (Evolution webhook): ?biz=<id>&hook=<word>
  const url = new URL(req.url);
  if (url.searchParams.get('hook')) {
    const q = Object.fromEntries(url.searchParams.entries());
    return new Response(JSON.stringify(await runHook(deps, q, body)), { headers });
  }
  // scheduled jobs (pg_cron): nightly | campaigns | websync
  if (body && body.job) {
    if (!CRON_KEY || req.headers.get('x-erp-cron') !== CRON_KEY) {
      return new Response('{"ok":false}', { status: 403, headers });
    }
    const job = String(body.job);
    const result: any = {};
    try { result.own = await runJob(deps, job); } catch (e) { result.own = { error: String((e as Error).message || e) }; }
    if (deps === (globalThis as any).__ownDeps && tenantDeps) {
      if (job === 'nightly' || job === 'deliveries') { try { result.health = await checkAll(); } catch (e) { result.health = { error: String((e as Error).message || e) }; } }   // every hour
      for (const r of await sql`select id from erp_tenants where status = 'active'`) {
        try { result[r.id] = await runJob(await tenantDeps(r.id), job); } catch (e) { result[r.id] = { error: String((e as Error).message || e) }; }
      }
    }
    return new Response(JSON.stringify({ ok: true, result }), { headers });
  }

  const call = {
    name: body.name,
    args: body.args,
    token: body.token,
    authHeader: req.headers.get('x-erp-session') || '',
    // the caller's internet address, for limiting wrong-code guessing
    ip: (req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim(),
  };
  let out = await erpCall(deps, call);
  // "Database full for a moment" is refused while connecting, before anything ran, so trying
  // again cannot do the work twice. Wait a little and try again instead of showing it.
  for (const wait of [400, 1000, 2000]) {
    if (out.ok || !BUSY_DB.test(String(out.error || ''))) break;
    await new Promise((r) => setTimeout(r, wait + Math.random() * 300));
    out = await erpCall(deps, call);
  }
  if (!out.ok && BUSY_DB.test(String(out.error || ''))) out = { ok: false, error: 'The database is busy for a moment. Try again in a few seconds.' };
  return new Response(JSON.stringify(out), { headers });
}
(globalThis as any).__ownDeps = deps;
