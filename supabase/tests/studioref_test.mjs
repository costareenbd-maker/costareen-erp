// studioref-1 (28 Nov 2026): reference pictures and videos for the Content desk Studio. A manager asks for an upload
// address (type and size checked, 6 pictures / 2 videos per ask), the browser puts the file, confirm makes it ready; a
// video gets "same" or "better"; removing before sending keeps the row; the ask carries the refs (new video and feedback);
// the project log shows them with links; the engine reads a job's refs with the business's engine key only; a
// salesperson is refused; the other business sees nothing.
import { sql, FIX, owner as owner0, mgr as mgr0, sales as sales0, check, done, files } from './harness.mjs';

const un = (x) => (x && x.ok && 'result' in x ? x.result : x);
const owner = async (n, a) => un(await owner0(n, a)), mgr = async (n, a) => un(await mgr0(n, a)), sales = async (n, a) => un(await sales0(n, a));
const B = FIX.B, B2 = FIX.B2;
const MB = 1024 * 1024;
const older = () => sql`update content_studio_jobs set created_at = created_at - interval '1 minute'`;   // the 5-second gap between asks

await sql`insert into erp_app_flags (key, enabled) values ('contentdesk', true) on conflict (key) do update set enabled = true`;

let r = await sales('erpStudioRefUpload', [{ name: 'rini.jpg', mime: 'image/jpeg', bytes: 1000 }]);
check('a salesperson cannot attach files', r && r.error, r);
r = await mgr('erpStudioRefUpload', [{ name: 'notes.pdf', mime: 'application/pdf', bytes: 1000 }]);
check('a PDF is refused (pictures and videos only)', r && r.error && /JPG/.test(r.error), r);
r = await mgr('erpStudioRefUpload', [{ name: 'big.jpg', mime: 'image/jpeg', bytes: 16 * MB }]);
check('a picture over 15 MB is refused', r && r.error && /১৫ MB/.test(r.error), r);
r = await mgr('erpStudioRefUpload', [{ name: 'big.mp4', mime: 'video/mp4', bytes: 201 * MB }]);
check('a video over 200 MB is refused', r && r.error && /২০০ MB/.test(r.error), r);
r = await mgr('erpStudioRefUpload', [{ name: 'empty.png', mime: 'image/png', bytes: 0 }]);
check('an empty file is refused', r && r.error, r);

// six pictures, the seventh refused
const imgs = [];
for (let k = 0; k < 6; k++) {
  r = await mgr('erpStudioRefUpload', [{ name: 'pic' + k + (k === 5 ? '.HEIC' : '.jpg'), mime: k === 5 ? 'image/heic' : 'image/jpeg', bytes: 2 * MB }]);
  if (!(r && r.ref && r.upload)) { check('picture upload address ' + k, false, r); break; }
  imgs.push(r);
}
check('six upload addresses for pictures (HEIC too), each in the business\'s own content/studio-refs folder',
  imgs.length === 6 && imgs.every((x) => /^content\/studio-refs\/[0-9a-f-]{36}\.(jpg|heic)$/.test(x.upload.path) && x.upload.url && x.ref.kind === 'image')
  && files.list().filter((k) => k.startsWith(B + '/content/studio-refs/')).length === 6, imgs.map((x) => x.upload && x.upload.path));
r = await mgr('erpStudioRefUpload', [{ name: 'pic7.png', mime: 'image/png', bytes: MB }]);
check('a seventh picture is refused', r && r.error && /৬টা/.test(r.error), r);
r = await mgr('erpStudioRefUpload', [{ name: 'IMG_0001', mime: 'video/quicktime', bytes: 50 * MB }]);
check('a phone video with no extension is known by its type', r && r.ref && r.ref.kind === 'video' && /\.mov$/.test(r.upload.path), r);
const vid1 = r.ref.id;
r = await mgr('erpStudioRefUpload', [{ name: 'style.mp4', mime: 'video/mp4', bytes: 80 * MB }]);
const vid2 = r.ref.id;
r = await mgr('erpStudioRefUpload', [{ name: 'third.webm', mime: 'video/webm', bytes: MB }]);
check('a third video is refused', r && r.error && /২টা/.test(r.error), r);

