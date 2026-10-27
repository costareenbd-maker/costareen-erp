// The Meta pixel, kept clean (136; owner 20 Oct 2026: "a fake order sent to the pixel teaches Meta the wrong audience").
// Like CapiFlow / PixelFly for WooCommerce, but for every order in the Inbox (landing page, chat, product page):
//   at the order       the page fires only Lead (InitiateCheckout when the form is started) - never Purchase;
//                      the server sends the same Lead (same event id: Meta counts it once), not for a RISKY / blocked order
//   Purchase           from the server (Conversions API) when the order is APPROVED or - the default - DELIVERED
//                      (the invoice delivered, or the courier's cash-on-delivery paid); never for a cancelled order
//   OrderReturned      a custom event when an order already counted as a Purchase comes back or is cancelled, so the
//                      returner can be left out of audiences (Meta has no standard "refund" event)
//
//   erpPixel()                         the settings and what was sent (manager)
//   erpPixelSet({pixel, token, when, test, browser})   owner; the token is sealed (Events Manager -> Conversions API
//                                      -> Generate access token); without one the Facebook login's key is used
//   erpPixelTest()                     sends one test event (shows in Events Manager -> Test events with the test code)
//   pixelTick(ctx)                     every minute (Inbox timer): Leads, Purchases, returns - at most 30 a minute
//   pixelPublic(ctx)                   what a landing page may know: the pixel id only

import { getConfig, setConfig, getSecret, setSecret } from '../lib/ext.js';
import { formatDate, num } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { phoneOk } from './inbox.js';
import { paymentsTab, PAY } from '../lib/tabs.js';

const str = (v) => String(v == null ? '' : v).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';

async function settings(ctx) {
  let s = {}; try { s = JSON.parse(str(await getConfig(ctx, 'pixel_settings', '')) || '{}') || {}; } catch (_) { s = {}; }
  let adsPixel = '';
  if (!s.pixel) { try { adsPixel = str((JSON.parse(str(await getConfig(ctx, 'ads_settings', '')) || '{}') || {}).pixel); } catch (_) { adsPixel = ''; } }
  return { pixel: str(s.pixel || adsPixel).replace(/[^0-9]/g, ''), when: s.when === 'approved' ? 'approved' : 'delivered', test: str(s.test), browser: s.browser !== false, on: s.on !== false };
}
async function tokenOf(ctx) {
  const own = str(await getSecret(ctx, 'META_CAPI_TOKEN'));
  if (own) return { token: own, from: 'own' };
  const login = str(await getSecret(ctx, 'META_USER_TOKEN'));
  return { token: login, from: login ? 'login' : '' };
}
export async function pixelPublic(ctx) {
  const s = await settings(ctx);
  return s.on && s.browser && s.pixel ? s.pixel : '';
}

