// The Inbox's e-mail channel (134, handlers/inboxmail.js, lib/mail.js): connecting a mailbox (a wrong app password is
// refused, mail from before connecting stays out), new mail as chats (quoted history cut, Bangla subject and body,
// a photo kept, newsletters / automatic mail / no-reply left out), the team's answer as an e-mail reply in the thread,
// the next e-mail of the same person in the same chat, the mail reader itself, removing, another business.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, sales, check, done, deps, fnDir } from './harness.mjs';

const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const mail = await import(pathToFileURL(path.join(fnDir, 'lib', 'mail.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
const enc = new TextEncoder(), latin1 = (b) => String.fromCharCode(...b);

// ---- a pretend mail server: IMAP on imap.test, SMTP on smtp.test, both through deps.tcp
const box = { validity: 7, mails: [{ uid: 1, raw: 'From: old@x.com\r\nSubject: old\r\n\r\nbefore connecting' }] };
const nextUid = () => (box.mails.length ? Math.max(...box.mails.map((m) => m.uid)) : 0) + 1;
const PASS = 'abcd efgh ijkl mnop', sent = [];
function conn(onLine, greeting) {
  const out = []; let wake = null, inbuf = '', dataMode = null;
  const push = (s) => { for (const b of enc.encode(s)) out.push(b); if (wake) { const w = wake; wake = null; w(); } };
  setTimeout(() => push(greeting), 0);
  return {
    read(buf) { return new Promise((res) => { const go = () => { const n = Math.min(buf.length, out.length); for (let i = 0; i < n; i++) buf[i] = out[i]; out.splice(0, n); res(n); }; if (out.length) go(); else wake = go; }); },
    write(bytes) {
      inbuf += latin1(bytes);
      for (;;) {
        if (dataMode) { const i = inbuf.indexOf('\r\n.\r\n'); if (i < 0) break; const msg = inbuf.slice(0, i); inbuf = inbuf.slice(i + 5); const rep = dataMode(msg); dataMode = null; if (rep) push(rep); continue; }
        const i = inbuf.indexOf('\r\n'); if (i < 0) break;
        const line = inbuf.slice(0, i); inbuf = inbuf.slice(i + 2);
        const r = onLine(line, (fn) => { dataMode = fn; });
        if (r) push(r);
      }
      return bytes.length;
    },
    close() {},
  };
}
function imapLine(l) {
  const [tag, cmd, ...rest] = l.split(' '), arg = rest.join(' ');
  const C = cmd.toUpperCase();
  if (C === 'LOGIN') { const m = /^"([^"]*)" "([^"]*)"$/.exec(arg); return m && m[1] === 'shop@test.com' && m[2].replace(/\s/g, '') === PASS.replace(/\s/g, '') ? tag + ' OK logged in\r\n' : tag + ' NO [AUTHENTICATIONFAILED] Invalid credentials (Failure)\r\n'; }
  if (C === 'EXAMINE') return '* ' + box.mails.length + ' EXISTS\r\n* OK [UIDVALIDITY ' + box.validity + '] ok\r\n* OK [UIDNEXT ' + nextUid() + '] ok\r\n' + tag + ' OK [READ-ONLY] done\r\n';
  if (C === 'LOGOUT') return '* BYE\r\n' + tag + ' OK bye\r\n';
  if (C === 'UID' && /^SEARCH UID (\d+):\*/i.test(arg)) {
    const from = Number(/(\d+):\*/.exec(arg)[1]);
    let u = box.mails.filter((m) => m.uid >= from).map((m) => m.uid); if (!u.length && box.mails.length) u = [Math.max(...box.mails.map((m) => m.uid))];   // as real servers do
    return '* SEARCH ' + u.join(' ') + '\r\n' + tag + ' OK\r\n';
  }
  if (C === 'UID' && /^FETCH [\d,]+ \(UID RFC822\.SIZE\)/i.test(arg)) {
    const ids = /^FETCH ([\d,]+)/i.exec(arg)[1].split(',').map(Number);
    return ids.map((u, k) => '* ' + (k + 1) + ' FETCH (UID ' + u + ' RFC822.SIZE ' + enc.encode(box.mails.find((m) => m.uid === u).raw).length + ')\r\n').join('') + tag + ' OK\r\n';
  }
  if (C === 'UID' && /^FETCH \d+ \(UID BODY\.PEEK\[\]\)/i.test(arg)) {
    const u = Number(/^FETCH (\d+)/i.exec(arg)[1]), m = box.mails.find((x) => x.uid === u), b = enc.encode(m.raw);
    return '* 1 FETCH (UID ' + u + ' BODY[] {' + b.length + '}\r\n' + m.raw + ')\r\n' + tag + ' OK\r\n';
  }
  return tag + ' BAD unknown\r\n';
}
function smtpLine(l, data) {
  const C = l.slice(0, 4).toUpperCase();
  if (C === 'EHLO') return '250-smtp.test\r\n250 AUTH PLAIN LOGIN\r\n';
  if (C === 'AUTH') { const d = atob(l.split(' ')[2]).split('\u0000'); return d[1] === 'shop@test.com' && d[2].replace(/\s/g, '') === PASS.replace(/\s/g, '') ? '235 ok\r\n' : '535 5.7.8 Username and Password not accepted\r\n'; }
  if (C === 'MAIL') { sent.push({ from: l }); return '250 ok\r\n'; }
  if (C === 'RCPT') { sent[sent.length - 1].rcpt = l; return '250 ok\r\n'; }
  if (C === 'DATA') { data((m) => { sent[sent.length - 1].data = m; return '250 queued\r\n'; }); return '354 go\r\n'; }
  if (C === 'QUIT') return '221 bye\r\n';
  return '502 no\r\n';
}
deps.tcp = async (host, port) => {
  if (host === 'imap.test' && port === 993) return conn(imapLine, '* OK IMAP ready\r\n');
  if (host === 'smtp.test' && port === 465) return conn(smtpLine, '220 smtp.test ready\r\n');
  throw new Error('connection refused');
};

// ---- 1. connecting
let r = await owner('erpInboxChannelSave', [{ kind: 'email', name: 'Shop mail', externalId: 'Shop@Test.com', secrets: { PASSWORD: 'wrong pass' },
  settings: { imap_host: 'imap.test', smtp_host: 'smtp.test', imap_port: 993, smtp_port: 465, from_name: 'Test Shop' } }]);
const ch = r.ok && r.result.channels.find((c) => c.kind === 'email');
check('an e-mail channel is added, address in small letters, in practice', r.ok && ch && ch.externalId === 'shop@test.com' && ch.status === 'practice' && ch.kind === 'email', r);
check('a wrong app password: the mailbox refused the login, said plainly', r.result.done.mail.ok === false && /refused the login/.test(r.result.done.mail.error), r.result && r.result.done);
r = await owner('erpInboxChannelSave', [{ id: ch.id, secrets: { PASSWORD: PASS }, settings: { smtp_port: 587 } }]);
check('port 587 is refused (this server sends on 465 only)', r.ok && r.result.done.mail.ok === false && /465/.test(r.result.done.mail.error), r.result && r.result.done);
r = await owner('erpInboxChannelSave', [{ id: ch.id, settings: { smtp_port: 465 } }]);
const ch2 = r.result.channels.find((c) => c.id === ch.id);
check('the right app password: reading and sending both work; reading starts from now (the old mail stays out)', r.ok && r.result.done.mail.ok === true && ch2.keys.PASSWORD === true &&
  ch2.settings.uid_next === 2 && ch2.settings.uid_validity === 7 && !JSON.stringify(r.result).includes(PASS.replace(/\s/g, '')), [r.result.done, ch2.settings]);
const code = ch2.settings.test_code;

// ---- 2. new mail
const png = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5f0000000049454e44ae426082', 'hex').toString('base64');
box.mails.push({ uid: 2, raw: ['From: "Karim Uddin" <Karim@X.com>', 'To: shop@test.com', 'Subject: PLA price?', 'Message-ID: <m2@x.com>', 'Content-Type: text/plain; charset=utf-8', '',
  'How much is one roll of PLA?', '', 'On Mon, 19 Oct 2026 at 10:00, Shop <shop@test.com> wrote:', '> old answer', '> more'].join('\r\n') });
box.mails.push({ uid: 3, raw: ['From: Deals <deals@shopnews.com>', 'List-Unsubscribe: <mailto:u@shopnews.com>', 'Subject: 50% off', '', 'Big sale'].join('\r\n') });
box.mails.push({ uid: 4, raw: ['From: no-reply@bank.com', 'Subject: Your statement', '', 'See attached'].join('\r\n') });
box.mails.push({ uid: 5, raw: ['From: =?UTF-8?B?4Kaw4Ka54Ka/4Kau?= <rahim@y.com>', 'Subject: =?UTF-8?B?4Kam4Ka+4KauIOCmleCmpD8=?=', 'Message-ID: <m5@y.com>', 'MIME-Version: 1.0',
  'Content-Type: multipart/mixed; boundary="BB"', '', '--BB', 'Content-Type: text/plain; charset=UTF-8', 'Content-Transfer-Encoding: quoted-printable', '',
  '=E0=A6=8F=E0=A6=87 =E0=A6=B0=E0=A6=99 =E0=A6=86=E0=A6=9B=E0=A7=87? This is a long line that=', ' continues', '--BB', 'Content-Type: image/png; name="spool.png"',
  'Content-Disposition: attachment; filename="spool.png"', 'Content-Transfer-Encoding: base64', '', png, '--BB', 'Content-Type: application/pdf; name="bill.pdf"',
  'Content-Disposition: attachment; filename="bill.pdf"', 'Content-Transfer-Encoding: base64', '', 'JVBERi0xLjQK', '--BB--', ''].join('\r\n') });
box.mails.push({ uid: 6, raw: ['From: Sara <sara@z.com>', 'Subject: Order', 'Content-Type: text/html; charset=utf-8', '', '<html><body><p>Hi,</p><p>I want <b>2 rolls</b> &amp; a nozzle.</p></body></html>'].join('\r\n') });
r = await asB((ctx) => ib.inboxTick(ctx));
check('the minute timer read the mailbox: 3 e-mails in, the newsletter and the no-reply mail left out', r.mails === 3, r);
const chs = (await owner('erpInboxChannels', [])).result.channels.find((c) => c.id === ch.id);
check('the channel says when it read the mailbox and how many were left out', chs.mail.checked && chs.mail.skipped === 2 && !chs.mail.error && chs.settings.uid_next === 7, chs.mail);
r = await sales('erpInbox', [{ pile: 'all', platform: 'mail' }]);
const rows = r.result.list;
check('the Email button lists the three senders\' chats', r.ok && rows.length === 3 && r.result.platforms.mail && r.result.platforms.mail.connected, rows.map((x) => x.name));
const karim = rows.find((x) => /Karim/.test(x.name));
r = await sales('erpInboxOpen', [{ id: karim.id }]);
const m1 = r.result.msgs.find((m) => m.dir === 'in');
check('Karim\'s e-mail: the subject on top, his words, the quoted old answer cut off', m1 && m1.text === 'PLA price?\n\nHow much is one roll of PLA?', m1 && m1.text);
const rahim = rows.find((x) => x.name === 'রহিম');
r = await sales('erpInboxOpen', [{ id: rahim.id }]);
const m5 = r.result.msgs.filter((m) => m.dir === 'in');
check('a Bangla e-mail: name, subject and body read right; the photo kept; the PDF named', rahim && m5.length === 1 && /^দাম কত\?\n\nএই রঙ আছে\? This is a long line that continues/.test(m5[0].text) &&
  /📎 bill\.pdf/.test(m5[0].text) && m5[0].kind === 'image', m5);
const sara = rows.find((x) => x.name === 'Sara');
r = await sales('erpInboxOpen', [{ id: sara.id }]);
check('an HTML-only e-mail is read as text', /I want 2 rolls & a nozzle\./.test(r.result.msgs.find((m) => m.dir === 'in').text), r.result.msgs);
r = await asB((ctx) => ib.inboxTick(ctx));
check('the next minute: nothing twice', r.mails === 0, r);

// ---- 3. the answer goes back as an e-mail reply in the same thread
r = await sales('erpInboxSend', [{ id: karim.id, text: 'One roll is ৳1,600.' }]);
const s1 = sent[sent.length - 1];
const body = s1 && s1.data ? Buffer.from(s1.data.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8') : '';
check('the team\'s answer is sent: to Karim, "Re: PLA price?", in reply to his message, from the shop\'s name', r.ok && s1 && /RCPT TO:<karim@x\.com>/.test(s1.rcpt) &&
  /Subject: Re: PLA price\?/.test(s1.data) && /In-Reply-To: <m2@x\.com>/.test(s1.data) && /From: "Test Shop" <shop@test\.com>/.test(s1.data) && body === 'One roll is ৳1,600.', s1);
r = await sales('erpInboxOpen', [{ id: karim.id }]);
check('...written in the chat as sent', r.result.msgs.some((m) => m.dir === 'out' && m.author === 'team' && m.text === 'One roll is ৳1,600.' && m.status !== 'failed'), r.result.msgs);
box.mails.push({ uid: 7, raw: ['From: Karim Uddin <karim@x.com>', 'Subject: Re: PLA price?', 'Message-ID: <m7@x.com>', 'In-Reply-To: <x@test.com>', '', 'OK, send 2 rolls.', '', '> One roll is ৳1,600.'].join('\r\n') });
r = await asB((ctx) => ib.inboxTick(ctx));
r = await sales('erpInboxOpen', [{ id: karim.id }]);
check('his answer lands in the same chat, without the "Re:" subject and the quote', r.result.msgs.filter((m) => m.dir === 'in').length === 2 && r.result.msgs.filter((m) => m.dir === 'in').pop().text === 'OK, send 2 rolls.', r.result.msgs);
box.mails.push({ uid: 8, raw: ['From: tester@q.com', 'Subject: test ' + code, '', 'hello'].join('\r\n') });
r = await asB((ctx) => ib.inboxTick(ctx));
const tc = (await sql`select is_test from inbox_conversations v join inbox_contacts c on c.id = v.contact_id where c.external_id = 'tester@q.com'`)[0];
check('practice: an e-mail with the subject "test <code>" is a test chat (the AI may answer it)', tc && tc.is_test === true, tc);

// ---- 4. the reader on its own
const p = mail.parseMail(enc.encode(['From: =?iso-8859-1?Q?Jos=E9?= <jose@a.com>', 'Reply-To: orders@a.com', 'Subject: =?utf-8?Q?Caf=C3=A9_order?=', 'Content-Type: text/plain; charset=iso-8859-1',
  'Content-Transfer-Encoding: quoted-printable', '', 'Un caf=E9 =\r\npor favor', '', '-----Original Message-----', 'old'].join('\r\n')));
check('reader: encoded names and subjects, other charsets, soft line breaks, Reply-To', p.from.name === 'José' && p.subject === 'Café order' && p.replyTo.address === 'orders@a.com' &&
  mail.cleanReply(p.text) === 'Un café por favor', [p.from, p.subject, mail.cleanReply(p.text)]);
check('reader: an automatic answer is bulk', mail.parseMail(enc.encode('From: a@b.com\r\nAuto-Submitted: auto-replied\r\nSubject: Out of office\r\n\r\nAway')).bulk === true);

// ---- 5. roles, removing, another business
r = await sales('erpInboxChannelSave', [{ kind: 'email', externalId: 'x@y.com' }]);
check('only the owner connects a mailbox', !r.ok, r);
r = await owner('erpInboxChannelAct', [{ id: ch.id, action: 'remove' }]);
check('removed: the app password is deleted', r.ok && (await sql`select count(*)::int as n from business_secrets where business_id = ${FIX.B} and key = ${'INBOX_' + ch.id + '_PASSWORD'}`)[0].n === 0);
r = await asB((ctx) => ib.inboxTick(ctx));
check('a removed mailbox is not read', r.mails === 0, r);
check('the other business has no e-mail channel', (await sql`select count(*)::int as n from inbox_channels where business_id = ${FIX.B2} and kind = 'email'`)[0].n === 0);

await done();
