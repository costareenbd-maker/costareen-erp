// brand-1 (owner 3 Nov 2026): the owner's personal-brand desk as a business of its own in the switch. The work is done
// by open-source tools on his PC (Postiz, a pacer, later Twenty, Chatwoot, Immich ...) behind one small "bridge" that
// is reached through Cloudflare Tunnel. The ERP stays the only face: these calls carry the screen's wishes to the
// bridge and bring the answers back. The office is open while the PC is on; the PC checks in every minute.
//
//   erpBrandDesk()                       online or not, the last check-in, and (when online) today's lines and posts
//   erpBrandDeskPost({networks, content, at?, urgent?})   one post to several networks, through the PC's pacer
//   erpBrandDeskDecide({id, action})     a post that was too late: send | drop
//   erpBrandDeskSetup({key})             owner: the bridge's key (sealed, never shown again); marks the business kind 'brand'
//   erpBrandDeskBoard()                  brand-2: the content board (Kanboard on the PC): Idea -> ... -> Repurposed
//   erpBrandDeskCard({title, description?, tags?, column?})   a new card
//   erpBrandDeskMove({id, column})       a card to another step;  erpBrandDeskDone({id}) a card finished (closed)
//   erpBrandDeskIdeas()                  brand-3: the idea bank (Memos on the PC), newest first
//   erpBrandDeskIdea({content})          a new idea;  erpBrandDeskIdeaToBoard({id}) the idea becomes a card in Idea
//   erpBrandDeskPeople()                 brand-4: people met through the content (Twenty on the PC)
//   erpBrandDeskPerson({name, email?, phone?, job?, audience?, about?, source?})   a new person
//   erpBrandDeskToLeads({id, business})  that person becomes a lead of one of the owner's businesses (its Leads menu)
//   erpBrandDeskVideos({q?})             brand-5: the footage library (Immich on the PC): newest, or found by meaning
//                                        ("me talking in the shop"), with a small preview each
//   erpBrandDeskShorts()                 brand-6: the shorts being made / made (OpenShorts on the PC, local AI)
//   erpBrandDeskMakeShorts({id})         one video -> 9:16 clips with captions; the clips land in the footage library
//   erpBrandDeskHello({biz, url})        the PC: "I am on, here is my address" (owner's machine key, any active business)
//
// Researched first (owner rule "open source first"): Postiz does the posting, the pacer keeps one line per network so
// missed posts never go out in one burst; nothing generic is rebuilt here. Owner-only "Only me" app `branddesk`.
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig, getSecret, setSecret } from '../lib/ext.js';
import { platformAdmin } from './platform.js';
import { addLead } from './leads.js';
import { appIsOff } from './apps.js';

// brand-23: owner-facing messages are Bangla (critique B section 3)
const NUM_BN = { reactions: 'রিঅ্যাকশন', comments: 'কমেন্ট', shares: 'শেয়ার', views: 'দেখা', followers: 'ফলোয়ার' };
const bnNum = (v) => String(v).replace(/[0-9]/g, (d) => '০১২৩৪৫৬৭৮৯'[d]);
const NET_NAMES = { facebook: 'Facebook', instagram: 'Instagram', linkedin: 'LinkedIn', youtube: 'YouTube', tiktok: 'TikTok', x: 'X', twitter: 'X', threads: 'Threads', pinterest: 'Pinterest' };
const netName = (p) => NET_NAMES[p] || p;

const str = (v) => String(v == null ? '' : v).trim();
const ONLINE_MS = 3 * 60e3, BRIDGE_MS = 20000;

async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('ব্র্যান্ড ডেস্ক শুধু মালিক খুলতে পারেন।');
  if (!(await platformAdmin(ctx)) && await appIsOff(ctx.deps, ctx.sql, 'branddesk', ctx)) throw new Error('এই ERP-তে ব্র্যান্ড ডেস্ক এখনো চালু হয়নি।');
}

async function state(ctx) {
  let s = {}; try { s = JSON.parse(str(await getConfig(ctx, 'brand_bridge', '')) || '{}'); } catch (_) { s = {}; }
  const seen = s.seen ? new Date(s.seen) : null;
  return { url: str(s.url), seen, online: !!(seen && ctx.now - seen < ONLINE_MS) };
}

