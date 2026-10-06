// The Apps page: one place that lists every ability the ERP has beyond the core menu, with one switch each.
//
//   erpApps()                     the catalogue with its state for this person: provider on/off, hidden in this
//                                 company's menu, may this person open it (role), where its settings live
//   erpAppSet({key, on, scope})   scope 'all'  - the provider (platform admin): on or off for EVERY company
//                                 scope 'mine' - this company's owner: show or hide in this company's menu
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
export const APPS = [
  { key: 'weborders', kind: 'screen', group: 'Sell', name: 'Web orders', what: 'Orders placed on your website, and the courier’s cash-on-delivery money.', where: 'Settings → Connections (website, courier)' },
  { key: 'quotes', kind: 'screen', group: 'Sell', name: 'Quotations', what: 'Price offers with your letterhead; one click turns a quotation into an invoice.', where: 'Quotations → Settings' },
  { key: 'repairs', kind: 'screen', group: 'Sell', name: 'Repairs', what: 'Machines in the shop for service: job card, parts, payment, return.', where: '' },
  { key: 'printjobs', kind: 'screen', group: 'Sell', name: 'Print jobs', what: 'For a shop that prints for customers: every job, its true cost, the printers and spools.', where: 'Print jobs → Rates, Requests' },
  { key: 'resell', kind: 'screen', group: 'Sell', name: 'Resell', what: 'Sell a supplier’s stock to your own customers at your own price; the supplier packs and ships.', where: 'Market → What I share → Resellers' },
  { key: 'campaigns', kind: 'screen', group: 'Sell', name: 'Campaigns', what: 'WhatsApp messages to groups of customers.', where: 'Settings → Connections (WhatsApp)' },
  { key: 'suppliers', kind: 'screen', group: 'Goods', name: 'Suppliers', what: 'Who you buy from, what you owe them, shipments on the way.', where: '' },
  { key: 'costs', kind: 'screen', group: 'Goods', name: 'Product cost', what: 'The cost book: landed cost per product line, currencies, handling, margins.', where: '' },
  { key: 'market', kind: 'screen', group: 'Goods', name: 'Market', what: 'Other shops’ stock: ask for prices, buy, post what you are looking for.', where: 'Market → What I share' },
  { key: 'joint', kind: 'screen', group: 'Goods', name: 'Joint stock', what: 'Goods you and a partner company own together, sold by both, settled at month end.', where: 'Platform → Company copies (the provider switches it on per company)' },
  { key: 'profit', kind: 'screen', group: 'Money', name: 'Profitability', what: 'Profit and loss by month, per product, per customer.', where: '' },
  { key: 'expenses', kind: 'screen', group: 'Money', name: 'Expenses', what: 'Rent, salaries, bills: what the business spends, by month.', where: '' },
  { key: 'capital', kind: 'screen', group: 'Money', name: 'Capital', what: 'Money put into the business, investors’ returns, the month lock.', where: '' },
  { key: 'tools', kind: 'screen', group: 'System', name: 'Maintenance', what: 'One-off jobs: push stock to the website, recount reorder levels, merge duplicate customers.', where: '' },
  { key: 'find', kind: 'page', group: 'For customers', name: 'Find stock', path: 'find', what: 'Anyone searches a product or colour and sees which shops have it. Orders land under Web orders.', where: 'Market → What I share → Find stock public' },
  { key: 'choose', kind: 'page', group: 'For customers', name: 'Colour finder', path: 'choose', what: 'Point the phone camera at a thing; the closest filament colours in stock are shown. Uses Find stock’s data (one switch for both).', where: 'Market → What I share → Colour swatches', sameAs: 'find' },
  { key: 'check', kind: 'page', group: 'For customers', name: 'Printer Passport', path: 'check', what: 'A buyer types a serial number and sees the warranty and the seller.', where: 'Products → Warranty rules' },
  { key: 'my', kind: 'page', group: 'For customers', name: 'Customer page', path: 'my', what: 'A customer’s own page: orders, warranty, points. Opened from the link on the invoice.', where: 'Customers → Points rules, Refill reminders' },
  { key: 'doctor', kind: 'page', group: 'For customers', name: 'Print Doctor', path: 'doctor', what: 'Printer problems and fixes, with settings that worked for other members.', where: 'Repairs → Print Doctor; Platform → cases' },
  { key: 'print', kind: 'page', group: 'For customers', name: 'Get it printed', path: 'print', what: 'Anyone posts a file; print farms offer a price; the chosen farm prints and delivers.', where: 'Print jobs → Jobs board' },
  { key: 'quote', kind: 'page', group: 'For customers', name: 'Print quote', path: 'quote', what: 'A customer asks THIS shop for a print price.', where: 'Print jobs → Requests → Taking requests' },
  { key: 'design', kind: 'page', group: 'For customers', name: 'Design desk', path: 'design', what: 'Designers take sketches and repair-part requests; the part goes to a print farm.', where: 'Platform → Design desk' },
  { key: 'ideas', kind: 'page', group: 'For customers', name: 'Ideas and updates', path: 'ideas', what: 'Visitors post and vote on ideas for the ERP; you answer in public.', where: 'Platform → Ideas' },
];
const BY_KEY = Object.fromEntries(APPS.map((a) => [a.key, a]));

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
async function hiddenList(ctx) {
  try { const v = JSON.parse(str(await getConfig(ctx, 'apps_hidden', '')) || '[]'); return Array.isArray(v) ? v.filter((k) => BY_KEY[k]).map(String) : []; } catch (_) { return []; }
}

