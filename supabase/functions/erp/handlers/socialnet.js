// Every social network the ERP can post to (owner 20 Oct 2026: "the build should be ready to plug and play when I
// connect it"). One registry, one way to connect, one way to publish, one way to read the figures.
//
//   PLATFORMS                 the registry: what each network takes, its caption rules, how it is connected
//   erpSocialNet()            every platform with its state: copy-only | not set up by the provider | connect | connected
//   erpSocialNetStart({key})  the address of the network's login page (owner)
//   socialNetCallback(deps, query, withBusiness)   GET ?social=back&p=<key>&code=...&state=<business>.<nonce>
//   erpSocialNetToken({key, token, chat})          Telegram: a bot token and the channel (no login page)
//   erpSocialNetOff({key})    forget the connection
//   publishTo(ctx, key, post, media, caption, prev)   one post to one network -> {id, link, pending?}
//   statsFor(ctx, key, result)                        the figures of one published post
//
// Facebook, Instagram and their stories go through the Meta login in metaconnect.js (social.js handles them); this
// file covers Threads, TikTok, YouTube Shorts, LinkedIn, X, Pinterest and Telegram. Each network's app credentials
// are the provider's (environment: THREADS_APP_ID/SECRET, TIKTOK_CLIENT_KEY/SECRET, GOOGLE_CLIENT_ID/SECRET for
// YouTube, LINKEDIN_CLIENT_ID/SECRET, X_CLIENT_ID/SECRET, PINTEREST_APP_ID/SECRET); each company logs in with its own
// account. Tokens live in business_secrets (SOCIAL_<KEY>_TOKEN / _REFRESH), the profile in business_config social_<key>.
// The login pages send the owner back to <function>?social=back&p=<key>: that address must be registered on each app.

import { getSecret, setSecret, getConfig, setConfig, readFile, fileUrl } from '../lib/ext.js';
import { formatDate, num } from '../lib/time.js';
import { bridgeFor, bridgePublish, bridgeStatus, bridgedPlatforms } from './bridges.js';
import { roleAtLeast } from '../allow.js';

const str = (v) => String(v == null ? '' : v).trim();
const form = (o) => Object.entries(o).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&');

export const PLATFORMS = {
  facebook:       { name: 'Facebook Page', via: 'meta', media: { image: true, video: true, text: true }, max: 63206, guide: '3-6 short lines, the price, how to order (inbox / website), 2-3 emoji at most, no hashtags' },
  instagram:      { name: 'Instagram', via: 'meta', media: { image: true, video: true, text: false }, max: 2200, guide: '2-4 lines, a question or hook first, the price, then 8-12 hashtags on the last line (3D printing, filament, Bangladesh, the brand); no links' },
  facebookStory:  { name: 'Facebook story', via: 'meta', media: { image: true, video: true, text: false }, max: 0, guide: '' },
  instagramStory: { name: 'Instagram story', via: 'meta', media: { image: true, video: true, text: false }, max: 0, guide: '' },
  threads:        { name: 'Threads', via: 'oauth', media: { image: true, video: true, text: true }, max: 500, guide: 'one or two conversational lines under 500 characters, the price, one question; 1-3 hashtags at most' },
  tiktok:         { name: 'TikTok', via: 'oauth', media: { image: false, video: true, text: false }, max: 2200, guide: 'a short punchy caption, the price, 3-6 hashtags including #3dprinting and a Bangladesh tag; no links' },
  youtube:        { name: 'YouTube Shorts', via: 'oauth', media: { image: false, video: true, text: false }, max: 5000, title: 100, guide: 'first line = the title (under 100 characters, with #Shorts), then a 2-4 line description with the price and how to order; 3-5 hashtags' },
  linkedin:       { name: 'LinkedIn', via: 'oauth', media: { image: true, video: false, text: true }, max: 3000, guide: 'a professional tone, 3-5 lines on the use and the value, the price, no emoji, 2-3 hashtags' },
  x:              { name: 'X (Twitter)', via: 'oauth', media: { image: true, video: false, text: true }, max: 280, guide: 'under 280 characters, the price, one hashtag' },
  pinterest:      { name: 'Pinterest', via: 'oauth', media: { image: true, video: false, text: false }, max: 500, title: 100, guide: 'first line = the pin title (under 100 characters), then a 1-2 line description with the price; keywords people search for' },
  telegram:       { name: 'Telegram channel', via: 'token', media: { image: true, video: true, text: true }, max: 1024, guide: '2-4 lines, the price, how to order; emoji are fine' },
  whatsapp:       { name: 'WhatsApp status', via: 'copy', media: { image: true, video: true, text: true }, max: 700, guide: '2-3 lines for a status or broadcast, the price and "reply to order"' },
  marketplace:    { name: 'Facebook Marketplace', via: 'copy', media: { image: true, video: false, text: true }, max: 5000, guide: 'a listing - a plain title line, then condition, price, what is included, delivery; no emoji or hashtags' },
};
export const API_KEYS = Object.keys(PLATFORMS).filter((k) => PLATFORMS[k].via === 'oauth' || PLATFORMS[k].via === 'token');
const ENV = { threads: ['threadsAppId', 'threadsAppSecret'], tiktok: ['tiktokClientKey', 'tiktokClientSecret'], youtube: ['googleClientId', 'googleClientSecret'], linkedin: ['linkedinClientId', 'linkedinClientSecret'], x: ['xClientId', 'xClientSecret'], pinterest: ['pinterestAppId', 'pinterestAppSecret'] };

