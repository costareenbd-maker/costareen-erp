// Reading the business's own website for the Inbox AI (126_site_pages.sql, handlers/siteread.js): the sitemap and front
// page are read, policies first, junk links skipped; every page is a draft; adding a policy puts it in the knowledge base
// (re-adding archives the old copy), adding a product page writes the product's description (an existing one is kept
// unless overwrite); WooCommerce product texts come in by code; roles; another business untouched.
import { sql, FIX, owner, mgr, sales, check, done, web } from './harness.mjs';

const PLA = 'FIL-SUN-PLA-BLA-001';
const pName = (await sql`select name from products where business_id = ${FIX.B} and sku = ${PLA}`)[0].name;
const page = (title, body, extra) => '<html><head><title>' + title + ' | Shop</title><script>var x = "no";</script></head><body><nav>Menu Home Cart</nav>' +
  '<main><h1>' + title + '</h1><p>' + body + '</p>' + (extra || '') + '</main><footer>Footer words</footer></body></html>';
let refundText = 'Returns are accepted within 7 days if the seal is unopened. The customer pays the return delivery. Refunds go back by bKash within 3 working days.';
const hits = [];
web.on(/shop\.test/, (url) => {
  hits.push(url);
  const u = new URL(url);
  if (u.pathname === '/' ) return { status: 200, body: page('Home', 'Welcome to the best 3D printing shop in Dhaka, filament, printers and parts all in one place for makers.',
    '<a href="/refund-policy/">Refunds</a> <a href="/cart/">Cart</a> <a href="https://other.test/x">Elsewhere</a> <a href="/photo.jpg">Pic</a> <a href="/product/pla-black/">PLA</a> <a href="/product/other-brand/">Other</a>'), headers: { 'content-type': 'text/html' } };
  if (u.pathname === '/wp-sitemap.xml') return { status: 200, body: '<sitemapindex><sitemap><loc>https://shop.test/wp-sitemap-pages.xml</loc></sitemap></sitemapindex>' };
  if (u.pathname === '/wp-sitemap-pages.xml') return { status: 200, body: '<urlset><url><loc>https://shop.test/privacy-policy/</loc></url><url><loc>https://shop.test/about-us/</loc></url><url><loc>https://shop.test/my-account/</loc></url></urlset>' };
  if (u.pathname === '/refund-policy') return { status: 200, body: page('Refund and Returns Policy', refundText) };
  if (u.pathname === '/privacy-policy') return { status: 200, body: page('Privacy Policy', 'We keep your name, phone and address only to deliver your order. We never sell your data to anyone, and you can ask us to delete it.') };
  if (u.pathname === '/about-us') return { status: 200, body: page('About us', 'Costareen started in 2020 in Mirpur, Dhaka, selling 3D printing filament and printers to makers, schools and print farms across Bangladesh.') };
  if (u.pathname === '/product/other-brand') return { status: 200, body: page('Zzbrand ' + pName.split(' ').slice(1).join(' '), 'The same kind of spool from a brand we do not sell, with a long text so that it is kept as a page for checking.') };
  if (u.pathname === '/product/pla-black') return { status: 200, body: page(pName, 'Matte black PLA, 1.75 mm, 1 kg spool. Prints at 200-220 C with a 60 C bed. Low warping, vacuum packed with desiccant, works with every common FDM printer.') };
  return { status: 404, body: 'no' };
});

// 1. roles and a bad address
let r = await sales('erpSiteRead', [{ url: 'https://shop.test' }]);
check('sales cannot read the website', !r.ok, r.ok);
r = await mgr('erpSiteRead', [{ url: 'https://shop.test' }]);
check('a manager cannot read the website (owner decides what the AI learns)', !r.ok, r.ok);
r = await owner('erpSiteRead', [{ url: '' }]);
check('no address: a plain refusal', !r.ok && /website address/.test(r.error), r.error);

