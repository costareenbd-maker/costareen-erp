// Creator portal: a creator's own page behind a permanent link (web/creator.html, ?pub=creator&t=...) and the
// sponsoring brand's read-only dashboard (web/sponsor.html, ?pub=sponsor&t=...). Projects are the unit: the creator
// requests filament for the next video, the owner approves and hands it over, the creator pastes the links into that
// project, YouTube numbers are fetched by the ERP (verified), other platforms are typed (reported). Every step is an
// event with who / when / from where. Owner-only inside the ERP (the "creators" app); the links are the gate outside.
//
//   owner:  erpCreatorPortalLink({creator_id})   the creator's permanent link + QR
//           erpSponsorLink({brand})               the brand's permanent link + QR
//           erpCreatorRequests()                  requests waiting + open projects
//           erpCreatorDecide({id, action, qty, note})   approve | decline | given (writes the filament line)
//           erpCreatorEvents({creator_id})        the audit trail
//           erpYoutubeKey({key})                  save the YouTube Data API key (business_config youtube_key)
//           erpCreatorRefresh()                   fetch YouTube numbers now
//   public: route(deps, R, what, method, params, body, ip)   what = creator | sponsor

import { num, formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { qrDataUrl } from '../lib/qr.js';
import { limit, pubBase } from './passport.js';
import { sourceOf } from './market.js';
import { erpCatalog } from './catalog.js';

const str = (v) => String(v == null ? '' : v).trim();
const enc = new TextEncoder();
const day = (d) => (d ? formatDate(new Date(d), 'yyyy-MM-dd') : '');
const when = (d) => (d ? new Date(d).toISOString() : '');
function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only an owner runs the creator programme.'); }
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
async function tokenFor(deps, kind, source, biz, ref) {
  const secret = str(deps && (deps.bridgeKey || deps.pubSecret)) || 'local-test-secret';
  const k = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, enc.encode(kind + '|' + source + '|' + biz + '|' + ref)));
  return btoa(String.fromCharCode(...sig)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '').slice(0, 24);
}
/** The creator / sponsor pages' address: ERP_CREATOR_URL (a name-free host) when set, else the neutral public address. */
function pageUrl(deps, name) {
  const own = str(deps && deps.installEnv && deps.installEnv.creatorUrl);
  return (own ? own.replace(/\/?$/, '/') : pubBase(deps).check.replace(/check$/, '')) + name;
}
const PROFILE = ['niche', 'city', 'about', 'whatsapp'];
const PLATFORMS = ['YouTube', 'Facebook page', 'Facebook group', 'Facebook profile', 'Instagram', 'TikTok'];
function profileDone(c) { return !!(str(c.handle) && str(c.platforms) && str(c.links)); }
/** The creator's channels, cleaned: [{platform, name, count, url}] - at least a platform and a link each. */
function cleanChannels(list) {
  const out = [];
  for (const x of (Array.isArray(list) ? list : []).slice(0, 12)) {
    const platform = PLATFORMS.find((p) => p.toLowerCase() === str(x && x.platform).toLowerCase());
    const url = str(x && x.url).slice(0, 300), name = str(x && x.name).slice(0, 120), count = Math.max(0, Math.round(num(x && x.count)));
    if (!platform) continue;
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error('A full link for ' + platform + ', starting with https://');
    if (!name) throw new Error('The name of your ' + platform + ', please.');
    out.push({ platform, name, count, url });
  }
  return out;
}
/** The one-line strings the ERP and the sponsor page show, from the channels. */
function derived(ch) {
  return { handle: ch.map((c) => c.name + ' (' + c.platform + ')').join(', ').slice(0, 400), platforms: [...new Set(ch.map((c) => c.platform))].join(', '),
           followers: ch.map((c) => c.platform + ' ' + c.count.toLocaleString('en-US')).join(' \u00b7 ').slice(0, 400), links: ch.map((c) => c.url).join('\n').slice(0, 2000) };
}
function parseChannels(c) { try { const j = JSON.parse(str(c.channels) || '[]'); return Array.isArray(j) ? j : []; } catch (_) { return []; } }
function randomCode(n) { const a = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789', b = crypto.getRandomValues(new Uint8Array(n)); return [...b].map((x) => a[x % a.length]).join(''); }
const okEmail = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);
/** The programme's join code of this business (made once): the public join link carries only this. */
async function progCode(ctx) {
  let code = str(await getConfig(ctx, 'creator_programme_code', ''));
  if (!code) { code = randomCode(10); await setConfig(ctx, 'creator_programme_code', code); }
  return code;
}
export async function erpCreatorProgramme(ctx, payload) {
  needOwner(ctx);
  const p = payload || {};
  if (p.brand !== undefined) await setConfig(ctx, 'creator_programme_brand', str(p.brand).slice(0, 80));
  const code = await progCode(ctx), url = pageUrl(ctx.deps, 'creator') + '?p=' + code;
  return { code, url, qr: qrDataUrl(url), signin: pageUrl(ctx.deps, 'creator'), brand: await progBrand(ctx) };
}
/** The brand the programme is run for: set by the owner, else the brand of the first creator. */
async function progBrand(ctx) {
  const b = str(await getConfig(ctx, 'creator_programme_brand', ''));
  if (b) return b;
  const first = (await ctx.tx`select brand from erp_creators where business_id = ${ctx.biz} and brand <> '' order by id limit 1`)[0];
  return first ? str(first.brand) : '';
}
/** A login for an e-mail: the existing user, or a new confirmed one with no password yet (set from the e-mailed link). */
async function userFor(deps, email, name) {
  const had = (await deps.sql`select id from auth.users where lower(email) = ${email} limit 1`)[0];
  if (had) return String(had.id);
  return deps.createOwner(email, name);
}
/** Owner: give a creator added by hand a login - a user is made (or found) and the choose-your-password e-mail goes out. */
export async function erpCreatorInvite(ctx, payload) {
  needOwner(ctx);
  const p = payload || {}, id = num(p.creator_id), email = str(p.email).toLowerCase();
  if (!okEmail(email)) throw new Error('That is not an e-mail address.');
  const c = (await ctx.tx`select * from erp_creators where business_id = ${ctx.biz} and id = ${id}`)[0];
  if (!c) throw new Error('No such creator.');
  const taken = (await ctx.tx`select id from erp_creators where business_id = ${ctx.biz} and lower(email) = ${email} and id <> ${id}`)[0];
  if (taken) throw new Error('Another creator already uses that e-mail.');
  const userId = await userFor(ctx.deps, email, str(c.name));
  await ctx.tx`update erp_creators set user_id = ${userId}, email = ${email}, updated_at = ${ctx.now} where id = ${id}`;
  await ctx.deps.sendResetTo(email, pageUrl(ctx.deps, 'creator'));
  await ev(ctx, { creator_id: id, who: 'owner', what: 'invited', detail: email });
  return { sent: true, email };
}
/** The business behind a programme code (public join link). */
async function bizByCode(deps, code) {
  const c = str(code).toUpperCase();
  if (!/^[A-Z0-9]{6,16}$/.test(c)) throw new Error('This join link is not complete.');
  const r = (await deps.sql`select business_id from business_config where key = 'creator_programme_code' and value = ${c} limit 1`)[0];
  if (!r) throw new Error('This join link is not known.');
  return r.business_id;
}
/** The creator behind a signed-in session (Authorization: Bearer <Supabase session>). */
async function creatorBySession(deps, authHeader) {
  const uid = authHeader ? await deps.verifyUser(authHeader) : null;
  if (!uid) throw new Error('Please sign in.');
  const r = (await deps.sql`select id, business_id from erp_creators where user_id = ${uid} limit 1`)[0];
  if (!r) throw new Error('This login has no creator profile. Join the programme first.');
  return { biz: r.business_id, ref: String(r.id) };
}
async function ev(ctx, e) {
  await ctx.tx`insert into erp_creator_events ${ctx.tx({ business_id: ctx.biz, creator_id: e.creator_id || null, request_id: e.request_id || null, post_id: e.post_id || null, who: e.who, what: e.what, detail: str(e.detail).slice(0, 500) || null, ip: str(e.ip).slice(0, 80) || null })}`;
}

