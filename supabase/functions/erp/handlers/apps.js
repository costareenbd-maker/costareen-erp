// The Apps page: one place that lists every ability the ERP has beyond the core menu, with one switch each.
//
//   erpApps()                     the catalogue with its state for this person: provider on/off, hidden in this
//                                 company's menu, may this person open it (role), where its settings live
//   erpAppSet({key, on, scope})   scope 'all'  - the provider (platform admin): an app on or off for EVERY company
//                                 scope 'mine' - this company's owner: a menu screen (MENU) for everyone here ('all'),
//                                 only owners ('owner') or nobody here ('off') - payload.mode; staff cannot change it
//   appsState(deps, sql, biz)     what erpHello sends so the page builds its menu on first paint
//   appOff(deps, pubWhat)         the public router: is the page behind ?pub=<what> switched off by the provider?
//
// Core screens (Dashboard, New invoice, Sales, Customers, Products, Stock entry, Money, Settings) are not apps:
// nobody can switch them off. Platform is not an app either (platform admin only, as before).

import { getConfig, setConfig } from '../lib/ext.js';
import { platformAdmin, isPlatformAdmin } from './platform.js';
import { roleAtLeast } from '../allow.js';
import { qrDataUrl } from '../lib/qr.js';

const str = (v) => String(v == null ? '' : v).trim();

