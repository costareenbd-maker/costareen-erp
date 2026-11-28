// studiosteps-1 (owner 28 Nov 2026, approved mockup .impeccable/mocks/studio-steps-2026-11-28): the Content desk Studio,
// step by step, for Oliareen's marketer. He is asked at every step; nothing runs ahead of him:
//   1 idea   - text + pictures / video / link / JSON (the studioref / studiojson attach tray). "ছবি বানান" starts step 2.
//   2 pictures - 4 pictures (the business's own ChatGPT picture path, made on the PC studio engine); he ticks the ones he
//              likes, remakes one ("↻ আবার"), changes one with a note ("✎ বদলান"), or writes free feedback. The AI's advice
//              line says what it sees ("৩ নম্বর ছবিতে লেখা পড়া যাচ্ছে না - আবার বানাব?"). The day's picture cap is shown;
//              over it the pictures wait for tomorrow (never refused, never lost).
//   3 scene cards - per scene: a ticked picture + seconds + the spoken line + the on-screen text. "✓ ঠিক", "✎ বদলান" (he
//              edits the words himself or asks the AI), ↑↓, "+ সিন যোগ করুন", the AI's advice line.
//   4 video  - made from the cards (pictures as stills with a gentle push, the Studio voice / captions / music); feedback ->
//              the next version (the AI adjusts the cards first); back to the cards any time; save / to drafts as before.
// Text (picture prompts, cards, advice) is written by Claude on the engine (all-Claude rule); pictures by ChatGPT.
//   erpStudioStepsStart({idea, refIds?, spec?})      a new step-by-step video: the idea + 4 pictures
//   erpStudioSteps({id})                             one project: everything erpStudioProject gives + pictures, cards, jobs
//   erpStudioStepGo({projectId, step})               which step he is looking at (kept for next time)
//   erpStudioPicSet({id, approved})                  his tick on a picture
//   erpStudioPicRedo({id, note?})                    "↻ আবার" (no note) / "✎ বদলান" (a note): a new picture in the same place
//   erpStudioPicsAsk({projectId, feedback})          free feedback on the pictures (the AI decides which to remake)
//   erpStudioPicsMore({projectId, idea?})            4 more pictures (from step 1, the idea may be changed)
//   erpStudioCardsMake({projectId})                  write the scene cards from the ticked pictures
//   erpStudioCardSave({id, line?, onscreen?, seconds?, liked?, picId?})   his own edit / tick
//   erpStudioCardAsk({id, ask})                      ask the AI to change one card
//   erpStudioCardMove({id, dir}) / erpStudioCardAdd({projectId, picId?}) / erpStudioCardRemove({id})
//   erpStudioStepVideo({projectId, feedback?})       "ভিডিও এডিট করে দিন" (first video) or feedback on the video
//   erpContentStudioSteps({biz, key, jobId, upload?, picIds?})   the PC engine: picture links + upload addresses
import { getConfig } from '../lib/ext.js';
import { gate, studioCtx } from './contentdesk.js';
import { erpStudioProject, takeRefs, specOf, refOutPublic, studioProject } from './studio.js';

const str = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(v, 10); return n > 0 ? n : 0; };
const iso = (d) => (d ? new Date(d).toISOString() : null);
const bn = (n) => String(n).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
export const PIC_DAY = 30;        // pictures a day for the business (business_config studio_pic_day changes it)
export const FIRST_PICS = 4;      // pictures made from an idea
export const MAX_PICS = 16;       // pictures on the page at once (remade ones do not count)
export const MAX_CARDS = 12;
const MAX_OPEN = 5;               // open jobs of one person (like the one-shot studio)

