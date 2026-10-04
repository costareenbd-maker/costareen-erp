// Google Drive (044_drive.sql): copies of this business's files in its own Drive.
//
//   erpGoogle()                  connected? which account, the folder, what is waiting / copied / failed
//   erpGoogleStart()             the address to open: Google asks the owner to allow access
//   erpGoogleDisconnect()        stop, and tell Google to forget the permission
//   erpGoogleCopyAll()           put the files already kept here in the queue too
//   googleCallback(deps, query)  Google sends the owner back here (GET ?google=back) with a code
//   driveTick(ctx)               timer, every 10 minutes: copies what is waiting
//
// Permission asked for: drive.file only - the ERP can see and change the files
// and folders IT made, nothing else in the Drive. Copies are made by a timer
// from a queue (saveFile puts invoices, returns, quotations, receipts, Excel
// exports, notes and backups in it), so a slow or broken Google never slows or
// breaks a sale. Supabase keeps its own copy too; Drive is the owner's copy.

import { formatDate } from '../lib/time.js';
import { getSecret, setSecret, getConfig, setConfig } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const SCOPE = 'https://www.googleapis.com/auth/drive.file openid email';
export const DRIVE_FOLDERS = { invoices: 1, backups: 1, quotes: 1, receipts: 1, exports: 1, notes: 1 };

function cfg(deps) {
  const g = (deps && deps.google) || {};
  return { id: str(g.clientId), secret: str(g.clientSecret), redirect: str(g.redirect), app: str(g.appUrl) || 'https://erp.costareen.com/' };
}
function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only the owner connects Google.'); }
export async function gfetch(deps, url, opts) {
  const f = (deps && deps.fetch) || globalThis.fetch;
  const r = await f(url, opts);
  const text = await r.text();
  let json = null;
  try { json = JSON.parse(text); } catch (_) { json = null; }
  return { code: r.status, text, json };
}
const form = (o) => Object.keys(o).map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(o[k])).join('&');

export async function erpGoogle(ctx) {
  needOwner(ctx);
  const c = cfg(ctx.deps);
  const connected = !!(await getSecret(ctx, 'GOOGLE_REFRESH'));
  const q = (await ctx.sql`select count(*) filter (where done_at is null and tries < 5)::int as waiting,
                                  count(*) filter (where done_at is not null)::int as copied,
                                  count(*) filter (where done_at is null and tries >= 5)::int as failed,
                                  max(done_at) as last
                           from drive_queue where business_id = ${ctx.biz}`)[0] || {};
  const err = (await ctx.sql`select name, error from drive_queue where business_id = ${ctx.biz} and done_at is null and error is not null order by id desc limit 1`)[0];
  const root = str(await getConfig(ctx, 'google_root', ''));
  return { configured: !!(c.id && c.secret && c.redirect), connected, email: str(await getConfig(ctx, 'google_email', '')),
           since: str(await getConfig(ctx, 'google_since', '')), folderUrl: root ? 'https://drive.google.com/drive/folders/' + root : '',
           waiting: q.waiting || 0, copied: q.copied || 0, failed: q.failed || 0, last: q.last ? formatDate(new Date(q.last), 'd MMM, h:mm a') : '',
           lastError: err ? str(err.name) + ': ' + str(err.error).slice(0, 200) : '' };
}

export async function erpGoogleStart(ctx) {
  needOwner(ctx);
  const c = cfg(ctx.deps);
  if (!c.id || !c.secret || !c.redirect) throw new Error('Google is not set up on this system yet. The system provider sets it once (deploy/set_google.py).');
  const nonce = crypto.randomUUID().replace(/-/g, '');
  await setConfig(ctx, 'google_state', nonce + '|' + (Date.now() + 15 * 60e3) + '|' + ctx.s.userId);
  const url = 'https://accounts.google.com/o/oauth2/v2/auth?' + form({
    client_id: c.id, redirect_uri: c.redirect, response_type: 'code', scope: SCOPE,
    access_type: 'offline', prompt: 'consent', include_granted_scopes: 'true', state: ctx.biz + '.' + nonce });
  return { url };
}

