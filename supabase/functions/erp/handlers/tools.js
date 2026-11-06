// tooldoor-1 (6 Nov 2026, apps-_index.md T1/T3, B5a, B8a): the ERP screens on top of the open-source apps.
// lib/tools.js is the door; these are the calls the page makes.
//
//   erpTools()                                   owner: every app the ERP talks to, set up or not (nothing secret)
//   erpToolsStatus()                             owner: the same plus a live health check per set-up app (Tools page)
//   erpToolSet({tool, url, open, short?, key, clearKey}) owner, "Only me" app `tooldoor`: an app's address, its full-app
//                                                link and its key (sealed in business_secrets, never shown again)
//   erpToolTest({tool})                          owner, tooldoor: one health call; nothing is changed
//   erpShortLink({url, slug?, network?, post?, sku?})        manager+, tooldoor: one Shlink short link (UTM added)
//   erpShortenText({captions, post?, sku?})      manager+, tooldoor: every long link in each caption -> a short link
//                                                for that network (utm_source=<network>, utm_campaign=post-<id>)
//   erpShortLinks({post?})                       manager+, tooldoor: this business's short links with their clicks
//   erpShortsMake({url, clips?})                 owner, tooldoor: OpenShorts cuts a long video (a link) into shorts
//   erpShortsJobs()                              owner, tooldoor: the last jobs, their state and finished clips
//
// Twenty is not here on purpose (owner D23: retired). OpenCut has no API (projects live in the browser), so it only
// gets a status dot and an "open" link. OpenShorts' own posting (/api/social/post) is never used: one posting path.
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig, getSecret, setSecret } from '../lib/ext.js';
import { TOOLS, toolConf, toolCall, toolHealth, okToolUrl, toolName } from '../lib/tools.js';
import { platformAdmin } from './platform.js';
import { appIsOff } from './apps.js';
import { providerKeys } from '../lib/ai.js';

const str = (v) => String(v == null ? '' : v).trim();
const KEYS = Object.keys(TOOLS);