/** What erpHello sends: the apps the provider switched off, and the ones this company hides. */
export async function appsState(deps, sql, biz, getCfg) {
  const off = Object.keys(await offMap(deps, sql));
  let hidden = [];
  try { const v = JSON.parse(str(await getCfg('apps_hidden')) || '[]'); hidden = Array.isArray(v) ? v.filter((k) => BY_KEY[k]).map(String) : []; } catch (_) { hidden = []; }
  return { off, hidden };
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
  const hidden = await hiddenList(ctx);
  const admin = await platformAdmin(ctx);
  const owner = ctx.s.role === 'owner';
  return {
    admin, owner,
    apps: APPS.map((a) => ({
      key: a.key, kind: a.kind, group: a.group, name: a.name, what: a.what, where: a.where,
      url: a.kind === 'page' ? pageUrl(ctx.deps, a.path) : '',
      on: !(off[a.key] || (a.sameAs && off[a.sameAs])),
      hidden: hidden.includes(a.key),
      sameAs: a.sameAs || '',
    })),
  };
}

export async function erpAppSet(ctx, payload) {
  const p = payload || {};
  const key = str(p.key), on = !!p.on, scope = p.scope === 'all' ? 'all' : 'mine';
  const a = BY_KEY[key];
  if (!a) throw new Error('No such app.');
  if (scope === 'all') {
    if (!(await platformAdmin(ctx))) throw new Error('Only the provider switches an app on or off for every company.');
    await ctl(ctx.deps, ctx.sql)`insert into erp_app_flags (key, enabled, updated_at, updated_by) values (${key}, ${on}, now(), ${ctx.s.userId})
                                  on conflict (key) do update set enabled = excluded.enabled, updated_at = now(), updated_by = excluded.updated_by`;
  } else {
    if (!ctx.s.role || ctx.s.role !== 'owner') throw new Error('Only an owner changes this company’s menu.');
    if (a.kind !== 'screen') throw new Error('A public page is not in the menu; the provider switches it on or off.');
    const hidden = (await hiddenList(ctx)).filter((k) => k !== key);
    if (!on) hidden.push(key);
    await setConfig(ctx, 'apps_hidden', JSON.stringify(hidden));
  }
  return erpApps(ctx);
}

export const HANDLERS = { erpApps, erpAppSet };