async function stepProject(ctx, id, write) {
  const p = await studioProject(ctx, id);
  if (str(p.mode) !== 'steps') throw new Error('এটা ধাপে ধাপে বানানো ভিডিও না।');
  if (write && p.user_id !== ctx.s.userId) throw new Error('এটা অন্য কারো ভিডিও। নিজের নামে নতুন ভিডিও বানান।');
  return p;
}
export async function picDay(ctx) {
  let cap = PIC_DAY;
  try { const v = parseInt(await getConfig(ctx, 'studio_pic_day', ''), 10); if (v >= 0) cap = v; } catch (_) { /* default */ }
  const used = Number((await ctx.tx`select count(*)::int n from content_studio_pics where business_id = ${ctx.biz}
    and (state = 'making' or (state in ('ready', 'replaced') and made_at is not null
         and (made_at at time zone 'Asia/Dhaka')::date = (now() at time zone 'Asia/Dhaka')::date))`)[0].n);
  return { cap, used, left: Math.max(0, cap - used) };
}
const tomorrow = (ctx) => ctx.tx`select ((date_trunc('day', now() at time zone 'Asia/Dhaka') + interval '1 day 5 minutes') at time zone 'Asia/Dhaka') as t`;
async function openJobs(ctx, pid) {
  return ctx.tx`select * from content_studio_jobs where project_id = ${pid} and state in ('queued', 'running') order by id`;
}
async function personOpen(ctx) {
  const n = Number((await ctx.tx`select count(*)::int n from content_studio_jobs where business_id = ${ctx.biz} and user_id = ${ctx.s.userId} and state in ('queued', 'running')`)[0].n);
  if (n >= MAX_OPEN) throw new Error('আপনার ' + bn(MAX_OPEN) + 'টা কাজ এখন লাইনে আছে। এগুলো শেষ হলে আরো পাঠান।');
}
async function logMsg(ctx, pid, body, spec) {
  const sj = spec ? JSON.stringify(spec) : null;
  return (await ctx.tx`insert into content_studio_msgs (business_id, project_id, user_id, body, spec) values (${ctx.biz}, ${pid}, ${ctx.s.userId}, ${body}, ${sj}::json) returning id`)[0];
}
// new picture rows (+ the job that makes them). A queued (not started) picture job of the project takes them too.
async function picsJob(ctx, p, rows, detail, prompt) {
  const day = await picDay(ctx);
  let left = day.left;
  let job = (await ctx.tx`select * from content_studio_jobs where project_id = ${p.id} and kind = 'pics' and state = 'queued' order by id desc limit 1`)[0];
  if (!job || detail.feedback) {
    await personOpen(ctx);
    job = (await ctx.tx`insert into content_studio_jobs (business_id, project_id, user_id, kind, prompt, detail) values
                        (${ctx.biz}, ${p.id}, ${ctx.s.userId}, 'pics', ${prompt || ''}, ${ctx.tx.json(detail)}) returning *`)[0];
  }
  let making = 0;
  for (const r of rows) {
    const st = left > 0 ? 'making' : 'waiting';
    if (st === 'making') { left--; making++; }
    await ctx.tx`insert into content_studio_pics (business_id, project_id, user_id, job_id, slot, state, ask, prompt)
                 values (${ctx.biz}, ${p.id}, ${ctx.s.userId}, ${job.id}, ${r.slot}, ${st}, ${r.ask || 'new'}, ${r.prompt || ''})`;
  }
  // nothing can be made today: the job waits for tomorrow (the page says so); something can: it starts now
  const anyMaking = making > 0 || Number((await ctx.tx`select count(*)::int n from content_studio_pics where job_id = ${job.id} and state = 'making'`)[0].n) > 0;
  if (anyMaking) await ctx.tx`update content_studio_jobs set wait_until = null where id = ${job.id}`;
  else if (rows.length || !detail.feedback) await ctx.tx`update content_studio_jobs set wait_until = ${(await tomorrow(ctx))[0].t} where id = ${job.id}`;
  await ctx.tx`update content_studio_projects set updated_at = now() where id = ${p.id}`;
  return { job, waiting: rows.length - making, left };
}
const nextSlot = async (ctx, pid) => Number((await ctx.tx`select coalesce(max(slot), 0)::int n from content_studio_pics where project_id = ${pid}`)[0].n) + 1;
const livePics = async (ctx, pid) => Number((await ctx.tx`select count(*)::int n from content_studio_pics where project_id = ${pid} and state <> 'replaced'`)[0].n);

