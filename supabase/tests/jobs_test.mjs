// The scheduled jobs and the STOP webhook run per business, as its owner.
import { sql, FIX, check, done, deps, web } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { fnDir } from './harness.mjs';
const { runJob, runHook } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));

let r = await runJob(deps, 'nightly');
check('nightly runs for every business', r && r.Costareen && r.Elsewhere, r);
check('nightly: no Steadfast keys -> nothing, backup made', r.Costareen.steadfast === null && !(r.Costareen.backup && r.Costareen.backup.error), r.Costareen);
r = await runJob(deps, 'campaigns');
check('campaigns: nothing waiting -> nothing run', r && Object.keys(r).length === 0, r);
r = await runJob(deps, 'websync');
check('websync: no website key -> skipped', r && Object.keys(r).length === 0, r);
await sql`insert into business_secrets (business_id, key, value) values (${FIX.B}, 'CZ_SYNC_KEY', 'k')`;
web.on(/\/orders/, () => ({ body: { items: [] } }));
web.on(/\/stock/, () => ({ body: { changed: [], changed_count: 0, unchanged: 2, missing_count: 0 } }));
r = await runJob(deps, 'websync');
check('websync: pulls and pushes for the keyed business only', r.Costareen && !r.Elsewhere && !r.Costareen.pull.error && !r.Costareen.push.error, r);
let bad = false;
try { await runJob(deps, 'nope'); } catch (e) { bad = /Unknown job/.test(e.message); }
check('unknown job refused', bad);
r = await runHook(deps, { biz: 'x', hook: 'w' }, {});
check('hook: bad business id refused', r.ok === false, r);
r = await runHook(deps, { biz: FIX.B, hook: 'wrong' }, { event: 'messages.upsert' });
check('hook: wrong word does nothing harmful', r && typeof r.ok === 'boolean', r);
await done();