// kind 'screen': a view inside the ERP. kind 'page': a public page on the network (opens in a new tab).
// where: in which screen the app's own settings and switches sit (the owner kept asking where they were).
// view: the screen inside the ERP where the feature is run and set up (a tile opens it); path: its public page.
// Design desk and Ideas are run from Platform (provider only): a company's tile opens the public page.
// Market, Resell, Print jobs, Joint stock are ordinary menu screens (MENU below), not apps.
export const APPS = [
  { key: 'find', group: 'For customers', name: 'Find stock', view: 'market', tab: 'mine', path: 'find', what: 'Anyone searches a product or colour and sees which shops have it. Orders land under Web orders.', where: 'Market \u2192 What I share \u2192 Find stock public' },
  { key: 'choose', group: 'For customers', name: 'Colour finder', view: 'market', tab: 'mine', path: 'choose', what: 'Point the phone camera at a thing; the closest filament colours in stock are shown. Uses Find stock\u2019s data (one switch for both).', where: 'Market \u2192 What I share \u2192 Colour swatches', sameAs: 'find' },
  { key: 'check', group: 'For customers', name: 'Printer Passport', view: 'products', path: 'check', what: 'A buyer types a serial number and sees the warranty and the seller.', where: 'Products \u2192 Warranty rules' },
  { key: 'my', group: 'For customers', name: 'Customer page', view: 'customers', path: 'my', what: 'A customer\u2019s own page: orders, warranty, points. Opened from the link on the invoice.', where: 'Customers \u2192 Points rules, Refill reminders' },
  { key: 'doctor', group: 'For customers', name: 'Print Doctor', view: 'repairs', path: 'doctor', what: 'Printer problems and fixes, with settings that worked for other members.', where: 'Repairs \u2192 Print Doctor; Platform \u2192 cases' },
  { key: 'print', group: 'For customers', name: 'Get it printed', view: 'printjobs', tab: 'board', path: 'print', what: 'Anyone posts a file; print farms offer a price; the chosen farm prints and delivers.', where: 'Print jobs \u2192 Jobs board' },
  { key: 'quote', group: 'For customers', name: 'Print quote', view: 'printjobs', tab: 'requests', path: 'quote', what: 'A customer asks THIS shop for a print price.', where: 'Print jobs \u2192 Requests \u2192 Taking requests' },
  { key: 'design', group: 'For customers', name: 'Design desk', view: 'platform', path: 'design', what: 'Designers take sketches and repair-part requests; the part goes to a print farm.', where: 'Platform \u2192 Design desk' },
  // Only me (owner's rule, 8 Oct 2026): new features ship for the platform admin alone; a flag row enabled=true opens them to everyone
  { key: 'push', group: 'Only me', labs: true, name: 'What to push next', view: 'campaigns', what: 'On Campaigns: which products to advertise, which to clear out with an offer, which are rising, which would sell out.', where: 'Campaigns \u2192 What to push next' },
  { key: 'inbox', group: 'Only me', labs: true, name: 'Inbox', view: 'inbox', what: 'Every chat in one place - Messenger, Instagram, WhatsApp (official and linked-device), comments and your website chat - answered by an AI agent from your products, prices and stock; your team takes over when needed; chat orders become invoices.', where: 'Menu → Inbox' },
  { key: 'leads', group: 'Only me', labs: true, name: 'Leads', view: 'leads', what: 'Customers and suppliers to win, from Facebook / Instagram comments, chats, landing pages, Google, the map, LinkedIn, supplier sites and lists - in one place, with follow-ups.', where: 'Menu → Leads' },
  { key: 'engine', group: 'Only me', labs: true, name: 'Engine', view: 'engine', what: 'The Engine on your server does the work: ask anything in the Command Center (research, analysis, ads, content, leads); install skills from a list or a GitHub link and see which ones are used and useful.', where: 'Menu → Command Center, Menu → Skills' },
  { key: 'creators', group: 'Only me', labs: true, name: 'Creators', view: 'campaigns', what: 'On Campaigns: influencer sponsorships run for a brand - who got what filament, what they posted, the numbers, and the monthly report for the brand.', where: 'Campaigns → Creators' },
  { key: 'feedback', group: 'For customers', name: 'Feedback', view: 'app', what: 'Problems, complaints, ideas and praise from anyone who uses an ERP on this platform; the provider answers in one inbox.', where: 'Apps \u2192 Feedback' },
  { key: 'ideas', group: 'For customers', name: 'Ideas and updates', view: 'platform', path: 'ideas', what: 'Visitors post and vote on ideas for the ERP; you answer in public.', where: 'Platform \u2192 Ideas' },
];
// Menu screens an owner may take out of his own menu (Settings > Business > Menu). Core screens are not here.
export const MENU = [
  // in the menu's own order and groups (owner 15 Oct 2026: the list must be exactly what the menu shows; Profitability and
  // Maintenance now sit inside the Dashboard and Settings - their access is a person's ability under Settings > Users)
  { key: 'inbox', name: 'Inbox', group: 'Sell' }, { key: 'leads', name: 'Leads', group: 'Sell' }, { key: 'weborders', name: 'Web orders', group: 'Sell' }, { key: 'quotes', name: 'Quotations', group: 'Sell' },
  { key: 'preorders', name: 'Pre-orders', group: 'Sell' }, { key: 'repairs', name: 'Repairs', group: 'Sell' }, { key: 'printjobs', name: 'Print jobs', group: 'Sell' },
  { key: 'resell', name: 'Resell', group: 'Sell' }, { key: 'campaigns', name: 'Campaigns', group: 'Sell' },
  { key: 'shipments', name: 'Shipments', group: 'Goods' }, { key: 'suppliers', name: 'Suppliers', group: 'Goods' }, { key: 'costs', name: 'Product cost', group: 'Goods' },
  { key: 'market', name: 'Market', group: 'Goods' }, { key: 'joint', name: 'Joint stock', group: 'Goods' },
  { key: 'expenses', name: 'Expenses', group: 'Money' }, { key: 'commission', name: 'Commission', group: 'Money' }, { key: 'capital', name: 'Capital', group: 'Money' },
];
const MENU_KEY = Object.fromEntries(MENU.map((m) => [m.key, m]));
const BY_KEY = Object.fromEntries(APPS.map((a) => [a.key, a]));
const HIDEABLE = (k) => !!(MENU_KEY[k]);

// what a public call carries (?pub=...) -> the app it belongs to
const PUB_KEY = { find: 'find', shop: 'find', order: 'find', alert: 'find', check: 'check', register: 'check', owner: 'check', confirm: 'check', lite: 'check',
                  my: 'my', doctor: 'doctor', printjob: 'print', printquote: 'quote', printreq: 'quote', design: 'design', ideas: 'ideas', idea: 'ideas', ideavote: 'ideas' };

