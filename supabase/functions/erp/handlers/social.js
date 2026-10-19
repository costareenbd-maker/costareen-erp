// Social posts (owner 20 Oct 2026, advertising automation S1): a post made in the ERP - media and a caption for each
// platform - published to the Facebook Page and its Instagram through the one Meta login (metaconnect.js), now or at a
// set time, with the figures read back afterwards.
//
//   erpSocialPosts()                 the list (last 90 days), and what the login can reach (page, Instagram)
//   erpSocialSave({...})             make or change a draft; the owner may save it approved
//   erpSocialUpload({name,mime,data}) a picture or video for a post, kept in 'social'
//   erpSocialCaptions({sku,notes,lang,text}) the AI writes one caption per platform from the product's own facts
//   erpSocialAct({id, action})       approve | unapprove | publish | schedule | cancel | remove
//   socialTick(ctx)                  every minute: publish what is due, finish Instagram uploads, read figures
//
// Staff draft; the owner approves and publishes (a manager may publish an approved post). Marketplace and WhatsApp
// have no API: their captions are for copying. A published post is never deleted, only its figures change.

import { getSecret, getConfig, saveFile, fileUrl } from '../lib/ext.js';
import { formatDate, num } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { gemini, jsonOf } from '../lib/gemini.js';
import { products } from './dashboard.js';

const str = (v) => String(v == null ? '' : v).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
const PLATFORMS = ['facebook', 'instagram', 'marketplace', 'whatsapp'];
const H = 3600e3;

function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role || 'sales')) throw new Error('Not open to your role.'); }
function b64decode(s) { const bin = atob(String(s || '').replace(/^data:[^,]*,/, '')); const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; }

/** What the Meta login reaches: the pages (each with its Instagram) and the page the Inbox uses, as the default. */
async function reach(ctx) {
  let assets = {}; try { assets = JSON.parse(str(await getConfig(ctx, 'meta_assets', '')) || '{}') || {}; } catch (_) { assets = {}; }
  const pages = (assets.pages || []).map((p) => ({ id: str(p.id), name: str(p.name), ig: p.ig ? { id: str(p.ig.id), username: str(p.ig.username) } : null }));
  let def = pages[0] || null;
  try {
    const used = (await ctx.tx`select external_id from inbox_channels where business_id = ${ctx.biz} and kind = 'messenger' and status <> 'removed' order by created_at limit 1`)[0];
    if (used) def = pages.find((p) => p.id === str(used.external_id)) || def;
  } catch (_) { /* no inbox */ }
  return { connected: !!(await getSecret(ctx, 'META_USER_TOKEN')), pages, defaultPage: def ? def.id : '' };
}

async function graph(ctx, method, path, token, body) {
  const f = ctx.deps.fetch || fetch;
  const url = GRAPH + path + (path.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token);
  const res = await f(url, method === 'GET' ? { method: 'GET' } : { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body || {}) });
  let j = {}; try { j = JSON.parse(await res.text()); } catch (_) { j = {}; }
  if (res.status < 200 || res.status >= 300 || j.error) throw new Error('Facebook said: ' + str((j.error && j.error.message) || res.status));
  return j;
}

function view(r) {
  return { id: r.id, sku: str(r.sku), title: str(r.title), media: r.media || [], captions: r.captions || {}, targets: r.targets || {}, pageId: str(r.page_id), state: r.state,
           scheduledAt: r.scheduled_at ? new Date(r.scheduled_at).toISOString() : null, scheduled: r.scheduled_at ? formatDate(new Date(r.scheduled_at), 'd MMM h:mm a') : '',
           publishedAt: r.published_at ? formatDate(new Date(r.published_at), 'd MMM h:mm a') : '', results: r.results || {}, stats: r.stats || {}, error: str(r.error),
           createdBy: str(r.created_by), approvedBy: str(r.approved_by), created: formatDate(new Date(r.created_at), 'd MMM') };
}

