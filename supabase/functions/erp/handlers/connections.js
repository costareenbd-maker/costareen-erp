// Settings > Connections: every outside service this business uses, with its
// state, in one place (owner only).
//
//   erpConnections()                         website, courier, WhatsApp, e-mail, Google, AI keys
//   erpWebsiteSet({url, key, clearKey})      the website's address and sync key (never shown back)
//   erpWebsiteTest()                         ask the website (GET /ping) - nothing is changed
//   erpWebsiteSync({on})                     live sync on or off: orders in every 15 minutes, stock out
//
// The website sync is OFF until switched on here, even with a key: the old
// sheet ERP may still be pushing stock to the same shop, and two systems
// pushing stock overwrite each other.

import { getSecret, setSecret, getConfig, setConfig, httpFetch } from '../lib/ext.js';
import { erpCourierTest } from './courier.js';
import { erpEvoStatus } from './campaigns.js';
import { storeTest } from './stores.js';

const str = (v) => String(v == null ? '' : v).trim();
export const WEBSITE_DEFAULT = 'https://costareen.com/wp-json/cz/v1';

function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only the owner manages connections.'); }

const KINDS = { plugin: 'WordPress sync plugin', woo: 'WooCommerce', shopify: 'Shopify' };

async function website(ctx) {
  const kind = str(await getConfig(ctx, 'website_kind', '')) || 'plugin';
  const on = str(await getConfig(ctx, 'website_sync_on', '')) === '1';
  let url, key;
  if (kind === 'woo') { url = str(await getConfig(ctx, 'store_url', '')); key = (await getSecret(ctx, 'WOO_KEY')) && (await getSecret(ctx, 'WOO_SECRET')); }
  else if (kind === 'shopify') { url = str(await getConfig(ctx, 'store_url', '')); key = await getSecret(ctx, 'SHOPIFY_TOKEN'); }
  else { url = str(await getConfig(ctx, 'website_api', '')); key = await getSecret(ctx, 'CZ_SYNC_KEY'); }
  const pluginKey = kind === 'plugin' ? !!key : !!(await getSecret(ctx, 'CZ_SYNC_KEY'));
  return { kind, kindLabel: KINDS[kind] || kind, url, hasKey: !!(key && url), on, state: !(key && url) ? 'off' : on ? 'on' : 'ready', pluginKey };
}

const KEY_OK = (k) => k.length >= 12 && !/\s/.test(k);

export async function erpConnections(ctx) {
  needOwner(ctx);
  return connectionsOf(ctx);
}

/** Only whether each service is connected - for the small status buttons on the pages that need one (everyone). */
export async function erpConnStatus(ctx) {
  const c = await connectionsOf(ctx);
  const out = {};
  for (const k of Object.keys(c)) out[k] = c[k].state;
  return out;
}

