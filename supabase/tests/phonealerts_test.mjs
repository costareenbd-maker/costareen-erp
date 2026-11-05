// Phone alerts (155_phone_alerts.sql, lib/webpush.js, handlers/phonealerts.js, the pushTeam hooks in handlers/inbox.js):
// the server key, switching a device on / off, the encryption (opened again here with node:crypto, a separate
// implementation, and the RFC 8291 example reproduced), the VAPID header, an Inbox task alerting the phones, a dropped
// subscription removed, and nothing for another business.
import { webcrypto, hkdfSync, createDecipheriv } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, sales, check, done, deps, web, fnDir } from './harness.mjs';

const wp = await import(pathToFileURL(path.join(fnDir, 'lib', 'webpush.js')));
const ib = await import(pathToFileURL(path.join(fnDir, 'handlers', 'inbox.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };
const subtle = webcrypto.subtle;

// ---- 0. the RFC 8291 example, byte for byte
{
  const asPub = 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8', p = wp.unb64u(asPub);
  const jwk = { kty: 'EC', crv: 'P-256', d: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', x: wp.b64u(p.slice(1, 33)), y: wp.b64u(p.slice(33, 65)), ext: true };
  const out = await wp.encryptPush(wp.unb64u('V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24'),
    'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
    { asPrivateJwk: jwk, asPublic: asPub, salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
  check('the RFC 8291 example comes out byte for byte', wp.b64u(out) === 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
}

// ---- a fake phone: its own key pair, like a browser's push subscription
const ua = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
const uaPub = new Uint8Array(await subtle.exportKey('raw', ua.publicKey));
const authBytes = webcrypto.getRandomValues(new Uint8Array(16));
const SUB = { endpoint: 'https://push.test/send/phone-1', keys: { p256dh: wp.b64u(uaPub), auth: wp.b64u(authBytes) } };

// opens what the server sent, with node:crypto only (not lib/webpush.js)
async function open(body) {
  const b = Buffer.from(body), salt = b.subarray(0, 16), idlen = b[20], asPub = b.subarray(21, 21 + idlen), ct = b.subarray(21 + idlen);
  const asKey = await subtle.importKey('raw', asPub, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = Buffer.from(await subtle.deriveBits({ name: 'ECDH', public: asKey }, ua.privateKey, 256));
  const ikm = Buffer.from(hkdfSync('sha256', shared, authBytes, Buffer.concat([Buffer.from('WebPush: info\0'), Buffer.from(uaPub), asPub]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
  const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
  check('the record ends with the last-record delimiter', plain[plain.length - 1] === 2);
  return JSON.parse(plain.subarray(0, plain.length - 1).toString('utf8'));
}

let status = 201;
const sent = [];
web.on(/push\.test/, (url, opts) => { sent.push({ url, headers: opts.headers, body: opts.body }); return { status, body: '' }; });

// ---- 1. the key, switching on
let r = await owner('erpPhoneAlerts', []);
check('the server key is made once and handed to the page', r.ok && /^[A-Za-z0-9_-]{87}$/.test(r.result.publicKey) && r.result.devices === 0, r);
const pub1 = r.result.publicKey;
r = await owner('erpPhoneAlerts', []);
check('the same key every time', r.ok && r.result.publicKey === pub1, r);
check('the private key never leaves the server', !JSON.stringify(r.result).includes('"d"'), r);
r = await owner('erpPhoneAlertsOn', [{ sub: { endpoint: 'http://push.test/x', keys: SUB.keys } }]);
check('a non-https alert address is refused', !r.ok, r);
r = await owner('erpPhoneAlertsOn', [{ sub: { endpoint: SUB.endpoint, keys: { p256dh: 'short', auth: 'x' } } }]);
check('bad keys are refused', !r.ok, r);
r = await owner('erpPhoneAlertsOn', [{ sub: SUB, label: 'Android · Chrome' }]);
check('this phone is switched on', r.ok && r.result.devices === 1, r);
r = await owner('erpPhoneAlertsOn', [{ sub: SUB, label: 'Android · Chrome' }]);
check('switching on twice keeps one row', r.ok && r.result.devices === 1, r);

// ---- 2. the test alert: headers, VAPID, the content opened again
r = await owner('erpPhoneAlertsTest', []);
check('the test alert is sent', r.ok && r.result.sent === 1 && sent.length === 1, r);
const h = sent[0].headers;
check('encrypted with aes128gcm, high urgency, a time to live', h['Content-Encoding'] === 'aes128gcm' && h.Urgency === 'high' && +h.TTL > 0, h);
const m = /^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/.exec(h.Authorization || '');
check('a VAPID header with the server key', !!m && m[4] === pub1, h.Authorization);
const claims = JSON.parse(Buffer.from(m[2], 'base64url').toString());
check('the token is for the push service and expires within a day', claims.aud === 'https://push.test' && claims.exp > Date.now() / 1000 && claims.exp < Date.now() / 1000 + 86400 && /^mailto:/.test(claims.sub), claims);
const vkey = await subtle.importKey('raw', wp.unb64u(pub1), { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
check('the token signature checks out with the public key', await subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, vkey, Buffer.from(m[3], 'base64url'), Buffer.from(m[1] + '.' + m[2])));
let msg = await open(sent[0].body);
check('the phone reads the test alert', msg.title === 'Phone alerts work' && msg.url === '/#/inbox', msg);

// ---- 3. an Inbox task (a hand-over) alerts the phones
await asB((ctx) => ib.task(ctx, null, 'handover', 'complaint', 'Rafiq: the printer is clogging'));
check('a hand-over sends an alert', sent.length === 2);
msg = await open(sent[1].body);
check('the alert says what happened', msg.title === 'A customer needs a person' && /clogging/.test(msg.body), msg);

// ---- 4. another business hears nothing; sales staff see only their own devices
r = await sales('erpPhoneAlerts', []);
check('sales staff see only their own devices', r.ok && r.result.devices === 0, r);
const other = (await sql`select count(*)::int n from erp_push_subs where business_id = ${FIX.B2}`)[0].n;
check('nothing is kept for the other business', other === 0);

// ---- 5. a phone that dropped the subscription is removed
status = 410;
r = await owner('erpPhoneAlertsTest', []);
check('a gone subscription is not counted as sent and is deleted', r.ok && r.result.sent === 0 && r.result.devices === 0, r);
status = 201;
r = await owner('erpPhoneAlertsTest', []);
check('with nothing switched on the test says so', !r.ok && /Switch Phone alerts on/.test(r.error), r);

// ---- 6. switching off
await owner('erpPhoneAlertsOn', [{ sub: SUB }]);
r = await owner('erpPhoneAlertsOff', [{ endpoint: SUB.endpoint }]);
check('this phone is switched off', r.ok && r.result.devices === 0, r);
r = await owner('erpPhoneAlertsOn', [{ sub: SUB }]);
const before = sent.length;
r = await owner('erpPhoneAlertsOff', [{ endpoint: SUB.endpoint }]);
await asB((ctx) => ib.task(ctx, null, 'enquiry', 'ai-off', 'Karim wrote'));
check('after switching off no alert goes out', sent.length === before);

done();
