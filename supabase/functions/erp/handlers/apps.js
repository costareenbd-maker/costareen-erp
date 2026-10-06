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
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();

// kind 'screen': a view inside the ERP. kind 'page': a public page on the network (opens in a new tab).
// where: in which screen the app's own settings and switches sit (the owner kept asking where they were).
// view: the screen inside the ERP where the feature is run and set up (a tile opens it); path: its public page.
// Design desk and Ideas are run from Platform (provider only): a company's tile opens the public page.
export const APPS = [
  { key: 'find', group: 'For customers', name: 'Find stock', view: 'market', tab: 'mine', path: 'find', what: 'Anyone searches a product or colour and sees which shops have it. Orders land under Web orders.', where: 'Market \u2192 What I share \u2192 Find stock public' },
  { key: 'choose', group: 'For customers', name: 'Colour finder', view: 'market', tab: 'mine', path: 'choose', what: 'Point the phone camera at a thing; the closest filament colours in stock are shown. Uses Find stock\u2019s data (one switch for both).', where: 'Market \u2192 What I share \u2192 Colour swatches', sameAs: 'find' },
  { key: 'check', group: 'For customers', name: 'Printer Passport', view: 'products', path: 'check', what: 'A buyer types a serial number and sees the warranty and the seller.', where: 'Products \u2192 Warranty rules' },
  { key: 'my', group: 'For customers', name: 'Customer page', view: 'customers', path: 'my', what: 'A customer\u2019s own page: orders, warranty, points. Opened from the link on the invoice.', where: 'Customers \u2192 Points rules, Refill reminders' },
  { key: 'doctor', group: 'For customers', name: 'Print Doctor', view: 'repairs', path: 'doctor', what: 'Printer problems and fixes, with settings that worked for other members.', where: 'Repairs \u2192 Print Doctor; Platform \u2192 cases' },
  { key: 'print', group: 'For customers', name: 'Get it printed', view: 'printjobs', tab: 'board', path: 'print', what: 'Anyone posts a file; print farms offer a price; the chosen farm prints and delivers.', where: 'Print jobs \u2192 Jobs board' },
  { key: 'quote', group: 'For customers', name: 'Print quote', view: 'printjobs', tab: 'requests', path: 'quote', what: 'A customer asks THIS shop for a print price.', where: 'Print jobs \u2192 Requests \u2192 Taking requests' },
  { key: 'design', group: 'For customers', name: 'Design desk', view: 'platform', path: 'design', what: 'Designers take sketches and repair-part requests; the part goes to a print farm.', where: 'Platform \u2192 Design desk' },
  { key: 'ideas', group: 'For customers', name: 'Ideas and updates', view: 'platform', path: 'ideas', what: 'Visitors post and vote on ideas for the ERP; you answer in public.', where: 'Platform \u2192 Ideas' },
  { key: 'market', group: 'Between shops', name: 'Market', view: 'market', what: 'Other shops\u2019 stock: ask for prices, buy, post what you are looking for. A buying shop is a customer with source \u201cMarket\u201d.', where: 'Market \u2192 What I share' },
  { key: 'resell', group: 'Between shops', name: 'Resell', view: 'resell', what: 'Sell a supplier\u2019s stock to your own customers at your own price; the supplier packs and ships, you earn a commission.', where: 'Market \u2192 What I share \u2192 Resellers' },
  { key: 'printjobs', group: 'Between shops', name: 'Print jobs', view: 'printjobs', what: 'For a shop that prints for customers: every job, its true cost, the printers and spools.', where: 'Print jobs \u2192 Rates, Requests' },
  { key: 'joint', group: 'Between shops', name: 'Joint stock', view: 'joint', what: 'Goods you and a partner company own together, sold by both, settled at month end.', where: 'Platform \u2192 Company copies (the provider switches it on per company)' },
];
// Menu screens an owner may take out of his own menu (Settings > Business > Menu). Core screens are not here.
export const MENU = [
  { key: 'weborders', name: 'Web orders' }, { key: 'quotes', name: 'Quotations' }, { key: 'repairs', name: 'Repairs' },
  { key: 'printjobs', name: 'Print jobs' }, { key: 'resell', name: 'Resell' }, { key: 'campaigns', name: 'Campaigns' },
  { key: 'suppliers', name: 'Suppliers' }, { key: 'costs', name: 'Product cost' }, { key: 'market', name: 'Market' },
  { key: 'joint', name: 'Joint stock' }, { key: 'profit', name: 'Profitability' }, { key: 'expenses', name: 'Expenses' },
  { key: 'capital', name: 'Capital' }, { key: 'tools', name: 'Maintenance' },
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
  try {
    const rows = await ctl(deps, sql)`select key, enabled from erp_app_flags`;
    const off = {};
    for (const r of rows) if (!r.enabled && BY_KEY[r.key]) off[r.key] = true;
    return off;
  } catch (_) { return {}; }   // the table is not there yet: everything on
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
export async function appsState(deps, sql, biz, getCfg) {
  const off = Object.keys(await offMap(deps, sql));
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
  const modes = await menuModes(ctx);
  const admin = await platformAdmin(ctx);
  const owner = ctx.s.role === 'owner';
  return {
    admin, owner,
    apps: APPS.map((a) => ({
      key: a.key, group: a.group, name: a.name, what: a.what, where: a.where,
      view: (a.view === 'platform' && !admin) ? '' : a.view, tab: a.tab || '',
      url: a.path ? pageUrl(ctx.deps, a.path) : '',
      on: !(off[a.key] || (a.sameAs && off[a.sameAs])),
      mode: HIDEABLE(a.key) ? (modes[a.key] || 'all') : '',
      hidden: modes[a.key] === 'owner',
      sameAs: a.sameAs || '',
    })),
    // Settings > Business > Menu: which menu screens this company shows
    menu: MENU.map((m) => ({ key: m.key, name: m.name, mode: modes[m.key] || 'all', hidden: modes[m.key] === 'owner', off: !!off[m.key] })),
  };
}

export async function erpAppSet(ctx, payload) {
  const p = payload || {};
  const key = str(p.key), on = !!p.on, scope = p.scope === 'all' ? 'all' : 'mine';
  const mode = MODES.includes(p.mode) ? p.mode : (p.on === undefined ? 'all' : (on ? 'all' : 'owner'));   // the old on/off still means everyone / only owners
  const a = BY_KEY[key];
  if (scope === 'all' && !a) throw new Error('No such app.');
  if (scope === 'mine' && !HIDEABLE(key)) throw new Error(a ? 'A public page is not in the menu; the provider switches it on or off.' : 'That screen stays in the menu.');
  if (scope === 'all') {
    if (!(await platformAdmin(ctx))) throw new Error('Only the provider switches an app on or off for every company.');
    await ctl(ctx.deps, ctx.sql)`insert into erp_app_flags (key, enabled, updated_at, updated_by) values (${key}, ${on}, now(), ${ctx.s.userId})
                                  on conflict (key) do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by`;
  } else {
    if (!ctx.s.role || ctx.s.role !== 'owner') throw new Error('Only an owner changes this company’s menu.');
    const modes = await menuModes(ctx);
    if (mode === 'all') delete modes[key]; else modes[key] = mode;
    await setConfig(ctx, 'apps_menu', JSON.stringify(modes));
    await setConfig(ctx, 'apps_hidden', '[]');   // the old list is retired once a mode is set
  }
  return erpApps(ctx);
}

export const HANDLERS = { erpApps, erpAppSet };
