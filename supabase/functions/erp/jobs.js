// The sheet ERP's time-driven triggers and its doPost webhook, re-homed.
//
//   nightly   (03:00 Dhaka)   Steadfast payout sync + backup, every business
//   campaigns (every 10 min)  spread WhatsApp campaigns that have work waiting
//   websync   (every 15 min)  pull website orders, push stock (czSyncCycle)
//   deliveries (every hour)   delivered parcels: record the payment, clear the due (erpDeliveryTick)
//
// pg_cron calls the Edge Function with header x-erp-cron (deploy/cron.sql).
// Each business runs in its own transaction, as that business's owner, so
// row-level security still applies and one business failing cannot stop
// the others. Failures go to erp_errors like any other call.

import { ERP_ROLES, ERP_DISCOUNT_CAP } from './allow.js';

/** Owner of each business (or just the ones asked for). */
async function owners(sql, ids) {
  return ids && ids.length
    ? sql`select m.business_id, m.user_id, b.name from memberships m join businesses b on b.id = m.business_id
          where m.role = 'owner' and m.business_id = any(${ids}) order by m.created_at`
    : sql`select m.business_id, m.user_id, b.name from memberships m join businesses b on b.id = m.business_id
          where m.role = 'owner' order by m.created_at`;
}

/** Run fn(ctx) for one business, inside one transaction, as its owner. */
async function asBusiness(deps, row, label, fn) {
  const sql = deps.sql;
  const s = {
    userId: row.user_id, name: 'Timer', role: 'owner', roleLabel: ERP_ROLES.owner.label,
    discountCap: ERP_DISCOUNT_CAP.owner, businessId: row.business_id, businessName: row.name,
    memberships: [{ business_id: row.business_id, role: 'owner', name: row.name }], implicit: true,
  };
  const claims = JSON.stringify({ sub: row.user_id, role: 'authenticated' });
  try {
    const out = await sql.begin(async (tx) => {
      await tx`select set_config('role', 'authenticated', true),
                      set_config('request.jwt.claims', ${claims}, true)`;
      return fn({ tx, sql: deps.sqlAux || sql, s, biz: row.business_id, now: new Date(), memo: {}, deps });
    });
    // a timer may have changed the books (payouts, web orders): drop the kept dashboard
    try { await sql`delete from erp_dash_cache where business_id = ${row.business_id}`; } catch (_) { /* never fatal */ }
    return out;
  } catch (e) {
    try {
      await sql`insert into erp_errors (business_id, who, role, action, message, build)
                values (${row.business_id}, 'Timer', 'owner', ${label},
                        ${String((e && e.message) || e).slice(0, 500)}, 'jobs')`;
    } catch (_) { /* never the reason a job stops */ }
    return { error: String((e && e.message) || e) };
  }
}

/** Try an optional export; a missing one is simply skipped. */
async function maybe(mod, name) {
  try { const m = await import(mod); return typeof m[name] === 'function' ? m[name] : null; } catch (_) { return null; }
}

export async function runJob(deps, job) {
  const sql = deps.sql;
  const out = {};
  if (job === 'nightly') {
    const sfNightly = await maybe('./handlers/courier.js', 'sfNightly');
    const backupNow = await maybe('./handlers/settings.js', 'backupNow');
    for (const row of await owners(sql)) {
      out[row.name] = {
        steadfast: sfNightly ? await asBusiness(deps, row, 'nightly:steadfast', (ctx) => sfNightly(ctx)) : 'skipped',
        backup: backupNow ? await asBusiness(deps, row, 'nightly:backup', (ctx) => backupNow(ctx, 'night')) : 'skipped',
      };
    }
  } else if (job === 'campaigns') {
    const tick = await maybe('./handlers/campaigns.js', 'campaignTick');
    const which = await maybe('./handlers/campaigns.js', 'spreadBusinesses');
    if (tick && which) {
      const ids = await which(sql);
      if (ids && ids.length) {
        for (const row of await owners(sql, ids)) {
          out[row.name] = await asBusiness(deps, row, 'campaigns:tick', (ctx) => tick(ctx));
        }
      }
    }
  } else if (job === 'alerts') {
    const push = await maybe('./handlers/alerts.js', 'alertsPush');
    const which = await maybe('./handlers/alerts.js', 'alertBusinesses');
    if (push && which) {
      const ids = await which(sql);
      if (ids.length) {
        for (const row of await owners(sql, ids)) {
          if (out[row.name]) continue;               // one owner per business is enough
          out[row.name] = await asBusiness(deps, row, 'alerts:push', (ctx) => push(ctx));
        }
      }
    }
  } else if (job === 'deliveries') {
    // erpDeliveryTick: delivered parcels have their due cleared, every hour
    const tick = await maybe('./handlers/courier.js', 'deliveryTick');
    if (tick) {
      const keyed = (await sql`select distinct business_id from business_secrets where key in ('CZ_SYNC_KEY', 'ERP_SF_KEY')`).map((r) => r.business_id);
      const withParcels = (await sql`select distinct business_id from courier_log where booked_at > now() - interval '60 days'`).map((r) => r.business_id);
      const ids = Array.from(new Set(keyed.concat(withParcels)));
      if (ids.length) {
        for (const row of await owners(sql, ids)) {
          if (out[row.name]) continue;
          out[row.name] = await asBusiness(deps, row, 'deliveries:tick', (ctx) => tick(ctx));
        }
      }
    }
  } else if (job === 'websync') {
    const pull = await maybe('./handlers/weborders.js', 'pullWebOrders');
    const push = await maybe('./handlers/weborders.js', 'pushStockToWebsite');
    // only businesses that have a website key
    // only where the key is saved AND the owner switched the sync on (Settings > Connections)
    const keyed = (await sql`select s.business_id from business_secrets s join business_config c on c.business_id = s.business_id
                             where s.key = 'CZ_SYNC_KEY' and c.key = 'website_sync_on' and c.value = '1'`).map((r) => r.business_id);
    if (keyed.length) {
      for (const row of await owners(sql, keyed)) {
        out[row.name] = {
          pull: pull ? await asBusiness(deps, row, 'websync:pull', (ctx) => pull(ctx)) : 'skipped',
          push: push ? await asBusiness(deps, row, 'websync:push', (ctx) => push(ctx, 'apply')) : 'skipped',
        };
      }
    }
  } else {
    throw new Error('Unknown job: ' + job);
  }
  return out;
}

/**
 * WhatsApp STOP webhook (erpWaHook_). Evolution posts to
 * .../erp?biz=<business id>&hook=<word>; waHook checks the word against the
 * business's secret itself, so a forged biz gets nowhere.
 */
export async function runHook(deps, query, body) {
  const biz = String(query.biz || '');
  if (!/^[0-9a-f-]{36}$/i.test(biz)) return { ok: false, error: 'unknown business' };
  const waHook = await maybe('./handlers/campaigns.js', 'waHook');
  if (!waHook) return { ok: false, error: 'not available' };
  const rows = await owners(deps.sql, [biz]);
  if (!rows.length) return { ok: false, error: 'unknown business' };
  const r = await asBusiness(deps, rows[0], 'whatsapp:hook', (ctx) => waHook(ctx, body, query));
  return r && r.error ? { ok: false, error: 'not handled' } : { ok: true, result: r };
}
