// alerts-1 (owner 6 Nov 2026): phone alerts when the ERP app is closed - Web Push with no outside service.
//
// RFC 8291 (message encryption, "aes128gcm") + RFC 8292 (VAPID). Only WebCrypto, so the same code runs in the Deno
// edge function and in the Node test harness. The VAPID key pair is made once and kept in the server-only table
// erp_push_vapid (155_phone_alerts.sql); the browser subscribes with its public key.

const subtle = globalThis.crypto.subtle;
const enc = new TextEncoder();

export function b64u(bytes) {
  let s = ''; const b = new Uint8Array(bytes);
  for (let i = 0; i < b.length; i++) s += String.fromCharCode(b[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function unb64u(str) {
  const s = String(str || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(s + '='.repeat((4 - s.length % 4) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
function cat(...parts) {
  const n = parts.reduce((a, p) => a + p.length, 0), out = new Uint8Array(n);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}
async function hmac(key, data) {
  const k = await subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return new Uint8Array(await subtle.sign('HMAC', k, data));
}
// HKDF with one output block is enough here (every length asked for is <= 32)
async function hkdf(salt, ikm, info, len) {
  const prk = await hmac(salt, ikm);
  return (await hmac(prk, cat(info, new Uint8Array([1])))).slice(0, len);
}

/** A new VAPID key pair: the public key as base64url (65 bytes, uncompressed point), the private key as a JWK. */
export async function makeVapid() {
  const kp = await subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return { publicKey: b64u(await subtle.exportKey('raw', kp.publicKey)), privateJwk: await subtle.exportKey('jwk', kp.privateKey) };
}

/** RFC 8292: "vapid t=<jwt>, k=<public key>" for one push service (its origin is the audience). */
export async function vapidHeader(endpoint, vapid, subject, nowMs) {
  const aud = new URL(endpoint).origin;
  const head = b64u(enc.encode(JSON.stringify({ typ: 'JWT', alg: 'ES256' })));
  const body = b64u(enc.encode(JSON.stringify({ aud, exp: Math.floor((nowMs || Date.now()) / 1000) + 12 * 3600, sub: subject })));
  const key = await subtle.importKey('jwk', vapid.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const sig = new Uint8Array(await subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, enc.encode(head + '.' + body)));   // r || s
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + vapid.publicKey;
}

/**
 * RFC 8291 encryption of one message for one subscription. `fixed` (tests only) pins the salt and the
 * server's one-time key so the RFC's own example can be reproduced.
 */
export async function encryptPush(plain, p256dh, authSecret, fixed) {
  const uaPublic = unb64u(p256dh), auth = unb64u(authSecret);
  let asPublic, asPrivate;
  if (fixed && fixed.asPrivateJwk) {
    asPrivate = await subtle.importKey('jwk', fixed.asPrivateJwk, { name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits']);
    asPublic = unb64u(fixed.asPublic);
  } else {
    const kp = await subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits']);
    asPrivate = kp.privateKey; asPublic = new Uint8Array(await subtle.exportKey('raw', kp.publicKey));
  }
  const uaKey = await subtle.importKey('raw', uaPublic, { name: 'ECDH', namedCurve: 'P-256' }, false, []);
  const shared = new Uint8Array(await subtle.deriveBits({ name: 'ECDH', public: uaKey }, asPrivate, 256));
  const ikm = await hkdf(auth, shared, cat(enc.encode('WebPush: info\0'), uaPublic, asPublic), 32);
  const salt = fixed && fixed.salt ? unb64u(fixed.salt) : globalThis.crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode('Content-Encoding: aes128gcm\0'), 16);
  const nonce = await hkdf(salt, ikm, enc.encode('Content-Encoding: nonce\0'), 12);
  const key = await subtle.importKey('raw', cek, { name: 'AES-GCM' }, false, ['encrypt']);
  const data = typeof plain === 'string' ? enc.encode(plain) : new Uint8Array(plain);
  const ct = new Uint8Array(await subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, cat(data, new Uint8Array([2]))));   // 2 = the last record
  const rs = new Uint8Array([0, 0, 16, 0]);   // record size 4096
  return cat(salt, rs, new Uint8Array([asPublic.length]), asPublic, ct);
}

/**
 * Sends one alert. Returns { ok, gone } - gone = the browser dropped this subscription (404 / 410), delete it.
 * `fetchFn` is the deps' fetch (the test harness fakes it).
 */
export async function sendPush(fetchFn, sub, payload, vapid, subject, opts) {
  const body = await encryptPush(JSON.stringify(payload), sub.p256dh, sub.auth);
  const headers = { 'Content-Encoding': 'aes128gcm', 'Content-Type': 'application/octet-stream', TTL: String((opts && opts.ttl) || 86400),
                    Urgency: (opts && opts.urgency) || 'high', Authorization: await vapidHeader(sub.endpoint, vapid, subject) };
  if (payload && payload.tag) headers.Topic = String(payload.tag).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 32) || undefined;
  if (!headers.Topic) delete headers.Topic;
  const f = fetchFn || fetch;
  try {
    const res = await Promise.race([f(sub.endpoint, { method: 'POST', headers, body }), new Promise((_, no) => setTimeout(() => no(new Error('timeout')), 6000))]);
    const st = res.status || 0;
    return { ok: st >= 200 && st < 300, status: st, gone: st === 404 || st === 410 };
  } catch (e) { return { ok: false, status: 0, gone: false, error: String((e && e.message) || e) }; }
}