async function connectionsOf(ctx) {
  const soft = async (fn, d) => { try { return await ctx.tx.savepoint(fn); } catch (_) { return d; } };
  const w = await website(ctx);
  const sfKey = await getSecret(ctx, 'ERP_SF_KEY'), sfSecret = await getSecret(ctx, 'ERP_SF_SECRET');
  const evo = await soft(() => erpEvoStatus(ctx), { configured: false });
  const ai = await soft(async () => (await ctx.tx`select count(*)::int n from erp_ai_keys where business_id = ${ctx.biz} and enabled`)[0].n, 0);
  const smtp = str(ctx.deps && ctx.deps.smtpNote);
  return {
    website: { ...w, label: (w.kind === 'plugin' ? '' : w.kindLabel + ': ') + (w.state === 'on' ? 'Live: orders in, stock out' : w.state === 'ready' ? 'Keys saved, sync switched off' : 'Not connected') },
    courier: { state: sfKey && sfSecret ? 'on' : 'off', label: sfKey && sfSecret ? 'Steadfast keys saved' : 'Not connected' },
    whatsapp: { state: evo.connected ? 'on' : evo.configured ? 'warn' : 'off',
                label: evo.connected ? 'Linked' : evo.configured ? (evo.error || 'Set up, not linked') : 'Not connected' },
    email: { state: smtp ? 'on' : 'warn', label: smtp ? 'Sending through ' + smtp
             : 'Built-in mailer - only a few e-mails an hour. A real mail service is set up by the system provider (deploy/set_smtp.py).' },
    google: await soft(async () => { const g = (await getSecret(ctx, 'GOOGLE_REFRESH')) ? [1] : []; const e = str(await getConfig(ctx, 'google_email', ''));
      return g.length ? { state: 'on', label: 'Copies go to ' + (e || 'your Google Drive') } : { state: 'off', label: 'Not connected - invoices, quotations and backups can be copied to your Google Drive' }; }, { state: 'off', label: 'Not connected' }),
    ai: { state: ai ? 'on' : 'off', label: ai ? ai + ' AI access key(s) in use' : 'No AI access keys' },
    meta: await soft(async () => { const t = await getSecret(ctx, 'META_USER_TOKEN'); const n = str(await getConfig(ctx, 'meta_name', ''));
      return t ? { state: 'on', label: 'Logged in as ' + (n || 'your Facebook') + ' - pages, Instagram, WhatsApp and ad accounts (Inbox > Channels)' } : { state: 'off', label: 'Not connected - one Facebook login for the Inbox, posting and ads (Inbox > Channels)' }; }, { state: 'off', label: 'Not connected' }),
  };
}

export async function erpWebsiteSet(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const was = str(await getConfig(ctx, 'website_kind', '')) || 'plugin';
  // the WordPress sync plugin's key on its own (next to WooCommerce): the parcel numbers of website orders come from it
  if (payload.pluginKey !== undefined) {
    const k = str(payload.pluginKey);
    if (!k) { await setSecret(ctx, 'CZ_SYNC_KEY', ''); return erpConnections(ctx); }
    if (k.length < 12 || /\s/.test(k)) throw new Error('That does not look like the sync plugin key (12 or more letters and digits, no spaces).');
    await setSecret(ctx, 'CZ_SYNC_KEY', k);
    if (!str(await getConfig(ctx, 'website_api', '')) && !(ctx.deps && ctx.deps.install && ctx.deps.install.id)) await setConfig(ctx, 'website_api', WEBSITE_DEFAULT);
    return erpConnections(ctx);
  }
  const kind = payload.kind === undefined ? was : str(payload.kind);
  if (!KINDS[kind]) throw new Error('Which kind of website?');
  if (kind !== was) {
    // another shop: nothing runs until it is tested and switched on again
    await setConfig(ctx, 'website_kind', kind === 'plugin' ? '' : kind);
    await setConfig(ctx, 'website_sync_on', '');
  }
  if (kind !== 'plugin') return storeSet(ctx, kind, payload);
  if (payload.url !== undefined) {
    const url = str(payload.url).replace(/\/+$/, '');
    if (url && !/^https:\/\/[^\s/]+\.[^\s/]+\/\S*$/.test(url + '/')) throw new Error('The website address starts with https:// - e.g. https://costareen.com/wp-json/cz/v1');
    await setConfig(ctx, 'website_api', url);
  }
  if (payload.clearKey) {
    await setSecret(ctx, 'CZ_SYNC_KEY', '');
    await setConfig(ctx, 'website_sync_on', '');
  } else if (str(payload.key)) {
    const k = str(payload.key);
    if (k.length < 12 || /\s/.test(k)) throw new Error('That does not look like the sync key (12 or more letters and digits, no spaces).');
    await setSecret(ctx, 'CZ_SYNC_KEY', k);
  }
  return erpConnections(ctx);
}