// ---------------------------------------------------------------- links (owner side)
async function link(ctx, kind, ref) {
  const src = sourceOf(ctx.deps) || (ctx.deps && ctx.deps.control ? 'self' : null);
  if (!src) throw new Error('Links need the provider server.');
  const token = await tokenFor(ctx.deps, kind, src, ctx.biz, ref);
  await ctx.deps.control`insert into erp_creator_links (token_hash, source, business_id, kind, ref) values (${await sha256hex(token)}, ${src}, ${ctx.biz}, ${kind}, ${ref}) on conflict (token_hash) do nothing`;
  const url = pageUrl(ctx.deps, kind === 'creator' ? 'creator' : 'sponsor') + '?t=' + token;
  return { url, qr: qrDataUrl(url) };
}
export async function erpCreatorPortalLink(ctx, payload) {
  needOwner(ctx);
  const id = num((payload || {}).creator_id);
  const c = (await ctx.tx`select id, name from erp_creators where business_id = ${ctx.biz} and id = ${id}`)[0];
  if (!c) throw new Error('No such creator.');
  return { creator: c.name, ...(await link(ctx, 'creator', String(c.id))) };
}
export async function erpSponsorLink(ctx, payload) {
  needOwner(ctx);
  const brand = str((payload || {}).brand);
  if (!brand) throw new Error('Which brand?');
  return { brand, ...(await link(ctx, 'sponsor', brand.toLowerCase())) };
}

