// Reading the business's own website for the Inbox AI (owner 17 Oct 2026). Table site_pages (126).
//
//   erpSiteRead({url})          read the site: its sitemap and the links on its front page, policy pages first, at most
//                               MAX_PAGES pages and MAX_PRODUCTS product pages (pages not read before go first, so
//                               pressing it again reads further); with a WooCommerce / Shopify connection, every
//                               product's own text instead of its page.
//                               Every page is kept as a DRAFT; nothing reaches the AI until a person adds it.
//   erpSitePages()              the drafts and what was done with them
//   erpSitePageAct({ids, action: 'add'|'skip'|'draft', overwrite, sku})
//                               add: a policy / page goes into the knowledge base; a product page becomes the product's
//                               description for the AI (an existing one is kept unless overwrite).

import { getConfig, setConfig, httpFetch } from '../lib/ext.js';
import { kbAdd } from './inbox2.js';
import { needFeat } from '../lib/inboxplan.js';
import { storeConn } from './stores.js';

const str = (v) => String(v == null ? '' : v).trim();
const MAX_PAGES = 20, MAX_PRODUCTS = 60, AT_ONCE = 6, MAX_TEXT = 20000, BUDGET_MS = 70000;
const POLICY = /privacy|refund|return|exchange|shipping|delivery|terms|condition|warranty|guarantee|faq|about|contact|payment|cancel|policy/i;
const SKIP = /\.(jpe?g|png|gif|webp|svg|pdf|zip|mp4|css|js|ico|xml)(\?|$)|\/(cart|checkout|my-account|account|login|wp-admin|wp-json|feed|tag|author|comments?|category|product-category|product-brand|product-tag|brand|page\/\d+|wishlist|compare|order-tracking)\b/i;
const PRODUCT_URL = /\/products?\//i;

function canon(u) {
  try { const x = new URL(str(u)); x.hash = ''; x.search = ''; if (x.pathname !== '/' && x.pathname.endsWith('/')) x.pathname = x.pathname.slice(0, -1); return x.toString(); } catch (_) { return ''; }
}
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#0?39;|&#8217;|&rsquo;/g, "'")
  .replace(/&#8211;|&ndash;/g, '-').replace(/&#8212;|&mdash;/g, '-').replace(/&#(\d+);/g, (_, n) => { try { return String.fromCodePoint(+n); } catch (e) { return ' '; } });

/** The words of a page: its main part (article / main) when there is one, without scripts, menus and footers. */
export function pageText(html) {
  let h = String(html || '');
  const title = decode(((/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)/i.exec(h) || /<title[^>]*>([^<]*)<\/title>/i.exec(h) || [])[1] || '').trim());
  h = h.replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ');
  const main = /<main[\s\S]*?<\/main>/i.exec(h) || /<article[\s\S]*?<\/article>/i.exec(h);
  if (main) h = main[0];
  else h = h.replace(/<(header|footer|nav|aside)[\s\S]*?<\/\1>/gi, ' ');
  h = h.replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section)[^>]*>/gi, '\n').replace(/<li[^>]*>/gi, '\n- ').replace(/<[^>]+>/g, ' ');
  const text = decode(h).split('\n').map((l) => l.replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n').replace(/\n{3,}/g, '\n\n');
  return { title: title.replace(/\s+[|–—-]\s+[^|–—]{1,40}$/, '').trim() || title, text: text.slice(0, MAX_TEXT) };
}
function linksIn(html, base, host) {
  const out = [];
  const re = /<a[^>]+href=["']([^"'#]+)["']/gi;
  let m;
  while ((m = re.exec(String(html || '')))) {
    try { const u = new URL(m[1], base); if (u.host === host && /^https?:$/.test(u.protocol)) out.push(canon(u.toString())); } catch (_) { /* a bad link */ }
  }
  return out;
}
function locsIn(xml) { const out = []; const re = /<loc>\s*([^<\s]+)\s*<\/loc>/gi; let m; while ((m = re.exec(String(xml || '')))) out.push(decode(m[1])); return out; }

