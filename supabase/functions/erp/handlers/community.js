// Stage N1b (docs/NETWORK-BLUEPRINT.md section 4.5): the community base - what makes "made with its community" true.
//
// Public, no account: the ideas board (anyone proposes, anyone votes once, every idea shows new / planned / being
// built / done / declined and the platform's reply), the updates page (what changed, newest first, with the credit
// "from an idea by ..."), and credits (the guides, and who contributed what: ideas taken up, Print Doctor cases
// published, settings approved). The platform admin answers ideas, writes updates (and may post one inside every ERP
// as an announcement), and keeps the guides list.
//
// Public (passport.js pubRoute, rate limited per address):
//   GET  ?pub=ideas                       ideas, updates, credits
//   POST ?pub=idea      {title, text, name, contact, consent: true}
//   POST ?pub=ideavote  {id}
// Platform admin: erpPlatformCommunity, erpPlatformIdeaSet({id, status, reply, remove}),
//   erpPlatformUpdateAdd({title, text, ideaId, credit, announce, days}), erpPlatformUpdateRemove({id}),
//   erpPlatformGuideSet({id, name, area, active})

import { formatDate, num } from '../lib/time.js';
import { pubBase, limit } from './passport.js';

const str = (v) => String(v == null ? '' : v).trim();
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const enc = new TextEncoder();
const STATUS = ['new', 'planned', 'building', 'done', 'declined'];
export const CONSENT = 'My idea and my first name may be shown on the ideas board. My phone or e-mail is used only to ask me about the idea and is never shown.';
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }

function ideaRow(r, admin) {
  const o = { id: r.id, title: str(r.title), text: str(r.text), name: str(r.name), status: str(r.status), reply: str(r.reply), votes: num(r.votes), when: when(r.created_at), updated: when(r.updated_at) };
  if (admin) { o.contact = str(r.contact); o.removed = !!r.removed; }
  return o;
}
const RANK = { building: 0, planned: 1, new: 2, done: 3, declined: 4 };
async function ideasList(ctl, admin) {
  const rows = await ctl`select * from erp_ideas where ${admin ? ctl`true` : ctl`not removed`} order by created_at desc limit 500`;
  // being built first, then planned, new, done, not-for-now; inside a group the most voted, then the newest
  return rows.map((r, i) => ({ ...ideaRow(r, admin), _i: i })).sort((a, b) => (RANK[a.status] - RANK[b.status]) || (b.votes - a.votes) || (a._i - b._i))
    .slice(0, admin ? 500 : 200).map((o) => { delete o._i; return o; });
}
async function updatesList(ctl, admin) {
  const rows = await ctl`select u.*, i.name as idea_name from erp_updates u left join erp_ideas i on i.id = u.idea_id where ${admin ? ctl`true` : ctl`not u.removed`} order by u.published_at desc limit 100`;
  return rows.map((u) => ({ id: u.id, title: str(u.title), text: str(u.text), when: when(u.published_at), credit: str(u.credit) || (u.idea_name ? 'from an idea by ' + str(u.idea_name) : ''), ideaId: u.idea_id || null, removed: !!u.removed }));
}
async function credits(ctl) {
  const guides = (await ctl`select * from erp_guides where active order by since, name`).map((g) => ({ name: str(g.name), area: str(g.area), since: formatDate(new Date(g.since), 'MMM yyyy') }));
  const score = {};
  const add = (name, what) => { const k = str(name); if (!k) return; const o = score[k] || (score[k] = { name: k, ideas: 0, cases: 0, settings: 0 }); o[what]++; };
  for (const r of await ctl`select name from erp_ideas where not removed and status in ('planned', 'building', 'done')`) add(r.name, 'ideas');
  for (const r of await ctl`select credit from erp_doctor_tips`) add(str(r.credit).split(',')[0], 'cases');
  for (const r of await ctl`select name from erp_doctor_settings where status = 'approved'`) add(r.name, 'settings');
  const contributors = Object.values(score).map((o) => ({ ...o, total: o.ideas + o.cases + o.settings })).sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)).slice(0, 200);
  return { guides, contributors };
}
export async function board(deps, ip) {
  const ctl = deps.control; if (!ctl) throw new Error('The ideas board is not available on this server.');
  await limit(deps, ip, 'ideas', 120);
  const ideas = await ideasList(ctl, false);
  const counts = {}; for (const i of ideas) counts[i.status] = (counts[i.status] || 0) + 1;
  return { ideas, counts, statuses: STATUS, updates: await updatesList(ctl, false), credits: await credits(ctl), consent: CONSENT };
}
export async function propose(deps, body, ip) {
  const ctl = deps.control; if (!ctl) throw new Error('The ideas board is not available on this server.');
  await limit(deps, ip, 'idea', 5);
  const b = body || {};
  const title = str(b.title).slice(0, 120), text = str(b.text).slice(0, 1500), name = str(b.name).slice(0, 40), contact = str(b.contact).slice(0, 80);
  if (title.length < 5) throw new Error('A short title for the idea (at least 5 letters).');
  if (text.length < 15) throw new Error('Say what it should do and why, in a sentence or two.');
  if (name.length < 2) throw new Error('Your first name, for the credit.');
  if (b.consent !== true) throw new Error('Tick the line: your idea and first name may be shown.');
  const id = (await ctl`insert into erp_ideas (title, text, name, contact, consent) values (${title}, ${text}, ${name}, ${contact || null}, ${ctl.json({ at: new Date().toISOString(), text: CONSENT, ip: str(ip) })}) returning id`)[0].id;
  return { id, status: 'new' };
}
export async function vote(deps, body, ip) {
  const ctl = deps.control;
  await limit(deps, ip, 'ideavote', 60);
  const id = str(body && body.id);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Which idea?');
  const r = (await ctl`select id, removed from erp_ideas where id = ${id}::uuid`)[0];
  if (!r || r.removed) throw new Error('That idea is not on the board.');
  const h = await sha256hex('idea|' + str(ip));
  const ins = await ctl`insert into erp_idea_votes (idea_id, ip_hash) values (${id}::uuid, ${h}) on conflict do nothing returning idea_id`;
  if (!ins.length) return { id, already: true, votes: num((await ctl`select votes from erp_ideas where id = ${id}::uuid`)[0].votes) };
  const v = (await ctl`update erp_ideas set votes = (select count(*) from erp_idea_votes where idea_id = ${id}::uuid), updated_at = now() where id = ${id}::uuid returning votes`)[0];
  return { id, votes: num(v.votes) };
}
/** passport.js pubRoute hands the community routes here. */
export async function route(deps, what, method, params, body, ip) {
  if (what === 'ideas' && method === 'GET') return board(deps, ip);
  if (what === 'idea' && method === 'POST') return propose(deps, body, ip);
  if (what === 'ideavote' && method === 'POST') return vote(deps, body, ip);
  return null;
}

