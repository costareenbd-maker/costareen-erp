// multi-wa-1 (owner 6 Nov 2026): several WhatsApp numbers, each with one job - "one only sends PDFs, one only collects
// data, one is for normal talk and customer support". Lives at the top of Inbox > Chat settings.
//
//   erpWaNumbers()                         every WhatsApp number of the business, its job, whether its phone is linked
//   erpWaNumberAdd({name, purpose, acceptRisk})   makes a new number on the business's own Evolution server, points its
//                                          webhook at the ERP and hands back the QR code to scan
//   erpWaNumberSet({id, name, purpose})    rename / change the job
//   erpWaNumberRemove({id})                takes it out of the Inbox (an instance the ERP made is logged out and deleted)
//
// The server's address and its main key are business secrets WA_SERVER_URL / WA_SERVER_KEY (set on the server, never
// read back). Each number keeps its own instance token as the channel's KEY. Jobs:
//   chat     the AI answers (when the AI is on), the team is alerted
//   send     for sending (bills, PDFs): what comes in is kept, nobody is answered, no alerts
//   collect  for collecting data: what comes in is kept, nobody is answered, no alerts

import { getSecret } from '../lib/ext.js';
import { formatDate } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { needFeat, KIND_FEATURE } from '../lib/inboxplan.js';
import { chSecret, chSecretSet, evoSetHook, evoState, evoQr } from './inboxch.js';

const str = (v) => String(v == null ? '' : v).trim();
export const PURPOSES = {
  chat: { name: 'Customer chat', help: 'The AI answers (when it is on) and the team gets alerts' },
  send: { name: 'Sending only', help: 'Bills and PDFs go out from it; messages that come in are kept, nobody is answered' },
  collect: { name: 'Collect data', help: 'Messages are kept for the records; nobody is answered, no alerts' },
};
export function purposeOf(ch) { const p = str(ch && ch.settings && ch.settings.purpose); return PURPOSES[p] ? p : 'chat'; }

