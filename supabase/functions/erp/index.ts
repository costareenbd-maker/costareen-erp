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
import { shopDoor } from './handlers/shop.js';
import { installRoute } from './handlers/installer.js';
import { installFinish } from './lib/control.js';
import postgres from 'npm:postgres@3.4.5';
import { connect } from './db.js';
import { erpCall } from './core.js';
import { runJob, runHook, asBusiness, owners } from './jobs.js';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL') ?? '';
const ANON = Deno.env.get('SUPABASE_ANON_KEY') ?? '';
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
const RENDER_URL = (Deno.env.get('RENDER_URL') ?? '').replace(/\/+$/, '');
const RENDER_KEY = Deno.env.get('RENDER_KEY') ?? '';
const CRON_KEY = Deno.env.get('CRON_KEY') ?? '';
const SMTP_NOTE = Deno.env.get('ERP_SMTP_NOTE') ?? '';
const GOOGLE = { clientId: Deno.env.get('GOOGLE_CLIENT_ID') ?? '', clientSecret: Deno.env.get('GOOGLE_CLIENT_SECRET') ?? '',
                 redirect: SUPABASE_URL + '/functions/v1/erp?google=back', appUrl: Deno.env.get('ERP_APP_URL') ?? 'https://erp.costareen.com/' };   // set by deploy/set_smtp.py when a real mail service is in use   // pg_cron sends it as x-erp-cron
const BUCKET = 'erp-files';
const sql = connect(postgres, Deno.env.get('SUPABASE_DB_URL') ?? '');
// a second, small pool for side-queries made from inside a transaction (see core.js)
const sqlAux = connect(postgres, Deno.env.get('SUPABASE_DB_URL') ?? '', { max: 2 });

const ALLOWED_ORIGINS = [
  'https://erp.costareen.com',
  'http://localhost:8793',
  'http://127.0.0.1:8793',
];

function cors(origin: string | null) {
  const ok = origin && (ALLOWED_ORIGINS.includes(origin) || /^https:\/\/([a-z0-9]+\.)?costareen-erp\.pages\.dev$/.test(origin));
  return {
    'Access-Control-Allow-Origin': ok ? origin! : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-erp-session, x-region',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  };
}

/** One claim of a token Supabase Auth has just accepted (so it is not verified again here). */
function jwtClaim(token: string, key: string): string {
  try {
    const part = token.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const json = JSON.parse(atob(part + '==='.slice((part.length + 3) % 4)));
    return String(json[key] ?? '');
  } catch (_) { return ''; }
}

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
      body: JSON.stringify({ prefix: `${biz}/${folder}/`, search: part, limit: 100,
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
async function sendReset(email: string) {
  const r = await fetch(SUPABASE_URL + '/auth/v1/recover?redirect_to=' + encodeURIComponent('https://erp.costareen.com/'), {
    method: 'POST',
    headers: { apikey: ANON, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email }),
  });
  if (!r.ok) throw new Error('mail ' + r.status);
}

// sign-in by e-mail + password is on again (per-person users); access keys still work for machines and old links
// a company's own copy knows who it is and where its provider is (set by the installer); the provider's system has none of these
const INSTALL = { id: Deno.env.get('ERP_INSTALL_ID') ?? '', key: Deno.env.get('ERP_INSTALL_KEY') ?? '', controlUrl: Deno.env.get('ERP_CONTROL_URL') ?? '', version: Deno.env.get('ERP_RELEASE') ?? '' };
const INSTALL_ENV = { controlUrl: SUPABASE_URL + '/functions/v1/erp', appUrl: Deno.env.get('ERP_APP_URL') ?? 'https://erp.costareen.com/', renderUrl: RENDER_URL, renderKey: RENDER_KEY };
const deps = { install: INSTALL, installEnv: INSTALL_ENV, google: GOOGLE, smtpNote: SMTP_NOTE, linkOnly: false, sql, sqlAux, verifyUser, fetch: globalThis.fetch.bind(globalThis), storage, renderPdf, createAuthUser,
               createOwner, removeUser, sendReset,
               hookBase: SUPABASE_URL + '/functions/v1/erp' };

Deno.serve(async (req) => {
  const headers = { ...cors(req.headers.get('origin')), 'Content-Type': 'application/json' };
  if (req.method === 'OPTIONS') return new Response('ok', { headers });
  // Google sends the owner back here after they allow Drive access (handlers/google.js)
  if (req.method === 'GET' && new URL(req.url).searchParams.get('google') === 'back') {
    const q = Object.fromEntries(new URL(req.url).searchParams.entries());
    let to = GOOGLE.appUrl + '#/settings?google=failed';
    try { to = await googleCallback(deps, q); } catch (_) { /* told as failed */ }
    return new Response(null, { status: 302, headers: { Location: to } });
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
      const r = await installRoute(deps, req);
      return new Response(JSON.stringify(r.body), { status: r.status, headers });
    }
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
    try {
      return new Response(JSON.stringify({ ok: true, result: await runJob(deps, String(body.job)) }), { headers });
    } catch (e) {
      return new Response(JSON.stringify({ ok: false, error: String((e as Error).message || e) }), { headers });
    }
  }

  const out = await erpCall(deps, {
    name: body.name,
    args: body.args,
    token: body.token,
    authHeader: req.headers.get('x-erp-session') || '',
    // the caller's internet address, for limiting wrong-code guessing
    ip: (req.headers.get('cf-connecting-ip') || (req.headers.get('x-forwarded-for') || '').split(',')[0] || '').trim(),
  });
  return new Response(JSON.stringify(out), { headers });
});
