// How a sale leaves the shop - the business's own list, each with a type:
//   pickup  the customer takes it (no cash on delivery)
//   courier a courier company delivers and collects (Steadfast, Pathao, RedX...)
//   rider   the shop's own rider / a ride service delivers and collects
// Kept in business_config 'delivery_options' as [{name, type}]. Until the
// owner changes it, the usual list is used with types guessed from the names.

import { getConfig } from './ext.js';

const str = (v) => String(v == null ? '' : v).trim();
export const DELIVERY_TYPES = { pickup: 'Pickup', courier: 'Courier', rider: 'Own rider' };
export const DEFAULT_DELIVERY = ['Customer pickup', 'Steadfast courier', 'Steadfast Express', 'Pathao Instant', 'Uber Instant', 'Costareen Delivery'];

export function guessType(name) {
  const n = str(name).toLowerCase();
  if (/pick ?up|walk|counter|store|shop/.test(n)) return 'pickup';
  if (/steadfast|pathao|redx|paperfly|sundarban|e-?courier|courier|parcel|sa paribahan|janani|karatoa/.test(n)) return 'courier';
  return 'rider';
}

/** [{name, type}] in the owner's order. */
export async function deliveryOptions(ctx) {
  if (ctx.memo.delivery) return ctx.memo.delivery;
  let list = null;
  try { list = JSON.parse(await getConfig(ctx, 'delivery_options', '') || 'null'); } catch (_) { list = null; }
  if (!Array.isArray(list) || !list.length) list = DEFAULT_DELIVERY.map((name) => ({ name, type: guessType(name) }));
  list = list.map((o) => ({ name: str(o.name), type: DELIVERY_TYPES[o.type] ? o.type : guessType(o.name) })).filter((o) => o.name);
  ctx.memo.delivery = list;
  return list;
}

/** pickup | courier | rider for this delivery name (an unknown name is guessed). */
export async function deliveryType(ctx, name) {
  const n = str(name).toLowerCase();
  const hit = (await deliveryOptions(ctx)).find((o) => o.name.toLowerCase() === n);
  return hit ? hit.type : guessType(name);
}

/** Cash on delivery needs someone to deliver and collect. */
export async function codAllowed(ctx, name) { return (await deliveryType(ctx, name)) !== 'pickup'; }
