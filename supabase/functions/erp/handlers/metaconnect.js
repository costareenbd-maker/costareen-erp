// Connect with Facebook: ONE Meta login for the whole ERP (Inbox now; posting, ads and research later).
//
//   erpMetaConnect()            connected? as whom, since when, what Meta allowed, and what the login reaches:
//                               Facebook pages (with their Instagram), WhatsApp numbers, ad accounts
//   erpMetaStart()              the address of Facebook's login dialog (owner); Meta sends the owner back to
//   metaCallback(deps, query)   GET ?meta=back&code=...&state=<business>.<nonce> - the code becomes a long-lived key
//   erpMetaRefresh()            read again what the login reaches
//   erpMetaUse({page|ig|phone}) make (or re-key) the Inbox channel for one of them - no key pasted by hand
//   erpMetaDisconnect()         forget the login (channels already made keep their own keys)
//
// The provider's Meta app (META_APP_ID / META_APP_SECRET, optional META_CONFIG_ID for Facebook Login for Business)
// is one for every company; each company logs in with its own Facebook. Keys live in business_secrets only.

import { getSecret, setSecret, getConfig, setConfig } from '../lib/ext.js';
import { formatDate } from '../lib/time.js';
import { needFeat } from '../lib/inboxplan.js';
import { chSecretSet, metaSubscribe } from './inboxch.js';

const str = (v) => String(v == null ? '' : v).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
// what the one login asks for: messages, comments, WhatsApp, posting, ads, catalogue (each a later use of the same key)
export const META_SCOPES = ['pages_show_list', 'pages_manage_metadata', 'pages_messaging', 'pages_read_engagement', 'pages_manage_engagement', 'pages_read_user_content',
  'pages_manage_posts', 'page_utility_messaging', 'instagram_basic', 'instagram_manage_messages', 'instagram_manage_comments', 'instagram_content_publish',
  'business_management', 'whatsapp_business_management', 'whatsapp_business_messaging', 'ads_read', 'ads_management', 'catalog_management'];