async function bridge(ctx, path, body, ms) {
  const st = await state(ctx), key = await getSecret(ctx, 'BRAND_BRIDGE_KEY');
  if (!key) throw new Error('ব্র্যান্ড ডেস্ক চালু হয়নি। নিয়ম পেজের নিচে Mac-এর চাবি বসান।');
  if (!st.online || !st.url) throw new Error('Mac বন্ধ, তাই ব্র্যান্ড ডেস্ক এখন কাজ করছে না। Mac চালু হলে আবার খুলবে।');
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  let r;
  try {
    r = await f(st.url + path, { method: body ? 'POST' : 'GET', headers: { 'X-Bridge-Key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(ms || BRIDGE_MS) });
  } catch (_) { throw new Error('Mac সাড়া দিল না। এইমাত্র চালু করলে এক মিনিট পর আবার চেষ্টা করুন।'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('Mac চাবিটা নিল না। নিয়ম পেজের নিচে চাবিটা আবার বসান।');
  if (!r.ok) throw new Error(str(j.error) || ('Mac থেকে ভুল উত্তর এল (' + r.status + ')। একটু পরে আবার চেষ্টা করুন।'));
  return j;
}

export async function erpBrandDesk(ctx) {
  await gate(ctx);
  const st = await state(ctx), keySet = !!(await getSecret(ctx, 'BRAND_BRIDGE_KEY'));
  const out = { online: st.online, seen: st.seen ? st.seen.toISOString() : null, keySet, today: null, error: '' };
  if (st.online && keySet) { try { out.today = await bridge(ctx, '/today'); } catch (e) { out.error = e.message; } }
  return out;
}

// brand-12 (13 Nov 2026): the Brand Cockpit's one read - the week of posts, what waits, what is stuck, tasks, calls and
// a live up/down of every tool on the Mac (the Connections map). Offline: the desk state only, the page says so.
export async function erpBrandDeskCockpit(ctx) {
  await gate(ctx);
  const st = await state(ctx), keySet = !!(await getSecret(ctx, 'BRAND_BRIDGE_KEY'));
  const out = { online: st.online, seen: st.seen ? st.seen.toISOString() : null, keySet, cockpit: null, error: '' };
  if (st.online && keySet) { try { out.cockpit = await bridge(ctx, '/cockpit'); } catch (e) { out.error = e.message; } }
  return out;
}

// brand-15: trade news read every morning on the bridge (Bangladesh, Korea, China, Europe); 3 picked stories become a
// fact-checked Facebook (Bangla) and LinkedIn (English) draft each, waiting for approval like every other draft
export async function erpBrandDeskNews(ctx) {
  await gate(ctx);
  return bridge(ctx, '/news');
}
// brand-17: Train (writing styles learned from writing he likes) and the LinkedIn yellow lane (AI prepares, he posts by hand)
const STYLE_NETS = ['linkedin', 'facebook', 'instagram', 'youtube', 'threads', 'tiktok'];
const LI_KINDS = ['comment', 'reply', 'connect', 'dm'];
const cnt = (x) => (x === '' || x == null ? null : (Number.isFinite(Number(x)) && Number(x) >= 0 ? Math.round(Number(x)) : NaN));
export async function erpBrandDeskStyles(ctx) { await gate(ctx); return bridge(ctx, '/styles'); }
export async function erpBrandDeskStyleAdd(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, text = str(p.text);
  if (text.length < 80) throw new Error('আরও লম্বা লেখা দিন (পুরো একটা পোস্ট)।');
  if (text.length > 12000) throw new Error('১২ হাজার অক্ষরের কম রাখুন।');
  const url = str(p.url);
  if (url && !/^https:\/\//.test(url)) throw new Error('লিংকটা https:// দিয়ে শুরু হতে হবে।');
  const body = { text, url: url.slice(0, 500), author: str(p.author).slice(0, 200), platform: STYLE_NETS.includes(str(p.platform)) ? str(p.platform) : '' };
  for (const k of ['reactions', 'comments', 'shares', 'views', 'followers']) { const n = cnt(p[k]); if (Number.isNaN(n)) throw new Error(NUM_BN[k] + '-এর ঘরে শুধু সংখ্যা দিন।'); body[k] = n; }
  return bridge(ctx, '/styles/add', body);
}
export async function erpBrandDeskStyleSet(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, b = {};
  if ('off' in p) b.off = !!p.off;
  if (p.id != null) { const id = parseInt(p.id, 10); if (!(id > 0)) throw new Error('একটা ধরন বাছুন।'); b.id = id; }
  if (p.platform != null) { if (!STYLE_NETS.includes(str(p.platform))) throw new Error('এই নেটওয়ার্ক চেনা নেই।'); b.platform = str(p.platform); b.on = !!p.on; }
  if (p.status != null) { if (!['active', 'retired'].includes(p.status)) throw new Error('এই কাজটা চেনা নেই। পেজটা নতুন করে আনুন।'); b.status = p.status; }
  if (p.name_bn != null) b.name_bn = str(p.name_bn).slice(0, 80);
  if (!Object.keys(b).length) throw new Error('বদলানোর কিছু নেই।');
  return bridge(ctx, '/styles/set', b);
}
export async function erpBrandDeskStyleCreator(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  if (p.id != null) return bridge(ctx, '/styles/creator', { id: parseInt(p.id, 10), active: !!p.active });
  const url = str(p.url), platform = str(p.platform);
  if (!['linkedin', 'facebook'].includes(platform)) throw new Error('Facebook বা LinkedIn বাছুন।');
  if (!/^https:\/\/(www\.|m\.)?(facebook|linkedin)\.com\//.test(url)) throw new Error('facebook.com-এর পেজ বা linkedin.com-এর প্রোফাইলের লিংক দিন।');
  return bridge(ctx, '/styles/creator', { url: url.slice(0, 400), platform, name: str(p.name).slice(0, 120) });
}
export async function erpBrandDeskStyleScout(ctx) { await gate(ctx); return bridge(ctx, '/styles/scout', {}); }
export async function erpBrandDeskLi(ctx) { await gate(ctx); return bridge(ctx, '/li'); }
export async function erpBrandDeskLiAdd(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, kind = str(p.kind), url = str(p.url), context = str(p.context);
  if (!LI_KINDS.includes(kind)) throw new Error('কমেন্ট, রিপ্লাই, কানেকশন বা মেসেজ বাছুন।');
  if (url && !/^https:\/\/(www\.)?linkedin\.com\//.test(url)) throw new Error('linkedin.com-এর লিংক দিন।');
  if (context.length > 8000) throw new Error('ওনার লেখা ৮ হাজার অক্ষরের কম রাখুন।');
  return bridge(ctx, '/li/add', { kind, url: url.slice(0, 600), context, name: str(p.name).slice(0, 200) });
}
export async function erpBrandDeskLiMark(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = parseInt(p.id, 10), state = str(p.state);
  if (!(id > 0)) throw new Error('একটা কাজ বাছুন।');
  if (!['done', 'skipped', 'accepted', 'redo', 'edit'].includes(state)) throw new Error('এই কাজটা চেনা নেই। পেজটা নতুন করে আনুন।');
  return bridge(ctx, '/li/mark', { id, state, text: state === 'edit' ? str(p.text).slice(0, 3000) : undefined });
}
export async function erpBrandDeskLiKill(ctx, payload) { await gate(ctx); return bridge(ctx, '/li/kill', { on: !!(payload || {}).on }); }
export async function erpBrandDeskLiPull(ctx) { await gate(ctx); return bridge(ctx, '/li/pull', {}); }
// brand-19: the personal-brand model's weekly routine; every slot is the owner's to change
const R_PLATS = ['facebook', 'instagram', 'tiktok', 'youtube', 'linkedin', 'threads', 'x'];
const R_FORMATS = ['story', 'reel', 'text', 'news', 'album', 'face', 'photo', 'carousel', 'live', 'video', 'short', 'long', 'community', 'post', 'engage', 'trial'];
const R_PILLARS = ['', 'proof', 'teach', 'person', 'news'];
export async function erpBrandDeskRoutine(ctx) { await gate(ctx); return bridge(ctx, '/routine'); }
export async function erpBrandDeskRoutineSlot(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = p.id == null ? 0 : parseInt(p.id, 10);
  if (p.id != null && !(id > 0)) throw new Error('একটা ঘর বাছুন।');
  if (p.remove) { if (!id) throw new Error('একটা ঘর বাছুন।'); return bridge(ctx, '/routine/slot', { id, remove: true }); }
  const dow = parseInt(p.dow, 10), at = str(p.at), platform = str(p.platform), format = str(p.format), pillar = str(p.pillar), level = parseInt(p.level || 2, 10);
  if (!(dow >= 0 && dow <= 6)) throw new Error('দিন বাছুন।');
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(at)) throw new Error('সময় দিন, যেমন ০৯:৩০।');
  if (!R_PLATS.includes(platform)) throw new Error('এই নেটওয়ার্ক চেনা নেই।');
  if (!R_FORMATS.includes(format)) throw new Error('এই ধরনের পোস্ট চেনা নেই।');
  if (!R_PILLARS.includes(pillar)) throw new Error('এই বিষয় চেনা নেই।');
  if (![1, 2, 3].includes(level)) throw new Error('পরিকল্পনা হালকা, মাঝারি বা পুরো হতে হবে।');
  return bridge(ctx, '/routine/slot', { id: id || undefined, dow, at, platform, format, pillar, face: !!p.face, level, active: p.active !== false, topic: str(p.topic).slice(0, 200) });
}
export async function erpBrandDeskRoutineLevel(ctx, payload) {
  await gate(ctx);
  const level = parseInt((payload || {}).level, 10);
  if (![1, 2, 3].includes(level)) throw new Error('হালকা, মাঝারি বা পুরো বাছুন।');
  return bridge(ctx, '/routine/level', { level });
}
export async function erpBrandDeskRoutineReset(ctx) { await gate(ctx); return bridge(ctx, '/routine/reset', {}); }
// brand-20: news Reels - script from the checked facts, his own voice, scenes drawn and joined on the Mac
const REEL_NETS = ['facebook', 'instagram', 'tiktok', 'youtube'];
const reelId = (p) => { const id = parseInt((p || {}).id, 10); if (!(id > 0)) throw new Error('একটা Reel বাছুন।'); return id; };
export async function erpBrandDeskReels(ctx) { await gate(ctx); return bridge(ctx, '/reels'); }
export async function erpBrandDeskReelScript(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, news_id = parseInt(p.news_id, 10);
  if (!(news_id > 0)) throw new Error('একটা খবর বাছুন।');
  return bridge(ctx, '/reels/script', { news_id, photo: p.photo ? mediaRefs([p.photo])[0] : undefined });
}
export async function erpBrandDeskReelPhoto(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  return bridge(ctx, '/reels/photo', { id: reelId(p), photo: p.photo ? mediaRefs([p.photo])[0] : null });
}
export async function erpBrandDeskReelVoice(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, type = str(p.type).toLowerCase().split(';')[0], data = str(p.data);
  if (!/^(audio\/[a-z0-9.+-]+|video\/(mp4|webm))$/.test(type)) throw new Error('গলার রেকর্ডিং দিন।');
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Error('রেকর্ডিং ঠিকমতো আসেনি; আবার দিন।');
  if (data.length > 16000000) throw new Error('রেকর্ডিং অনেক বড়; দুই মিনিটের কম রাখুন।');
  return bridge(ctx, '/reels/voice', { id: reelId(p), type, data }, 150000);
}
export async function erpBrandDeskReelEdit(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, says = (Array.isArray(p.says) ? p.says : []).slice(0, 8).map((x) => str(x).slice(0, 400));
  return bridge(ctx, '/reels/edit', { id: reelId(p), says, caption: str(p.caption).slice(0, 2000) });
}
export async function erpBrandDeskReelRender(ctx, payload) { await gate(ctx); const p = payload || {}; return bridge(ctx, '/reels/render', { id: reelId(p), silent: !!p.silent }); }
export async function erpBrandDeskReelDrafts(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, platforms = [...new Set((Array.isArray(p.platforms) ? p.platforms : []).map((x) => str(x).toLowerCase()).filter((x) => REEL_NETS.includes(x)))];
  if (!platforms.length) throw new Error('অন্তত একটা নেটওয়ার্ক বাছুন।');
  return bridge(ctx, '/reels/drafts', { id: reelId(p), platforms });
}
// brand-21: the AI chooses another album picture for a draft; how long a used picture stays in the Brand album
export async function erpBrandDeskDraftRepick(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = parseInt(p.id, 10);
  if (!(id > 0)) throw new Error('একটা ড্রাফট বাছুন।');
  const exclude = (Array.isArray(p.exclude) ? p.exclude : []).map((x) => str(x)).filter((x) => /^[0-9a-f-]{20,64}$/i.test(x)).slice(0, 40);
  return bridge(ctx, '/drafts/repick', { id, exclude });
}
export async function erpBrandDeskMediaKeep(ctx, payload) {
  await gate(ctx);
  const days = parseInt((payload || {}).days, 10);
  if (![0, 30, 60, 90].includes(days)) throw new Error('বন্ধ, ৩০, ৬০ বা ৯০ দিন বাছুন।');
  return bridge(ctx, '/media/keep', { days });
}
export async function erpBrandDeskNewsRun(ctx) {
  await gate(ctx);
  return bridge(ctx, '/news/run', {});
}
export async function erpBrandDeskNewsMake(ctx, payload) {
  await gate(ctx);
  const id = parseInt((payload || {}).id, 10);
  if (!(id > 0)) throw new Error('একটা খবর বাছুন।');
  return bridge(ctx, '/news/make', { id });
}

// brand-13: a photo or video from the Brand album, already uploaded to Postiz by erpBrandDeskAttach
function mediaRefs(m) {
  if (m == null) return [];
  if (!Array.isArray(m)) throw new Error('ছবির তালিকায় গোলমাল। পেজটা নতুন করে আনুন।');
  if (m.length > 10) throw new Error('একটা পোস্টে সর্বোচ্চ ১০টা ছবি বা ভিডিও।');
  return m.map((x) => {
    const id = str(x && x.id), path = str(x && x.path);
    if (!/^[A-Za-z0-9_-]{4,64}$/.test(id) || !/^https:\/\/[^\s]{4,490}$/i.test(path)) throw new Error('পোস্টের একটা ছবি বা ভিডিও ঠিক নেই। সেটা সরিয়ে আবার দিন।');
    return { id, path };
  });
}
export async function erpBrandDeskMedia(ctx, payload) {
  await gate(ctx);
  const q = str(payload && payload.q).slice(0, 200);
  return bridge(ctx, '/media/library' + (q ? '?q=' + encodeURIComponent(q) : ''), undefined, 60000);
}
export async function erpBrandDeskAttach(ctx, payload) {
  await gate(ctx);
  const id = str(payload && payload.asset_id);
  if (!/^[0-9a-f-]{20,64}$/i.test(id)) throw new Error('একটা ছবি বা ভিডিও বাছুন।');
  return bridge(ctx, '/media/attach', { asset_id: id }, 140000);
}

// brand-16: a photo from his phone goes to the Brand album (Immich) and on to Postiz in one step
export async function erpBrandDeskUpload(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, type = str(p.type).toLowerCase(), data = str(p.data), name = str(p.name).slice(0, 120);
  if (!/^image\/(jpeg|png|webp|heic|heif)$/.test(type)) throw new Error('ছবি দিন (JPG, PNG, WebP বা HEIC)। ভিডিও Immich app দিয়ে Brand অ্যালবামে রাখুন।');
  if (!data || !/^[A-Za-z0-9+/=]+$/.test(data)) throw new Error('ছবিটা ঠিকমতো আসেনি; আবার দিন।');
  if (data.length > 20000000) throw new Error('ছবিটা অনেক বড়; ১৫ MB-এর কম দিন।');
  return bridge(ctx, '/media/upload', { name, type, data }, 150000);
}
// brand-16: the two universal cards on Ideas - (1) his photo/video + his words, (2) just an idea, researched first.
// The writer makes one draft per network, each in that network's own shape, with hashtags; the photo rides on every draft.
export async function erpBrandDeskIdeaPost(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, text = str(p.text);
  if (!text) throw new Error('আগে কয়েকটা কথা লিখুন।');
  if (text.length > 4000) throw new Error('৪ হাজার অক্ষরের কম রাখুন; বাকিটা AI লিখবে।');
  const plats = [...new Set((Array.isArray(p.platforms) ? p.platforms : []).map((x) => str(x).toLowerCase()).filter((x) => DRAFT_PLATFORMS.includes(x)))].slice(0, 6);
  if (!plats.length) throw new Error('অন্তত একটা নেটওয়ার্ক বাছুন।');
  const body = { text, platforms: plats, deep: !!p.deep };
  if (p.media) {
    const m = mediaRefs([p.media])[0], asset = str(p.media.asset);
    if (asset && !/^[0-9a-f-]{20,64}$/i.test(asset)) throw new Error('ছবি বা ভিডিওটা ঠিক নেই। আবার বাছুন।');
    body.media = { ...m, type: p.media.type === 'video' ? 'video' : 'image', name: str(p.media.name).slice(0, 200), asset };
  }
  if (p.at) { const d = new Date(p.at); if (isNaN(d)) throw new Error('সময়টা ঠিক নেই। আবার বাছুন।'); if (d < new Date(Date.now() - 60000)) throw new Error('সামনের কোনো সময় বাছুন।'); body.at = d.toISOString(); }
  return bridge(ctx, '/drafts/idea', body);
}

export async function erpBrandDeskPost(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, nets = Array.isArray(p.networks) ? p.networks.filter((n) => n && str(n.id) && str(n.platform)) : [];
  if (!nets.length) throw new Error('অন্তত একটা নেটওয়ার্ক বাছুন।');
  if (!str(p.content)) throw new Error('আগে পোস্টটা লিখুন।');
  if (str(p.content).length > 63000) throw new Error('পোস্টটা অনেক লম্বা। ছোট করুন।');
  let at = null;
  if (p.at) { const d = new Date(p.at); if (isNaN(d)) throw new Error('সময়টা ঠিক নেই। আবার বাছুন।'); at = d.toISOString(); }
  // brand-7: the claim check runs before anything is queued; a 'block' stops the post (warnings only show)
  const hits = ((await bridge(ctx, '/lint', { text: str(p.content) })).hits) || [];
  const blocks = hits.filter((h) => h && h.severity === 'block');
  if (blocks.length) throw new Error('পাঠানো হয়নি, দাবি-যাচাই আটকেছে: ' + blocks.map((h) => str(h.reason) + (h.match ? ' ("' + str(h.match) + '")' : '')).join(' · ') + '। লেখাটা বদলে আবার পাঠান।');
  const media = mediaRefs(p.media);
  const r = await bridge(ctx, '/post', { networks: nets.map((n) => ({ id: str(n.id), platform: str(n.platform) })), content: str(p.content), at, urgent: !!p.urgent, media });
  return { queued: (r.queued || []).length, desk: await erpBrandDesk(ctx) };
}

export async function erpBrandDeskDecide(ctx, payload) {
  await gate(ctx);
  const a = str(payload && payload.action);
  if (!['send', 'drop'].includes(a)) throw new Error('পাঠান বা বাদ দিন, একটা বাছুন।');
  await bridge(ctx, '/decide', { id: str(payload.id), action: a });
  return erpBrandDesk(ctx);
}

// brand-7: settings live in the brand core database on the Mac; the ERP is the screen and checks every number first
export async function erpBrandDeskSettings(ctx) {
  await gate(ctx);
  return bridge(ctx, '/settings');
}
export async function erpBrandDeskWeights(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, platform = str(p.platform).toLowerCase();
  if (!/^[a-z_]{2,20}$/.test(platform)) throw new Error('একটা নেটওয়ার্ক বাছুন।');
  const w = p.weights && typeof p.weights === 'object' ? p.weights : null;
  if (!w || !Object.keys(w).length) throw new Error('প্রতিটা বিষয়ের ভাগ দিন।');
  const clean = {};
  for (const [k, v] of Object.entries(w)) {
    if (!/^[a-z0-9_]{2,40}$/.test(k)) throw new Error('একটা বিষয়ের নাম ঠিক নেই। পেজটা নতুন করে আনুন।');
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('প্রতিটা ভাগ ০ থেকে ১০০-এর মধ্যে পূর্ণ সংখ্যা হবে।');
    clean[k] = n;
  }
  const sum = Object.values(clean).reduce((a, b) => a + b, 0);
  if (sum !== 100) throw new Error(netName(platform) + '-এর ভাগ মিলে ' + bnNum(sum) + ' হলো; ১০০ হতে হবে।');
  return bridge(ctx, '/settings/weights', { platform, weights: clean });
}
export async function erpBrandDeskCadence(ctx, payload) {
  await gate(ctx);
  const level = str(payload && payload.level);
  if (!['start', 'scale'].includes(level)) throw new Error('“শুরু” বা “বাড়ানো” বাছুন।');
  return bridge(ctx, '/settings/cadence', { level });
}
export async function erpBrandDeskLint(ctx, payload) {
  await gate(ctx);
  const text = str(payload && payload.text);
  if (!text) return { hits: [] };
  if (text.length > 63000) throw new Error('লেখাটা অনেক লম্বা।');
  return bridge(ctx, '/lint', { text });
}

// brand-8: nothing is posted from a draft until the owner approves it here; the bridge checks the claims again
const DRAFT_PLATFORMS = ['linkedin', 'facebook', 'instagram', 'youtube', 'threads', 'tiktok'];
export async function erpBrandDeskDrafts(ctx) {
  await gate(ctx);
  return bridge(ctx, '/drafts');
}
export async function erpBrandDeskMakeDrafts(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = p.idea_id == null || p.idea_id === '' ? null : parseInt(p.idea_id, 10), text = str(p.text);
  if (id === null && !text) throw new Error('একটা আইডিয়া বাছুন বা লিখুন।');
  if (id !== null && !(id > 0)) throw new Error('একটা আইডিয়া বাছুন।');
  if (text.length > 2000) throw new Error('আইডিয়া ২ হাজার অক্ষরের কম রাখুন; বাকিটা AI লিখবে।');
  const plats = (Array.isArray(p.platforms) ? p.platforms : []).map((x) => str(x).toLowerCase()).filter((x) => DRAFT_PLATFORMS.includes(x));
  const body = { platforms: [...new Set(plats)].slice(0, 4) };
  if (id !== null) body.idea_id = id; else { body.text = text; if (/^[a-z0-9_]{2,40}$/.test(str(p.topic))) body.topic = str(p.topic); }
  // brand-14: his answers to the writer's questions; they are kept as true facts and the draft is written again
  const answers = str(p.answers);
  if (answers.length > 2000) throw new Error('উত্তর ২ হাজার অক্ষরের কম রাখুন।');
  if (answers) {
    if (id === null) throw new Error('একটা আইডিয়া বাছুন।');
    const redo = parseInt(p.redo, 10);
    if (!(redo > 0)) throw new Error('কোন ড্রাফট আবার লিখবে, বাছুন।');
    body.answers = answers; body.redo = redo;
  }
  return bridge(ctx, '/drafts/make', body);
}
export async function erpBrandDeskDraftDecide(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = parseInt(p.id, 10), action = str(p.action);
  if (!(id > 0)) throw new Error('একটা ড্রাফট বাছুন।');
  if (!['approve', 'reject', 'manual'].includes(action)) throw new Error('অনুমোদন দিন বা বাদ দিন।');
  if (action === 'reject') return bridge(ctx, '/drafts/decide', { id, action, note: str(p.note).slice(0, 500) });
  // brand-9: posted by hand (Facebook profile, or an account not connected): no account, the record is kept
  if (action === 'manual') {
    const link = str(p.url);
    if (link && !/^https:\/\/[^\s]{4,490}$/i.test(link)) throw new Error('লিংকটা https:// দিয়ে শুরু হতে হবে।');
    const m = { id, action };
    if (str(p.body)) m.body = str(p.body).slice(0, 63000);
    if (link) m.url = link;
    return bridge(ctx, '/drafts/decide', m);
  }
  const nets = Array.isArray(p.networks) ? p.networks.filter((n) => n && str(n.id) && str(n.platform)).map((n) => ({ id: str(n.id), platform: str(n.platform) })) : [];
  if (!nets.length) throw new Error('কোন অ্যাকাউন্টে যাবে, বাছুন।');
  const text = str(p.body);
  if (text.length > 63000) throw new Error('পোস্টটা অনেক লম্বা। ছোট করুন।');
  let at = null;
  if (p.at) { const d = new Date(p.at); if (isNaN(d)) throw new Error('সময়টা ঠিক নেই। আবার বাছুন।'); at = d.toISOString(); }
  const out = { id, action, networks: nets, at };
  if (text) out.body = text;
  const media = mediaRefs(p.media);
  if (media.length) { out.media = media; out.pictures = false; }
  return bridge(ctx, '/drafts/decide', out);
}

// brand-10: picture cards from a draft (the AI only splits the draft's own words into slides)
const draftId = (v) => { const n = parseInt(v, 10); if (!(n > 0)) throw new Error('একটা ড্রাফট বাছুন।'); return n; };
export async function erpBrandDeskMakeCards(ctx, payload) {
  await gate(ctx);
  return bridge(ctx, '/cards/make', { draft_id: draftId(payload && payload.draft_id) });
}
export async function erpBrandDeskCards(ctx, payload) {
  await gate(ctx);
  return bridge(ctx, '/cards/' + draftId(payload && payload.draft_id));
}

// brand-11: Listen - read-only; nothing is written to anyone, no account of his is used (official YouTube API + paste)
export async function erpBrandDeskListen(ctx) {
  await gate(ctx);
  return { ...(await bridge(ctx, '/listen')), businesses: await leadTargets(ctx) };
}
export async function erpBrandDeskListenPull(ctx) {
  await gate(ctx);
  return { ...(await bridge(ctx, '/listen/pull', {})), businesses: await leadTargets(ctx) };
}
export async function erpBrandDeskListenPaste(ctx, payload) {
  await gate(ctx);
  const text = str(payload && payload.text), source = str(payload && payload.source);
  if (text.length < 10) throw new Error('আগে কমেন্টগুলো পেস্ট করুন।');
  if (text.length > 20000) throw new Error('একবারে অনেক বেশি। প্রায় ২০ হাজার অক্ষর পর্যন্ত পেস্ট করুন।');
  return { ...(await bridge(ctx, '/listen/paste', { text, source: source.slice(0, 500) })), businesses: await leadTargets(ctx) };
}
export async function erpBrandDeskListenIdeas(ctx) {
  await gate(ctx);
  return { ...(await bridge(ctx, '/listen/ideas', {})), businesses: await leadTargets(ctx) };
}
export async function erpBrandDeskListenChannel(ctx, payload) {
  await gate(ctx);
  const id = str(payload && payload.id);
  if (!/^UC[A-Za-z0-9_-]{10,40}$/.test(id)) throw new Error('একটা চ্যানেল বাছুন।');
  return { ...(await bridge(ctx, '/listen/channel', { id, active: !!(payload && payload.active) })), businesses: await leadTargets(ctx) };
}
export async function erpBrandDeskListenToLead(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = parseInt(p.id, 10), target = str(p.business);
  if (!(id > 0)) throw new Error('একটা কমেন্ট বাছুন।');
  if (!(await leadTargets(ctx)).some((b) => b.id === target)) throw new Error('আপনার একটা ব্যবসা বাছুন।');
  const c = ((await bridge(ctx, '/listen')).comments || []).find((x) => Number(x.id) === id);
  if (!c) throw new Error('কমেন্টটা আর তালিকায় নেই।');
  const where = c.platform === 'youtube_ext' ? 'YouTube comment under ' + str(c.channel_title) + (c.source_ref ? ' (https://youtu.be/' + str(c.source_ref) + ')' : '') : 'Pasted comment' + (c.source_ref ? ' from ' + str(c.source_ref) : '');
  const r = await addLead({ ...ctx, biz: target, memo: {} }, {
    kind: c.lead_kind === 'supplier' ? 'supplier' : 'customer', name: str(c.author_name) || 'Commenter', email: '', phone: '',
    want: str(c.summary).slice(0, 300), ref: 'listen:' + id, note: 'From the brand desk (Listen) - ' + where + ': "' + str(c.text).slice(0, 400) + '"',
  });
  try { await bridge(ctx, '/listen/handed', { id }); } catch (_) { /* the mark is only a reminder */ }
  return { added: r.added, business: target };
}

export const PILLARS = ['story', 'lesson', 'behind the scenes', 'market', 'announcement'];
export const AUDIENCES = ['customer', 'supplier', 'brand'];
const num = (v) => { const n = parseInt(v, 10); if (!(n > 0)) throw new Error('একটা কার্ড বাছুন।'); return n; };

export async function erpBrandDeskBoard(ctx) {
  await gate(ctx);
  return { board: await bridge(ctx, '/board'), pillars: PILLARS, audiences: AUDIENCES };
}
export async function erpBrandDeskCard(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, title = str(p.title);
  if (!title) throw new Error('কার্ডের একটা নাম দিন।');
  if (title.length > 200) throw new Error('নামটা অনেক লম্বা (২০০ অক্ষরের কম রাখুন)।');
  const tags = (Array.isArray(p.tags) ? p.tags : []).map((t) => str(t).toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 8);
  const body = { title, description: str(p.description).slice(0, 5000), tags };
  if (p.column) body.column = num(p.column);
  return { board: await bridge(ctx, '/board/card', body), pillars: PILLARS, audiences: AUDIENCES };
}
export async function erpBrandDeskMove(ctx, payload) {
  await gate(ctx);
  return { board: await bridge(ctx, '/board/move', { id: num(payload && payload.id), column: num(payload && payload.column) }), pillars: PILLARS, audiences: AUDIENCES };
}
export async function erpBrandDeskDone(ctx, payload) {
  await gate(ctx);
  return { board: await bridge(ctx, '/board/done', { id: num(payload && payload.id) }), pillars: PILLARS, audiences: AUDIENCES };
}

// 11 Nov 2026 (notes-1): the owner's journal + call notes (Telegram journal bot -> Memos #journal/#call) and open journal
// tasks (Kanboard), read through the bridge, so the AI can answer "what did Kim promise?" and plan from real talk.
export async function erpBrandDeskNotes(ctx, payload) {
  await gate(ctx);
  const p = payload || {};
  const kind = ['call', 'journal'].includes(str(p.kind)) ? str(p.kind) : 'all';
  const days = Math.min(365, Math.max(1, parseInt(p.days, 10) || 60));   // not num(): that one throws 'Pick a card.'
  const q = str(p.q).slice(0, 120);
  return bridge(ctx, '/notes?kind=' + kind + '&days=' + days + '&q=' + encodeURIComponent(q));
}

const ideaId = (v) => { const s = str(v); if (!/^[A-Za-z0-9_-]{4,64}$/.test(s)) throw new Error('একটা আইডিয়া বাছুন।'); return s; };
export async function erpBrandDeskIdeas(ctx) {
  await gate(ctx);
  return bridge(ctx, '/ideas');
}
export async function erpBrandDeskIdea(ctx, payload) {
  await gate(ctx);
  const c = str(payload && payload.content);
  if (!c) throw new Error('আগে আইডিয়াটা লিখুন।');
  if (c.length > 8000) throw new Error('আইডিয়াটা অনেক লম্বা।');
  return bridge(ctx, '/ideas', { content: c });
}
export async function erpBrandDeskIdeaToBoard(ctx, payload) {
  await gate(ctx);
  return bridge(ctx, '/ideas/board', { id: ideaId(payload && payload.id) });
}

export async function erpBrandDeskPeople(ctx) {
  await gate(ctx);
  return { ...(await bridge(ctx, '/people')), audiences: AUDIENCES, businesses: await leadTargets(ctx) };
}
export async function erpBrandDeskPerson(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, name = str(p.name);
  if (!name) throw new Error('নামটা লিখুন।');
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(p.email))) throw new Error('ই-মেইলটা ঠিক মনে হচ্ছে না।');
  const body = { name: name.slice(0, 200), email: str(p.email).slice(0, 200), phone: str(p.phone).slice(0, 40), job: str(p.job).slice(0, 200),
    audience: AUDIENCES.includes(str(p.audience)) ? str(p.audience) : '', about: str(p.about).toLowerCase().slice(0, 40), source: str(p.source).slice(0, 500) };
  return { ...(await bridge(ctx, '/people', body)), audiences: AUDIENCES, businesses: await leadTargets(ctx) };
}
// the owner's businesses a person can be handed to: every one he owns except brand desks and joint pools
async function leadTargets(ctx) {
  const rows = await ctx.tx`select b.id, b.name from businesses b where b.id in (select public.my_business_ids('owner'))
                            and coalesce(b.is_pool, false) = false
                            and not exists (select 1 from business_config c where c.business_id = b.id and c.key = 'business_kind' and c.value = 'brand')
                            order by b.name`;
  return rows.map((r) => ({ id: String(r.id), name: r.name }));
}
export async function erpBrandDeskToLeads(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, target = str(p.business);
  if (!(await leadTargets(ctx)).some((b) => b.id === target)) throw new Error('আপনার একটা ব্যবসা বাছুন।');
  const list = (await bridge(ctx, '/people')).people || [], who = list.find((x) => x.id === str(p.id));
  if (!who) throw new Error('এই মানুষটা আর তালিকায় নেই।');
  const r = await addLead({ ...ctx, biz: target, memo: {} }, {
    kind: who.audience === 'customer' ? 'customer' : 'supplier', name: who.name, email: who.email, phone: who.phone,
    want: who.job, ref: 'branddesk:' + who.id, note: 'From the brand desk' + (who.source ? ' - came from: ' + who.source : '') + (who.audience === 'brand' ? ' (a brand)' : ''),
  });
  return { added: r.added, business: target };
}

// brand-13 (13 Nov 2026): Twenty is parked, so the People page adds a person straight to one business's Leads
export async function erpBrandDeskAddLead(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, target = str(p.business), name = str(p.name);
  if (!(await leadTargets(ctx)).some((b) => b.id === target)) throw new Error('আপনার একটা ব্যবসা বাছুন।');
  if (!name) throw new Error('নামটা লিখুন।');
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(p.email))) throw new Error('ই-মেইলটা ঠিক মনে হচ্ছে না।');
  const r = await addLead({ ...ctx, biz: target, memo: {} }, {
    kind: str(p.kind) === 'supplier' ? 'supplier' : 'customer', name: name.slice(0, 120), email: str(p.email).slice(0, 200), phone: str(p.phone).slice(0, 40),
    want: str(p.want).slice(0, 300), note: 'From the brand desk' + (str(p.source) ? ' - came from: ' + str(p.source).slice(0, 300) : ''),
  });
  return { added: r.added, business: target };
}

export async function erpBrandDeskVideos(ctx, payload) {
  await gate(ctx);
  const q = str(payload && payload.q).slice(0, 200);
  return bridge(ctx, '/videos' + (q ? '?q=' + encodeURIComponent(q) : ''));
}

export async function erpBrandDeskShorts(ctx) {
  await gate(ctx);
  return bridge(ctx, '/shorts');
}
export async function erpBrandDeskMakeShorts(ctx, payload) {
  await gate(ctx);
  const id = str(payload && payload.id);
  if (!/^[0-9a-f-]{20,64}$/i.test(id)) throw new Error('একটা ভিডিও বাছুন।');
  return bridge(ctx, '/shorts', { id });
}

export async function erpBrandDeskSetup(ctx, payload) {
  await gate(ctx);
  const k = str(payload && payload.key);
  if (k.length < 20) throw new Error('এটা Mac-এর চাবি নয় (চাবি হলো অক্ষর আর সংখ্যার লম্বা একটা লাইন)।');
  await setSecret(ctx, 'BRAND_BRIDGE_KEY', k);
  await setConfig(ctx, 'business_kind', 'brand');   // brand-2: this business now shows the brand menu only
  return erpBrandDesk(ctx);
}

// The PC calls this every minute with the owner's machine key. The owner's active business may be another one, so the
// business is named in the call and must be one he owns; the PC proves itself with the bridge key of that business.
export async function erpBrandDeskHello(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner\'s PC checks in.');
  const p = payload || {}, biz = str(p.biz), url = str(p.url);
  const mine = await ctx.tx`select 1 from public.my_business_ids('owner') b(id) where b.id::text = ${biz}`;
  if (!mine.length) throw new Error('That business is not yours.');
  if (!/^https:\/\/[a-z0-9.-]+(\/.*)?$/i.test(url)) throw new Error('The address must start with https://');
  const c2 = { ...ctx, biz };
  if (str(p.key) !== await getSecret(c2, 'BRAND_BRIDGE_KEY') || !str(p.key)) throw new Error('Wrong bridge key.');
  await setConfig(c2, 'brand_bridge', JSON.stringify({ url: url.replace(/\/+$/, ''), seen: ctx.now.toISOString() }));
  return { ok: true };
}

export const HANDLERS = { erpBrandDesk, erpBrandDeskCockpit, erpBrandDeskDraftRepick, erpBrandDeskMediaKeep, erpBrandDeskReels, erpBrandDeskReelScript, erpBrandDeskReelPhoto, erpBrandDeskReelVoice, erpBrandDeskReelEdit, erpBrandDeskReelRender, erpBrandDeskReelDrafts, erpBrandDeskRoutine, erpBrandDeskRoutineSlot, erpBrandDeskRoutineLevel, erpBrandDeskRoutineReset, erpBrandDeskStyles, erpBrandDeskStyleAdd, erpBrandDeskStyleSet, erpBrandDeskStyleCreator, erpBrandDeskStyleScout, erpBrandDeskLi, erpBrandDeskLiAdd, erpBrandDeskLiMark, erpBrandDeskLiKill, erpBrandDeskLiPull, erpBrandDeskUpload, erpBrandDeskIdeaPost, erpBrandDeskMedia, erpBrandDeskNews, erpBrandDeskNewsRun, erpBrandDeskNewsMake, erpBrandDeskAttach, erpBrandDeskListen, erpBrandDeskListenPull, erpBrandDeskListenPaste, erpBrandDeskListenIdeas, erpBrandDeskListenChannel, erpBrandDeskListenToLead, erpBrandDeskMakeCards, erpBrandDeskCards, erpBrandDeskDrafts, erpBrandDeskMakeDrafts, erpBrandDeskDraftDecide, erpBrandDeskSettings, erpBrandDeskWeights, erpBrandDeskCadence, erpBrandDeskLint, erpBrandDeskShorts, erpBrandDeskMakeShorts, erpBrandDeskVideos, erpBrandDeskPeople, erpBrandDeskPerson, erpBrandDeskToLeads, erpBrandDeskAddLead, erpBrandDeskIdeas, erpBrandDeskNotes, erpBrandDeskIdea, erpBrandDeskIdeaToBoard, erpBrandDeskBoard, erpBrandDeskCard, erpBrandDeskMove, erpBrandDeskDone, erpBrandDeskPost, erpBrandDeskDecide, erpBrandDeskSetup, erpBrandDeskHello };