// 2. read it
r = await owner('erpSiteRead', [{ url: 'shop.test' }]);
check('read ok', r.ok, r.error);
let d = r.result;
const byPath = (p) => d.pages.find((x) => new URL(x.url).pathname.replace(/\/$/, '') === p);
check('the address is kept with https', d.site === 'https://shop.test/', d.site);
check('policy pages found from the front page and the sitemap', byPath('/refund-policy') && byPath('/privacy-policy') && byPath('/refund-policy').kind === 'policy' && byPath('/privacy-policy').kind === 'policy', d.pages.map((x) => x.url));
check('about is a policy-like page too (about/contact count)', byPath('/about-us') && byPath('/about-us').kind === 'policy', byPath('/about-us'));
check('the cart, my-account, pictures and other sites are not read', !hits.some((h) => /cart|my-account|photo\.jpg|other\.test/.test(h)), hits);
check('the product page is matched to the product', byPath('/product/pla-black') && byPath('/product/pla-black').kind === 'product' && byPath('/product/pla-black').sku === PLA, byPath('/product/pla-black'));
check('menus, footers and scripts are left out', !d.pages.some((x) => /Footer words|var x|Menu Home/.test(x.preview)), d.pages.map((x) => x.preview));
check('everything is a draft', d.pages.every((x) => x.status === 'draft') && d.lastRead.new === d.pages.length, d.lastRead);
const brand = (await sql`select brand from products where business_id = ${FIX.B} and sku = ${PLA}`)[0].brand;
if (brand) check('a page of another brand is not matched to our product', byPath('/product/other-brand') && !byPath('/product/other-brand').sku, byPath('/product/other-brand'));
const kb0 = (await sql`select count(*)::int n from kb_docs where business_id = ${FIX.B}`)[0].n;

// 3. a manager sees the drafts but cannot add
r = await mgr('erpSitePages', []);
check('a manager sees the drafts, cannot add', r.ok && r.result.pages.length === d.pages.length && !r.result.canAdd, r.error || r.result.canAdd);
r = await mgr('erpSitePageAct', [{ ids: [byPath('/refund-policy').id], action: 'add' }]);
check('a manager cannot add', !r.ok, r.ok);

// 4. add the refund policy -> knowledge base, searchable
r = await owner('erpSitePageAct', [{ ids: [byPath('/refund-policy').id], action: 'add' }]);
check('added', r.ok && r.result.added === 1, r.error || r.result);
d = r.result;
let docs = await sql`select id, title, archived from kb_docs where business_id = ${FIX.B} and title like 'Website:%'`;
check('one knowledge-base document "Website: Refund and Returns Policy"', docs.length === 1 && /Refund and Returns Policy/.test(docs[0].title), docs);
r = await owner('erpInboxKb', [{ test: 'return within 7 days seal' }]);
check('the AI search finds it', r.ok && r.result.found.some((f) => /seal is unopened/.test(f.text)), r.error || r.result.found);
check('status added, by the owner', byPath('/refund-policy').status === 'added' && byPath('/refund-policy').by, byPath('/refund-policy'));

// 5. the page changes: read again -> back to draft; add again -> the old copy archived
refundText = 'Returns are accepted within 10 days now. The customer pays the return delivery, and the item must be unused in its box.';
r = await owner('erpSiteRead', [{}]);
d = r.result;
check('read again from the saved address: the changed page is a draft again, others unchanged count', r.ok && byPath('/refund-policy').status === 'draft' && d.lastRead.changed >= 1, r.error || d.lastRead);
r = await owner('erpSitePageAct', [{ ids: [byPath('/refund-policy').id], action: 'add' }]);
docs = await sql`select title, archived, body from kb_docs where business_id = ${FIX.B} and title like 'Website: Refund%' order by created_at`;
check('re-added: the old copy archived, the new one live', docs.length === 2 && docs[0].archived && !docs[1].archived && /10 days/.test(docs[1].body), docs.map((x) => [x.archived, x.body.slice(0, 40)]));

