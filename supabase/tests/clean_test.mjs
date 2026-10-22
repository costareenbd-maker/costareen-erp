// clean-1 (owner 22 Oct 2026): "everything inside the AI looks messy; the daily brief in Bengali; the Dashboard's
// numbers are not the brief's; nothing duplicated". The owner's language for the AI's reports; the Command Center shows
// only the owner's own work; the timed-jobs list only the owner's own schedules.
import { sql, FIX, owner, call, check, done, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const B = FIX.B;
const { keyHash } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
await sql`insert into erp_app_flags (key, enabled) values ('engine', true), ('leads', true) on conflict (key) do update set enabled = true`;
const KEY = 'engine-clean-key-00000000000000000000000000000000000';
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(KEY)}, ${FIX.U.owner}, 'Engine (VPS)')`;
const eng = (name, a) => call(name, [a], { token: { key: KEY, device: 'engine' } });

let r = await owner('erpBrief', [{}]);
check('the brief\'s language starts as English', r.ok && r.result.lang === 'en', r.result && r.result.lang);
r = await owner('erpBriefSettings', [{ lang: 'bn' }]);
check('the owner picks বাংলা', r.ok && r.result.lang === 'bn', r.result && r.result.lang);
r = await owner('erpBriefSettings', [{ lang: 'fr' }]);
check('...an unknown language is refused', !r.ok, r);
const sch = (await sql`select ask from engine_schedules where business_id = ${B} and key = 'daily-brief'`)[0];
check('the evening brief is now asked in Bangla (customer texts keep the customers\' language)', /in Bangla/.test(sch.ask) && /stay in the language the customers use/.test(sch.ask), sch.ask.slice(-200));
await owner('erpWatch', []);
const night = (await sql`select ask from engine_schedules where business_id = ${B} and key = 'watchdog-daily'`)[0];
check('...and so is the Watchdog\'s night report', /in Bangla/.test(night.ask), night.ask.slice(-160));

// the Command Center: the owner's own work only
await owner('erpBriefRunNow', []);
await owner('erpLeadResearch', [{ kind: 'customer' }]);
await owner('erpEngineAsk', [{ ask: 'My own question' }]);
await owner('erpEngineScheduleSave', [{ title: 'Friday ads', ask: 'Suggest 3 ads', every: 'weekly', weekday: 5, at: '10:00' }]);
r = await owner('erpEngine', [{}]);
const titles = r.result.jobs.map((j) => j.title);
check('the Command Center lists the owner\'s question, not the brief or the lead search (they have their own screens)', titles.includes('My own question') && !titles.includes('Daily brief') && !titles.some((t) => /leads/.test(t)), titles);
check('...the timed jobs: only the owner\'s own (the brief / night check / lead search times are on their own screens)', r.result.schedules.length === 1 && r.result.schedules[0].title === 'Friday ads', r.result.schedules.map((s) => s.title));

await done();
