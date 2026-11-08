// factory-1 (9 Nov 2026): the weekly ad factory - the autopilot's B3 ("every week new ads, you only press").
// Built on what is there: What to push (push.js) chooses the products, the ad photo maker (socialmake.js) makes the
// pictures on ChatGPT, posts go out through Content (social.js), paid ads are made PAUSED through Paid ads (ads.js).
//
//   Monday at the hour (Dhaka): a week is planned - up to N products (advertise, rising, clear-out), each with 2
//     different angles (hook + post text + photo direction) written by the AI; one picture per angle starts.
//   The owner presses ONE button, "Approve the week": every ready angle becomes a Facebook post, scheduled over
//     Tuesday-Thursday at 11:00 and 19:00 (two a day - the Content rule).
//   Friday at the hour: the posts' figures are scored; the best two become paid ads made PAUSED (messages, the
//     factory's budget) when an ad account is set. The owner starts them with one button ("Start the winners").
//   Money is never spent and nothing goes public without the owner's button.
//
//   erpFactory()                    the settings, this week and the last weeks with their angles (manager)
//   erpFactorySet({on, hour, products, budget, days})   owner / shareholder
//   erpFactoryAct({action, week, item})   make (plan this week now) | approve | skip (an angle) | review (score now) |
//                                    start (start the paused winners) - owner / shareholder for all but make
//   factoryTick(ctx)                the minute timer (jobs.js 'inbox')

import { roleAtLeast } from '../allow.js';
import { num, formatDate } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { ai, anyAi } from '../lib/ai.js';
import { erpPushList } from './push.js';
import { factoryPhoto, SCENE_KEYS } from './socialmake.js';
import { erpSocialSave, erpSocialAct } from './social.js';
import { erpAdsPlan, erpAdsAct } from './ads.js';
import { tasteText } from './taste.js';

const str = (v) => String(v == null ? '' : v).trim();
const DEF = { on: false, hour: 10, products: 4, budget: 200, days: 5 };
const DHAKA = 6 * 3600e3;

function need(ctx, role) { if (!roleAtLeast(ctx.s.role, role || 'manager')) throw new Error('Your account does not have permission for this. If you need this, ask the owner to open it for you (Settings > Users).'); }
async function settings(ctx) {
  let s = {}; try { s = JSON.parse(str(await getConfig(ctx, 'ad_factory', '')) || '{}') || {}; } catch (_) { s = {}; }
  return { ...DEF, ...s };
}
/** Dhaka calendar of a moment: {day 0=Sun..6, hour, date 'yyyy-MM-dd', week 'yyyy-Www' (ISO)} */
function dhaka(t) {
  const d = new Date(t.getTime() + DHAKA);
  const day = d.getUTCDay(), hour = d.getUTCHours();
  const th = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 3 - ((day + 6) % 7));   // the ISO week's Thursday
  const y = new Date(th).getUTCFullYear(), jan4 = Date.UTC(y, 0, 4);
  const firstThu = jan4 + (3 - ((new Date(jan4).getUTCDay() + 6) % 7)) * 864e5;
  const w = 1 + Math.round((th - firstThu) / (7 * 864e5));
  return { day, hour, date: d.toISOString().slice(0, 10), week: y + '-W' + String(w).padStart(2, '0') };
}
/** The Dhaka time `hour`:00 on the next weekday `day` (2 = Tuesday) on or after `from`, as a real moment. */
function nextAt(from, day, hour) {
  const d = new Date(from.getTime() + DHAKA);
  const add = (day - d.getUTCDay() + 7) % 7;
  let t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + add, hour) - DHAKA;
  if (t <= from.getTime() + 10 * 60e3) t += 7 * 864e5;
  return new Date(t);
}

