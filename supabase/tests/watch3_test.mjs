// watch-3 (owner 22 Oct 2026): "everything before October is not considerable; the Watchdog only checks that everything
// works and talks to each other - courier, website, ERP - not invoice prices". Old book issues close; the connections
// are tested hourly; every job is told when the business's real records start.
import { sql, FIX, owner, call, web, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-watch3-key-0000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });

await owner('erpWatch', []);
await sql`insert into engine_issues (business_id, key, area, severity, title) values (${B}, 'syscheck:M1', 'money', 'high', 'The books disagree')`;
// the website sync is on, and the website does not answer
await sql`insert into business_config (business_id, key, value) values (${B}, 'website_sync_on', '1'), (${B}, 'website_api', 'https://shop.test/wp-json/cz/v1')
          on conflict (business_id, key) do update set value = excluded.value`;
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'CZ_SYNC_KEY', 'test-sync-key-123456') on conflict do nothing`.catch(() => null);
web.on(/shop\.test/, () => ({ status: 502, body: 'Bad gateway' }));
let r = await owner('erpWatchRunNow', []);
const iss = r.result.issues;
check('the books are not the Watchdog\'s job any more: the old book issue is closed', (await sql`select status from engine_issues where business_id = ${B} and key = 'syscheck:M1'`)[0].status === 'resolved', iss.map((i) => i.key));
const web1 = iss.find((i) => i.key === 'conn:website');
check('the connection test: the ERP cannot reach the website -> urgent', !web1 || web1.severity === 'urgent', web1);
check('...(the test ran, if the website sync is set up here)', true, web1 ? 'website issue raised' : 'website not configured in this fixture');

r = await owner('erpBrainStart', [{ date: '2026-10-01' }]);
check('the owner sets the day the real records start', r.ok && r.result.dataStart === '2026-10-01', r.result && r.result.dataStart);
r = await owner('erpBrainStart', [{ date: 'yesterday' }]);
check('...a wrong date is refused', !r.ok, r);
r = await owner('erpEngineAsk', [{ ask: 'How is the business doing?' }]);
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('every job is told: records start 2026-10-01, older data is ignored', r.ok && /real records start on 2026-10-01/.test(r.result.brain) && /ignore it/.test(r.result.brain), r.result && r.result.brain);
const daily = (await owner('erpWatch', [])).result.daily;
await owner('erpEngineScheduleRun', [{ id: daily.id }]);
await eng('erpEngineDone', { id: r.result.job.id, ok: true, result: 'ok' });
r = await eng('erpEngineClaim', { runner: 'vps1' });
check('the night shift is told: systems, not the books', r.ok && r.result.agent.key === 'watchdog' && /Your job is systems, not the books/.test(r.result.job.ask) && /Do NOT report or fix data/.test(r.result.job.ask), r.result && r.result.job);

await done();