async function get(ctx, url) {
  const r = await httpFetch(ctx, url, { headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ERP-site-reader)', Accept: 'text/html,application/xml' } });
  return r.code >= 200 && r.code < 300 ? r.text : '';
}

/** A product of ours for a page: by a code printed on it, else by the words of the name (the brand must be there when the
 *  product has one; words like "price", "Bangladesh" do not count). The owner still checks every match before it is used. */
const NOISE = new Set(['price', 'prices', 'bangladesh', 'bd', 'buy', 'best', 'online', 'dhaka', 'the', 'and', 'for', 'with', 'in', 'of', 'new', 'original', 'genuine', 'shop']);
const SAME = { gray: 'grey', colour: 'color', refill: 'refil', aluminium: 'aluminum', transparent: 'clear' };
const wordsOf = (t) => String(t || '').toLowerCase().split(/[^a-z0-9ঀ-৿+.]+/).map((w) => w.replace(/\.$/, '')).filter((w) => w.length > 1 && !NOISE.has(w)).map((w) => SAME[w] || w);
/** One letter off (a typo like "Babulab") for longer words. */
function nearly(a, b) {
  if (Math.abs(a.length - b.length) > 1 || a.length < 5) return false;
  let i = 0, j = 0, diff = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) { i++; j++; continue; }
    if (++diff > 1) return false;
    if (a.length > b.length) i++; else if (b.length > a.length) j++; else { i++; j++; }
  }
  return diff + (a.length - i) + (b.length - j) <= 1;
}
const like = (x, w) => x === w || nearly(x, w) || (w.length >= 5 && x.length >= 5 && Math.abs(x.length - w.length) <= 2 && (x.startsWith(w) || w.startsWith(x)));
/** How many of the words ws are on the title (tw = the title's words); each title word is used once, two neighbours
 *  may together make one word ("Bambu Lab" = "bambulab"). */
function wordsOn(tw, ws) {
  const used = new Array(tw.length).fill(false);
  let n = 0;
  for (const w of ws) {
    let k = tw.findIndex((x, i) => !used[i] && x === w);
    if (k < 0) k = tw.findIndex((x, i) => !used[i] && like(x, w));
    if (k >= 0) { used[k] = true; n++; continue; }
    k = tw.findIndex((x, i) => i + 1 < tw.length && !used[i] && !used[i + 1] && like(x + tw[i + 1], w));
    if (k >= 0) { used[k] = used[k + 1] = true; n++; }
  }
  return n;
}
function matchProduct(products, title, text) {
  const hay = (title + ' ' + String(text).slice(0, 3000)).toLowerCase();
  const tw = wordsOf(title);
  let best = null, bestS = 0;
  for (const p of products) {
    if (p.sku && p.sku.length > 4 && new RegExp('(^|[^a-z0-9-])' + p.sku.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^a-z0-9-])').test(hay)) return p.sku;
    const bw = wordsOf(p.brand);
    if (bw.length && wordsOn(tw, bw) < bw.length) continue;
    const pw = wordsOf(p.name);
    if (!pw.length || wordsOn(tw, pw) < pw.length) continue;           // every word of our name is on the page
    const score = (2 * pw.length) / (pw.length + tw.length);
    if (score > bestS) { bestS = score; best = p.sku; }
  }
  return bestS >= 0.4 ? best : null;
}

async function keep(ctx, row) {
  const had = (await ctx.tx`select id, status, body from site_pages where business_id = ${ctx.biz} and url = ${row.url}`)[0];
  if (had && had.status !== 'draft' && str(had.body) === str(row.body)) return 'same';
  await ctx.tx`insert into site_pages (business_id, url, title, kind, body, sku, source, status, found_at)
               values (${ctx.biz}, ${row.url}, ${row.title || null}, ${row.kind}, ${row.body}, ${row.sku || null}, ${row.source}, 'draft', now())
               on conflict (business_id, url) do update set title = excluded.title, kind = excluded.kind, body = excluded.body,
                 sku = excluded.sku, source = excluded.source, status = 'draft', found_at = now(), decided_by = null, decided_at = null`;
  return !had ? 'new' : str(had.body) === str(row.body) ? 'same' : 'changed';
}

