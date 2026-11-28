// studiosteps-1 (28 Nov 2026): the step-by-step Content desk Studio (migration 190, handlers/studiosteps.js).
// idea -> 4 pictures (jobs for the PC engine, the day's picture cap, waiting rows) -> ticks / remake / change with a note /
// free feedback -> scene cards (his edits, AI ask, move, add, remove) -> the video job from the cards -> feedback; the
// one-shot path refuses a step project's feedback; the engine reads picture links and gets upload addresses with its key;
// a salesperson and another person are refused; the other business stays untouched.
import { sql, FIX, owner as owner0, mgr as mgr0, sales as sales0, check, done } from './harness.mjs';

const un = (x) => (x && x.ok && 'result' in x ? x.result : x);
const owner = async (n, a) => un(await owner0(n, a)), mgr = async (n, a) => un(await mgr0(n, a)), sales = async (n, a) => un(await sales0(n, a));
const B = FIX.B, B2 = FIX.B2;
await sql`insert into erp_app_flags (key, enabled) values ('contentdesk', true) on conflict (key) do update set enabled = true`;
const made = async (ids, extra) => { for (const id of ids) await sql`update content_studio_pics set state = 'ready', file_path = ${'content/studio-pics/p' + id + '.jpg'}, made_at = now(), what = ${'ছবি ' + id} where id = ${id}`; if (extra) await extra(); };
const finish = (j) => sql`update content_studio_jobs set state = 'done', finished_at = now() where id = ${j}`;

// refusals before anything is written
let r = await sales('erpStudioStepsStart', [{ idea: 'স্যালিসাইলিক অ্যাসিড নিয়ে ভিডিও' }]);
check('a salesperson cannot start a step video', r && r.error, r);
r = await mgr('erpStudioStepsStart', [{ idea: 'ab' }]);
check('an idea needs a few words (or a JSON)', r && r.error && /একটু লিখুন/.test(r.error), r);
check('nothing written by the refusals', (await sql`select count(*)::int n from content_studio_projects`)[0].n === 0);

// step 1 -> 2: the idea makes a project in step mode + 4 pictures (one job for the engine)
r = await mgr('erpStudioStepsStart', [{ idea: 'তৈলাক্ত ত্বকে স্যালিসাইলিক অ্যাসিড কখন দরকার - Rini আয়নার সামনে বোঝাবে' }]);
check('the idea starts a step video', r && r.projectId > 0 && r.jobId > 0 && r.waiting === 0, r);
const P = r.projectId, J1 = r.jobId;
let p = (await sql`select * from content_studio_projects where id = ${P}`)[0];
check('the project is in step mode, on the pictures step, the idea kept', p.mode === 'steps' && p.step === 2 && /Rini/.test(p.idea), p);
let pics = await sql`select * from content_studio_pics where project_id = ${P} order by slot`;
check('4 pictures are being made (slots 1-4) by one picture job', pics.length === 4 && pics.every((x, i) => x.slot === i + 1 && x.state === 'making' && Number(x.job_id) === J1), pics.map((x) => [x.slot, x.state]));
let j = (await sql`select * from content_studio_jobs where id = ${J1}`)[0];
check('the job is a picture job, first of the project, not held', j.kind === 'pics' && j.state === 'queued' && j.detail.first === true && j.wait_until === null, j);
r = await mgr('erpStudioSteps', [{ id: P }]);
check('the step view: step 2, 4 pictures making, the day count, the work log and the job', r && r.steps && r.steps.step === 2 && r.steps.pics.length === 4 && r.steps.pics.every((x) => x.state === 'making' && !x.url) &&
  r.steps.day.cap === 30 && r.steps.day.used === 4 && r.steps.day.left === 26 && r.steps.jobs.length === 1 && r.log.length === 1 && r.project.mode === 'steps', r && r.steps);
r = await mgr('erpStudio', []);
check('the home list says the project is a step video', r.projects[0].mode === 'steps' && r.projects[0].step === 2, r.projects[0]);