// ---------------------------------------------------------------- platform admin
async function needAdmin(ctx) {
  const r = await ctx.sql`select 1 from platform_admins where user_id = ${ctx.s.userId}`;
  if (!r.length) throw new Error('Only the platform admin keeps the ideas board.');
}
export async function erpPlatformCommunity(ctx) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control; if (!ctl) throw new Error('This server has no ideas board.');
  const ideas = await ideasList(ctl, true);
  return { ideas, newIdeas: ideas.filter((i) => i.status === 'new' && !i.removed).length, updates: await updatesList(ctl, true), guides: (await ctl`select * from erp_guides order by active desc, since, name`).map((g) => ({ id: g.id, name: str(g.name), area: str(g.area), since: formatDate(new Date(g.since), 'yyyy-MM-dd'), active: !!g.active })),
    statuses: STATUS, boardUrl: pubBase(ctx.deps).check.replace(/check$/, '') + 'ideas' };
}
export async function erpPlatformIdeaSet(ctx, payload) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control, p = payload || {};
  const r = (await ctl`select * from erp_ideas where id = ${str(p.id)}::uuid`)[0];
  if (!r) throw new Error('No such idea.');
  if (p.remove) { await ctl`update erp_ideas set removed = true, updated_at = now() where id = ${r.id}`; return { removed: true }; }
  const status = STATUS.includes(p.status) ? p.status : str(r.status);
  const reply = p.reply === undefined ? r.reply : (str(p.reply).slice(0, 1000) || null);
  await ctl`update erp_ideas set status = ${status}, reply = ${reply}, removed = false, updated_at = now() where id = ${r.id}`;
  return { status, reply: str(reply) };
}
export async function erpPlatformUpdateAdd(ctx, payload) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control, p = payload || {};
  const title = str(p.title).slice(0, 120), text = str(p.text).slice(0, 2000);
  if (title.length < 3) throw new Error('A title for the update.');
  if (text.length < 10) throw new Error('Say what changed, in plain words.');
  let ideaId = null, credit = str(p.credit).slice(0, 80) || null;
  if (/^[0-9a-f-]{36}$/i.test(str(p.ideaId))) {
    const i = (await ctl`select id, name, status from erp_ideas where id = ${str(p.ideaId)}::uuid`)[0];
    if (i) { ideaId = i.id; if (!credit) credit = 'from an idea by ' + str(i.name); if (p.markDone !== false) await ctl`update erp_ideas set status = 'done', updated_at = now() where id = ${i.id}`; }
  }
  const id = (await ctl`insert into erp_updates (title, text, idea_id, credit) values (${title}, ${text}, ${ideaId}, ${credit}) returning id`)[0].id;
  if (p.announce) {
    const days = Math.max(0, Math.min(90, Number(p.days) || 7));
    await ctx.sql`insert into erp_news (text, level, until) values (${(title + ': ' + text).slice(0, 400)}, 'info', ${days ? new Date(Date.now() + days * 86400e3) : null})`;
  }
  return { id, announced: !!p.announce };
}
export async function erpPlatformUpdateRemove(ctx, payload) {
  await needAdmin(ctx);
  const r = await ctx.deps.control`update erp_updates set removed = true where id = ${str(payload && payload.id)}::uuid returning id`;
  if (!r.length) throw new Error('No such update.');
  return { removed: true };
}
export async function erpPlatformGuideSet(ctx, payload) {
  await needAdmin(ctx);
  const ctl = ctx.deps.control, p = payload || {};
  const name = str(p.name).slice(0, 60), area = str(p.area).slice(0, 80);
  if (/^[0-9a-f-]{36}$/i.test(str(p.id))) {
    const r = await ctl`update erp_guides set name = coalesce(nullif(${name}, ''), name), area = ${area || null}, active = ${p.active !== false} where id = ${str(p.id)}::uuid returning id`;
    if (!r.length) throw new Error('No such guide.');
    return { id: r[0].id };
  }
  if (name.length < 2) throw new Error('The guide’s name.');
  const id = (await ctl`insert into erp_guides (name, area) values (${name}, ${area || null}) returning id`)[0].id;
  return { id };
}
export const HANDLERS = { erpPlatformCommunity, erpPlatformIdeaSet, erpPlatformUpdateAdd, erpPlatformUpdateRemove, erpPlatformGuideSet };