function cfg(deps, key) {
  const s = (deps && deps.social) || {};
  const [idK, secK] = ENV[key] || [];
  const app = str((deps && deps.google && deps.google.appUrl) || 'https://erp.costareen.com/').replace(/#.*$/, '').replace(/\/+$/, '');
  return { id: str(s[idK]), secret: str(s[secK]), redirect: str(s.redirect), app, fetch: (deps && deps.fetch) || fetch };
}
export function configured(deps, key) { const p = PLATFORMS[key]; if (!p) return false; if (p.via === 'token' || p.via === 'copy' || p.via === 'meta') return true; const c = cfg(deps, key); return !!(c.id && c.secret && c.redirect); }
async function prof(ctx, key) { try { return JSON.parse(str(await getConfig(ctx, 'social_' + key, '')) || 'null'); } catch (_) { return null; } }
async function setProf(ctx, key, p) { await setConfig(ctx, 'social_' + key, p ? JSON.stringify(p) : ''); }
async function jfetch(f, url, opts) {
  const res = await f(url, opts);
  const txt = await res.text(); let j = null; try { j = JSON.parse(txt); } catch (_) { j = null; }
  return { ok: res.ok, status: res.status, json: j, text: txt, headers: res.headers };
}
const said = (name, r) => name + ' said ' + r.status + ': ' + str((r.json && (r.json.error_description || (r.json.error && (r.json.error.message || r.json.error)) || r.json.message || r.json.error_message || (r.json.data && r.json.data.error && r.json.data.error.message))) || r.text).slice(0, 200);

export async function erpSocialNet(ctx) {
  const out = [], br = await bridgedPlatforms(ctx);
  for (const key of Object.keys(PLATFORMS)) {
    const p = PLATFORMS[key];
    if (p.via === 'meta') continue;
    const prof_ = p.via === 'copy' ? null : await prof(ctx, key);
    const native = !!(prof_ && prof_.id), bridged = !native && !!br[key];
    out.push({ key, name: p.name, via: p.via, media: p.media, max: p.max, configured: configured(ctx.deps, key), connected: native || bridged, bridged,
               profile: native ? { name: str(prof_.name), handle: str(prof_.handle), since: str(prof_.since), expires: str(prof_.expires), note: str(prof_.note) } : bridged ? { handle: str(br[key].handle), note: ctx.s.role === 'owner' ? 'through ' + br[key].service : '' } : null });
  }
  return { platforms: out };
}

// ------------------------------------------------------------------ connecting
export async function erpSocialNetStart(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder connects an account.');
  const key = str(payload && payload.key), p = PLATFORMS[key];
  if (!p || p.via !== 'oauth') throw new Error('That network has no login page here.');
  const c = cfg(ctx.deps, key);
  if (!c.id || !c.secret || !c.redirect) throw new Error(p.name + ' is not set up on this system yet: the provider adds the app once (' + ENV[key].join(', ') + ').');
  const nonce = globalThis.crypto.randomUUID().replace(/-/g, '');
  let extra = '';
  if (key === 'x') { const ver = globalThis.crypto.randomUUID().replace(/-/g, '') + globalThis.crypto.randomUUID().replace(/-/g, ''); extra = '|' + ver; }
  await setConfig(ctx, 'social_state_' + key, nonce + '|' + (Date.now() + 15 * 60e3) + extra);
  const state = ctx.biz + '.' + nonce, redirect = c.redirect + '&p=' + key;
  let url = '';
  if (key === 'threads') url = 'https://threads.net/oauth/authorize?' + form({ client_id: c.id, redirect_uri: redirect, scope: 'threads_basic,threads_content_publish,threads_manage_insights', response_type: 'code', state });
  if (key === 'tiktok') url = 'https://www.tiktok.com/v2/auth/authorize/?' + form({ client_key: c.id, redirect_uri: redirect, scope: 'user.info.basic,video.publish,video.upload', response_type: 'code', state });
  if (key === 'youtube') url = 'https://accounts.google.com/o/oauth2/v2/auth?' + form({ client_id: c.id, redirect_uri: redirect, response_type: 'code', scope: 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube.readonly', access_type: 'offline', prompt: 'consent', state });
  if (key === 'linkedin') url = 'https://www.linkedin.com/oauth/v2/authorization?' + form({ client_id: c.id, redirect_uri: redirect, response_type: 'code', scope: 'openid profile w_member_social', state });
  if (key === 'x') {
    const ver = str(await getConfig(ctx, 'social_state_x', '')).split('|')[2] || '';
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(ver));
    const challenge = btoa(String.fromCharCode(...new Uint8Array(digest))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    url = 'https://x.com/i/oauth2/authorize?' + form({ client_id: c.id, redirect_uri: redirect, response_type: 'code', scope: 'tweet.read tweet.write users.read offline.access', state, code_challenge: challenge, code_challenge_method: 'S256' });
  }
  if (key === 'pinterest') url = 'https://www.pinterest.com/oauth/?' + form({ client_id: c.id, redirect_uri: redirect, response_type: 'code', scope: 'boards:read,pins:write,pins:read,user_accounts:read', state });
  return { url };
}

/** The network sends the owner back here. Returns where the browser goes next. */
export async function socialNetCallback(deps, query, withBusiness) {
  const key = str(query.p), p = PLATFORMS[key];
  const app = cfg(deps, key).app;
  const back = (word, why) => app + '/#/settings?social=' + encodeURIComponent(word) + '&p=' + encodeURIComponent(key) + (why ? '&why=' + encodeURIComponent(str(why).slice(0, 160)) : '');
  if (!p || p.via !== 'oauth') return back('bad-request');
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/i.exec(str(query.state));
  if (!m) return back('bad-request');
  const biz = m[1], sql = deps.sql;
  const row = (await sql`select value from business_config where business_id = ${biz} and key = ${'social_state_' + key}`)[0];
  const [nonce, until, verifier] = str(row && row.value).split('|');
  if (!nonce || nonce !== m[2] || Number(until) < Date.now()) return back('expired');
  await sql`delete from business_config where business_id = ${biz} and key = ${'social_state_' + key}`;
  if (query.error || !query.code) return back('refused', query.error_description || query.error);
  const c = cfg(deps, key), redirect = c.redirect + '&p=' + key, code = str(query.code);
  try {
    let token = '', refresh = '', expires = '', profile = {};
    if (key === 'threads') {
      const t = await jfetch(c.fetch, 'https://graph.threads.net/oauth/access_token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: c.id, client_secret: c.secret, grant_type: 'authorization_code', redirect_uri: redirect, code }) });
      if (!t.ok || !t.json || !t.json.access_token) throw new Error(said('Threads', t));
      const l = await jfetch(c.fetch, 'https://graph.threads.net/access_token?' + form({ grant_type: 'th_exchange_token', client_secret: c.secret, access_token: t.json.access_token }));
      token = str((l.json && l.json.access_token) || t.json.access_token); expires = l.json && l.json.expires_in ? formatDate(new Date(Date.now() + Number(l.json.expires_in) * 1000), 'd MMM yyyy') : '';
      const me = await jfetch(c.fetch, 'https://graph.threads.net/v1.0/me?fields=id,username,name&access_token=' + encodeURIComponent(token));
      profile = { id: str(me.json && me.json.id) || str(t.json.user_id), handle: str(me.json && me.json.username), name: str(me.json && me.json.name) };
    } else if (key === 'tiktok') {
      const t = await jfetch(c.fetch, 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_key: c.id, client_secret: c.secret, code, grant_type: 'authorization_code', redirect_uri: redirect }) });
      if (!t.ok || !t.json || !t.json.access_token) throw new Error(said('TikTok', t));
      token = str(t.json.access_token); refresh = str(t.json.refresh_token); expires = formatDate(new Date(Date.now() + num(t.json.expires_in || 86400) * 1000), 'd MMM yyyy h:mm a');
      const me = await jfetch(c.fetch, 'https://open.tiktokapis.com/v2/user/info/?fields=open_id,display_name,username', { headers: { Authorization: 'Bearer ' + token } });
      const u = (me.json && me.json.data && me.json.data.user) || {};
      profile = { id: str(u.open_id || t.json.open_id), handle: str(u.username), name: str(u.display_name), note: 'Until TikTok audits the app, posts from it are visible to the account only.' };
    } else if (key === 'youtube') {
      const t = await jfetch(c.fetch, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ code, client_id: c.id, client_secret: c.secret, redirect_uri: redirect, grant_type: 'authorization_code' }) });
      if (!t.ok || !t.json || !t.json.refresh_token) throw new Error(t.ok ? 'Google gave no lasting key: remove the ERP under myaccount.google.com → Security → Third-party access and connect again.' : said('Google', t));
      refresh = str(t.json.refresh_token); token = str(t.json.access_token);
      const ch = await jfetch(c.fetch, 'https://www.googleapis.com/youtube/v3/channels?part=snippet&mine=true', { headers: { Authorization: 'Bearer ' + token } });
      const it = ((ch.json && ch.json.items) || [])[0] || {};
      profile = { id: str(it.id), name: str(it.snippet && it.snippet.title), handle: str(it.snippet && it.snippet.customUrl) };
      if (!profile.id) throw new Error('This Google account has no YouTube channel: make one on youtube.com first.');
    } else if (key === 'linkedin') {
      const t = await jfetch(c.fetch, 'https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'authorization_code', code, client_id: c.id, client_secret: c.secret, redirect_uri: redirect }) });
      if (!t.ok || !t.json || !t.json.access_token) throw new Error(said('LinkedIn', t));
      token = str(t.json.access_token); refresh = str(t.json.refresh_token); expires = formatDate(new Date(Date.now() + num(t.json.expires_in || 5184000) * 1000), 'd MMM yyyy');
      const me = await jfetch(c.fetch, 'https://api.linkedin.com/v2/userinfo', { headers: { Authorization: 'Bearer ' + token } });
      profile = { id: str(me.json && me.json.sub), name: str(me.json && me.json.name), handle: '' };
    } else if (key === 'x') {
      const t = await jfetch(c.fetch, 'https://api.x.com/2/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(c.id + ':' + c.secret) }, body: form({ code, grant_type: 'authorization_code', client_id: c.id, redirect_uri: redirect, code_verifier: str(verifier) }) });
      if (!t.ok || !t.json || !t.json.access_token) throw new Error(said('X', t));
      token = str(t.json.access_token); refresh = str(t.json.refresh_token); expires = formatDate(new Date(Date.now() + num(t.json.expires_in || 7200) * 1000), 'd MMM yyyy h:mm a');
      const me = await jfetch(c.fetch, 'https://api.x.com/2/users/me', { headers: { Authorization: 'Bearer ' + token } });
      const u = (me.json && me.json.data) || {};
      profile = { id: str(u.id), handle: str(u.username), name: str(u.name) };
    } else if (key === 'pinterest') {
      const t = await jfetch(c.fetch, 'https://api.pinterest.com/v5/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(c.id + ':' + c.secret) }, body: form({ grant_type: 'authorization_code', code, redirect_uri: redirect }) });
      if (!t.ok || !t.json || !t.json.access_token) throw new Error(said('Pinterest', t));
      token = str(t.json.access_token); refresh = str(t.json.refresh_token); expires = formatDate(new Date(Date.now() + num(t.json.expires_in || 2592000) * 1000), 'd MMM yyyy');
      const me = await jfetch(c.fetch, 'https://api.pinterest.com/v5/user_account', { headers: { Authorization: 'Bearer ' + token } });
      const b = await jfetch(c.fetch, 'https://api.pinterest.com/v5/boards?page_size=25', { headers: { Authorization: 'Bearer ' + token } });
      const boards = ((b.json && b.json.items) || []).map((x) => ({ id: str(x.id), name: str(x.name) }));
      profile = { id: str(me.json && (me.json.id || me.json.username)), handle: str(me.json && me.json.username), name: str(me.json && me.json.business_name), boards, board: boards.length ? boards[0].id : '', note: boards.length ? 'Pins go to the board "' + boards[0].name + '".' : 'Make a board on Pinterest first; pins need one.' };
    }
    await withBusiness(biz, async (ctx) => {
      await setSecret(ctx, 'SOCIAL_' + key.toUpperCase() + '_TOKEN', token);
      await setSecret(ctx, 'SOCIAL_' + key.toUpperCase() + '_REFRESH', refresh);
      await setProf(ctx, key, { ...profile, since: formatDate(new Date(), 'd MMM yyyy'), expires });
    });
    return back('ok');
  } catch (e) { return back('failed', (e && e.message) || e); }
}

/** Telegram: no login page - a bot token (from @BotFather) and the channel the bot is an admin of. The token is checked and sealed. */
export async function erpSocialNetToken(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder connects an account.');
  const p = payload || {}, key = str(p.key);
  if (key !== 'telegram') throw new Error('Only Telegram is connected with a token.');
  const token = str(p.token), chat = str(p.chat);
  if (!/^\d{6,}:[A-Za-z0-9_-]{20,}$/.test(token)) throw new Error('That is not a bot token (it looks like 123456789:AAH…, from @BotFather).');
  if (!/^(@[A-Za-z0-9_]{4,}|-?\d{6,})$/.test(chat)) throw new Error('The channel is @its_name or its numeric id.');
  const f = ctx.deps.fetch || fetch;
  const me = await jfetch(f, 'https://api.telegram.org/bot' + token + '/getMe');
  if (!me.ok || !me.json || !me.json.ok) throw new Error('Telegram refused the token.');
  const ch = await jfetch(f, 'https://api.telegram.org/bot' + token + '/getChat?chat_id=' + encodeURIComponent(chat));
  if (!ch.ok || !ch.json || !ch.json.ok) throw new Error('The bot cannot see that channel: add the bot as an admin of the channel first.');
  await setSecret(ctx, 'SOCIAL_TELEGRAM_TOKEN', token);
  await setProf(ctx, 'telegram', { id: str(ch.json.result.id), handle: str(ch.json.result.username), name: str(ch.json.result.title), bot: str(me.json.result.username), since: formatDate(ctx.now, 'd MMM yyyy') });
  return erpSocialNet(ctx);
}

export async function erpSocialNetOff(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder disconnects an account.');
  const key = str(payload && payload.key);
  if (!PLATFORMS[key]) throw new Error('Which network?');
  await setSecret(ctx, 'SOCIAL_' + key.toUpperCase() + '_TOKEN', ''); await setSecret(ctx, 'SOCIAL_' + key.toUpperCase() + '_REFRESH', '');
  await setProf(ctx, key, null);
  return erpSocialNet(ctx);
}

// ------------------------------------------------------------------ tokens that renew themselves
async function token(ctx, key) {
  const p = PLATFORMS[key], c = cfg(ctx.deps, key);
  let t = await getSecret(ctx, 'SOCIAL_' + key.toUpperCase() + '_TOKEN');
  const r = await getSecret(ctx, 'SOCIAL_' + key.toUpperCase() + '_REFRESH');
  if (!t && !r) throw new Error(p.name + ' is not connected: Settings → Connections.');
  const pr = await prof(ctx, key) || {};
  const stale = pr.expiresAt ? new Date(pr.expiresAt).getTime() < Date.now() + 120e3 : (key === 'youtube' || key === 'x' || key === 'tiktok');
  if (!stale) return t;
  if (!r) return t;
  let res = null;
  if (key === 'youtube') res = await jfetch(c.fetch, 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_id: c.id, client_secret: c.secret, refresh_token: r, grant_type: 'refresh_token' }) });
  if (key === 'tiktok') res = await jfetch(c.fetch, 'https://open.tiktokapis.com/v2/oauth/token/', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ client_key: c.id, client_secret: c.secret, grant_type: 'refresh_token', refresh_token: r }) });
  if (key === 'x') res = await jfetch(c.fetch, 'https://api.x.com/2/oauth2/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(c.id + ':' + c.secret) }, body: form({ grant_type: 'refresh_token', refresh_token: r, client_id: c.id }) });
  if (key === 'linkedin') res = await jfetch(c.fetch, 'https://www.linkedin.com/oauth/v2/accessToken', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: form({ grant_type: 'refresh_token', refresh_token: r, client_id: c.id, client_secret: c.secret }) });
  if (key === 'pinterest') res = await jfetch(c.fetch, 'https://api.pinterest.com/v5/oauth/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + btoa(c.id + ':' + c.secret) }, body: form({ grant_type: 'refresh_token', refresh_token: r }) });
  if (key === 'threads') res = await jfetch(c.fetch, 'https://graph.threads.net/refresh_access_token?' + form({ grant_type: 'th_refresh_token', access_token: t }));
  if (!res) return t;
  if (!res.ok || !res.json || !res.json.access_token) throw new Error(p.name + ' no longer allows this ERP: connect it again under Settings → Connections (' + said(p.name, res) + ').');
  t = str(res.json.access_token);
  await setSecret(ctx, 'SOCIAL_' + key.toUpperCase() + '_TOKEN', t);
  if (res.json.refresh_token) await setSecret(ctx, 'SOCIAL_' + key.toUpperCase() + '_REFRESH', str(res.json.refresh_token));
  if (res.json.expires_in) await setProf(ctx, key, { ...pr, expiresAt: new Date(Date.now() + num(res.json.expires_in) * 1000).toISOString(), expires: formatDate(new Date(Date.now() + num(res.json.expires_in) * 1000), 'd MMM yyyy h:mm a') });
  return t;
}

