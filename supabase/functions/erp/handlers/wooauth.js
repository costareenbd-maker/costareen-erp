// WooCommerce in one click (easy-1): the owner types the shop address and presses Connect;
// their own WordPress asks them "Allow Costareen ERP?" and, on Approve, WooCommerce sends the
// keys straight here. Nothing to copy. (WooCommerce's own "app authentication" endpoint.)
//
//   erpWooConnectStart({url})   owner -> {url}: the shop's approve page to open
//   wooKeysCallback(deps, body) WooCommerce POSTs {user_id, consumer_key, consumer_secret, key_permissions}
//                               to ?woo=keys; user_id carries "<business>.<nonce>" made by the start.

import { getConfig, setConfig, setSecret } from '../lib/ext.js';
import { erpWebsiteSet } from './connections.js';

const str = (v) => String(v == null ? '' : v).trim();

function base(deps) {
  const g = (deps && deps.google) || {};
  return { fn: str(g.redirect).replace(/\?.*$/, ''), app: str(g.appUrl) || 'https://erp.costareen.com/' };
}

export async function erpWooConnectStart(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner manages connections.');
  const typed = str(payload && payload.url);
  if (!typed) throw new Error('Type the shop address first, e.g. https://yourshop.com');
  await erpWebsiteSet(ctx, { kind: 'woo', url: typed });              // checks and keeps the address, kind = WooCommerce
  const shop = str(await getConfig(ctx, 'store_url', ''));
  const b = base(ctx.deps);
  if (!b.fn) throw new Error('This system cannot receive the keys yet (no server address).');
  const nonce = crypto.randomUUID().replace(/-/g, '');
  await setConfig(ctx, 'woo_auth', nonce + '|' + (Date.now() + 20 * 60e3));
  const q = new URLSearchParams({
    app_name: 'Costareen ERP',
    scope: 'read_write',
    user_id: ctx.biz + '.' + nonce,
    return_url: b.app + '#/settings?woo=back',
    callback_url: b.fn + '?woo=keys',
  });
  return { url: shop + '/wc-auth/v1/authorize?' + q.toString() };
}

export async function wooKeysCallback(deps, body) {
  body = body || {};
  const m = /^([0-9a-f-]{36})\.([0-9a-f]{32})$/i.exec(str(body.user_id));
  if (!m) return { status: 400, body: { ok: false } };
  const ctx = { sql: deps.sql, tx: deps.sql, biz: m[1] };
  const [nonce, until] = str(await getConfig(ctx, 'woo_auth', '')).split('|');
  if (!nonce || nonce !== m[2] || Number(until) < Date.now()) return { status: 403, body: { ok: false, error: 'expired' } };
  const k = str(body.consumer_key), s = str(body.consumer_secret);
  if (!/^ck_\w{20,}$/.test(k) || !/^cs_\w{20,}$/.test(s)) return { status: 400, body: { ok: false } };
  if (str(body.key_permissions) && str(body.key_permissions) !== 'read_write') return { status: 400, body: { ok: false, error: 'read_write needed' } };
  await setSecret(ctx, 'WOO_KEY', k);
  await setSecret(ctx, 'WOO_SECRET', s);
  await setConfig(ctx, 'woo_auth', '');
  await setConfig(ctx, 'website_kind', 'woo');
  await setConfig(ctx, 'website_sync_on', '');                       // live sync stays off until the owner switches it on
  return { status: 200, body: { ok: true } };
}

export const HANDLERS = { erpWooConnectStart };