export async function erpSocialPosts(ctx) {
  need(ctx);
  const rows = await ctx.tx`select * from social_posts where business_id = ${ctx.biz} and state <> 'removed' and created_at > now() - interval '90 days' order by created_at desc limit 200`;
  const r = await reach(ctx);
  return { ...r, posts: rows.map(view), canPublish: ctx.s.role === 'owner' || ctx.s.role === 'manager' };
}

function cleanMedia(list) {
  return (Array.isArray(list) ? list : []).slice(0, 10).map((m) => ({ kind: m.kind === 'video' ? 'video' : 'image', file: str(m.file).slice(0, 300), name: str(m.name).slice(0, 120) })).filter((m) => m.file);
}
function cleanCaptions(c) { const out = {}; for (const k of PLATFORMS) out[k] = str(c && c[k]).slice(0, 5000); return out; }

export async function erpSocialSave(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const id = str(p.id);
  const media = cleanMedia(p.media), captions = cleanCaptions(p.captions);
  const targets = { facebook: !!(p.targets && p.targets.facebook), instagram: !!(p.targets && p.targets.instagram) };
  if (targets.instagram && !media.length) throw new Error('Instagram needs a picture or a video.');
  if (media.filter((m) => m.kind === 'video').length > 1) throw new Error('One video per post.');
  if (media.some((m) => m.kind === 'video') && media.length > 1) throw new Error('A video goes alone: no pictures with it.');
  const r = await reach(ctx);
  const pageId = str(p.pageId) || r.defaultPage;
  const title = str(p.title).slice(0, 120) || str(captions.facebook || captions.instagram).split('\n')[0].slice(0, 80) || 'Post';
  const approved = ctx.s.role === 'owner' && !!p.approved;
  let row;
  if (id) {
    const old = (await ctx.tx`select * from social_posts where business_id = ${ctx.biz} and id = ${id}`)[0];
    if (!old) throw new Error('That post was not found.');
    if (!['draft', 'approved', 'failed'].includes(old.state)) throw new Error('A ' + old.state + ' post cannot be changed. Cancel it first, or make a new one.');
    row = (await ctx.tx`update social_posts set sku = ${str(p.sku) || null}, title = ${title}, media = ${ctx.tx.json(media)}, captions = ${ctx.tx.json(captions)}, targets = ${ctx.tx.json(targets)},
                         page_id = ${pageId || null}, state = ${approved ? 'approved' : 'draft'}, approved_by = ${approved ? ctx.s.name : null}, error = null, updated_at = now() where id = ${old.id} returning *`)[0];
  } else {
    row = (await ctx.tx`insert into social_posts (business_id, sku, title, media, captions, targets, page_id, state, approved_by, created_by)
                        values (${ctx.biz}, ${str(p.sku) || null}, ${title}, ${ctx.tx.json(media)}, ${ctx.tx.json(captions)}, ${ctx.tx.json(targets)}, ${pageId || null}, ${approved ? 'approved' : 'draft'}, ${approved ? ctx.s.name : null}, ${ctx.s.name}) returning *`)[0];
  }
  return { ok: true, post: view(row) };
}

/** A picture (JPEG/PNG, up to 8 MB) or a video (MP4, up to 100 MB) for a post. */
export async function erpSocialUpload(ctx, payload) {
  need(ctx);
  const p = payload || {}, mime = str(p.mime).toLowerCase();
  const kind = /^image\/(jpeg|png)$/.test(mime) ? 'image' : /^video\/mp4$/.test(mime) ? 'video' : '';
  if (!kind) throw new Error('A JPEG or PNG picture, or an MP4 video.');
  let bytes; try { bytes = b64decode(p.data); } catch (_) { throw new Error('The file could not be read.'); }
  if (kind === 'image' && bytes.length > 8 * 1024 * 1024) throw new Error('The picture is over 8 MB.');
  if (kind === 'video' && bytes.length > 100 * 1024 * 1024) throw new Error('The video is over 100 MB.');
  const shown = str(p.name).replace(/[\\/]+/g, '_').slice(0, 100) || (kind === 'video' ? 'video.mp4' : 'picture.jpg');
  const name = 's' + formatDate(ctx.now, 'yyMMddHHmmss') + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 4) + '-' + shown;
  const f = await saveFile(ctx, 'social', name, bytes, mime);
  return { file: f.id, name: shown, kind, url: f.url || '' };
}