const itemView = (i, assets) => {
  const a = assets[str(i.asset_id)] || null;
  return { id: i.id, sku: i.sku, name: i.name, angle: i.angle, hook: i.hook, caption: i.caption, scene: i.scene, state: i.state,
           photo: a ? { id: a.id, status: a.status, file: a.file, error: str(a.error) } : null, postId: i.post_id, campaignId: i.campaign_id,
           score: i.score || null, why: str(i.why), error: str(i.error) };
};
async function weekView(ctx, w) {
  const items = await ctx.tx`select * from ad_factory_items where week_id = ${w.id} order by created_at, id`;
  const ids = items.map((i) => i.asset_id).filter(Boolean);
  const assets = {};
  if (ids.length) for (const a of await ctx.tx`select id, status, file, error from social_assets where business_id = ${ctx.biz} and id = any(${ids})`) assets[a.id] = a;
  const posts = {};
  const pids = items.map((i) => i.post_id).filter(Boolean);
  if (pids.length) for (const p of await ctx.tx`select id, state, scheduled_at, published_at from social_posts where id = any(${pids})`) posts[p.id] = p;
  return { id: w.id, week: w.week, status: w.status, made: formatDate(new Date(w.created_at), 'd MMM'), approvedBy: str(w.approved_by), error: str(w.error),
           items: items.map((i) => ({ ...itemView(i, assets), post: posts[i.post_id] ? { state: posts[i.post_id].state, at: formatDate(new Date(posts[i.post_id].scheduled_at || posts[i.post_id].published_at || w.created_at), 'EEE d MMM h:mm a') } : null })) };
}

export async function erpFactory(ctx) {
  need(ctx);
  const s = await settings(ctx);
  const weeks = await ctx.tx`select * from ad_factory_weeks where business_id = ${ctx.biz} order by created_at desc limit 4`;
  const out = [];
  for (const w of weeks) out.push(await weekView(ctx, w));
  let adAccount = false;
  try { adAccount = !!(JSON.parse(str(await getConfig(ctx, 'ads_settings', '')) || '{}') || {}).account; } catch (_) { adAccount = false; }
  return { ...s, ai: await anyAi(ctx), adAccount, thisWeek: dhaka(ctx.now).week, weeks: out };
}
export async function erpFactorySet(ctx, payload) {
  need(ctx, 'shareholder');
  const p = payload || {}, s = await settings(ctx);
  if (p.on !== undefined) s.on = !!p.on;
  if (p.hour !== undefined) { const h = Math.round(num(p.hour)); if (!(h >= 0 && h <= 23)) throw new Error('The hour is 0 to 23.'); s.hour = h; }
  if (p.products !== undefined) { const n = Math.round(num(p.products)); if (!(n >= 1 && n <= 6)) throw new Error('1 to 6 products a week.'); s.products = n; }
  if (p.budget !== undefined) { const b = Math.round(num(p.budget)); if (!(b >= 50)) throw new Error('The daily budget of a winner is at least 50.'); s.budget = b; }
  if (p.days !== undefined) { const d = Math.round(num(p.days)); if (!(d >= 1 && d <= 30)) throw new Error('A winner runs 1 to 30 days.'); s.days = d; }
  await setConfig(ctx, 'ad_factory', JSON.stringify(s));
  return erpFactory(ctx);
}

