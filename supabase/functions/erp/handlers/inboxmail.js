// The Inbox's e-mail channel (kind 'email', 134_inbox_email.sql; owner 20 Oct 2026). A mailbox - Gmail, Zoho, Yahoo or
// a domain mailbox - is read every minute (IMAP, read-only: the mail stays unread in the mailbox) and each new e-mail
// becomes a message in that sender's chat; a reply from the Inbox (a person or the AI) goes out as an e-mail answer in the
// same thread (Re: subject, In-Reply-To). Newsletters, automatic answers and bounces are left out and never answered.
// Only mail that arrives after the mailbox is connected comes in.
//
// The channel: external_id = the address; settings: imap_host, imap_port, smtp_host, smtp_port, user, from_name,
// uid_validity / uid_next (where reading got to), mail_checked, mail_error, mail_skipped; secret PASSWORD (an app password).

import { imapNew, imapCheck, smtpSend, smtpCheck, parseMail, cleanReply } from '../lib/mail.js';
import { chSecret } from './inboxch.js';

const str = (v) => String(v == null ? '' : v).trim();
export const MAIL_PRESETS = {
  gmail: { name: 'Gmail / Google Workspace', imap_host: 'imap.gmail.com', smtp_host: 'smtp.gmail.com' },
  zoho: { name: 'Zoho Mail', imap_host: 'imap.zoho.com', smtp_host: 'smtp.zoho.com' },
  yahoo: { name: 'Yahoo Mail', imap_host: 'imap.mail.yahoo.com', smtp_host: 'smtp.mail.yahoo.com' },
};

export async function mailCfg(ctx, ch) {
  const s = ch.settings || {};
  return { address: str(ch.external_id).toLowerCase(), user: str(s.user) || str(ch.external_id), pass: await chSecret(ctx, ch, 'PASSWORD'),
           imapHost: str(s.imap_host), imapPort: Number(s.imap_port) || 993, smtpHost: str(s.smtp_host), smtpPort: Number(s.smtp_port) || 465,
           fromName: str(s.from_name) };
}
async function setState(ctx, ch, patch) {
  await ctx.tx`update inbox_channels set settings = coalesce(settings, '{}'::jsonb) || ${ctx.tx.json(patch)} where id = ${ch.id}`;
  ch.settings = { ...(ch.settings || {}), ...patch };
}
const b64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 8192)); return btoa(s); };

/** Both doors work (reading and sending), and reading starts from now. -> { ok, error } */
export async function mailConnect(ctx, ch) {
  const cfg = await mailCfg(ctx, ch);
  if (!cfg.pass) return { ok: false, error: 'Type the app password.' };
  if (!cfg.imapHost || !cfg.smtpHost) return { ok: false, error: 'Choose the mail provider (or type its IMAP and SMTP servers).' };
  // reading and sending are tried apart, so a problem says which side it is on
  let r = null, readErr = '', sendErr = '';
  try { r = await imapCheck(ctx.deps, cfg); } catch (e) { readErr = str(e && e.message || e); }
  try { await smtpCheck(ctx.deps, cfg); } catch (e) { sendErr = str(e && e.message || e); }
  const msg = [readErr && 'Reading: ' + readErr, sendErr && 'Sending: ' + sendErr].filter(Boolean).join(' · ').slice(0, 400);
  const fresh = r && Number((ch.settings || {}).uid_validity) !== r.validity;
  await setState(ctx, ch, { ...(fresh ? { uid_validity: r.validity, uid_next: r.next } : {}), mail_checked: ctx.now.toISOString(), mail_error: msg });
  return { ok: !msg, error: msg };
}