// ---------------------------------------------------------------- requests (owner side)
const reqRow = (r) => ({ id: Number(r.id), creator_id: Number(r.creator_id), status: r.status, title: str(r.title), sku: str(r.sku), product: str(r.product), qty: num(r.qty), qty_ok: r.qty_ok == null ? null : num(r.qty_ok),
                         value: num(r.value), note: str(r.note), owner_note: str(r.owner_note), requested_at: when(r.requested_at), decided_at: when(r.decided_at), given_at: when(r.given_at), links: num(r.links) });
async function requests(ctx, creatorId) {
  const rows = creatorId
    ? await ctx.tx`select r.*, (select count(*) from erp_creator_posts p where p.request_id = r.id) as links from erp_creator_requests r where r.business_id = ${ctx.biz} and r.creator_id = ${creatorId} order by r.id desc limit 100`
    : await ctx.tx`select r.*, (select count(*) from erp_creator_posts p where p.request_id = r.id) as links from erp_creator_requests r where r.business_id = ${ctx.biz} order by r.id desc limit 300`;
  return rows.map(reqRow);
}
export async function erpCreatorRequests(ctx) {
  needOwner(ctx);
  const all = await requests(ctx, 0);
  const names = Object.fromEntries((await ctx.tx`select id, name from erp_creators where business_id = ${ctx.biz}`).map((c) => [Number(c.id), str(c.name)]));
  const withName = all.map((r) => ({ ...r, creator: names[r.creator_id] || '' }));
  return { waiting: withName.filter((r) => r.status === 'requested'), approved: withName.filter((r) => r.status === 'approved'),
           open: withName.filter((r) => r.status === 'given' && r.links === 0), all: withName.slice(0, 100), youtubeKey: !!str(await getConfig(ctx, 'youtube_key', '')) };
}
export async function erpCreatorDecide(ctx, payload) {
  needOwner(ctx);
  const p = payload || {}, id = num(p.id), action = str(p.action);
  const r = (await ctx.tx`select * from erp_creator_requests where business_id = ${ctx.biz} and id = ${id}`)[0];
  if (!r) throw new Error('No such request.');
  const note = str(p.note).slice(0, 300) || null;
  if (action === 'approve') {
    if (r.status !== 'requested') throw new Error('This request was already decided.');
    const q = num(p.qty) > 0 ? num(p.qty) : num(r.qty);
    await ctx.tx`update erp_creator_requests set status = 'approved', qty_ok = ${q}, owner_note = ${note}, decided_at = ${ctx.now}, updated_at = ${ctx.now} where id = ${id}`;
    await ev(ctx, { creator_id: r.creator_id, request_id: id, who: 'owner', what: 'approved', detail: q + ' x ' + r.product + (note ? ' - ' + note : '') });
  } else if (action === 'decline') {
    if (r.status !== 'requested' && r.status !== 'approved') throw new Error('This request cannot be declined now.');
    await ctx.tx`update erp_creator_requests set status = 'declined', owner_note = ${note}, decided_at = ${ctx.now}, updated_at = ${ctx.now} where id = ${id}`;
    await ev(ctx, { creator_id: r.creator_id, request_id: id, who: 'owner', what: 'declined', detail: note || '' });
  } else if (action === 'given') {
    if (r.status !== 'approved' && r.status !== 'requested') throw new Error('Approve it first, or it was already given.');
    const q = num(p.qty) > 0 ? num(p.qty) : (r.qty_ok != null ? num(r.qty_ok) : num(r.qty));
    let value = num(p.value), sku = str(r.sku);
    if (!(value > 0) && sku) { const pr = (await ctx.tx`select sell_price from products where business_id = ${ctx.biz} and lower(sku) = ${sku.toLowerCase()}`)[0]; if (pr) value = num(pr.sell_price) * q; }
    await ctx.tx`update erp_creator_requests set status = 'given', qty_ok = ${q}, value = ${value}, owner_note = coalesce(${note}, owner_note), decided_at = coalesce(decided_at, ${ctx.now}), given_at = ${ctx.now}, updated_at = ${ctx.now} where id = ${id}`;
    await ctx.tx`insert into erp_creator_ships ${ctx.tx({ business_id: ctx.biz, creator_id: r.creator_id, request_id: id, on_date: formatDate(ctx.now, 'yyyy-MM-dd'), sku: sku || null, product: str(r.product), qty: q, value, note: str(r.title) ? 'Project: ' + str(r.title) : null })}`;
    await ev(ctx, { creator_id: r.creator_id, request_id: id, who: 'owner', what: 'given', detail: q + ' x ' + r.product + ' (৳' + Math.round(value) + ')' });
  } else throw new Error('Approve, decline or given?');
  return erpCreatorRequests(ctx);
}
export async function erpCreatorEvents(ctx, payload) {
  needOwner(ctx);
  const id = num((payload || {}).creator_id);
  const rows = await ctx.tx`select * from erp_creator_events where business_id = ${ctx.biz} and creator_id = ${id} order by id desc limit 200`;
  return { events: rows.map((e) => ({ id: Number(e.id), who: e.who, what: e.what, detail: str(e.detail), ip: str(e.ip), at: when(e.at), request_id: e.request_id ? Number(e.request_id) : 0, post_id: e.post_id ? Number(e.post_id) : 0 })) };
}