function ctl(deps, sql) { return (deps && deps.control) || sql; }

/** The provider's switches: {key: false} for every app switched off. */
async function offMap(deps, sql) {
  const off = {};
  for (const a of APPS) if (a.labs) off[a.key] = true;   // an "Only me" app is off until a flag row says enabled
  try {
    const rows = await ctl(deps, sql)`select key, enabled from erp_app_flags`;
    for (const r of rows) if (BY_KEY[r.key]) { if (r.enabled) delete off[r.key]; else off[r.key] = true; }
    return off;
  } catch (_) { return off; }   // the table is not there yet
}
/** 27 Oct 2026: the "Only me" apps are open to the shareholders of the platform admin's OWN business (the owner's rule:
 *  his shareholders see what he sees), not to other companies until the flag row says so. */
export const LABS_KEYS = APPS.filter((a) => a.labs).map((a) => a.key);
export async function labsOpen(deps, sql, biz, s) {
  if (!s || !roleAtLeast(s.role, 'shareholder') || (deps && deps.install && deps.install.bridged)) return false;
  try {
    const owners = await sql`select user_id from memberships where business_id = ${biz} and role = 'owner'`;
    for (const o of owners) if (await isPlatformAdmin(sql, o.user_id)) return true;
  } catch (_) { /* no answer = closed */ }
  return false;
}
/** leads-1: is an app switched off by the provider (an "Only me" app until its flag row says enabled)? */
export async function appIsOff(deps, sql, key, ctx) {
  const off = await offMap(deps, sql);
  if (off[key] && ctx && LABS_KEYS.includes(key) && await labsOpen(deps, sql, ctx.biz, ctx.s)) return false;
  return !!off[key];
}
/** The provider's menu switches: menu screens (MENU) switched off for EVERY company - rows 'menu:<key>' enabled=false. */
async function menuOffAll(deps, sql) {
  const off = {};
  try {
    const rows = await ctl(deps, sql)`select key, enabled from erp_app_flags where key like 'menu:%'`;
    for (const r of rows) { const k = str(r.key).slice(5); if (HIDEABLE(k) && !r.enabled) off[k] = true; }
  } catch (_) { /* the table is not there yet */ }
  return off;
}
const MODES = ['all', 'owner', 'off'];
/** This company's menu: {key: 'all' | 'owner' | 'off'} for the screens in MENU (missing = 'all'). */
function parseModes(raw, legacyHidden) {
  const out = {};
  try { const v = JSON.parse(str(raw) || '{}'); if (v && typeof v === 'object' && !Array.isArray(v)) for (const k of Object.keys(v)) if (HIDEABLE(k) && MODES.includes(v[k]) && v[k] !== 'all') out[k] = v[k]; } catch (_) { /* fresh */ }
  if (!Object.keys(out).length) {
    try { const v = JSON.parse(str(legacyHidden) || '[]'); if (Array.isArray(v)) for (const k of v) if (HIDEABLE(k)) out[k] = 'owner'; } catch (_) { /* none */ }
  }
  return out;
}
async function menuModes(ctx) { return parseModes(await getConfig(ctx, 'apps_menu', ''), await getConfig(ctx, 'apps_hidden', '')); }

/** What erpHello sends: the apps the provider switched off; this company's screens only owners see; the ones nobody here sees. */
/** The Inbox is sold by plan (122_inbox_plans.sql): a company with a plan row has it even while it is a trial app. */
async function hasInboxPlan(sql, biz) { try { return !!biz && (await sql`select 1 from inbox_plans where business_id = ${biz}`).length > 0; } catch (_) { return false; } }
export async function appsState(deps, sql, biz, getCfg, s) {
  const offM = await offMap(deps, sql);
  if (s && await labsOpen(deps, sql, biz, s)) for (const k of LABS_KEYS) delete offM[k];
  if (offM.inbox && await hasInboxPlan(sql, biz)) delete offM.inbox;
  const off = Object.keys(offM).concat(Object.keys(await menuOffAll(deps, sql)));   // a screen the provider took out is gone everywhere
  let modes = {};
  try { modes = parseModes(await getCfg('apps_menu'), await getCfg('apps_hidden')); } catch (_) { modes = {}; }
  return { off, hidden: Object.keys(modes).filter((k) => modes[k] === 'owner'), gone: Object.keys(modes).filter((k) => modes[k] === 'off') };
}

