// studio-1 (owner 26 Nov 2026): the Content desk "Studio" tab. One prompt bar; the business's own video engine (the PC
// studio, bizdesk/studio/bizvideo.py --studio) makes the video; feedback makes the next version; nothing is ever lost.
// Owner's rules: no limit per day. The queue waits only while the engine is busy with the desk's own video, else it
// starts at once. A person's rules / words / style are their own lane: they never change the owner's engine rules, and
// the desk's autopilot never reads them. Every prompt and feedback stays readable (later: "learn her style").
//
//   erpStudio()                          home: engine state, my place in the queue, my videos, the desk's earlier videos
//   erpStudioProject({id})               one video: versions, the work log, the job running now
//   erpStudioAsk({projectId?, prompt, baseVideoId?})   a new video, or feedback on one (= the next version)
//   erpStudioFinish({projectId, action: save|draft|improve, version?})
//   erpStudioVideoUrl({projectId, version})            a 1-hour link to one version
//   erpStudioRules({userId?})            my rules, words and style + the owner's locked rules + my feedback log
//   erpStudioRuleSave({id?, kind, body}) / erpStudioRuleRemove({id})   (struck out, never deleted)
//   erpStudioForget({ruleId})            "না, শুধু এটায়": a rule the engine remembered from feedback goes back to that video only
//   erpStudioPhone({phone})              the WhatsApp number the "your video is ready" message goes to
//   studioBell(ctx)                      the bell lines (alerts.js) - finished versions not opened yet
//   studioNotifyTick(ctx)                minute timer: the WhatsApp message for each finished version, once
// studioref-1 (owner 28 Nov 2026): reference pictures (avatar / product / content: shown in the video, or the model for a
// night clip) and reference videos (the style structure: "same" or "better") attached to a prompt or a feedback.
//   erpStudioRefUpload({name, mime, bytes})   a signed upload address (pictures jpg/png/webp/heic <= 15 MB, 6 per ask;
//                                             videos mp4/mov/webm <= 200 MB, 2 per ask) -> the browser PUTs the file
//   erpStudioRefConfirm({id})                 the file is in: ready to send (a 1-hour link for the chip)
//   erpStudioRefSet({id, mode?, note?})       a video's choice ("same" | "better") or a short note, before sending
//   erpStudioRefRemove({id})                  take it off before sending (the row stays, state 'removed')
//   erpStudioAsk({..., refIds: [..]})         sends them with the prompt / feedback; after that they stay with the log
//   erpContentStudioRefs({biz, key, jobId})   the PC engine: a job's refs with 1-hour links (engine key, like the upload)
// studioref-2 (28 Nov 2026): a reference VIDEO can also be a link (YouTube, Facebook, Instagram, TikTok). No migration: a
// link ref is kind 'video', file_path 'link/<uuid>', name = the URL, mime 'text/uri-list', ready at once. The engine
// downloads it with yt-dlp (720p, first 3 min, <= 200 MB), keeps only the style facts and deletes the file.
//   erpStudioRefLink({url})                   a pasted link -> a video ref (counts toward the 2 videos per ask)
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { phone11 } from '../lib/phone.js';
import { gate, studioCtx } from './contentdesk.js';

const str = (v) => String(v == null ? '' : v).trim();
const int = (v) => { const n = parseInt(v, 10); return n > 0 ? n : 0; };
const iso = (d) => (d ? new Date(d).toISOString() : null);
// nolimit-1 (owner 28 Nov 2026): no length limit on a prompt or a feedback (was 4000 characters, cut silently)
const MAX_OPEN = 5, ASK_GAP_S = 5;
const STALE_MS = 10 * 60e3;   // the engine writes studio_engine every minute while it works
const KINDS = ['rule', 'term', 'style'];
// The owner's rules the studio always keeps (shown locked). The engine has them in code; this is what the person reads.
export const LOCKED_DEFAULT = [
  'শুধু আসল প্রোডাক্ট; ত্বক নিয়ে দাবি গবেষণা দিয়ে, ওষুধের মতো দাবি না',
  'Rini সবসময় লোগোর রঙের কামিজে (rose + pink দোপাট্টা)',
  'ঘর পরিপাটি, সুন্দর সাজানো, বাংলাদেশি ঘর',
  'কেউ ক্যামেরার দিকে তাকিয়ে কথা বলবে না; ভিডিও বোঝানোর মতো, গ্রাফিক্সে',
  'গলা: শান্ত, পরামর্শদাতার মতো; কোড বা নম্বর পড়ে শোনাবে না',
  'অন্য ব্যবসার (Costareen, ব্যক্তিগত পেজ) কোনো কথা, ছবি বা ক্লিপ না',
  'শেষে পেজ ফলো করার ছোট আমন্ত্রণ',
];