// ---------------------------------------------------------------- YouTube numbers (facts, no AI)
export function ytId(url) {
  const u = str(url);
  const m = /(?:youtu\.be\/|youtube\.com\/(?:watch\?(?:.*&)?v=|shorts\/|embed\/|live\/))([A-Za-z0-9_-]{11})/.exec(u);
  return m ? m[1] : '';
}
export async function erpYoutubeKey(ctx, payload) {
  needOwner(ctx);
  const key = str((payload || {}).key);
  await setConfig(ctx, 'youtube_key', key);
  return { set: !!key };
}
/** Fetch views / likes / comments for every YouTube post of this business (new ones, and those older than 20 hours). */
export async function ytRefresh(ctx, { all } = {}) {
  const key = str(await getConfig(ctx, 'youtube_key', '')) || str(ctx.deps && ctx.deps.youtubeKey);
  if (!key) return { skipped: 'no key' };
  const rows = await ctx.tx`select id, url, creator_id, fetched_at from erp_creator_posts where business_id = ${ctx.biz} and url ilike '%youtu%' order by id desc limit 200`;
  const todo = rows.filter((r) => ytId(r.url) && (all || !r.fetched_at || Date.now() - new Date(r.fetched_at).getTime() > 20 * 3600e3));
  if (!todo.length) return { fetched: 0 };
  let done = 0;
  for (let i = 0; i < todo.length; i += 50) {
    const batch = todo.slice(i, i + 50), ids = batch.map((r) => ytId(r.url));
    const res = await ctx.deps.fetch('https://www.googleapis.com/youtube/v3/videos?part=statistics&id=' + ids.join(',') + '&key=' + encodeURIComponent(key));
    const txt = await res.text();
    if (!res.ok) throw new Error('YouTube answered ' + res.status + ': ' + txt.slice(0, 160));
    let j; try { j = JSON.parse(txt); } catch (_) { throw new Error('YouTube gave no answer.'); }
    const stats = {}; for (const it of (j.items || [])) stats[it.id] = it.statistics || {};
    for (const r of batch) {
      const s = stats[ytId(r.url)]; if (!s) continue;
      const views = num(s.viewCount), likes = num(s.likeCount), comments = num(s.commentCount);
      await ctx.tx`update erp_creator_posts set views = ${views}, likes = ${likes}, comments = ${comments}, verified = true, fetched_at = ${ctx.now}, updated_at = ${ctx.now} where id = ${r.id}`;
      await ev(ctx, { creator_id: r.creator_id, post_id: r.id, who: 'youtube', what: 'fetched', detail: views + ' views, ' + likes + ' likes, ' + comments + ' comments' });
      done++;
    }
  }
  return { fetched: done };
}
export async function erpCreatorRefresh(ctx) { needOwner(ctx); return ytRefresh(ctx, { all: true }); }

// ---------------------------------------------------------------- the public pages
async function runAs(deps, R, biz, label, fn) {
  const rows = await R.owners(deps.sql, [biz]);
  if (!rows.length) throw new Error('This page is not available right now.');
  const out = await R.asBusiness(deps, rows[0], label, fn);
  if (out && out.error) throw new Error(out.error);
  return out;
}
async function openLink(deps, R, token, kind, ip) {
  const t = str(token);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This link is not complete.');
  await limit(deps, ip, kind, 120);
  const h = await sha256hex(t);
  const l = (await deps.control`select source, business_id, kind, ref from erp_creator_links where token_hash = ${h}`)[0];
  if (!l || l.kind !== kind) throw new Error('This link is not known. Ask for a new one.');
  await deps.control`update erp_creator_links set last_seen = now() where token_hash = ${h}`;
  let d = deps;
  if (l.source !== 'self') { if (!R.tenantDeps) throw new Error('This page is not available right now.'); d = await R.tenantDeps(l.source); }
  return { d, l };
}
async function shopInfo(ctx) {
  const S = await import('./sales.js');
  let p = {}; try { p = await S.qProfile(ctx); } catch (_) { p = {}; }
  const out = { name: str(p.name) || str(ctx.s.businessName), phone: str(p.phone), website: str(p.website), logo: '' };
  try { out.logo = (await S.docImg(ctx, p.logoTrimId)) || (await S.docImg(ctx, p.logoId)) || ''; } catch (_) { out.logo = ''; }
  return out;
}
const postRow = (p) => ({ id: Number(p.id), request_id: p.request_id ? Number(p.request_id) : 0, date: day(p.on_date), platform: str(p.platform), kind: str(p.kind), url: str(p.url), product: str(p.product),
                          views: num(p.views), likes: num(p.likes), comments: num(p.comments), shares: num(p.shares), leads: num(p.leads), verified: !!p.verified, by: str(p.by), fetched_at: when(p.fetched_at), updated_at: when(p.updated_at) });
