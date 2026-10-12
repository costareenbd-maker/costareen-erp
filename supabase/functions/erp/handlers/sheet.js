// The live backup sheet: a Google Sheet in the owner's Drive holding every list
// of the business, one tab each, kept up to date every 10 minutes.
//
//   erpSheet()           is there one, its link, when each tab was last written
//   erpSheetCreate()     make the sheet (needs Google connected) - filled by the timer
//   erpSheetSyncNow()    write what changed now instead of waiting
//   erpSheetStop()       stop updating it (the sheet itself stays in the Drive)
//   sheetTick(ctx)       timer: each tab whose rows changed is written again in full
//
// A copy to read and to keep, not a second system: changing the sheet changes
// nothing here. A tab is rewritten only when its rows changed (a fingerprint of
// the rows is kept), so an edit or a void shows too, not only new rows.

import { formatDate, num } from '../lib/time.js';
import { getSecret, getConfig, setConfig } from '../lib/ext.js';
import { accessToken, folderId, gfetch } from './google.js';

const str = (v) => String(v == null ? '' : v).trim();
const SKIP = new Set(['business_secrets', 'erp_access_keys', 'erp_ai_keys', 'erp_dash_cache', 'erp_alert_sent', 'drive_queue', 'erp_errors', 'erp_speed',
                      'sync_queue', 'erp_activity', 'memberships', 'erp_prefs', 'business_config', 'quote_settings', 'erp_backup_log', 'delivery_checks', 'invoice_counters']);
const FIRST = ['invoices', 'invoice_lines', 'payments', 'returns', 'customers', 'products', 'stock_movements', 'expenses', 'money_accounts', 'money_moves',
               'suppliers', 'supplier_bills', 'supplier_payments', 'capital_holders', 'capital_book', 'serials', 'service_jobs', 'quotations'];
const MAX_TABS_PER_RUN = 10;
const SHEETS = 'https://sheets.googleapis.com/v4/spreadsheets/';

function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only the owner manages the backup sheet.'); }

async function tables(ctx) {
  const rows = await ctx.sql`select c.table_name as t from information_schema.columns c
                             join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
                             where c.table_schema = 'public' and c.column_name = 'business_id' and x.table_type = 'BASE TABLE' order by 1`;
  const all = rows.map((r) => r.t).filter((t) => !SKIP.has(t));
  return FIRST.filter((t) => all.includes(t)).concat(all.filter((t) => !FIRST.includes(t)));
}

async function state(ctx) {
  try { return JSON.parse(str(await getConfig(ctx, 'google_sheet_state', '')) || '{}') || {}; } catch (_) { return {}; }
}

export async function erpSheet(ctx) {
  needOwner(ctx);
  const id = str(await getConfig(ctx, 'google_sheet_id', ''));
  const st = await state(ctx);
  return { google: !!(await getSecret(ctx, 'GOOGLE_REFRESH')), id, url: id ? 'https://docs.google.com/spreadsheets/d/' + id : '',
           tabs: Object.keys(st).map((t) => ({ name: t, rows: st[t].n, at: st[t].at })).sort((a, b) => (a.name < b.name ? -1 : 1)),
           last: str(await getConfig(ctx, 'google_sheet_last', '')), error: str(await getConfig(ctx, 'google_sheet_error', '')) };
}

export async function erpSheetCreate(ctx) {
  needOwner(ctx);
  if (!(await getSecret(ctx, 'GOOGLE_REFRESH'))) throw new Error('Connect Google Drive first (Settings > Connections).');
  if (str(await getConfig(ctx, 'google_sheet_id', ''))) throw new Error('There is already a backup sheet. Stop it first to make a new one.');
  const biz = str((await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0].name);
  const parent = await folderId(ctx, 'ERP - ' + biz);
  const tok = await accessToken(ctx);
  const r = await gfetch(ctx.deps, 'https://www.googleapis.com/drive/v3/files?fields=id', { method: 'POST',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ERP - ' + biz + ' - live copy', mimeType: 'application/vnd.google-apps.spreadsheet', parents: [parent] }) });
  if (r.code !== 200 || !r.json || !r.json.id) throw new Error('Google would not make the sheet (' + r.code + ').');
  const id = r.json.id;
  // the first tab says what this is
  const g = await gfetch(ctx.deps, SHEETS + id + '?fields=sheets.properties', { method: 'GET', headers: { Authorization: 'Bearer ' + tok } });
  const first = g.json && g.json.sheets && g.json.sheets[0] ? g.json.sheets[0].properties.sheetId : 0;
  await gfetch(ctx.deps, SHEETS + id + ':batchUpdate', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ updateSheetProperties: { properties: { sheetId: first, title: 'Read me' }, fields: 'title' } }] }) });
  await gfetch(ctx.deps, SHEETS + id + '/values/' + encodeURIComponent("'Read me'!A1") + '?valueInputOption=RAW', { method: 'PUT',
    headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' },
    body: JSON.stringify({ values: [['Live copy of ' + biz + ' ERP'], ['Every tab is one list of the ERP, rewritten within about 10 minutes of a change.'],
      ['It is a copy to read and keep. Changing it changes nothing in the ERP.'], ['Made ' + formatDate(ctx.now, 'd MMM yyyy, h:mm a')]] }) });
  await setConfig(ctx, 'google_sheet_id', id);
  await setConfig(ctx, 'google_sheet_state', '{}');
  await setConfig(ctx, 'google_sheet_error', '');
  return erpSheet(ctx);
}

export async function erpSheetStop(ctx) {
  needOwner(ctx);
  for (const k of ['google_sheet_id', 'google_sheet_state', 'google_sheet_last', 'google_sheet_error']) await setConfig(ctx, k, '');
  return erpSheet(ctx);
}

