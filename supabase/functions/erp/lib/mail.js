// E-mail for the Inbox (owner 20 Oct 2026: "connect the email"). No outside service: the edge function speaks the
// mail protocols itself over TLS - IMAP (port 993) to read new mail, SMTP (port 465, SSL) to send the reply.
// Works with Gmail / Google Workspace (an app password), Zoho Mail, Yahoo and a hosting company's mailbox (cPanel).
// Supabase's servers block ports 25 and 587, so sending is SMTP over SSL on 465 only.
//
//   imapNew(deps, cfg, state, max)   -> { validity, next, mails: [{ uid, size, raw }] }   new mail since state.next
//   imapCheck(deps, cfg)             -> { validity, next }                               (login works)
//   smtpSend(deps, cfg, mail)        -> { messageId }
//   smtpCheck(deps, cfg)             -> true                                             (login works)
//   parseMail(bytes)                 -> { from, to, subject, messageId, inReplyTo, references, text, html, attachments, bulk }
//   cleanReply(text)                 -> the new part of a reply (quoted history and "On ... wrote:" cut off)
//
// deps.tcp(host, port) opens a TLS connection: { read(Uint8Array) -> n | null, write(Uint8Array) -> n, close() }
// (index.ts: Deno.connectTls). The tests give a scripted server instead.

const str = (v) => String(v == null ? '' : v).trim();
const enc = new TextEncoder();
const TIMEOUT_MS = 20000;

// ------------------------------------------------------------------ the wire
class Wire {
  constructor(conn) { this.c = conn; this.buf = new Uint8Array(65536); this.len = 0; this.pos = 0; }
  async fill() {
    if (this.pos > 0 && this.pos === this.len) { this.pos = 0; this.len = 0; }
    if (this.len === this.buf.length) {   // grow (a big mail arrives as one literal)
      const b = new Uint8Array(this.buf.length * 2); b.set(this.buf.subarray(0, this.len)); this.buf = b;
    }
    let timer;
    const n = await Promise.race([this.c.read(this.buf.subarray(this.len)),
      new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('The mail server took too long to answer.')), TIMEOUT_MS); })]).finally(() => clearTimeout(timer));
    if (n === null) throw new Error('The mail server closed the connection.');
    this.len += n;
  }
  async line() {
    for (;;) {
      for (let i = this.pos; i + 1 < this.len; i++) {
        if (this.buf[i] === 13 && this.buf[i + 1] === 10) {
          const l = latin1(this.buf.subarray(this.pos, i)); this.pos = i + 2; return l;
        }
      }
      if (this.pos > 0) { this.buf.copyWithin(0, this.pos, this.len); this.len -= this.pos; this.pos = 0; }
      await this.fill();
    }
  }
  async bytes(n) {
    while (this.len - this.pos < n) {
      if (this.pos > 0) { this.buf.copyWithin(0, this.pos, this.len); this.len -= this.pos; this.pos = 0; }
      if (this.buf.length < n) { const b = new Uint8Array(n + 65536); b.set(this.buf.subarray(0, this.len)); this.buf = b; }
      await this.fill();
    }
    const out = this.buf.slice(this.pos, this.pos + n); this.pos += n; return out;
  }
  async send(s) {
    const data = typeof s === 'string' ? enc.encode(s) : s;
    let off = 0;
    while (off < data.length) off += await this.c.write(data.subarray(off));
  }
  close() { try { this.c.close(); } catch (_) { /* gone */ } }
}
function latin1(b) { let s = ''; for (let i = 0; i < b.length; i += 8192) s += String.fromCharCode.apply(null, b.subarray(i, i + 8192)); return s; }
function fromLatin1(s) { const u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i) & 255; return u; }
async function open(deps, host, port) {
  if (!deps || typeof deps.tcp !== 'function') throw new Error('This server cannot open mail connections.');
  const h = str(host), p = Number(port);
  if (!/^[a-z0-9.-]+$/i.test(h) || !(p > 0 && p < 65536)) throw new Error('The mail server address is not right.');
  try { return new Wire(await deps.tcp(h, p)); }
  catch (e) { throw new Error('Could not reach ' + h + ':' + p + ' (' + str(e && e.message || e).slice(0, 120) + ').'); }
}

