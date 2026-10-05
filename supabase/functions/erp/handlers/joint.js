// Joint stock: goods two companies own together and each sells under its own name.
// The owner's description: docs/JOINT-POOL-BLUEPRINT.md. How it is built: docs/JOINT-BUILD-NOTES.md.
//
//   A joint pool is a business of its own (is_pool) whose members are the partner
//   companies' owners. This file is the pool seen from INSIDE a partner company:
//   nobody has to switch business, and staff who are not members of the pool can
//   still see what is on its shelf and sell from it.
//
//   erpJoint({pool, month})      the Joint stock page (manager and up; the money parts only for a member owner)
//   erpJointCatalog()            joint products for New invoice: name, price, floor, count - never cost
//   erpJointStart({action})      create a pool / join one with a code / make the partner's company
//   erpJointProduct({pool,..})   add or change a joint product (with its floor price)
//   erpJointReceive({pool,..})   stock bought for the pool, and which partner paid
//   erpJointAdjust({pool,..})    a correction of the pool's stock, valued at cost
//   erpJointBook({pool,..})      a line in the pool's money book / strike one out
//   erpJointSettings({pool,..})  price tier of a partner, a new invite code, the slow-payer days
//
// The switch: the feature is off for every business until the provider turns it
// on for that company (joint_flags, Platform screen). Off = none of this answers.