function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role)) throw new Error(role === 'manager' ? 'Only a manager or the owner sees the WhatsApp numbers.' : 'Only the owner or a shareholder changes the WhatsApp numbers.'); }
function hookUrl(ctx, ch) {
  const base = str(ctx.deps && ctx.deps.hookBase);
  return base ? base + (base.includes('?') ? '&' : '?') + 'inbox=hook&ch=' + ch.id + '&k=' + ch.hook_key : '';
}
async function server(ctx) {
  return { url: str(await getSecret(ctx, 'WA_SERVER_URL')).replace(/\/+$/, ''), key: str(await getSecret(ctx, 'WA_SERVER_KEY')) };
}
async function call(ctx, url, opts) {
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  try {
    const res = await f(url, { method: opts.method || 'POST', headers: { 'content-type': 'application/json', ...(opts.headers || {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text(); let json = {}; try { json = JSON.parse(text) || {}; } catch (_) { json = {}; }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, json, text: text.slice(0, 300) };
  } catch (e) { return { ok: false, status: 0, json: {}, text: String((e && e.message) || e) }; }
}
async function chOf(ctx, id) { return (await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and id = ${id} and status <> 'removed'`)[0] || null; }

/** Every WhatsApp number of this business. The linked phone's number is learnt from the server and kept. */
export async function erpWaNumbers(ctx) {
  need(ctx, 'manager');
  const srv = await server(ctx);
  const rows = await ctx.tx`select * from inbox_channels where business_id = ${ctx.biz} and kind in ('wa_evo', 'wa_cloud', 'wa_sender') and status <> 'removed' order by created_at`;
  const list = [];
  for (const ch of rows) {
    let state = ch.kind === 'wa_evo' ? str((await evoState(ctx, ch)).state) : 'open';
    let number = str(ch.settings && ch.settings.number);
    if (ch.kind === 'wa_evo' && state === 'open' && !number && srv.url && srv.key) {
      const r = await call(ctx, srv.url + '/instance/fetchInstances?instanceName=' + encodeURIComponent(ch.external_id), { method: 'GET', headers: { apikey: srv.key } });
      const one = Array.isArray(r.json) ? r.json[0] : r.json;
      number = str(one && (one.ownerJid || one.owner)).replace(/@.*$/, '');
      if (number) await ctx.tx`update inbox_channels set settings = coalesce(settings, '{}'::jsonb) || ${ctx.tx.json({ number })} where id = ${ch.id}`;
    }
    list.push({ id: ch.id, name: ch.name, kind: ch.kind, purpose: purposeOf(ch), aiOn: !!ch.ai_on, status: ch.status,
      state, linked: state === 'open', number: number ? '+' + number.replace(/^\+/, '') : '', madeHere: !!(ch.settings && ch.settings.erp_made),
      since: formatDate(new Date(ch.created_at), 'd MMM yyyy') });
  }
  return { numbers: list, serverReady: !!(srv.url && srv.key), purposes: Object.keys(PURPOSES).map((k) => ({ key: k, ...PURPOSES[k] })) };
}

/** A new number: a new instance on the business's Evolution server, its webhook, and the QR code to scan. */
export async function erpWaNumberAdd(ctx, payload) {
  need(ctx, 'shareholder');
  const p = payload || {};
  await needFeat(ctx, KIND_FEATURE.wa_evo);
  if (!p.acceptRisk) throw new Error('Read and accept the notice first: a linked-device WhatsApp is not Meta\'s official system and the number can be banned.');
  const name = str(p.name).replace(/[\r\n]/g, ' ').slice(0, 40);
  if (!name) throw new Error('Give the number a name, e.g. "Bills" or "Support".');
  const purpose = PURPOSES[str(p.purpose)] ? str(p.purpose) : 'chat';
  const srv = await server(ctx);
  if (!srv.url || !srv.key) throw new Error('The WhatsApp server is not set up for this business yet.');
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'wa';
  const inst = 'erp-' + slug + '-' + globalThis.crypto.randomUUID().replace(/-/g, '').slice(0, 6);
  const r = await call(ctx, srv.url + '/instance/create', { headers: { apikey: srv.key }, body: { instanceName: inst, integration: 'WHATSAPP-BAILEYS', qrcode: true } });
  if (!r.ok) throw new Error('The WhatsApp server did not make the number (' + (r.status || 'no answer') + '). Try again in a minute.');
  const token = str(typeof r.json.hash === 'string' ? r.json.hash : r.json.hash && (r.json.hash.apikey || r.json.hash.token)) || str(r.json.token);
  const settings = { wait_s: 15, revert_min: 60, test_code: String(Math.floor(10000 + Math.random() * 90000)), purpose, erp_made: true };
  const ch = (await ctx.tx`insert into inbox_channels (business_id, kind, name, external_id, status, ai_on, settings, created_by)
                           values (${ctx.biz}, 'wa_evo', ${name}, ${inst}, 'live', ${purpose === 'chat'}, ${ctx.tx.json(settings)}, ${ctx.s.name}) returning *`)[0];
  await chSecretSet(ctx, ch, 'URL', srv.url);
  await chSecretSet(ctx, ch, 'KEY', token || srv.key);
  const hook = hookUrl(ctx, ch);
  const h = hook ? await evoSetHook(ctx, ch, hook) : { ok: false };
  let qr = '';
  const q0 = str(r.json.qrcode && (r.json.qrcode.base64 || r.json.qrcode.code));
  if (/^data:image/.test(q0)) qr = q0; else if (q0 && /^[A-Za-z0-9+/=]+$/.test(q0)) qr = 'data:image/png;base64,' + q0;
  if (!qr) { try { qr = await evoQr(ctx, ch); } catch (_) { qr = ''; } }
  return { id: ch.id, qr, hooked: !!h.ok, ...(await erpWaNumbers(ctx)) };
}

/** Rename a number or change its job. */
export async function erpWaNumberSet(ctx, payload) {
  need(ctx, 'shareholder');
  const p = payload || {}, ch = await chOf(ctx, str(p.id));
  if (!ch || !/^wa_/.test(ch.kind)) throw new Error('No such WhatsApp number.');
  if (p.name !== undefined) { const n = str(p.name).replace(/[\r\n]/g, ' ').slice(0, 40); if (!n) throw new Error('A number needs a name.'); await ctx.tx`update inbox_channels set name = ${n} where id = ${ch.id}`; }
  if (p.purpose !== undefined) {
    if (!PURPOSES[str(p.purpose)]) throw new Error('Choose what the number is for.');
    await ctx.tx`update inbox_channels set settings = coalesce(settings, '{}'::jsonb) || ${ctx.tx.json({ purpose: str(p.purpose) })}, ai_on = ${str(p.purpose) === 'chat' ? ch.ai_on : false} where id = ${ch.id}`;
  }
  return erpWaNumbers(ctx);
}

/** Out of the Inbox. A number the ERP made itself is also logged out and deleted on the server; others are left alone. */
export async function erpWaNumberRemove(ctx, payload) {
  need(ctx, 'shareholder');
  const ch = await chOf(ctx, str(payload && payload.id));
  if (!ch || !/^wa_/.test(ch.kind)) throw new Error('No such WhatsApp number.');
  if (ch.kind === 'wa_evo' && ch.settings && ch.settings.erp_made) {
    const srv = await server(ctx);
    if (srv.url && srv.key) {
      await call(ctx, srv.url + '/instance/logout/' + encodeURIComponent(ch.external_id), { method: 'DELETE', headers: { apikey: srv.key } });
      await call(ctx, srv.url + '/instance/delete/' + encodeURIComponent(ch.external_id), { method: 'DELETE', headers: { apikey: srv.key } });
    }
  }
  await ctx.tx`update inbox_channels set status = 'removed' where id = ${ch.id}`;
  for (const k of ['URL', 'KEY', 'HOOK_SECRET', 'TOKEN', 'APP_SECRET', 'VERIFY']) await chSecretSet(ctx, ch, k, '');
  return erpWaNumbers(ctx);
}

export const HANDLERS = { erpWaNumbers, erpWaNumberAdd, erpWaNumberSet, erpWaNumberRemove };
