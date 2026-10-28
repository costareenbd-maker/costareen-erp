// seo-1 (Bendar B6, 28 Oct 2026): SEO checks per website. A fake site with a thin title, no description, a broken
// link and no sitemap is checked; the score, the light and the issues follow; the AI writes the fixes (fake Gemini);
// a manager is refused; the other business has no rows; the site list is saved and cleaned; a dead site is red.
import { sql, FIX, owner, mgr, check, done, deps, web } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';

const B = FIX.B;
const { readPage, judge, cleanSite } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'seo.js')));
await sql`insert into erp_app_flags (key, enabled) values ('seo', true) on conflict (key) do update set enabled = true`;

// ---- the fake outside world
const HOME = '<!doctype html><html lang="en"><head><title>Shop</title><meta name="viewport" content="width=device-width">' +
  '<link rel="canonical" href="https://shop.test/"><meta property="og:image" content="https://shop.test/a.png"></head><body><h1>Filament shop</h1>' +
  '<p>' + 'Words about printers and filament. '.repeat(40) + '</p><img src="a.png" alt="roll"><img src="b.png">' +
  '<a href="/products">Products</a><a href="/gone">Old page</a><a href="https://other.test/x">Away</a><a href="/products#top">Again</a><a href="mailto:a@b.c">Mail</a></body></html>';
web.on(/^https:\/\/shop\.test\/?$/, () => ({ status: 200, body: HOME, headers: { 'content-type': 'text/html' } }));
web.on(/^https:\/\/shop\.test\/products$/, () => ({ status: 200, body: 'ok' }));
web.on(/^https:\/\/shop\.test\/gone$/, () => ({ status: 404, body: 'no' }));
web.on(/^https:\/\/shop\.test\/robots\.txt$/, () => ({ status: 200, body: 'User-agent: *' }));
web.on(/^https:\/\/shop\.test\/sitemap(_index)?\.xml$/, () => ({ status: 404, body: '' }));
web.on(/pagespeedonline/, () => ({ status: 200, body: { lighthouseResult: { categories: { performance: { score: 0.42 }, seo: { score: 0.9 } }, audits: { 'largest-contentful-paint': { numericValue: 4200 }, 'cumulative-layout-shift': { numericValue: 0.05 } } } } }));
web.on(/^https:\/\/dead\.test/, () => { throw new Error('ECONNREFUSED'); });
let aiText = '';
web.on(/generativelanguage\.googleapis\.com/, () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: aiText }] } }] } }));

// ---- pure parts
const f = readPage(HOME, 'https://shop.test');
check('the page is read: title, one H1, canonical, viewport, og image, 2 images (1 without alt), own links only, once each', f.title === 'Shop' && f.h1 === 1 && f.canonical === 'https://shop.test/' && f.viewport && f.ogImage && f.images === 2 && f.noAlt === 1 && f.links.length === 2 && f.links.includes('https://shop.test/gone'), f);
check('addresses are cleaned: https added, slash and hash dropped, nonsense refused', cleanSite('shop.test/') === 'https://shop.test' && cleanSite('https://www.shop.test/page/') === 'https://www.shop.test/page' && cleanSite('not a site') === null && cleanSite('') === null, '');
let j = judge({ ...f, broken: [], sitemap: true, robotsTxt: true }, null, { status: 200, ms: 800, url: 'https://shop.test/' });
check('a clean page: short title, no description and one image without alt cost a little, nothing else', j.score === 81 && j.issues.map((i) => i.key).sort().join() === 'alt,description,title-short', j);
j = judge({ ...f, title: '', robots: 'noindex, nofollow', broken: [] }, { perf: 30, seo: 70, lcp: 6, cls: 0.4 }, { status: 200, ms: 5000, url: 'http://shop.test/' });
check('a bad page: noindex, no title, http, slow, poor Lighthouse - red', j.score < 50 && ['noindex', 'title', 'https', 'slow', 'perf', 'psi-seo', 'cls'].every((k) => j.issues.some((i) => i.key === k)), j.issues.map((i) => i.key));
j = judge(f, null, { status: 0, error: 'ECONNREFUSED' });
check('a site that does not answer: one urgent issue, score 0', j.score === 0 && j.issues.length === 1 && j.issues[0].sev === 'urgent', j);

