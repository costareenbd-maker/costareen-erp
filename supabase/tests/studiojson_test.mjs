// studiojson-1 (28 Nov 2026): a "JSON video prompt" in the Content desk Studio (migration 189: msgs.spec + jobs.spec).
// A manager sends a JSON with a prompt, alone (the prompt may then be empty), or with a feedback; bad JSON is refused with
// a plain Bangla line that says where; a JSON that is not an object/list, an empty one or one over 1 MB is refused;
// without a JSON the 3-character rule stays; the work log and the engine's job row carry it; a salesperson is refused;
// the other business stays untouched.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner as owner0, mgr as mgr0, sales as sales0, check, done, fnDir } from './harness.mjs';

const un = (x) => (x && x.ok && 'result' in x ? x.result : x);
const owner = async (n, a) => un(await owner0(n, a)), mgr = async (n, a) => un(await mgr0(n, a)), sales = async (n, a) => un(await sales0(n, a));
const B = FIX.B, B2 = FIX.B2;
const js = (v) => (typeof v === 'string' ? JSON.parse(v) : v);
const older = () => sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`;   // the 5-second gap between asks
const { specOf, specScenes, specWhere } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'studio.js')));

await sql`insert into erp_app_flags (key, enabled) values ('contentdesk', true) on conflict (key) do update set enabled = true`;

const SPEC = {
  title: 'Sunscreen ভুল ৩টা',
  duration: '30s', style: 'calm explainer, soft light', language: 'bn',
  scenes: [
    { scene: 1, shot: 'close-up of hands applying sunscreen', voiceover: 'রোদে বের হওয়ার আগে sunscreen দেন?', on_screen_text: 'ভুল ১', camera: 'slow push' },
    { scene: 2, shot: 'Rini by the window', voiceover: 'দুই আঙুল পরিমাণ লাগে।', on_screen_text: 'ভুল ২' },
    { scene: 3, shot: 'Dhaka street, sun', voiceover: 'দুই ঘণ্টা পর আবার দিন।', on_screen_text: 'ভুল ৩' },
  ],
  music_mood: 'soft',
};
const TEXT = JSON.stringify(SPEC, null, 2);

// pure checks (the page shows the same words)
check('specOf: text is parsed, an object passes as it is', JSON.stringify(specOf(TEXT)) === JSON.stringify(SPEC) && specOf(SPEC) === SPEC);
check('specOf: nothing = no spec', specOf(undefined) === null && specOf('') === null && specOf('   ') === null);
check('specScenes: finds the scene list (top level, one level down, or a list itself)', specScenes(SPEC).length === 3 && specScenes({ video: { shots: [1, 2] } }).length === 2 && specScenes([1, 2, 3, 4]).length === 4 && specScenes({ a: 1 }) === null);
const w = specWhere('{\n  "a": 1,\n}'), w2 = specWhere('{"a":tru}'), w3 = specWhere('[1,2');
check('specWhere: the first wrong character as line and column (a trailing comma, a broken word, a missing end)', w && w.line === 3 && w.col === 1 && w2.col === 6 && !w2.end && w3.end && specWhere(TEXT) === null, [w, w2, w3]);

// refusals
let r = await sales('erpStudioAsk', [{ prompt: '', spec: TEXT }]);
check('a salesperson cannot send a JSON', r && r.error, r);
r = await mgr('erpStudioAsk', [{ prompt: '', spec: '{"scenes": [ {"shot": "a"}, ]}' }]);
check('bad JSON is refused in plain Bangla with where (line / column)', r && r.error && /JSON-টা ঠিক নেই/.test(r.error) && /নম্বর লাইন/.test(r.error), r);
r = await mgr('erpStudioAsk', [{ prompt: '', spec: '{"scenes": [' }]);
check('an unfinished JSON says the end is missing', r && r.error && /অসম্পূর্ণ/.test(r.error), r);
r = await mgr('erpStudioAsk', [{ prompt: 'ভিডিও', spec: '"just a string"' }]);
check('a JSON that is only a string is refused', r && r.error && /\{ \}/.test(r.error), r);
r = await mgr('erpStudioAsk', [{ prompt: '', spec: '{}' }]);
check('an empty JSON is refused', r && r.error && /খালি/.test(r.error), r);
r = await mgr('erpStudioAsk', [{ prompt: '', spec: JSON.stringify({ scenes: [{ text: 'ক'.repeat(400000) }] }) }]);
check('a JSON over 1 MB is refused', r && r.error && /১ MB/.test(r.error), r);
r = await mgr('erpStudioAsk', [{ prompt: 'x' }]);
check('without a JSON the 3-character rule stays', r && r.error && /একটু লিখুন/.test(r.error), r);
check('nothing was written by the refusals', (await sql`select count(*)::int n from content_studio_jobs`)[0].n === 0);

// a JSON alone makes a video
r = await mgr('erpStudioAsk', [{ prompt: '', spec: TEXT }]);
check('a JSON-only ask works (empty prompt)', r && r.projectId > 0 && r.jobId > 0 && r.spec === true, r);
const P = r.projectId, J1 = r.jobId, M1 = r.msgId;
const job = (await sql`select prompt, spec, kind from content_studio_jobs where id = ${J1}`)[0];
check('the engine\'s job row carries the JSON as she wrote it (same key order)', job.kind === 'new' && job.prompt === '' && JSON.stringify(js(job.spec)) === JSON.stringify(SPEC), job);
r = await mgr('erpStudio', []);
check('the project is named from the JSON title', r.projects.find((p) => p.id === P).title === 'Sunscreen ভুল ৩টা', r.projects);
r = await mgr('erpStudioProject', [{ id: P }]);
const lm = r && r.log && r.log.find((m) => m.id === M1);
check('the work log shows the JSON with the prompt line', lm && lm.spec && lm.spec.scenes.length === 3 && lm.body === '', lm);

// a JSON with no title: named by its scenes
await older();
r = await mgr('erpStudioAsk', [{ prompt: '', spec: [{ shot: 'a' }, { shot: 'b' }] }]);
check('a JSON list alone works; the project is named by its scene count', r && r.projectId > 0, r);
r = await mgr('erpStudio', []);
check('…title "JSON ভিডিও · ২টা দৃশ্য"', r.projects.some((p) => p.title === 'JSON ভিডিও · ২টা দৃশ্য'), r.projects.map((p) => p.title));

// a JSON with a prompt: the prompt names the project; an old-style ask carries no JSON
await older();
r = await mgr('erpStudioAsk', [{ prompt: 'এই JSON মেনে, শেষে প্রশ্ন দিয়ে', spec: TEXT }]);
const P3 = r.projectId;
r = await mgr('erpStudio', []);
check('a JSON with a prompt: the prompt names the project', r.projects.find((p) => p.id === P3).title === 'এই JSON মেনে, শেষে প্রশ্ন দিয়ে', r.projects);
await older();
r = await mgr('erpStudioAsk', [{ prompt: 'JSON ছাড়া সাধারণ ভিডিও' }]);
const plain = (await sql`select spec from content_studio_jobs where id = ${r.jobId}`)[0];
check('an ask without JSON keeps spec empty (old engine path)', plain.spec === null, plain);

// feedback with a JSON (after the first version); a JSON-only feedback is enough
const v1 = (await sql`insert into content_videos (business_id, title, platform, file_path, bytes, made_by, studio_project, hidden)
                      values (${B}, 'Sunscreen', 'tiktok', ${'content/' + '44444444-4444-4444-8444-444444444444.mp4'}, 1000, 'studio', ${P}, true) returning id`)[0].id;
await sql`update content_studio_jobs set state = 'done', version = 1, video_id = ${v1}, finished_at = now() where id = ${J1}`;
await sql`update content_studio_projects set version = 1, video_id = ${v1} where id = ${P}`;
await older();
r = await mgr('erpStudioAsk', [{ projectId: P, prompt: '', spec: '{"change": [{"scene": 2, "on_screen_text": "বড় করে"}]}' }]);
check('a JSON-only feedback queues the next version', r && r.jobId > J1 && r.spec === true, r);
const J2 = r.jobId, M2 = r.msgId;
const j2 = (await sql`select kind, spec from content_studio_jobs where id = ${J2}`)[0];
check('the feedback job is a revise and carries its own JSON', j2.kind === 'revise' && js(j2.spec).change[0].scene === 2, j2);
await sql`update content_studio_jobs set state = 'done', version = 2, video_id = ${v1}, finished_at = now() where id = ${J2}`;
await older();
r = await mgr('erpStudioAsk', [{ projectId: P, prompt: 'x' }]);
check('without a JSON a too-short feedback is still refused', r && r.error, r);
r = await mgr('erpStudioProject', [{ id: P }]);
check('the log keeps both JSONs on their own lines', r.log.find((m) => m.id === M1).spec.scenes && r.log.find((m) => m.id === M2).spec.change, r.log);
r = await mgr('erpStudioRules', [{}]);
check('the feedback log names a JSON-only line "JSON প্রম্পট"', r && r.feedback.some((f) => f.id === M2 && f.body === 'JSON প্রম্পট' && f.spec), r && r.feedback);

// the owner reads it; the other business is untouched
r = await owner('erpStudioProject', [{ id: P }]);
check('the owner reads the manager\'s JSON in the log', r && r.log.find((m) => m.id === M1).spec.title === SPEC.title, r);
const other = await sql`select (select count(*)::int from content_studio_jobs where business_id = ${B2}) j, (select count(*)::int from content_studio_msgs where business_id = ${B2}) m`;
check('the other business has no studio jobs or log lines', other[0].j === 0 && other[0].m === 0, other);

done();
