// The shell: today, theme, businesses (ERP.js:2298-2400, 2737, 3426).

import { todayStr } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';

export async function erpToday(ctx) { return todayStr(ctx.now); }

/** Remembered light/dark choice, per person (was the deployer's - shared - property). */
export async function erpGetTheme(ctx) {
  const r = await ctx.tx`select theme from erp_prefs where user_id = ${ctx.s.userId}`;
  return (r[0] && r[0].theme) || 'dark';
}

export async function erpSetTheme(ctx, t) {
  const v = String(t || '').toLowerCase() === 'light' ? 'light' : 'dark';
  await ctx.tx`insert into erp_prefs (user_id, theme) values (${ctx.s.userId}, ${v})
               on conflict (user_id) do update set theme = excluded.theme`;
  return { ok: true, theme: v };
}

/**
 * The businesses this person can open. A membership is what "the owner put
 * them in" meant for the sheet ERP; RLS returns only those.
 */
export async function erpBusinesses(ctx) {
  const list = ctx.s.memberships.map((m) => ({ id: m.business_id, name: m.name, pool: !!m.is_pool }));
  const canAdd = roleAtLeast(ctx.s.role, 'owner');
  return { businesses: list, active: ctx.biz, canAdd, theme: await erpGetTheme(ctx) };
}

export async function erpSetBusiness(ctx, id) {
  const hit = ctx.s.memberships.find((m) => m.business_id === String(id));
  if (!hit) throw new Error('That business is not in the list.');
  await ctx.tx`insert into erp_prefs (user_id, active_business) values (${ctx.s.userId}, ${hit.business_id})
               on conflict (user_id) do update set active_business = excluded.active_business`;
  return { ok: true, id: hit.business_id, name: hit.name };
}
