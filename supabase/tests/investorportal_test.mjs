// FilaDash merge P3: the investor's own page (112_investor_links.sql, handlers/investorportal.js).
// Run: TEST_SCRIPT=investorportal_test.mjs ... erp_server_test.py
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const R = { asBusiness, owners, tenantDeps: null };
const call = async (method, q, body, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, method === 'GET'
  ? { method, headers: { 'x-forwarded-for': ip || '10.0.0.1' } }
  : { method, headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || '10.0.0.1' }, body: JSON.stringify(body) }), R)).body;

const B = FIX.B;
// an investor paid by shipment profit, who funded half a shipment, and one other investor
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values (${B}, 'IP-1', 'Portal PLA', 'Filaments', 'T', 'PLA', 0, 300, 'Active')`;
let r = await mgr('erpReceiveShipment', [{ reference: 'IP-SHIP', mode: 'bdt', totalBdt: 1000, lines: [{ sku: 'IP-1', qty: 10 }] }]);
await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Nadia Investor', returnKind: 'lot', returnValue: 50, invested: 500 }]);
await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Other Person', returnKind: 'monthly', returnValue: 2000, invested: 90000 }]);
const H = (await sql`select holder_no from capital_holders where business_id = ${B} and name = 'Nadia Investor'`)[0].holder_no;
await owner('erpLotFund', [{ holder: H, reference: 'IP-SHIP', pct: 50 }]);
await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'IP-1', qty: 4 }], payMode: 'full' }]);

// ---- the link
r = await mgr('erpInvestorLink', [{ holder: H }]);
check('only the owner makes the link', !r.ok, r);
r = await owner('erpInvestorLink', [{ holder: H, api: 'https://abc.supabase.co/functions/v1/erp' }]);
check('a link and an 8-digit code', r.ok && /investor\.html\?t=[A-Za-z0-9_-]{20,}&api=/.test(r.result.url) && /^\d{8}$/.test(r.result.code), r.result);
const t = new URL(r.result.url).searchParams.get('t'), code = r.result.code;
const kept = await sql`select token_hash, code_hash from investor_links where business_id = ${B} and holder_no = ${H}`;
check('only hashes are kept', kept.length === 1 && kept[0].token_hash !== t && !kept[0].code_hash.includes(code), kept);

// ---- the page
let p = await call('GET', 'pub=investor&t=' + t);
check('without the code: whose page it is, no figures', p.ok && p.needCode && p.name === 'Nadia' && p.capital === undefined, p);
p = await call('POST', 'pub=investor', { t, code: '12345678' });
check('a wrong code is refused', !p.ok && /not right/.test(p.error), p);
p = await call('POST', 'pub=investor', { t, code });
check('the right code opens their statement', p.ok && p.name === 'Nadia Investor' && p.capital === 500, p);
// 4 sold at 300, cost 100: profit 800; their 50% = 400; they get 50% of it = 200 (this month, building)
check('their return this month: 4 x 200 x 50% x 50% = 200 building', p.building === 200 && p.months[0].running === true, p.months);
check('their shipment', p.shipments.length === 1 && p.shipments[0].reference === 'IP-SHIP' && p.shipments[0].earned === 200 && p.shipments[0].share === 50, p.shipments);
check('nothing about anyone else', !JSON.stringify(p).includes('Other Person') && !JSON.stringify(p).includes('90000'), 0);

// ---- locking after five wrong codes
for (let i = 0; i < 5; i++) await call('POST', 'pub=investor', { t, code: '00000000' }, '10.0.0.9');
p = await call('POST', 'pub=investor', { t, code }, '10.0.0.9');
check('five wrong codes lock it, even for the right code', !p.ok && /15 minutes/.test(p.error), p);
await sql`update investor_links set locked_until = null, failed = 0 where business_id = ${B}`;
// fix-3 M17: nine wrong codes and the right one at the same moment - the lock still holds
const many = await Promise.all(Array.from({ length: 10 }, (_, i) => call('POST', 'pub=investor', { t, code: i === 9 ? code : '0000000' + i }, '10.0.1.' + i)));
const lk = (await sql`select failed, locked_until from investor_links where business_id = ${B} and revoked_at is null`)[0];
check('(M17) ten tries at once count as ten: the link is locked after them', lk.locked_until && new Date(lk.locked_until) > new Date() && many.filter((x) => x.ok).length <= 1, [lk, many.filter((x) => x.ok).length]);
p = await call('POST', 'pub=investor', { t, code }, '10.0.0.10');
check('(M17) ...so the right code waits 15 minutes too', !p.ok && /15 minutes/.test(p.error), p);
await sql`update investor_links set locked_until = null, failed = 0 where business_id = ${B}`;

// ---- a new link replaces the old; switching it off
r = await owner('erpInvestorLink', [{ holder: H }]);
p = await call('GET', 'pub=investor&t=' + t);
check('the old link stops working', !p.ok, p);
const t2 = new URL(r.result.url).searchParams.get('t');
r = await owner('erpInvestorLinkOff', [{ holder: H }]);
p = await call('GET', 'pub=investor&t=' + t2);
check('switched off', r.ok && !p.ok && /switched off/.test(p.error), p);
p = await call('GET', 'pub=investor&t=short');
check('a broken link is refused', !p.ok, p);

await done();