/** The products of the week: advertise first, then rising, then one clear-out; no repeats, at most n. */
async function choose(ctx, n) {
  const L = await erpPushList(ctx);
  const seen = new Set(), out = [];
  const add = (r, kind) => { const k = str(r.sku).toLowerCase(); if (!k || seen.has(k) || out.length >= n) return; seen.add(k); out.push({ ...r, kind }); };
  for (const r of L.rising.slice(0, 1)) add(r, 'rising');
  for (const r of L.advertise) add(r, 'advertise');
  for (const r of L.clear.slice(0, 1)) add(r, 'clear');
  for (const r of L.rising) add(r, 'rising');
  return out.slice(0, n);
}
async function anglesFor(ctx, p, shop) {
  const facts = 'Product: ' + p.name + '. Price: ৳' + Math.round(num(p.kind === 'clear' && p.offer ? p.offer : p.sell)) + (p.kind === 'clear' && p.offer ? ' (offer; was ৳' + Math.round(num(p.sell)) + ')' : '') +
    '. Why this week: ' + str(p.why) + '. (In stock - never say how many.)';
  const r = await ai(ctx, { purpose: 'ad-factory', json: true, temperature: 0.85, maxTokens: 1400,
    system: (await tasteText(ctx, 'photo') ? (await tasteText(ctx, 'photo')) + '\n\n' : '') + 'You are the ad maker of ' + shop + ', a shop in Bangladesh. For one product you plan TWO clearly different ad ideas (different angle, not just a different call to action): ' +
      'e.g. demo of use, price and value, comparison, unboxing, a customer\'s problem it solves, the maker\'s result. Each gets a hook (the first line that stops the scroll), the post text and ' +
      'a minimal, human-looking photo direction. Plain warm words like a real shop owner, no hype words, at most one emoji, the price in taka, one clear action (inbox / WhatsApp / order). ' +
      'Never invent specs, discounts or deadlines.',
    messages: [{ role: 'user', content: [{ type: 'text', text: facts + '\nScenes: ' + SCENE_KEYS.join(', ') + '.\nAnswer JSON: {"angles":[{"angle":"short name","hook":"first line","caption":"the post in Bangla (everyday words; product names may stay English), 2-5 short lines, starting with the hook","scene":"one scene key","direction":"one sentence for the photographer, max 30 words","why":"why it should work, one line"}, {...}]}' }] }] });
  let j = r.json; if (!j) { try { j = JSON.parse(str(r.text).replace(/^```(json)?|```$/g, '')); } catch (_) { j = {}; } }
  return (Array.isArray(j && j.angles) ? j.angles : []).slice(0, 2).filter((a) => str(a.caption));
}
/** Plan the week: products, angles, pictures. */
async function makeWeek(ctx, s, week) {
  if (!(await anyAi(ctx))) throw new Error('The ad factory needs the AI writer (Settings > AI brain).');
  const w = (await ctx.tx`insert into ad_factory_weeks (business_id, week, status) values (${ctx.biz}, ${week}, 'planning')
                         on conflict (business_id, week) do nothing returning *`)[0];
  if (!w) throw new Error('This week is planned already.');
  const shop = str(((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0] || {}).name) || 'Shop';
  const prods = await choose(ctx, s.products);
  let n = 0;
  for (const p of prods) {
    let angles = [];
    try { angles = await anglesFor(ctx, p, shop); } catch (e) { angles = []; }
    for (const a of angles) {
      await ctx.tx`insert into ad_factory_items (business_id, week_id, sku, name, kind, angle, hook, caption, scene, why, asset_id, state, error)
                   values (${ctx.biz}, ${w.id}, ${p.sku}, ${p.name}, ${p.kind}, ${str(a.angle).slice(0, 60)}, ${str(a.hook).slice(0, 200)}, ${str(a.caption).slice(0, 1500)},
                           ${SCENE_KEYS.includes(str(a.scene)) ? str(a.scene) : 'minimal'}, ${str(a.why).slice(0, 300)}, ${null}, 'photo', ${null})`;
      n++;
    }
  }
  await ctx.tx`update ad_factory_weeks set status = ${n ? 'ready' : 'empty'}, error = ${n ? null : 'No product to push this week (What to push is empty) or the AI gave no ideas.'}, updated_at = now() where id = ${w.id}`;
  await photoPump(ctx);
  return w.id;
}
/** factory-2: ONE ChatGPT picture at a time. The picture server makes them one after another and the upload address it is
 *  given expires within minutes, so a picture is asked for only when the previous one is done. A picture that failed
 *  because its address expired is asked for once more. No ChatGPT / no product photo: the angle uses the product's photo. */