/** The public router asks before serving: is this page switched off by the provider? */
export async function appOff(deps, what) {
  const key = PUB_KEY[str(what)];
  if (!key) return false;
  const off = await offMap(deps, null);
  const a = BY_KEY[key];
  return !!(off[key] || (a && a.sameAs && off[a.sameAs]));
}

function pageUrl(deps, path) {
  const env = (deps && deps.installEnv) || {};
  const base = str(env.publicUrl) || str((deps && deps.google && deps.google.appUrl) || env.appUrl) || 'https://erp.costareen.com/';
  return base.replace(/\/?$/, '/') + path;
}

export async function erpApps(ctx) {
  const off = await offMap(ctx.deps, ctx.sql);
  if (off.inbox && await hasInboxPlan(ctx.sql, ctx.biz)) delete off.inbox;
  const forced = await menuOffAll(ctx.deps, ctx.sql);
  const modes = await menuModes(ctx);
  const admin = await platformAdmin(ctx);
  const owner = ctx.s.role === 'owner';
  const here = await labsOpen(ctx.deps, ctx.sql, ctx.biz, ctx.s);
  return {
    admin, owner,
    apps: APPS.map((a) => ({
      key: a.key, group: a.group, name: a.name, what: a.what, where: a.where,
      view: (a.view === 'platform' && !admin) ? '' : a.view, tab: a.tab || '',
      url: a.path ? pageUrl(ctx.deps, a.path) : '',
      on: !(off[a.key] || (a.sameAs && off[a.sameAs])),
      labs: !!a.labs,
      openHere: !!(a.labs && here),   // open to this business's shareholders whatever the provider's switch
      mode: HIDEABLE(a.key) ? (modes[a.key] || 'all') : '',
      hidden: modes[a.key] === 'owner',
      sameAs: a.sameAs || '',
    })),
    // Settings > Business > Menu: which menu screens this company shows
    // forced: the provider took this screen out of every company's menu (this company's own choice is kept for when it comes back)
    menu: MENU.map((m) => ({ key: m.key, name: m.name, group: m.group || '', mode: modes[m.key] || 'all', hidden: modes[m.key] === 'owner', off: !!off[m.key], forced: !!forced[m.key] })),
  };
}

