// Bridges (owner 20 Oct 2026): third-party posting services whose own developer apps are already approved by TikTok,
// YouTube, LinkedIn, X, Pinterest and Threads. The ERP stays the only face; the service runs behind it. Several
// services' free tiers are used side by side (never two accounts of one service - that breaks its terms):
//
//   zernio      2 social accounts free, unlimited posts, connect links by API      (zernio.com, ex Late)
//   publora     3 accounts free, 15 posts a month, accounts connected on its site  (publora.com)
//   uploadpost  2 profiles free, 10 uploads a month, branded connect page          (upload-post.com)
//
// A bridge is a service + an API key. Keys can be the provider's (environment BRIDGE_ZERNIO_KEY, BRIDGE_UPLOADPOST_KEY,
// BRIDGE_PUBLORA_KEY: one key serves every company, each company in its own profile where the service has profiles) or a
// company's own (pasted under Settings → Connections). Each company's social accounts attach to its profile through the
// service's connect page; after that the Posts form shows the network as connected, with no mention of the service to staff.
//
//   erpSocialBridges()                      the bridges and what each holds
//   erpSocialBridgeAdd({service, key})      owner: a company key, checked with the service, sealed
//   erpSocialBridgeConnect({id, platform})  the connect link for one network on one bridge
//   erpSocialBridgeRefresh({id})            read the accounts again
//   erpSocialBridgeRemove({id})
//   bridgeFor(ctx, platform)                the bridge that holds this network, if any
//   bridgePublish(ctx, bridge, platform, post, media, caption, prev)   one post through the bridge
//   bridgeStatus(ctx, bridge, prev)         a pending post: published yet, and its link

import { getSecret, setSecret, getConfig, setConfig } from '../lib/ext.js';
import { formatDate, num } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
export const SERVICES = {
  zernio: { name: 'Zernio', base: 'https://zernio.com/api/v1', free: '2 accounts free, unlimited posts', site: 'https://zernio.com', platforms: ['tiktok', 'youtube', 'linkedin', 'x', 'pinterest', 'threads', 'instagram', 'facebook', 'telegram'], names: { x: 'twitter' } },
  publora: { name: 'Publora', base: 'https://api.publora.com', free: '3 accounts free, 15 posts a month (no X)', site: 'https://app.publora.com', platforms: ['tiktok', 'youtube', 'linkedin', 'threads', 'instagram', 'facebook', 'telegram', 'pinterest'], names: { x: 'twitter' } },
  uploadpost: { name: 'Upload-Post', base: 'https://api.upload-post.com', free: '2 profiles free, 10 uploads a month (no TikTok on the free plan)', site: 'https://app.upload-post.com', platforms: ['tiktok', 'youtube', 'linkedin', 'x', 'pinterest', 'threads', 'instagram', 'facebook', 'telegram'], names: {} },
};
const need = (ctx, role) => { if (!roleAtLeast(ctx.s.role, role || 'sales')) throw new Error('Not open to your role.'); };
const ours = (service, name) => { const n = str(name).toLowerCase(); const map = SERVICES[service].names; for (const k of Object.keys(map)) if (map[k] === n) return k; return n === 'twitter' ? 'x' : n; };
const theirs = (service, key) => SERVICES[service].names[key] || key;

async function list(ctx) {
  let b = []; try { b = JSON.parse(str(await getConfig(ctx, 'social_bridges', '[]')) || '[]'); } catch (_) { b = []; }
  // the provider's keys serve every company: one bridge row per service with a key in the environment
  const env = (ctx.deps && ctx.deps.bridges) || {};
  for (const service of Object.keys(SERVICES)) {
    const k = str(env[service]);
    if (k && !b.some((x) => x.service === service && x.provider)) b.push({ id: 'p-' + service, service, provider: true, name: SERVICES[service].name, accounts: [], profile: '', at: '' });
  }
  return b;
}
async function save(ctx, b) { await setConfig(ctx, 'social_bridges', JSON.stringify(b.filter((x) => !(x.provider && !x.accounts.length && !x.profile)))); }
async function keyOf(ctx, b) { if (b.provider) return str(((ctx.deps && ctx.deps.bridges) || {})[b.service]); return await getSecret(ctx, 'BRIDGE_' + b.id + '_KEY'); }
async function jfetch(ctx, url, opts) {
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  const res = await f(url, opts);
  const txt = await res.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { j = null; }
  return { ok: res.ok, status: res.status, json: j, text: txt };
}
const said = (name, r) => name + ' said ' + r.status + ': ' + str((r.json && (r.json.message || r.json.error || (r.json.data && r.json.data.message))) || r.text).slice(0, 200);
const H = { zernio: (k) => ({ Authorization: 'Bearer ' + k, 'Content-Type': 'application/json' }), publora: (k) => ({ 'x-publora-key': k, 'Content-Type': 'application/json' }), uploadpost: (k) => ({ Authorization: 'Apikey ' + k }) };