// the engine (owner + the business's engine key) reads the job and gets upload addresses for the pictures
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'BRAND_BRIDGE_KEY', 'eng-key-9') on conflict (business_id, key) do update set value = excluded.value`;
r = await owner('erpContentStudioSteps', [{ biz: B, key: 'wrong', jobId: J1 }]);
check('the engine call needs the right key', r && r.error, r);
r = await mgr('erpContentStudioSteps', [{ biz: B, key: 'eng-key-9', jobId: J1 }]);
check('the engine call needs the owner', r && r.error, r);
r = await owner('erpContentStudioSteps', [{ biz: B, key: 'eng-key-9', jobId: J1, upload: pics.map((x) => Number(x.id)), picIds: pics.map((x) => Number(x.id)) }]);
check('the engine gets one upload address per picture being made', r && Object.keys(r.uploads).length === 4 && Object.values(r.uploads).every((u) => /studio-pics\/.+\.jpg$/.test(u.path)) && r.pics.length === 4, r);
await made(pics.map((x) => Number(x.id)), () => finish(J1));
await sql`update content_studio_projects set advice = ${sql.json({ pics: '৩ নম্বর ছবিতে লেখা পড়া যাচ্ছে না। আবার বানাব?' })} where id = ${P}`;
r = await mgr('erpStudioSteps', [{ id: P }]);
check('made pictures come with a link; the advice line is there', r.steps.pics.every((x) => x.state === 'ready' && /files\.test/.test(x.url)) && /৩ নম্বর/.test(r.steps.advice.pics) && !r.steps.jobs.length, r.steps);

// cards need a tick first
r = await mgr('erpStudioCardsMake', [{ projectId: P }]);
check('no cards before at least one tick', r && r.error && /✓/.test(r.error), r);
for (const x of pics.slice(0, 3)) await mgr('erpStudioPicSet', [{ id: Number(x.id), approved: true }]);
check('ticks are kept', (await sql`select count(*)::int n from content_studio_pics where project_id = ${P} and approved`)[0].n === 3);

// remake one ("↻ আবার") and change one with a note ("✎ বদলান")
r = await mgr('erpStudioPicRedo', [{ id: Number(pics[3].id) }]);
check('"again" makes a new picture in the same place (same prompt kept)', r && r.picId > 0 && !r.waiting, r);
const again = (await sql`select * from content_studio_pics where id = ${r.picId}`)[0];
const J2 = r.jobId;
check('the old one is kept as replaced, the new one has slot 4 and ask "again"', again.slot === 4 && again.ask === 'again' && again.state === 'making' &&
  (await sql`select state, replaced_by from content_studio_pics where id = ${pics[3].id}`)[0].state === 'replaced', again);
r = await mgr('erpStudioPicRedo', [{ id: Number(pics[3].id) }]);
check('a replaced picture cannot be remade twice', r && r.error, r);
r = await mgr('erpStudioPicRedo', [{ id: Number(pics[1].id), note: 'আলো একটু উষ্ণ করুন' }]);
check('a change note goes to the same waiting job (not yet started)', r && r.jobId === J2, r);
const changed = (await sql`select * from content_studio_pics where id = ${r.picId}`)[0];
check('the changed picture carries his note; the tick on the old one is gone', changed.ask === 'আলো একটু উষ্ণ করুন' && changed.slot === 2 &&
  !(await sql`select approved from content_studio_pics where id = ${pics[1].id}`)[0].approved, changed);
check('his note is in the work log', (await sql`select count(*)::int n from content_studio_msgs where project_id = ${P} and body like '%আলো একটু উষ্ণ%'`)[0].n === 1);
await made([Number(again.id), Number(changed.id)], () => finish(J2));
await mgr('erpStudioPicSet', [{ id: Number(changed.id), approved: true }]);
r = await mgr('erpStudioPicsAsk', [{ projectId: P, feedback: 'সবগুলোতে Rini-র দোপাট্টা গোলাপি রাখুন' }]);
check('free feedback on the pictures makes its own job (the engine decides which to remake)', r && r.jobId > 0, r);
const J3 = r.jobId;
r = await mgr('erpStudioPicsAsk', [{ projectId: P, feedback: 'আরেকটা মতামত' }]);
check('one picture feedback at a time', r && r.error, r);
await finish(J3);

// the day's cap: over it, pictures wait for tomorrow (never refused)
await sql`insert into business_config (business_id, key, value) values (${B}, 'studio_pic_day', '6') on conflict (business_id, key) do update set value = excluded.value`;
r = await mgr('erpStudioPicsMore', [{ projectId: P }]);
check('4 more pictures over the cap: they wait', r && r.made === 4 && r.waiting === 4, r);
const J4 = r.jobId;
j = (await sql`select * from content_studio_jobs where id = ${J4}`)[0];
check('the job waits until tomorrow (Dhaka time)', j.wait_until && new Date(j.wait_until) > new Date(), j);
r = await mgr('erpStudioSteps', [{ id: P }]);
check('the page sees 0 left today and the waiting pictures', r.steps.day.left === 0 && r.steps.pics.filter((x) => x.state === 'waiting').length === 4, r.steps.day);
await sql`update content_studio_jobs set state = 'cancelled' where id = ${J4}`;
await sql`update content_studio_pics set state = 'replaced' where job_id = ${J4}`;
await sql`update business_config set value = '30' where business_id = ${B} and key = 'studio_pic_day'`;

// step 3: cards from the ticked pictures
r = await mgr('erpStudioCardsMake', [{ projectId: P }]);
check('cards are asked for (a cards job, step 3)', r && r.jobId > 0, r);
const J5 = r.jobId;
r = await mgr('erpStudioCardsMake', [{ projectId: P }]);
check('not twice at once', r && r.error, r);
p = (await sql`select step from content_studio_projects where id = ${P}`)[0];
check('the project is on step 3', p.step === 3);
const ok = await sql`select id from content_studio_pics where project_id = ${P} and approved and state = 'ready' order by slot`;
let pos = 0;
for (const x of ok) await sql`insert into content_studio_cards (business_id, project_id, user_id, job_id, pos, pic_id, seconds, line, onscreen)
  values (${B}, ${P}, (select user_id from content_studio_projects where id = ${P}), ${J5}, ${++pos}, ${x.id}, 5, ${'লাইন ' + pos}, ${'লেখা ' + pos})`;
await finish(J5);
r = await mgr('erpStudioSteps', [{ id: P }]);
const cards = r.steps.cards;
check('the cards come in order with picture, seconds, line and on-screen text', cards.length === 3 && cards.every((c, i) => c.pos === i + 1 && c.picId && c.seconds === 5 && c.line && c.onscreen), cards);
r = await mgr('erpStudioCardSave', [{ id: cards[0].id, liked: true }]);
check('"✓ ঠিক" ticks a card', r && r.card.liked, r);
r = await mgr('erpStudioCardSave', [{ id: cards[1].id, line: 'নিজের লেখা লাইন', seconds: 6.5 }]);
check('he edits the words himself (seconds too); his edit is marked his', r && r.card.line === 'নিজের লেখা লাইন' && r.card.seconds === 6.5 && r.card.by === 'him', r);
r = await mgr('erpStudioCardSave', [{ id: cards[1].id, seconds: 60 }]);
check('seconds stay 1-30', r && r.error, r);
r = await mgr('erpStudioCardSave', [{ id: cards[1].id, picId: Number(pics[3].id) }]);
check('a replaced picture cannot be put on a card', r && r.error, r);
r = await mgr('erpStudioCardMove', [{ id: cards[2].id, dir: -1 }]);
const order = (await sql`select id from content_studio_cards where project_id = ${P} and state = 'active' order by pos`).map((x) => Number(x.id));
check('↑ moves a card up', r && r.moved && order[1] === cards[2].id && order[2] === cards[1].id, order);
r = await mgr('erpStudioCardAdd', [{ projectId: P }]);
check('"+ সিন যোগ করুন" adds an empty card at the end with a picture', r && r.card.pos === 4 && r.card.picId && r.card.line === '', r);
const added = r.card.id;
r = await mgr('erpStudioStepVideo', [{ projectId: P }]);
check('no video while a card has no spoken line', r && r.error && /সিন ৪/.test(r.error), r);
r = await mgr('erpStudioCardRemove', [{ id: added }]);
check('a card can be taken out (kept, state removed)', r && r.ok && (await sql`select state from content_studio_cards where id = ${added}`)[0].state === 'removed');
r = await mgr('erpStudioCardAsk', [{ id: cards[0].id, ask: 'আরো ছোট করে বলুন' }]);
check('asking the AI to change one card makes a cards job and marks the card', r && r.jobId > 0 && (await sql`select state from content_studio_cards where id = ${cards[0].id}`)[0].state === 'making', r);
const J6 = r.jobId;
r = await mgr('erpStudioCardSave', [{ id: cards[0].id, line: 'x' }]);
check('a card the AI is changing cannot be edited', r && r.error, r);
r = await mgr('erpStudioStepVideo', [{ projectId: P }]);
check('no video while the AI changes a card', r && r.error, r);
await sql`update content_studio_cards set state = 'active', line = 'ছোট লাইন' where id = ${cards[0].id}`;
await finish(J6);

// step 4: the video from the cards
r = await mgr('erpStudioStepVideo', [{ projectId: P }]);
check('"ভিডিও এডিট করে দিন" makes a render job (step 4)', r && r.jobId > 0, r);
const J7 = r.jobId;
j = (await sql`select * from content_studio_jobs where id = ${J7}`)[0];
check('the render job carries the card count, no feedback', j.kind === 'render' && j.prompt === '' && j.detail.cards === 3 && (await sql`select step from content_studio_projects where id = ${P}`)[0].step === 4, j);
r = await mgr('erpStudioCardSave', [{ id: cards[0].id, line: 'y' }]);
check('cards are locked while the video is made', r && r.error && /ভিডিও তৈরি হচ্ছে/.test(r.error), r);
r = await mgr('erpStudioStepVideo', [{ projectId: P, feedback: 'লেখা বড় করুন' }]);
check('no feedback before the first video', r && r.error, r);
await sql`update content_studio_jobs set state = 'done', version = 1, video_id = null, finished_at = now() where id = ${J7}`;
await sql`update content_studio_projects set version = 1 where id = ${P}`;
await sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`;
r = await mgr('erpStudioAsk', [{ projectId: P, prompt: 'লেখা বড় করুন' }]);
check('the one-shot feedback refuses a step video (its video step has the feedback)', r && r.error && /ধাপে ধাপে/.test(r.error), r);
r = await mgr('erpStudioFinish', [{ projectId: P, action: 'improve' }]);
check('"আরো ভালো করুন" of the one-shot path refuses too', r && r.error, r);
r = await mgr('erpStudioStepVideo', [{ projectId: P, feedback: 'সিন ২-এর লেখা বড় করুন' }]);
check('feedback on the video makes the next render job', r && r.jobId > 0 && (await sql`select prompt from content_studio_jobs where id = ${r.jobId}`)[0].prompt === 'সিন ২-এর লেখা বড় করুন', r);
await finish(r.jobId);
r = await mgr('erpStudioStepGo', [{ projectId: P, step: 3 }]);
check('"সিনের কার্ডে ফিরে যান" keeps the step', r && r.step === 3 && (await sql`select step from content_studio_projects where id = ${P}`)[0].step === 3);