import { formatDate, num, round2 } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { asSystem } from '../lib/system.js';
import { lock, who } from './money.js';
import { forget } from '../lib/tabs.js';
import { erpSaveProduct } from './stock.js';
import { erpPartnership, erpPoolCreate, erpPoolJoin, erpPoolEntryAdd, erpPoolEntryRemove, erpPoolTier, erpPoolInvite } from './partners.js';
import { erpPartnerCompany } from './security.js';
import { isPlatformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
export const SLOW_DAYS = 45;

/** A joint line in the seller's own books carries the pool in its code, so it is never taken for an own product of the same code. */
export const JOINT_MARK = /~J[0-9a-f]{4}$/i;
export function jointSku(sku, poolId) { return str(sku) + '~J' + String(poolId).replace(/-/g, '').slice(0, 4).toLowerCase(); }
export function cleanSku(sku) { return str(sku).replace(JOINT_MARK, ''); }

export async function jointOn(ctx, biz) {
  const b = biz || ctx.biz;
  const key = 'jointOn:' + b;
  if (ctx.memo[key] === undefined) {
    let v = false;
    try { v = !!(await ctx.tx.savepoint(() => ctx.tx`select public.joint_enabled(${b}) as ok`))[0].ok; } catch (_) { v = false; }
    ctx.memo[key] = v;
  }
  return ctx.memo[key];
}
async function needOn(ctx) {
  if (!(await jointOn(ctx))) throw new Error('Joint stock is not switched on for this company.');
}

/** The pools this company is a partner of: [{ id, name, tier, partners: [{id, name, tier}], member }]. */
export async function myPools(ctx) {
  if (ctx.memo.myPools) return ctx.memo.myPools;
  const rows = await asSystem(ctx, () => ctx.tx`
    select pp.pool_id as id, b.name, pp.price_tier as tier,
           (select coalesce(json_agg(json_build_object('id', x.partner_business_id, 'name', x.display_name, 'tier', x.price_tier) order by x.display_name), '[]'::json)
              from pool_partners x where x.pool_id = pp.pool_id) as partners
    from pool_partners pp join businesses b on b.id = pp.pool_id
    where pp.partner_business_id = ${ctx.biz} and b.is_pool and b.suspended_at is null
    order by b.name`);
  const mine = ctx.s.memberships || [];
  ctx.memo.myPools = rows.map((r) => ({
    id: r.id, name: str(r.name), tier: str(r.tier) === 'wholesale' ? 'wholesale' : 'retail',
    partners: (r.partners || []).map((p) => ({ id: p.id, name: str(p.name), tier: str(p.tier) })),
    member: mine.some((m) => m.business_id === r.id && m.is_pool),
  }));
  return ctx.memo.myPools;
}
/** One of my pools, or a refusal. */
export async function poolOf(ctx, poolId) {
  const p = (await myPools(ctx)).find((x) => x.id === str(poolId));
  if (!p) throw new Error('That joint pool is not one this company is in.');
  return p;
}
/** The same call, made inside the pool. */
export function inPool(ctx, pool) {
  return { ...ctx, biz: pool.id, memo: {}, s: { ...ctx.s, businessName: pool.name } };
}
/** The money side of a pool is for its member owners only. */
function needOwner(ctx, pool) {
  if (ctx.s.role !== 'owner' || !pool.member) throw new Error('Only the owners of the two companies do this.');
}

/** What is on a pool's shelf, priced for this company. Cost only when asked for (member owners). */
async function shelf(ctx, pool, withCost) {
  const rows = await asSystem(ctx, () => ctx.tx`
    select p.sku, p.name, p.category, p.brand, p.color, p.unit, p.sell_price, p.wholesale_price, p.floor_price, p.cost_price,
           coalesce(p.status, 'Active') as status, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${pool.id}
    order by p.name`);
  return rows.map((p) => {
    const retail = num(p.sell_price), wholesale = num(p.wholesale_price);
    const o = { sku: str(p.sku), name: str(p.name), category: str(p.category), brand: str(p.brand), color: str(p.color), unit: str(p.unit),
                stock: num(p.stock), retail, wholesale, floor: num(p.floor_price), status: str(p.status) || 'Active',
                price: pool.tier === 'wholesale' && wholesale > 0 ? wholesale : retail };
    if (withCost) o.cost = num(p.cost_price);
    return o;
  });
}

/** Joint products for New invoice. */
export async function erpJointCatalog(ctx) {
  if (!(await jointOn(ctx))) return { on: false, pools: [], products: [] };
  const pools = await myPools(ctx), products = [];
  for (const pool of pools) {
    for (const p of await shelf(ctx, pool, false)) {
      if (p.status === 'Discontinued') continue;
      products.push({ pool: pool.id, poolName: pool.name, sku: jointSku(p.sku, pool.id), code: p.sku, name: p.name, cat: p.category, brand: p.brand,
                      color: p.color, unit: p.unit, sell: p.price, floor: p.floor, stock: p.stock, available: p.stock,
                      state: p.stock <= 0 ? 'out' : 'ok', status: 'Active', joint: true });
    }
  }
  return { on: true, pools: pools.map((p) => ({ id: p.id, name: p.name })), products };
}

/** The Joint stock page. */
export async function erpJoint(ctx, payload) {
  payload = payload || {};
  const owner = ctx.s.role === 'owner';
  if (!(await jointOn(ctx))) return { on: false };
  const pools = await myPools(ctx);
  const out = { on: true, owner, company: str(ctx.s.businessName), pools: pools.map((p) => ({ id: p.id, name: p.name, tier: p.tier, partners: p.partners, member: p.member })),
                today: formatDate(ctx.now, 'yyyy-MM-dd'), currency: 'BDT', pool: '' };
  if (!pools.length) return out;
  const pool = pools.find((p) => p.id === str(payload.pool)) || pools[0];
  const money = owner && pool.member;
  out.pool = pool.id; out.money = money;
  out.stock = await shelf(ctx, pool, money);
  out.slowDays = Math.round(num(await asSystem(ctx, () => getConfig(inPool(ctx, pool), 'joint_slow_days', String(SLOW_DAYS))))) || SLOW_DAYS;
  if (money) out.book = await erpPartnership(inPool(ctx, pool), { month: payload.month });
  return out;
}

/** Create a pool, join one, or make the partner's own company. */
export async function erpJointStart(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const action = str(payload.action);
  if (action === 'create') {
    const r = await erpPoolCreate(ctx, { name: payload.name, displayName: payload.displayName, tier: payload.tier });
    return { ok: true, created: { id: r.id, name: r.name, code: r.code } };
  }
  if (action === 'join') {
    const r = await erpPoolJoin(ctx, { code: payload.code, displayName: payload.displayName, tier: payload.tier });
    return { ok: true, joined: { id: r.id, name: r.name } };
  }
  if (action === 'company') {
    const names = new Set((await ctx.sql`select lower(name) as n from businesses`).map((r) => r.n));
    if (names.has(str(payload.business).toLowerCase())) throw new Error('A company called "' + str(payload.business) + '" already exists.');
    const r = await erpPartnerCompany(ctx, { business: payload.business, ownerName: payload.ownerName, email: payload.email });
    // the provider making a partner's company switches joint stock on for it in the same step
    let switched = false;
    if (await isPlatformAdmin(ctx.sql, ctx.s.userId)) {
      await asSystem(ctx, () => ctx.tx`
        insert into joint_flags (business_id, enabled, set_by)
        select id, true, ${ctx.s.userId} from businesses where lower(name) = ${str(payload.business).toLowerCase()} and not is_pool
        on conflict (business_id) do update set enabled = true, set_by = excluded.set_by, set_at = now()`);
      switched = true;
    }
    return { ok: true, company: { name: r.business, ownerName: r.ownerName, link: r.link, mailed: r.mailed, switched } };
  }
  throw new Error('Unknown action.');
}

/** Add or change a joint product. */
export async function erpJointProduct(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  const pctx = inPool(ctx, pool);
  const retail = num(payload.retail), wholesale = num(payload.wholesale), floor = num(payload.floor), cost = num(payload.cost);
  if (!str(payload.name)) throw new Error('What is the product called?');
  if (!(retail > 0)) throw new Error('Type the retail selling price.');
  if (floor < 0 || cost < 0 || wholesale < 0) throw new Error('Prices cannot be negative.');
  const lowest = wholesale > 0 ? Math.min(retail, wholesale) : retail;
  if (floor > lowest + 0.004) throw new Error('The floor price (' + floor + ') is above the lowest selling price (' + lowest + '). Nobody could sell it.');
  const isNew = !!payload.isNew;
  let cur = null;
  if (!isNew) {
    cur = (await ctx.tx`select * from products where business_id = ${pool.id} and lower(btrim(sku)) = ${str(payload.sku).toLowerCase()} limit 1`)[0];
    if (!cur) throw new Error('That product is not in this pool.');
  } else if (str(payload.sku) && JOINT_MARK.test(str(payload.sku))) throw new Error('That product code cannot be used.');
  const res = await erpSaveProduct(pctx, {
    isNew, sku: str(payload.sku), product_name: str(payload.name), category: str(payload.category), brand: str(payload.brand),
    type: cur ? cur.type : str(payload.type), color: str(payload.color), unit: str(payload.unit) || 'Piece', supplier: cur ? cur.supplier : '',
    cost_price: isNew ? cost : (cost > 0 ? cost : num(cur.cost_price)), sell_price: retail, wholesale_price: wholesale,
    reorder_level: cur ? num(cur.reorder_level) : 0, lead_time_days: cur ? num(cur.lead_time_days) : 0,
    location_bin: cur ? cur.location_bin : '', status: str(payload.status) === 'Discontinued' ? 'Discontinued' : 'Active',
  });
  await ctx.tx`update products set floor_price = ${floor}, wholesale_price = ${wholesale}, updated_at = now()
               where business_id = ${pool.id} and lower(btrim(sku)) = ${String(res.sku).toLowerCase()}`;
  return { ...(await erpJoint(ctx, { pool: pool.id })), saved: res.sku, created: !!res.created };
}

async function poolProduct(ctx, pool, sku) {
  const p = (await ctx.tx`
    select p.id, p.sku, p.name, p.cost_price, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${pool.id} and lower(btrim(p.sku)) = ${str(sku).toLowerCase()} limit 1`)[0];
  if (!p) throw new Error('That product is not in this pool.');
  return p;
}
async function poolOpenOn(ctx, pool, date, what) {
  const r = (await asSystem(ctx, () => ctx.tx`select to_char(public.pool_locked_until(${pool.id}), 'YYYY-MM-DD') as d`))[0];
  if (r && r.d && date < r.d) throw new Error('That month of ' + pool.name + ' is closed and agreed, so ' + what + '. Date it after ' + r.d + '.');
}
const txnNo = (at) => 'TXN-' + formatDate(at, 'yyyyMMdd') + '-' + (Math.floor(Math.random() * 9000) + 1000);

/** Stock bought for the pool: which partner paid is what the settlement credits. */
export async function erpJointReceive(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  const qty = num(payload.qty), unit = round2(num(payload.unitCost));
  if (!(qty > 0) || qty !== Math.round(qty)) throw new Error('How many came in? A whole number above 0.');
  if (!(unit > 0)) throw new Error('What did one cost? The settlement needs the buying price.');
  const payer = str(payload.paidBy) || ctx.biz;
  if (!pool.partners.some((p) => p.id === payer)) throw new Error('Who paid? Choose one of the partners.');
  const today = formatDate(ctx.now, 'yyyy-MM-dd'), date = isDate(payload.date) ? payload.date : today;
  if (date > today) throw new Error('That date has not come yet.');
  await poolOpenOn(ctx, pool, date, 'stock cannot be received there');
  const pctx = inPool(ctx, pool);
  await lock(pctx, 'stock');
  const p = await poolProduct(ctx, pool, payload.sku);
  const at = date === today ? new Date() : new Date(date + 'T06:00:00Z');   // noon in Dhaka
  await ctx.tx`
    insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note,
                                 created_by, created_at, txn_no, operator, product_name, paid_by)
    values (${pool.id}, ${p.id}, 'RECEIVE', 'IN', ${qty}, ${unit}, ${round2(qty * unit)}, 'Joint stock received', ${str(payload.supplier).slice(0, 80)},
            ${str(payload.note).slice(0, 300)}, ${ctx.s.userId}, ${at}, ${txnNo(at)}, ${who(ctx)}, ${str(p.name)}, ${payer})`;
  // the product's cost becomes the average of what is on the shelf and what came in
  const had = Math.max(0, num(p.stock)), old = num(p.cost_price);
  const avg = had > 0 && old > 0 ? round2((had * old + qty * unit) / (had + qty)) : unit;
  await ctx.tx`update products set cost_price = ${avg}, updated_at = now() where id = ${p.id}`;
  forget(pctx, 'TXN_LOG');
  return { ...(await erpJoint(ctx, { pool: pool.id })), received: { sku: str(p.sku), qty, unit, cost: avg } };
}

/** Counted and found wrong: the difference, valued at cost, is the pool's gain or loss. */
export async function erpJointAdjust(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  const qty = num(payload.qty), dir = str(payload.direction).toUpperCase() === 'IN' ? 'IN' : 'OUT', reason = str(payload.reason).slice(0, 200);
  if (!(qty > 0) || qty !== Math.round(qty)) throw new Error('How many? A whole number above 0.');
  if (!reason) throw new Error('Say why the count is being corrected. Your partner sees it.');
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  await poolOpenOn(ctx, pool, today, 'its stock cannot be corrected');
  const pctx = inPool(ctx, pool);
  await lock(pctx, 'stock'); await lock(pctx, 'sale');
  const p = await poolProduct(ctx, pool, payload.sku);
  if (dir === 'OUT' && qty > num(p.stock)) throw new Error('Only ' + num(p.stock) + ' of ' + str(p.name) + ' are in the pool.');
  const cost = num(p.cost_price), at = new Date();
  await ctx.tx`
    insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note,
                                 created_by, created_at, txn_no, operator, product_name)
    values (${pool.id}, ${p.id}, ${dir === 'IN' ? 'RETURN' : 'ADJUST'}, ${dir}, ${qty}, ${cost}, ${round2(qty * cost)}, ${reason}, '',
            ${'Joint stock correction by ' + who(ctx) + ' (' + str(ctx.s.businessName) + ')'}, ${ctx.s.userId}, ${at}, ${txnNo(at)}, ${who(ctx)}, ${str(p.name)})`;
  forget(pctx, 'TXN_LOG');
  return { ...(await erpJoint(ctx, { pool: pool.id })), adjusted: { sku: str(p.sku), qty, direction: dir } };
}

/** A line in the pool's money book, or striking one out. */
export async function erpJointBook(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  const pctx = inPool(ctx, pool);
  if (str(payload.strike)) await erpPoolEntryRemove(pctx, { id: payload.strike, reason: payload.reason, month: payload.month });
  else await erpPoolEntryAdd(pctx, payload);
  return erpJoint(ctx, { pool: pool.id, month: payload.month });
}

/** A partner's price tier, a new invite code, the slow-payer days. */
export async function erpJointSettings(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  const pctx = inPool(ctx, pool);
  if (payload.tier && isId(payload.tier.partner)) { await erpPoolTier(pctx, { partner: payload.tier.partner, tier: payload.tier.tier }); delete ctx.memo.myPools; }
  if (payload.invite) await erpPoolInvite(pctx);
  if (payload.slowDays !== undefined) {
    const d = Math.round(num(payload.slowDays));
    if (!(d >= 7 && d <= 180)) throw new Error('Between 7 and 180 days.');
    await setConfig(pctx, 'joint_slow_days', String(d));
  }
  return erpJoint(ctx, { pool: pool.id, month: payload.month });
}

export const HANDLERS = { erpJoint, erpJointCatalog, erpJointStart, erpJointProduct, erpJointReceive, erpJointAdjust, erpJointBook, erpJointSettings };