// confirm, choose, remove
r = await mgr('erpStudioAsk', [{ prompt: 'Rini-কে নিয়ে sunscreen ভিডিও', refIds: [imgs[0].ref.id] }]);
check('a file still uploading cannot be sent', r && r.error && /উঠছে/.test(r.error), r);
for (const x of imgs) await mgr('erpStudioRefConfirm', [{ id: x.ref.id }]);
r = await mgr('erpStudioRefConfirm', [{ id: vid1 }]);
check('confirm gives a link for the chip', r && r.ref && r.ref.state === 'ready' && /^https:\/\/files\.test\//.test(r.ref.url), r);
await mgr('erpStudioRefConfirm', [{ id: vid2 }]);
r = await mgr('erpStudioRefSet', [{ id: vid1, mode: 'same' }]);
check('the video choice "same" is kept', r && r.ref && r.ref.mode === 'same', r);
r = await mgr('erpStudioRefSet', [{ id: vid1, mode: 'copy-it' }]);
check('an unknown choice is refused', r && r.error, r);
r = await owner('erpStudioRefConfirm', [{ id: vid1 }]);
check('the owner cannot confirm someone else\'s file', r && r.error, r);
r = await mgr('erpStudioRefRemove', [{ id: imgs[5].ref.id }]);
check('a picture is taken off before sending', r && r.ok, r);
const rm = (await sql`select state, removed_at from content_studio_refs where id = ${imgs[5].ref.id}`)[0];
check('... the row stays (state removed), nothing deleted', rm && rm.state === 'removed' && rm.removed_at, rm);
r = await mgr('erpStudio', []);
check('the home tray lists the 5 ready pictures and 2 videos with links', r && r.attach && r.attach.length === 7 && r.attach.every((a) => a.url), r && r.attach);

// the ask carries them
r = await mgr('erpStudioAsk', [{ prompt: 'Rini-কে নিয়ে sunscreen ভিডিও', refIds: [imgs[5].ref.id] }]);
check('a removed file cannot be sent', r && r.error, r);
const pics = imgs.slice(0, 5).map((x) => x.ref.id);
r = await mgr('erpStudioAsk', [{ prompt: 'Rini-কে নিয়ে sunscreen ভিডিও, এই ভিডিওর ধরনে', refIds: pics.concat([vid1]) }]);
check('a new video with 5 pictures and a video', r && r.projectId > 0 && r.refs === 6, r);
const P = r.projectId, J1 = r.jobId, M1 = r.msgId;
const sent = await sql`select state, project_id, msg_id, job_id from content_studio_refs where id in ${sql(pics.concat([vid1]))}`;
check('... each ref is sent, tied to the project, the prompt and the job', sent.length === 6 && sent.every((x) => x.state === 'sent' && Number(x.project_id) === P && Number(x.msg_id) === M1 && Number(x.job_id) === J1), sent);
r = await mgr('erpStudioRefRemove', [{ id: pics[0] }]);
check('a sent ref cannot be removed (it stays with the log)', r && r.error, r);
r = await mgr('erpStudioRefSet', [{ id: vid1, mode: 'better' }]);
check('a sent ref cannot be changed', r && r.error, r);
await older();
r = await mgr('erpStudioAsk', [{ prompt: 'আরেকটা', refIds: [pics[1]] }]);
check('a sent ref cannot be sent again', r && r.error, r);

r = await mgr('erpStudioProject', [{ id: P }]);
const m1 = r && r.log && r.log.find((m) => m.id === M1);
check('the project log shows the 6 refs on the prompt, with links and the video choice', m1 && m1.refs.length === 6 && m1.refs.every((x) => x.url)
  && m1.refs.filter((x) => x.kind === 'video').length === 1 && m1.refs.find((x) => x.kind === 'video').mode === 'same', m1);
check('the project tray still has the second video (not sent)', r.attach && r.attach.length === 1 && r.attach[0].id === vid2, r && r.attach);

// the engine reads the job's refs: only with this business's engine key
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'BRAND_BRIDGE_KEY', 'eng-key-1') on conflict (business_id, key) do update set value = excluded.value`;
r = await owner('erpContentStudioRefs', [{ biz: B, key: 'wrong', jobId: J1 }]);
check('the engine call is refused with a wrong key', r && r.error, r);
r = await mgr('erpContentStudioRefs', [{ biz: B, key: 'eng-key-1', jobId: J1 }]);
check('a manager cannot use the engine call', r && r.error, r);
r = await owner('erpContentStudioRefs', [{ biz: B, key: 'eng-key-1', jobId: J1, used: { [pics[0]]: { shown: true }, [pics[1]]: { shown: true, night: 'Rini holding the bottle by a window' } } }]);
check('the engine gets the job\'s 6 refs with links and paths', r && r.refs && r.refs.length === 6 && r.refs.every((x) => x.url && /^content\/studio-refs\//.test(x.path)), r);
r = await mgr('erpStudioProject', [{ id: P }]);
const m1b = r.log.find((m) => m.id === M1);
check('what the engine did shows in the log (shown / night clip)', m1b.refs.find((x) => x.id === pics[0]).shown && /window/.test(m1b.refs.find((x) => x.id === pics[1]).night), m1b.refs);

// feedback with a ref (after the first version)
const v1 = (await sql`insert into content_videos (business_id, title, platform, file_path, bytes, made_by, studio_project, hidden)
                      values (${B}, 'Sunscreen', 'tiktok', ${'content/' + '33333333-3333-4333-8333-333333333333.mp4'}, 1000, 'studio', ${P}, true) returning id`)[0].id;
await sql`update content_studio_jobs set state = 'done', version = 1, video_id = ${v1}, finished_at = now() where id = ${J1}`;
await sql`update content_studio_projects set version = 1, video_id = ${v1} where id = ${P}`;
await older();
r = await mgr('erpStudioAsk', [{ projectId: P, prompt: 'দ্বিতীয় ভিডিওর মতো দ্রুত কাট', refIds: [vid2] }]);
check('feedback carries a video ref', r && r.jobId > J1 && r.refs === 1, r);
const J2 = r.jobId, M2 = r.msgId;
r = await owner('erpContentStudioRefs', [{ biz: B, key: 'eng-key-1', jobId: J2 }]);
check('the feedback job has only its own ref', r && r.refs.length === 1 && r.refs[0].id === vid2 && r.refs[0].mode === 'better', r);
r = await mgr('erpStudioProject', [{ id: P }]);
check('the log keeps both: 6 on the prompt, 1 on the feedback', r.log.find((m) => m.id === M1).refs.length === 6 && r.log.find((m) => m.id === M2).refs.length === 1, r.log);

// someone else's refs cannot be sent; the owner reads the log
r = await owner('erpStudioRefUpload', [{ name: 'own.png', mime: 'image/png', bytes: MB }]);
const ownRef = r.ref.id;
await owner('erpStudioRefConfirm', [{ id: ownRef }]);
await older();
r = await mgr('erpStudioAsk', [{ prompt: 'নতুন একটা ভিডিও', refIds: [ownRef] }]);
check('a manager cannot send the owner\'s file', r && r.error, r);
r = await owner('erpStudioProject', [{ id: P }]);
check('the owner reads the manager\'s log with the refs (no tray for him there)', r && r.log.find((m) => m.id === M1).refs.length === 6 && r.attach.length === 0, r && r.attach);

// the other business
const other = await sql`select count(*)::int n from content_studio_refs where business_id = ${B2}`;
check('the other business has no refs', other[0].n === 0);
const keep = await sql`select count(*)::int n from content_studio_refs where business_id = ${B}`;
check('nothing deleted (6 pictures + 2 videos + the owner\'s)', keep[0].n === 9, keep);

done();