export async function erpSiteRead(ctx, payload) {
  await needFeat(ctx, 'knowledge');
  if (ctx.s.role !== 'owner') throw new Error('Only the owner reads the website for the AI.');
  let start = str(payload && payload.url) || str(await getConfig(ctx, 'site_url', ''));
  if (start && !/^https?:\/\//i.test(start)) start = 'https://' + start;
  const home = canon(start);
  if (!home) throw new Error('Type your website address, like https://www.yourshop.com');
  const host = new URL(home).host, t0 = Date.now();
  await setConfig(ctx, 'site_url', home);
  const { products } = await import('./dashboard.js');
  const plist = (await products(ctx)).list.filter((p) => !/discontinued|inactive|archived/i.test(p.status));
  const counts = { new: 0, changed: 0, same: 0, read: 0, products: 0, failed: 0 };

  // the store's own product texts (exact, by code) when the shop is connected
  let storeDone = false;
  try {
    const c = await storeConn(ctx);
    if (c.kind === 'woo') {
      for (let page = 1; page <= 5 && Date.now() - t0 < BUDGET_MS / 2; page++) {
        const r = await httpFetch(ctx, c.api + 'products?per_page=100&status=publish&_fields=id,name,sku,permalink,short_description,description&page=' + page, { headers: c.headers });
        if (r.code !== 200 || !Array.isArray(r.json) || !r.json.length) break;
        for (const w of r.json) {
          const body = pageText('<main>' + str(w.short_description) + '\n' + str(w.description) + '</main>').text;
          if (body.length < 20) continue;
          const sku = (plist.find((p) => str(w.sku) && p.sku.toLowerCase() === str(w.sku).toLowerCase()) || {}).sku || matchProduct(plist, decode(str(w.name)), body);
          counts[await keep(ctx, { url: canon(w.permalink) || (home + '#product-' + w.id), title: decode(str(w.name)), kind: 'product', body, sku, source: 'woo' })]++;
          counts.products++;
        }
        if (r.json.length < 100) break;
      }
      storeDone = true;
    } else if (c.kind === 'shopify') {
      const r = await httpFetch(ctx, c.api + 'products.json?limit=250&status=active&fields=id,title,handle,body_html,variants', { headers: c.headers });
      for (const w of (r.code === 200 && r.json && r.json.products) || []) {
        const body = pageText('<main>' + str(w.body_html) + '</main>').text;
        if (body.length < 20) continue;
        const codes = (w.variants || []).map((v) => str(v.sku).toLowerCase()).filter(Boolean);
        const sku = (plist.find((p) => codes.includes(p.sku.toLowerCase())) || {}).sku || matchProduct(plist, str(w.title), body);
        counts[await keep(ctx, { url: c.url + '/products/' + w.handle, title: str(w.title), kind: 'product', body, sku, source: 'shopify' })]++;
        counts.products++;
      }
      storeDone = r.code === 200;
    }
  } catch (_) { /* no store connection: product pages are read from the site */ }

  // the site's pages: the sitemap, then the front page's links; policies first
  const homeHtml = await get(ctx, home);
  if (!homeHtml) throw new Error('The website did not answer at ' + home + '. Check the address.');
  let urls = linksIn(homeHtml, home, host);
  for (const sm of ['/wp-sitemap.xml', '/sitemap_index.xml', '/sitemap.xml']) {
    if (Date.now() - t0 > BUDGET_MS / 3) break;
    const xml = await get(ctx, new URL(sm, home).toString());
    if (!xml || !/<loc>/i.test(xml)) continue;
    const locs = locsIn(xml);
    const subs = locs.filter((u) => /\.xml(\?|$)/i.test(u) && !/taxonom|user|author|tag|categor|brand|attachment/i.test(u) && !(storeDone && /product/i.test(u)));
    for (const sub of subs.slice(0, 8)) urls = urls.concat(locsIn(await get(ctx, sub)));
    urls = urls.concat(locs.filter((u) => !/\.xml(\?|$)/i.test(u)));
    break;
  }
  // drafts kept under an address the reader no longer uses (?add-to-wishlist=... copies of a page) go
  for (const r of await ctx.tx`select id, url from site_pages where business_id = ${ctx.biz} and status = 'draft' and source = 'web'`) {
    if (canon(r.url) !== r.url || SKIP.test(r.url)) await ctx.tx`delete from site_pages where id = ${r.id}`;
  }
  // product drafts are matched again (products change, the rule may be better now)
  for (const r of await ctx.tx`select id, title, body, sku from site_pages where business_id = ${ctx.biz} and status = 'draft' and kind = 'product' and source = 'web'`) {
    const m = matchProduct(plist, str(r.title), str(r.body)) || null;
    if ((m || '') !== str(r.sku)) await ctx.tx`update site_pages set sku = ${m} where id = ${r.id}`;
  }
  const known = {};
  for (const r of await ctx.tx`select url from site_pages where business_id = ${ctx.biz}`) known[r.url] = 1;
  const seen = {}, pages = [], prods = [];
  for (const u of [home].concat(urls)) {
    const c = canon(u);
    if (!c || seen[c] || SKIP.test(c)) continue;
    try { if (new URL(c).host !== host) continue; } catch (_) { continue; }
    seen[c] = 1;
    if (PRODUCT_URL.test(c)) { if (!storeDone) prods.push(c); } else pages.push(c);
  }
  pages.sort((a, b) => (POLICY.test(b) ? 1 : 0) - (POLICY.test(a) ? 1 : 0) || a.length - b.length);
  prods.sort((a, b) => (known[a] ? 1 : 0) - (known[b] ? 1 : 0));            // products not read before go first
  const todo = pages.slice(0, MAX_PAGES).concat(prods.slice(0, MAX_PRODUCTS));
  const bodies = {};
  for (let i = 0; i < todo.length; i += AT_ONCE) {
    if (Date.now() - t0 > BUDGET_MS) break;
    const part = todo.slice(i, i + AT_ONCE);
    const got = await Promise.all(part.map((u) => (u === home ? Promise.resolve(homeHtml) : get(ctx, u).catch(() => ''))));
    for (let j = 0; j < part.length; j++) {
      const u = part[j], html = got[j];
      if (!html) { counts.failed++; continue; }
      const pg = pageText(html);
      counts.read++;
      if (pg.text.length < 80 || bodies[pg.text]) continue;                 // empty, or the same page under another address
      bodies[pg.text] = 1;
      const isProduct = PRODUCT_URL.test(u) || /"@type"\s*:\s*"Product"/i.test(html);
      const kind = isProduct ? 'product' : (POLICY.test(u) || POLICY.test(pg.title)) ? 'policy' : 'page';
      const sku = isProduct ? matchProduct(plist, pg.title, pg.text) : null;
      counts[await keep(ctx, { url: u, title: pg.title || u, kind, body: pg.text, sku, source: 'web' })]++;
    }
  }
  const left = Math.max(0, pages.length - MAX_PAGES) + Math.max(0, prods.filter((u) => !known[u]).length - MAX_PRODUCTS);
  return { ...(await erpSitePages(ctx)), lastRead: counts, more: left };
}

export async function erpSitePages(ctx) {
  await needFeat(ctx, 'knowledge');
  const rows = await ctx.tx`select id, url, title, kind, left(body, 400) as preview, length(body) as size, sku, source, status, found_at, decided_by
                            from site_pages where business_id = ${ctx.biz} order by (status = 'draft') desc, kind, found_at desc limit 500`;
  const names = {};
  for (const r of await ctx.tx`select sku, name from products where business_id = ${ctx.biz}`) names[str(r.sku).toLowerCase()] = str(r.name);
  return {
    site: str(await getConfig(ctx, 'site_url', '')),
    pages: rows.map((r) => ({ id: r.id, url: r.url, title: str(r.title), kind: r.kind, preview: str(r.preview), size: Number(r.size) || 0, sku: str(r.sku),
                              product: r.sku ? names[str(r.sku).toLowerCase()] || '' : '', source: r.source, status: r.status, by: str(r.decided_by) })),
    canAdd: ctx.s.role === 'owner',
  };
}

export async function erpSitePageAct(ctx, payload) {
  payload = payload || {};
  if (ctx.s.role !== 'owner') throw new Error('Only the owner decides what the AI learns.');
  const ids = (Array.isArray(payload.ids) ? payload.ids : [payload.id]).map(str).filter((x) => /^[0-9a-f-]{36}$/i.test(x)).slice(0, 300);
  const action = str(payload.action);
  if (!['add', 'skip', 'draft'].includes(action)) throw new Error('Add, skip or put back?');
  let added = 0, kept = 0;
  for (const id of ids) {
    const r = (await ctx.tx`select * from site_pages where business_id = ${ctx.biz} and id = ${id}`)[0];
    if (!r) continue;
    if (action === 'add') {
      if (!str(r.body)) continue;
      if (r.kind === 'product') {
        const sku = str(payload.sku) && ids.length === 1 ? str(payload.sku) : str(r.sku);
        if (!sku) throw new Error('"' + str(r.title) + '" is not matched to a product - choose the product first.');
        const p = (await ctx.tx`select sku from products where business_id = ${ctx.biz} and lower(sku) = ${sku.toLowerCase()}`)[0];
        if (!p) throw new Error('That product is not here.');
        const had = (await ctx.tx`select description from product_ai where business_id = ${ctx.biz} and sku = ${p.sku}`)[0];
        if (had && str(had.description) && !payload.overwrite) { kept++; continue; }
        await ctx.tx`insert into product_ai (business_id, sku, description, facts, updated_by, updated_at)
                     values (${ctx.biz}, ${p.sku}, ${str(r.body).slice(0, 3000)}, '{}'::jsonb, ${'Website, added by ' + str(ctx.s.name)}, now())
                     on conflict (business_id, sku) do update set description = excluded.description, updated_by = excluded.updated_by, updated_at = now()`;
        await ctx.tx`update site_pages set sku = ${p.sku} where id = ${r.id}`;
      } else {
        if (r.kb_doc) await ctx.tx`update kb_docs set archived = true where business_id = ${ctx.biz} and id = ${r.kb_doc}`;
        const doc = await kbAdd(ctx, ('Website: ' + (str(r.title) || r.url)).slice(0, 120), 'text', str(r.body) + '\n(From ' + r.url + ')');
        await ctx.tx`update site_pages set kb_doc = ${doc} where id = ${r.id}`;
      }
      added++;
    }
    await ctx.tx`update site_pages set status = ${action === 'add' ? 'added' : action === 'skip' ? 'skipped' : 'draft'}, decided_by = ${str(ctx.s.name)}, decided_at = now()
                 where id = ${r.id}`;
  }
  delete ctx.memo.inboxCat;
  return { ...(await erpSitePages(ctx)), added, kept };
}

export const HANDLERS = { erpSiteRead, erpSitePages, erpSitePageAct };