/** Google sends the owner back with ?google=back&code=...&state=<business>.<nonce>. Returns where the browser goes next. */
export async function googleCallback(deps, query) {
  const c = cfg(deps), sql = deps.sql;
  const back = (word) => c.app + '#/settings?google=' + encodeURIComponent(word);
  const st = str(query.state), m = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/i.exec(st);
  if (!m) return back('bad-request');
  const biz = m[1];
  const row = (await sql`select value from business_config where business_id = ${biz} and key = 'google_state'`)[0];
  const [nonce, until] = str(row && row.value).split('|');
  if (!nonce || nonce !== m[2] || Number(until) < Date.now()) return back('expired');
  await sql`delete from business_config where business_id = ${biz} and key = 'google_state'`;          // once only
  if (query.error) return back('refused');
  const t = await gfetch(deps, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ code: str(query.code), client_id: c.id, client_secret: c.secret, redirect_uri: c.redirect, grant_type: 'authorization_code' }) });
  const why = (txt) => sql`insert into business_config (business_id, key, value) values (${biz}, 'google_error', ${txt.slice(0, 300)}) on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
  if (t.code !== 200 || !t.json || !t.json.refresh_token) {
    // keep Google's own words: a wrong secret, a redirect address that does not match, an app not yet allowed...
    const j = t.json || {}, txt = t.code !== 200 ? 'Google said ' + t.code + ': ' + str(j.error) + (j.error_description ? ' - ' + str(j.error_description) : '') : 'Google gave no lasting key (refresh token).';
    await why(txt);
    return back('failed') + '&why=' + encodeURIComponent(txt.slice(0, 140));
  }
  let email = '';
  try { email = str(JSON.parse(atob(String(t.json.id_token || '').split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))).email); } catch (_) { email = ''; }
  const put = (k, v) => sql`insert into business_config (business_id, key, value) values (${biz}, ${k}, ${v}) on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
  await sql`insert into business_secrets (business_id, key, value) values (${biz}, 'GOOGLE_REFRESH', ${t.json.refresh_token})
            on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
  await put('google_email', email);
  await put('google_since', formatDate(new Date(), 'd MMM yyyy'));
  return back('ok');
}

export async function erpGoogleDisconnect(ctx) {
  needOwner(ctx);
  const tok = await getSecret(ctx, 'GOOGLE_REFRESH');
  if (tok) { try { await gfetch(ctx.deps, 'https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ token: tok }) }); } catch (_) { /* forgotten here anyway */ } }
  await setSecret(ctx, 'GOOGLE_REFRESH', '');
  for (const k of ['google_email', 'google_since', 'google_root', 'google_folders']) await setConfig(ctx, k, '');
  await ctx.sql`delete from drive_queue where business_id = ${ctx.biz} and done_at is null`;
  return erpGoogle(ctx);
}

/** Put a stored file in the queue (called by saveFile). */
export async function driveEnqueue(ctx, folder, name, mime) {
  if (!DRIVE_FOLDERS[folder]) return;
  if (ctx.memo.googleOn === undefined) ctx.memo.googleOn = !!(await getSecret(ctx, 'GOOGLE_REFRESH'));
  if (!ctx.memo.googleOn) return;
  await ctx.sql`insert into drive_queue (business_id, folder, name, mime) values (${ctx.biz}, ${folder}, ${name}, ${mime || null})`;
}

export async function erpGoogleCopyAll(ctx) {
  needOwner(ctx);
  if (!(await getSecret(ctx, 'GOOGLE_REFRESH'))) throw new Error('Connect Google first.');
  const have = new Set((await ctx.sql`select folder || '/' || name as k from drive_queue where business_id = ${ctx.biz}`).map((r) => r.k));
  let n = 0;
  for (const folder of Object.keys(DRIVE_FOLDERS)) {
    const list = ctx.deps && ctx.deps.storage ? await ctx.deps.storage.find(ctx.biz, folder, '') : [];
    for (const f of list) {
      if (have.has(folder + '/' + f.name)) continue;
      await ctx.sql`insert into drive_queue (business_id, folder, name) values (${ctx.biz}, ${folder}, ${f.name})`;
      n++;
    }
  }
  return { ...(await erpGoogle(ctx)), queued: n };
}

// ------------------------------------------------------------------ the timer
export async function accessToken(ctx) {
  if (ctx.memo.gAccess) return ctx.memo.gAccess;
  const c = cfg(ctx.deps), rt = await getSecret(ctx, 'GOOGLE_REFRESH');
  const t = await gfetch(ctx.deps, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form({ client_id: c.id, client_secret: c.secret, refresh_token: rt, grant_type: 'refresh_token' }) });
  if (t.code !== 200 || !t.json || !t.json.access_token) {
    if (t.json && t.json.error === 'invalid_grant') throw new Error('Google no longer allows this ERP (the permission was removed). Connect Google again in Settings > Connections.');
    throw new Error('Google did not give access (' + t.code + ').');
  }
  ctx.memo.gAccess = t.json.access_token;
  return ctx.memo.gAccess;
}
export async function folderId(ctx, path) {
  if (!ctx.memo.gFolders) { try { ctx.memo.gFolders = JSON.parse(str(await getConfig(ctx, 'google_folders', '')) || '{}'); } catch (_) { ctx.memo.gFolders = {}; } }
  const known = ctx.memo.gFolders;
  if (known[path]) return known[path];
  const parts = path.split('/'), name = parts.pop(), parent = parts.length ? await folderId(ctx, parts.join('/')) : null;
  const tok = await accessToken(ctx);
  const r = await gfetch(ctx.deps, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, mimeType: 'application/vnd.google-apps.folder', ...(parent ? { parents: [parent] } : {}) }) });
  if (r.code !== 200 || !r.json || !r.json.id) throw new Error('Google Drive would not make the folder "' + name + '" (' + r.code + ').');
  known[path] = r.json.id;
  await setConfig(ctx, 'google_folders', JSON.stringify(known));
  if (!parent) await setConfig(ctx, 'google_root', r.json.id);
  return r.json.id;
}
function placeOf(folder, name, at, biz) {
  const month = formatDate(at, 'yyyy-MM');
  const top = 'ERP - ' + biz;
  if (folder === 'invoices') return top + '/' + (/^Return/i.test(name) ? 'Returns' : /^Statement/i.test(name) ? 'Statements' : 'Invoices') + '/' + month;
  if (folder === 'quotes') return top + '/Quotations/' + month;
  if (folder === 'receipts') return top + '/Expense receipts/' + month;
  if (folder === 'exports') return top + '/Excel exports';
  if (folder === 'notes') return top + '/Notes and files';
  return top + '/Backups';
}
async function upload(ctx, parent, name, mime, bytes) {
  const tok = await accessToken(ctx), b = 'erp' + crypto.randomUUID().replace(/-/g, '');
  const head = new TextEncoder().encode('--' + b + '\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n' + JSON.stringify({ name, parents: [parent] }) +
                                        '\r\n--' + b + '\r\nContent-Type: ' + (mime || 'application/octet-stream') + '\r\n\r\n');
  const tail = new TextEncoder().encode('\r\n--' + b + '--');
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  const r = await gfetch(ctx.deps, 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id', { method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'multipart/related; boundary=' + b }, body });
  if (r.code !== 200 || !r.json || !r.json.id) throw new Error('Google Drive refused the file (' + r.code + ').');
  return r.json.id;
}
const MIME = { pdf: 'application/pdf', json: 'application/json', xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', jpg: 'image/jpeg', png: 'image/png', webp: 'image/webp' };

export async function driveTick(ctx) {
  if (!(await getSecret(ctx, 'GOOGLE_REFRESH'))) return { skipped: 'not connected' };
  const biz = str((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0].name);
  const rows = await ctx.sql`select id, folder, name, mime, created_at from drive_queue where business_id = ${ctx.biz} and done_at is null and tries < 5 order by id limit 25`;
  let copied = 0, failed = 0;
  for (const q of rows) {
    try {
      const bytes = ctx.deps.storage ? await ctx.deps.storage.read(ctx.biz, q.folder, q.name) : null;
      if (!bytes) { await ctx.sql`update drive_queue set tries = 5, error = 'the file is no longer kept here' where id = ${q.id}`; failed++; continue; }
      const parent = await folderId(ctx, placeOf(q.folder, q.name, new Date(q.created_at), biz));
      const ext = (/\.([a-z0-9]+)$/i.exec(q.name) || [])[1] || '';
      const id = await upload(ctx, parent, q.name, q.mime || MIME[ext.toLowerCase()], bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
      await ctx.sql`update drive_queue set done_at = now(), drive_id = ${id}, error = null where id = ${q.id}`;
      copied++;
    } catch (e) {
      failed++;
      await ctx.sql`update drive_queue set tries = tries + 1, error = ${String((e && e.message) || e).slice(0, 300)} where id = ${q.id}`;
      if (/no longer allows/.test(String(e && e.message))) break;                 // nothing else will go either
    }
  }
  return { copied, failed, left: Math.max(0, rows.length - copied - failed) };
}

export const HANDLERS = { erpGoogle, erpGoogleStart, erpGoogleDisconnect, erpGoogleCopyAll };