// ------------------------------------------------------------------ IMAP
const q = (s) => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
class Imap {
  constructor(w) { this.w = w; this.n = 0; }
  async greet() { const l = await this.w.line(); if (!/^\* (OK|PREAUTH)/i.test(l)) throw new Error('The mail server did not greet: ' + l.slice(0, 120)); }
  /** One tagged command -> { lines, lits }: an untagged line with a literal {n} carries "\u0000<index>\u0000" where its bytes were. */
  async cmd(text, quiet) {
    const tag = 'A' + (++this.n);
    await this.w.send(tag + ' ' + text + '\r\n');
    const lines = [], lits = [];
    for (;;) {
      let l = await this.w.line(), m;
      while ((m = /\{(\d+)\}$/.exec(l))) { lits.push(await this.w.bytes(Number(m[1]))); l = l.slice(0, m.index) + '\u0000' + (lits.length - 1) + '\u0000' + await this.w.line(); }
      if (l.startsWith(tag + ' ')) {
        if (/^\S+ OK/i.test(l)) return { lines, lits };
        const why = l.slice(tag.length + 1).replace(/^(NO|BAD)\s*/i, '');
        throw new Error(quiet || ('The mail server said: ' + why.slice(0, 160)));
      }
      lines.push(l);
    }
  }
}
async function imapOpen(deps, cfg) {
  const w = await open(deps, cfg.imapHost, cfg.imapPort || 993);
  const s = new Imap(w);
  try {
    await s.greet();
    try { await s.cmd('LOGIN ' + q(cfg.user) + ' ' + q(cfg.pass)); }
    catch (e) {
      const m = String(e.message || '');
      throw new Error(/application-specific|app password|webloginrequired|\[ALERT\]/i.test(m) || /gmail/i.test(cfg.imapHost)
        ? 'The mailbox refused the login. For Gmail use an app password (Google Account → Security → 2-Step Verification → App passwords), not your normal password. (' + m.replace(/^The mail server said: /, '').slice(0, 100) + ')'
        : 'The mailbox refused the login: check the address and password. (' + m.replace(/^The mail server said: /, '').slice(0, 100) + ')');
    }
    const sel = await s.cmd('EXAMINE INBOX');   // read-only: the mail stays unread in the mailbox
    const num = (re) => { for (const l of sel.lines) { const m = re.exec(l); if (m) return Number(m[1]); } return 0; };
    s.validity = num(/\[UIDVALIDITY (\d+)\]/i); s.next = num(/\[UIDNEXT (\d+)\]/i);
    if (!s.next) {   // a server that does not say UIDNEXT: the highest UID + 1
      const r = await s.cmd('UID SEARCH ALL');
      const all = ((r.lines.find((l) => /^\* SEARCH/i.test(l)) || '').match(/\d+/g) || []).map(Number);
      s.next = all.length ? Math.max(...all) + 1 : 1;
    }
    return s;
  } catch (e) { w.close(); throw e; }
}
async function imapClose(s) { try { await s.cmd('LOGOUT'); } catch (_) { /* fine */ } s.w.close(); }

