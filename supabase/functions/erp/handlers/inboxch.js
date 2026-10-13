// The Inbox's channels (120_inbox.sql): how a message is sent out on each, and how each one's webhook reads.
//
//   messenger, instagram   Meta Graph API (Send API, Generic template cards, quick replies, sender actions, comments)
//   wa_cloud               WhatsApp Cloud API - Meta's official WhatsApp
//   wa_evo                 WhatsApp as a linked device through the business's own Evolution API server - NOT official
//   wa_sender              WhatsApp as a linked device through WaSenderAPI (paid service) - NOT official
//   webchat                the chat bubble on the business's own website (messages wait here; the widget asks for them)
//
// Keys are business secrets named INBOX_<channel id>_<NAME>; they never leave the server. Everything goes through
// ctx.deps.fetch so the tests can stand in for every outside service.

import { getSecret, setSecret } from '../lib/ext.js';

const str = (v) => String(v == null ? '' : v).trim();
const GRAPH = 'https://graph.facebook.com/v21.0';
export const KINDS = ['messenger', 'instagram', 'wa_cloud', 'wa_evo', 'wa_sender', 'webchat'];
export const KIND_NAME = { messenger: 'Facebook Messenger', instagram: 'Instagram', wa_cloud: 'WhatsApp (official API)', wa_evo: 'WhatsApp (linked device, own server)',
                           wa_sender: 'WhatsApp (linked device, WaSenderAPI)', webchat: 'Website chat' };
// what each channel can draw (AiPraktor's limits: no cards on WhatsApp or the website chat; no 24-hour rule there)
export const CAN = {
  messenger: { cards: true, buttons: true, seen: true, typing: true, window24: true, followups: true, broadcast: true },
  instagram: { cards: true, buttons: true, seen: true, typing: false, window24: true, followups: false, broadcast: true },
  wa_cloud: { cards: false, buttons: true, seen: true, typing: true, window24: true, followups: true, broadcast: false },
  wa_evo: { cards: false, buttons: false, seen: true, typing: true, window24: false, followups: false, broadcast: false },
  wa_sender: { cards: false, buttons: false, seen: false, typing: false, window24: false, followups: false, broadcast: false },
  webchat: { cards: false, buttons: true, seen: true, typing: true, window24: false, followups: false, broadcast: false },
};

export async function chSecret(ctx, ch, name) { return str(await getSecret(ctx, 'INBOX_' + ch.id + '_' + name)); }
export async function chSecretSet(ctx, ch, name, value) { await setSecret(ctx, 'INBOX_' + ch.id + '_' + name, value === undefined ? '' : value); }