// ---- the door
let r = await mgr('erpSeo', [{}]);
check('a manager does not see the SEO checks', !r.ok && /permission|owner or a shareholder/.test(r.error), r);
r = await owner('erpSeo', [{}]);
check('the owner, before any check: no sites saved, nothing checked', r.ok && r.result.sites.length === 0 && r.result.lights.none === 0, r);
r = await owner('erpSeoRun', [{}]);
check('nothing to check without a website', !r.ok && /No website/.test(r.error), r);

// ---- the sites and a run
r = await owner('erpSeoSitesSave', [{ sites: ['shop.test', 'https://shop.test/', 'junk'] }]);
check('the site list is saved, cleaned and without doubles', r.ok && r.result.saved.length === 1 && r.result.saved[0] === 'https://shop.test', r);
r = await owner('erpSeoRun', [{}]);
const S = r.ok && r.result.sites[0], L = S && S.latest;
check('the check ran: the home page read, the links followed, PageSpeed asked', r.ok && r.result.ran.length === 1 && L && L.ok && L.status === 200 && L.perf === 42 && L.seo === 90 && L.lcp === 4.2 && L.cls === 0.05, r.ok ? L : r);
check('...the issues: no description, short title, a broken link, no sitemap, slow on phones', L && ['description', 'title-short', 'links', 'sitemap', 'perf'].every((k) => L.issues.some((i) => i.key === k)) && L.issues.find((i) => i.key === 'links').detail.includes('/gone (404)'), L && L.issues.map((i) => i.key));
check('...amber: the score is between 50 and 80', L && L.light === 'y' && L.score >= 50 && L.score < 80, L && L.score);
check('...the facts kept: 2 own links, robots.txt found, no sitemap', L && L.facts.links === 2 && L.facts.robotsTxt === true && L.facts.sitemap === false, L && L.facts);
check('the other business has no checks', (await sql`select count(*)::int n from seo_checks where business_id = ${FIX.B2}`)[0].n === 0, '');
check('the screen was opened: the nightly check is on for this business', (await sql`select value from business_config where business_id = ${B} and key = 'seo_on'`)[0]?.value === '1', '');

// ---- a dead site, asked for by address (not saved)
r = await owner('erpSeoRun', [{ site: 'dead.test' }]);
const DS = r.ok && r.result.sites.find((x) => x.site === 'https://dead.test'), D = DS && DS.latest;
check('a dead site: red, score 0, one urgent issue, shown next to the saved list which stays as it was', r.ok && D && D.light === 'r' && D.score === 0 && D.issues[0].sev === 'urgent' && r.result.saved.join() === 'https://shop.test' && r.result.sites[0].site === 'https://shop.test', r.ok ? D : r);

// ---- history
r = await owner('erpSeoRun', [{}]);
r = await owner('erpSeo', [{}]);
check('two checks of the shop: history of 2 scores, oldest first', r.ok && r.result.sites[0].checks === 2 && r.result.sites[0].history.length === 2, r.ok && r.result.sites[0]);

// ---- the AI's fixes
deps.geminiKey = '';
r = await owner('erpSeoAdvise', [{ site: 'shop.test' }]);
check('no AI key: a plain refusal', !r.ok && /No AI key/.test(r.error), r);
deps.geminiKey = 'k';
aiText = JSON.stringify({ summary: 'সাইট মোটামুটি, description নেই।', fixes: [{ title: 'Meta description লেখো', why: 'Google-এ দুই লাইন', how: 'Filament, printers in Dhaka - same day delivery', where: 'Yoast > home page', effort: 'minutes' }, { title: 'Broken link ঠিক করো', why: 'crawl waste', how: '/gone → /products', where: 'menu', effort: 'minutes' }] });
r = await owner('erpSeoAdvise', [{ site: 'shop.test' }]);
const A = r.ok && r.result.sites[0].latest.advice;
check('the AI writes the fixes in Bangla and they are kept on the latest check', r.ok && A && A.fixes.length === 2 && /description/.test(A.fixes[0].title) && A.lang === 'bn' && r.result.sites[0].latest.advisedAt, r.ok ? A : r);
r = await owner('erpSeoAdvise', [{ site: 'never.test' }]);
check('fixes for a site never checked: refused', !r.ok && /Check the site first/.test(r.error), r);
r = await mgr('erpSeoRun', [{}]);
check('a manager cannot run the checks', !r.ok, r);

done();