export async function imapCheck(deps, cfg) {
  const s = await imapOpen(deps, cfg);
  const out = { validity: s.validity, next: s.next };
  await imapClose(s);
  return out;
}
/** New mail since state.next (at most max, smallest first). state = { validity, next } from the last look. */
export async function imapNew(deps, cfg, state, max) {
  const s = await imapOpen(deps, cfg);
  try {
    const out = { validity: s.validity, next: s.next, mails: [] };
    const from = Number(state && state.next) || 0;
    if (!from || Number(state.validity) !== s.validity || s.next <= from) return out;   // first look, a rebuilt mailbox, or nothing new
    const r = await s.cmd('UID SEARCH UID ' + from + ':*');
    const uids = ((r.lines.find((l) => /^\* SEARCH/i.test(l)) || '').replace(/^\* SEARCH/i, '').match(/\d+/g) || []).map(Number)
      .filter((u) => u >= from).sort((a, b) => a - b).slice(0, max || 10);
    if (!uids.length) return out;
    const sizes = {};
    const sz = await s.cmd('UID FETCH ' + uids.join(',') + ' (UID RFC822.SIZE)');
    for (const l of sz.lines) { const u = /UID (\d+)/i.exec(l), z = /RFC822\.SIZE (\d+)/i.exec(l); if (u && z) sizes[u[1]] = Number(z[1]); }
    for (const uid of uids) {
      const size = sizes[uid] || 0;
      // a very big mail (big attachments): only its head - the text is shown with a note
      const what = size > 15e6 ? 'BODY.PEEK[HEADER]' : 'BODY.PEEK[]';
      const f = await s.cmd('UID FETCH ' + uid + ' (UID ' + what + ')');
      const line = f.lines.find((l) => /FETCH/i.test(l) && /\u0000\d+\u0000/.test(l));
      const li = line ? Number(/\u0000(\d+)\u0000/.exec(line)[1]) : -1;
      out.mails.push({ uid, size, raw: li >= 0 ? f.lits[li] : new Uint8Array(0), headOnly: what !== 'BODY.PEEK[]' });
    }
    out.next = Math.max(...uids) + 1;
    out.more = uids.length >= (max || 10);
    return out;
  } finally { await imapClose(s); }
}

// ------------------------------------------------------------------ SMTP (SSL on 465)
async function smtpReply(w) {
  let l, code = 0; const text = [];
  do { l = await w.line(); code = Number(l.slice(0, 3)); text.push(l.slice(4)); } while (l[3] === '-');
  return { code, text: text.join(' ') };
}
function want(r, ok, what) { if (!ok.includes(r.code)) throw new Error((what || 'The mail server') + ' said: ' + r.code + ' ' + r.text.slice(0, 160)); return r; }
async function smtpOpen(deps, cfg) {
  if (Number(cfg.smtpPort || 465) !== 465) throw new Error('Sending works on port 465 (SSL) only: this server\'s network blocks 25 and 587.');
  const w = await open(deps, cfg.smtpHost, 465);
  try {
    want(await smtpReply(w), [220]);
    await w.send('EHLO erp.local\r\n'); want(await smtpReply(w), [250]);
    await w.send('AUTH PLAIN ' + b64(enc.encode('\u0000' + cfg.user + '\u0000' + cfg.pass)) + '\r\n');
    const a = await smtpReply(w);
    if (a.code !== 235) throw new Error(/gmail|google/i.test(cfg.smtpHost) ? 'Gmail refused the login: use an app password, not your normal password. (' + a.code + ' ' + a.text.slice(0, 80) + ')' : 'The mail server refused the login: ' + a.code + ' ' + a.text.slice(0, 120));
    return w;
  } catch (e) { w.close(); throw e; }
}
async function smtpClose(w) { try { await w.send('QUIT\r\n'); await smtpReply(w); } catch (_) { /* fine */ } w.close(); }
export async function smtpCheck(deps, cfg) { const w = await smtpOpen(deps, cfg); await smtpClose(w); return true; }