// bell: the first pictures and the video ring; a remake and a card change do not
await sql`update content_studio_jobs set seen_at = null`;
const bell = (await import('../functions/erp/handlers/studio.js')).studioBell;
const lines = await bell({ tx: sql, biz: B, s: { userId: (await sql`select user_id from content_studio_projects where id = ${P}`)[0].user_id } });
check('the bell has the first pictures and the videos, not the remakes or card jobs', lines.some((x) => /ছবি তৈরি/.test(x.title)) && !lines.some((x) => x.key === 'studio-' + J2 || x.key === 'studio-' + J6), lines.map((x) => x.key + ' ' + x.title));

// another person / the one-shot path untouched
r = await owner('erpStudioPicSet', [{ id: Number(changed.id), approved: false }]);
check('the owner reads but cannot tick someone else\'s picture', r && r.error, r);
r = await owner('erpStudioSteps', [{ id: P }]);
check('the owner can read the step video', r && r.steps && r.steps.pics.length >= 4, r && r.error);
await sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`;
r = await mgr('erpStudioAsk', [{ prompt: 'একটা সাধারণ ভিডিও বানান' }]);
check('the one-shot prompt still makes a normal video job', r && r.jobId > 0 && (await sql`select kind from content_studio_jobs where id = ${r.jobId}`)[0].kind === 'new' &&
  (await sql`select mode from content_studio_projects where id = ${r.projectId}`)[0].mode === 'video', r);
r = await mgr('erpStudioSteps', [{ id: r.projectId }]);
check('a one-shot project is not opened as a step video', r && r.error, r);
check('the other business has no studio pictures, cards or jobs', (await sql`select (select count(*) from content_studio_pics where business_id = ${B2}) + (select count(*) from content_studio_cards where business_id = ${B2}) + (select count(*) from content_studio_jobs where business_id = ${B2}) as n`)[0].n == 0);
await done();