export async function erpSheetSyncNow(ctx) {
  needOwner(ctx);
  const r = await sheetTick(ctx);
  return { ...(await erpSheet(ctx)), written: r.written || 0, more: !!r.more };
}

function cell(v, type) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return formatDate(v, 'yyyy-MM-dd HH:mm:ss');
  if (/^(numeric|integer|bigint|smallint|real|double precision)$/.test(type)) { const n = Number(v); return isFinite(n) ? n : String(v); }
  if (type === 'boolean') return v ? 'TRUE' : 'FALSE';
  if (typeof v === 'object') { const s = JSON.stringify(v); return s.length > 45000 ? s.slice(0, 45000) + '...(cut)' : s; }
  const s = String(v);
  return s.length > 45000 ? s.slice(0, 45000) + '...(cut)' : s;
}

export async function sheetTick(ctx) {
  const id = str(await getConfig(ctx, 'google_sheet_id', ''));
  if (!id || !(await getSecret(ctx, 'GOOGLE_REFRESH'))) return { skipped: 'no sheet' };
  const st = await state(ctx);
  let written = 0, more = false;
  try {
    const tok = await accessToken(ctx), auth = { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' };
    const g = await gfetch(ctx.deps, SHEETS + id + '?fields=sheets.properties.title', { method: 'GET', headers: auth });
    if (g.code === 404) throw new Error('The backup sheet was deleted in Google. Stop it and make a new one.');
    if (g.code !== 200) throw new Error('Google Sheets answered ' + g.code + '.');
    const titles = new Set(((g.json && g.json.sheets) || []).map((x) => x.properties.title));
    for (const t of await tables(ctx)) {
      const fp = (await ctx.sql`select md5(coalesce(string_agg(md5(x::text), '' order by md5(x::text)), '')) as fp, count(*)::int as n
                                from ${ctx.sql(t)} x where business_id = ${ctx.biz}`)[0];
      if (t === 'products') {   // the products tab also carries the cost the ERP uses and the stock: it changes with the price book and every movement
        const more2 = (await ctx.sql`select md5(coalesce((select string_agg(md5(b::text), '' order by md5(b::text)) from cost_book b where b.business_id = ${ctx.biz}), '') ||
                                              coalesce((select string_agg(ps.product_id::text || ':' || ps.stock::text, ',' order by ps.product_id) from product_stock ps join products q on q.id = ps.product_id where q.business_id = ${ctx.biz}), '')) as m`)[0];
        fp.fp = fp.fp + ':' + more2.m;
      }
      if (st[t] && st[t].fp === fp.fp) continue;
      if (!st[t] && fp.n === 0) continue;                                     // an empty list gets no tab until it has rows
      if (written >= MAX_TABS_PER_RUN) { more = true; break; }
      const cols = await ctx.sql`select column_name as c, data_type as d from information_schema.columns where table_schema = 'public' and table_name = ${t} order by ordinal_position`;
      const rows = await ctx.sql`select * from ${ctx.sql(t)} where business_id = ${ctx.biz}`;
      let values = [cols.map((c) => c.c)].concat(rows.map((r) => cols.map((c) => cell(r[c.c], c.d))));
      if (t === 'products') {
        const { products: costed } = await import('./dashboard.js');
        const by = (await costed(ctx)).bySku;
        values = [values[0].concat(['cost_used', 'stock'])].concat(rows.map((r, i) => { const c = by[String(r.sku || '').toLowerCase()]; return values[i + 1].concat([c ? num(c.cost) : num(r.cost_price), c ? num(c.stock) : 0]); }));
      }
      if (!titles.has(t)) {
        const a = await gfetch(ctx.deps, SHEETS + id + ':batchUpdate', { method: 'POST', headers: auth,
          body: JSON.stringify({ requests: [{ addSheet: { properties: { title: t, gridProperties: { frozenRowCount: 1 } } } }] }) });
        if (a.code !== 200) throw new Error('Google would not add the tab ' + t + ' (' + a.code + ').');
        titles.add(t);
      }
      const range = encodeURIComponent("'" + t + "'");
      const c = await gfetch(ctx.deps, SHEETS + id + '/values/' + range + ':clear', { method: 'POST', headers: auth, body: '{}' });
      if (c.code !== 200) throw new Error('Google would not clear the tab ' + t + ' (' + c.code + ').');
      for (let i = 0; i < values.length; i += 5000) {
        const part = values.slice(i, i + 5000);
        const u = await gfetch(ctx.deps, SHEETS + id + '/values/' + encodeURIComponent("'" + t + "'!A" + (i + 1)) + '?valueInputOption=RAW', { method: 'PUT', headers: auth,
          body: JSON.stringify({ values: part }) });
        if (u.code !== 200) throw new Error('Google would not write the tab ' + t + ' (' + u.code + ').');
      }
      st[t] = { fp: fp.fp, n: fp.n, at: formatDate(ctx.now, 'd MMM, h:mm a') };
      await setConfig(ctx, 'google_sheet_state', JSON.stringify(st));
      written++;
    }
    await setConfig(ctx, 'google_sheet_last', formatDate(ctx.now, 'd MMM yyyy, h:mm a'));
    await setConfig(ctx, 'google_sheet_error', '');
  } catch (e) {
    await setConfig(ctx, 'google_sheet_error', String((e && e.message) || e).slice(0, 300));
    return { written, error: String((e && e.message) || e) };
  }
  return { written, more };
}

export const HANDLERS = { erpSheet, erpSheetCreate, erpSheetStop, erpSheetSyncNow };