/** mail = { to, toName, subject, text, inReplyTo, references } -> { messageId } */
export async function smtpSend(deps, cfg, mail) {
  const to = str(mail.to).toLowerCase();
  if (!/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(to)) throw new Error('No e-mail address to send to.');
  const from = str(cfg.address).toLowerCase(), domain = from.split('@')[1] || 'erp.local';
  const messageId = '<' + crypto.randomUUID() + '@' + domain + '>';
  const head = [
    'From: ' + addrHeader(cfg.fromName, from),
    'To: ' + addrHeader(mail.toName, to),
    'Subject: ' + word(str(mail.subject) || '(no subject)'),
    'Date: ' + new Date().toUTCString().replace('GMT', '+0000'),
    'Message-ID: ' + messageId,
  ];
  if (mail.inReplyTo) head.push('In-Reply-To: ' + mail.inReplyTo);
  if (mail.references || mail.inReplyTo) head.push('References: ' + str([mail.references, mail.inReplyTo].filter(Boolean).join(' ')).slice(-900));
  head.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: base64');
  const body = b64(enc.encode(str(mail.text).replace(/\r?\n/g, '\r\n'))).replace(/.{1,76}/g, '$&\r\n');
  const w = await smtpOpen(deps, cfg);
  try {
    await w.send('MAIL FROM:<' + from + '>\r\n'); want(await smtpReply(w), [250], 'The mail server (sender)');
    await w.send('RCPT TO:<' + to + '>\r\n'); want(await smtpReply(w), [250, 251], 'The mail server (receiver)');
    await w.send('DATA\r\n'); want(await smtpReply(w), [354]);
    await w.send(head.join('\r\n') + '\r\n\r\n' + body + '.\r\n');   // base64 lines never start with "."
    want(await smtpReply(w), [250], 'The mail server (message)');
  } finally { await smtpClose(w); }
  return { messageId };
}
function b64(bytes) { return btoa(latin1(bytes)); }
/** A header value: plain ASCII as it is, anything else as UTF-8 encoded words (each under 75 characters). */
function word(s) {
  if (/^[\x20-\x7e]*$/.test(s)) return s;
  const out = []; let cur = '';
  for (const ch of Array.from(s)) {
    if (enc.encode(cur + ch).length > 42) { out.push(cur); cur = ''; }
    cur += ch;
  }
  if (cur) out.push(cur);
  return out.map((c) => '=?UTF-8?B?' + b64(enc.encode(c)) + '?=').join('\r\n ');
}
function addrHeader(name, addr) { const n = str(name).replace(/["\r\n]/g, ''); return n ? (/^[\x20-\x7e]*$/.test(n) ? '"' + n + '"' : word(n)) + ' <' + addr + '>' : '<' + addr + '>'; }

// ------------------------------------------------------------------ reading a mail
function decodeBytes(bytes, charset) {
  const cs = str(charset).toLowerCase() || 'utf-8';
  try { return new TextDecoder(cs === 'us-ascii' ? 'utf-8' : cs).decode(bytes); } catch (_) { return new TextDecoder('utf-8').decode(bytes); }
}
function qpBytes(s) {
  s = s.replace(/=\r?\n/g, '');
  const out = [];
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { out.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
    else out.push(s.charCodeAt(i) & 255);
  }
  return new Uint8Array(out);
}
function b64Bytes(s) { try { return fromLatin1(atob(s.replace(/[^A-Za-z0-9+/=]/g, ''))); } catch (_) { return new Uint8Array(0); } }
/** =?charset?B|Q?...?= words in a header. */
export function decodeWords(s) {
  return String(s || '').replace(/(=\?[^?]+\?[BbQq]\?[^?]*\?=)\s+(?==\?)/g, '$1').replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_, cs, e, t) =>
    decodeBytes(/b/i.test(e) ? b64Bytes(t) : qpBytes(t.replace(/_/g, ' ')), cs.replace(/\*.*$/, '')));
}
function headers(text) {
  const h = {};
  for (const l of text.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = l.indexOf(':'); if (i <= 0) continue;
    const k = l.slice(0, i).trim().toLowerCase(); if (!(k in h)) h[k] = l.slice(i + 1).trim();
  }
  return h;
}
function param(v, name) {
  const s = String(v || '');
  const star = new RegExp(name + '\\*0?\\*?=([^;]+)', 'i').exec(s);   // RFC 2231: filename*=utf-8''Bill%20.pdf
  if (star) { const m = /^([^']*)'[^']*'(.*)$/.exec(star[1].replace(/^"|"$/g, '')); if (m) { try { return decodeBytes(fromLatin1(unescape(m[2])), m[1]); } catch (_) { return m[2]; } } }
  const m = new RegExp('(?:^|;)\\s*' + name + '\\s*=\\s*("([^"]*)"|[^;\\s]+)', 'i').exec(s);
  return m ? decodeWords(m[2] !== undefined ? m[2] : m[1]) : '';
}
function address(v) {
  const s = decodeWords(v);
  const m = /^(.*?)<\s*([^>\s]+@[^>\s]+)\s*>/.exec(s);
  if (m) return { name: m[1].replace(/^[\s"']+|[\s"']+$/g, ''), address: m[2].toLowerCase() };
  const a = /([^\s<>"]+@[^\s<>"]+)/.exec(s);
  return { name: '', address: a ? a[1].toLowerCase() : '' };
}
export function htmlText(h) {
  return String(h || '').replace(/<(style|script|head)[\s\S]*?<\/\1>/gi, '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|tr|li|h\d|blockquote)>/gi, '\n')
    .replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}
/** A raw mail (bytes) -> what the Inbox needs. */
export function parseMail(bytes) {
  const all = latin1(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes || []));
  const out = { text: '', html: '', attachments: [] };
  const walk = (s, depth) => {
    const cut = s.search(/\r?\n\r?\n/);
    const headText = cut < 0 ? s : s.slice(0, cut), body = cut < 0 ? '' : s.slice(cut).replace(/^\r?\n\r?\n/, '');
    const h = headers(decodeBytes(fromLatin1(headText), 'utf-8'));
    const ct = h['content-type'] || 'text/plain', type = ct.split(';')[0].trim().toLowerCase();
    const cte = str(h['content-transfer-encoding']).toLowerCase(), disp = str(h['content-disposition']).toLowerCase();
    if (depth === 0) out.h = h;
    if (/^multipart\//.test(type) && depth < 8) {
      const b = param(ct, 'boundary'); if (!b) return;
      const parts = body.split(new RegExp('\\r?\\n?--' + b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(?:--)?[ \\t]*\\r?\\n?'));
      for (const p of parts.slice(1)) if (p.trim()) walk(p, depth + 1);
      return;
    }
    const raw = cte === 'base64' ? b64Bytes(body) : cte === 'quoted-printable' ? qpBytes(body) : fromLatin1(body);
    const filename = param(h['content-disposition'], 'filename') || param(ct, 'name');
    if (/^text\/(plain|html)$/.test(type) && !/^attachment/.test(disp) && !filename) {
      const t = decodeBytes(raw, param(ct, 'charset'));
      if (type === 'text/plain' && !out.text) out.text = t; else if (type === 'text/html' && !out.html) out.html = t;
      return;
    }
    if (depth > 0 || filename) out.attachments.push({ filename: filename || (type.replace('/', '.')), mime: type, bytes: raw, inline: /^inline/.test(disp) });
  };
  walk(all, 0);
  const h = out.h || {};
  const from = address(h.from || ''), replyTo = address(h['reply-to'] || '');
  const refs = (str(h.references).match(/<[^>]+>/g) || []).join(' ');
  return {
    from, replyTo: replyTo.address ? replyTo : null, to: address(h.to || ''), subject: decodeWords(h.subject || '').replace(/\s+/g, ' ').trim(),
    messageId: (str(h['message-id']).match(/<[^>]+>/) || [''])[0], inReplyTo: (str(h['in-reply-to']).match(/<[^>]+>/) || [''])[0], references: refs,
    date: str(h.date), text: out.text || htmlText(out.html), html: out.html, attachments: out.attachments,
    // a newsletter, an automatic answer or a bounce: kept out of the Inbox (and never answered)
    bulk: !!(h['list-unsubscribe'] || h['list-id'] || /bulk|list|junk/i.test(str(h.precedence)) || (h['auto-submitted'] && !/^no$/i.test(str(h['auto-submitted']))) ||
             h['x-autoreply'] || h['x-autorespond'] || /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)([+.@-]|$)/i.test(from.address)),
  };
}
/** The new part of a reply: quoted history, "On ... wrote:" and the old message below it cut off. */
export function cleanReply(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n'), out = [];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i], next = lines[i + 1] || '';
    if (/^\s*>/.test(l)) continue;
    if (/^On .{6,}wrote:\s*$/i.test(l) || (/^On .{6,}$/i.test(l) && /^.{0,80}wrote:\s*$/i.test(next))) break;
    if (/লিখেছেন:\s*$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^_{10,}\s*$/.test(l) && /^From:/i.test(next)) break;
    if (/^From: .+/i.test(l) && /^(Sent|Date): /i.test(next)) break;
    out.push(l);
  }
  return out.join('\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, 6000);
}