/** New mail as Inbox events (the caller ingests them). -> { evs, skipped, more, error } */
export async function mailPoll(ctx, ch) {
  const cfg = await mailCfg(ctx, ch), st = ch.settings || {};
  if (!cfg.pass || !cfg.imapHost) return { evs: [], skipped: 0 };
  let r;
  try { r = await imapNew(ctx.deps, cfg, { validity: st.uid_validity, next: st.uid_next }, 10); }
  catch (e) {
    const msg = str(e && e.message || e).slice(0, 300);
    await setState(ctx, ch, { mail_checked: ctx.now.toISOString(), mail_error: msg });
    return { evs: [], skipped: 0, error: msg };
  }
  const evs = []; let skipped = 0;
  const code = str(st.test_code);
  for (const m of r.mails) {
    let p;
    try { p = parseMail(m.raw); } catch (_) { skipped++; continue; }
    const who = p.replyTo || p.from;
    if (p.bulk || !who.address || who.address === cfg.address || p.from.address === cfg.address) { skipped++; continue; }
    const body = cleanReply(p.text) || (m.headOnly ? '(A very big e-mail - open it in the mailbox to read it all.)' : '');
    const isReply = /^(re|aw|sv|fw|fwd)\s*:/i.test(p.subject);
    let text = ((p.subject && !isReply ? p.subject + '\n\n' : '') + body).trim();
    // practice mode: "test <code>" as the subject or the first line
    const first = str(body.split('\n')[0]);
    if (code && (new RegExp('^test\\s+' + code + '$', 'i').test(p.subject) || new RegExp('^test\\s+' + code + '$', 'i').test(first))) text = 'test ' + code;
    // the files: a picture is shown (and read by the AI); the others are named
    const files = p.attachments.filter((a) => !(a.inline && /^image\//.test(a.mime) && a.bytes.length < 15000));   // a signature's little logo
    const img = files.find((a) => /^image\/(png|jpe?g|webp|gif)$/.test(a.mime) && a.bytes.length <= 8e6);
    const others = files.filter((a) => a !== img);
    if (others.length) text += '\n\n' + others.map((a) => '📎 ' + str(a.filename)).join('\n');
    const ev = { type: 'message', from: who.address, name: who.name || p.from.name, id: p.messageId || ('mail:' + ch.id + ':' + r.validity + ':' + m.uid),
                 text: text.slice(0, 6000), email: { subject: p.subject, messageId: p.messageId, references: p.references } };
    if (img) ev.media = { kind: 'image', base64: b64(img.bytes), mime: img.mime };
    evs.push(ev);
  }
  await setState(ctx, ch, { uid_validity: r.validity, uid_next: r.next, mail_checked: ctx.now.toISOString(), mail_error: '',
                            mail_skipped: (Number(st.mail_skipped) || 0) + skipped });
  return { evs, skipped, more: !!r.more };
}

/** The text of anything the Inbox sends, as an e-mail can carry it (no buttons or cards in a plain e-mail). */
export function mailText(msg) {
  if (msg.kind === 'image') return [str(msg.caption), str(msg.url)].filter(Boolean).join('\n\n');
  if (msg.kind === 'buttons') return (str(msg.text) ? str(msg.text) + '\n\n' : '') + (msg.buttons || []).map((b, i) => (i + 1) + '. ' + str(b.title)).join('\n') + '\n\n(Reply with the number.)';
  if (msg.kind === 'cards') return (msg.cards || []).map((c) => '• ' + str(c.title) + (c.subtitle ? ' - ' + str(c.subtitle) : '') + (c.url ? '\n  ' + str(c.url) : '') +
    (c.buttons || []).filter((b) => b.url).map((b) => '\n  ' + str(b.title) + ': ' + str(b.url)).join('')).join('\n\n');
  return str(msg.text);
}
/** Send one reply in the e-mail thread of this contact. -> { ok, externalId, error } */
export async function mailSendOut(ctx, ch, contact, msg) {
  if (msg.kind === 'seen' || msg.kind === 'typing') return { ok: true };
  const text = mailText(msg);
  if (!text) return { ok: true };
  const cfg = await mailCfg(ctx, ch);
  if (!cfg.pass) return { ok: false, error: 'The mailbox has no password saved.' };
  // the thread: the newest e-mail from this person
  const last = (await ctx.tx`select m.payload from inbox_messages m join inbox_conversations v on v.id = m.conversation_id
                             where v.contact_id = ${contact.id} and m.direction = 'in' and m.payload ? 'email' order by m.id desc limit 1`)[0];
  const t = (last && last.payload && last.payload.email) || {};
  const subject = t.subject ? (/^re\s*:/i.test(t.subject) ? t.subject : 'Re: ' + t.subject) : 'Message from ' + (cfg.fromName || str(ctx.s && ctx.s.businessName) || 'us');
  try {
    const r = await smtpSend(ctx.deps, cfg, { to: contact.external_id, toName: contact.name, subject, text, inReplyTo: t.messageId || '', references: t.references || '' });
    return { ok: true, externalId: r.messageId };
  } catch (e) { return { ok: false, error: str(e && e.message || e).slice(0, 300) }; }
}