async function photoPump(ctx) {
  const busy = (await ctx.tx`select count(*)::int n from ad_factory_items i join social_assets a on a.id = i.asset_id where i.business_id = ${ctx.biz} and i.state = 'photo' and a.status = 'rendering'`)[0].n;
  if (busy) return 'busy';
  // a picture whose upload address expired: once more
  for (const it of await ctx.tx`select i.* from ad_factory_items i join social_assets a on a.id = i.asset_id where i.business_id = ${ctx.biz} and i.state = 'photo' and a.status = 'failed'
                                 and coalesce(i.error, '') not like '%retried%' and coalesce(a.error, '') ~* 'InvalidJWT|exp|expired|upload 4' order by i.created_at limit 1`) {
    await ctx.tx`update ad_factory_items set asset_id = null, error = 'picture retried' where id = ${it.id}`;
  }
  const next = (await ctx.tx`select i.* from ad_factory_items i join ad_factory_weeks w on w.id = i.week_id where i.business_id = ${ctx.biz} and i.state = 'photo' and i.asset_id is null
                              and w.status in ('ready', 'approving') order by i.created_at, i.id limit 1`)[0];
  if (!next) return 'none';
  let asset = null, err = '';
  try { asset = await factoryPhoto(ctx, { sku: next.sku, scene: next.scene, direction: next.why, title: next.name + ' · ' + str(next.angle).slice(0, 40), meta: { factory: true, caption: str(next.caption).slice(0, 1200), hook: str(next.hook).slice(0, 200) } }); }
  catch (e) { err = str(e && e.message).slice(0, 200); }
  if (asset) await ctx.tx`update ad_factory_items set asset_id = ${asset.id} where id = ${next.id}`;
  else await ctx.tx`update ad_factory_items set state = 'ready', error = ${err || null} where id = ${next.id}`;   // the product's own photo will do
  return asset ? 'started' : 'own photo';
}
/** The media of an angle: its ChatGPT picture when ready, else the product's own photo. */
async function mediaOf(ctx, it) {
  if (it.state === 'photo' && !it.asset_id) return null;          // its picture is not started yet (one at a time)
  if (it.asset_id) {
    const a = (await ctx.tx`select status, file from social_assets where id = ${it.asset_id}`)[0];
    if (a && a.status === 'ready') return [{ kind: 'image', file: a.file, name: it.name }];
    if (a && a.status === 'rendering') return null;            // not yet
  }
  const p = (await ctx.tx`select photo, image_link from products where business_id = ${ctx.biz} and lower(sku) = ${str(it.sku).toLowerCase()}`)[0] || {};
  if (str(p.photo)) return [{ kind: 'image', file: 'products/' + str(p.photo), name: it.name }];
  if (str(p.image_link)) return [{ kind: 'image', file: str(p.image_link), name: it.name }];
  return [];
}
async function approve(ctx, w) {
  if (!['ready', 'planning', 'approving'].includes(w.status)) throw new Error('This week is ' + w.status + '.');
  const items = await ctx.tx`select * from ad_factory_items where week_id = ${w.id} and state in ('photo', 'ready') order by created_at, id`;
  const slots = [];
  for (const day of [2, 3, 4]) for (const h of [11, 19]) slots.push(nextAt(ctx.now, day, h));
  slots.sort((a, b) => a - b);
  let k = 0, made = 0, waiting = 0;
  for (const it of items) {
    const media = await mediaOf(ctx, it);
    if (media === null) { waiting++; continue; }                // its picture is still being made: approved later by the timer
    if (k >= slots.length) { await ctx.tx`update ad_factory_items set state = 'skipped', error = 'More angles than the six slots of the week.' where id = ${it.id}`; continue; }
    try {
      const sv = await erpSocialSave(ctx, { sku: it.sku, title: it.name + ' · ' + it.angle, media, captions: { facebook: it.caption, instagram: it.caption }, targets: { facebook: true }, approved: true });
      await erpSocialAct(ctx, { id: sv.post.id, action: 'schedule', at: slots[k].toISOString(), force: false });
      await ctx.tx`update ad_factory_items set state = 'posted', post_id = ${sv.post.id}, error = null where id = ${it.id}`;
      k++; made++;
    } catch (e) { await ctx.tx`update ad_factory_items set error = ${str(e && e.message).slice(0, 200)} where id = ${it.id}`; }
  }
  await ctx.tx`update ad_factory_weeks set status = ${waiting ? 'approving' : 'testing'}, approved_by = coalesce(approved_by, ${ctx.s.name}), approved_at = coalesce(approved_at, now()), updated_at = now() where id = ${w.id}`;
  return { made, waiting };
}
/** How well a published post did: engagement per reach (clicks, comments and shares count most). */
function scoreOf(st) {
  const f = (st && st.facebook) || {}, g = (st && st.instagram) || {};
  const acts = num(f.reactions) + num(g.likes) + 3 * (num(f.comments) + num(g.comments)) + 5 * (num(f.shares) + num(g.shares) + num(g.saved)) + 2 * num(f.clicks);
  const reach = num(f.reach) + num(g.reach);
  return { acts, reach, rate: reach > 0 ? Math.round(acts / reach * 1000) / 10 : 0 };
}
async function review(ctx, w, s) {
  const items = await ctx.tx`select i.*, p.state as post_state, p.stats from ad_factory_items i left join social_posts p on p.id = i.post_id where i.week_id = ${w.id} and i.state = 'posted'`;
  const scored = items.filter((i) => i.post_state === 'published').map((i) => ({ i, sc: scoreOf(i.stats) }));
  for (const x of scored) await ctx.tx`update ad_factory_items set score = ${ctx.tx.json(x.sc)} where id = ${x.i.id}`;
  scored.sort((a, b) => b.sc.rate - a.sc.rate || b.sc.acts - a.sc.acts);
  const winners = scored.filter((x) => x.sc.acts > 0).slice(0, 2);
  let adAccount = false;
  try { adAccount = !!(JSON.parse(str(await getConfig(ctx, 'ads_settings', '')) || '{}') || {}).account; } catch (_) { adAccount = false; }
  for (const x of winners) {
    let campId = null, err = '';
    if (adAccount) {
      try { const r = await erpAdsPlan(ctx, { postId: x.i.post_id, objective: 'messages', dailyBudget: s.budget, days: s.days, targeting: {}, name: 'Factory ' + w.week + ' · ' + x.i.name }); campId = r.campaign && r.campaign.id; }
      catch (e) { err = str(e && e.message).slice(0, 200); }
    }
    await ctx.tx`update ad_factory_items set state = 'winner', campaign_id = ${campId}, error = ${err || (adAccount ? null : 'No ad account yet (Paid ads > Settings): boost it by hand.')} where id = ${x.i.id}`;
  }
  for (const x of scored) if (!winners.includes(x)) await ctx.tx`update ad_factory_items set state = 'tested' where id = ${x.i.id}`;
  await ctx.tx`update ad_factory_weeks set status = 'reviewed', updated_at = now() where id = ${w.id}`;
  return { scored: scored.length, winners: winners.length };
}

