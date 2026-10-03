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
  const w = String(t || '').toLowerCase();
  const v = w === 'light' || w === 'auto' ? w : 'dark';   // auto = follow the phone or computer
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

// ---- ui-6: my account (name, photo) and the business's background photo
const IMG = /^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/;
/** Who I am, for the account menu. */
export async function erpProfile(ctx) {
  const p = (await ctx.sql`select email, full_name, avatar from profiles where id = ${ctx.s.userId}`)[0] || {};
  const pr = (await ctx.sql`select bg_off from erp_prefs where user_id = ${ctx.s.userId}`)[0] || {};
  return { name: String(p.full_name || ctx.s.name || '').trim(), email: String(p.email || '').trim(), avatar: p.avatar || '', role: ctx.s.role,
           roleLabel: ctx.s.roleLabel || ctx.s.role, business: ctx.s.businessName || '', bgOff: !!pr.bg_off };
}
/** {name} and/or {avatar} ('' removes the photo). The photo is made small on the page first. */
export async function erpProfileSave(ctx, payload) {
  payload = payload || {};
  if (payload.name !== undefined) {
    const n = String(payload.name).trim().replace(/\s+/g, ' ');
    if (!n || n.length > 80) throw new Error('Type your name (up to 80 letters).');
    await ctx.sql`insert into profiles (id, full_name) values (${ctx.s.userId}, ${n}) on conflict (id) do update set full_name = excluded.full_name`;
  }
  if (payload.avatar !== undefined) {
    const a = String(payload.avatar || '');
    if (a && (!IMG.test(a) || a.length > 120000)) throw new Error('That photo could not be used. Try another one.');
    await ctx.sql`insert into profiles (id, avatar) values (${ctx.s.userId}, ${a || null}) on conflict (id) do update set avatar = excluded.avatar`;
  }
  return erpProfile(ctx);
}
/** The business's background photo: {photo, strength}, and whether I switched it off for myself. */
export async function erpBg(ctx, payload) {
  const { getConfig } = await import('../lib/ext.js');
  const pr = (await ctx.sql`select bg_off from erp_prefs where user_id = ${ctx.s.userId}`)[0] || {};
  const v = String(await getConfig(ctx, 'bg_v', '')) || '';
  const out = { v, strength: String(await getConfig(ctx, 'bg_strength', 'medium')) || 'medium', off: !!pr.bg_off };
  // the device already has this photo: no need to send it again
  if (v && payload && payload.have === v) return { ...out, same: true };
  return { ...out, photo: String(await getConfig(ctx, 'bg_photo', '')) || '' };
}
/** Owner or manager: {photo} ('' removes it) and/or {strength: subtle|medium|strong}. */
export async function erpBgSave(ctx, payload) {
  const { setConfig } = await import('../lib/ext.js');
  const { roleAtLeast } = await import('../allow.js');
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner changes the background photo.');
  payload = payload || {};
  if (payload.photo !== undefined) {
    const ph = String(payload.photo || '');
    if (ph && (!IMG.test(ph) || ph.length > 700000)) throw new Error('That photo could not be used. Try another one.');
    await setConfig(ctx, 'bg_photo', ph);
    await setConfig(ctx, 'bg_v', ph ? String(Date.now()) : '');
  }
  if (payload.strength !== undefined) {
    const st = String(payload.strength);
    if (!['subtle', 'medium', 'strong'].includes(st)) throw new Error('Subtle, medium or strong?');
    await setConfig(ctx, 'bg_strength', st);
  }
  return erpBg(ctx);
}
/** Switch the background photo off (or on) for myself only. */
export async function erpBgOff(ctx, payload) {
  const off = !!(payload && payload.off);
  await ctx.sql`insert into erp_prefs (user_id, bg_off) values (${ctx.s.userId}, ${off}) on conflict (user_id) do update set bg_off = excluded.bg_off`;
  return erpBg(ctx);
}

// ---- game: a small print-head runner under New invoice. The owner decides who sees it.
const GAME_WHO = ['owner', 'all', 'none'];
/** {who: owner|all|none, on: whether I may see it}. Default: only the owner. */
export async function erpGame(ctx) {
  const { getConfig } = await import('../lib/ext.js');
  let who = String(await getConfig(ctx, 'game_who', 'owner')) || 'owner';
  if (!GAME_WHO.includes(who)) who = 'owner';
  return { who, on: who === 'all' || (who === 'owner' && ctx.s.role === 'owner') };
}
/** Owner: {who: owner|all|none}. */
export async function erpGameSet(ctx, payload) {
  const { setConfig } = await import('../lib/ext.js');
  if (ctx.s.role !== 'owner') throw new Error('Only the owner decides who sees the game.');
  const who = String(payload && payload.who || '');
  if (!GAME_WHO.includes(who)) throw new Error('Everyone, only the owner, or nobody?');
  await setConfig(ctx, 'game_who', who);
  return erpGame(ctx);
}

// ---- the fighting game's fighters: pixel heads made from photos of people who agreed. Kept per business, never in public files.
const FIGHT_MOVES = ['whip', 'spool', 'dash', 'resin', 'wall', 'pillars', 'laser', 'slam', 'flurry'];
/** {fighters: [{name, move, color, head: {w, h, pal: ['#rrggbb'], px}}]} */
export async function erpFighters(ctx) {
  const { getConfig } = await import('../lib/ext.js');
  let list = [];
  try { list = JSON.parse(String(await getConfig(ctx, 'fighters', '[]')) || '[]'); } catch (e) { list = []; }
  return { fighters: Array.isArray(list) ? list : [] };
}
/** Owner: the whole list, checked piece by piece. */
export async function erpFightersSet(ctx, payload) {
  const { setConfig } = await import('../lib/ext.js');
  if (ctx.s.role !== 'owner') throw new Error('Only the owner changes the fighters.');
  const src = payload && payload.fighters;
  if (!Array.isArray(src) || src.length > 24) throw new Error('Up to 24 fighters.');
  const out = src.map((f, i) => {
    const name = String(f && f.name || '').trim().replace(/\s+/g, ' ');
    if (!name || name.length > 24) throw new Error('Fighter ' + (i + 1) + ': a name up to 24 letters.');
    const move = String(f.move || '');
    if (!FIGHT_MOVES.includes(move)) throw new Error(name + ': which special move?');
    const color = String(f.color || '');
    if (!/^#[0-9a-f]{6}$/i.test(color)) throw new Error(name + ': a colour like #3366cc.');
    const h = f.head || {};
    const w = Number(h.w), hh = Number(h.h), pal = Array.isArray(h.pal) ? h.pal.map(String) : [], px = String(h.px || '');
    if (!(w >= 8 && w <= 40 && hh >= 8 && hh <= 48) || px.length !== w * hh) throw new Error(name + ': the face picture does not fit.');
    if (!pal.length || pal.length > 16 || pal.some((c) => !/^#[0-9a-f]{6}$/i.test(c))) throw new Error(name + ': the face colours do not fit.');
    const ok = new RegExp('^[.' + '0123456789abcdef'.slice(0, pal.length) + ']+$');
    if (!ok.test(px)) throw new Error(name + ': the face picture does not fit.');
    return { name, move, color: color.toLowerCase(), head: { w, h: hh, pal: pal.map((c) => c.toLowerCase()), px } };
  });
  await setConfig(ctx, 'fighters', JSON.stringify(out));
  return { fighters: out };
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
