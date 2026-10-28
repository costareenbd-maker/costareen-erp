// seo-1 (Bendar B6, 28 Oct 2026): SEO checks per website - the light (green / amber / red), the score, the issues
// with proof, and the AI's fix list. Nightly for every site of the business (jobs.js), "Check now" from the screen.
//
//   erpSeo({sites?})         the latest check per site + 30 days of scores (reads; sites = the saved list by default)
//   erpSeoRun({sites?|site}) run the checks now (at most 5 sites a call), then the screen
//   erpSeoAdvise({site})     the AI reads the facts and the issues of the latest check and writes the fixes (Bangla/English)
//   erpSeoSitesSave({sites}) the sites to check every night
//
// Researched first (owner rule): Lighthouse is used through Google's PageSpeed Insights API (free, no key needed at our
// volume; a key may be set as the platform secret PSI_KEY); linkinator's crawl pattern is borrowed (a bounded breadth-
// first walk of the home page's own links, HEAD then GET); seonaut / seo-analyzer / Screaming Frog are separate servers
// or desktop tools - rejected, a Deno edge function cannot host them and one page's checks are what the owner reads.
// Google Search Console (clicks, rankings) needs its own OAuth consent - not here yet (said on the screen).
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { platformAdmin } from './platform.js';
import { appIsOff } from './apps.js';
import { ai } from '../lib/ai.js';

const str = (v) => String(v == null ? '' : v).trim();
const MAX_SITES = 8, MAX_LINKS = 25, FETCH_MS = 15000, LINK_MS = 8000;

async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder sees the SEO checks.');
  if (!(await platformAdmin(ctx)) && await appIsOff(ctx.deps, ctx.sql, 'seo', ctx)) throw new Error('SEO is not open on this ERP yet.');
  if (!str(await getConfig(ctx, 'seo_on', ''))) await setConfig(ctx, 'seo_on', '1');   // the nightly check runs once the screen was opened (jobs never pass here)
}

/** A clean https address, or null. */
export function cleanSite(v) {
  let s = str(v).replace(/\s+/g, '');
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = 'https://' + s;
  try { const u = new URL(s); if (!/^https?:$/.test(u.protocol) || !/\./.test(u.hostname)) return null; return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '')); } catch (_) { return null; }
}
export async function savedSites(ctx) {
  let list = [];
  try { list = JSON.parse(str(await getConfig(ctx, 'seo_sites', '')) || '[]'); } catch (_) { list = []; }
  if (!Array.isArray(list) || !list.length) {
    const site = cleanSite(str(await getConfig(ctx, 'store_url', '')) || str(await getConfig(ctx, 'website_api', '')).replace(/\/wp-json.*$/, ''));
    list = site ? [site] : [];
  }
  return list.map(cleanSite).filter(Boolean);
}
/** The saved sites first, then any other site asked for (a one-off check stays on the screen next to the list). */
async function withSaved(ctx, list) {
  const out = await savedSites(ctx);
  for (const s of list || []) if (!out.includes(s)) out.push(s);
  return out;
}
function siteList(p) {
  const raw = Array.isArray(p && p.sites) ? p.sites : p && p.site ? [p.site] : null;
  if (!raw) return null;
  const out = [];
  for (const s of raw) { const c = cleanSite(s); if (c && !out.includes(c)) out.push(c); }
  return out;
}

