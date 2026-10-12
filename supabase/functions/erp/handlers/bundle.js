// erpBundle (ERP.js:1944): many sections in one call, each on its own so a
// failing one cannot take the screen down. Each part runs in a savepoint -
// in Postgres one failed statement would otherwise abort the whole call.

import { todayStr } from '../lib/time.js';
import { callAllowed, powerOn } from '../allow.js';

let ERP_BUILD_REF = 'b261002-1321';
export function setBuild(b) { ERP_BUILD_REF = b; }

// part name -> [handler name, args]
const PARTS = {
  biz:       ['erpBusinesses', []],
  dash:      ['erpDashboardData', []],
  catalog:   ['erpCatalog', []],
  lists:     ['erpSettingsLists', []],
  options:   ['erpFormOptions', []],
  customers: ['erpCustomers', []],
  invoices:  ['erpRecentInvoices', [60]],
  history:   ['erpStockHistory', [60]],
  weborders: ['erpWebOrders', []],
  dues:      ['erpDues', []],
  settings:  ['erpSettingsFull', []],
  costs:     ['erpCostBook', []],
};
const ORDER = ['biz', 'dash', 'catalog', 'lists', 'options', 'customers', 'invoices',
  'history', 'weborders', 'dues', 'settings', 'costs'];

// ---- the dashboard, kept ready (erpDashReady_, ERP.js:158-190) ---------------
// The finished dashboard is kept per business and sight level; opening shows
// it at once, marked `saved`, and the page then asks for a fresh one behind
// it. Anything that changes the books throws the kept copy away (core.js),
// and so does a new day or six hours.
const DASH_TTL_MS = 21600 * 1000;
const dashTier = (ctx) => (powerOn(ctx.s, 'dash') ? 'full' : 'staff');

export async function dashForget(sql, biz) {
  try { await sql`delete from erp_dash_cache where business_id = ${biz}`; } catch (_) { /* never fatal */ }
}

export async function dashKeep(ctx, d) {
  try {
    if (!d || JSON.stringify(d).length >= 950000) return;
    await ctx.sql`insert into erp_dash_cache (business_id, tier, day, dash, kept_at)
                  values (${ctx.biz}, ${dashTier(ctx)}, ${todayStr(ctx.now)}, ${ctx.sql.json(d)}, now())
                  on conflict (business_id, tier) do update
                    set day = excluded.day, dash = excluded.dash, kept_at = now()`;
  } catch (_) { /* never fatal */ }
}

async function dashReady(ctx, handlers, fresh) {
  if (!fresh) {
    try {
      const hit = await ctx.sql`select day, dash, kept_at from erp_dash_cache
                                where business_id = ${ctx.biz} and tier = ${dashTier(ctx)}`;
      if (hit[0] && hit[0].dash && hit[0].day === todayStr(ctx.now) &&
          ctx.now.getTime() - new Date(hit[0].kept_at).getTime() < DASH_TTL_MS) {
        return { ...hit[0].dash, saved: true };
      }
    } catch (_) { /* fall through to working it out */ }
  }
  const d = await handlers.erpDashboardData(ctx);
  await dashKeep(ctx, d);
  return d;
}

export function makeBundle(handlers) {
  return async function erpBundle(ctx, parts, opt) {
    const list = (parts && parts.length) ? parts
      : ['dash', 'catalog', 'lists', 'customers', 'invoices', 'history', 'weborders'];
    const want = {};
    list.forEach((p) => { want[p] = true; });

    const out = { ok: true, took: {}, errors: {}, today: todayStr(ctx.now), build: ERP_BUILD_REF };
    const began = Date.now();

    for (const name of ORDER) {
      if (!want[name]) continue;
      const [fnName, args] = PARTS[name];
      const fn = handlers[fnName];
      const t0 = Date.now();
      try {
        if (!fn) throw new Error('Not built yet: ' + fnName);
        // the settings and the cost book are held to their own call's role
        if ((name === 'settings' || name === 'costs') && !callAllowed(ctx.s, fnName)) throw new Error('Not open to your role.');
        out[name] = await ctx.tx.savepoint(() => (name === 'dash'
          ? dashReady(ctx, handlers, !!(opt && opt.fresh))
          : fn(ctx, ...args)));
      } catch (e) {
        out[name] = null;
        out.errors[name] = String((e && e.message) || e);
      }
      out.took[name] = Date.now() - t0;
    }

    out.total = Date.now() - began;
    if (out.total > 2500) {
      try {
        await ctx.sql`insert into erp_speed (business_id, who, parts, total_ms, took, build)
                      values (${ctx.biz}, ${ctx.s.name}, ${list.join(',')}, ${out.total},
                              ${ctx.sql.json(out.took)}, ${ERP_BUILD_REF})`;
      } catch (_) { /* never the reason a load fails */ }
    }
    return out;
  };
}