/** The product's own photo(s) for a post: the stored photo first, else the image link. */
export async function erpSocialPhotos(ctx, payload) {
  need(ctx);
  const sku = str(payload && payload.sku).toLowerCase();
  if (!sku) return { media: [] };
  const r = (await ctx.tx`select sku, photo, thumb, image_link from products where business_id = ${ctx.biz} and lower(sku) = ${sku}`)[0];
  if (!r) return { media: [] };
  const out = [];
  if (str(r.photo)) out.push({ kind: 'image', file: 'products/' + str(r.photo), name: str(r.photo), url: await fileUrl(ctx, 'products', str(r.photo)) });
  else if (str(r.image_link)) out.push({ kind: 'image', file: str(r.image_link), name: 'web photo', url: str(r.image_link) });
  return { media: out };
}

/** One caption per platform, from the product's own figures; never an invented price or claim. */
export async function erpSocialCaptions(ctx, payload) {
  need(ctx);
  const p = payload || {};
  const biz = (await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {};
  const facts = ['Shop: ' + str(biz.name)];
  let title = '';
  if (str(p.sku)) {
    const { list } = await products(ctx);
    const x = list.find((y) => y.sku.toLowerCase() === str(p.sku).toLowerCase());
    if (x) { title = x.name; facts.push('Product: ' + x.name, 'Price: BDT ' + Math.round(num(x.sell)), x.stock > 0 ? 'In stock: ' + num(x.stock) : 'Not in stock now'); if (x.cat) facts.push('Category: ' + x.cat); if (x.brand) facts.push('Brand: ' + x.brand); }
  }
  if (str(p.text)) facts.push('Owner\'s own text to build on:\n' + str(p.text).slice(0, 1500));
  if (str(p.notes)) facts.push('Owner notes: ' + str(p.notes).slice(0, 500));
  const lang = str(p.lang) === 'bn' ? 'Write in Bangla (Bengali script); product names, brands and numbers as given.' : str(p.lang) === 'mix' ? 'Write in Banglish (Bangla words in Latin letters), product names as given.' : 'Write in simple English.';
  const sys = 'You write social-media captions for a small 3D-printing supplies shop in Bangladesh. Use only the facts given: never invent prices, discounts, specs, deadlines or stock. The price goes in every caption. ' + lang +
    ' Return JSON only: {"facebook": "...", "instagram": "...", "marketplace": "...", "whatsapp": "..."}.' +
    ' facebook: 3-6 short lines, the price, how to order (inbox / website), 2-3 emoji at most, no hashtags. instagram: 2-4 lines, the price, a question or hook first, then 8-12 hashtags on the last line (3D printing, filament, Bangladesh, the brand). marketplace: a listing - a plain title line, then condition, price, what is included, delivery, no emoji or hashtags. whatsapp: 2-3 lines for a status or broadcast, the price and "reply to order".';
  const { parts } = await gemini(ctx, { systemInstruction: { parts: [{ text: sys }] }, contents: [{ role: 'user', parts: [{ text: 'Facts:\n' + facts.join('\n') }] }], generationConfig: { temperature: 0.7, responseMimeType: 'application/json' } }, 'social', null);
  const j = jsonOf(parts) || {};
  return { captions: cleanCaptions(j), title };
}

// ------------------------------------------------------------------ publishing

async function mediaUrl(ctx, m) {
  const f = str(m.file);
  if (/^https?:\/\//.test(f)) return f;
  const i = f.indexOf('/'); if (i < 0) return '';
  return fileUrl(ctx, f.slice(0, i), f.slice(i + 1));
}

async function publishFacebook(ctx, post, token) {
  const media = post.media || [], msg = str(post.captions && post.captions.facebook);
  const page = str(post.page_id);
  if (media.length && media[0].kind === 'video') {
    const url = await mediaUrl(ctx, media[0]); if (!url) throw new Error('The video could not be read.');
    const j = await graph(ctx, 'POST', '/' + page + '/videos', token, { file_url: url, description: msg });
    return { id: str(j.id), link: 'https://www.facebook.com/' + page + '/videos/' + str(j.id) };
  }
  if (media.length === 1) {
    const url = await mediaUrl(ctx, media[0]); if (!url) throw new Error('The picture could not be read.');
    const j = await graph(ctx, 'POST', '/' + page + '/photos', token, { url, message: msg });
    const id = str(j.post_id || j.id);
    return { id, link: 'https://www.facebook.com/' + id };
  }
  if (media.length > 1) {
    const ids = [];
    for (const m of media) { const url = await mediaUrl(ctx, m); if (!url) continue; const j = await graph(ctx, 'POST', '/' + page + '/photos', token, { url, published: false }); ids.push(str(j.id)); }
    const j = await graph(ctx, 'POST', '/' + page + '/feed', token, { message: msg, attached_media: ids.map((id) => ({ media_fbid: id })) });
    return { id: str(j.id), link: 'https://www.facebook.com/' + str(j.id) };
  }
  if (!msg) throw new Error('Nothing to post on Facebook: no text and no media.');
  const j = await graph(ctx, 'POST', '/' + page + '/feed', token, { message: msg });
  return { id: str(j.id), link: 'https://www.facebook.com/' + str(j.id) };
}

/** Instagram: a container first (image, carousel or reel), then publish once Instagram has it ready. */
async function publishInstagram(ctx, post, token, ig, prev) {
  const media = post.media || [], caption = str(post.captions && post.captions.instagram);
  let creation = str(prev && prev.creation);
  if (!creation) {
    if (!media.length) throw new Error('Instagram needs a picture or a video.');
    if (media[0].kind === 'video') {
      const url = await mediaUrl(ctx, media[0]);
      creation = str((await graph(ctx, 'POST', '/' + ig + '/media', token, { video_url: url, media_type: 'REELS', caption })).id);
    } else if (media.length === 1) {
      const url = await mediaUrl(ctx, media[0]);
      creation = str((await graph(ctx, 'POST', '/' + ig + '/media', token, { image_url: url, caption })).id);
    } else {
      const kids = [];
      for (const m of media.slice(0, 10)) { const url = await mediaUrl(ctx, m); kids.push(str((await graph(ctx, 'POST', '/' + ig + '/media', token, { image_url: url, is_carousel_item: true })).id)); }
      creation = str((await graph(ctx, 'POST', '/' + ig + '/media', token, { media_type: 'CAROUSEL', children: kids, caption })).id);
    }
  }
  // a video takes a while on Instagram's side: a few looks now, the minute timer finishes it otherwise
  for (let i = 0; i < 4; i++) {
    const s = await graph(ctx, 'GET', '/' + creation + '?fields=status_code,status', token);
    const code = str(s.status_code);
    if (code === 'FINISHED' || !code) break;
    if (code === 'ERROR' || code === 'EXPIRED') throw new Error('Instagram could not take the media: ' + str(s.status || code));
    if (i === 3) return { creation, pending: true };
    await new Promise((r) => setTimeout(r, 2500));
  }
  const j = await graph(ctx, 'POST', '/' + ig + '/media_publish', token, { creation_id: creation });
  const id = str(j.id);
  let link = '';
  try { link = str((await graph(ctx, 'GET', '/' + id + '?fields=permalink', token)).permalink); } catch (_) { /* fine */ }
  return { id, link, creation };
}

/** Publish one post to its targets. Each target's answer is kept; the post is 'published' once every target is done. */
export async function publishPost(ctx, post) {
  const results = { ...(post.results || {}) };
  const r = await reach(ctx);
  const page = r.pages.find((p) => p.id === str(post.page_id)) || r.pages[0];
  if (!page) throw new Error('No Facebook Page on this login: connect Facebook under Settings → Connections.');
  const token = await getSecret(ctx, 'META_PAGE_' + page.id);
  if (!token) throw new Error('No key for the page ' + page.name + ': press Refresh or Log in again under Settings → Connections.');
  const t = post.targets || {};
  let pending = false, failed = false;
  if (t.facebook && !(results.facebook && results.facebook.id)) {
    try { results.facebook = await publishFacebook(ctx, post, token); } catch (e) { results.facebook = { error: str(e && e.message) }; failed = true; }
  }
  if (t.instagram && !(results.instagram && results.instagram.id)) {
    if (!page.ig) { results.instagram = { error: 'No Instagram account is linked to the page ' + page.name + '. Link one in Instagram settings, then press Refresh under Settings → Connections.' }; failed = true; }
    else {
      try {
        const out = await publishInstagram(ctx, post, token, page.ig.id, results.instagram);
        results.instagram = out; if (out.pending) pending = true;
      } catch (e) { results.instagram = { ...(results.instagram || {}), error: str(e && e.message) }; failed = true; }
    }
  }
  const state = pending ? 'publishing' : failed ? 'failed' : 'published';
  const err = failed ? [results.facebook && results.facebook.error, results.instagram && results.instagram.error].filter(Boolean).join(' · ') : null;
  const row = (await ctx.tx`update social_posts set results = ${ctx.tx.json(results)}, state = ${state}, error = ${err}, published_at = ${state === 'published' ? ctx.now : post.published_at || null}, updated_at = now()
                             where id = ${post.id} returning *`)[0];
  return view(row);
}

export async function erpSocialAct(ctx, payload) {
  need(ctx);
  const p = payload || {}, action = str(p.action);
  const post = (await ctx.tx`select * from social_posts where business_id = ${ctx.biz} and id = ${str(p.id)}`)[0];
  if (!post) throw new Error('That post was not found.');
  const owner = ctx.s.role === 'owner', manager = roleAtLeast(ctx.s.role, 'manager');
  const set = async (fields) => view((await ctx.tx`update social_posts set state = ${fields.state}, scheduled_at = ${fields.scheduled_at === undefined ? post.scheduled_at : fields.scheduled_at}, approved_by = ${fields.approved_by === undefined ? post.approved_by : fields.approved_by}, error = null, updated_at = now() where id = ${post.id} returning *`)[0]);
  if (action === 'approve') { if (!owner) throw new Error('Only the owner approves a post.'); if (post.state !== 'draft' && post.state !== 'failed') throw new Error('Only a draft is approved.'); return { post: await set({ state: 'approved', approved_by: ctx.s.name }) }; }
  if (action === 'unapprove') { if (!owner) throw new Error('Only the owner changes that.'); if (post.state !== 'approved') throw new Error('It is not approved.'); return { post: await set({ state: 'draft', approved_by: null }) }; }
  if (action === 'cancel') { if (!manager) throw new Error('Only a manager or the owner cancels.'); if (!['scheduled', 'publishing'].includes(post.state)) throw new Error('Only a scheduled post is cancelled.'); return { post: await set({ state: post.approved_by ? 'approved' : 'draft', scheduled_at: null }) }; }
  if (action === 'remove') { if (!manager) throw new Error('Only a manager or the owner removes a draft.'); if (!['draft', 'approved', 'failed'].includes(post.state)) throw new Error('A published post stays; it can be deleted on Facebook itself.'); return { post: await set({ state: 'removed' }) }; }
  if (action === 'publish' || action === 'schedule') {
    if (!(owner || (manager && post.approved_by))) throw new Error(owner ? '' : 'The owner approves a post before it goes out.');
    if (!['draft', 'approved', 'failed', 'scheduled'].includes(post.state)) throw new Error('This post is already ' + post.state + '.');
    const t = post.targets || {};
    if (!t.facebook && !t.instagram) throw new Error('Tick Facebook or Instagram.');
    if (action === 'schedule') {
      const at = new Date(str(p.at));
      if (isNaN(at.getTime())) throw new Error('When should it go out?');
      if (at.getTime() < ctx.now.getTime() - 60e3) throw new Error('That time has passed: use Publish now.');
      return { post: await set({ state: 'scheduled', scheduled_at: at, approved_by: post.approved_by || ctx.s.name }) };
    }
    await ctx.tx`update social_posts set approved_by = coalesce(approved_by, ${ctx.s.name}) where id = ${post.id}`;
    return { post: await publishPost(ctx, { ...post, approved_by: post.approved_by || ctx.s.name }) };
  }
  throw new Error('Which action?');
}

// ------------------------------------------------------------------ the minute timer

async function readStats(ctx, post) {
  const r = await reach(ctx);
  const page = r.pages.find((p) => p.id === str(post.page_id)) || r.pages[0];
  const token = page ? await getSecret(ctx, 'META_PAGE_' + page.id) : '';
  if (!token) return;
  const stats = { ...(post.stats || {}) };
  const fb = post.results && post.results.facebook, ig = post.results && post.results.instagram;
  if (fb && fb.id) {
    try {
      const j = await graph(ctx, 'GET', '/' + fb.id + '?fields=shares,reactions.summary(true).limit(0),comments.summary(true).limit(0)', token);
      stats.facebook = { ...(stats.facebook || {}), reactions: num(j.reactions && j.reactions.summary && j.reactions.summary.total_count), comments: num(j.comments && j.comments.summary && j.comments.summary.total_count), shares: num(j.shares && j.shares.count) };
      try { const ins = await graph(ctx, 'GET', '/' + fb.id + '/insights?metric=post_impressions_unique', token); const v = (((ins.data || [])[0] || {}).values || [])[0]; if (v) stats.facebook.reach = num(v.value); } catch (_) { /* needs pages_read_engagement */ }
    } catch (e) { stats.facebook = { ...(stats.facebook || {}), error: str(e.message) }; }
  }
  if (ig && ig.id) {
    try {
      const j = await graph(ctx, 'GET', '/' + ig.id + '?fields=like_count,comments_count', token);
      stats.instagram = { ...(stats.instagram || {}), likes: num(j.like_count), comments: num(j.comments_count) };
      try { const ins = await graph(ctx, 'GET', '/' + ig.id + '/insights?metric=reach,saved,shares', token); for (const d of ins.data || []) stats.instagram[d.name] = num(((d.values || [])[0] || {}).value); } catch (_) { /* needs instagram_manage_insights */ }
    } catch (e) { stats.instagram = { ...(stats.instagram || {}), error: str(e.message) }; }
  }
  stats.at = formatDate(ctx.now, 'd MMM h:mm a');
  await ctx.tx`update social_posts set stats = ${ctx.tx.json(stats)}, stats_at = ${ctx.now} where id = ${post.id}`;
}

export async function socialTick(ctx) {
  const out = { published: 0, finished: 0, stats: 0, failed: 0 };
  const due = await ctx.tx`select * from social_posts where business_id = ${ctx.biz} and ((state = 'scheduled' and scheduled_at <= ${ctx.now}) or (state = 'publishing' and updated_at < ${new Date(ctx.now.getTime() - 60e3)})) order by scheduled_at limit 5`;
  for (const post of due) {
    try { const v = await publishPost(ctx, post); if (v.state === 'published') out[post.state === 'publishing' ? 'finished' : 'published']++; else if (v.state === 'failed') out.failed++; }
    catch (e) { out.failed++; await ctx.tx`update social_posts set state = 'failed', error = ${str(e && e.message)}, updated_at = now() where id = ${post.id}`; }
  }
  // figures: fresh posts every hour, older ones once a day, up to 30 days
  const want = await ctx.tx`select * from social_posts where business_id = ${ctx.biz} and state = 'published' and published_at > ${new Date(ctx.now.getTime() - 30 * 24 * H)}
                            and (stats_at is null or stats_at < ${new Date(ctx.now.getTime() - H)}) and (published_at > ${new Date(ctx.now.getTime() - 3 * 24 * H)} or stats_at is null or stats_at < ${new Date(ctx.now.getTime() - 24 * H)})
                            order by stats_at nulls first limit 10`;
  for (const post of want) { try { await readStats(ctx, post); out.stats++; } catch (_) { /* next time */ } }
  return out;
}

export const HANDLERS = { erpSocialPosts, erpSocialSave, erpSocialUpload, erpSocialPhotos, erpSocialCaptions, erpSocialAct };