async function storeSet(ctx, kind, payload) {
  if (payload.url !== undefined && str(payload.url)) {
    let url = str(payload.url).replace(/\/+$/, '');
    if (kind === 'shopify') {
      // the admin address people copy from the browser: admin.shopify.com/store/<name>
      const a = /admin\.shopify\.com\/store\/([a-z0-9][a-z0-9-]*)/i.exec(url);
      if (a) url = a[1];
      const m = /^(?:https?:\/\/)?([a-z0-9][a-z0-9-]*)(?:\.myshopify\.com)?(?:\/.*)?$/i.exec(url);
      if (!m) throw new Error('The Shopify address is like yourshop.myshopify.com (the .myshopify.com name, not your own domain).');
      url = 'https://' + m[1].toLowerCase() + '.myshopify.com';
    } else {
      if (!/^https:\/\//i.test(url)) url = 'https://' + url.replace(/^http:\/\//i, '');
      const m = /^(https:\/\/[^\s/]+\.[^\s/]+)(\/.*)?$/i.exec(url);
      if (!m) throw new Error('The shop address is like https://yourshop.com');
      url = m[1].toLowerCase() + (m[2] && !/^\/wp-(json|admin)/i.test(m[2]) ? m[2].replace(/\/+$/, '') : '');
    }
    await setConfig(ctx, 'store_url', url);
  }
  if (payload.clearKey) {
    for (const k of ['WOO_KEY', 'WOO_SECRET', 'SHOPIFY_TOKEN']) await setSecret(ctx, k, '');
    await setConfig(ctx, 'website_sync_on', '');
    return erpConnections(ctx);
  }
  if (kind === 'woo') {
    const k = str(payload.key), s = str(payload.secret);
    if (k || s) {
      if (!KEY_OK(k) || !KEY_OK(s)) throw new Error('Paste both WooCommerce keys: the consumer key (ck_...) and the consumer secret (cs_...).');
      if (/^cs_/.test(k) && /^ck_/.test(s)) throw new Error('The two keys are swapped: the consumer key starts with ck_, the secret with cs_.');
      await setSecret(ctx, 'WOO_KEY', k); await setSecret(ctx, 'WOO_SECRET', s);
    }
  } else if (str(payload.key)) {
    if (!KEY_OK(str(payload.key))) throw new Error('That does not look like a Shopify Admin API token (it starts with shpat_).');
    await setSecret(ctx, 'SHOPIFY_TOKEN', str(payload.key));
  }
  return erpConnections(ctx);
}

export async function erpWebsiteTest(ctx) {
  needOwner(ctx);
  const w = await website(ctx);
  if (w.kind !== 'plugin') return w.hasKey ? storeTest(ctx) : { ok: false, error: 'Save the shop address and keys first.' };
  const key = await getSecret(ctx, 'CZ_SYNC_KEY');
  if (!key) return { ok: false, error: 'No sync key saved yet.' };
  const r = await httpFetch(ctx, w.url.replace(/\/+$/, '') + '/ping', { method: 'GET', headers: { 'x-cz-key': key } });
  if (r.code === 0) return { ok: false, error: 'The website could not be reached: ' + str(r.text).slice(0, 160) };
  if (r.code === 401 || r.code === 403) return { ok: false, error: 'The website refused the key. Check the key in the website’s sync plugin.' };
  if (r.code === 404) return { ok: false, error: 'The website has no sync plugin at that address.' };
  if (r.code !== 200) return { ok: false, error: 'The website answered ' + r.code + '.' };
  let j = {};
  try { j = JSON.parse(r.text); } catch (_) { j = {}; }
  return { ok: true, reply: str(j.site || j.name || j.status || 'connected') };
}

export async function erpWebsiteSync(ctx, payload) {
  needOwner(ctx);
  const on = !!(payload && payload.on);
  if (on && !(await website(ctx)).hasKey) throw new Error('Save the website address and keys first.');
  await setConfig(ctx, 'website_sync_on', on ? '1' : '');
  return erpConnections(ctx);
}

export const HANDLERS = { erpConnections, erpConnStatus, erpWebsiteSet, erpWebsiteTest, erpWebsiteSync };