export async function erpAppSet(ctx, payload) {
  const p = payload || {};
  const key = str(p.key), on = !!p.on, scope = p.scope === 'all' ? 'all' : 'mine';
  const mode = MODES.includes(p.mode) ? p.mode : (p.on === undefined ? 'all' : (on ? 'all' : 'owner'));   // the old on/off still means everyone / only owners
  const a = BY_KEY[key];
  if (scope === 'all' && !a && !HIDEABLE(key)) throw new Error('No such app.');
  if (scope === 'mine' && !HIDEABLE(key)) throw new Error(a ? 'A public page is not in the menu; the provider switches it on or off.' : 'That screen stays in the menu.');
  if (scope === 'all') {
    if (!(await platformAdmin(ctx))) throw new Error('Only the provider switches an app on or off for every company.');
    const flag = a ? key : 'menu:' + key;   // an app, or a menu screen for every company
    await ctl(ctx.deps, ctx.sql)`insert into erp_app_flags (key, enabled, updated_at, updated_by) values (${flag}, ${on}, now(), ${ctx.s.userId})
                                  on conflict (key) do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by`;
  } else {
    if (!ctx.s.role || !roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder changes this company’s menu.');
    if ((await menuOffAll(ctx.deps, ctx.sql))[key]) throw new Error('The provider has switched this screen off for every company.');
    if (key === 'inbox' && !(await hasInboxPlan(ctx.sql, ctx.biz))) {
      if (!(await platformAdmin(ctx))) throw new Error('The Inbox is not in the plan of this company yet - ask the provider.');
      await ctx.sql`insert into inbox_plans (business_id, plan_name, set_by) values (${ctx.biz}, 'Provider', ${ctx.s.userId}) on conflict (business_id) do nothing`;
    }
    const modes = await menuModes(ctx);
    if (mode === 'all') delete modes[key]; else modes[key] = mode;
    await setConfig(ctx, 'apps_menu', JSON.stringify(modes));
    await setConfig(ctx, 'apps_hidden', '[]');   // the old list is retired once a mode is set
  }
  return erpApps(ctx);
}


/** The share card on an app's screen: the public address and its QR. */
export async function erpAppQr(ctx, payload) {
  const a = BY_KEY[str(payload && payload.key)];
  if (!a || !a.path) throw new Error('No public page for that.');
  const url = pageUrl(ctx.deps, a.path);
  return { key: a.key, url, qr: qrDataUrl(url) };
}

// ---------------------------------------------------------------- Feedback and complaints
const KINDS = ['complaint', 'problem', 'idea', 'praise'], STATUSES = ['new', 'looking', 'fixed', 'wont'];
const fbRow = (r) => ({ id: Number(r.id), company: str(r.company), who: str(r.who), role: str(r.role), kind: str(r.kind), text: str(r.text), screen: str(r.screen),
                        contact: str(r.contact), status: str(r.status), reply: str(r.reply), at: r.created_at, updated: r.updated_at });

/** Anyone signed in to any company's ERP: send a report. Lands in the provider's inbox. */
export async function erpFeedbackSend(ctx, payload) {
  const p = payload || {};
  const kind = KINDS.includes(p.kind) ? p.kind : 'problem';
  const text = str(p.text).slice(0, 2000); if (text.length < 5) throw new Error('Write what happened, in a sentence or two.');
  const screen = str(p.screen).slice(0, 60), contact = str(p.contact).slice(0, 120);
  const c = ctl(ctx.deps, ctx.sql);
  const r = (await c`insert into erp_feedback (business_id, company, who, role, kind, text, screen, contact)
                     values (${ctx.biz}, ${str(ctx.s.businessName).slice(0, 120)}, ${str(ctx.s.name).slice(0, 80)}, ${str(ctx.s.role)}, ${kind}, ${text}, ${screen || null}, ${contact || null}) returning id`)[0];
  return { ok: true, id: Number(r.id), mine: await myFeedback(ctx) };
}
/** What this person sent before, with the provider's answers (so a company sees only its own). */
async function myFeedback(ctx) {
  const rows = await ctl(ctx.deps, ctx.sql)`select * from erp_feedback where business_id = ${ctx.biz} order by created_at desc limit 50`;
  return rows.map(fbRow);
}
export async function erpFeedback(ctx) {
  const admin = await platformAdmin(ctx);
  const out = { admin, mine: await myFeedback(ctx), inbox: [], counts: {} };
  if (admin) {
    const c = ctl(ctx.deps, ctx.sql);
    out.inbox = (await c`select * from erp_feedback order by (status = 'new') desc, created_at desc limit 300`).map(fbRow);
    for (const r of await c`select status, count(*)::int n from erp_feedback group by status`) out.counts[str(r.status)] = Number(r.n);
  }
  return out;
}
/** The provider: a status and a reply (the company that sent it sees the reply on its Feedback screen). */
export async function erpFeedbackSet(ctx, payload) {
  if (!(await platformAdmin(ctx))) throw new Error('Only the provider answers feedback.');
  const p = payload || {}, id = Math.round(Number(p.id) || 0);
  if (!id) throw new Error('Which report?');
  const status = STATUSES.includes(p.status) ? p.status : null, reply = p.reply === undefined ? null : str(p.reply).slice(0, 2000);
  const c = ctl(ctx.deps, ctx.sql);
  const r = (await c`update erp_feedback set status = coalesce(${status}, status), reply = coalesce(${reply}, reply), updated_at = now() where id = ${id} returning id`)[0];
  if (!r) throw new Error('That report is not here any more.');
  return erpFeedback(ctx);
}

export const HANDLERS = { erpApps, erpAppSet, erpAppQr, erpFeedback, erpFeedbackSend, erpFeedbackSet };