// 6. product page -> the product's description; an existing description is kept unless overwrite
d = r.result;
await owner('erpProductAiSave', [{ sku: PLA, description: 'Our own words', facts: {} }]);
r = await owner('erpSitePageAct', [{ ids: [byPath('/product/pla-black').id], action: 'add' }]);
let pa = (await sql`select description from product_ai where business_id = ${FIX.B} and sku = ${PLA}`)[0];
check('an existing description is kept without overwrite', r.ok && r.result.kept === 1 && pa.description === 'Our own words', r.error || pa);
d = r.result;
r = await owner('erpSitePageAct', [{ ids: [byPath('/product/pla-black').id], action: 'add', overwrite: true }]);
pa = (await sql`select description, updated_by from product_ai where business_id = ${FIX.B} and sku = ${PLA}`)[0];
check('overwrite: the website text becomes the description', r.ok && /Matte black PLA/.test(pa.description) && /Website/.test(pa.updated_by), r.error || pa);

// 7. skip and put back
d = r.result;
r = await owner('erpSitePageAct', [{ ids: [byPath('/about-us').id], action: 'skip' }]);
d = r.result;
check('skipped', byPath('/about-us').status === 'skipped', byPath('/about-us'));
r = await owner('erpSitePageAct', [{ ids: [byPath('/about-us').id], action: 'draft' }]);
d = r.result;
check('put back to check', byPath('/about-us').status === 'draft', byPath('/about-us'));
r = await owner('erpSitePageAct', [{ ids: [byPath('/about-us').id], action: 'burn' }]);
check('a strange action is refused', !r.ok, r.ok);

// 8. an unmatched product page needs a product first
await sql`update site_pages set sku = null, status = 'draft' where business_id = ${FIX.B} and url like '%pla-black%'`;
r = await owner('erpSitePageAct', [{ ids: [byPath('/product/pla-black').id], action: 'add' }]);
check('unmatched product page: asks for the product', !r.ok && /choose the product/.test(r.error), r.error);
r = await owner('erpSitePageAct', [{ ids: [byPath('/product/pla-black').id], action: 'add', sku: 'NO-SUCH', overwrite: true }]);
check('a wrong code is refused', !r.ok && /not here/.test(r.error), r.error);
r = await owner('erpSitePageAct', [{ ids: [byPath('/product/pla-black').id], action: 'add', sku: PLA.toLowerCase(), overwrite: true }]);
check('choosing the product by its code adds it', r.ok && r.result.added === 1, r.error || r.result);

// 9. WooCommerce: the shop's product texts come in by code, the /product/ pages are not read twice
await sql`insert into business_config (business_id, key, value) values (${FIX.B}, 'website_kind', 'woo'), (${FIX.B}, 'store_url', 'https://shop.test')
          on conflict (business_id, key) do update set value = excluded.value`;
await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, 'WOO_KEY', 'ck_test'), (${FIX.B}, 'WOO_SECRET', 'cs_test')
          on conflict (business_id, key) do update set value = excluded.value`;
web.on(/shop\.test\/wp-json\/wc\/v3\/products/, () => ({ status: 200, body: [
  { id: 7, name: pName, sku: PLA, permalink: 'https://shop.test/product/pla-black-woo/', short_description: '<p>Woo short text</p>', description: '<p>Woo long description of the black PLA spool, 1 kg.</p>' },
  { id: 8, name: 'Something we do not stock', sku: 'ZZZ-1', permalink: 'https://shop.test/product/zzz/', short_description: '', description: '<p>A thing that is not in this ERP at all, sold only online.</p>' }] }));
hits.length = 0;
r = await owner('erpSiteRead', [{}]);
d = r.result;
const woo = d.pages.filter((x) => x.source === 'woo');
check('woo products came in, matched by code', woo.length === 2 && woo.find((x) => x.sku === PLA) && woo.find((x) => /not in this ERP/.test(x.preview) && !x.sku), woo);
check('product pages on the site are not read again', !hits.some((h) => /\/product\/pla-black\/?$/.test(h)), hits);

// 10. the other business sees none of it
const other = (await sql`select count(*)::int n from site_pages where business_id <> ${FIX.B}`)[0].n;
check('another business untouched', other === 0, other);
check('kb grew only by what was added', (await sql`select count(*)::int n from kb_docs where business_id = ${FIX.B}`)[0].n === kb0 + 2, kb0);
await done();