export async function erpFactoryAct(ctx, payload) {
  need(ctx);
  const p = payload || {}, action = str(p.action), s = await settings(ctx);
  if (action === 'make') { await makeWeek(ctx, s, dhaka(ctx.now).week); return erpFactory(ctx); }
  need(ctx, 'shareholder');
  const w = (await ctx.tx`select * from ad_factory_weeks where business_id = ${ctx.biz} and id = ${str(p.week)}`)[0];
  if (!w) throw new Error('That week was not found.');
  if (action === 'approve') { const r = await approve(ctx, w); return { ...(await erpFactory(ctx)), done: r }; }
  if (action === 'skip') {
    const r = await ctx.tx`update ad_factory_items set state = 'skipped' where week_id = ${w.id} and id = ${str(p.item)} and state in ('photo', 'ready') returning id`;
    if (!r.length) throw new Error('Only an angle that is not posted yet can be skipped.');
    return erpFactory(ctx);
  }
  if (action === 'review') { if (w.status !== 'testing' && w.status !== 'approving') throw new Error('The week is ' + w.status + '.'); const r = await review(ctx, w, s); return { ...(await erpFactory(ctx)), done: r }; }
  if (action === 'start') {
    const items = await ctx.tx`select campaign_id from ad_factory_items where week_id = ${w.id} and state = 'winner' and campaign_id is not null`;
    if (!items.length) throw new Error('No paused winner to start.');
    let started = 0; const errs = [];
    for (const it of items) { try { await erpAdsAct(ctx, { id: it.campaign_id, action: 'start' }); started++; } catch (e) { errs.push(str(e && e.message)); } }
    return { ...(await erpFactory(ctx)), done: { started, errors: errs } };
  }
  throw new Error('Which action?');
}

/** Every minute: Monday plans the week, pictures that finish are posted once the week is approved, Friday reviews. */
export async function factoryTick(ctx) {
  const s = await settings(ctx);
  if (!s.on) return 'off';
  const d = dhaka(ctx.now), out = [];
  try { const pm = await photoPump(ctx); if (pm === 'started' || pm === 'own photo') out.push('picture ' + pm); } catch (e) { out.push('picture: ' + str(e && e.message)); }
  // the approved week: angles whose picture finished after the approval are scheduled now
  for (const w of await ctx.tx`select * from ad_factory_weeks where business_id = ${ctx.biz} and status = 'approving'`) { const r = await approve(ctx, w); out.push('approved+' + r.made); }
  if (d.hour < s.hour) return out.join(' ') || 'waiting';
  if (d.day === 1 && !(await ctx.tx`select 1 from ad_factory_weeks where business_id = ${ctx.biz} and week = ${d.week}`).length) {
    try { await makeWeek(ctx, s, d.week); out.push('planned ' + d.week); } catch (e) { out.push('plan failed: ' + str(e && e.message)); }
  }
  if (d.day === 5) for (const w of await ctx.tx`select * from ad_factory_weeks where business_id = ${ctx.biz} and status = 'testing'`) { const r = await review(ctx, w, s); out.push('reviewed ' + w.week + ' ' + r.winners + ' winner(s)'); }
  return out.join(' ') || 'nothing due';
}

export const HANDLERS = { erpFactory, erpFactorySet, erpFactoryAct };