async function call(ctx, url, opts) {
  const f = ctx.deps.fetch || fetch;
  try {
    const res = await f(url, { method: opts.method || 'POST', headers: { 'content-type': 'application/json', ...(opts.headers || {}) },
                               body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch (_) { /* not json */ }
    return { code: res.status, ok: res.status >= 200 && res.status < 300, json: json || {}, text: text.slice(0, 400) };
  } catch (e) { return { code: 0, ok: false, json: {}, text: String((e && e.message) || e) }; }
}
function why(r) {
  const e = r.json && (r.json.error || r.json.message);
  return (e && (e.message || (typeof e === 'string' ? e : JSON.stringify(e)))) || r.text || ('HTTP ' + r.code);
}

/** Bytes of a file at a URL (a customer's photo or voice note), with the channel's headers when it needs them. */
export async function fetchBytes(ctx, url, headers) {
  const f = ctx.deps.fetch || fetch;
  const res = await f(url, { method: 'GET', headers: headers || {} });
  if (res.status < 200 || res.status >= 300) throw new Error('The file could not be fetched (' + res.status + ').');
  const mime = (res.headers && res.headers.get && res.headers.get('content-type')) || '';
  const buf = new Uint8Array(await res.arrayBuffer());
  return { bytes: buf, mime: mime.split(';')[0] };
}

function waTo(n) { return str(n).replace(/[^0-9]/g, ''); }
function numbered(text, buttons) {   // WhatsApp without buttons: the choice as a numbered list (as AiPraktor does)
  return (text ? text + '\n' : '') + buttons.map((b, i) => (i + 1) + '. ' + b.title).join('\n');
}

/**
 * Send one thing to a contact. msg: { kind: text|image|cards|buttons|seen|typing, text, url, caption, cards, buttons,
 * tag (Meta: HUMAN_AGENT after 24 h for a person's reply), replyTo (platform message id) }.
 * -> { ok, externalId, error }
 */
export async function sendOut(ctx, ch, contact, msg) {
  const to = contact.external_id;
  if (ch.kind === 'webchat') return { ok: true, externalId: '' };   // the widget picks it up from the table
  if (ch.kind === 'messenger' || ch.kind === 'instagram') {
    const token = await chSecret(ctx, ch, 'TOKEN');
    if (!token) return { ok: false, error: 'This channel has no page token yet.' };
    const url = GRAPH + '/me/messages?access_token=' + encodeURIComponent(token);
    const base = { recipient: { id: to } };
    if (msg.kind === 'seen' || msg.kind === 'typing') {
      if (msg.kind === 'typing' && ch.kind === 'instagram') return { ok: true };
      const r = await call(ctx, url, { body: { ...base, sender_action: msg.kind === 'seen' ? 'mark_seen' : 'typing_on' } });
      return { ok: r.ok, error: r.ok ? '' : why(r) };
    }
    const type = msg.tag ? { messaging_type: 'MESSAGE_TAG', tag: msg.tag } : { messaging_type: 'RESPONSE' };
    let message;
    if (msg.kind === 'image') message = { attachment: { type: 'image', payload: { url: msg.url, is_reusable: true } } };
    else if (msg.kind === 'cards') {
      message = { attachment: { type: 'template', payload: { template_type: 'generic', elements: (msg.cards || []).slice(0, 10).map((c) => ({
        title: str(c.title).slice(0, 80), subtitle: str(c.subtitle).slice(0, 80), image_url: c.image || undefined,
        buttons: (c.buttons || []).slice(0, 3).map((b) => (b.url ? { type: 'web_url', title: str(b.title).slice(0, 20), url: b.url } : { type: 'postback', title: str(b.title).slice(0, 20), payload: str(b.payload).slice(0, 1000) })),
      })) } } };
    } else if (msg.kind === 'buttons') {
      message = { text: str(msg.text).slice(0, 2000) || '…', quick_replies: (msg.buttons || []).slice(0, 13).map((b) => ({ content_type: 'text', title: str(b.title).slice(0, 20), payload: str(b.payload || b.title).slice(0, 1000) })) };
    } else message = { text: str(msg.text).slice(0, 2000) };
    const r = await call(ctx, url, { body: { ...base, ...type, message } });
    if (r.ok && msg.kind === 'image' && msg.caption) await sendOut(ctx, ch, contact, { kind: 'text', text: msg.caption, tag: msg.tag });
    return { ok: r.ok, externalId: str(r.json.message_id), error: r.ok ? '' : why(r) };
  }
  if (ch.kind === 'wa_cloud') {
    const token = await chSecret(ctx, ch, 'TOKEN');
    if (!token) return { ok: false, error: 'This channel has no WhatsApp access token yet.' };
    const url = GRAPH + '/' + encodeURIComponent(ch.external_id) + '/messages', headers = { Authorization: 'Bearer ' + token };
    if (msg.kind === 'seen' || msg.kind === 'typing') {
      if (!msg.replyTo) return { ok: true };
      const body = { messaging_product: 'whatsapp', status: 'read', message_id: msg.replyTo };
      if (msg.kind === 'typing') body.typing_indicator = { type: 'text' };
      const r = await call(ctx, url, { headers, body });
      return { ok: r.ok, error: r.ok ? '' : why(r) };
    }
    let body;
    if (msg.kind === 'image') body = { type: 'image', image: { link: msg.url, caption: str(msg.caption).slice(0, 1024) || undefined } };
    else if (msg.kind === 'buttons' && (msg.buttons || []).length) {
      const bs = msg.buttons.slice(0, 10);
      body = bs.length <= 3
        ? { type: 'interactive', interactive: { type: 'button', body: { text: str(msg.text).slice(0, 1024) || '…' }, action: { buttons: bs.map((b, i) => ({ type: 'reply', reply: { id: str(b.payload || b.title).slice(0, 256) || ('b' + i), title: str(b.title).slice(0, 20) } })) } } }
        : { type: 'interactive', interactive: { type: 'list', body: { text: str(msg.text).slice(0, 1024) || '…' }, action: { button: 'Choose', sections: [{ title: 'Options', rows: bs.map((b, i) => ({ id: str(b.payload || b.title).slice(0, 200) || ('r' + i), title: str(b.title).slice(0, 24) })) }] } } };
    } else body = { type: 'text', text: { body: str(msg.kind === 'buttons' ? numbered(msg.text, msg.buttons || []) : msg.text).slice(0, 4096) } };
    const r = await call(ctx, url, { headers, body: { messaging_product: 'whatsapp', to: waTo(to), ...body } });
    return { ok: r.ok, externalId: str(((r.json.messages || [])[0] || {}).id), error: r.ok ? '' : why(r) };
  }
  if (ch.kind === 'wa_evo') {
    const base = (await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key = await chSecret(ctx, ch, 'KEY'), inst = ch.external_id;
    if (!base || !key || !inst) return { ok: false, error: 'The Evolution API server is not set on this channel.' };
    const headers = { apikey: key }, number = waTo(to);
    if (msg.kind === 'seen') {
      if (!msg.replyTo) return { ok: true };
      const r = await call(ctx, base + '/chat/markMessageAsRead/' + encodeURIComponent(inst), { headers, body: { readMessages: [{ remoteJid: number + '@s.whatsapp.net', fromMe: false, id: msg.replyTo }] } });
      return { ok: r.ok };
    }
    if (msg.kind === 'typing') {
      const r = await call(ctx, base + '/chat/sendPresence/' + encodeURIComponent(inst), { headers, body: { number, delay: 1500, presence: 'composing' } });
      return { ok: r.ok };
    }
    let r;
    if (msg.kind === 'image') r = await call(ctx, base + '/message/sendMedia/' + encodeURIComponent(inst), { headers, body: { number, mediatype: 'image', media: msg.url, caption: str(msg.caption) } });
    else r = await call(ctx, base + '/message/sendText/' + encodeURIComponent(inst), { headers, body: { number, text: str(msg.kind === 'buttons' ? numbered(msg.text, msg.buttons || []) : msg.text) } });
    return { ok: r.ok, externalId: str(r.json.key && r.json.key.id), error: r.ok ? '' : why(r) };
  }
  if (ch.kind === 'wa_sender') {
    const key = await chSecret(ctx, ch, 'KEY');
    if (!key) return { ok: false, error: 'This channel has no WaSenderAPI key yet.' };
    if (msg.kind === 'seen' || msg.kind === 'typing') return { ok: true };
    const body = { to: '+' + waTo(to) };
    if (msg.kind === 'image') { body.imageUrl = msg.url; if (msg.caption) body.text = str(msg.caption); }
    else body.text = str(msg.kind === 'buttons' ? numbered(msg.text, msg.buttons || []) : msg.text);
    const r = await call(ctx, 'https://www.wasenderapi.com/api/send-message', { headers: { Authorization: 'Bearer ' + key }, body });
    return { ok: r.ok, externalId: str((r.json.data && (r.json.data.msgId || r.json.data.id)) || ''), error: r.ok ? '' : why(r) };
  }
  return { ok: false, error: 'Unknown channel.' };
}

// ------------------------------------------------------------------ comments (Facebook / Instagram posts)
export async function commentReply(ctx, ch, commentId, text, imageUrl) {
  const token = await chSecret(ctx, ch, 'TOKEN');
  if (!token) return { ok: false, error: 'No page token.' };
  const path = ch.kind === 'instagram' ? '/' + encodeURIComponent(commentId) + '/replies' : '/' + encodeURIComponent(commentId) + '/comments';
  const body = ch.kind === 'instagram' ? { message: text } : { message: text, ...(imageUrl ? { attachment_url: imageUrl } : {}) };
  const r = await call(ctx, GRAPH + path + '?access_token=' + encodeURIComponent(token), { body });
  return { ok: r.ok, error: r.ok ? '' : why(r) };
}
/** One private message to the person who commented (Meta's private reply). */
export async function commentPrivate(ctx, ch, commentId, text) {
  const token = await chSecret(ctx, ch, 'TOKEN');
  if (!token) return { ok: false, error: 'No page token.' };
  const r = await call(ctx, GRAPH + '/me/messages?access_token=' + encodeURIComponent(token), { body: { recipient: { comment_id: commentId }, message: { text } } });
  return { ok: r.ok, error: r.ok ? '' : why(r) };
}
export async function commentModerate(ctx, ch, commentId, action, fromId) {
  const token = await chSecret(ctx, ch, 'TOKEN');
  if (!token) return { ok: false, error: 'No page token.' };
  let r;
  if (action === 'hide') r = await call(ctx, GRAPH + '/' + encodeURIComponent(commentId) + '?access_token=' + encodeURIComponent(token), { body: ch.kind === 'instagram' ? { hide: true } : { is_hidden: true } });
  else if (action === 'unhide') r = await call(ctx, GRAPH + '/' + encodeURIComponent(commentId) + '?access_token=' + encodeURIComponent(token), { body: ch.kind === 'instagram' ? { hide: false } : { is_hidden: false } });
  else if (action === 'delete') r = await call(ctx, GRAPH + '/' + encodeURIComponent(commentId) + '?access_token=' + encodeURIComponent(token), { method: 'DELETE' });
  else if (action === 'block' && ch.kind === 'messenger') r = await call(ctx, GRAPH + '/' + encodeURIComponent(ch.external_id) + '/blocked?access_token=' + encodeURIComponent(token), { body: { user: [fromId] } });
  else return { ok: false, error: 'Not possible here.' };
  return { ok: r.ok, error: r.ok ? '' : why(r) };
}

// ------------------------------------------------------------------ webhooks
/** Meta's X-Hub-Signature-256: HMAC-SHA256 of the raw body with the app secret. */
export async function metaSignatureOk(appSecret, raw, header) {
  if (!appSecret) return true;            // no secret saved: the hook key in the address is the guard
  const m = /^sha256=([0-9a-f]{64})$/i.exec(str(header));
  if (!m) return false;
  const k = await crypto.subtle.importKey('raw', new TextEncoder().encode(appSecret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', k, new TextEncoder().encode(raw)));
  const hex = Array.from(sig).map((b) => b.toString(16).padStart(2, '0')).join('');
  let d = 0; for (let i = 0; i < 64; i++) d |= hex.charCodeAt(i) ^ m[1].toLowerCase().charCodeAt(i);
  return d === 0;
}

/**
 * A webhook body as a list of plain events:
 *   { type: 'message', from, name, id, text, media: {kind, url|id|base64, mime}, payload, echo, at }
 *   { type: 'comment', commentId, postId, from, name, text, parentId }
 */
export function readHook(kind, body) {
  const out = [];
  const b = body || {};
  if (kind === 'messenger' || kind === 'instagram') {
    for (const e of b.entry || []) {
      for (const m of e.messaging || []) {
        const echo = !!(m.message && m.message.is_echo);
        const from = str(echo ? (m.recipient && m.recipient.id) : (m.sender && m.sender.id));
        if (!from) continue;
        if (m.postback) { out.push({ type: 'message', from, id: str(m.postback.mid), text: str(m.postback.title), payload: str(m.postback.payload), at: m.timestamp }); continue; }
        if (m.read || m.delivery || m.reaction) continue;
        if (!m.message) continue;
        const msg = m.message, att = (msg.attachments || [])[0];
        const ev = { type: 'message', from, id: str(msg.mid), text: str(msg.text), echo, at: m.timestamp, payload: str(msg.quick_reply && msg.quick_reply.payload) };
        if (att && att.payload && att.payload.url) ev.media = { kind: att.type === 'audio' ? 'audio' : att.type === 'image' ? 'image' : att.type === 'video' ? 'video' : 'file', url: att.payload.url };
        out.push(ev);
      }
      for (const c of e.changes || []) {
        const v = c.value || {};
        if (c.field === 'feed' && v.item === 'comment' && v.verb === 'add') out.push({ type: 'comment', commentId: str(v.comment_id), postId: str(v.post_id), from: str(v.from && v.from.id), name: str(v.from && v.from.name), text: str(v.message), parentId: str(v.parent_id) });
        if (c.field === 'comments' && v.id) out.push({ type: 'comment', commentId: str(v.id), postId: str(v.media && v.media.id), from: str(v.from && v.from.id), name: str(v.from && v.from.username), text: str(v.text), parentId: str(v.parent_id) });
      }
    }
  } else if (kind === 'wa_cloud') {
    for (const e of b.entry || []) for (const c of e.changes || []) {
      const v = c.value || {}, names = {};
      for (const k of v.contacts || []) names[str(k.wa_id)] = str(k.profile && k.profile.name);
      for (const m of v.messages || []) {
        const ev = { type: 'message', from: str(m.from), name: names[str(m.from)] || '', id: str(m.id), text: '', at: Number(m.timestamp) * 1000 };
        if (m.type === 'text') ev.text = str(m.text && m.text.body);
        else if (m.type === 'image') { ev.media = { kind: 'image', id: str(m.image.id), mime: str(m.image.mime_type) }; ev.text = str(m.image.caption); }
        else if (m.type === 'audio') ev.media = { kind: 'audio', id: str(m.audio.id), mime: str(m.audio.mime_type) };
        else if (m.type === 'interactive') { const r = m.interactive.button_reply || m.interactive.list_reply || {}; ev.text = str(r.title); ev.payload = str(r.id); }
        else if (m.type === 'button') { ev.text = str(m.button && m.button.text); ev.payload = str(m.button && m.button.payload); }
        else ev.text = '[' + m.type + ']';
        out.push(ev);
      }
    }
  } else if (kind === 'wa_evo' || kind === 'wa_sender') {
    const ev0 = str(b.event).toLowerCase().replace(/_/g, '.');
    if (!/messages\.upsert|messages\.received|message/.test(ev0)) return out;
    let list = b.data && (b.data.messages || b.data);
    if (!Array.isArray(list)) list = list ? [list] : [];
    for (const d of list) {
      const key = d.key || {}, jid = str(key.remoteJid || key.remoteJidAlt);
      if (!jid || /@g\.us$|status@broadcast/.test(jid)) continue;      // no groups, no statuses
      const m = d.message || {};
      const ev = { type: 'message', from: jid.replace(/@.*$/, ''), name: str(d.pushName), id: str(key.id), echo: !!key.fromMe, text: '' };
      ev.text = str(m.conversation || (m.extendedTextMessage && m.extendedTextMessage.text) || (m.imageMessage && m.imageMessage.caption) || '');
      if (m.imageMessage) ev.media = { kind: 'image', base64: str(m.base64 || d.base64 || ''), mime: str(m.imageMessage.mimetype) || 'image/jpeg', url: str(m.imageMessage.url), raw: d };
      else if (m.audioMessage) ev.media = { kind: 'audio', base64: str(m.base64 || d.base64 || ''), mime: str(m.audioMessage.mimetype) || 'audio/ogg', url: str(m.audioMessage.url), raw: d };
      else if (!ev.text && (m.buttonsResponseMessage || m.listResponseMessage)) ev.text = str((m.buttonsResponseMessage && m.buttonsResponseMessage.selectedDisplayText) || (m.listResponseMessage && m.listResponseMessage.title));
      out.push(ev);
    }
  }
  return out;
}

/** The bytes of an incoming photo / voice note. */
export async function mediaBytes(ctx, ch, media) {
  if (media.base64) {
    const bin = atob(media.base64.replace(/^data:[^,]+,/, ''));
    const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return { bytes: u, mime: media.mime || 'application/octet-stream' };
  }
  if (ch.kind === 'wa_cloud' && media.id) {
    const token = await chSecret(ctx, ch, 'TOKEN');
    const r = await call(ctx, GRAPH + '/' + encodeURIComponent(media.id), { method: 'GET', headers: { Authorization: 'Bearer ' + token } });
    if (!r.ok || !r.json.url) throw new Error('WhatsApp did not give the file.');
    const f = await fetchBytes(ctx, r.json.url, { Authorization: 'Bearer ' + token });
    return { bytes: f.bytes, mime: media.mime || f.mime };
  }
  if (ch.kind === 'wa_evo' && media.raw) {
    const base = (await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key = await chSecret(ctx, ch, 'KEY');
    const r = await call(ctx, base + '/chat/getBase64FromMediaMessage/' + encodeURIComponent(ch.external_id), { headers: { apikey: key }, body: { message: media.raw } });
    if (r.ok && r.json.base64) return mediaBytes(ctx, ch, { base64: r.json.base64, mime: media.mime });
    throw new Error('The Evolution server did not give the file.');
  }
  if (ch.kind === 'wa_sender' && media.raw) {
    const key = await chSecret(ctx, ch, 'KEY');
    const r = await call(ctx, 'https://www.wasenderapi.com/api/decrypt-media', { headers: { Authorization: 'Bearer ' + key }, body: { data: { messages: media.raw } } });
    const url = str(r.json.publicUrl || (r.json.data && r.json.data.publicUrl));
    if (url) return fetchBytes(ctx, url);
    throw new Error('WaSenderAPI did not give the file.');
  }
  if (media.url) return fetchBytes(ctx, media.url);
  throw new Error('No file to read.');
}

/** Evolution: point the instance's webhook at this channel (messages only, with the files inside). */
export async function evoSetHook(ctx, ch, url) {
  const base = (await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key = await chSecret(ctx, ch, 'KEY');
  const r = await call(ctx, base + '/webhook/set/' + encodeURIComponent(ch.external_id), { headers: { apikey: key },
    body: { webhook: { enabled: true, url, webhookByEvents: false, webhookBase64: true, events: ['MESSAGES_UPSERT'] } } });
  return { ok: r.ok, error: r.ok ? '' : why(r) };
}
export async function evoState(ctx, ch) {
  const base = (await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key = await chSecret(ctx, ch, 'KEY');
  if (!base || !key) return { state: 'not set' };
  const r = await call(ctx, base + '/instance/connectionState/' + encodeURIComponent(ch.external_id), { method: 'GET', headers: { apikey: key } });
  if (!r.ok) return { state: 'unreachable', error: why(r) };
  return { state: str((r.json.instance && r.json.instance.state) || r.json.state) };
}
export async function evoQr(ctx, ch) {
  const base = (await chSecret(ctx, ch, 'URL')).replace(/\/+$/, ''), key = await chSecret(ctx, ch, 'KEY');
  const r = await call(ctx, base + '/instance/connect/' + encodeURIComponent(ch.external_id), { method: 'GET', headers: { apikey: key } });
  if (!r.ok) throw new Error('The server did not give a QR code: ' + why(r));
  let q = str(r.json.base64); if (q && q.indexOf('data:image') !== 0) q = 'data:image/png;base64,' + q;
  return q;
}
/** Meta: subscribe the page to this app's webhook fields. */
export async function metaSubscribe(ctx, ch) {
  const token = await chSecret(ctx, ch, 'TOKEN');
  if (!token) return { ok: false, error: 'No page token.' };
  if (ch.kind === 'instagram') return { ok: true };   // Instagram follows its Facebook page's subscription
  const r = await call(ctx, GRAPH + '/' + encodeURIComponent(ch.external_id) + '/subscribed_apps?access_token=' + encodeURIComponent(token),
    { body: { subscribed_fields: 'messages,messaging_postbacks,message_echoes,feed' } });
  return { ok: r.ok, error: r.ok ? '' : why(r) };
}
/** Meta: who a PSID is (name, picture) - only when the page allows it. */
export async function metaProfile(ctx, ch, id) {
  const token = await chSecret(ctx, ch, 'TOKEN');
  if (!token) return {};
  const fields = ch.kind === 'instagram' ? 'name,username,profile_pic' : 'first_name,last_name,profile_pic';
  const r = await call(ctx, GRAPH + '/' + encodeURIComponent(id) + '?fields=' + fields + '&access_token=' + encodeURIComponent(token), { method: 'GET' });
  if (!r.ok) return {};
  const j = r.json;
  return { name: str(j.name || [j.first_name, j.last_name].filter(Boolean).join(' ') || j.username), avatar: str(j.profile_pic) };
}