export async function erpStudioStepsStart(ctx, payload) {
  await gate(ctx, 'manager');
  const p0 = payload || {};
  const idea = str(p0.idea);
  const spec = specOf(p0.spec);
  if (!spec && idea.length < 3) throw new Error('কী নিয়ে ভিডিও, একটু লিখুন (বা একটা JSON দিন)।');
  await personOpen(ctx);
  const refs = await takeRefs(ctx, p0.refIds);
  const title = idea.length >= 3 ? idea.replace(/\s+/g, ' ').slice(0, 70) : 'JSON ভিডিও';
  const p = (await ctx.tx`insert into content_studio_projects (business_id, user_id, title, mode, step, idea) values
                          (${ctx.biz}, ${ctx.s.userId}, ${title}, 'steps', 2, ${idea}) returning *`)[0];
  const m = await logMsg(ctx, p.id, idea, spec);
  const rows = Array.from({ length: FIRST_PICS }, (_, i) => ({ slot: i + 1, ask: 'new' }));
  const r = await picsJob(ctx, p, rows, { first: true, spec: !!spec }, idea);
  if (spec) await ctx.tx`update content_studio_jobs set spec = ${JSON.stringify(spec)}::json where id = ${r.job.id}`;
  if (refs.length) await ctx.tx`update content_studio_refs set state = 'sent', sent_at = now(), project_id = ${p.id}, msg_id = ${m.id}, job_id = ${r.job.id}
                                where id in ${ctx.tx(refs.map((x) => x.id))}`;
  return { projectId: Number(p.id), jobId: Number(r.job.id), waiting: r.waiting, refs: refs.length };
}