async function sha(v) {
  const b = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(v)));
  return Array.from(b).map((x) => x.toString(16).padStart(2, '0')).join('');
}
/** Meta's way: the phone with the country code, digits only (8801XXXXXXXXX), lower-case names, all SHA-256. */
export async function userData(o) {
  const ph = phoneOk(o.phone);
  const ud = { country: [await sha('bd')] };
  if (ph) { const e164 = '88' + ph; ud.ph = [await sha(e164)]; ud.external_id = [await sha(e164)]; }
  const first = str(o.name).toLowerCase().split(/\s+/)[0];
  if (first && /^[a-z]+$/.test(first)) ud.fn = [await sha(first)];
  const m = o.meta || {};
  if (m.fbp) ud.fbp = m.fbp;
  if (m.fbc) ud.fbc = m.fbc;
  if (m.ua) ud.client_user_agent = m.ua;
  if (o.ip) ud.client_ip_address = o.ip;
  return ud;
}
const value = (o) => (o.items || []).reduce((t, x) => t + num(x.qty) * num(x.price), 0);
async function event(name, o, id) {
  const m = o.meta || {};
  return { event_name: name, event_time: Math.floor(Date.now() / 1000), event_id: id, action_source: m.url ? 'website' : 'system_generated',
           ...(m.url ? { event_source_url: m.url } : {}), user_data: await userData(o),
           custom_data: { currency: 'BDT', value: Math.round(value(o)), order_id: o.no, content_type: 'product', content_ids: (o.items || []).map((x) => str(x.sku)),
                          num_items: (o.items || []).reduce((t, x) => t + num(x.qty), 0) } };
}
async function send(ctx, S, tok, events) {
  const f = ctx.deps.fetch || fetch;
  const body = { data: events, ...(S.test ? { test_event_code: S.test } : {}) };
  const res = await f(GRAPH + '/' + encodeURIComponent(S.pixel) + '/events?access_token=' + encodeURIComponent(tok.token),
                      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const t = await res.text(); let j = {}; try { j = JSON.parse(t); } catch (_) { j = {}; }
  if (res.status < 200 || res.status >= 300) throw new Error('Meta said ' + res.status + ': ' + str((j.error && (j.error.error_user_msg || j.error.message)) || t).slice(0, 200));
  return j;
}
async function mark(ctx, o, key, patch) {
  const m = { ...(o.meta || {}) }; m.sent = { ...(m.sent || {}), [key]: new Date().toISOString(), ...(patch || {}) };
  await ctx.tx`update chat_orders set meta = ${ctx.tx.json(m)} where id = ${o.id}`;
  o.meta = m;
}

/** Every minute: what Meta should hear. Returns counts. */
export async function pixelTick(ctx) {
  const out = { lead: 0, purchase: 0, returned: 0, errors: 0 };
  const S = await settings(ctx);
  if (!S.on || !S.pixel) return out;
  const tok = await tokenOf(ctx);
  if (!tok.token) return out;
  const fresh = new Date(ctx.now.getTime() - 6 * 864e5);   // Meta takes events up to 7 days old
  const rows = await ctx.tx`select o.*, i.delivery_status, i.cancelled_at as inv_cancelled from chat_orders o
    left join invoices i on i.business_id = o.business_id and i.invoice_no = o.invoice_no
    where o.business_id = ${ctx.biz} and o.created_at > now() - interval '60 days'
      and (coalesce(o.meta->'sent'->>'lead', '') = '' or coalesce(o.meta->'sent'->>'purchase', '') = '' or (coalesce(o.meta->'sent'->>'purchase', '') <> '' and coalesce(o.meta->'sent'->>'returned', '') = ''))
    order by o.created_at desc limit 200`;
  let codPaid = null;
  const paidByCourier = async (no) => {
    if (!codPaid) { codPaid = new Set(); try { for (const p of await paymentsTab(ctx)) if (/steadfast|courier|cod/i.test(String(p[PAY.method] || ''))) codPaid.add(str(p[PAY.order_id])); } catch (_) { /* none */ } }
    return codPaid.has(no);
  };
  const batch = [];
  for (const o of rows) {
    if (batch.length >= 30) break;
    const sent = (o.meta && o.meta.sent) || {}, level = str(o.risk && o.risk.level);
    const ds = str(o.delivery_status).toLowerCase();
    const gone = o.status === 'cancelled' || o.inv_cancelled || /return|cancel|refus/.test(ds);
    // Lead: a real-looking order, while it is fresh
    if (!sent.lead && !sent.skipLead) {
      if (/risky|blocked/.test(level) || o.status === 'cancelled' || new Date(o.created_at) < fresh) await mark(ctx, o, 'skipLead');
      else batch.push({ o, key: 'lead', ev: await event('Lead', o, 'lead-' + o.no) });
      continue;
    }
    // Purchase: approved / delivered, never cancelled or returned
    if (!sent.purchase && !sent.skipPurchase) {
      if (gone) { await mark(ctx, o, 'skipPurchase'); continue; }
      const ready = S.when === 'approved' ? o.status === 'approved' : (o.status === 'approved' && (/deliver/.test(ds) || (o.invoice_no && await paidByCourier(o.invoice_no))));
      if (ready) batch.push({ o, key: 'purchase', ev: await event('Purchase', o, 'purchase-' + o.no) });
      continue;
    }
    // counted as a Purchase, then came back: the returner can be left out of audiences
    if (sent.purchase && !sent.returned && gone) batch.push({ o, key: 'returned', ev: await event('OrderReturned', o, 'returned-' + o.no) });
  }
  if (!batch.length) return out;
  try {
    await send(ctx, S, tok, batch.map((b) => b.ev));
    for (const b of batch) { await mark(ctx, b.o, b.key); out[b.key === 'lead' ? 'lead' : b.key === 'purchase' ? 'purchase' : 'returned']++; }
    await setConfig(ctx, 'pixel_last', JSON.stringify({ at: ctx.now.toISOString(), sent: batch.length, error: '' }));
  } catch (e) {
    out.errors++;
    await setConfig(ctx, 'pixel_last', JSON.stringify({ at: ctx.now.toISOString(), sent: 0, error: str(e && e.message || e).slice(0, 300) }));
  }
  return out;
}

export async function erpPixel(ctx) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).');
  const S = await settings(ctx), tok = await tokenOf(ctx);
  let last = {}; try { last = JSON.parse(str(await getConfig(ctx, 'pixel_last', '')) || '{}') || {}; } catch (_) { last = {}; }
  const c = (await ctx.tx`select count(*) filter (where coalesce(meta->'sent'->>'lead', '') <> '')::int as lead,
                                 count(*) filter (where coalesce(meta->'sent'->>'purchase', '') <> '')::int as purchase,
                                 count(*) filter (where coalesce(meta->'sent'->>'returned', '') <> '')::int as returned,
                                 count(*) filter (where coalesce(meta->'sent'->>'skipLead', '') <> '' or coalesce(meta->'sent'->>'skipPurchase', '') <> '')::int as kept_out
                          from chat_orders where business_id = ${ctx.biz} and created_at > now() - interval '30 days'`)[0];
  return { ...S, token: tok.from, last: { at: last.at ? formatDate(new Date(last.at), 'd MMM, h:mm a') : '', sent: num(last.sent), error: str(last.error) }, counts: c };
}
export async function erpPixelSet(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder sets the pixel.');
  const p = payload || {}, old = await settings(ctx);
  const pixel = p.pixel !== undefined ? str(p.pixel).replace(/[^0-9]/g, '') : old.pixel;
  if (p.pixel !== undefined && pixel && !/^\d{10,20}$/.test(pixel)) throw new Error('The pixel id is the long number in Events Manager (15-16 digits).');
  const S = { pixel, when: p.when === 'approved' ? 'approved' : p.when === 'delivered' ? 'delivered' : old.when, test: p.test !== undefined ? str(p.test).slice(0, 40) : old.test,
              browser: p.browser !== undefined ? !!p.browser : old.browser, on: p.on !== undefined ? !!p.on : old.on };
  await setConfig(ctx, 'pixel_settings', JSON.stringify(S));
  if (p.token !== undefined) await setSecret(ctx, 'META_CAPI_TOKEN', str(p.token));
  return erpPixel(ctx);
}
export async function erpPixelTest(ctx) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder sends a test.');
  const S = await settings(ctx), tok = await tokenOf(ctx);
  if (!S.pixel) throw new Error('Type the pixel id first.');
  if (!tok.token) throw new Error('Paste the Conversions API access token (or connect Facebook).');
  const o = { no: 'TEST-' + Date.now().toString(36), phone: '01700000000', name: 'test', items: [{ sku: 'TEST', qty: 1, price: 100 }], meta: {} };
  const r = await send(ctx, S, tok, [await event('Lead', o, 'test-' + o.no)]);
  return { ok: true, received: num(r.events_received), test: S.test, note: S.test ? 'Look in Events Manager → Test events.' : 'Sent as a real event - add a test event code to see it under Test events.' };
}

export const HANDLERS = { erpPixel, erpPixelSet, erpPixelTest };