function owner(ctx) { if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner sets up the apps.'); }
async function door(ctx) {
  if (!(await platformAdmin(ctx)) && await appIsOff(ctx.deps, ctx.sql, 'tooldoor', ctx)) throw new Error('The app door is not open on this ERP yet.');
}
function pick(tool) { const t = str(tool).toLowerCase(); if (!TOOLS[t]) throw new Error('That app is not one the ERP knows.'); return t; }

async function listOf(ctx, live) {
  const out = [];
  for (const k of KEYS) {
    const c = await toolConf(ctx, k);
    const h = live ? await toolHealth(ctx, k, 4000) : { state: c.url ? 'set' : 'off', version: '', say: '' };
    out.push({ key: k, name: TOOLS[k].name, url: c.url, open: c.open, keySet: c.keySet, needsKey: TOOLS[k].key === 'header', takesKey: !!TOOLS[k].key, state: h.state, version: h.version, say: h.say });
  }
  return out;
}

export async function erpTools(ctx) { owner(ctx); return { tools: await listOf(ctx, false) }; }
export async function erpToolsStatus(ctx) { owner(ctx); return { tools: await listOf(ctx, true), at: ctx.now.toISOString() }; }

export async function erpToolSet(ctx, payload) {
  owner(ctx); await door(ctx);
  const p = payload || {}, t = pick(p.tool);
  if (p.url !== undefined) {
    const u = str(p.url).replace(/\/+$/, '');
    if (u && !okToolUrl(u)) throw new Error('The address must start with http:// or https:// and carry no password.');
    await setConfig(ctx, 'tool_url_' + t, u);
  }
  if (p.open !== undefined) {
    const o = str(p.open);
    if (o && !/^https:\/\//.test(o)) throw new Error('The full-app link must start with https://.');
    if (o && !okToolUrl(o)) throw new Error('The full-app link is not a web address.');
    await setConfig(ctx, 'tool_open_' + t, o);
  }
  if (p.short !== undefined && t === 'shlink') {
    const d = str(p.short).replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
    if (d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw new Error('The short-link domain is a plain name like go.example.com.');
    await setConfig(ctx, 'tool_short_shlink', d);
  }
  if (TOOLS[t].key) {
    if (p.clearKey) await setSecret(ctx, 'TOOL_' + t.toUpperCase() + '_KEY', '');
    else if (str(p.key)) {
      const k = str(p.key);
      if (k.length < 8 || /\s/.test(k) || k.length > 400) throw new Error('That does not look like a key: no spaces, at least 8 characters.');
      await setSecret(ctx, 'TOOL_' + t.toUpperCase() + '_KEY', k);
    }
  } else if (str(p.key)) throw new Error(toolName(t) + ' has no key.');
  return erpTools(ctx);
}

export async function erpToolTest(ctx, payload) {
  owner(ctx); await door(ctx);
  const t = pick(payload && payload.tool);
  const h = await toolHealth(ctx, t, 8000);
  return { tool: t, ok: h.state === 'on', state: h.state, version: h.version, say: h.say };
}

// ---------------------------------------------------------------- Shlink: short links (B5a)
const NETS = ['facebook', 'instagram', 'facebookStory', 'instagramStory', 'marketplace', 'whatsapp', 'threads', 'tiktok', 'youtube', 'linkedin', 'x', 'pinterest', 'telegram', 'landing', 'product', 'other'];
const bizTag = (ctx) => 'erp:' + ctx.biz;
function withUtm(long, network, post) {
  let u; try { u = new URL(long); } catch (_) { return long; }
  if (network && !u.searchParams.has('utm_source')) u.searchParams.set('utm_source', network);
  if (network && !u.searchParams.has('utm_medium')) u.searchParams.set('utm_medium', 'social');
  if (post && !u.searchParams.has('utm_campaign')) u.searchParams.set('utm_campaign', 'post-' + post);
  return u.toString();
}
async function shlinkHost(ctx) {
  // the short links' own domain (go.costareen.com): links on it are already short. Shlink itself puts it in shortUrl.
  return str(await getConfig(ctx, 'tool_short_shlink', ''));
}
function shapeLink(x) {
  const tags = (x && x.tags) || [];
  const tag = (p) => { const t = tags.find((y) => String(y).startsWith(p)); return t ? String(t).slice(p.length) : ''; };
  const v = (x && x.visitsSummary) || {};
  return { code: str(x && x.shortCode), short: str(x && x.shortUrl), long: str(x && x.longUrl), clicks: Number(v.nonBots != null ? v.nonBots : v.total) || 0,
           post: tag('post:'), sku: tag('sku:'), network: tag('net:'), at: str(x && x.dateCreated) };
}
async function makeShort(ctx, p) {
  const long0 = str(p.url);
  if (!/^https?:\/\//i.test(long0) || long0.length > 2000) throw new Error('Give a full web link (https://...).');
  try { new URL(long0); } catch (_) { throw new Error('Give a full web link (https://...).'); }
  const network = NETS.includes(str(p.network)) ? str(p.network) : '';
  const post = /^[0-9a-f-]{8,40}$/i.test(str(p.post)) ? str(p.post) : '';
  const sku = str(p.sku).slice(0, 60);
  const slug = str(p.slug).toLowerCase();
  if (slug && !/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/.test(slug)) throw new Error('The short name takes small letters, digits and dashes (3 to 60).');
  const tags = [bizTag(ctx)].concat(post ? ['post:' + post] : [], sku ? ['sku:' + sku] : [], network ? ['net:' + network] : []);
  const body = { longUrl: withUtm(long0, network, post), tags, findIfExists: true, validateUrl: false };
  if (slug) body.customSlug = slug;
  let j;
  try { j = await toolCall(ctx, 'shlink', '/rest/v3/short-urls', { body }); }
  catch (e) { if (/non-unique|already in use|slug/i.test(String(e.message)) && slug) throw new Error('The short name "' + slug + '" is taken. Pick another.'); throw e; }
  return shapeLink(j);
}

export async function erpShortLink(ctx, payload) {
  await door(ctx);
  return { link: await makeShort(ctx, payload || {}) };
}

const LINK_RE = /https?:\/\/[^\s<>"')\]]+/gi;
export async function erpShortenText(ctx, payload) {
  await door(ctx);
  const p = payload || {}, caps = p.captions && typeof p.captions === 'object' ? p.captions : {};
  const host = (await shlinkHost(ctx)).replace(/^https?:\/\//, '').replace(/\/+$/, '').toLowerCase();
  const out = {}, made = [];
  let n = 0;
  for (const net of Object.keys(caps)) {
    let text = String(caps[net] == null ? '' : caps[net]);
    if (text.length > 63000) throw new Error('A caption is too long.');
    const found = Array.from(new Set(text.match(LINK_RE) || [])).map((u) => u.replace(/[.,;:!?]+$/, ''));
    for (const u of found) {
      let h = ''; try { h = new URL(u).hostname.toLowerCase(); } catch (_) { continue; }
      if (host && h === host) continue;                 // already short
      if (++n > 30) throw new Error('Too many links at once (30 at most).');
      const l = await makeShort(ctx, { url: u, network: NETS.includes(net) ? net : 'other', post: p.post, sku: p.sku });
      text = text.split(u).join(l.short);
      made.push({ network: net, long: u, short: l.short });
    }
    out[net] = text;
  }
  return { captions: out, made };
}

export async function erpShortLinks(ctx, payload) {
  await door(ctx);
  const post = str(payload && payload.post);
  const tags = [bizTag(ctx)].concat(/^[0-9a-f-]{8,40}$/i.test(post) ? ['post:' + post] : []);
  const j = await toolCall(ctx, 'shlink', '/rest/v3/short-urls', { query: { 'tags[]': tags, tagsMode: 'all', itemsPerPage: 200, orderBy: 'dateCreated-DESC' } });
  const rows = ((j && j.shortUrls && j.shortUrls.data) || []).map((x) => shapeLink(x));
  return { links: rows };
}

// ---------------------------------------------------------------- OpenShorts: long video -> shorts (B8a, adapter only)
const JOBS_KEY = 'tool_openshorts_jobs';
async function jobsOf(ctx) { try { const v = JSON.parse(str(await getConfig(ctx, JOBS_KEY, '')) || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; } }
async function geminiFor(ctx) {
  const own = await getSecret(ctx, 'TOOL_OPENSHORTS_KEY');
  if (own) return own;
  try { return str((await providerKeys(ctx)).gemini); } catch (_) { return ''; }
}

export async function erpShortsMake(ctx, payload) {
  owner(ctx); await door(ctx);
  const p = payload || {}, url = str(p.url);
  if (!/^https:\/\//i.test(url) || url.length > 1000) throw new Error('Give the long video’s link (https://..., for example a YouTube link).');
  const clips = Math.max(1, Math.min(10, Math.round(Number(p.clips) || 5)));
  const gk = await geminiFor(ctx);
  if (!gk) throw new Error('OpenShorts needs a Gemini key: add one under AI settings, or paste one for OpenShorts under Settings → Connections → Tools.');
  const j = await toolCall(ctx, 'openshorts', '/api/process', { body: { url, target_clips: String(clips) }, keyValue: gk, timeoutMs: 30000 });
  const id = str(j && j.job_id);
  if (!id) throw new Error('OpenShorts took the video but gave no job number. Open the full app to see it.');
  const list = await jobsOf(ctx);
  list.unshift({ id, url, clips, at: ctx.now.toISOString(), by: str((ctx.s && (ctx.s.name || ctx.s.email)) || '') });
  await setConfig(ctx, JOBS_KEY, JSON.stringify(list.slice(0, 20)));
  return { job: { id, status: str(j.status) || 'queued' } };
}

export async function erpShortsJobs(ctx) {
  owner(ctx); await door(ctx);
  const list = (await jobsOf(ctx)).slice(0, 8), open = str(await getConfig(ctx, 'tool_open_openshorts', '')).replace(/\/+$/, '');
  const jobs = [];
  for (const x of list) {
    const row = { id: x.id, url: x.url, at: x.at, status: 'unknown', clips: [], error: '' };
    try {
      const s = await toolCall(ctx, 'openshorts', '/api/status/' + encodeURIComponent(x.id), { key: false, timeoutMs: 6000 });
      row.status = str(s && s.status) || 'unknown';
      const cl = (s && s.result && Array.isArray(s.result.clips)) ? s.result.clips : [];
      row.clips = cl.slice(0, 20).map((c) => {
        const rel = str(c.video_url);
        const link = /^https:\/\//.test(rel) ? rel : (open && rel.startsWith('/') ? open + rel : '');
        return { title: str(c.title || c.video_title_for_youtube_short || c.hook || '').slice(0, 160), link };
      });
      if (row.status === 'failed') row.error = 'OpenShorts could not make this one. Open the full app to read why.';
    } catch (e) { row.error = str(e.message); }
    jobs.push(row);
  }
  return { jobs };
}

export const HANDLERS = { erpTools, erpToolsStatus, erpToolSet, erpToolTest, erpShortLink, erpShortenText, erpShortLinks, erpShortsMake, erpShortsJobs };
