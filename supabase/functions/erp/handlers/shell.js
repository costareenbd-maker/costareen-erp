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
  const look = await ctx.tx`select look, lang from erp_prefs where user_id = ${ctx.s.userId}`;
  return { businesses: list, active: ctx.biz, canAdd, theme: await erpGetTheme(ctx), look: (look[0] && look[0].look) || '', lang: (look[0] && look[0].lang) || '' };
}

/**
 * The theme this person picked from the library: a name, or "custom" with two colours.
 * Kept as "name" or "custom|#rrggbb|#rrggbb"; anything else is refused, so nothing typed
 * here can ever reach a page as markup or style.
 */
export async function erpSetLook(ctx, look) {
  const v = String(look || '').trim().toLowerCase();
  if (v && !/^[a-z]{2,16}(\|#[0-9a-f]{6}\|#[0-9a-f]{6})?$/.test(v)) throw new Error('That theme is not known.');
  await ctx.tx`insert into erp_prefs (user_id, look) values (${ctx.s.userId}, ${v || null})
               on conflict (user_id) do update set look = excluded.look`;
  return { ok: true, look: v };
}

/**
 * The business's own Bangla words: {english: bangla} laid over the built-in
 * dictionary for everyone in the business. erpBnWords() reads; with
 * {set: {english: bangla|''}} the owner or a manager changes them ('' = back to the built-in one).
 */
export async function erpBnWords(ctx, payload) {
  const { getConfig, setConfig } = await import('../lib/ext.js');
  const { roleAtLeast } = await import('../allow.js');
  let words = {};
  try { words = JSON.parse(await getConfig(ctx, 'bn_words', '') || '{}') || {}; } catch (_) { words = {}; }
  if (payload && payload.set && typeof payload.set === 'object') {
    if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner can change the Bangla words.');
    for (const [en, bn] of Object.entries(payload.set)) {
      const k = String(en).replace(/\s+/g, ' ').trim(), v = String(bn == null ? '' : bn).trim();
      if (!k || k.length > 400 || v.length > 600) throw new Error('That word or sentence is too long.');
      if (v) words[k] = v; else delete words[k];
    }
    if (Object.keys(words).length > 3000) throw new Error('At most 3,000 own words.');
    await setConfig(ctx, 'bn_words', JSON.stringify(words));
  }
  return { words };
}

/** What customers receive (invoice PDF) - English or Bangla, for the whole business (owner). */
export async function erpDocLang(ctx, lang) {
  const { getConfig, setConfig } = await import('../lib/ext.js');
  if (lang === undefined || lang === null || lang === '') return { lang: (String(await getConfig(ctx, 'doc_lang', 'en')) || 'en') === 'bn' ? 'bn' : 'en' };
  if (ctx.s.role !== 'owner') throw new Error('Only the owner can do that.');
  const v = String(lang).trim().toLowerCase();
  if (v !== 'en' && v !== 'bn') throw new Error('That language is not offered.');
  await setConfig(ctx, 'doc_lang', v);
  return { lang: v };
}

/** This person's screen language: 'en' or 'bn'. */
export async function erpSetLang(ctx, lang) {
  const v = String(lang || '').trim().toLowerCase();
  if (v !== 'en' && v !== 'bn') throw new Error('That language is not offered.');
  await ctx.tx`insert into erp_prefs (user_id, lang) values (${ctx.s.userId}, ${v})
               on conflict (user_id) do update set lang = excluded.lang`;
  return { ok: true, lang: v };
}

export async function erpSetBusiness(ctx, id) {
  const hit = ctx.s.memberships.find((m) => m.business_id === String(id));
  if (!hit) throw new Error('That business is not in the list.');
  await ctx.tx`insert into erp_prefs (user_id, active_business) values (${ctx.s.userId}, ${hit.business_id})
               on conflict (user_id) do update set active_business = excluded.active_business`;
  return { ok: true, id: hit.business_id, name: hit.name };
}
