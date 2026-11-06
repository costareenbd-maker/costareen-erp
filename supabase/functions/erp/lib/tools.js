// tooldoor-1 (6 Nov 2026, apps-_index.md T1): the one door from the ERP function to the open-source apps on the server.
// "The app is the engine, the ERP is the screen" (owner D21): screens call these, the function talks to each app's API
// server-side over the internal Docker network `brand-api` (D22), and the app's own UI stays an "open full app" link.
//
// Every app is set up PER BUSINESS, so a sold ERP works with the app absent or with its own copy:
//   business_config  tool_url_<tool>    where the function reaches the app (e.g. http://brand-shlink:8080)
//   business_config  tool_open_<tool>   the app's own full screen for the owner (e.g. https://links.costareen.com)
//   business_config  tool_short_shlink  Shlink only: the short links' domain (e.g. go.costareen.com)
//   business_secrets TOOL_<TOOL>_KEY    the app's key (never read back to the page)
//
//   TOOLS                                 the apps the ERP can talk to, with their health path and key header
//   toolConf(ctx, tool)                   {url, open, keySet} - nothing secret
//   toolCall(ctx, tool, path, opts)       one call: {method, body (JSON), query, timeoutMs, key: false to send none,
//                                         keyValue to send a key found elsewhere}; returns the JSON (or text) answer and
//                                         throws plain sentences the owner can read
//   toolHealth(ctx, tool)                 {state: 'on'|'down'|'off', version, say} - never throws
import { getConfig, getSecret } from './ext.js';

const str = (v) => String(v == null ? '' : v).trim();
export const TOOL_TIMEOUT_MS = 15000;

// key: 'header' (sent on every call), 'optional' (sent when saved), false (the app has no key)
export const TOOLS = {
  shlink: { name: 'Shlink', health: '/rest/health', keyHeader: 'X-Api-Key', key: 'header', version: (j) => str(j && j.version) },
  openshorts: { name: 'OpenShorts', health: '/health', keyHeader: 'X-Gemini-Key', key: 'optional', version: () => '' },
  opencut: { name: 'OpenCut', health: '/', keyHeader: '', key: false, version: () => '' },
};

export function toolName(tool) { return (TOOLS[tool] || {}).name || tool; }
const where = 'Settings → Connections → Tools';

/** Is this an address the function may call: http(s), a host, no user:password inside. */
export function okToolUrl(u) {
  let x; try { x = new URL(str(u)); } catch (_) { return false; }
  return (x.protocol === 'http:' || x.protocol === 'https:') && !!x.hostname && !x.username && !x.password;
}

export async function toolConf(ctx, tool) {
  if (!TOOLS[tool]) throw new Error('That app is not one the ERP knows.');
  const url = str(await getConfig(ctx, 'tool_url_' + tool, '')).replace(/\/+$/, '');
  const open = str(await getConfig(ctx, 'tool_open_' + tool, ''));
  const keySet = TOOLS[tool].key ? !!(await getSecret(ctx, 'TOOL_' + tool.toUpperCase() + '_KEY')) : false;
  return { url, open, keySet };
}

function timeout(ms) {
  let t; const p = new Promise((_, no) => { t = setTimeout(() => no(Object.assign(new Error('timeout'), { timeout: true })), ms); });
  return { p, stop: () => clearTimeout(t) };
}

export async function toolCall(ctx, tool, path, opts = {}) {
  const T = TOOLS[tool];
  if (!T) throw new Error('That app is not one the ERP knows.');
  const nm = T.name;
  const url = str(await getConfig(ctx, 'tool_url_' + tool, '')).replace(/\/+$/, '');
  if (!url) throw new Error(nm + ' is not connected yet: add its address under ' + where + '.');
  if (!okToolUrl(url)) throw new Error(nm + '’s address is not a web address: fix it under ' + where + '.');
  const headers = { Accept: 'application/json' };
  if (T.key && opts.key !== false) {
    const k = str(opts.keyValue) || await getSecret(ctx, 'TOOL_' + tool.toUpperCase() + '_KEY');
    if (k) headers[T.keyHeader] = k;
    else if (T.key === 'header') throw new Error(nm + ' needs its key: paste it under ' + where + '.');
  }
  let body;
  if (opts.body !== undefined) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(opts.body); }
  let q = '';
  if (opts.query) {
    const sp = new URLSearchParams();
    for (const [k, v] of Object.entries(opts.query)) for (const one of (Array.isArray(v) ? v : [v])) if (one !== undefined && one !== null && one !== '') sp.append(k, String(one));
    q = sp.toString(); if (q) q = (path.includes('?') ? '&' : '?') + q;
  }
  const ms = Number(opts.timeoutMs || (ctx.deps && ctx.deps.toolTimeoutMs) || TOOL_TIMEOUT_MS);
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  const tm = timeout(ms);
  let r, text;
  try {
    let signal; try { signal = AbortSignal.timeout(ms); } catch (_) { signal = undefined; }
    r = await Promise.race([f(url + path + q, { method: opts.method || (body !== undefined ? 'POST' : 'GET'), headers, body, signal }), tm.p]);
    text = await Promise.race([r.text(), tm.p]);
  } catch (e) {
    if (e && (e.timeout || e.name === 'TimeoutError' || e.name === 'AbortError')) throw new Error(nm + ' did not answer in ' + Math.round(ms / 1000) + ' seconds. Check that the server is on, then try again.');
    throw new Error(nm + ' could not be reached. Check that the server is on and the address under ' + where + ' is right.');
  } finally { tm.stop(); }
  let j = null; try { j = JSON.parse(text); } catch (_) { j = null; }
  if (r.status === 401 || r.status === 403) throw new Error(nm + ' refused the key: paste a new one under ' + where + '.');
  if (!r.ok) {
    const said = str(j && (typeof j.detail === 'string' ? j.detail : j.message || j.error || j.title)).slice(0, 200);
    if (r.status === 404) throw new Error(nm + ' does not know that' + (said ? ': ' + said : '.'));
    throw new Error(nm + ' answered ' + r.status + (said ? ': ' + said : '.'));
  }
  return j !== null ? j : text;
}

/** A small health check for the status dots and the Test button. Never throws. */
export async function toolHealth(ctx, tool, timeoutMs) {
  const T = TOOLS[tool], conf = await toolConf(ctx, tool);
  if (!conf.url) return { state: 'off', version: '', say: T.name + ' is not connected to the ERP yet.' };
  try {
    const j = await toolCall(ctx, tool, T.health, { timeoutMs: timeoutMs || 5000, key: T.key === 'header' ? undefined : false });
    return { state: 'on', version: T.version(j), say: T.name + ' is working.' };
  } catch (e) { return { state: 'down', version: '', say: str(e && e.message) }; }
}