async function creatorData(ctx, c) {
  const reqs = await requests(ctx, c.id);
  const posts = (await ctx.tx`select * from erp_creator_posts where business_id = ${ctx.biz} and creator_id = ${c.id} order by on_date desc, id desc limit 100`).map(postRow);
  const month = formatDate(ctx.now, 'yyyy-MM');
  const mPosts = posts.filter((p) => p.date.startsWith(month));
  const videos = mPosts.filter((p) => p.kind === 'video').length, others = mPosts.length - videos;
  const openNoLink = reqs.filter((r) => r.status === 'given' && r.links === 0).length;
  const pending = reqs.some((r) => r.status === 'requested' || r.status === 'approved');
  const needProfile = !!c.applied_at && !profileDone(c);   // self-joined creators fill their profile first; hand-added ones are the owner's job
  const canRequest = c.status === 'active' && !needProfile && openNoLink < num(c.open_limit) && !pending;
  // what he can ask for: filament in stock
  const cat = await erpCatalog(ctx);
  const stock = cat.filter((p) => (!p.status || p.status === 'Active') && num(p.stock) > 0 && /filament/i.test(p.cat || '')).map((p) => ({ sku: p.sku, name: p.name, stock: num(p.stock) })).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 300);
  const sum = (l, k) => l.reduce((a, x) => a + num(x[k]), 0);
  return {
    creator: { name: str(c.name), email: str(c.email), channels: parseChannels(c), handle: str(c.handle), platforms: str(c.platforms), followers: str(c.followers), links: str(c.links), niche: str(c.niche), city: str(c.city), about: str(c.about), whatsapp: str(c.whatsapp), brand: str(c.brand), code: str(c.code), status: str(c.status), videos_month: num(c.videos_month), posts_month: num(c.posts_month), rolls_video: num(c.rolls_video), filament: str(c.filament), trial_until: day(c.trial_until), notes: str(c.notes), profileDone: profileDone(c), needProfile: !!c.applied_at && !profileDone(c) },
    month: { name: formatDate(ctx.now, 'MMMM yyyy'), videos, posts: others, views: sum(mPosts, 'views') },
    total: { rolls: reqs.filter((r) => r.status === 'given').reduce((a, r) => a + num(r.qty_ok), 0), posts: posts.length, views: sum(posts, 'views') },
    requests: reqs, posts, stock, canRequest, why: canRequest ? '' : (c.status === 'applied' ? 'Your application is being reviewed. You will see the agreement here once it is approved.' : c.status !== 'active' ? 'The programme is ' + c.status + ' for you right now.' : needProfile ? 'Complete your profile first.' : pending ? (reqs.some((r) => r.status === 'requested') ? 'Your last request is still waiting for an answer.' : 'Collect the approved filament first.') : 'Paste the link of your last project first, then request the next filament.'),
    today: formatDate(ctx.now, 'yyyy-MM-dd'),
  };
}
async function creatorPage(ctx, l) {
  const c = (await ctx.tx`select * from erp_creators where business_id = ${ctx.biz} and id = ${num(l.ref)}`)[0];
  if (!c) throw new Error('This link is not known. Ask for a new one.');
  return { shop: await shopInfo(ctx), ...(await creatorData(ctx, c)) };
}
async function creatorAct(ctx, l, b, ip) {
  const c = (await ctx.tx`select * from erp_creators where business_id = ${ctx.biz} and id = ${num(l.ref)}`)[0];
  if (!c) throw new Error('This link is not known. Ask for a new one.');
  const action = str(b.action);
  if (action === 'profile') {
    const row = {};
    for (const k of PROFILE) row[k] = str(b[k]).slice(0, k === 'about' ? 1000 : 200) || null;
    const ch = cleanChannels(b.channels);
    if (!ch.length) throw new Error('Tick at least one platform and give its name and link.');
    Object.assign(row, derived(ch), { channels: JSON.stringify(ch) });
    if (str(b.name).length >= 2) row.name = str(b.name).slice(0, 80);
    row.profile_at = ctx.now; row.updated_at = ctx.now;
    await ctx.tx`update erp_creators set ${ctx.tx(row)} where id = ${c.id} and business_id = ${ctx.biz}`;
    await ev(ctx, { creator_id: c.id, who: 'creator', what: 'profile', detail: (row.handle + ' | ' + row.followers + ' | ' + PROFILE.map((k) => k + ': ' + str(row[k])).filter((x) => !/: $/.test(x)).join(' | ')).slice(0, 480), ip });
    return creatorData(ctx, { ...c, ...row });
  }
  if (action === 'request') {
    const d = await creatorData(ctx, c);
    if (!d.canRequest) throw new Error(d.why);
    const qty = Math.round(num(b.qty)); if (!(qty > 0)) throw new Error('How many rolls?');
    if (qty > num(c.rolls_video) * 3) throw new Error('That is more than the programme allows at once (' + num(c.rolls_video) * 3 + '). Ask the shop directly for more.');
    let sku = str(b.sku), product = str(b.product);
    if (sku) { const s = d.stock.find((x) => x.sku.toLowerCase() === sku.toLowerCase()); if (!s) throw new Error('That product is not in stock right now.'); sku = s.sku; product = s.name; }
    if (!product) throw new Error('Which filament?');
    const title = str(b.title).slice(0, 160); if (!title) throw new Error('One line about the video, please.');
    const r = (await ctx.tx`insert into erp_creator_requests ${ctx.tx({ business_id: ctx.biz, creator_id: c.id, title, sku: sku || null, product, qty, note: str(b.note).slice(0, 500) || null })} returning id`)[0];
    await ev(ctx, { creator_id: c.id, request_id: Number(r.id), who: 'creator', what: 'requested', detail: qty + ' x ' + product + ' - ' + title, ip });
    return creatorData(ctx, c);
  }
  if (action === 'link') {
    const url = str(b.url).slice(0, 500); if (!/^https?:\/\/\S+$/.test(url)) throw new Error('Paste the full link, starting with https://');
    const rid = num(b.request_id);
    let req = null;
    if (rid) { req = (await ctx.tx`select * from erp_creator_requests where business_id = ${ctx.biz} and creator_id = ${c.id} and id = ${rid}`)[0]; if (!req || req.status !== 'given' && req.status !== 'done') throw new Error('That project is not open for links.'); }
    const kind = ['video', 'post', 'reel'].includes(str(b.kind)) ? str(b.kind) : (ytId(url) ? 'video' : 'post');
    const platform = str(b.platform) || (ytId(url) ? 'YouTube' : /facebook\.com|fb\.watch/.test(url) ? 'Facebook' : /instagram\.com/.test(url) ? 'Instagram' : /tiktok\.com/.test(url) ? 'TikTok' : '');
    const nums = { views: Math.max(0, Math.round(num(b.views))), likes: Math.max(0, Math.round(num(b.likes))), comments: Math.max(0, Math.round(num(b.comments))), shares: Math.max(0, Math.round(num(b.shares))), leads: Math.max(0, Math.round(num(b.leads))) };
    const p = (await ctx.tx`insert into erp_creator_posts ${ctx.tx({ business_id: ctx.biz, creator_id: c.id, request_id: req ? req.id : null, on_date: formatDate(ctx.now, 'yyyy-MM-dd'), platform, kind, url, product: req ? str(req.product) : str(b.product).slice(0, 160) || null, ...nums, by: 'creator', note: str(b.note).slice(0, 300) || null })} returning id`)[0];
    if (req && req.status === 'given') await ctx.tx`update erp_creator_requests set status = 'done', updated_at = ${ctx.now} where id = ${req.id}`;
    await ev(ctx, { creator_id: c.id, request_id: req ? req.id : null, post_id: Number(p.id), who: 'creator', what: 'linked', detail: platform + ' ' + kind + ' ' + url, ip });
    if (ytId(url)) { try { await ytRefresh(ctx, { all: false }); } catch (e) { await ev(ctx, { creator_id: c.id, post_id: Number(p.id), who: 'system', what: 'fetch-failed', detail: String(e.message || e) }); } }
    return creatorData(ctx, c);
  }
  if (action === 'numbers') {
    const pid = num(b.post_id);
    const p = (await ctx.tx`select * from erp_creator_posts where business_id = ${ctx.biz} and creator_id = ${c.id} and id = ${pid}`)[0];
    if (!p) throw new Error('No such post.');
    if (p.verified) throw new Error('These numbers come from YouTube itself and cannot be typed over.');
    const nums = { views: Math.max(0, Math.round(num(b.views))), likes: Math.max(0, Math.round(num(b.likes))), comments: Math.max(0, Math.round(num(b.comments))), shares: Math.max(0, Math.round(num(b.shares))), leads: Math.max(0, Math.round(num(b.leads))) };
    await ctx.tx`update erp_creator_posts set ${ctx.tx({ ...nums, by: 'creator', updated_at: ctx.now })} where id = ${pid}`;
    await ev(ctx, { creator_id: c.id, post_id: pid, who: 'creator', what: 'numbers', detail: nums.views + ' views, ' + nums.likes + ' likes, ' + nums.comments + ' comments, ' + nums.leads + ' enquiries', ip });
    return creatorData(ctx, c);
  }
  throw new Error('Unknown action.');
}
async function sponsorPage(ctx, l) {
  const brand = str(l.ref);
  const creators = await ctx.tx`select * from erp_creators where business_id = ${ctx.biz} and lower(brand) = ${brand} order by name`;
  const ids = creators.map((c) => Number(c.id));
  const reqs = ids.length ? (await ctx.tx`select r.*, (select count(*) from erp_creator_posts p where p.request_id = r.id) as links from erp_creator_requests r where r.business_id = ${ctx.biz} and r.creator_id = any(${ids}) order by r.id desc`).map(reqRow) : [];
  const ships = ids.length ? await ctx.tx`select * from erp_creator_ships where business_id = ${ctx.biz} and creator_id = any(${ids}) order by on_date desc, id desc` : [];
  const posts = ids.length ? (await ctx.tx`select * from erp_creator_posts where business_id = ${ctx.biz} and creator_id = any(${ids}) order by on_date desc, id desc`).map((p) => ({ ...postRow(p), creator_id: Number(p.creator_id) })) : [];
  const projects = ids.length ? await ctx.tx`select * from erp_creator_projects where business_id = ${ctx.biz} and creator_id = any(${ids}) and status in ('sent', 'approved') order by id desc` : [];
  const codes = creators.map((c) => str(c.code).toLowerCase()).filter(Boolean);
  const sales = {};
  if (codes.length) {
    const rows = await ctx.tx`select lower(coalesce(note, '') || ' ' || coalesce(source, '')) as hay, grand_total, created_at from invoices where business_id = ${ctx.biz} and voided_at is null and created_at >= now() - interval '12 months'`;
    for (const r of rows) for (const code of codes) if (r.hay.includes(code)) { const m = formatDate(new Date(r.created_at), 'yyyy-MM'); const s = sales[code] = sales[code] || {}; const x = s[m] = s[m] || { orders: 0, revenue: 0 }; x.orders++; x.revenue += num(r.grand_total); }
  }
  const [y0, m0] = formatDate(ctx.now, 'yyyy-MM').split('-').map(Number);
  const months = []; for (let i = 5; i >= 0; i--) { let y = y0, m = m0 - i; while (m < 1) { m += 12; y--; } months.push(y + '-' + String(m).padStart(2, '0')); }
  const sum = (l, k) => l.reduce((a, x) => a + num(x[k]), 0);
  const out = creators.map((c) => {
    const id = Number(c.id), myShips = ships.filter((s) => Number(s.creator_id) === id), myPosts = posts.filter((p) => p.creator_id === id), myReqs = reqs.filter((r) => r.creator_id === id);
    const code = str(c.code).toLowerCase();
    const series = months.map((m) => { const sh = myShips.filter((s) => day(s.on_date).startsWith(m)), ps = myPosts.filter((p) => p.date.startsWith(m)), sl = (sales[code] || {})[m] || { orders: 0, revenue: 0 };
      return { month: m, rolls: sum(sh, 'qty'), value: Math.round(sum(sh, 'value')), posts: ps.length, views: sum(ps, 'views'), engagement: sum(ps, 'likes') + sum(ps, 'comments') + sum(ps, 'shares'), leads: sum(ps, 'leads'), orders: sl.orders, revenue: Math.round(sl.revenue) }; });
    const views = sum(myPosts, 'views'), value = sum(myShips, 'value');
    return { id, name: str(c.name), handle: str(c.handle), platforms: str(c.platforms), followers: str(c.followers), status: str(c.status), code: str(c.code), videos_month: num(c.videos_month), posts_month: num(c.posts_month), rolls_video: num(c.rolls_video), filament: str(c.filament), trial_until: day(c.trial_until),
      totals: { rolls: sum(myShips, 'qty'), value: Math.round(value), posts: myPosts.length, views, engagement: views > 0 ? Math.round((sum(myPosts, 'likes') + sum(myPosts, 'comments') + sum(myPosts, 'shares')) / views * 1000) / 10 : 0, leads: sum(myPosts, 'leads'), orders: series.reduce((a, s) => a + s.orders, 0), revenue: series.reduce((a, s) => a + s.revenue, 0), cpm: views > 0 ? Math.round(value / views * 1000) : 0, verified: myPosts.filter((p) => p.verified).length },
      series, projects: myReqs.map((r) => ({ ...r, posts: myPosts.filter((p) => p.request_id === r.id) })), ships: myShips.map((s) => ({ id: Number(s.id), date: day(s.on_date), sku: str(s.sku), product: str(s.product), qty: num(s.qty), value: num(s.value), request_id: s.request_id ? Number(s.request_id) : 0, at: when(s.created_at) })), loose: myPosts.filter((p) => !p.request_id) };
  });
  return { shop: await shopInfo(ctx), brand: creators.length ? str(creators[0].brand) : brand, creators: out, months, teams: projects.map((p) => ({ team: str(p.team), project: str(p.project), competition: str(p.competition), material: str(p.material), qty: str(p.qty), status: str(p.status), creator: (creators.find((c) => Number(c.id) === Number(p.creator_id)) || {}).name || '' })), generated: when(ctx.now) };
}
/** Public: the programme's front page (logos, intro) for a join link. */
async function programmePage(ctx) {
  const b = await progBrand(ctx);
  return { shop: await shopInfo(ctx), brands: b ? [b] : [] };
}
/** Public: join - a creator row (applied), a login, the choose-your-password e-mail. */
async function signup(ctx, b, ip) {
  const name = str(b.name).slice(0, 80), email = str(b.email).toLowerCase().slice(0, 160), phone = str(b.phone).slice(0, 40);
  if (name.length < 2) throw new Error('Your name, please.');
  if (!okEmail(email)) throw new Error('That is not an e-mail address.');
  if (phone.replace(/[^0-9]/g, '').length < 8) throw new Error('A phone number we can reach you on, please.');
  const mine = (await ctx.tx`select id, user_id from erp_creators where business_id = ${ctx.biz} and lower(email) = ${email}`)[0];
  if (mine) { await ctx.deps.sendResetTo(email, pageUrl(ctx.deps, 'creator')); return { joined: true, again: true }; }   // already joined: a fresh password link, no second profile
  const other = (await ctx.deps.sql`select id from erp_creators where user_id in (select id from auth.users where lower(email) = ${email}) limit 1`)[0];
  if (other) throw new Error('That e-mail is already in a creator programme. Sign in instead.');
  const userId = await userFor(ctx.deps, email, name);
  const brand = await progBrand(ctx);
  const r = (await ctx.tx`insert into erp_creators ${ctx.tx({ business_id: ctx.biz, name, email, whatsapp: phone, user_id: userId, brand, status: 'applied', applied_at: ctx.now, videos_month: 2, posts_month: 2, rolls_video: 2 })} returning id`)[0];
  await ev(ctx, { creator_id: Number(r.id), who: 'creator', what: 'joined', detail: name + ' <' + email + '> ' + phone, ip });
  await ctx.deps.sendResetTo(email, pageUrl(ctx.deps, 'creator'));
  return { joined: true };
}
export async function route(deps, R, what, method, params, body, ip, authHeader) {
  const t = params.get('t');
  if (what === 'creator') {
    const b = body || {}, action = str(b.action);
    // the join link: the programme's front page, and joining
    if (params.get('p') || action === 'signup') {
      const biz = await bizByCode(deps, params.get('p') || b.p);
      await limit(deps, ip, 'creator-join', 30);
      if (method === 'GET') return runAs(deps, R, biz, 'pub:creator', (ctx) => programmePage(ctx));
      if (action !== 'signup') throw new Error('Unknown action.');
      await limit(deps, str(b.email).toLowerCase(), 'creator-mail', 3);
      return runAs(deps, R, biz, 'pub:creator', (ctx) => signup(ctx, b, ip));
    }
    // forgotten password: a fresh link, always the same answer (no e-mail guessing)
    if (action === 'forgot') {
      const email = str(b.email).toLowerCase();
      if (!okEmail(email)) throw new Error('That is not an e-mail address.');
      await limit(deps, ip, 'creator-join', 30); await limit(deps, email, 'creator-mail', 3);
      const has = (await deps.sql`select 1 from erp_creators where lower(email) = ${email} and user_id is not null limit 1`)[0];
      if (has) { try { await deps.sendResetTo(email, pageUrl(deps, 'creator')); } catch (_) { /* the earlier link still works */ } }
      return { sent: true };
    }
    // the old token link still works; a signed-in creator comes with his session
    let d = deps, l;
    if (t) ({ d, l } = await openLink(deps, R, t, 'creator', ip));
    else { const sess = await creatorBySession(deps, authHeader); l = { business_id: sess.biz, ref: sess.ref, source: 'self' }; await limit(deps, ip, 'creator', 300); }
    if (method === 'GET') return runAs(d, R, l.business_id, 'pub:creator', (ctx) => creatorPage(ctx, l));
    return runAs(d, R, l.business_id, 'pub:creator', (ctx) => creatorAct(ctx, l, b, ip));
  }
  if (what === 'sponsor') {
    if (method !== 'GET') return null;
    const { d, l } = await openLink(deps, R, t, 'sponsor', ip);
    return runAs(d, R, l.business_id, 'pub:sponsor', (ctx) => sponsorPage(ctx, l));
  }
  return null;
}
export const HANDLERS = { erpCreatorPortalLink, erpSponsorLink, erpCreatorRequests, erpCreatorDecide, erpCreatorEvents, erpYoutubeKey, erpCreatorRefresh, erpCreatorProgramme, erpCreatorInvite };
