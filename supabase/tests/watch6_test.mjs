// watch-6 (owner 22 Oct 2026: "let it clear cache and restart the site"): the Engine reports each website repair it made
// (by itself after 10 minutes down, or in the night shift); the Watchdog shows it honestly - fixed when the page answers
// again (its problem closes), "tried - still not working" when it does not.
import { sql, FIX, owner, call, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-watch6-key-0000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });

let r = await owner('erpWatchTargetSave', [{ url: 'https://shop.test/', label: 'Website home page' }]);
const T = r.result.targets.find((t) => t.url === 'https://shop.test/');
await eng('erpEngineClaim', { runner: 'vps1', info: { sites: [B] } });
r = await owner('erpWatch', []);
check('the Watchdog knows the Engine can repair this business\'s website', r.ok && r.result.siteRepair === true, r.result && r.result.siteRepair);

r = await owner('erpWatchSiteAction', [{ biz: B, action: 'restart', ok: true }]);
check('only the Engine reports a website repair', !r.ok, r);
await eng('erpWatchReport', { biz: B, results: [{ id: T.id, status: 0, ms: 30000, error: 'ECONNREFUSED' }] });
r = await eng('erpWatchSiteAction', { biz: B, action: 'restart', ok: true, text: 'Website restarted. The website answers again.', targetId: T.id, auto: true });
check('the Engine reports the restart it made by itself', r.ok, r);
await eng('erpWatchReport', { biz: B, results: [{ id: T.id, status: 200, ms: 800 }] });
r = await owner('erpWatch', []);
let a = r.result.fixed.find((x) => /Website restarted/.test(x.title));
check('the page answers again: the restart shows as FIXED, by itself', a && a.state === 'fixed' && a.autoDone && /answers again/.test(a.result), a);

await eng('erpWatchReport', { biz: B, results: [{ id: T.id, status: 503, ms: 900 }] });
r = await eng('erpWatchSiteAction', { biz: B, action: 'restart', ok: false, text: 'Website restarted. The website is still down - it is the hosting itself.', targetId: T.id, auto: true });
r = await owner('erpWatch', []);
a = r.result.fixed.find((x) => /still down/.test(x.result));
check('a restart that did not bring it back is said so (could not be done) and the problem stays open', a && a.state === 'failed' && r.result.openIssues.some((i) => i.key === 'web:' + T.id), a);
r = await eng('erpWatchSiteAction', { biz: B, action: 'clear_cache', ok: true, text: 'Website cache cleared (page cache + WordPress cache).', why: 'Prices looked old' });
r = await owner('erpWatch', []);
check('the night shift\'s cache clear is listed with its reason', r.result.fixed.some((x) => x.title === 'Website cache cleared: Prices looked old'), r.result.fixed.map((x) => x.title));
r = await eng('erpWatchSiteAction', { biz: FIX.B2, action: 'restart', ok: true });
check('never for a business the Engine does not work for', !r.ok, r);

await done();