async function myName(ctx, userId) {
  const r = (await ctx.tx`select full_name, email from profiles where id = ${userId}`)[0];
  return r ? (str(r.full_name) || str(r.email).split('@')[0]) : '';
}
async function engineState(ctx) {
  const e = await getConfig(ctx, 'studio_engine', '');
  let o = {};
  try { o = e ? JSON.parse(e) : {}; } catch (_) { o = {}; }
  const fresh = o.at && Date.now() - new Date(o.at).getTime() < STALE_MS;
  return { online: !!fresh, busy: fresh ? str(o.busy) : '', what: fresh ? str(o.what) : '', eta: fresh ? int(o.etaMin) : 0, at: o.at || null };
}
async function project(ctx, id) {
  const n = int(id);
  if (!n) throw new Error('কোন ভিডিও? একটা বাছুন।');
  const p = (await ctx.tx`select * from content_studio_projects where business_id = ${ctx.biz} and id = ${n}`)[0];
  if (!p) throw new Error('ভিডিওটা আর এখানে নেই। পাতাটা নতুন করে আনুন।');
  // the person's own videos; the owner (and shareholders) read everyone's
  if (p.user_id !== ctx.s.userId && !roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('এটা অন্য কারো ভিডিও।');
  return p;
}
const projOut = (p, job) => ({ id: Number(p.id), title: str(p.title), state: str(p.state), version: Number(p.version) || 0, videoId: p.video_id == null ? null : Number(p.video_id),
  baseVideoId: p.base_video_id == null ? null : Number(p.base_video_id), mine: undefined, updatedAt: iso(p.updated_at), createdAt: iso(p.created_at),
  job: job ? { id: Number(job.id), state: str(job.state), kind: str(job.kind), place: job.place || 0, startedAt: iso(job.started_at) } : null });

async function queueOf(ctx) {
  return ctx.tx`select id, project_id, user_id, state, kind, started_at, created_at from content_studio_jobs
                where business_id = ${ctx.biz} and state in ('queued', 'running') order by id`;
}

export async function erpStudio(ctx) {
  await gate(ctx, 'manager');
  const eng = await engineState(ctx);
  const q = await queueOf(ctx);
  let place = 0;
  const live = {};
  q.forEach((j) => { if (j.state === 'queued') place++; live[j.project_id] = { ...j, place: j.state === 'queued' ? place : 0 }; });
  const all = roleAtLeast(ctx.s.role, 'shareholder');
  const rows = await ctx.tx`select p.*, (select full_name from profiles where id = p.user_id) as who from content_studio_projects p
                            where p.business_id = ${ctx.biz} and (p.user_id = ${ctx.s.userId} or ${all}) order by p.updated_at desc, p.id desc limit 80`;
  const desk = await ctx.tx`select id, title, platform, created_at, made_by, draft_id from content_videos
                            where business_id = ${ctx.biz} and not hidden and studio_project is null order by created_at desc, id desc limit 60`;
  const mine = q.filter((j) => j.user_id === ctx.s.userId);
  const ahead = mine.length ? q.filter((j) => j.id < mine[0].id).length : 0;
  return {
    engine: eng,
    // what the person reads on the dark strip: our own video running -> theirs waits; else theirs runs now
    queue: { running: q.filter((j) => j.state === 'running').length, waiting: q.filter((j) => j.state === 'queued').length, mineAhead: ahead, mine: mine.length },
    projects: rows.map((p) => ({ ...projOut(p, live[p.id]), mine: p.user_id === ctx.s.userId, who: str(p.who) })),
    desk: desk.map((v) => ({ id: Number(v.id), title: str(v.title), platform: str(v.platform), createdAt: iso(v.created_at), madeBy: str(v.made_by) })),
    rules: Number((await ctx.tx`select count(*)::int n from content_studio_rules where business_id = ${ctx.biz} and user_id = ${ctx.s.userId} and active`)[0].n),
    phone: str((JSON.parse((await getConfig(ctx, 'studio_phones', '')) || '{}') || {})[ctx.s.userId] || ''),
    canSeeAll: all,
    attach: await openOut(ctx),   // studioref-1: the attach tray (uploaded, not sent yet)
  };
}

export async function erpStudioProject(ctx, payload) {
  await gate(ctx, 'manager');
  const p = await project(ctx, payload && payload.id);
  const msgs = await ctx.tx`select m.*, (select full_name from profiles where id = m.user_id) as who from content_studio_msgs m
                            where m.project_id = ${p.id} order by m.id`;
  const jobs = await ctx.tx`select * from content_studio_jobs where project_id = ${p.id} order by id`;
  const versions = jobs.filter((j) => j.state === 'done' && j.video_id).map((j) => ({ version: Number(j.version), videoId: Number(j.video_id), jobId: Number(j.id),
    note: str(j.note), dropped: Array.isArray(j.dropped) ? j.dropped : [], at: iso(j.finished_at) }));
  const open = jobs.filter((j) => j.state === 'queued' || j.state === 'running').pop() || null;
  let place = 0;
  if (open && open.state === 'queued') place = (await ctx.tx`select count(*)::int n from content_studio_jobs where business_id = ${ctx.biz} and state in ('queued', 'running') and id < ${open.id}`)[0].n + 1;
  const failed = jobs.length && jobs[jobs.length - 1].state === 'failed' ? str(jobs[jobs.length - 1].note) : '';
  const remembered = await ctx.tx`select id, body, msg_id from content_studio_rules where project_id = ${p.id} and active and source like 'মতামত%'`;
  if (p.user_id === ctx.s.userId) await ctx.tx`update content_studio_jobs set seen_at = now() where project_id = ${p.id} and state = 'done' and seen_at is null`;
  // studioref-1: the pictures / videos each prompt and feedback carried (1-hour links: the log shows the thumbnails)
  const refRows = await ctx.tx`select * from content_studio_refs where business_id = ${ctx.biz} and project_id = ${p.id} and state = 'sent' order by id`;
  const refsOf = {};
  for (const x of refRows) (refsOf[Number(x.msg_id)] = refsOf[Number(x.msg_id)] || []).push(await refOut(ctx, x, true));
  return {
    project: projOut(p, open ? { ...open, place } : null), mine: p.user_id === ctx.s.userId,
    versions, failed, engine: await engineState(ctx),
    log: msgs.map((m) => ({ id: Number(m.id), engine: !m.user_id, who: m.user_id ? str(m.who) : '', body: str(m.body), version: m.version == null ? null : Number(m.version), at: iso(m.created_at),
      refs: refsOf[Number(m.id)] || [] })),
    attach: p.user_id === ctx.s.userId ? await openOut(ctx) : [],
    remembered: remembered.map((r) => ({ id: Number(r.id), body: str(r.body), msgId: r.msg_id == null ? null : Number(r.msg_id) })),
  };
}

export async function erpStudioAsk(ctx, payload) {
  await gate(ctx, 'manager');
  const p = payload || {};
  const prompt = str(p.prompt);
  if (prompt.length < 3) throw new Error('কী ভিডিও চান, একটু লিখুন।');
  // owner 26 Nov 2026 (nobody may probe the platform): no daily limit on videos, but no flooding either - at most
  // MAX_OPEN jobs of one person waiting at once and one ask per ASK_GAP_S seconds
  const mine = (await ctx.tx`select count(*) filter (where state in ('queued', 'running'))::int open,
                                    max(created_at) last from content_studio_jobs where business_id = ${ctx.biz} and user_id = ${ctx.s.userId}`)[0];
  if (mine.open >= MAX_OPEN) throw new Error('আপনার ' + MAX_OPEN + 'টা ভিডিও এখন লাইনে আছে। এগুলো শেষ হলে আরো পাঠান।');
  if (mine.last && Date.now() - new Date(mine.last).getTime() < ASK_GAP_S * 1000) throw new Error('একটু থামুন, কয়েক সেকেন্ড পরে আবার পাঠান।');
  const refs = await takeRefs(ctx, p.refIds);   // studioref-1: checked before anything is written
  let pr;
  if (p.projectId) {
    pr = await project(ctx, p.projectId);
    if (pr.user_id !== ctx.s.userId) throw new Error('অন্য কারো ভিডিওতে মতামত দেওয়া যায় না। নিজের নামে নতুন ভিডিও বানান।');
    const open = await ctx.tx`select 1 from content_studio_jobs where project_id = ${pr.id} and state in ('queued', 'running')`;
    if (open.length) throw new Error('এই ভিডিওর আগের কাজটা এখনো চলছে। শেষ হলে মতামত দিন।');
    if (!pr.version) throw new Error('প্রথম ভিডিওটা এখনো তৈরি হয়নি।');
  } else {
    let base = null;
    if (p.baseVideoId) {
      const v = (await ctx.tx`select id from content_videos where business_id = ${ctx.biz} and id = ${int(p.baseVideoId)}`)[0];
      if (!v) throw new Error('যে ভিডিওটা দেখে বানাতে চান, সেটা আর নেই।');
      base = Number(v.id);
    }
    const title = prompt.replace(/\s+/g, ' ').slice(0, 70);
    pr = (await ctx.tx`insert into content_studio_projects (business_id, user_id, title, base_video_id) values (${ctx.biz}, ${ctx.s.userId}, ${title}, ${base}) returning *`)[0];
  }
  const kind = p.projectId ? 'revise' : 'new';
  const m = (await ctx.tx`insert into content_studio_msgs (business_id, project_id, user_id, body) values (${ctx.biz}, ${pr.id}, ${ctx.s.userId}, ${prompt}) returning id`)[0];
  const j = (await ctx.tx`insert into content_studio_jobs (business_id, project_id, user_id, kind, prompt) values (${ctx.biz}, ${pr.id}, ${ctx.s.userId}, ${kind}, ${prompt}) returning id`)[0];
  await ctx.tx`update content_studio_projects set updated_at = now() where id = ${pr.id}`;
  if (refs.length) await ctx.tx`update content_studio_refs set state = 'sent', sent_at = now(), project_id = ${pr.id}, msg_id = ${m.id}, job_id = ${j.id}
                                where id in ${ctx.tx(refs.map((r) => r.id))}`;
  return { projectId: Number(pr.id), jobId: Number(j.id), msgId: Number(m.id), refs: refs.length };
}

export async function erpStudioFinish(ctx, payload) {
  await gate(ctx, 'manager');
  const p = payload || {};
  const pr = await project(ctx, p.projectId);
  if (pr.user_id !== ctx.s.userId && !roleAtLeast(ctx.s.role, 'owner')) throw new Error('এটা অন্য কারো ভিডিও।');
  const action = str(p.action);
  if (!pr.version) throw new Error('ভিডিওটা এখনো তৈরি হয়নি।');
  const ver = int(p.version) || Number(pr.version);
  const job = (await ctx.tx`select * from content_studio_jobs where project_id = ${pr.id} and state = 'done' and version = ${ver} order by id desc limit 1`)[0];
  if (!job || !job.video_id) throw new Error('এই ভার্সনটা পাওয়া গেল না।');
  if (action === 'save') {
    await ctx.tx`update content_studio_projects set state = 'saved', updated_at = now() where id = ${pr.id}`;
    await ctx.tx`insert into content_studio_msgs (business_id, project_id, user_id, body, version) values (${ctx.biz}, ${pr.id}, ${ctx.s.userId}, ${'সেভ করেছেন (v' + ver + ')'}, ${ver})`;
    return { ok: true, state: 'saved' };
  }
  if (action === 'draft') {
    await ctx.tx`update content_videos set hidden = false where business_id = ${ctx.biz} and id = ${job.video_id}`;
    await ctx.tx`update content_studio_projects set state = 'draft', updated_at = now() where id = ${pr.id}`;
    await ctx.tx`insert into content_studio_msgs (business_id, project_id, user_id, body, version) values (${ctx.biz}, ${pr.id}, ${ctx.s.userId}, ${'ড্রাফটে দিয়েছেন (v' + ver + ') - কনটেন্ট ডেস্কের ভিডিও তালিকায় আছে'}, ${ver})`;
    return { ok: true, state: 'draft', videoId: Number(job.video_id) };
  }
  if (action === 'improve') {
    if (pr.user_id !== ctx.s.userId) throw new Error('অন্য কারো ভিডিও আরো ভালো করতে নিজের নামে নতুন ভিডিও বানান।');
    const open = await ctx.tx`select 1 from content_studio_jobs where project_id = ${pr.id} and state in ('queued', 'running')`;
    if (open.length) throw new Error('এই ভিডিওর আগের কাজটা এখনো চলছে।');
    const last = (await ctx.tx`select max(created_at) last from content_studio_jobs where business_id = ${ctx.biz} and user_id = ${ctx.s.userId}`)[0].last;
    if (last && Date.now() - new Date(last).getTime() < ASK_GAP_S * 1000) throw new Error('একটু থামুন, কয়েক সেকেন্ড পরে আবার পাঠান।');
    const text = str(p.prompt) || 'আরো ভালো করুন';
    await ctx.tx`insert into content_studio_msgs (business_id, project_id, user_id, body, version) values (${ctx.biz}, ${pr.id}, ${ctx.s.userId}, ${text}, ${ver})`;
    const j = (await ctx.tx`insert into content_studio_jobs (business_id, project_id, user_id, kind, prompt) values (${ctx.biz}, ${pr.id}, ${ctx.s.userId}, 'improve', ${text}) returning id`)[0];
    await ctx.tx`update content_studio_projects set updated_at = now() where id = ${pr.id}`;
    return { ok: true, jobId: Number(j.id) };
  }
  throw new Error('কী করবেন: সেভ, ড্রাফট, না আরো ভালো?');
}

export async function erpStudioVideoUrl(ctx, payload) {
  await gate(ctx, 'manager');
  const p = payload || {};
  let vid;
  if (p.projectId) {
    const pr = await project(ctx, p.projectId);
    const ver = int(p.version) || Number(pr.version);
    const j = (await ctx.tx`select video_id from content_studio_jobs where project_id = ${pr.id} and state = 'done' and version = ${ver} order by id desc limit 1`)[0];
    vid = j && j.video_id;
  } else vid = int(p.videoId);
  if (!vid) throw new Error('এই ভার্সনটা পাওয়া গেল না।');
  const v = (await ctx.tx`select file_path from content_videos where business_id = ${ctx.biz} and id = ${vid}`)[0];
  if (!v) throw new Error('ভিডিওর ফাইলটা আর নেই।');
  const s = ctx.deps && ctx.deps.storage;
  if (!s || !s.url) throw new Error('এই সার্ভারে ফাইল রাখার ব্যবস্থা নেই।');
  const url = await s.url(ctx.biz, 'content', str(v.file_path).replace(/^content\//, ''), 3600);
  if (!url) throw new Error('ভিডিওর লিংক বানানো গেল না। একটু পরে আবার চেষ্টা করুন।');
  return { url, expiresIn: 3600 };
}

// ------------------------------------------------------------------ studioref-1: reference pictures and videos
const REF_TYPES = {
  jpg: ['image', 'image/jpeg'], jpeg: ['image', 'image/jpeg'], png: ['image', 'image/png'], webp: ['image', 'image/webp'],
  heic: ['image', 'image/heic'], heif: ['image', 'image/heif'],
  mp4: ['video', 'video/mp4'], mov: ['video', 'video/quicktime'], webm: ['video', 'video/webm'],
};
export const REF_LIMIT = { image: { max: 6, bytes: 15 * 1024 * 1024, word: 'ছবি', mb: '১৫' }, video: { max: 2, bytes: 200 * 1024 * 1024, word: 'ভিডিও', mb: '২০০' } };
const bn = (n) => String(n).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
// studioref-2: the video sites a link may come from (subdomains too: m.facebook.com, vm.tiktok.com, www.youtube.com)
export const LINK_SITES = { 'youtube.com': 'YouTube', 'youtu.be': 'YouTube', 'facebook.com': 'Facebook', 'fb.watch': 'Facebook',
  'instagram.com': 'Instagram', 'tiktok.com': 'TikTok' };
export function refLinkOf(raw) {
  let s = str(raw).replace(/\s+/g, '');
  if (!s || s.length > 500) return null;
  if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');   // "youtu.be/abc" pasted without https://
  let u;
  try { u = new URL(s); } catch (_) { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || u.username || u.password || u.port) return null;
  const h = u.hostname.toLowerCase().replace(/\.$/, '');
  const d = Object.keys(LINK_SITES).find((k) => h === k || h.endsWith('.' + k));
  if (!d || u.pathname.replace(/\/+$/, '') === '') return null;   // the site's home page is not a video
  return { url: u.toString(), site: LINK_SITES[d] };
}
const isLink = (r) => /^link\//.test(str(r.file_path));
function refType(name, mime) {
  const ext = (str(name).toLowerCase().match(/\.([a-z0-9]{2,5})$/) || [])[1] || '';
  const t = REF_TYPES[ext];
  if (t) return { ext: ext === 'jpeg' ? 'jpg' : ext, kind: t[0], mime: t[1] };
  const m = str(mime).toLowerCase();   // a phone sometimes gives a name with no extension: the type decides
  const e2 = ext ? '' : Object.keys(REF_TYPES).find((k) => REF_TYPES[k][1] === m);
  return e2 ? { ext: e2 === 'jpeg' ? 'jpg' : e2, kind: REF_TYPES[e2][0], mime: m } : null;
}
async function refUrl(ctx, path, secs) {
  const s = ctx.deps && ctx.deps.storage;
  if (!s || !s.url) return '';
  try { return (await s.url(ctx.biz, 'content', str(path).replace(/^content\//, ''), secs || 3600)) || ''; } catch (_) { return ''; }
}
async function refOut(ctx, r, withUrl) {
  const used = r.used && typeof r.used === 'object' ? r.used : {};
  const link = isLink(r) ? refLinkOf(r.name) : null;   // studioref-2: a link ref's "url" is the link itself
  return { id: Number(r.id), kind: str(r.kind), name: str(r.name), mime: str(r.mime), bytes: Number(r.bytes) || 0, note: str(r.note),
    mode: str(r.mode) || 'better', state: str(r.state), msgId: r.msg_id == null ? null : Number(r.msg_id),
    source: isLink(r) ? 'link' : 'file', site: link ? link.site : '', failed: str(used.failed),
    shown: !!used.shown, night: str(used.night),
    url: isLink(r) ? (link ? link.url : '') : withUrl && r.state !== 'uploading' ? await refUrl(ctx, r.file_path, 3600) : '' };
}
async function myOpenRefs(ctx) {
  return ctx.tx`select * from content_studio_refs where business_id = ${ctx.biz} and user_id = ${ctx.s.userId}
                and (state = 'ready' or (state = 'uploading' and created_at > now() - interval '2 hours')) order by id`;
}
async function openOut(ctx) {
  const out = [];
  for (const r of await myOpenRefs(ctx)) if (r.state === 'ready') out.push(await refOut(ctx, r, true));
  return out;
}
async function myRef(ctx, id) {
  const r = (await ctx.tx`select * from content_studio_refs where business_id = ${ctx.biz} and id = ${int(id)}`)[0];
  if (!r || r.user_id !== ctx.s.userId) throw new Error('এই ফাইলটা পাওয়া গেল না।');
  return r;
}
export async function erpStudioRefUpload(ctx, payload) {
  await gate(ctx, 'manager');
  const p = payload || {};
  const t = refType(p.name, p.mime);
  if (!t) throw new Error('এই ধরনের ফাইল নেওয়া যায় না। ছবি: JPG, PNG, WEBP, HEIC; ভিডিও: MP4, MOV, WEBM।');
  const L = REF_LIMIT[t.kind];
  const bytes = Math.round(Number(p.bytes) || 0);
  if (!(bytes > 0)) throw new Error('ফাইলটা খালি মনে হচ্ছে। আরেকবার বাছুন।');
  if (bytes > L.bytes) throw new Error(L.word + ' ' + L.mb + ' MB-এর বেশি হলে নেওয়া যায় না। ছোট করে দিন।');
  const open = (await myOpenRefs(ctx)).filter((r) => r.kind === t.kind);
  if (open.length >= L.max) throw new Error('একবারে সর্বোচ্চ ' + bn(L.max) + 'টা ' + L.word + ' দেওয়া যায়।');
  const s = ctx.deps && ctx.deps.storage;
  if (!s || !s.signUpload) throw new Error('এই সার্ভারে ফাইল রাখার ব্যবস্থা নেই।');
  const name = 'studio-refs/' + crypto.randomUUID() + '.' + t.ext;
  const up = await s.signUpload(ctx.biz, 'content', name);
  const r = (await ctx.tx`insert into content_studio_refs (business_id, user_id, kind, file_path, name, mime, bytes)
                          values (${ctx.biz}, ${ctx.s.userId}, ${t.kind}, ${'content/' + name}, ${str(p.name).slice(0, 120) || name}, ${t.mime}, ${bytes}) returning *`)[0];
  return { ref: await refOut(ctx, r, false), upload: { url: up.url, token: up.token, path: 'content/' + name, contentType: t.mime, maxBytes: L.bytes } };
}
// studioref-2: a pasted video link (YouTube / Facebook / Instagram / TikTok) -> a video ref, ready at once
export async function erpStudioRefLink(ctx, payload) {
  await gate(ctx, 'manager');
  const raw = str(payload && payload.url);
  if (!raw) throw new Error('ভিডিওর লিংকটা দিন।');
  const l = refLinkOf(raw);
  if (!l) throw new Error('এই লিংকটা নেওয়া যায় না। শুধু YouTube, Facebook, Instagram বা TikTok-এর ভিডিওর লিংক দিন।');
  const open = (await myOpenRefs(ctx)).filter((r) => r.kind === 'video');
  if (open.length >= REF_LIMIT.video.max) throw new Error('একবারে সর্বোচ্চ ' + bn(REF_LIMIT.video.max) + 'টা ভিডিও দেওয়া যায় (ফাইল আর লিংক মিলিয়ে)।');
  if (open.some((r) => isLink(r) && str(r.name) === l.url)) throw new Error('এই লিংকটা আগেই দেওয়া আছে।');
  const r = (await ctx.tx`insert into content_studio_refs (business_id, user_id, kind, file_path, name, mime, bytes, state, confirmed_at)
                          values (${ctx.biz}, ${ctx.s.userId}, 'video', ${'link/' + crypto.randomUUID()}, ${l.url}, 'text/uri-list', 0, 'ready', now()) returning *`)[0];
  return { ref: await refOut(ctx, r, true) };
}
export async function erpStudioRefConfirm(ctx, payload) {
  await gate(ctx, 'manager');
  const r = await myRef(ctx, payload && payload.id);
  if (r.state === 'removed' || r.state === 'sent') throw new Error('এই ফাইলটা আর বদলানো যায় না।');
  const u = (await ctx.tx`update content_studio_refs set state = 'ready', confirmed_at = coalesce(confirmed_at, now()) where id = ${r.id} returning *`)[0];
  return { ref: await refOut(ctx, u, true) };
}
export async function erpStudioRefSet(ctx, payload) {
  await gate(ctx, 'manager');
  const p = payload || {};
  const r = await myRef(ctx, p.id);
  if (r.state !== 'ready' && r.state !== 'uploading') throw new Error('পাঠানোর পর আর বদলানো যায় না।');
  const mode = p.mode == null ? str(r.mode) : str(p.mode);
  if (!['same', 'better'].includes(mode)) throw new Error('"হুবহু এই ধরনে" না "আরো ভালো করে"?');
  const note = p.note == null ? r.note : (str(p.note).slice(0, 200) || null);
  const u = (await ctx.tx`update content_studio_refs set mode = ${mode}, note = ${note} where id = ${r.id} returning *`)[0];
  return { ref: await refOut(ctx, u, false) };
}
export async function erpStudioRefRemove(ctx, payload) {
  await gate(ctx, 'manager');
  const r = await myRef(ctx, payload && payload.id);
  if (r.state === 'sent') throw new Error('পাঠানো ফাইল কাজের খাতায় থেকে যায়, সরানো যায় না।');
  await ctx.tx`update content_studio_refs set state = 'removed', removed_at = now() where id = ${r.id}`;
  return { ok: true };
}
// the refs a prompt / feedback carries: the person's own, uploaded, not sent yet; at most 6 pictures and 2 videos
async function takeRefs(ctx, ids) {
  const want = [...new Set((Array.isArray(ids) ? ids : []).map(int).filter(Boolean))];
  if (!want.length) return [];
  if (want.length > REF_LIMIT.image.max + REF_LIMIT.video.max) throw new Error('এত ফাইল একবারে দেওয়া যায় না।');
  const rows = await ctx.tx`select * from content_studio_refs where business_id = ${ctx.biz} and id in ${ctx.tx(want)}`;
  if (rows.length !== want.length || rows.some((r) => r.user_id !== ctx.s.userId)) throw new Error('একটা ফাইল পাওয়া গেল না। পাতাটা নতুন করে আনুন।');
  if (rows.some((r) => r.state === 'uploading')) throw new Error('একটা ফাইল এখনো উঠছে। শেষ হলে পাঠান।');
  if (rows.some((r) => r.state !== 'ready')) throw new Error('একটা ফাইল আগেই পাঠানো বা সরানো হয়েছে।');
  for (const k of ['image', 'video']) {
    if (rows.filter((r) => r.kind === k).length > REF_LIMIT[k].max) throw new Error('একবারে সর্বোচ্চ ' + bn(REF_LIMIT[k].max) + 'টা ' + REF_LIMIT[k].word + ' দেওয়া যায়।');
  }
  return rows;
}

// the PC engine reads a job's refs: the engine key of THIS business (like erpContentStudioUploadUrl), 1-hour links;
// it also writes back what it did with each one (shown in the video / a night clip asked for) - the log shows it
export async function erpContentStudioRefs(ctx, payload) {
  const c2 = await studioCtx(ctx, payload);
  const p = payload || {};
  const job = int(p.jobId);
  if (!job) throw new Error('Which studio job?');
  const j = (await c2.tx`select id, project_id from content_studio_jobs where business_id = ${c2.biz} and id = ${job}`)[0];
  if (!j) throw new Error('That studio job is not in this business.');
  if (p.used && typeof p.used === 'object') {
    for (const [id, u] of Object.entries(p.used)) {
      const v = { shown: !!(u && u.shown), night: str(u && u.night).slice(0, 300) };
      if (u && u.failed) v.failed = str(u.failed).slice(0, 300);   // studioref-2: a link that could not be downloaded
      await c2.tx`update content_studio_refs set used = ${c2.tx.json(v)} where business_id = ${c2.biz} and job_id = ${job} and id = ${int(id)}`;
    }
  }
  const rows = await c2.tx`select * from content_studio_refs where business_id = ${c2.biz} and job_id = ${job} and state = 'sent' order by id`;
  const out = [];
  for (const r of rows) out.push({ ...(await refOut(c2, r, true)), path: str(r.file_path) });   // a link ref: source 'link', url = the link
  return { jobId: job, projectId: Number(j.project_id), refs: out };
}

// ------------------------------------------------------------------ the person's own rules
async function whose(ctx, userId) {
  const u = str(userId) || ctx.s.userId;
  if (u !== ctx.s.userId && !roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('অন্য কারো নিয়ম শুধু মালিক পড়তে পারেন।');
  return u;
}
export async function erpStudioRules(ctx, payload) {
  await gate(ctx, 'manager');
  const u = await whose(ctx, payload && payload.userId);
  const rules = await ctx.tx`select * from content_studio_rules where business_id = ${ctx.biz} and user_id = ${u} order by active desc, id desc`;
  const fb = await ctx.tx`select m.id, m.body, m.created_at, p.title, p.id as pid from content_studio_msgs m join content_studio_projects p on p.id = m.project_id
                          where m.business_id = ${ctx.biz} and m.user_id = ${u} order by m.id desc limit 300`;
  let locked = LOCKED_DEFAULT;
  try { const c = await getConfig(ctx, 'studio_locked_rules', ''); if (c) { const a = JSON.parse(c); if (Array.isArray(a) && a.length) locked = a.map(str).filter(Boolean); } } catch (_) { /* default list */ }
  const people = roleAtLeast(ctx.s.role, 'shareholder')
    ? (await ctx.tx`select distinct p.user_id, (select full_name from profiles where id = p.user_id) as who from content_studio_projects p where p.business_id = ${ctx.biz}`)
        .map((r) => ({ id: r.user_id, name: str(r.who) })) : [];
  return {
    userId: u, name: await myName(ctx, u), mine: u === ctx.s.userId, people,
    rules: rules.map((r) => ({ id: Number(r.id), kind: str(r.kind), body: str(r.body), source: str(r.source), used: Number(r.used) || 0, active: !!r.active,
      at: iso(r.created_at), projectId: r.project_id == null ? null : Number(r.project_id) })),
    locked,
    feedback: fb.map((m) => ({ id: Number(m.id), body: str(m.body), at: iso(m.created_at), title: str(m.title), projectId: Number(m.pid) })),
  };
}
export async function erpStudioRuleSave(ctx, payload) {
  await gate(ctx, 'manager');
  const p = payload || {};
  const body = str(p.body).slice(0, 500);
  if (body.length < 2) throw new Error('নিয়মটা লিখুন।');
  const kind = KINDS.includes(str(p.kind)) ? str(p.kind) : 'rule';
  if (p.id) {
    const r = (await ctx.tx`update content_studio_rules set body = ${body}, kind = ${kind} where business_id = ${ctx.biz} and user_id = ${ctx.s.userId} and id = ${int(p.id)} and active returning id`)[0];
    if (!r) throw new Error('নিয়মটা পাওয়া গেল না।');
    return { id: Number(r.id) };
  }
  const r = (await ctx.tx`insert into content_studio_rules (business_id, user_id, kind, body, source) values (${ctx.biz}, ${ctx.s.userId}, ${kind}, ${body}, 'নিজে লিখেছেন') returning id`)[0];
  return { id: Number(r.id) };
}
export async function erpStudioRuleRemove(ctx, payload) {
  await gate(ctx, 'manager');
  const r = (await ctx.tx`update content_studio_rules set active = false, removed_at = now() where business_id = ${ctx.biz} and user_id = ${ctx.s.userId} and id = ${int(payload && payload.id)} returning id`)[0];
  if (!r) throw new Error('নিয়মটা পাওয়া গেল না।');
  return { ok: true };
}
export async function erpStudioForget(ctx, payload) {
  await gate(ctx, 'manager');
  const r = (await ctx.tx`update content_studio_rules set active = false, removed_at = now() where business_id = ${ctx.biz} and user_id = ${ctx.s.userId} and id = ${int(payload && payload.ruleId)} returning project_id, body`)[0];
  if (!r) throw new Error('নিয়মটা পাওয়া গেল না।');
  if (r.project_id) await ctx.tx`insert into content_studio_msgs (business_id, project_id, user_id, body) values (${ctx.biz}, ${r.project_id}, ${ctx.s.userId}, ${'শুধু এই ভিডিওর জন্য: ' + str(r.body)})`;
  return { ok: true };
}
export async function erpStudioPhone(ctx, payload) {
  await gate(ctx, 'manager');
  const raw = str(payload && payload.phone);
  let ph = '';
  if (raw) { try { ph = phone11(raw); } catch (_) { throw new Error('১১ সংখ্যার মোবাইল নম্বর দিন।'); } }
  let m = {};
  try { m = JSON.parse((await getConfig(ctx, 'studio_phones', '')) || '{}') || {}; } catch (_) { m = {}; }
  if (ph) m[ctx.s.userId] = ph; else delete m[ctx.s.userId];
  await setConfig(ctx, 'studio_phones', JSON.stringify(m));
  return { phone: ph };
}

// ------------------------------------------------------------------ bell + WhatsApp
export async function studioBell(ctx) {
  try {
    const rows = await ctx.tx`select j.id, j.version, j.finished_at, j.state, j.note, p.id as pid, p.title from content_studio_jobs j join content_studio_projects p on p.id = j.project_id
                              where j.business_id = ${ctx.biz} and j.user_id = ${ctx.s.userId} and j.state in ('done', 'failed') and j.seen_at is null
                                and j.finished_at > now() - interval '3 days' order by j.id desc limit 5`;
    return rows.map((r) => ({ key: 'studio-' + r.id, level: 'ok', kind: 'studio', projectId: Number(r.pid), go: 'studio:' + r.pid,
      title: r.state === 'done' ? 'আপনার ভিডিও তৈরি: ' + str(r.title).slice(0, 60) + ' (v' + r.version + ')' : 'ভিডিওটা বানানো গেল না: ' + str(r.title).slice(0, 60),
      detail: r.state === 'done' ? 'কনটেন্ট ডেস্ক → স্টুডিও' : str(r.note).slice(0, 140), view: 'contentdesk', tab: 'studio' }));
  } catch (_) { return []; }
}
export async function studioNotifyTick(ctx) {
  const rows = await ctx.tx`select j.*, p.title from content_studio_jobs j join content_studio_projects p on p.id = j.project_id
                            where j.business_id = ${ctx.biz} and j.state in ('done', 'failed') and j.notified_at is null and j.finished_at > now() - interval '1 day' order by j.id limit 10`;
  if (!rows.length) return { sent: 0 };
  let phones = {};
  try { phones = JSON.parse((await getConfig(ctx, 'studio_phones', '')) || '{}') || {}; } catch (_) { phones = {}; }
  let chs = [];
  try {
    chs = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind in ('wa_evo', 'wa_cloud', 'wa_sender') and status <> 'removed' order by (status = 'live') desc, id`;
  } catch (_) { chs = []; }
  const { sendOut } = chs.length ? await import('./inboxch.js') : { sendOut: null };
  let sent = 0;
  for (const j of rows) {
    const ph = str(phones[j.user_id]);
    if (ph && sendOut) {
      const text = j.state === 'done'
        ? 'আপনার ভিডিও তৈরি: ' + str(j.title).slice(0, 80) + ' (v' + j.version + ')। দেখতে ERP খুলুন → কনটেন্ট ডেস্ক → স্টুডিও।'
        : 'ভিডিওটা বানানো গেল না: ' + str(j.title).slice(0, 80) + '। ' + str(j.note).slice(0, 160);
      for (const ch of chs) {
        let r;
        try { r = await sendOut(ctx, ch, { external_id: '880' + ph.slice(1) }, { kind: 'text', text }); } catch (e) { r = { ok: false }; }
        if (r && r.ok) { sent++; break; }
      }
    }
    await ctx.tx`update content_studio_jobs set notified_at = now() where id = ${j.id}`;   // once, sent or not (the bell still shows it)
  }
  return { sent };
}

export const HANDLERS = { erpStudio, erpStudioProject, erpStudioAsk, erpStudioFinish, erpStudioVideoUrl, erpStudioRules, erpStudioRuleSave,
  erpStudioRuleRemove, erpStudioForget, erpStudioPhone, erpStudioRefUpload, erpStudioRefConfirm, erpStudioRefSet, erpStudioRefRemove,
  erpStudioRefLink, erpContentStudioRefs };