function cfg(deps) { const m = (deps && deps.meta) || {}; return { id: str(m.appId), secret: str(m.appSecret), config: str(m.configId), redirect: str(m.redirect), app: str((deps && deps.google && deps.google.appUrl) || 'https://erp.costareen.com/').replace(/#.*$/, '').replace(/\/+$/, '') }; }
function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only the owner connects Facebook.'); }
async function gget(deps, path, token) {
  const f = deps.fetch || fetch;
  const url = (/^https:/.test(path) ? path : GRAPH + path) + (token ? (path.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token) : '');
  const res = await f(url, { method: 'GET' });
  let j = {}; try { j = JSON.parse(await res.text()); } catch (_) { j = {}; }
  if (res.status < 200 || res.status >= 300 || j.error) throw new Error('Facebook said: ' + str((j.error && j.error.message) || res.status));
  return j;
}
async function gpost(deps, path, token) {
  const f = deps.fetch || fetch;
  const res = await f(GRAPH + path + (path.includes('?') ? '&' : '?') + 'access_token=' + encodeURIComponent(token), { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
  let j = {}; try { j = JSON.parse(await res.text()); } catch (_) { j = {}; }
  return { ok: res.status >= 200 && res.status < 300 && !j.error, error: str(j.error && j.error.message) };
}

export async function erpMetaConnect(ctx) {
  needOwner(ctx);
  const c = cfg(ctx.deps);
  const token = await getSecret(ctx, 'META_USER_TOKEN');
  let assets = {};
  try { assets = JSON.parse(str(await getConfig(ctx, 'meta_assets', '')) || '{}') || {}; } catch (_) { assets = {}; }
  const used = (await ctx.tx`select kind, external_id from inbox_channels where business_id = ${ctx.biz} and status <> 'removed'`).map((r) => r.kind + ':' + r.external_id);
  const mark = (kind, id) => used.includes(kind + ':' + id);
  return { configured: !!(c.id && c.secret && c.redirect), connected: !!token, name: str(await getConfig(ctx, 'meta_name', '')), since: str(await getConfig(ctx, 'meta_since', '')),
    expires: str(await getConfig(ctx, 'meta_expires', '')), granted: str(await getConfig(ctx, 'meta_granted', '')).split(',').filter(Boolean), asked: META_SCOPES,
    error: str(await getConfig(ctx, 'meta_error', '')),
    pages: (assets.pages || []).map((p) => ({ ...p, used: mark('messenger', p.id), igUsed: p.ig ? mark('instagram', p.ig.id) : false })),
    wabas: (assets.wabas || []).map((w) => ({ ...w, phones: (w.phones || []).map((n) => ({ ...n, used: mark('wa_cloud', n.id) })) })),
    adAccounts: assets.adAccounts || [] };
}

export async function erpMetaStart(ctx) {
  needOwner(ctx);
  const c = cfg(ctx.deps);
  if (!c.id || !c.secret || !c.redirect) throw new Error('Facebook is not set up on this system yet: the provider adds the Meta app once (META_APP_ID and META_APP_SECRET).');
  const nonce = crypto.randomUUID().replace(/-/g, '');
  await setConfig(ctx, 'meta_state', nonce + '|' + (Date.now() + 15 * 60e3));
  const q = new URLSearchParams({ client_id: c.id, redirect_uri: c.redirect, state: ctx.biz + '.' + nonce, response_type: 'code' });
  if (c.config) q.set('config_id', c.config); else q.set('scope', META_SCOPES.join(','));
  return { url: 'https://www.facebook.com/v21.0/dialog/oauth?' + q.toString() };
}

/** Facebook sends the owner back here. Returns where the browser goes next. */
export async function metaCallback(deps, query, withBusiness) {
  const c = cfg(deps), sql = deps.sql;
  const back = (word, why) => c.app + '/#/inbox?meta=' + encodeURIComponent(word) + (why ? '&why=' + encodeURIComponent(str(why).slice(0, 140)) : '');
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/i.exec(str(query.state));
  if (!m) return back('bad-request');
  const biz = m[1];
  const row = (await sql`select value from business_config where business_id = ${biz} and key = 'meta_state'`)[0];
  const [nonce, until] = str(row && row.value).split('|');
  if (!nonce || nonce !== m[2] || Number(until) < Date.now()) return back('expired');
  await sql`delete from business_config where business_id = ${biz} and key = 'meta_state'`;   // once only
  if (query.error || !query.code) return back('refused', query.error_description || query.error);
  try {
    const t1 = await gget(deps, '/oauth/access_token?client_id=' + encodeURIComponent(c.id) + '&redirect_uri=' + encodeURIComponent(c.redirect) + '&client_secret=' + encodeURIComponent(c.secret) + '&code=' + encodeURIComponent(str(query.code)));
    const t2 = await gget(deps, '/oauth/access_token?grant_type=fb_exchange_token&client_id=' + encodeURIComponent(c.id) + '&client_secret=' + encodeURIComponent(c.secret) + '&fb_exchange_token=' + encodeURIComponent(str(t1.access_token)));
    const token = str(t2.access_token || t1.access_token);
    if (!token) return back('failed', 'Facebook gave no key.');
    await withBusiness(biz, async (ctx) => {
      await setSecret(ctx, 'META_USER_TOKEN', token);
      await setConfig(ctx, 'meta_since', formatDate(new Date(), 'd MMM yyyy'));
      await setConfig(ctx, 'meta_expires', t2.expires_in ? formatDate(new Date(Date.now() + Number(t2.expires_in) * 1000), 'd MMM yyyy') : 'does not expire');
      await setConfig(ctx, 'meta_error', '');
      await discover(ctx, token);
    });
    return back('ok');
  } catch (e) {
    return back('failed', (e && e.message) || e);
  }
}

/** What the login reaches: pages (+ Instagram), WhatsApp numbers, ad accounts. Page keys are kept as secrets, never shown. */
async function discover(ctx, token) {
  const deps = ctx.deps;
  const me = await gget(deps, '/me?fields=id,name', token);
  await setConfig(ctx, 'meta_name', str(me.name));
  try { const p = await gget(deps, '/me/permissions', token); await setConfig(ctx, 'meta_granted', (p.data || []).filter((x) => x.status === 'granted').map((x) => x.permission).join(',')); } catch (_) { /* fine */ }
  const assets = { pages: [], wabas: [], adAccounts: [] };
  const pg = await gget(deps, '/me/accounts?fields=id,name,access_token,instagram_business_account{id,username}&limit=100', token);
  for (const p of pg.data || []) {
    await setSecret(ctx, 'META_PAGE_' + str(p.id), str(p.access_token));
    assets.pages.push({ id: str(p.id), name: str(p.name), ig: p.instagram_business_account ? { id: str(p.instagram_business_account.id), username: str(p.instagram_business_account.username) } : null });
  }
  try {
    const bz = await gget(deps, '/me/businesses?fields=id,name,owned_whatsapp_business_accounts{id,name,phone_numbers{id,display_phone_number,verified_name}}&limit=50', token);
    for (const b of bz.data || []) for (const w of ((b.owned_whatsapp_business_accounts || {}).data || [])) {
      assets.wabas.push({ id: str(w.id), name: str(w.name || b.name), phones: ((w.phone_numbers || {}).data || []).map((n) => ({ id: str(n.id), number: str(n.display_phone_number), name: str(n.verified_name) })) });
    }
  } catch (_) { /* no WhatsApp on this login */ }
  try {
    const ad = await gget(deps, '/me/adaccounts?fields=id,name,account_status,currency&limit=50', token);
    assets.adAccounts = (ad.data || []).map((a) => ({ id: str(a.id), name: str(a.name), currency: str(a.currency), active: Number(a.account_status) === 1 }));
  } catch (_) { /* no ads on this login */ }
  await setConfig(ctx, 'meta_assets', JSON.stringify(assets));
  await rekey(ctx, assets);
  return assets;
}

/** A new login (another Facebook account, a renewed key) gives new page keys: the Inbox channels already made for
 *  those pages take the new key and are subscribed again - otherwise they keep an old account's key and go quiet. */
async function rekey(ctx, assets) {
  const chans = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind in ('messenger', 'instagram') and status <> 'removed'`;
  const out = [];
  for (const ch of chans) {
    const pg = (assets.pages || []).find((p) => (ch.kind === 'messenger' ? p.id : p.ig && p.ig.id) === ch.external_id);
    if (!pg) continue;
    const key = await getSecret(ctx, 'META_PAGE_' + pg.id);
    if (!key) continue;
    await chSecretSet(ctx, ch, 'TOKEN', key);
    const sub = ch.kind === 'messenger' ? await metaSubscribe(ctx, ch) : { ok: true };
    out.push({ channel: ch.id, name: ch.name, ok: sub.ok, error: sub.error || '' });
  }
  return out;
}

export async function erpMetaRefresh(ctx) {
  needOwner(ctx);
  const token = await getSecret(ctx, 'META_USER_TOKEN');
  if (!token) throw new Error('Connect with Facebook first.');
  try { await discover(ctx, token); await setConfig(ctx, 'meta_error', ''); }
  catch (e) { await setConfig(ctx, 'meta_error', str(e && e.message).slice(0, 300)); throw e; }
  return erpMetaConnect(ctx);
}

/** Make the Inbox channel for a page, its Instagram or a WhatsApp number - the keys come from the login. */
export async function erpMetaUse(ctx, payload) {
  needOwner(ctx);
  const p = payload || {};
  const c = cfg(ctx.deps), token = await getSecret(ctx, 'META_USER_TOKEN');
  if (!token) throw new Error('Connect with Facebook first.');
  let assets = {}; try { assets = JSON.parse(str(await getConfig(ctx, 'meta_assets', '')) || '{}'); } catch (_) { assets = {}; }
  let kind, ext, name, key, settings = {};
  if (p.page) {
    const pg = (assets.pages || []).find((x) => x.id === str(p.page)); if (!pg) throw new Error('That page is not on this login.');
    kind = 'messenger'; ext = pg.id; name = pg.name; key = await getSecret(ctx, 'META_PAGE_' + pg.id);
  } else if (p.ig) {
    const pg = (assets.pages || []).find((x) => x.ig && x.ig.id === str(p.ig)); if (!pg) throw new Error('That Instagram account is not on this login.');
    kind = 'instagram'; ext = pg.ig.id; name = '@' + pg.ig.username; key = await getSecret(ctx, 'META_PAGE_' + pg.id);
  } else if (p.phone) {
    const w = (assets.wabas || []).find((x) => (x.phones || []).some((n) => n.id === str(p.phone))); if (!w) throw new Error('That WhatsApp number is not on this login.');
    const n = w.phones.find((x) => x.id === str(p.phone));
    kind = 'wa_cloud'; ext = n.id; name = n.name || n.number; key = token; settings = { waba_id: w.id };
  } else throw new Error('Which one?');
  if (!key) throw new Error('Facebook gave no key for it - press Refresh, or log in again.');
  await needFeat(ctx, { messenger: 'ch_messenger', instagram: 'ch_instagram', wa_cloud: 'ch_wa_cloud' }[kind]);
  let ch = (await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind = ${kind} and external_id = ${ext} and status <> 'removed'`)[0];
  if (!ch) {
    const base = { wait_s: 15, revert_min: 60, test_code: String(Math.floor(10000 + Math.random() * 90000)), ...settings };
    ch = (await ctx.tx`insert into inbox_channels (business_id, kind, name, external_id, status, settings, created_by)
           values (${ctx.biz}, ${kind}, ${name}, ${ext}, 'practice', ${ctx.tx.json(base)}, ${ctx.s.name}) returning *`)[0];
    await chSecretSet(ctx, ch, 'VERIFY', 'v' + crypto.randomUUID().replace(/-/g, '').slice(0, 24));
  } else if (Object.keys(settings).length) {
    await ctx.tx`update inbox_channels set settings = ${ctx.tx.json({ ...(ch.settings || {}), ...settings })} where id = ${ch.id}`;
  }
  await chSecretSet(ctx, ch, 'TOKEN', key);
  if (c.secret) await chSecretSet(ctx, ch, 'APP_SECRET', c.secret);
  const done = {};
  if (kind === 'messenger') done.subscribe = await metaSubscribe(ctx, ch);
  if (kind === 'wa_cloud') done.subscribe = await gpost(ctx.deps, '/' + encodeURIComponent(settings.waba_id) + '/subscribed_apps', token);
  return { ...(await erpMetaConnect(ctx)), channel: ch.id, done };
}

export async function erpMetaDisconnect(ctx) {
  needOwner(ctx);
  let assets = {}; try { assets = JSON.parse(str(await getConfig(ctx, 'meta_assets', '')) || '{}'); } catch (_) { assets = {}; }
  for (const p of assets.pages || []) await setSecret(ctx, 'META_PAGE_' + p.id, '');
  await setSecret(ctx, 'META_USER_TOKEN', '');
  for (const k of ['meta_name', 'meta_since', 'meta_expires', 'meta_granted', 'meta_assets', 'meta_error']) await setConfig(ctx, k, '');
  return erpMetaConnect(ctx);
}

export const HANDLERS = { erpMetaConnect, erpMetaStart, erpMetaRefresh, erpMetaUse, erpMetaDisconnect };
