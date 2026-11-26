// studio-1 (26 Nov 2026): the Content desk Studio. A manager types a prompt -> a project + a queued job; the engine (here
// simulated with SQL) runs it and leaves a hidden content_videos row; feedback queues the next version and keeps the log;
// save / draft (the video joins the desk list) / improve; own rules (write, strike out, "only this video"); the owner
// reads everyone's rules and videos, a salesperson is refused; the bell shows a finished version until it is opened;
// the notify timer marks each finished job once; the other business never sees any of it.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner as owner0, mgr as mgr0, sales as sales0, check, done, fnDir, deps } from './harness.mjs';

const un = (x) => (x && x.ok && 'result' in x ? x.result : x);
const owner = async (n, a) => un(await owner0(n, a)), mgr = async (n, a) => un(await mgr0(n, a)), sales = async (n, a) => un(await sales0(n, a));
const B = FIX.B, B2 = FIX.B2;
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const { studioNotifyTick } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'studio.js')));

// the desk must be open for the business
let r = await mgr('erpStudio', []);
check('studio refused while the Content desk is off', r && r.error && /চালু হয়নি/.test(r.error), r);
await sql`insert into erp_app_flags (key, enabled) values ('contentdesk', true) on conflict (key) do update set enabled = true`;

r = await sales('erpStudio', []);
check('a salesperson cannot use the studio', r && r.error, r);
r = await mgr('erpStudio', []);
check('manager opens the studio (empty)', r && Array.isArray(r.projects) && r.projects.length === 0 && r.queue.waiting === 0, r);

r = await mgr('erpStudioAsk', [{ prompt: 'x' }]);
check('a too-short prompt is refused', r && r.error, r);
r = await mgr('erpStudioAsk', [{ prompt: 'Niacinamide serum নিয়ে বাংলায় ৩০ সেকেন্ডের ভিডিও' }]);
check('a prompt makes a project and a queued job', r && r.projectId > 0 && r.jobId > 0, r);
const P = r.projectId, J1 = r.jobId;
r = await mgr('erpStudio', []);
check('home shows the project waiting, first in line', r.projects.length === 1 && r.projects[0].job && r.projects[0].job.state === 'queued' && r.projects[0].job.place === 1 && r.queue.mineAhead === 0, r.projects);
r = await mgr('erpStudioAsk', [{ projectId: P, prompt: 'hook জোরে' }]);
check('no feedback before the first version exists', r && r.error, r);

// the engine runs the job (simulated): a hidden video + version 1 + its log line
const v1 = (await sql`insert into content_videos (business_id, title, platform, file_path, bytes, made_by, studio_project, hidden)
                      values (${B}, 'Niacinamide', 'tiktok', ${'content/' + '11111111-1111-4111-8111-111111111111.mp4'}, 1000, 'studio', ${P}, true) returning id`)[0].id;
await sql`update content_studio_jobs set state = 'done', version = 1, video_id = ${v1}, note = '৩২ সেকেন্ড, ৯টা দৃশ্য', started_at = now(), finished_at = now() where id = ${J1}`;
await sql`update content_studio_projects set version = 1, video_id = ${v1} where id = ${P}`;
await sql`insert into content_studio_msgs (business_id, project_id, body, version, job_id) values (${B}, ${P}, 'v1: ৩২ সেকেন্ড', 1, ${J1})`;

r = await mgr('erpContentDesk', []);
check('a studio version stays out of the desk video list until it is sent to drafts', r && r.videos && !r.videos.some((v) => v.id === Number(v1)), r && r.videos);
r = await mgr('erpAlerts', []);
check('the bell says the video is ready', r && r.alerts.some((a) => a.kind === 'studio' && a.projectId === P), r && r.alerts);
r = await mgr('erpStudioProject', [{ id: P }]);
check('project: one version, the log has the prompt and the engine line', r && r.versions.length === 1 && r.log.length === 2 && r.log[0].engine === false && r.log[1].engine === true, r);
r = await mgr('erpAlerts', []);
check('opening the project clears the bell', r && !r.alerts.some((a) => a.kind === 'studio'), r && r.alerts);

// notify timer: once per finished job
const row = (await owners(sql, [B]))[0];
await sql`insert into business_config (business_id, key, value) values (${B}, 'studio_phones', ${JSON.stringify({})}) on conflict (business_id, key) do update set value = excluded.value`;
r = await asBusiness(deps, row, 'studio:notify', (ctx) => studioNotifyTick(ctx));
const nj = (await sql`select notified_at from content_studio_jobs where id = ${J1}`)[0];
check('the notify timer marks the finished job (no number = no message, still once)', nj.notified_at !== null, r);

await sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`;   // the 5-second gap between asks
// feedback -> the next version, nothing lost
r = await mgr('erpStudioAsk', [{ projectId: P, prompt: 'caption বড় করো' }]);
check('feedback queues the next version', r && r.jobId > J1, r);
const J2 = r.jobId;
r = await mgr('erpStudioAsk', [{ projectId: P, prompt: 'আরেকটা' }]);
check('no second feedback while one is running', r && r.error, r);
const v2 = (await sql`insert into content_videos (business_id, title, platform, file_path, bytes, made_by, studio_project, hidden)
                      values (${B}, 'Niacinamide', 'tiktok', ${'content/' + '22222222-2222-4222-8222-222222222222.mp4'}, 1000, 'studio', ${P}, true) returning id`)[0].id;
await sql`update content_studio_jobs set state = 'done', version = 2, video_id = ${v2}, finished_at = now() where id = ${J2}`;
await sql`update content_studio_projects set version = 2, video_id = ${v2} where id = ${P}`;
const mgrId = (await sql`select user_id from content_studio_projects where id = ${P}`)[0].user_id;
const rule = (await sql`insert into content_studio_rules (business_id, user_id, kind, body, source, project_id) values (${B}, ${mgrId}, 'rule', 'caption বড়', 'মতামত থেকে', ${P}) returning id`)[0].id;
r = await mgr('erpStudioProject', [{ id: P }]);
check('two versions, v1 still there; the remembered rule is shown', r.versions.length === 2 && r.versions[0].version === 1 && r.remembered.length === 1, r);

// finish
r = await mgr('erpStudioFinish', [{ projectId: P, action: 'save' }]);
check('save', r && r.state === 'saved', r);
r = await mgr('erpStudioFinish', [{ projectId: P, action: 'draft' }]);
check('draft', r && r.state === 'draft' && r.videoId === Number(v2), r);
r = await mgr('erpContentDesk', []);
check('after "draft" the version is in the desk video list (v1 still hidden)', r.videos.some((v) => v.id === Number(v2)) && !r.videos.some((v) => v.id === Number(v1)), r.videos);
await sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`;
r = await mgr('erpStudioFinish', [{ projectId: P, action: 'improve' }]);
check('improve queues another version', r && r.jobId > J2, r);
r = await mgr('erpStudioFinish', [{ projectId: P, action: 'nonsense' }]);
check('an unknown finish action is refused', r && r.error, r);

// flooding: 5 open jobs per person at most, 5 s between asks
await sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`;
r = await mgr('erpStudioAsk', [{ prompt: 'দ্রুত দুটো পাঠানো এক' }]);
const r2 = await mgr('erpStudioAsk', [{ prompt: 'দ্রুত দুটো পাঠানো দুই' }]);
check('a second ask within 5 seconds is refused', r && r.jobId && r2 && r2.error && /থামুন/.test(r2.error), [r, r2]);
for (let k = 0; k < 4; k++) { await sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`; await mgr('erpStudioAsk', [{ prompt: 'লাইনে ভিডিও ' + k }]); }
await sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`;
r = await mgr('erpStudioAsk', [{ prompt: 'ষষ্ঠটা' }]);
check('no more than 5 open jobs per person', r && r.error && /লাইনে আছে/.test(r.error), r);
// rules
r = await mgr('erpStudioRuleSave', [{ kind: 'term', body: '"গ্লো" না বলে "উজ্জ্বল"' }]);
check('own rule written', r && r.id > 0, r);
const R2 = r.id;
r = await mgr('erpStudioForget', [{ ruleId: rule }]);
check('"only this video": the remembered rule is struck out', r && r.ok, r);
r = await mgr('erpStudioRuleRemove', [{ id: R2 }]);
check('own rule struck out', r && r.ok, r);
r = await mgr('erpStudioRules', []);
check('rules: both kept as history (inactive), locked owner rules listed, feedback log has 2+ lines', r.rules.length === 2 && r.rules.every((x) => !x.active) && r.locked.length > 3 && r.feedback.length >= 3, r);
const keep = await sql`select count(*)::int n from content_studio_rules where business_id = ${B}`;
check('nothing deleted', keep[0].n === 2);

// the owner reads everyone; cannot give feedback on someone else's video
r = await owner('erpStudio', []);
check('owner sees the manager\'s project', r && r.projects.some((p) => p.id === P && !p.mine), r);
r = await owner('erpStudioRules', [{ userId: mgrId }]);
check('owner reads the manager\'s rules', r && r.rules.length === 2 && !r.mine, r);
r = await mgr('erpStudioRules', [{ userId: FIX.U.owner }]);
check('the manager cannot read another person\'s rules', r && r.error, r);
r = await owner('erpStudioAsk', [{ projectId: P, prompt: 'owner feedback' }]);
check('owner cannot write feedback into the manager\'s video', r && r.error, r);

// phone
r = await mgr('erpStudioPhone', [{ phone: '123' }]);
check('a bad number is refused', r && r.error, r);
r = await mgr('erpStudioPhone', [{ phone: '01711111111' }]);
check('number saved', r && r.phone === '01711111111', r);

// the other business
const other = await sql`select count(*)::int n from content_studio_projects where business_id = ${B2}`;
check('the other business has nothing', other[0].n === 0);

done();