// ---- reading one page -------------------------------------------------------------------------------------------
function tag(html, re) { const m = html.match(re); return m ? m[1] : ''; }
function meta(html, name) {
  const re = new RegExp('<meta[^>]+(?:name|property)=["\']' + name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '["\'][^>]*>', 'i');
  const m = html.match(re); if (!m) return '';
  const c = m[0].match(/content=["']([^"']*)["']/i); return c ? c[1].trim() : '';
}
function decode(s) { return str(s).replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' '); }
/** What one HTML page says about itself. */
export function readPage(html, site) {
  const h = String(html || '');
  const body = h.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<style[\s\S]*?<\/style>/gi, '');
  const title = decode(tag(body, /<title[^>]*>([\s\S]*?)<\/title>/i));
  const description = decode(meta(body, 'description'));
  const h1 = (body.match(/<h1\b[^>]*>/gi) || []).length;
  const canonical = tag(body, /<link[^>]+rel=["']canonical["'][^>]*href=["']([^"']+)["']/i) || tag(body, /<link[^>]+href=["']([^"']+)["'][^>]*rel=["']canonical["']/i);
  const robots = decode(meta(body, 'robots')).toLowerCase();
  const viewport = !!meta(body, 'viewport');
  const ogTitle = decode(meta(body, 'og:title')), ogImage = meta(body, 'og:image');
  const lang = tag(body, /<html[^>]+lang=["']([^"']+)["']/i);
  const imgs = body.match(/<img\b[^>]*>/gi) || [];
  const noAlt = imgs.filter((i) => !/\balt=["'][^"']+["']/i.test(i)).length;
  const words = body.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter(Boolean).length;
  let host = ''; try { host = new URL(site).hostname.replace(/^www\./, ''); } catch (_) { host = ''; }
  const links = [], seen = new Set();
  for (const m of body.matchAll(/<a\b[^>]*href=["']([^"'#?]+)[^"']*["']/gi)) {
    let u = m[1].trim(); if (!u || /^(mailto|tel|javascript|data):/i.test(u)) continue;
    try { u = new URL(u, site).toString(); } catch (_) { continue; }
    let uh = ''; try { uh = new URL(u).hostname.replace(/^www\./, ''); } catch (_) { continue; }
    if (uh !== host) continue;
    u = u.replace(/#.*$/, '');
    if (seen.has(u) || u === site || u === site + '/') continue;
    seen.add(u); links.push(u);
    if (links.length >= MAX_LINKS) break;
  }
  return { title, description, h1, canonical, robots, viewport, ogTitle, ogImage: !!ogImage, lang, images: imgs.length, noAlt, words, links };
}

async function fetchText(ctx, url, ms, method = 'GET') {
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  const ac = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ac ? setTimeout(() => ac.abort(), ms) : null;
  const t0 = Date.now();
  try {
    const r = await f(url, { method, redirect: 'follow', signal: ac ? ac.signal : undefined, headers: { 'user-agent': 'Mozilla/5.0 (compatible; CostareenERP-SEO/1.0)', accept: 'text/html,*/*' } });
    const text = method === 'GET' ? await r.text() : '';
    return { status: r.status, ms: Date.now() - t0, text, url: r.url || url };
  } catch (e) {
    return { status: 0, ms: Date.now() - t0, text: '', error: str(e && e.message).slice(0, 120) };
  } finally { if (timer) clearTimeout(timer); }
}
async function linkCheck(ctx, links) {
  const broken = []; let i = 0;
  const worker = async () => {
    while (i < links.length) {
      const u = links[i++];
      let r = await fetchText(ctx, u, LINK_MS, 'HEAD');
      if (r.status === 405 || r.status === 403 || r.status === 0) r = await fetchText(ctx, u, LINK_MS, 'GET');
      if (r.status === 0 || r.status >= 400) broken.push({ url: u, status: r.status || 0 });
    }
  };
  await Promise.all([worker(), worker(), worker(), worker(), worker()]);
  return broken;
}
/** PageSpeed Insights needs a (free) Google API key since the keyless quota went to 0 a day: Settings on the SEO screen. */
export async function psiKey(ctx) { return str(await getConfig(ctx, 'seo_psi_key', '')); }
async function pagespeed(ctx, site) {
  const key = await psiKey(ctx);
  if (!key) return { error: 'key' };
  const url = 'https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=' + encodeURIComponent(site) + '&strategy=mobile&category=performance&category=seo&key=' + encodeURIComponent(key);
  const r = await fetchText(ctx, url, 60000);
  if (r.status !== 200) return { error: r.status === 429 ? 'quota' : r.status === 400 || r.status === 403 ? 'key' : 'http ' + (r.status || 'none') };
  try {
    const j = JSON.parse(r.text); const L = j.lighthouseResult || {}; const c = L.categories || {}; const a = L.audits || {};
    const n = (x) => (x && typeof x.score === 'number' ? Math.round(x.score * 100) : null);
    const v = (k) => (a[k] && typeof a[k].numericValue === 'number' ? a[k].numericValue : null);
    return { perf: n(c.performance), seo: n(c.seo), lcp: v('largest-contentful-paint') !== null ? Math.round(v('largest-contentful-paint')) / 1000 : null, cls: v('cumulative-layout-shift') !== null ? Math.round(v('cumulative-layout-shift') * 1000) / 1000 : null };
  } catch (_) { return null; }
}

/** The issues of one page, each with how bad it is and what to do; the score follows. */
export function judge(f, psi, page) {
  const out = []; let score = 100;
  const add = (key, sev, title, detail, cost) => { out.push({ key, sev, title, detail: str(detail) }); score -= cost; };
  if (!page.status || page.status >= 500) { add('down', 'urgent', 'The site does not answer', page.error || ('HTTP ' + page.status), 100); return { issues: out, score: 0 }; }
  if (page.status >= 400) { add('status', 'urgent', 'The home page answers HTTP ' + page.status, 'Google cannot index an error page', 100); return { issues: out, score: 0 }; }   // an error page has no title worth judging
  if (!/^https:/i.test(page.url || '')) add('https', 'high', 'Not on https', 'Browsers warn and Google ranks http lower', 30);
  if (!f.title) add('title', 'high', 'No page title', 'Every page needs a <title>: the brand and what it sells, 50-60 characters', 15);
  else if (f.title.length > 70) add('title-long', 'low', 'The title is long (' + f.title.length + ' characters)', 'Google cuts it at about 60: "' + f.title.slice(0, 80) + '"', 4);
  else if (f.title.length < 20) add('title-short', 'low', 'The title is short (' + f.title.length + ' characters)', '"' + f.title + '" - add what the business sells and where', 4);
  if (!f.description) add('description', 'medium', 'No meta description', 'The two lines under the title in Google come from it; 120-160 characters', 10);
  else if (f.description.length > 170 || f.description.length < 60) add('description-len', 'low', 'The meta description is ' + f.description.length + ' characters', 'Aim for 120-160', 3);
  if (!f.h1) add('h1', 'medium', 'No H1 heading', 'One H1 that says what the page is about', 10);
  else if (f.h1 > 1) add('h1-many', 'low', f.h1 + ' H1 headings', 'Keep one H1; the others become H2', 3);
  if (/noindex/.test(f.robots)) add('noindex', 'urgent', 'The page tells Google not to index it', 'meta robots: ' + f.robots, 40);
  if (!f.viewport) add('viewport', 'medium', 'No mobile viewport tag', 'Phones get the desktop page shrunk; Google indexes mobile first', 10);
  if (!f.canonical) add('canonical', 'low', 'No canonical link', 'Tells Google which address is the real one (www / non-www, with / without slash)', 5);
  if (!f.ogImage) add('og-image', 'low', 'No share image (og:image)', 'Links shared on Facebook / WhatsApp show no picture', 3);
  if (!f.lang) add('lang', 'low', 'No language on <html>', 'lang="bn" or lang="en"', 2);
  if (f.images && f.noAlt / f.images > 0.3) add('alt', 'low', f.noAlt + ' of ' + f.images + ' images have no alt text', 'Alt text = what the picture shows; image search and screen readers use it', 5);
  if (f.words < 150) add('thin', 'medium', 'Very little text on the home page (' + f.words + ' words)', 'Google needs words to know what the site is about', 8);
  if (f.broken && f.broken.length) add('links', f.broken.length > 5 ? 'high' : 'medium', f.broken.length + ' broken link' + (f.broken.length > 1 ? 's' : '') + ' on the home page', f.broken.slice(0, 6).map((b) => b.url + ' (' + (b.status || 'no answer') + ')').join(', '), Math.min(20, 3 * f.broken.length));
  if (f.sitemap === false) add('sitemap', 'low', 'No sitemap.xml', 'A sitemap lists every page for Google', 5);
  if (f.robotsTxt === false) add('robots', 'low', 'No robots.txt', 'Harmless, but every crawler asks for it first', 3);
  if (page.ms > 3000) add('slow', 'medium', 'The home page took ' + (Math.round(page.ms / 100) / 10) + ' s', 'Over 3 seconds; aim under 2', 10);
  if (psi) {
    if (psi.perf !== null && psi.perf < 50) add('perf', 'high', 'Mobile speed score ' + psi.perf + '/100', 'Lighthouse (PageSpeed Insights): slow on phones' + (psi.lcp ? '; largest content paints at ' + psi.lcp + ' s' : ''), 15);
    else if (psi.perf !== null && psi.perf < 80) add('perf-mid', 'low', 'Mobile speed score ' + psi.perf + '/100', 'Fine, could be faster' + (psi.lcp ? ' (LCP ' + psi.lcp + ' s)' : ''), 5);
    if (psi.seo !== null && psi.seo < 80) add('psi-seo', 'medium', 'Lighthouse SEO score ' + psi.seo + '/100', 'Google\'s own checklist finds gaps', 8);
    if (psi.cls !== null && psi.cls > 0.25) add('cls', 'medium', 'The page jumps while loading (CLS ' + psi.cls + ')', 'Set sizes on images and ads', 6);
  }
  return { issues: out, score: Math.max(0, Math.min(100, score)) };
}
const light = (score) => (score >= 80 ? 'g' : score >= 50 ? 'y' : 'r');

/** One site: fetch, read, follow the links, ask PageSpeed, judge, keep the row. */
export async function checkSite(ctx, site) {
  const page = await fetchText(ctx, site, FETCH_MS);
  const f = page.text ? readPage(page.text, site) : { title: '', description: '', h1: 0, canonical: '', robots: '', viewport: false, ogTitle: '', ogImage: false, lang: '', images: 0, noAlt: 0, words: 0, links: [] };
  let psi = null;
  if (page.status && page.status < 400) {
    const [rb, sm, broken, ps] = await Promise.all([
      fetchText(ctx, new URL('/robots.txt', site).toString(), LINK_MS, 'HEAD'),
      fetchText(ctx, new URL('/sitemap.xml', site).toString(), LINK_MS, 'HEAD'),
      linkCheck(ctx, f.links),
      pagespeed(ctx, site),
    ]);
    f.robotsTxt = rb.status === 200; f.sitemap = sm.status === 200 || (await fetchText(ctx, new URL('/sitemap_index.xml', site).toString(), LINK_MS, 'HEAD')).status === 200; f.broken = broken; psi = ps;
  }
  if (psi && psi.error) { f.psiError = psi.error; psi = null; }
  const { issues, score } = judge(f, psi, page);
  const facts = { ...f, links: f.links.length, finalUrl: page.url, error: page.error || null, psi };
  const row = (await ctx.tx`insert into seo_checks (business_id, site, ok, status, ms, score, light, perf, seo, lcp, cls, issues, facts)
    values (${ctx.biz}, ${site}, ${!!page.status && page.status < 400}, ${page.status || null}, ${page.ms || null}, ${score}, ${light(score)},
            ${psi ? psi.perf : null}, ${psi ? psi.seo : null}, ${psi ? psi.lcp : null}, ${psi ? psi.cls : null}, ${ctx.tx.json(issues)}, ${ctx.tx.json(facts)})
    returning id`)[0];
  return { id: row.id, site, score, light: light(score), issues: issues.length };
}

function rowOut(r) {
  return { id: r.id, site: r.site, at: r.checked_at, ok: r.ok, status: r.status, ms: r.ms, score: r.score, light: r.light, perf: r.perf, seo: r.seo, lcp: r.lcp === null ? null : +r.lcp, cls: r.cls === null ? null : +r.cls,
    issues: r.issues || [], facts: r.facts || {}, advice: r.advice || null, advisedAt: r.advised_at };
}
async function screen(ctx, sites) {
  const list = sites && sites.length ? sites : await savedSites(ctx);
  const saved = await savedSites(ctx);
  const out = [];
  for (const site of list) {
    const rows = await ctx.tx`select * from seo_checks where business_id = ${ctx.biz} and site = ${site} and checked_at > now() - interval '30 days' order by checked_at desc limit 40`;
    const latest = rows[0] ? rowOut(rows[0]) : null;
    out.push({ site, latest, history: rows.slice().reverse().map((r) => ({ at: r.checked_at, score: r.score, perf: r.perf })), checks: rows.length });
  }
  const lights = { g: 0, y: 0, r: 0, none: 0 };
  for (const s of out) lights[s.latest ? s.latest.light : 'none']++;
  return { sites: out, saved, lights, searchConsole: false, psiKey: !!(await psiKey(ctx)), lang: str(await getConfig(ctx, 'ai_lang', '')) || 'bn' };
}

export async function erpSeo(ctx, payload) {
  await gate(ctx);
  return screen(ctx, siteList(payload));
}
export async function erpSeoRun(ctx, payload) {
  await gate(ctx);
  const list = siteList(payload) || await savedSites(ctx);
  if (!list.length) throw new Error('No website to check - add one under Sites, or set the website address in Settings.');
  const ran = [];
  for (const site of list.slice(0, MAX_SITES)) ran.push(await checkSite(ctx, site));
  const out = await screen(ctx, await withSaved(ctx, list));
  out.ran = ran;
  return out;
}
export async function erpSeoSitesSave(ctx, payload) {
  await gate(ctx);
  const list = siteList(payload) || [];
  if (list.length > MAX_SITES) throw new Error('At most ' + MAX_SITES + ' sites.');
  await setConfig(ctx, 'seo_sites', JSON.stringify(list));
  if (payload && payload.psiKey !== undefined) {
    const k = str(payload.psiKey);
    if (k && !/^[A-Za-z0-9_\-]{20,80}$/.test(k)) throw new Error('That does not look like a Google API key.');
    await setConfig(ctx, 'seo_psi_key', k);
  }
  return screen(ctx, null);
}
export async function erpSeoAdvise(ctx, payload) {
  await gate(ctx);
  const site = cleanSite(payload && payload.site);
  if (!site) throw new Error('Which site?');
  const row = (await ctx.tx`select * from seo_checks where business_id = ${ctx.biz} and site = ${site} order by checked_at desc limit 1`)[0];
  if (!row) throw new Error('Check the site first.');
  const lang = str(await getConfig(ctx, 'ai_lang', '')) === 'en' ? 'en' : 'bn';
  const biz = str((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0]?.name);
  const sys = 'You are a senior SEO consultant for a small online business in Bangladesh' + (biz ? ' (' + biz + ')' : '') + '. You get the facts of one home page and the problems found by an automatic check. ' +
    'Write the fixes an owner who is not a programmer can hand to his web person: concrete, in order of effect on Google ranking and sales, no theory. ' +
    (lang === 'bn' ? 'Write in simple Bangla (তুমি form); keep technical words (title, meta description, H1, sitemap, alt) in English letters.' : 'Write in plain English.') +
    ' Answer as JSON only: {"summary": "two sentences on where the site stands", "fixes": [{"title": "...", "why": "what it changes for Google / customers", "how": "exactly what to write or change, with the suggested text when it is text", "where": "which file / setting / page", "effort": "minutes|hour|day"}]} with at most 8 fixes.';
  const user = 'Site: ' + site + '\nScore: ' + row.score + '/100 (' + row.light + ')\nFacts: ' + JSON.stringify(row.facts).slice(0, 6000) + '\nIssues: ' + JSON.stringify(row.issues).slice(0, 4000);
  const r = await ai(ctx, { task: 'analyze', purpose: 'seo', json: true, maxTokens: 3000, temperature: 0.3, system: sys, messages: [{ role: 'user', content: [{ type: 'text', text: user }] }] });
  const j = r.json && typeof r.json === 'object' ? r.json : { summary: str(r.text).slice(0, 600), fixes: [] };
  const advice = { summary: str(j.summary).slice(0, 1000), fixes: (Array.isArray(j.fixes) ? j.fixes : []).slice(0, 8).map((x) => ({ title: str(x.title).slice(0, 200), why: str(x.why).slice(0, 500), how: str(x.how).slice(0, 1500), where: str(x.where).slice(0, 200), effort: str(x.effort).slice(0, 20) })), model: r.provider + ':' + r.model, lang };
  await ctx.tx`update seo_checks set advice = ${ctx.tx.json(advice)}, advised_at = now() where id = ${row.id}`;
  return screen(ctx, await withSaved(ctx, [site]));
}

/** jobs.js nightly: every saved site of a business whose owner opened the SEO screen. */
export async function seoNightly(ctx) {
  if (!str(await getConfig(ctx, 'seo_on', ''))) return 'off';
  const list = await savedSites(ctx);
  const out = [];
  for (const site of list.slice(0, MAX_SITES)) { try { out.push(await checkSite(ctx, site)); } catch (e) { out.push({ site, error: str(e && e.message).slice(0, 120) }); } }
  return out;
}

export const HANDLERS = { erpSeo, erpSeoRun, erpSeoSitesSave, erpSeoAdvise };
