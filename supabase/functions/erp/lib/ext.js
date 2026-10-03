// Everything that leaves the database: secrets, outside HTTP, files, PDFs.
// Handlers call these, never fetch()/storage directly, so tests can stand
// in for Steadfast, the website, the PDF renderer and storage
// (deps.fetch / deps.storage / deps.renderPdf - see index.ts and the tests).

// ---------------------------------------------------------------- secrets
// business_secrets has RLS with no policy: only the privileged connection
// (ctx.sql) reads it. A secret is never put in a handler's return value.

export async function getSecret(ctx, key) {
  const r = await ctx.sql`select value from business_secrets
                          where business_id = ${ctx.biz} and key = ${key}`;
  return r[0] ? r[0].value : '';
}

export async function setSecret(ctx, key, value) {
  if (value === null || value === undefined || value === '') {
    await ctx.sql`delete from business_secrets where business_id = ${ctx.biz} and key = ${key}`;
    return;
  }
  await ctx.sql`insert into business_secrets (business_id, key, value) values (${ctx.biz}, ${key}, ${String(value)})
                on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
}

// ----------------------------------------------------------- config (SETTINGS I:J)

export async function getConfig(ctx, key, fallback = '') {
  const r = await ctx.tx`select value from business_config where business_id = ${ctx.biz} and key = ${key}`;
  return r[0] && r[0].value !== null ? r[0].value : fallback;
}

export async function setConfig(ctx, key, value) {
  await ctx.tx`insert into business_config (business_id, key, value) values (${ctx.biz}, ${key}, ${String(value ?? '')})
               on conflict (business_id, key) do update set value = excluded.value, updated_at = now()`;
}

// ------------------------------------------------------------------- http
/**
 * UrlFetchApp.fetch with muteHttpExceptions: always resolves to
 * { code, text, json } (code 0 when the host could not be reached).
 */
export async function httpFetch(ctx, url, opts = {}) {
  const f = (ctx.deps && ctx.deps.fetch) || globalThis.fetch;
  try {
    const res = await f(url, {
      method: opts.method || 'GET',
      headers: opts.headers || {},
      body: opts.body === undefined ? undefined
        : (typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body)),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { code: res.status, text, json };
  } catch (e) {
    return { code: 0, text: String((e && e.message) || e), json: null };
  }
}

// ------------------------------------------------------------------ files
/**
 * Save a file for this business (was: a Drive folder). `folder` is the old
 * Drive folder's role: 'invoices', 'assets', 'exports', 'backups'.
 * Returns { id, name, url } - url is a link the browser can open.
 */
export async function saveFile(ctx, folder, name, bytes, mime) {
  if (!ctx.deps || !ctx.deps.storage) throw new Error('File storage is not available.');
  const out = await ctx.deps.storage.save(ctx.biz, folder, name, bytes, mime);
  // a copy for the owner's Google Drive, when it is connected (handlers/google.js); never the reason a save fails
  try { const g = await import('../handlers/google.js'); await g.driveEnqueue(ctx, folder, name, mime); } catch (_) { /* no Drive copy this time */ }
  return out;
}

/** Find this business's files whose name contains `part` (newest first). */
export async function findFiles(ctx, folder, part) {
  if (!ctx.deps || !ctx.deps.storage) return [];
  return ctx.deps.storage.find(ctx.biz, folder, part);
}

export async function deleteFile(ctx, folder, name) {
  if (ctx.deps && ctx.deps.storage) await ctx.deps.storage.remove(ctx.biz, folder, name);
}

/** A fresh link to a stored file (links expire; ids do not). */
export async function fileUrl(ctx, folder, name) {
  if (!ctx.deps || !ctx.deps.storage) return '';
  return ctx.deps.storage.url(ctx.biz, folder, name);
}

/** Read a stored file's bytes (logo, QR, signature) - Uint8Array or null. */
export async function readFile(ctx, folder, name) {
  if (!ctx.deps || !ctx.deps.storage) return null;
  return ctx.deps.storage.read(ctx.biz, folder, name);
}

// -------------------------------------------------------------------- pdf
/**
 * HTML -> PDF bytes. Was: the render service on the office server for the
 * designed invoice, and Drive's HTML converter for everything else; the web
 * app uses the render service for all of them (deps.renderPdf).
 * opts.footer = HTML repeated at the foot of every page (designed invoice).
 */
export async function renderPdf(ctx, html, opts = {}) {
  if (!ctx.deps || !ctx.deps.renderPdf) throw new Error('The PDF service is not available.');
  return ctx.deps.renderPdf(html, opts);
}
