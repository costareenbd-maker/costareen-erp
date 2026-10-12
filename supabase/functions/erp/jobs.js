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
export async function owners(sql, ids) {
  // one ACTIVE owner per business (the earliest), and no suspended business: a switched-off owner sees
  // nothing through row security, so a job run as them silently does nothing (or backs up empty tables)
  return ids && ids.length
    ? sql`select distinct on (m.business_id) m.business_id, m.user_id, b.name from memberships m join businesses b on b.id = m.business_id
          where m.role = 'owner' and coalesce(m.active, true) and b.suspended_at is null and m.business_id = any(${ids})
          order by m.business_id, m.created_at`
    : sql`select distinct on (m.business_id) m.business_id, m.user_id, b.name from memberships m join businesses b on b.id = m.business_id
          where m.role = 'owner' and coalesce(m.active, true) and b.suspended_at is null
          order by m.business_id, m.created_at`;
}

/** Run fn(ctx) for one business, inside one transaction, as its owner. */
export async function asBusiness(deps, row, label, fn) {
  const sql = deps.sql;
  const s = {
    userId: row.user_id, name: row.who || 'Timer', role: 'owner', roleLabel: ERP_ROLES.owner.label,
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
                values (${row.business_id}, ${row.who || 'Timer'}, 'owner', ${label},
                        ${String((e && e.message) || e).slice(0, 500)}, 'jobs')`;
    } catch (_) { /* never the reason a job stops */ }
    return { error: String((e && e.message) || e) };
  }
}

/** Try an optional export; a missing one is simply skipped. */
async function maybe(mod, name) {
  try { const m = await import(mod); return typeof m[name] === 'function' ? m[name] : null; } catch (_) { return null; }
}

/** Joint stock across databases (handlers/joint.js): only on the provider's own server, which reaches every company. */
async function jointCheck(deps) {
  if (!deps.tenantDeps || (deps.install && deps.install.bridged)) return 'skipped';
  const rec = await maybe('./handlers/joint.js', 'jointReconcile');
  if (!rec) return 'skipped';
  try { return await rec(deps); } catch (e) { return { error: String((e && e.message) || e) }; }
}

export async function runJob(deps, job) {
  const sql = deps.sql;
  const out = {};
  if (job === 'nightly') {
    try { await sql`delete from erp_op_keys where at < now() - interval '3 days'`; } catch (_) { /* the table may not exist yet */ }
    const sfNightly = await maybe('./handlers/courier.js', 'sfNightly');
    const backupNow = await maybe('./handlers/settings.js', 'backupNow');
    for (const row of await owners(sql)) {
      out[row.name] = {
        steadfast: sfNightly ? await asBusiness(deps, row, 'nightly:steadfast', (ctx) => sfNightly(ctx)) : 'skipped',
        backup: backupNow ? await asBusiness(deps, row, 'nightly:backup', (ctx) => backupNow(ctx, 'night')) : 'skipped',
        youtube: await asBusiness(deps, row, 'nightly:youtube', async (ctx) => { try { return await (await import('./handlers/creatorportal.js')).ytRefresh(ctx, {}); } catch (e) { return 'failed: ' + String((e && e.message) || e).slice(0, 120); } }),
      };
    }
    // the master catalogue: every listed product linked to its item, the unsure ones asked of the AI reader
    if (deps.control) { try { out['catalogue'] = await (await import('./handlers/catalogue.js')).catalogSync(deps, { ai: true }); } catch (e) { out['catalogue'] = 'failed: ' + String((e && e.message) || e).slice(0, 200); } }
    out.joint = await jointCheck(deps);
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
  } else if (job === 'sheet') {
    // the live backup sheet: tabs whose rows changed are written again
    const tick = await maybe('./handlers/sheet.js', 'sheetTick');
    const ids = (await sql`select c.business_id from business_config c join business_secrets s on s.business_id = c.business_id and s.key = 'GOOGLE_REFRESH'
                           where c.key = 'google_sheet_id' and coalesce(c.value, '') <> ''`).map((r) => r.business_id);
    if (tick && ids.length) {
      for (const row of await owners(sql, ids)) {
        if (out[row.name]) continue;
        out[row.name] = await asBusiness(deps, row, 'sheet:write', (ctx) => tick(ctx));
      }
    }
  } else if (job === 'drive') {
    // copies of new files into each connected owner's Google Drive
    const tick = await maybe('./handlers/google.js', 'driveTick');
    const ids = (await sql`select distinct q.business_id from drive_queue q join business_secrets s on s.business_id = q.business_id and s.key = 'GOOGLE_REFRESH'
                           where q.done_at is null and q.tries < 5`).map((r) => r.business_id);
    if (tick && ids.length) {
      for (const row of await owners(sql, ids)) {
        if (out[row.name]) continue;
        out[row.name] = await asBusiness(deps, row, 'drive:copy', (ctx) => tick(ctx));
      }
    }
  } else if (job === 'deliveries') {
    out.joint = await jointCheck(deps);       // joint sales across databases: confirm or take out what was left pending
    // every company copy follows the newest release by itself (only the provider's own server does this)
    if (!(deps.install && deps.install.bridged) && !(deps.install && deps.install.id)) {
      const upd = await maybe('./handlers/installer.js', 'updateAll');
      if (upd) { try { out.updates = await upd(deps); } catch (e) { out.updates = { error: String((e && e.message) || e) }; } }
      const doms = await maybe('./handlers/installer.js', 'domainsAll');
      if (doms) { try { out.domains = await doms(deps); } catch (e) { out.domains = { error: String((e && e.message) || e) }; } }
    }
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
    // (the plugin's key, or a WooCommerce / Shopify shop's keys - checked when switching on, and by the pull itself)
    const keyed = (await sql`select c.business_id from business_config c
                             where c.key = 'website_sync_on' and c.value = '1'
                               and exists (select 1 from business_secrets s where s.business_id = c.business_id
                                           and s.key in ('CZ_SYNC_KEY', 'WOO_KEY', 'SHOPIFY_TOKEN'))`).map((r) => r.business_id);
    if (keyed.length) {
      for (const row of await owners(sql, keyed)) {
        out[row.name] = {
          pull: pull ? await asBusiness(deps, row, 'websync:pull', (ctx) => pull(ctx)) : 'skipped',
          push: push ? await asBusiness(deps, row, 'websync:push', (ctx) => push(ctx, 'apply')) : 'skipped',
        };
      }
    }
    // the open market: every business that shares its stock lists it again (stock bands, prices, new products)
    if (deps.control) {
      const { marketRefresh } = await import('./handlers/market.js');
      const sharing = (await sql`select business_id from business_config where key = 'market_share_on' and value = '1'`).map((r) => r.business_id);
      if (sharing.length) {
        for (const row of await owners(sql, sharing)) {
          out['market:' + row.name] = await asBusiness(deps, row, 'websync:market', (ctx) => marketRefresh(ctx));
        }
      }
      // new or renamed listings get their catalogue item at once (by the words; the AI reader waits for the night)
      try { const cr = await (await import('./handlers/catalogue.js')).catalogSync(deps, { ai: false }); if (cr && cr.looked) out['catalogue'] = cr; } catch (e) { out['catalogue'] = 'failed: ' + String((e && e.message) || e).slice(0, 200); }
      // Stage N9: suppliers that sell through resellers - the reseller catalogue and the order states
      const { resellerRefresh } = await import('./handlers/resellers.js');
      const resellers = (await sql`select business_id from business_config where key = 'reseller_on' and value = '1'`).map((r) => r.business_id);
      if (resellers.length) {
        for (const row of await owners(sql, resellers)) {
          out['resellers:' + row.name] = await asBusiness(deps, row, 'websync:resellers', (ctx) => resellerRefresh(ctx));
        }
      }
    }
  } else if (job === 'heartbeat') {
    // a company's copy reports to its provider (lib/control.js); nothing on the provider's own system
    const { heartbeat } = await import('./lib/control.js');
    out.heartbeat = await heartbeat(deps);
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