/** The accounts a bridge holds for this company, read from the service. */
async function readAccounts(ctx, b, key) {
  const s = SERVICES[b.service];
  if (b.service === 'zernio') {
    const r = await jfetch(ctx, s.base + '/accounts' + (b.profile ? '?profileId=' + encodeURIComponent(b.profile) : ''), { headers: H.zernio(key) });
    if (!r.ok) throw new Error(said('Zernio', r));
    return ((r.json && (r.json.accounts || r.json.data)) || []).filter((a) => !b.profile || !a.profileId || str(a.profileId) === b.profile).map((a) => ({ platform: ours('zernio', a.platform), accountId: str(a._id || a.id), handle: str(a.username || a.name || a.displayName) }));
  }
  if (b.service === 'publora') {
    const r = await jfetch(ctx, s.base + '/api/v1/platform-connections', { headers: H.publora(key) });
    if (!r.ok) throw new Error(said('Publora', r));
    return ((r.json && r.json.connections) || []).map((c) => ({ platform: ours('publora', str(c.platformId).split('-')[0]), accountId: str(c.platformId), handle: str(c.username || c.displayName), ok: str(c.connectionStatus) !== 'reconnect_required' }));
  }
  if (b.service === 'uploadpost') {
    const r = await jfetch(ctx, s.base + '/api/uploadposts/users', { headers: H.uploadpost(key) });
    if (!r.ok) throw new Error(said('Upload-Post', r));
    const p = ((r.json && r.json.profiles) || []).find((x) => str(x.username) === b.profile);
    const out = [];
    for (const [platform, acc] of Object.entries((p && p.social_accounts) || {})) if (acc && typeof acc === 'object') out.push({ platform: ours('uploadpost', platform), accountId: str(acc.username || acc.handle || platform), handle: str(acc.handle || acc.display_name), ok: !acc.reauth_required });
    return out;
  }
  return [];
}
/** A profile for this company on the service (so one provider key serves many companies). */
async function ensureProfile(ctx, b, key) {
  if (b.profile) return b.profile;
  const s = SERVICES[b.service];
  const biz = (await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {};
  if (b.service === 'uploadpost') {
    const username = ('erp-' + ctx.biz.slice(0, 8)).toLowerCase();
    const r = await jfetch(ctx, s.base + '/api/uploadposts/users', { method: 'POST', headers: { ...H.uploadpost(key), 'Content-Type': 'application/json' }, body: JSON.stringify({ username, display_name: str(biz.name).slice(0, 100) }) });
    if (!r.ok && r.status !== 409) throw new Error(r.status === 403 ? 'Upload-Post: the profile limit of this plan is reached.' : said('Upload-Post', r));
    return username;
  }
  if (b.service === 'zernio') {
    const r = await jfetch(ctx, s.base + '/profiles', { method: 'POST', headers: H.zernio(key), body: JSON.stringify({ name: str(biz.name).slice(0, 100) || 'ERP' }) });
    if (!r.ok) throw new Error(said('Zernio', r));
    return str((r.json && (r.json.profile && r.json.profile._id)) || (r.json && r.json._id) || (r.json && r.json.id));
  }
  return '';   // Publora has no profiles: one key, one set of accounts
}

export async function erpSocialBridges(ctx) {
  need(ctx);
  const b = await list(ctx);
  return { bridges: b.map((x) => ({ id: x.id, service: x.service, name: SERVICES[x.service].name, provider: !!x.provider, free: SERVICES[x.service].free, site: SERVICES[x.service].site, platforms: SERVICES[x.service].platforms, accounts: x.accounts || [], at: x.at })), services: Object.keys(SERVICES).map((k) => ({ key: k, name: SERVICES[k].name, free: SERVICES[k].free, site: SERVICES[k].site })) };
}
export async function erpSocialBridgeAdd(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner adds a bridge.');
  const p = payload || {}, service = str(p.service), key = str(p.key);
  if (!SERVICES[service]) throw new Error('Which service?');
  if (key.length < 10) throw new Error('Paste the API key from the service\'s dashboard.');
  const b = await list(ctx);
  if (b.some((x) => x.service === service && !x.provider)) throw new Error(SERVICES[service].name + ' is already added: remove it first to change the key.');
  const id = globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 12);
  const row = { id, service, name: SERVICES[service].name, accounts: [], profile: '', at: formatDate(ctx.now, 'd MMM yyyy') };
  // the key is checked with the service before it is kept
  row.profile = await ensureProfile(ctx, row, key);
  row.accounts = await readAccounts(ctx, row, key);
  await setSecret(ctx, 'BRIDGE_' + id + '_KEY', key);
  b.push(row); await save(ctx, b);
  return erpSocialBridges(ctx);
}
export async function erpSocialBridgeRefresh(ctx, payload) {
  need(ctx, 'manager');
  const b = await list(ctx), x = b.find((y) => y.id === str(payload && payload.id));
  if (!x) throw new Error('No such bridge.');
  const key = await keyOf(ctx, x);
  if (!key) throw new Error('The key is gone: remove the bridge and add it again.');
  if (!x.profile) x.profile = await ensureProfile(ctx, x, key);
  x.accounts = await readAccounts(ctx, x, key); x.at = formatDate(ctx.now, 'd MMM yyyy');
  await save(ctx, b);
  return erpSocialBridges(ctx);
}
/** Where the owner connects one network to this bridge (the service's own login page for that network). */
export async function erpSocialBridgeConnect(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner connects an account.');
  const b = await list(ctx), x = b.find((y) => y.id === str(payload && payload.id));
  const platform = str(payload && payload.platform);
  if (!x) throw new Error('No such bridge.');
  if (!SERVICES[x.service].platforms.includes(platform)) throw new Error(SERVICES[x.service].name + ' does not do ' + platform + '.');
  const key = await keyOf(ctx, x), s = SERVICES[x.service];
  if (!key) throw new Error('The key is gone: remove the bridge and add it again.');
  if (!x.profile) { x.profile = await ensureProfile(ctx, x, key); await save(ctx, b); }
  if (x.service === 'zernio') {
    const r = await jfetch(ctx, s.base + '/connect/' + encodeURIComponent(theirs('zernio', platform)) + '?profileId=' + encodeURIComponent(x.profile), { headers: H.zernio(key) });
    if (!r.ok || !r.json || !r.json.authUrl) throw new Error(said('Zernio', r));
    return { url: str(r.json.authUrl), note: 'Log in to ' + platform + ' on the page that opens, then press Refresh here.' };
  }
  if (x.service === 'uploadpost') {
    const biz = (await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {};
    const r = await jfetch(ctx, s.base + '/api/uploadposts/users/generate-jwt', { method: 'POST', headers: { ...H.uploadpost(key), 'Content-Type': 'application/json' }, body: JSON.stringify({ username: x.profile, platforms: [theirs('uploadpost', platform)], connect_title: str(biz.name) + ' — connect ' + platform, connect_description: 'Log in to your account; the ERP posts there for you.', show_calendar: false, redirect_url: str((ctx.deps.google || {}).appUrl || 'https://erp.costareen.com/') }) });
    if (!r.ok || !r.json || !r.json.access_url) throw new Error(said('Upload-Post', r));
    return { url: str(r.json.access_url), note: 'Log in to ' + platform + ' on the page that opens (it is valid for 48 hours), then press Refresh here.' };
  }
  return { url: s.site, note: 'Publora connects accounts on its own site: log in there, connect ' + platform + ', then press Refresh here.' };
}
export async function erpSocialBridgeRemove(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner removes a bridge.');
  const id = str(payload && payload.id);
  const b = await list(ctx), x = b.find((y) => y.id === id);
  if (!x) throw new Error('No such bridge.');
  if (x.provider) throw new Error('That bridge is the provider\'s: it cannot be removed here.');
  await setSecret(ctx, 'BRIDGE_' + id + '_KEY', '');
  await save(ctx, b.filter((y) => y.id !== id));
  return erpSocialBridges(ctx);
}

/** The bridge (and its account) that holds this network for this company. */
export async function bridgeFor(ctx, platform) {
  for (const b of await list(ctx)) { const a = (b.accounts || []).find((x) => x.platform === platform && x.ok !== false); if (a) return { bridge: b, account: a }; }
  return null;
}
export async function bridgedPlatforms(ctx) {
  const out = {};
  for (const b of await list(ctx)) for (const a of b.accounts || []) if (a.ok !== false && !out[a.platform]) out[a.platform] = { handle: a.handle, service: b.service };
  return out;
}

const firstLine = (caption) => { const lines = str(caption).split('\n'); return { title: str(lines[0]).slice(0, 100), rest: lines.slice(1).join('\n').trim() }; };
/** One post through the bridge. media: [{kind, url}] with public links. Returns {id, link, pending?} like the native providers. */
export async function bridgePublish(ctx, hit, platform, post, media, caption, prev) {
  const { bridge: b, account: a } = hit, s = SERVICES[b.service], key = await keyOf(ctx, b);
  if (!key) throw new Error(s.name + ': the key is gone.');
  const video = (media || []).find((m) => m.kind === 'video'), images = (media || []).filter((m) => m.kind === 'image');
  const { title, rest } = firstLine(caption);
  if (b.service === 'zernio') {
    if (prev && prev.bridgeId) return bridgeStatus(ctx, hit, prev);
    const body = { content: caption, platforms: [{ platform: theirs('zernio', platform), accountId: a.accountId }], mediaItems: (video ? [video] : images).map((m) => ({ url: m.url, type: m.kind })), scheduledFor: formatDate(new Date(ctx.now.getTime() + 2 * 60e3), "yyyy-MM-dd'T'HH:mm:ss"), timezone: 'Asia/Dhaka' };
    if (platform === 'youtube') body.title = title || str(post.title);
    const r = await jfetch(ctx, s.base + '/posts', { method: 'POST', headers: H.zernio(key), body: JSON.stringify(body) });
    const id = str((r.json && r.json.post && r.json.post._id) || (r.json && r.json._id) || (r.json && r.json.id));
    if (!r.ok || !id) throw new Error(said('Zernio', r));
    return { bridgeId: id, bridge: b.service, pending: true };
  }
  if (b.service === 'publora') {
    if (prev && prev.bridgeId) return bridgeStatus(ctx, hit, prev);
    const settings = {};
    if (platform === 'youtube') settings.youtube = { title: title || str(post.title), privacy: 'public' };
    if (platform === 'tiktok') settings.tiktok = { viewerSetting: 'PUBLIC_TO_EVERYONE' };
    if (platform === 'instagram' && video) settings.instagram = { videoType: 'REELS', shareToFeed: true };
    const r = await jfetch(ctx, s.base + '/api/v1/create-post', { method: 'POST', headers: H.publora(key), body: JSON.stringify({ content: caption, platforms: [a.accountId], publishNow: true, mediaUrls: (video ? [video] : images).map((m) => m.url), ...(Object.keys(settings).length ? { platformSettings: settings } : {}) }) });
    const id = str(r.json && r.json.postGroupId);
    if (!r.ok || !id) throw new Error(said('Publora', r));
    return { bridgeId: id, bridge: b.service, pending: true };
  }
  if (b.service === 'uploadpost') {
    const fd = new FormData();
    fd.append('user', b.profile); fd.append('platform[]', theirs('uploadpost', platform));
    const tp = theirs('uploadpost', platform);
    let path;
    if (video) {
      path = '/api/upload'; fd.append('video', video.url); fd.append('title', (platform === 'youtube' ? (title || str(post.title)) : caption).slice(0, platform === 'youtube' ? 100 : 2200));
      if (platform === 'youtube') { fd.append('description', (rest || caption).slice(0, 5000)); fd.append('privacyStatus', 'public'); }
      if (platform === 'tiktok') { fd.append('privacy_level', 'PUBLIC_TO_EVERYONE'); fd.append('tiktok_title', caption.slice(0, 2200)); }
      if (platform === 'instagram') fd.append('media_type', 'REELS');
      if (platform === 'linkedin') fd.append('description', caption.slice(0, 3000));
      if (platform === 'pinterest') { fd.append('pinterest_title', title.slice(0, 100)); fd.append('description', (rest || caption).slice(0, 500)); }
    } else if (images.length) {
      path = '/api/upload_photos'; for (const m of images.slice(0, 10)) fd.append('photos[]', m.url); fd.append('title', caption.slice(0, 2200)); fd.append('caption', caption.slice(0, 2200));
      if (platform === 'pinterest') { fd.append('pinterest_title', title.slice(0, 100)); fd.append('description', (rest || caption).slice(0, 500)); }
    } else { path = '/api/upload_text'; fd.append('title', caption.slice(0, 3000)); fd.append(tp + '_description', caption.slice(0, 3000)); }
    const r = await jfetch(ctx, s.base + path, { method: 'POST', headers: H.uploadpost(key), body: fd });
    if (!r.ok || !r.json || r.json.success === false) throw new Error(said('Upload-Post', r));
    const res = (r.json.results || {})[tp] || (r.json.results || {})[platform];
    if (res && res.success === false) throw new Error('Upload-Post: ' + str(res.error).slice(0, 200));
    if (res && (res.url || res.post_id || res.publish_id)) return { id: str(res.post_id || res.publish_id || res.url), link: str(res.url), bridge: b.service };
    if (r.json.request_id) return { bridgeId: str(r.json.request_id), bridge: b.service, pending: true };
    return { id: 'sent', link: '', bridge: b.service };
  }
  throw new Error('Unknown bridge.');
}
/** A pending bridge post: is it out yet, and where. */
export async function bridgeStatus(ctx, hit, prev) {
  const { bridge: b } = hit, s = SERVICES[b.service], key = await keyOf(ctx, b), id = str(prev.bridgeId);
  if (b.service === 'zernio') {
    const r = await jfetch(ctx, s.base + '/posts/' + encodeURIComponent(id), { headers: H.zernio(key) });
    const p = (r.json && (r.json.post || r.json)) || {}, st = str(p.status);
    if (!r.ok) return r.status === 404 ? { id, link: '', bridge: b.service } : { ...prev, pending: true };
    if (st === 'published') { const pr = ((p.platforms || p.results || [])[0]) || {}; return { id: str(pr.postId || pr.externalId || id), link: str(pr.externalUrl || pr.url || pr.permalink), bridge: b.service, bridgeId: id }; }
    if (st === 'failed' || st === 'error') throw new Error('Zernio could not publish: ' + str(p.error || p.errorMessage || st));
    return { ...prev, pending: true };
  }
  if (b.service === 'publora') {
    const r = await jfetch(ctx, s.base + '/api/v1/get-post/' + encodeURIComponent(id), { headers: H.publora(key) });
    if (!r.ok) return { ...prev, pending: true };
    const posts = (r.json && r.json.posts) || [], p = posts[0] || {}, st = str(p.status || r.json.status);
    if (st === 'published') return { id: str(p.postedId || id), link: str(p.permalink), bridge: b.service, bridgeId: id };
    if (st === 'failed') throw new Error('Publora could not publish it (see its dashboard for the reason).');
    return { ...prev, pending: true };
  }
  if (b.service === 'uploadpost') {
    const r = await jfetch(ctx, s.base + '/api/uploadposts/status?request_id=' + encodeURIComponent(id), { headers: H.uploadpost(key) });
    if (!r.ok) return { ...prev, pending: true };
    const results = (r.json && r.json.results) || {};
    const k = Object.keys(results)[0]; const res = k ? results[k] : null;
    if (res && res.success === false) throw new Error('Upload-Post: ' + str(res.error).slice(0, 200));
    if (res && (res.url || res.post_id)) return { id: str(res.post_id || res.url), link: str(res.url), bridge: b.service, bridgeId: id };
    if (str(r.json && r.json.status) === 'failed') throw new Error('Upload-Post could not publish it.');
    return { ...prev, pending: true };
  }
  return { ...prev, pending: true };
}

export const HANDLERS = { erpSocialBridges, erpSocialBridgeAdd, erpSocialBridgeConnect, erpSocialBridgeRefresh, erpSocialBridgeRemove };
