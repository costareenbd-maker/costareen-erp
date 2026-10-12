// Deleting a business of your own, and bringing it back.
//
//   erpBusinessDelete({id, confirm})   owner of that business; never the one you are working in, never your last one.
//                                      A full copy is made first (kept 90 days in the ERP, and sent to Google Drive
//                                      when it is connected), then every record of the business is cleared.
//   erpBusinessesDeleted()             what you deleted in the last 90 days
//   erpBusinessRestore({id})           brings it back from that copy, as a business again (staff are added again)

import { backupNow } from './settings.js';
import { plan, putBack } from './restore.js';
import { readFile } from '../lib/ext.js';
import { formatDate } from '../lib/time.js';

const str = (v) => String(v == null ? '' : v).trim();
const KEEP_DAYS = 90;

export async function erpBusinessDelete(ctx, payload) {
  payload = payload || {};
  const id = str(payload.id);
  const mine = (ctx.s.memberships || []).find((m) => m.business_id === id);
  if (!mine || mine.role !== 'owner') throw new Error('Only its owner can delete a business.');
  if (mine.is_pool) throw new Error('A joint pool is closed under Partnership, not deleted here.');
  if (id === ctx.biz) throw new Error('Switch to another business first - you cannot delete the one you are working in.');
  const owned = (ctx.s.memberships || []).filter((m) => m.role === 'owner' && !m.is_pool && m.business_id !== id);
  if (!owned.length) throw new Error('This is your last business, so it cannot be deleted.');
  const name = str((await ctx.sql`select name from businesses where id = ${id}`)[0]?.name);
  if (str(payload.confirm) !== name) throw new Error('Type the business name exactly (' + name + ') to delete it.');
  if ((await ctx.sql`select 1 from pool_partners where partner_business_id = ${id} limit 1`.catch(() => [])).length) {
    throw new Error(name + ' is a partner in a joint pool. Leave the pool first.');
  }
  // the copy first - nothing is cleared without it
  // in its own transaction, finished before anything is cleared (the copy writes a log line for this business)
  const asUser = (fn) => ctx.sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: ctx.s.userId, role: 'authenticated' })}, true)`;
    return fn({ ...ctx, tx, biz: id, memo: {} });
  });
  const copy = await asUser((nctx) => backupNow(nctx, 'before delete'));
  if (!copy || !copy.ok || !(copy.made && copy.made.length)) throw new Error('The copy could not be made, so nothing was deleted. Try again.');
  let drive = false;
  try {
    const g = await import('./google.js');
    if (typeof g.driveTick === 'function') { const r = await asUser((nctx) => g.driveTick(nctx)); drive = !!(r && (r.copied || r.sent || r.done)); }
  } catch (_) { drive = false; }
  const nctx = { ...ctx, biz: id, memo: {} };
  const p = await plan(nctx, { tables: {} });
  await ctx.sql.begin(async (tx) => {
    for (const t of [...p.order].reverse()) await tx`delete from ${tx(t)} where business_id = ${id}`;
    await tx`delete from businesses where id = ${id}`;
    await tx`insert into erp_deleted_businesses (id, name, deleted_by, backup_name, drive)
             values (${id}, ${name}, ${ctx.s.userId}, ${copy.made[0]}, ${drive})
             on conflict (id) do update set name = excluded.name, deleted_by = excluded.deleted_by, deleted_at = now(),
               backup_name = excluded.backup_name, drive = excluded.drive, restored_at = null, restored_as = null`;
  }).catch((e) => { throw new Error('Nothing was deleted: ' + str(e && e.message).slice(0, 200)); });
  return { ok: true, name, copy: copy.made[0], drive, keptDays: KEEP_DAYS };
}

export async function erpBusinessesDeleted(ctx) {
  const rows = await ctx.sql`select id, name, deleted_at, backup_name, drive from erp_deleted_businesses
                             where deleted_by = ${ctx.s.userId} and restored_at is null and deleted_at > now() - make_interval(days => ${KEEP_DAYS})
                             order by deleted_at desc`;
  return { keptDays: KEEP_DAYS, deleted: rows.map((r) => ({ id: r.id, name: r.name, when: formatDate(new Date(r.deleted_at), 'd MMM yyyy, h:mm a'),
    until: formatDate(new Date(new Date(r.deleted_at).getTime() + KEEP_DAYS * 86400000), 'd MMM yyyy'), drive: r.drive })) };
}

export async function erpBusinessRestore(ctx, payload) {
  const row = (await ctx.sql`select * from erp_deleted_businesses where id = ${str(payload && payload.id)} and deleted_by = ${ctx.s.userId} and restored_at is null`)[0];
  if (!row) throw new Error('That deleted business is not there any more.');
  const old = { ...ctx, biz: row.id, memo: {} };
  const bytes = await readFile(old, 'backups', row.backup_name);
  if (!bytes) throw new Error('Its copy is no longer kept.');
  let doc;
  try { doc = JSON.parse(new TextDecoder().decode(bytes)); } catch (_) { throw new Error('Its copy cannot be read.'); }
  let name = row.name;
  if ((await ctx.sql`select 1 from businesses where lower(name) = ${name.toLowerCase()}`).length) name += ' (restored)';
  let newId = null;
  await ctx.sql.begin(async (tx) => {
    await tx`select set_config('role', 'authenticated', true), set_config('request.jwt.claims', ${JSON.stringify({ sub: ctx.s.userId, role: 'authenticated' })}, true)`;
    newId = (await tx`select create_business(${name}) as id`)[0].id;
    await tx`select set_config('role', 'postgres', true)`;
    const nctx = { ...ctx, biz: newId, memo: {} };
    const p = await plan(nctx, doc);
    await putBack(nctx, tx, p, doc);
    await tx`update businesses set name = ${name} where id = ${newId}`;
    await tx`update erp_deleted_businesses set restored_at = now(), restored_as = ${newId} where id = ${row.id}`;
  });
  return { ok: true, id: newId, name };
}

export const HANDLERS = { erpBusinessDelete, erpBusinessesDeleted, erpBusinessRestore };