// ------------------------------------------------------------------ publishing
async function mediaUrl(ctx, m) { const f = str(m.file); if (/^https?:\/\//.test(f)) return f; const i = f.indexOf('/'); return i < 0 ? '' : fileUrl(ctx, f.slice(0, i), f.slice(i + 1)); }
async function mediaBytes(ctx, m) {
  const f = str(m.file);
  if (/^https?:\/\//.test(f)) { const r = await (ctx.deps.fetch || fetch)(f); return { bytes: new Uint8Array(await r.arrayBuffer()), mime: str(r.headers.get('content-type')).split(';')[0] || (m.kind === 'video' ? 'video/mp4' : 'image/jpeg') }; }
  const i = f.indexOf('/'); const bytes = await readFile(ctx, f.slice(0, i), f.slice(i + 1));
  if (!bytes) throw new Error('The media could not be read.');
  return { bytes, mime: m.kind === 'video' ? 'video/mp4' : /\.png$/i.test(f) ? 'image/png' : 'image/jpeg' };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function firstLine(caption) { const lines = str(caption).split('\n'); return { title: str(lines[0]).slice(0, 100), rest: lines.slice(1).join('\n').trim() }; }

/** One post to one network. `prev` is the earlier answer when the network is still processing (pending). */
export async function publishTo(ctx, key, post, media, caption, prev) {
  const p = PLATFORMS[key]; if (!p) throw new Error('Unknown network ' + key);
  if (p.via === 'copy' || p.via === 'meta') throw new Error(p.name + ' is not published from here.');
  // no key of our own for this network: a bridge that holds it posts instead (the same answer shape)
  const own = await prof(ctx, key);
  if (!(own && own.id)) {
    const hit = await bridgeFor(ctx, key);
    if (hit) {
      const withUrls = []; for (const m of media || []) withUrls.push({ ...m, url: await mediaUrl(ctx, m) });
      if (prev && prev.bridgeId) return bridgeStatus(ctx, hit, prev);
      return bridgePublish(ctx, hit, key, post, withUrls, str(caption).slice(0, p.max || 5000), prev);
    }
  }
  const f = ctx.deps.fetch || fetch, pr = own || {}, tk = await token(ctx, key);
  const video = (media || []).find((m) => m.kind === 'video'), images = (media || []).filter((m) => m.kind === 'image');
  if (video && !p.media.video) throw new Error(p.name + ' takes no video from here: use a picture.');
  if (!video && images.length && !p.media.image) throw new Error(p.name + ' takes a video only.');
  if (!video && !images.length && !p.media.text) throw new Error(p.name + ' needs a picture or a video.');
  caption = str(caption).slice(0, p.max || 5000);

  if (key === 'threads') {
    let creation = str(prev && prev.creation);
    if (!creation) {
      const body = video ? { media_type: 'VIDEO', video_url: await mediaUrl(ctx, video), text: caption } : images.length ? { media_type: 'IMAGE', image_url: await mediaUrl(ctx, images[0]), text: caption } : { media_type: 'TEXT', text: caption };
      const r = await jfetch(f, 'https://graph.threads.net/v1.0/' + pr.id + '/threads?' + form({ ...body, access_token: tk }), { method: 'POST' });
      if (!r.ok || !r.json || !r.json.id) throw new Error(said('Threads', r));
      creation = str(r.json.id);
    }
    for (let i = 0; i < 4; i++) {
      const s = await jfetch(f, 'https://graph.threads.net/v1.0/' + creation + '?fields=status,error_message&access_token=' + encodeURIComponent(tk));
      const st = str(s.json && s.json.status);
      if (st === 'FINISHED' || !st) break;
      if (st === 'ERROR' || st === 'EXPIRED') throw new Error('Threads could not take the media: ' + str(s.json.error_message || st));
      if (i === 3) return { creation, pending: true };
      await wait(2500);
    }
    const pub = await jfetch(f, 'https://graph.threads.net/v1.0/' + pr.id + '/threads_publish?' + form({ creation_id: creation, access_token: tk }), { method: 'POST' });
    if (!pub.ok || !pub.json || !pub.json.id) throw new Error(said('Threads', pub));
    const id = str(pub.json.id);
    let link = 'https://www.threads.net/@' + str(pr.handle);
    try { const pl = await jfetch(f, 'https://graph.threads.net/v1.0/' + id + '?fields=permalink&access_token=' + encodeURIComponent(tk)); if (pl.json && pl.json.permalink) link = str(pl.json.permalink); } catch (_) { /* fine */ }
    return { id, link, creation };
  }
  if (key === 'tiktok') {
    let publishId = str(prev && prev.publishId);
    if (!publishId) {
      const { bytes } = await mediaBytes(ctx, video);
      const init = await jfetch(f, 'https://open.tiktokapis.com/v2/post/publish/video/init/', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ post_info: { title: caption.slice(0, 2200), privacy_level: str(pr.privacy) || 'PUBLIC_TO_EVERYONE', disable_duet: false, disable_comment: false, disable_stitch: false, video_cover_timestamp_ms: 1000 }, source_info: { source: 'FILE_UPLOAD', video_size: bytes.length, chunk_size: bytes.length, total_chunk_count: 1 } }) });
      if (!init.ok || !init.json || !init.json.data || !init.json.data.publish_id) throw new Error(said('TikTok', init));
      publishId = str(init.json.data.publish_id);
      const up = await f(init.json.data.upload_url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Range': 'bytes 0-' + (bytes.length - 1) + '/' + bytes.length }, body: bytes });
      if (!up.ok) throw new Error('TikTok did not take the video (' + up.status + ').');
    }
    for (let i = 0; i < 4; i++) {
      const s = await jfetch(f, 'https://open.tiktokapis.com/v2/post/publish/status/fetch/', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ publish_id: publishId }) });
      const d = (s.json && s.json.data) || {}, st = str(d.status);
      if (st === 'PUBLISH_COMPLETE') { const vid = str((d.publicaly_available_post_id || [])[0]); return { id: vid || publishId, link: vid ? 'https://www.tiktok.com/@' + str(pr.handle) + '/video/' + vid : 'https://www.tiktok.com/@' + str(pr.handle), publishId }; }
      if (st === 'FAILED') throw new Error('TikTok could not publish: ' + str(d.fail_reason || 'unknown'));
      if (i === 3) return { publishId, pending: true };
      await wait(3000);
    }
    return { publishId, pending: true };
  }
  if (key === 'youtube') {
    const { bytes } = await mediaBytes(ctx, video);
    const { title, rest } = firstLine(caption);
    const meta = { snippet: { title: (title || str(post.title) || 'Short').slice(0, 100), description: (rest || caption).slice(0, 5000), tags: ['3dprinting', 'filament', 'Bangladesh'], categoryId: '28' }, status: { privacyStatus: str(pr.privacy) || 'public', selfDeclaredMadeForKids: false } };
    const start = await f('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json; charset=UTF-8', 'X-Upload-Content-Type': 'video/mp4', 'X-Upload-Content-Length': String(bytes.length) }, body: JSON.stringify(meta) });
    if (!start.ok) throw new Error('YouTube said ' + start.status + ': ' + (await start.text()).slice(0, 200));
    const loc = start.headers.get('location');
    if (!loc) throw new Error('YouTube gave no upload address.');
    const up = await jfetch(f, loc, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', 'Content-Length': String(bytes.length) }, body: bytes });
    if (!up.ok || !up.json || !up.json.id) throw new Error(said('YouTube', up));
    return { id: str(up.json.id), link: 'https://www.youtube.com/shorts/' + str(up.json.id) };
  }
  if (key === 'linkedin') {
    const author = 'urn:li:person:' + str(pr.id), H = { Authorization: 'Bearer ' + tk, 'LinkedIn-Version': '202505', 'X-Restli-Protocol-Version': '2.0.0', 'Content-Type': 'application/json' };
    let content;
    if (images.length) {
      const { bytes, mime } = await mediaBytes(ctx, images[0]);
      const reg = await jfetch(f, 'https://api.linkedin.com/rest/images?action=initializeUpload', { method: 'POST', headers: H, body: JSON.stringify({ initializeUploadRequest: { owner: author } }) });
      const v = reg.json && reg.json.value;
      if (!reg.ok || !v || !v.uploadUrl) throw new Error(said('LinkedIn', reg));
      const up = await f(v.uploadUrl, { method: 'PUT', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': mime }, body: bytes });
      if (!up.ok) throw new Error('LinkedIn did not take the picture (' + up.status + ').');
      content = { media: { id: str(v.image), title: str(post.title).slice(0, 100) } };
    }
    const r = await jfetch(f, 'https://api.linkedin.com/rest/posts', { method: 'POST', headers: H, body: JSON.stringify({ author, commentary: caption, visibility: 'PUBLIC', distribution: { feedDistribution: 'MAIN_FEED', targetEntities: [], thirdPartyDistributionChannels: [] }, lifecycleState: 'PUBLISHED', isReshareDisabledByAuthor: false, ...(content ? { content } : {}) }) });
    const id = str(r.headers.get('x-restli-id') || (r.json && r.json.id));
    if (!r.ok || !id) throw new Error(said('LinkedIn', r));
    return { id, link: 'https://www.linkedin.com/feed/update/' + id };
  }
  if (key === 'x') {
    const H = { Authorization: 'Bearer ' + tk };
    const mediaIds = [];
    for (const m of images.slice(0, 4)) {
      const { bytes, mime } = await mediaBytes(ctx, m);
      const fd = new FormData(); fd.append('media', new Blob([bytes], { type: mime }), 'picture'); fd.append('media_category', 'tweet_image');
      const up = await jfetch(f, 'https://api.x.com/2/media/upload', { method: 'POST', headers: H, body: fd });
      const id = str((up.json && up.json.data && up.json.data.id) || (up.json && up.json.media_id_string));
      if (!up.ok || !id) throw new Error(said('X', up));
      mediaIds.push(id);
    }
    const r = await jfetch(f, 'https://api.x.com/2/tweets', { method: 'POST', headers: { ...H, 'Content-Type': 'application/json' }, body: JSON.stringify({ text: caption.slice(0, 280), ...(mediaIds.length ? { media: { media_ids: mediaIds } } : {}) }) });
    const id = str(r.json && r.json.data && r.json.data.id);
    if (!r.ok || !id) throw new Error(said('X', r));
    return { id, link: 'https://x.com/' + str(pr.handle) + '/status/' + id };
  }
  if (key === 'pinterest') {
    if (!str(pr.board)) throw new Error('Pinterest needs a board: make one on Pinterest, then connect again.');
    const { title, rest } = firstLine(caption);
    const r = await jfetch(f, 'https://api.pinterest.com/v5/pins', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' },
      body: JSON.stringify({ board_id: str(pr.board), title: (title || str(post.title)).slice(0, 100), description: (rest || caption).slice(0, 500), link: str(pr.link) || undefined, media_source: { source_type: 'image_url', url: await mediaUrl(ctx, images[0]) } }) });
    const id = str(r.json && r.json.id);
    if (!r.ok || !id) throw new Error(said('Pinterest', r));
    return { id, link: 'https://www.pinterest.com/pin/' + id + '/' };
  }
  if (key === 'telegram') {
    const base = 'https://api.telegram.org/bot' + tk + '/', chat = str(pr.id);
    let r;
    if (video) r = await jfetch(f, base + 'sendVideo', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, video: await mediaUrl(ctx, video), caption: caption.slice(0, 1024), supports_streaming: true }) });
    else if (images.length > 1) r = await jfetch(f, base + 'sendMediaGroup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, media: await Promise.all(images.slice(0, 10).map(async (m, i) => ({ type: 'photo', media: await mediaUrl(ctx, m), ...(i === 0 ? { caption: caption.slice(0, 1024) } : {}) }))) }) });
    else if (images.length) r = await jfetch(f, base + 'sendPhoto', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, photo: await mediaUrl(ctx, images[0]), caption: caption.slice(0, 1024) }) });
    else r = await jfetch(f, base + 'sendMessage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ chat_id: chat, text: caption.slice(0, 4096) }) });
    if (!r.ok || !r.json || !r.json.ok) throw new Error('Telegram said: ' + str(r.json && r.json.description).slice(0, 200));
    const res = Array.isArray(r.json.result) ? r.json.result[0] : r.json.result;
    const id = str(res && res.message_id);
    return { id, link: pr.handle ? 'https://t.me/' + str(pr.handle) + '/' + id : '' };
  }
  throw new Error(p.name + ' publishing is not built yet.');
}

