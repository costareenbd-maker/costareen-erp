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

const str = (v) => String(v == null ? '' : v).trim();
export const WEBSITE_DEFAULT = 'https://costareen.com/wp-json/cz/v1';

function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only the owner manages connections.'); }

async function website(ctx) {
  const key = await getSecret(ctx, 'CZ_SYNC_KEY');
  const url = str(await getConfig(ctx, 'website_api', '')) || WEBSITE_DEFAULT;
  const on = str(await getConfig(ctx, 'website_sync_on', '')) === '1';
  return { url, hasKey: !!key, on, state: !key ? 'off' : on ? 'on' : 'ready' };
}

export async function erpConnections(ctx) {
  needOwner(ctx);
  const soft = async (fn, d) => { try { return await ctx.tx.savepoint(fn); } catch (_) { return d; } };
  const w = await website(ctx);
  const sfKey = await getSecret(ctx, 'ERP_SF_KEY'), sfSecret = await getSecret(ctx, 'ERP_SF_SECRET');
  const evo = await soft(() => erpEvoStatus(ctx), { configured: false });
  const ai = await soft(async () => (await ctx.tx`select count(*)::int n from erp_ai_keys where business_id = ${ctx.biz} and enabled`)[0].n, 0);
  const smtp = str(ctx.deps && ctx.deps.smtpNote);
  return {
    website: { ...w, label: w.state === 'on' ? 'Live: orders in, stock out' : w.state === 'ready' ? 'Key saved, sync switched off' : 'Not connected' },
    courier: { state: sfKey && sfSecret ? 'on' : 'off', label: sfKey && sfSecret ? 'Steadfast keys saved' : 'Not connected' },
    whatsapp: { state: evo.connected ? 'on' : evo.configured ? 'warn' : 'off',
                label: evo.connected ? 'Linked' : evo.configured ? (evo.error || 'Set up, not linked') : 'Not connected' },
    email: { state: smtp ? 'on' : 'warn', label: smtp ? 'Sending through ' + smtp
             : 'Built-in mailer - only a few e-mails an hour. A real mail service is set up by the system provider (deploy/set_smtp.py).' },
    google: await soft(async () => { const g = (await getSecret(ctx, 'GOOGLE_REFRESH')) ? [1] : []; const e = str(await getConfig(ctx, 'google_email', ''));
      return g.length ? { state: 'on', label: 'Copies go to ' + (e || 'your Google Drive') } : { state: 'off', label: 'Not connected - invoices, quotations and backups can be copied to your Google Drive' }; }, { state: 'off', label: 'Not connected' }),
    ai: { state: ai ? 'on' : 'off', label: ai ? ai + ' AI access key(s) in use' : 'No AI access keys' },
  };
}

export async function erpWebsiteSet(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
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

export async function erpWebsiteTest(ctx) {
  needOwner(ctx);
  const w = await website(ctx);
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
  if (on && !(await getSecret(ctx, 'CZ_SYNC_KEY'))) throw new Error('Save the website sync key first.');
  await setConfig(ctx, 'website_sync_on', on ? '1' : '');
  return erpConnections(ctx);
}

export const HANDLERS = { erpConnections, erpWebsiteSet, erpWebsiteTest, erpWebsiteSync };
