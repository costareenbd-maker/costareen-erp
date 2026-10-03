// Going back to a backup (owner only).
//
//   erpRestorePreview({file})                      what the copy holds against what is here now, list by list
//   erpRestore({file, confirm: '<business name>'})  put the business back exactly as in the copy
//
// Before anything is touched, a fresh copy of today is made ("before restore"),
// so a restore can itself be undone. It is all-or-nothing: one transaction.
// Who may sign in (users, access keys, secrets, devices) is NOT taken from the
// copy - only the business's own lists and books.

import { formatDate, num } from '../lib/time.js';
import { readFile } from '../lib/ext.js';
import { backupNow } from './settings.js';

const str = (v) => String(v == null ? '' : v).trim();
const KEEP_AS_IS = new Set(['businesses', 'memberships', 'business_secrets', 'erp_access_keys', 'erp_ai_keys', 'erp_prefs', 'erp_people', 'erp_devices',
                            'erp_backup_log', 'drive_queue', 'sync_queue', 'erp_activity', 'erp_errors', 'erp_speed', 'erp_dash_cache', 'erp_alert_sent', 'platform_admins']);

function needOwner(ctx) { if (ctx.s.role !== 'owner') throw new Error('Only the owner can go back to a backup.'); }

async function loadCopy(ctx, file) {
  const name = str(file);
  if (!/^[^/\\]+\.json$/.test(name)) throw new Error('Which backup?');
  const bytes = await readFile(ctx, 'backups', name);
  if (!bytes) throw new Error('That backup is no longer kept.');
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw new Error('That backup file cannot be read.'); }
  if (!doc || !doc.tables || !doc.business || doc.business.id !== ctx.biz) throw new Error('That backup belongs to another business.');
  return doc;
}

/** The tables that go back, parents before children (by their foreign keys). */
async function plan(ctx, doc) {
  const here = (await ctx.sql`select c.table_name as t from information_schema.columns c
                              join information_schema.tables x on x.table_schema = c.table_schema and x.table_name = c.table_name
                              where c.table_schema = 'public' and c.column_name = 'business_id' and x.table_type = 'BASE TABLE'`).map((r) => r.t);
  const list = here.filter((t) => !KEEP_AS_IS.has(t));
  const deps = {};
  for (const r of await ctx.sql`select cl.relname as child, pl.relname as parent from pg_constraint k
                                join pg_class cl on cl.oid = k.conrelid join pg_class pl on pl.oid = k.confrelid
                                join pg_namespace n on n.oid = cl.relnamespace where k.contype = 'f' and n.nspname = 'public'`) {
    if (r.child !== r.parent) (deps[r.child] = deps[r.child] || new Set()).add(r.parent);
  }
  const order = [], seen = new Set(), busy = new Set();
  const visit = (t) => {
    if (seen.has(t) || busy.has(t)) return;
    busy.add(t);
    for (const p of deps[t] || []) if (list.includes(p)) visit(p);
    busy.delete(t); seen.add(t); order.push(t);
  };
  list.forEach(visit);
  return { order, inCopy: (t) => Array.isArray(doc.tables[t]) };
}

export async function erpRestorePreview(ctx, payload) {
  needOwner(ctx);
  const doc = await loadCopy(ctx, payload && payload.file);
  const p = await plan(ctx, doc), rows = [];
  for (const t of p.order) {
    const now = (await ctx.sql`select count(*)::int n from ${ctx.sql(t)} where business_id = ${ctx.biz}`)[0].n;
    const then = p.inCopy(t) ? doc.tables[t].length : null;
    if (!now && !then) continue;
    rows.push({ name: t, now, copy: then === null ? 'not in the copy - emptied' : then });
  }
  return { file: str(payload.file), made: doc.made_at ? formatDate(new Date(doc.made_at), 'd MMM yyyy, h:mm a') : '', business: str(doc.business.name), lists: rows };
}

export async function erpRestore(ctx, payload) {
  needOwner(ctx);
  payload = payload || {};
  const doc = await loadCopy(ctx, payload.file);
  const name = str((await ctx.sql`select name from businesses where id = ${ctx.biz}`)[0].name);
  if (str(payload.confirm) !== name) throw new Error('Type the business name exactly (' + name + ') to go back to this copy.');
  // today first, so this can be undone
  const before = await backupNow(ctx, 'before restore');
  if (!before || !before.ok || !(before.made && before.made.length)) throw new Error('Today could not be copied first, so nothing was changed. Try again.');
  const p = await plan(ctx, doc);
  const counts = {};
  await ctx.sql.begin(async (tx) => {
    for (const t of [...p.order].reverse()) await tx`delete from ${tx(t)} where business_id = ${ctx.biz}`;
    for (const t of p.order) {
      if (!p.inCopy(t) || !doc.tables[t].length) { counts[t] = 0; continue; }
      const cols = (await tx`select column_name as c from information_schema.columns where table_schema = 'public' and table_name = ${t} and is_generated = 'NEVER'`).map((r) => r.c);
      const have = new Set(Object.keys(doc.tables[t][0] || {}));
      const use = cols.filter((c) => have.has(c));
      for (let i = 0; i < doc.tables[t].length; i += 500) {
        const part = doc.tables[t].slice(i, i + 500).map((r) => ({ ...r, business_id: ctx.biz }));
        // names come from the database's own catalogue, quoted; the rows go as one parameter
        const q = (n) => '"' + String(n).replace(/"/g, '""') + '"', list = use.map(q).join(', ');
        await tx.unsafe('insert into public.' + q(t) + ' (' + list + ') overriding system value select ' + list +
                        ' from json_populate_recordset(null::public.' + q(t) + ', $1::text::json)', [JSON.stringify(part)]);
      }
      counts[t] = doc.tables[t].length;
      // numbering carries on after the restored rows
      for (const s of await tx`select column_name as c, pg_get_serial_sequence(${'public.' + t}, column_name) as q from information_schema.columns
                               where table_schema = 'public' and table_name = ${t} and pg_get_serial_sequence(${'public.' + t}, column_name) is not null`) {
        await tx`select setval(${s.q}, greatest((select coalesce(max(${tx(s.c)}), 0) from ${tx(t)}), (select last_value from ${tx.unsafe(s.q)})))`;
      }
    }
  });
  for (const k of Object.keys(ctx.memo)) delete ctx.memo[k];
  return { ok: true, file: str(payload.file), before: before.made[0], lists: counts };
}

export const HANDLERS = { erpRestorePreview, erpRestore };