/** The figures of one published post, where the network gives them. */
export async function statsFor(ctx, key, result) {
  const f = ctx.deps.fetch || fetch, id = str(result && result.id);
  if (!id || (result && result.bridge)) return null;   // a bridge's figures are on its own dashboard
  if (key === 'threads') { const tk = await token(ctx, key); const r = await jfetch(f, 'https://graph.threads.net/v1.0/' + id + '/insights?metric=views,likes,replies,reposts,quotes&access_token=' + encodeURIComponent(tk)); const o = {}; for (const d of (r.json && r.json.data) || []) o[d.name] = num(((d.values || [])[0] || {}).value); return r.ok ? { views: o.views, likes: o.likes, comments: o.replies, shares: num(o.reposts) + num(o.quotes) } : null; }
  if (key === 'youtube') { const tk = await token(ctx, key); const r = await jfetch(f, 'https://www.googleapis.com/youtube/v3/videos?part=statistics&id=' + encodeURIComponent(id), { headers: { Authorization: 'Bearer ' + tk } }); const s = ((r.json && r.json.items) || [])[0]; return s && s.statistics ? { views: num(s.statistics.viewCount), likes: num(s.statistics.likeCount), comments: num(s.statistics.commentCount) } : null; }
  if (key === 'x') { const tk = await token(ctx, key); const r = await jfetch(f, 'https://api.x.com/2/tweets/' + id + '?tweet.fields=public_metrics', { headers: { Authorization: 'Bearer ' + tk } }); const m = r.json && r.json.data && r.json.data.public_metrics; return m ? { views: num(m.impression_count), likes: num(m.like_count), comments: num(m.reply_count), shares: num(m.retweet_count) + num(m.quote_count), saved: num(m.bookmark_count) } : null; }
  if (key === 'pinterest') { const tk = await token(ctx, key); const r = await jfetch(f, 'https://api.pinterest.com/v5/pins/' + id + '/analytics?' + form({ start_date: formatDate(new Date(Date.now() - 29 * 864e5), 'yyyy-MM-dd'), end_date: formatDate(new Date(), 'yyyy-MM-dd'), metric_types: 'IMPRESSION,PIN_CLICK,SAVE,OUTBOUND_CLICK' }), { headers: { Authorization: 'Bearer ' + tk } }); const a = r.json && r.json.all && r.json.all.summary_metrics; return a ? { views: num(a.IMPRESSION), clicks: num(a.PIN_CLICK) + num(a.OUTBOUND_CLICK), saved: num(a.SAVE) } : null; }
  if (key === 'tiktok') { const tk = await token(ctx, key); if (!/^\d+$/.test(id)) return null; const r = await jfetch(f, 'https://open.tiktokapis.com/v2/video/query/?fields=view_count,like_count,comment_count,share_count', { method: 'POST', headers: { Authorization: 'Bearer ' + tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ filters: { video_ids: [id] } }) }); const v = (((r.json && r.json.data) || {}).videos || [])[0]; return v ? { views: num(v.view_count), likes: num(v.like_count), comments: num(v.comment_count), shares: num(v.share_count) } : null; }
  return null;   // LinkedIn (needs the organisation API) and Telegram (no view counts for bots) give nothing here
}

export const HANDLERS = { erpSocialNet, erpSocialNetStart, erpSocialNetToken, erpSocialNetOff };