async function picOut(ctx, x) {
  let url = '';
  if (x.file_path && x.state === 'ready') {
    const s = ctx.deps && ctx.deps.storage;
    try { url = s && s.url ? (await s.url(ctx.biz, 'content', str(x.file_path).replace(/^content\//, ''), 3600)) || '' : ''; } catch (_) { url = ''; }
  }
  return { id: Number(x.id), slot: Number(x.slot), state: str(x.state), approved: !!x.approved, ask: str(x.ask), what: str(x.what), error: str(x.error), url,
    jobId: x.job_id == null ? null : Number(x.job_id), madeAt: iso(x.made_at) };
}
const cardOut = (c) => ({ id: Number(c.id), pos: Number(c.pos), picId: c.pic_id == null ? null : Number(c.pic_id), seconds: Number(c.seconds) || 0,
  line: str(c.line), onscreen: str(c.onscreen), liked: !!c.liked, state: str(c.state), by: str(c.edited_by) });
const jobOut = (j) => ({ id: Number(j.id), kind: str(j.kind), state: str(j.state), waitUntil: iso(j.wait_until), detail: j.detail && typeof j.detail === 'object' ? j.detail : {},
  startedAt: iso(j.started_at), createdAt: iso(j.created_at) });

export async function erpStudioSteps(ctx, payload) {
  await gate(ctx, 'manager');
  const p = await stepProject(ctx, payload && payload.id, false);
  const base = await erpStudioProject(ctx, { id: p.id });
  const pics = await ctx.tx`select * from content_studio_pics where project_id = ${p.id} and state <> 'replaced' order by slot, id`;
  const cards = await ctx.tx`select * from content_studio_cards where project_id = ${p.id} and state in ('active', 'making') order by pos, id`;
  const jobs = await openJobs(ctx, p.id);
  const last = (await ctx.tx`select * from content_studio_jobs where project_id = ${p.id} and kind in ('pics', 'cards') and state = 'failed'
                             and finished_at > now() - interval '1 day' order by id desc limit 1`)[0];
  const ideaRefs = (await ctx.tx`select * from content_studio_refs where project_id = ${p.id} and state = 'sent' order by id`);
  const firstMsg = base.log.find((m) => !m.engine) || null;
  const out = [];
  for (const x of pics) out.push(await picOut(ctx, x));
  const refs = [];
  for (const r of ideaRefs) if (firstMsg && Number(r.msg_id) === firstMsg.id) refs.push(await refOutPublic(ctx, r));
  return {
    ...base,
    steps: {
      step: Number(p.step) || 2, idea: str(p.idea), spec: firstMsg ? firstMsg.spec : null, refs,
      pics: out, cards: cards.map(cardOut), jobs: jobs.map(jobOut),
      advice: p.advice && typeof p.advice === 'object' ? p.advice : {},
      failed: last && !jobs.some((j) => j.kind === last.kind) ? { kind: str(last.kind), note: str(last.note) } : null,
      day: await picDay(ctx), maxCards: MAX_CARDS, maxPics: MAX_PICS,
    },
  };
}

export async function erpStudioStepGo(ctx, payload) {
  await gate(ctx, 'manager');
  const p = await stepProject(ctx, payload && payload.projectId, true);
  const step = int(payload && payload.step);
  if (step < 1 || step > 4) throw new Error('কোন ধাপ?');
  await ctx.tx`update content_studio_projects set step = ${step} where id = ${p.id}`;
  return { step };
}

async function myPic(ctx, id) {
  const x = (await ctx.tx`select * from content_studio_pics where business_id = ${ctx.biz} and id = ${int(id)}`)[0];
  if (!x) throw new Error('ছবিটা পাওয়া গেল না। পাতাটা নতুন করে আনুন।');
  const p = await stepProject(ctx, x.project_id, true);
  return { x, p };
}
export async function erpStudioPicSet(ctx, payload) {
  await gate(ctx, 'manager');
  const { x } = await myPic(ctx, payload && payload.id);
  if (x.state !== 'ready') throw new Error('ছবিটা এখনো তৈরি হয়নি।');
  const on = !!(payload && payload.approved);
  await ctx.tx`update content_studio_pics set approved = ${on} where id = ${x.id}`;
  return { id: Number(x.id), approved: on };
}
export async function erpStudioPicRedo(ctx, payload) {
  await gate(ctx, 'manager');
  const { x, p } = await myPic(ctx, payload && payload.id);
  if (x.state === 'making' || x.state === 'waiting') throw new Error('এই ছবিটা এখনো বানানো হচ্ছে।');
  if (x.state === 'replaced') throw new Error('এই ছবির জায়গায় নতুন ছবি আগেই চাওয়া হয়েছে।');
  const note = str(payload && payload.note);
  const r = await picsJob(ctx, p, [{ slot: Number(x.slot), ask: note || 'again', prompt: str(x.prompt) }], { redo: true }, note);
  const nu = (await ctx.tx`select id from content_studio_pics where project_id = ${p.id} and slot = ${x.slot} and state in ('making', 'waiting') order by id desc limit 1`)[0];
  await ctx.tx`update content_studio_pics set state = 'replaced', approved = false, replaced_by = ${nu.id} where id = ${x.id}`;
  await ctx.tx`update content_studio_cards set pic_id = ${nu.id} where project_id = ${p.id} and pic_id = ${x.id} and state = 'active'`;
  if (note) await logMsg(ctx, p.id, bn(x.slot) + ' নম্বর ছবি বদলান: ' + note);
  return { picId: Number(nu.id), jobId: Number(r.job.id), waiting: r.waiting > 0 };
}
export async function erpStudioPicsAsk(ctx, payload) {
  await gate(ctx, 'manager');
  const p = await stepProject(ctx, payload && payload.projectId, true);
  const fb = str(payload && payload.feedback);
  if (fb.length < 3) throw new Error('ছবিগুলো নিয়ে কী বলতে চান, লিখুন।');
  if ((await ctx.tx`select 1 from content_studio_jobs where project_id = ${p.id} and kind = 'pics' and state in ('queued', 'running') and detail ? 'feedback'`).length)
    throw new Error('আগের মতামতের ছবিগুলো এখনো বানানো হচ্ছে। শেষ হলে আবার লিখুন।');
  await logMsg(ctx, p.id, 'ছবি নিয়ে: ' + fb);
  const r = await picsJob(ctx, p, [], { feedback: fb }, fb);
  return { jobId: Number(r.job.id) };
}
export async function erpStudioPicsMore(ctx, payload) {
  await gate(ctx, 'manager');
  const p = await stepProject(ctx, payload && payload.projectId, true);
  const idea = str(payload && payload.idea);
  if (idea && idea !== str(p.idea)) {
    if (idea.length < 3) throw new Error('আইডিয়াটা একটু লিখুন।');
    await ctx.tx`update content_studio_projects set idea = ${idea} where id = ${p.id}`;
    await logMsg(ctx, p.id, 'নতুন আইডিয়া: ' + idea);
  }
  const have = await livePics(ctx, p.id);
  const n = Math.min(FIRST_PICS, MAX_PICS - have);
  if (n <= 0) throw new Error('একসাথে ' + bn(MAX_PICS) + 'টার বেশি ছবি রাখা যায় না। পছন্দ না হওয়াগুলো "↻ আবার" দিয়ে বদলান।');
  let s = await nextSlot(ctx, p.id);
  const rows = Array.from({ length: n }, () => ({ slot: s++, ask: 'new' }));
  const r = await picsJob(ctx, p, rows, { more: true }, idea || str(p.idea));
  await ctx.tx`update content_studio_projects set step = 2 where id = ${p.id}`;
  return { jobId: Number(r.job.id), made: n, waiting: r.waiting };
}

// ------------------------------------------------------------------ step 3: scene cards
export async function erpStudioCardsMake(ctx, payload) {
  await gate(ctx, 'manager');
  const p = await stepProject(ctx, payload && payload.projectId, true);
  const ok = Number((await ctx.tx`select count(*)::int n from content_studio_pics where project_id = ${p.id} and state = 'ready' and approved`)[0].n);
  if (!ok) throw new Error('আগে অন্তত একটা ছবিতে ✓ দিন।');
  if ((await ctx.tx`select 1 from content_studio_jobs where project_id = ${p.id} and kind in ('cards', 'render') and state in ('queued', 'running')`).length)
    throw new Error('সিনের কার্ড বা ভিডিওর কাজ এখনো চলছে। শেষ হলে আবার চাপুন।');
  await personOpen(ctx);
  const j = (await ctx.tx`insert into content_studio_jobs (business_id, project_id, user_id, kind, prompt, detail) values
                          (${ctx.biz}, ${p.id}, ${ctx.s.userId}, 'cards', '', ${ctx.tx.json({ full: true, pics: ok })}) returning id`)[0];
  await ctx.tx`update content_studio_projects set step = 3, updated_at = now() where id = ${p.id}`;
  await logMsg(ctx, p.id, bn(ok) + 'টা ছবি দিয়ে সিনের কার্ড বানান');
  return { jobId: Number(j.id) };
}
async function myCard(ctx, id) {
  const c = (await ctx.tx`select * from content_studio_cards where business_id = ${ctx.biz} and id = ${int(id)}`)[0];
  if (!c || c.state === 'replaced' || c.state === 'removed') throw new Error('কার্ডটা পাওয়া গেল না। পাতাটা নতুন করে আনুন।');
  const p = await stepProject(ctx, c.project_id, true);
  return { c, p };
}
async function noRender(ctx, pid) {
  if ((await ctx.tx`select 1 from content_studio_jobs where project_id = ${pid} and kind = 'render' and state in ('queued', 'running')`).length)
    throw new Error('এই কার্ডগুলো দিয়ে এখন ভিডিও তৈরি হচ্ছে। শেষ হলে বদলান।');
}
export async function erpStudioCardSave(ctx, payload) {
  await gate(ctx, 'manager');
  const q = payload || {};
  const { c, p } = await myCard(ctx, q.id);
  if (c.state === 'making') throw new Error('AI এই কার্ডটা এখন বদলাচ্ছে। একটু পরে আবার দেখুন।');
  await noRender(ctx, p.id);
  const line = q.line == null ? str(c.line) : str(q.line);
  const onscreen = q.onscreen == null ? str(c.onscreen) : str(q.onscreen);
  let seconds = q.seconds == null ? Number(c.seconds) : Math.round(Number(q.seconds) * 2) / 2;
  if (!(seconds >= 1 && seconds <= 30)) throw new Error('সময় ১ থেকে ৩০ সেকেন্ডের মধ্যে দিন।');
  let pic = c.pic_id == null ? null : Number(c.pic_id);
  if (q.picId != null) {
    const x = (await ctx.tx`select id from content_studio_pics where project_id = ${p.id} and id = ${int(q.picId)} and state = 'ready'`)[0];
    if (!x) throw new Error('এই ছবিটা এই ভিডিওর তৈরি ছবি না।');
    pic = Number(x.id);
  }
  const textChanged = line !== str(c.line) || onscreen !== str(c.onscreen) || seconds !== Number(c.seconds) || pic !== (c.pic_id == null ? null : Number(c.pic_id));
  const liked = q.liked == null ? (textChanged ? false : !!c.liked) : !!q.liked;
  await ctx.tx`update content_studio_cards set line = ${line}, onscreen = ${onscreen}, seconds = ${seconds}, pic_id = ${pic}, liked = ${liked},
               edited_by = ${textChanged ? 'him' : c.edited_by}, updated_at = now() where id = ${c.id}`;
  return { card: cardOut((await ctx.tx`select * from content_studio_cards where id = ${c.id}`)[0]) };
}
export async function erpStudioCardAsk(ctx, payload) {
  await gate(ctx, 'manager');
  const { c, p } = await myCard(ctx, payload && payload.id);
  const ask = str(payload && payload.ask);
  if (ask.length < 3) throw new Error('কার্ডটায় কী বদলাতে চান, লিখুন।');
  if (c.state === 'making') throw new Error('AI এই কার্ডটা এখন বদলাচ্ছে।');
  await noRender(ctx, p.id);
  await personOpen(ctx);
  const j = (await ctx.tx`insert into content_studio_jobs (business_id, project_id, user_id, kind, prompt, detail) values
                          (${ctx.biz}, ${p.id}, ${ctx.s.userId}, 'cards', ${ask}, ${ctx.tx.json({ cardId: Number(c.id) })}) returning id`)[0];
  await ctx.tx`update content_studio_cards set state = 'making', updated_at = now() where id = ${c.id}`;
  const n = Number((await ctx.tx`select count(*)::int n from content_studio_cards where project_id = ${p.id} and state in ('active', 'making') and pos < ${c.pos}`)[0].n) + 1;
  await logMsg(ctx, p.id, 'সিন ' + bn(n) + ' বদলান: ' + ask);
  return { jobId: Number(j.id) };
}
async function renumber(ctx, pid) {
  const rows = await ctx.tx`select id from content_studio_cards where project_id = ${pid} and state in ('active', 'making') order by pos, id`;
  for (let i = 0; i < rows.length; i++) await ctx.tx`update content_studio_cards set pos = ${i + 1} where id = ${rows[i].id}`;
  return rows.map((r) => Number(r.id));
}
export async function erpStudioCardMove(ctx, payload) {
  await gate(ctx, 'manager');
  const { c, p } = await myCard(ctx, payload && payload.id);
  await noRender(ctx, p.id);
  const ids = await renumber(ctx, p.id);
  const i = ids.indexOf(Number(c.id)), k = i + (Number(payload && payload.dir) < 0 ? -1 : 1);
  if (k < 0 || k >= ids.length) return { ok: true, moved: false };
  await ctx.tx`update content_studio_cards set pos = ${k + 1}, updated_at = now() where id = ${ids[i]}`;
  await ctx.tx`update content_studio_cards set pos = ${i + 1}, updated_at = now() where id = ${ids[k]}`;
  return { ok: true, moved: true };
}
export async function erpStudioCardAdd(ctx, payload) {
  await gate(ctx, 'manager');
  const p = await stepProject(ctx, payload && payload.projectId, true);
  await noRender(ctx, p.id);
  const n = Number((await ctx.tx`select count(*)::int n from content_studio_cards where project_id = ${p.id} and state in ('active', 'making')`)[0].n);
  if (n >= MAX_CARDS) throw new Error('একটা ভিডিওতে ' + bn(MAX_CARDS) + 'টার বেশি সিন রাখা যায় না।');
  let pic = payload && payload.picId != null ? (await ctx.tx`select id from content_studio_pics where project_id = ${p.id} and id = ${int(payload.picId)} and state = 'ready'`)[0] : null;
  if (payload && payload.picId != null && !pic) throw new Error('এই ছবিটা এই ভিডিওর তৈরি ছবি না।');
  if (!pic) pic = (await ctx.tx`select id from content_studio_pics where project_id = ${p.id} and state = 'ready' order by approved desc, slot limit 1`)[0];
  if (!pic) throw new Error('আগে ছবি বানান: সিনে একটা ছবি লাগে।');
  const c = (await ctx.tx`insert into content_studio_cards (business_id, project_id, user_id, pos, pic_id, seconds, edited_by) values
                          (${ctx.biz}, ${p.id}, ${ctx.s.userId}, ${n + 1}, ${pic.id}, 5, 'him') returning *`)[0];
  return { card: cardOut(c) };
}
export async function erpStudioCardRemove(ctx, payload) {
  await gate(ctx, 'manager');
  const { c, p } = await myCard(ctx, payload && payload.id);
  await noRender(ctx, p.id);
  await ctx.tx`update content_studio_cards set state = 'removed', updated_at = now() where id = ${c.id}`;
  await renumber(ctx, p.id);
  return { ok: true };
}

// ------------------------------------------------------------------ step 4: the video from the cards
export async function erpStudioStepVideo(ctx, payload) {
  await gate(ctx, 'manager');
  const p = await stepProject(ctx, payload && payload.projectId, true);
  const fb = str(payload && payload.feedback);
  const cards = await ctx.tx`select * from content_studio_cards where project_id = ${p.id} and state in ('active', 'making') order by pos, id`;
  if (!cards.length) throw new Error('আগে সিনের কার্ড বানান।');
  if (cards.some((c) => c.state === 'making')) throw new Error('AI একটা কার্ড এখনো বদলাচ্ছে। শেষ হলে চাপুন।');
  const empty = cards.findIndex((c) => !str(c.line) || c.pic_id == null);
  if (empty >= 0) throw new Error('সিন ' + bn(empty + 1) + '-এ কী বলা হবে লিখুন (আর একটা ছবি বাছুন)।');
  if ((await openJobs(ctx, p.id)).some((j) => j.kind === 'render' || j.kind === 'cards')) throw new Error('এই ভিডিওর আগের কাজটা এখনো চলছে। শেষ হলে আবার চাপুন।');
  if (fb && fb.length < 3) throw new Error('কী বদলাতে চান, একটু লিখুন।');
  if (fb && !Number(p.version)) throw new Error('প্রথম ভিডিওটা এখনো তৈরি হয়নি।');
  await personOpen(ctx);
  const body = fb || (Number(p.version) ? 'কার্ড বদলে নতুন ভিডিও বানান' : 'ভিডিও এডিট করে দিন');
  const m = await logMsg(ctx, p.id, body);
  const j = (await ctx.tx`insert into content_studio_jobs (business_id, project_id, user_id, kind, prompt, detail) values
                          (${ctx.biz}, ${p.id}, ${ctx.s.userId}, 'render', ${fb}, ${ctx.tx.json({ cards: cards.length, feedback: !!fb, msg: Number(m.id) })}) returning id`)[0];
  await ctx.tx`update content_studio_projects set step = 4, updated_at = now() where id = ${p.id}`;
  return { jobId: Number(j.id) };
}

// ------------------------------------------------------------------ the PC engine
// picture links (1 hour) and upload addresses for new pictures; the engine key of THIS business, like the refs
export async function erpContentStudioSteps(ctx, payload) {
  const c2 = await studioCtx(ctx, payload);
  const q = payload || {};
  const j = (await c2.tx`select id, project_id from content_studio_jobs where business_id = ${c2.biz} and id = ${int(q.jobId)}`)[0];
  if (!j) throw new Error('That studio job is not in this business.');
  const s = c2.deps && c2.deps.storage;
  const uploads = {};
  for (const id of (Array.isArray(q.upload) ? q.upload : []).map(int).filter(Boolean).slice(0, 20)) {
    const x = (await c2.tx`select id from content_studio_pics where business_id = ${c2.biz} and project_id = ${j.project_id} and id = ${id} and state in ('making', 'waiting')`)[0];
    if (!x) continue;
    if (!s || !s.signUpload) throw new Error('No file store on this server.');
    const name = 'studio-pics/' + crypto.randomUUID() + '.jpg';
    const up = await s.signUpload(c2.biz, 'content', name);
    uploads[id] = { url: up.url, token: up.token, path: 'content/' + name, contentType: 'image/jpeg' };
  }
  const want = (Array.isArray(q.picIds) ? q.picIds : []).map(int).filter(Boolean);
  const rows = want.length
    ? await c2.tx`select * from content_studio_pics where business_id = ${c2.biz} and project_id = ${j.project_id} and id in ${c2.tx(want)}`
    : await c2.tx`select * from content_studio_pics where business_id = ${c2.biz} and project_id = ${j.project_id} and state = 'ready' order by slot, id`;
  const pics = [];
  for (const x of rows) pics.push({ ...(await picOut(c2, x)), prompt: str(x.prompt), path: str(x.file_path) });
  return { jobId: Number(j.id), projectId: Number(j.project_id), pics, uploads };
}

export const HANDLERS = { erpStudioStepsStart, erpStudioSteps, erpStudioStepGo, erpStudioPicSet, erpStudioPicRedo, erpStudioPicsAsk, erpStudioPicsMore,
  erpStudioCardsMake, erpStudioCardSave, erpStudioCardAsk, erpStudioCardMove, erpStudioCardAdd, erpStudioCardRemove, erpStudioStepVideo, erpContentStudioSteps };
