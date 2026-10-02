// Access by private link (see 027_access_keys.sql).
//
//   erpAccessKeys()              the links that open this account, never the keys themselves
//   erpAccessKeyNew({label})     a new link - the key is returned ONCE, here, and never again
//   erpAccessKeyRevoke({id})     that link stops working at once, on every device that used it
//
// The table is server-only, so these go through the privileged side connection
// and always name the signed-in person themselves.

import { formatDate } from '../lib/time.js';

const str = (v) => String(v == null ? '' : v).trim();
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy, h:mm a') : '');

export async function keyHash(key) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(key)));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** 32 random bytes, written so it survives being pasted into a chat or an SMS. */
export function newKey() {
  const b = new Uint8Array(32);
  globalThis.crypto.getRandomValues(b);
  let s = '';
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function erpAccessKeys(ctx) {
  const rows = await ctx.sql`
    select id, label, created_at, last_used, revoked_at from erp_access_keys
    where user_id = ${ctx.s.userId} order by revoked_at is not null, created_at desc`;
  return { keys: rows.map((r) => ({ id: r.id, label: str(r.label), made: when(r.created_at), lastUsed: when(r.last_used),
                                    revoked: !!r.revoked_at, current: r.id === ctx.s.keyId })) };
}

export async function erpAccessKeyNew(ctx, payload) {
  const label = str(payload && payload.label).slice(0, 60);
  if (!label) throw new Error('Who or what is this link for? e.g. “Shop phone”, “Mehedi”.');
  const n = (await ctx.sql`select count(*)::int n from erp_access_keys where user_id = ${ctx.s.userId} and revoked_at is null`)[0].n;
  if (n >= 50) throw new Error('There are 50 working links already. Switch off the ones no longer used first.');
  const key = newKey();
  await ctx.sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(key)}, ${ctx.s.userId}, ${label})`;
  return { ...(await erpAccessKeys(ctx)), fresh: { label, key } };
}

export async function erpAccessKeyRevoke(ctx, payload) {
  const id = str(payload && payload.id);
  if (!id) throw new Error('Which link?');
  if (id === ctx.s.keyId) throw new Error('That is the link this device is using. Make a new link, open it here, then switch this one off.');
  const r = await ctx.sql`update erp_access_keys set revoked_at = now()
                          where id = ${id} and user_id = ${ctx.s.userId} and revoked_at is null returning id`;
  if (!r.length) throw new Error('That link was not found, or is already off.');
  return erpAccessKeys(ctx);
}

export const HANDLERS = { erpAccessKeys, erpAccessKeyNew, erpAccessKeyRevoke };
