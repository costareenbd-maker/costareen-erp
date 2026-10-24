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
//   erpJointAsk / erpJointSend / erpJointGot / erpJointAskAct   (owner 18 Oct 2026) one partner asks the other for
//                                goods; the holder sends them (collected = free, delivered = a transport cost that is a
//                                joint expense credited to whoever paid); the asker confirms. Every staff member of
//                                both companies may do these, and receive shipments; staff only from their own
//                                company's shelf and with their own company as the payer.
//
// The switch: the feature is off for every business until the provider turns it
// on for that company (joint_flags / erp_tenants.joint, Platform screen). Off = none of this answers.
//
// Cross-database (2026-10-06): a partner company may run on its own Supabase (the bridge). Its pools
// stay in the provider's database; see "where the pool lives" below.

import { formatDate, num, round2 } from '../lib/time.js';
import { getConfig, setConfig, saveFile, deleteFile, renderPdf } from '../lib/ext.js';
import { asSystem } from '../lib/system.js';
import { lock, who } from './money.js';
import { forget } from '../lib/tabs.js';
import { erpSaveProduct, addToLists } from './stock.js';
import { roleAtLeast } from '../allow.js';
import { erpPartnership, erpPoolCreate, erpPoolJoin, erpPoolEntryAdd, erpPoolEntryRemove, erpPoolTier, erpPoolInvite, erpPoolClose } from './partners.js';
import { erpPartnerCompany } from './security.js';
import { platformAdmin } from './platform.js';

const str = (v) => String(v == null ? '' : v).trim();
const isId = (v) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(v || ''));
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
export const SLOW_DAYS = 45;

/** A joint line in the seller's own books carries the pool in its code, so it is never taken for an own product of the same code. */
export const JOINT_MARK = /~J[0-9a-f]{4}$/i;
export function jointSku(sku, poolId) { return str(sku) + '~J' + String(poolId).replace(/-/g, '').slice(0, 4).toLowerCase(); }
export function cleanSku(sku) { return str(sku).replace(JOINT_MARK, ''); }

// ---------------------------------------------------------------- where the pool lives
//
// A company in the provider's database (Costareen) reaches its pools in the SAME database: the pool's
// side of a sale is written in the same transaction (asSystem). A company on the bridge keeps its own
// database; its pools are in the provider's (ctx.deps.control), reached in transactions of their own,
// and a stand-in business row stands for it there (businesses.remote_tenant / remote_business).

export function isRemote(ctx) { return !!(ctx && ctx.deps && ctx.deps.install && ctx.deps.install.bridged && ctx.deps.control); }

/** A transaction in the provider's database for the pool side (remote companies), with erp.system on. */
async function controlTx(ctx, fn) {
  if (ctx.memo.__ptx) return fn(ctx.memo.__ptx);
  return ctx.deps.control.begin(async (t) => {
    t.__ctl = true;
    await t`select set_config('erp.system', 'on', true)`;
    ctx.memo.__ptx = t;
    try { return await fn(t); } finally { ctx.memo.__ptx = null; }
  });
}
/** Reads and writes about pools in general: `fn(tx)` gets the transaction where the pools are. */
async function poolRead(ctx, fn) {
  if (!isRemote(ctx)) return asSystem(ctx, () => fn(ctx.tx));
  return controlTx(ctx, fn);
}
/** The call made inside one pool, wherever it lives: `fn(pctx)`. */
async function withPool(ctx, pool, fn) {
  const me = await sellerId(ctx);
  if (!isRemote(ctx)) return asSystem(ctx, () => fn({ ...inPool(ctx, pool), jointMe: me }));
  return controlTx(ctx, (t) => fn({ ...ctx, tx: t, biz: pool.id, memo: {}, jointMe: me,
                                    s: { ...ctx.s, businessName: pool.name, userId: null } }));
}
/** This company as the pools know it: its own id here, or its stand-in row in the provider's database. */
export async function sellerId(ctx) {
  if (!isRemote(ctx)) return ctx.biz;
  if (ctx.memo.__sid === undefined) {
    const r = (await controlTx(ctx, (t) => t`select id from businesses where remote_tenant = ${ctx.deps.install.id} and remote_business = ${ctx.biz}`))[0];
    ctx.memo.__sid = r ? r.id : null;
  }
  return ctx.memo.__sid;
}
/** Work for after this call's own transaction is saved (remote only). Runs once per key. */
function later(ctx, key, fn) {
  if (!ctx.afterCommit) return fn(ctx);                // tests / timers without the call's hooks: now, in this transaction
  ctx.memo.__later = ctx.memo.__later || {};
  if (ctx.memo.__later[key]) return;
  ctx.memo.__later[key] = true;
  ctx.afterCommit(() => ctx.deps.sql.begin((t2) => fn({ ...ctx, tx: t2, memo: {}, afterCommit: null, onRollback: null })));
}

export async function jointOn(ctx, biz) {
  const b = biz || ctx.biz;
  const key = 'jointOn:' + b;
  if (ctx.memo[key] === undefined) {
    let v = false;
    if (isRemote(ctx)) {
      // a company copy on the bridge: the provider switches it on in Platform > Company copies
      try { v = !!((await ctx.deps.control`select joint from erp_tenants where id = ${ctx.deps.install.id}`)[0] || {}).joint; } catch (_) { v = false; }
    } else {
      try { v = !!(await ctx.tx.savepoint(() => ctx.tx`select public.joint_enabled(${b}) as ok`))[0].ok; } catch (_) { v = false; }
    }
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
  const me = await sellerId(ctx);
  if (!me) { ctx.memo.myPools = []; return []; }
  const rows = await poolRead(ctx, (t) => t`
    select pp.pool_id as id, b.name, pp.price_tier as tier,
           (select coalesce(json_agg(json_build_object('id', x.partner_business_id, 'name', x.display_name, 'tier', x.price_tier) order by x.display_name), '[]'::json)
              from pool_partners x where x.pool_id = pp.pool_id) as partners
    from pool_partners pp join businesses b on b.id = pp.pool_id
    where pp.partner_business_id = ${me} and b.is_pool and b.suspended_at is null
    order by b.name`);
  const mine = ctx.s.memberships || [], remote = isRemote(ctx);
  ctx.memo.myPools = rows.map((r) => ({
    id: r.id, name: str(r.name), tier: str(r.tier) === 'wholesale' ? 'wholesale' : 'retail',
    partners: (r.partners || []).map((p) => ({ id: p.id, name: str(p.name), tier: str(p.tier) })),
    // a company on its own database has no login in the provider's: its owner counts as the pool's owner for it
    // joint-fix-4: every owner of a partner company is the pool's owner for it (not only the login that joined it)
    member: remote || ctx.s.role === 'owner' || mine.some((m) => m.business_id === r.id && m.is_pool),
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
/** An owner of one of the partner companies (may act for either side of the pool). */
const poolOwner = (ctx, pool) => ctx.s.role === 'owner' && !!pool.member;
/** Staff act for their own company only: its shelf, its money. */
async function ownSide(ctx, pool, partner, what) {
  if (poolOwner(ctx, pool)) return;
  const me = await sellerId(ctx);
  if (partner !== me) throw new Error(what + ' - only for your own company (' + str(ctx.s.businessName) + '). Ask an owner for the other side.');
}
/** The money side of a pool is for its member owners only. */
function needOwner(ctx, pool) {
  if (ctx.s.role !== 'owner' || !pool.member) throw new Error('Only the owners of the two companies do this.');
}

/** What is on a pool's shelf, priced for this company. Cost only when asked for (member owners). */
async function shelf(ctx, pool, withCost) {
  const rows = await poolRead(ctx, (t) => t`
    select p.sku, p.name, p.category, p.brand, p.type, p.supplier_sku, p.color, p.unit, p.sell_price, p.wholesale_price, p.floor_price, p.cost_price,
           coalesce(p.status, 'Active') as status, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${pool.id}
    order by p.name`);
  // whose shelf: IN minus OUT per (product, partner); movements with no holder (before 096) count for nobody
  const heldRows = await poolRead(ctx, (t) => t`
    select p.sku, m.held_by, coalesce(sum(case when m.direction = 'IN' then m.qty else -m.qty end), 0) as n
    from stock_movements m join products p on p.id = m.product_id
    where m.business_id = ${pool.id} and m.held_by is not null group by p.sku, m.held_by`);
  const held = {};
  for (const h of heldRows) (held[str(h.sku)] = held[str(h.sku)] || {})[str(h.held_by)] = num(h.n);
  return rows.map((p) => {
    const retail = num(p.sell_price), wholesale = num(p.wholesale_price);
    const o = { sku: str(p.sku), name: str(p.name), category: str(p.category), brand: str(p.brand), type: str(p.type), supplierSku: str(p.supplier_sku), color: str(p.color), unit: str(p.unit),
                stock: num(p.stock), retail, wholesale, floor: num(p.floor_price), status: str(p.status) || 'Active',
                price: pool.tier === 'wholesale' && wholesale > 0 ? wholesale : retail, held: held[str(p.sku)] || {} };
    if (withCost) o.cost = num(p.cost_price);
    return o;
  });
}
/** How many of a pool product sit on one partner's shelf. */
async function heldBy(pctx, pool, productId, partner) {
  const r = (await pctx.tx`select coalesce(sum(case when direction = 'IN' then qty else -qty end), 0) as n from stock_movements
                            where business_id = ${pool.id} and product_id = ${productId} and held_by = ${partner}`)[0];
  return num(r && r.n);
}
/** A sale from a shelf that does not hold enough: the goods are marked moved from the partner holding most, first. */
async function ensureHeld(pctx, pool, productId, name, seller, qty, note) {
  const have = await heldBy(pctx, pool, productId, seller);
  if (have >= qty) return null;
  let need = qty - have, moved = [];   // called after the sale row: qty 0 and a negative shelf = what to move
  const others = [];
  for (const p of pool.partners) if (p.id !== seller) others.push({ id: p.id, name: p.name, n: await heldBy(pctx, pool, productId, p.id) });
  others.sort((a, b) => b.n - a.n);
  const at = new Date(), cost = num(((await pctx.tx`select cost_price from products where id = ${productId}`)[0] || {}).cost_price);
  for (const o of others) {
    if (need <= 0) break;
    const take = Math.min(need, Math.max(0, o.n)); if (take <= 0) continue;
    await moveRows(pctx, pool, productId, name, o.id, seller, take, cost, at, note);
    moved.push({ from: o.name, qty: take }); need -= take;
  }
  if (need > 0) { // nobody's shelf had it: the seller's shelf goes negative and the count will say so
    moved.push({ from: 'nobody', qty: need });
  }
  return moved;
}
async function moveRows(pctx, pool, productId, name, from, to, qty, cost, at, note) {
  const op = who(pctx), tn = txnNo(at);
  await pctx.tx`
    insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note, created_by, created_at, txn_no, operator, product_name, held_by)
    values (${pool.id}, ${productId}, 'MOVE', 'OUT', ${qty}, ${cost}, ${round2(qty * cost)}, 'Moved between partners', '', ${note}, ${pctx.s.userId}, ${at}, ${tn}, ${op}, ${name}, ${from}),
           (${pool.id}, ${productId}, 'MOVE', 'IN', ${qty}, ${cost}, ${round2(qty * cost)}, 'Moved between partners', '', ${note}, ${pctx.s.userId}, ${at}, ${tn + '-in'}, ${op}, ${name}, ${to})`;
}

/** For the invoice's low-profit warning (margins.js): each joint product's selling price for this company and the
 *  pool's cost, by the marked code the invoice uses. Server side only - the cost never reaches the page. */
export async function jointPriceCost(ctx) {
  if (!(await jointOn(ctx))) return {};
  const out = {};
  for (const pool of await myPools(ctx)) for (const p of await shelf(ctx, pool, true)) out[jointSku(p.sku, pool.id).toLowerCase()] = { price: p.price, cost: p.cost };
  return out;
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
  out.slowDays = Math.round(num(await withPool(ctx, pool, (p) => getConfig(p, 'joint_slow_days', String(SLOW_DAYS))))) || SLOW_DAYS;
  if (money) out.book = await withPool(ctx, pool, (p) => erpPartnership(p, { month: payload.month }));
  out.sales = await jointSales(ctx, pool, out.slowDays);
  out.me = await sellerId(ctx);
  out.requests = await requestsOf(ctx, pool, out.me);
  out.moves = await movesOf(ctx, pool);
  out.remote = isRemote(ctx);
  if (money && !out.remote) out.pending = await pendingOf(ctx, pool);
  return out;
}

/** Every joint sale of a pool, newest first: who sold what, what has been paid, what is late. Never cost. */
async function jointSales(ctx, pool, slowDays) {
  const me = await sellerId(ctx);
  const rows = await poolRead(ctx, (t) => t`
    select j.seller_business_id as seller, j.seller_invoice_no, j.pool_invoice_no, j.joint_total, j.below_floor, i.created_at,
           (select string_agg(l.name || ' x ' || (l.qty::numeric)::float8::text, ', ' order by l.line_no) from invoice_lines l where l.invoice_id = i.id) as items,
           coalesce((select sum(p.amount) from payments p where p.business_id = j.pool_id and p.invoice_no = j.pool_invoice_no and lower(coalesce(p.method, '')) <> 'returned'), 0) as money,
           coalesce((select sum(p.amount) from payments p where p.business_id = j.pool_id and p.invoice_no = j.pool_invoice_no and lower(coalesce(p.method, '')) = 'returned'), 0) as returned
    from joint_sales j join invoices i on i.business_id = j.pool_id and i.invoice_no = j.pool_invoice_no
    where j.pool_id = ${pool.id} and j.status <> 'pending'
    order by i.created_at desc limit 300`);
  const names = {}; pool.partners.forEach((p) => { names[p.id] = p.name; });
  const today = ctx.now.getTime();
  return rows.map((r) => {
    const total = num(r.joint_total), returned = num(r.returned), paid = num(r.money);
    const due = Math.max(0, round2(total - returned - paid));
    const days = Math.max(0, Math.floor((today - new Date(r.created_at).getTime()) / 86400000));
    return { when: formatDate(new Date(r.created_at), 'd MMM yyyy'), seller: names[r.seller] || 'Partner', mine: r.seller === me,
             invoiceNo: r.seller === me ? str(r.seller_invoice_no) : '', ref: str(r.pool_invoice_no), items: str(r.items),
             total, returned, paid, due, days, late: due > 0.5 && days >= slowDays, belowFloor: num(r.below_floor) };
  });
}

/** Say yes to a finished month's sums (or take the yes back before the other has agreed). The last yes closes it. */
export async function erpJointAgree(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  await withPool(ctx, pool, (p) => erpPoolClose(p, { month: payload.month, withdraw: !!payload.withdraw }));
  return erpJoint(ctx, { pool: pool.id, month: payload.month });
}

/** For the dashboard card: each pool in one line (member owners only). */
export async function erpJointCard(ctx) {
  if (ctx.s.role !== 'owner' || !(await jointOn(ctx))) return { on: false, pools: [] };
  const out = [];
  for (const pool of await myPools(ctx)) {
    if (!pool.member) continue;
    const b = await withPool(ctx, pool, (p) => erpPartnership(p, {}));
    const r = b.report || {}, me = (r.partners || []).find((x) => x.business_id === b.me) || {};
    const names = {}; (b.partners || []).forEach((x) => { names[x.id] = x.name; });
    const month = formatDate(ctx.now, 'yyyy-MM') + '-01';
    const mv = (await poolRead(ctx, (t) => t`
      select coalesce(sum(qty) filter (where kind = 'RECEIVE' and direction = 'IN'), 0) as received,
             coalesce(sum(qty) filter (where kind = 'MOVE' and direction = 'IN'), 0) as moved
      from stock_movements where business_id = ${pool.id} and public.dhaka_date(created_at) >= ${month}::date`))[0] || {};
    mv.sold = {};
    for (const x of await poolRead(ctx, (t) => t`select held_by, sum(qty) as n from stock_movements
                                                where business_id = ${pool.id} and kind = 'SALE' and direction = 'OUT' and held_by is not null
                                                  and public.dhaka_date(created_at) >= ${month}::date group by held_by`)) mv.sold[x.held_by] = num(x.n);
    const held = await poolRead(ctx, (t) => t`select held_by, coalesce(sum(case when direction = 'IN' then qty else -qty end), 0) as n
                                              from stock_movements where business_id = ${pool.id} and held_by is not null group by held_by`);
    const open = (await poolRead(ctx, (t) => t`select count(*) filter (where status = 'asked')::int as asked, count(*) filter (where status = 'sent')::int as sent
                                               from pool_requests where pool_id = ${pool.id}`))[0] || {};
    const shelves = pool.partners.map((x) => ({ name: x.name, units: num((held.find((h) => h.held_by === x.id) || {}).n), sold: num((mv.sold || {})[x.id]) }));
    out.push({ id: pool.id, name: pool.name, profit: num((r.this_month || {}).profit), share: num(me.ratio), myProfit: round2(num((r.this_month || {}).profit) * num(me.ratio)),
               month: { received: num(mv.received), moved: num(mv.moved) }, shelves, requests: { asked: num(open.asked), sent: num(open.sent) },
               stock: num((r.to_date || {}).stock_at_cost), balance: num(me.balance),
               transfers: (r.transfers || []).map((t) => ({ from: names[t.from] || '?', to: names[t.to] || '?', amount: num(t.amount), mine: t.from === b.me ? 'pay' : t.to === b.me ? 'get' : '' })) });
  }
  return { on: true, pools: out, currency: 'BDT' };
}

const esc = (v) => String(v == null ? '' : v).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const money0 = (n) => Math.round(num(n)).toLocaleString('en-US');

/** The month's statement as a paper both owners can keep. */
export async function erpJointStatementPdf(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  const b = await withPool(ctx, pool, (p) => erpPartnership(p, { month: payload.month }));
  const r = b.report || {}, tm = r.this_month || {}, td = r.to_date || {}, ps = r.partners || [];
  const names = {}; (b.partners || []).forEach((x) => { names[x.id] = x.name; });
  const slow = Math.round(num(td.slow_days)) || SLOW_DAYS;
  const sales = (await jointSales(ctx, pool, slow)).filter((s) => s.when.slice(-8) === formatDate(new Date(b.month + '-15T00:00:00Z'), 'MMM yyyy'));
  const bySeller = {};
  for (const s of sales) { const o = bySeller[s.seller] || (bySeller[s.seller] = { n: 0, total: 0, returned: 0, paid: 0, due: 0 }); o.n++; o.total += s.total; o.returned += s.returned; o.paid += s.paid; o.due += s.due; }
  const agreed = (r.agreed || []).map((id) => names[id] || '?');
  const th = 'style="text-align:left;padding:6px 8px;border-bottom:2px solid #222;font-size:11px"', thn = th.replace('left', 'right');
  const td1 = 'style="padding:6px 8px;border-bottom:1px solid #ddd"', tdn = 'style="padding:6px 8px;border-bottom:1px solid #ddd;text-align:right"';
  const html = '<html><body style="font-family:Arial,Helvetica,sans-serif;font-size:12px;color:#111;margin:0">' +
    '<h1 style="font-size:20px;margin:0 0 2px">' + esc(pool.name) + '</h1>' +
    '<div style="font-size:14px;margin-bottom:2px">Joint stock statement — ' + esc(b.label) + '</div>' +
    '<div style="color:#555;margin-bottom:14px">' + (r.closed ? 'Closed: agreed by ' + esc(agreed.join(' and ')) : 'Not closed yet' + (agreed.length ? ' — agreed so far by ' + esc(agreed.join(', ')) : '')) +
      ' · made ' + esc(formatDate(ctx.now, 'd MMM yyyy, h:mm a')) + '</div>' +
    '<table width="100%" cellspacing="0" style="border-collapse:collapse;margin-bottom:14px"><tr>' +
      [['Sold', tm.revenue], ['Cost of goods', tm.cogs], ['Shared expenses', tm.expenses], ['Stock corrections', tm.stock_gain], ['Profit of the month', tm.profit]].map((x) =>
        '<td style="border:1px solid #ccc;padding:8px 10px"><div style="font-size:10px;color:#555;text-transform:uppercase">' + x[0] + '</div><div style="font-size:16px;font-weight:700">BDT ' + money0(x[1]) + '</div></td>').join('') + '</tr></table>' +
    '<h2 style="font-size:13px;margin:0 0 4px">The partners</h2>' +
    '<table width="100%" cellspacing="0" style="border-collapse:collapse;margin-bottom:6px"><tr><th ' + th + '>Partner</th><th ' + thn + '>Capital</th><th ' + thn + '>Share</th><th ' + thn + '>Sold this month</th><th ' + thn +
      '>Profit share</th><th ' + thn + '>Holds</th><th ' + thn + '>Should hold</th><th ' + thn + '>To settle</th></tr>' +
      ps.map((x) => { const bal = num(x.balance); return '<tr><td ' + td1 + '>' + esc(x.name) + '</td><td ' + tdn + '>' + money0(x.capital) + '</td><td ' + tdn + '>' + (Math.round(num(x.ratio) * 1000) / 10) + '%</td><td ' + tdn + '>' + money0(x.month_sales) +
        '</td><td ' + tdn + '>' + money0(x.profit_share) + '</td><td ' + tdn + '>' + money0(x.held) + '</td><td ' + tdn + '>' + money0(x.due) + '</td><td ' + tdn + '><b>' +
        (bal > 0.5 ? 'pays ' + money0(bal) : bal < -0.5 ? 'receives ' + money0(-bal) : 'even') + '</b></td></tr>'; }).join('') + '</table>' +
    '<div style="margin:8px 0 14px;padding:10px 12px;border:2px solid #111;font-size:14px">' +
      ((r.transfers || []).length ? (r.transfers || []).map((t) => '<b>' + esc(names[t.from] || '?') + '</b> pays <b>BDT ' + money0(t.amount) + '</b> to <b>' + esc(names[t.to] || '?') + '</b>').join('<br>')
                                  : 'Nobody owes anything — the cash is where it should be.') + '</div>' +
    '<div style="color:#444;margin-bottom:14px">Stock at cost BDT ' + money0(td.stock_at_cost) + ' · customers still owe BDT ' + money0(td.receivables) +
      (num(td.overdue) > 0.5 ? ' · unpaid for more than ' + slow + ' days, counted as held by the seller: BDT ' + money0(td.overdue) : '') +
      '. Profit is shared by capital as it stood when the month began. “Holds” = joint money received from customers, less what that partner paid for stock and expenses.</div>' +
    '<h2 style="font-size:13px;margin:0 0 4px">Sales of the month, by company</h2>' +
    (Object.keys(bySeller).length ? '<table width="100%" cellspacing="0" style="border-collapse:collapse;margin-bottom:14px"><tr><th ' + th + '>Company</th><th ' + thn + '>Sales</th><th ' + thn + '>Value</th><th ' + thn + '>Returned</th><th ' + thn + '>Paid</th><th ' + thn + '>Not paid yet</th></tr>' +
      Object.keys(bySeller).sort().map((k) => { const o = bySeller[k]; return '<tr><td ' + td1 + '>' + esc(k) + '</td><td ' + tdn + '>' + o.n + '</td><td ' + tdn + '>' + money0(o.total) + '</td><td ' + tdn + '>' + money0(o.returned) + '</td><td ' + tdn + '>' + money0(o.paid) + '</td><td ' + tdn + '>' + money0(o.due) + '</td></tr>'; }).join('') + '</table>'
      : '<div style="color:#555;margin-bottom:14px">No joint sale this month.</div>') +
    ((r.below_floor || []).length ? '<h2 style="font-size:13px;margin:0 0 4px">Sold under the floor price (by an owner)</h2><div style="margin-bottom:14px">' +
      (r.below_floor || []).map((f) => esc(names[f.seller] || '?') + ', invoice ' + esc(f.invoice) + ': BDT ' + money0(f.amount) + ' under the floor').join('<br>') + '</div>' : '') +
    '<h2 style="font-size:13px;margin:0 0 4px">The joint book this month</h2>' +
    (() => { const led = (b.ledger || []).filter((l) => !l.voided && formatDate(new Date(b.month + '-15T00:00:00Z'), 'MMM yyyy') === l.when.slice(-8));
      return led.length ? '<table width="100%" cellspacing="0" style="border-collapse:collapse"><tr><th ' + th + '>Date</th><th ' + th + '>Who</th><th ' + th + '>What</th><th ' + thn + '>Amount</th></tr>' +
        led.map((l) => '<tr><td ' + td1 + '>' + esc(l.when) + '</td><td ' + td1 + '>' + esc(l.who) + (l.to ? ' → ' + esc(l.to) : '') + '</td><td ' + td1 + '>' + esc(l.label) + (l.category ? ' · ' + esc(l.category) : '') + (l.note ? ' · ' + esc(l.note) : '') +
          '</td><td ' + tdn + '>' + money0(l.amount) + '</td></tr>').join('') + '</table>' : '<div style="color:#555">Nothing written this month.</div>'; })() +
    '<table width="100%" style="margin-top:44px"><tr>' + ps.map((x) => '<td style="padding:0 20px"><div style="border-top:1px solid #111;padding-top:4px;text-align:center">' + esc(x.name) + '</div></td>').join('') + '</tr></table>' +
    '</body></html>';
  const name = 'Joint_' + String(pool.name).replace(/[^\w\-]+/g, '_') + '_' + b.month + '.pdf';
  const bytes = await renderPdf(ctx, html, {});
  await deleteFile(ctx, 'invoices', name);
  const f = await saveFile(ctx, 'invoices', name, bytes, 'application/pdf');
  return { url: f.url, id: f.id, name };
}

/** Create a pool, join one, or make the partner's own company. */
export async function erpJointStart(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const action = str(payload.action);
  if (action === 'create') {
    if (isRemote(ctx)) throw new Error('A joint stock is started by the partner whose ERP runs on the provider\u2019s own server. Ask them for an invite code and join with it.');
    const r = await erpPoolCreate(ctx, { name: payload.name, displayName: payload.displayName, tier: payload.tier });
    return { ok: true, created: { id: r.id, name: r.name, code: r.code } };
  }
  if (action === 'join') {
    if (isRemote(ctx)) return { ok: true, joined: await remoteJoin(ctx, payload.code, payload.displayName) };
    const r = await erpPoolJoin(ctx, { code: payload.code, displayName: payload.displayName, tier: payload.tier });
    return { ok: true, joined: { id: r.id, name: r.name } };
  }
  if (action === 'company') {
    // making a company on the provider's server is the provider's job (Platform), never a partner's
    if (isRemote(ctx) || !(await platformAdmin(ctx))) throw new Error('Only the provider of this ERP makes new companies.');
    const names = new Set((await ctx.sql`select lower(name) as n from businesses`).map((r) => r.n));
    if (names.has(str(payload.business).toLowerCase())) throw new Error('A company called "' + str(payload.business) + '" already exists.');
    const r = await erpPartnerCompany(ctx, { business: payload.business, ownerName: payload.ownerName, email: payload.email });
    // the provider making a partner's company switches joint stock on for it in the same step
    let switched = false;
    if (await platformAdmin(ctx)) {
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
  // owner 18 Oct 2026: staff of both companies add new joint products; changing one (price, floor, still sold) stays the owners'
  if (!payload.isNew) needOwner(ctx, pool);
  const retail = num(payload.retail), wholesale = num(payload.wholesale), floor = num(payload.floor), cost = num(payload.cost);
  if (!str(payload.name)) throw new Error('What is the product called?');
  // smart-read-3 joint (owner 21 Oct 2026: "leave it blank when the file does not say it"): a NEW joint product made from a
  // supplier's file may come without a selling price yet; changing an existing one still needs it
  if (!(retail > 0) && !payload.isNew) throw new Error('Type the retail selling price.');
  if (retail < 0 || floor < 0 || cost < 0 || wholesale < 0) throw new Error('Prices cannot be negative.');
  const lowest = [retail, wholesale].filter((x) => x > 0).reduce((a, b) => Math.min(a, b), Infinity);
  if (lowest < Infinity && floor > lowest + 0.004) throw new Error('The floor price (' + floor + ') is above the lowest selling price (' + lowest + '). Nobody could sell it.');
  const isNew = !!payload.isNew;
  const res = await withPool(ctx, pool, async (pctx) => {
  let cur = null;
  if (!isNew) {
    cur = (await pctx.tx`select * from products where business_id = ${pool.id} and lower(btrim(sku)) = ${str(payload.sku).toLowerCase()} limit 1`)[0];
    if (!cur) throw new Error('That product is not in this pool.');
  } else if (str(payload.sku) && JOINT_MARK.test(str(payload.sku))) throw new Error('That product code cannot be used.');
  const saved = await erpSaveProduct(pctx, {
    isNew, sku: str(payload.sku), product_name: str(payload.name), category: str(payload.category), brand: str(payload.brand),
    type: cur ? cur.type : str(payload.type), color: str(payload.color), unit: str(payload.unit) || 'Piece', supplier: cur ? cur.supplier : str(payload.supplier),
    cost_price: isNew ? cost : (cost > 0 ? cost : num(cur.cost_price)), sell_price: retail, wholesale_price: wholesale,
    reorder_level: payload.reorder !== undefined ? num(payload.reorder) : cur ? num(cur.reorder_level) : 0,
    lead_time_days: payload.lead !== undefined ? num(payload.lead) : cur ? num(cur.lead_time_days) : 0,
    location_bin: payload.bin !== undefined ? str(payload.bin) : cur ? cur.location_bin : '', status: str(payload.status) === 'Discontinued' ? 'Discontinued' : 'Active',
    ...(payload.supplierSku !== undefined ? { supplier_sku: str(payload.supplierSku) } : {}),   // the supplier's code: the next file matches it at once
  });
  await pctx.tx`update products set floor_price = ${floor}, wholesale_price = ${wholesale}, updated_at = now()
               where business_id = ${pool.id} and lower(btrim(sku)) = ${String(saved.sku).toLowerCase()}`;
  return saved;
  });
  // a new colour / brand / type read from a file joins this company's own Settings > Lists too (the form's lists are its own)
  if (isNew && roleAtLeast(ctx.s.role, 'manager')) await addToLists(ctx, { category: payload.category, brand: payload.brand, type: payload.type, color: payload.color, unit: payload.unit, supplier: payload.supplier });
  return { ...(await erpJoint(ctx, { pool: pool.id })), saved: res.sku, created: !!res.created };
}
/** smart-read-3 joint: the pool's products for a new-product suggestion (names, brands, types; never the cost). */
export async function erpJointSuggestRows(ctx, poolId) {
  await needOn(ctx);
  const pool = await poolOf(ctx, poolId);
  return (await shelf(ctx, pool, false)).map((p) => ({ sku: p.sku, name: p.name, brand: p.brand, type: p.type, category: p.category, color: p.color, unit: p.unit,
                                                      supplier: '', sell_price: p.retail, cost_price: 0, reorder_level: 0, lead_time_days: 0 }));
}

async function poolProduct(pctx, pool, sku) {
  const p = (await pctx.tx`
    select p.id, p.sku, p.name, p.cost_price, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${pool.id} and lower(btrim(p.sku)) = ${str(sku).toLowerCase()} limit 1`)[0];
  if (!p) throw new Error('That product is not in this pool.');
  return p;
}
async function poolOpenOn(ctx, pool, date, what) {
  const r = (await poolRead(ctx, (t) => t`select to_char(public.pool_locked_until(${pool.id}), 'YYYY-MM-DD') as d`))[0];
  if (r && r.d && date < r.d) throw new Error('That month of ' + pool.name + ' is closed and agreed, so ' + what + '. Date it after ' + r.d + '.');
}
const txnNo = (at) => 'TXN-' + formatDate(at, 'yyyyMMdd') + '-' + (Math.floor(Math.random() * 9000) + 1000);

/** Stock bought for the pool: which partner paid is what the settlement credits. */
export async function erpJointReceive(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);   // owner 18 Oct 2026: every staff member of both companies may receive
  const qty = num(payload.qty), unit = round2(num(payload.unitCost));
  if (!(qty > 0) || qty !== Math.round(qty)) throw new Error('How many came in? A whole number above 0.');
  if (!(unit > 0)) throw new Error('What did one cost? The settlement needs the buying price.');
  const payer = str(payload.paidBy) || await sellerId(ctx);
  if (!pool.partners.some((p) => p.id === payer)) throw new Error('Who paid? Choose one of the partners.');
  await ownSide(ctx, pool, payer, 'Who paid is the month-end money');
  const at_ = str(payload.receivedAt) || payer;   // whose shelf it went on; the payer's unless said otherwise
  if (!pool.partners.some((p) => p.id === at_)) throw new Error('Received at? Choose one of the partners.');
  const today = formatDate(ctx.now, 'yyyy-MM-dd'), date = isDate(payload.date) ? payload.date : today;
  if (date > today) throw new Error('That date has not come yet.');
  await poolOpenOn(ctx, pool, date, 'stock cannot be received there');
  const got = await withPool(ctx, pool, async (pctx) => {
  await lock(pctx, 'stock');
  const p = await poolProduct(pctx, pool, payload.sku);
  // both companies enter shipments: the same one twice (same product, count, cost, payer and day) is refused unless meant
  if (!payload.again) {
    const twin = (await pctx.tx`select operator, to_char(created_at at time zone 'Asia/Dhaka', 'DD Mon HH12:MI AM') as at from stock_movements
                                where business_id = ${pool.id} and product_id = ${p.id} and kind = 'RECEIVE' and direction = 'IN' and qty = ${qty}
                                  and unit_price = ${unit} and paid_by = ${payer}
                                  and (created_at at time zone 'Asia/Dhaka')::date = ${date}::date limit 1`)[0];
    if (twin) throw new Error('ALREADY: ' + qty + ' x ' + str(p.name) + ' at ' + unit + ' was already received that day by ' + str(twin.operator) + ' (' + str(twin.at) + '). Receive it again only if this is a second shipment.');
  }
  const at = date === today ? new Date() : new Date(date + 'T06:00:00Z');   // noon in Dhaka
  await pctx.tx`
    insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note,
                                 created_by, created_at, txn_no, operator, product_name, paid_by, held_by)
    values (${pool.id}, ${p.id}, 'RECEIVE', 'IN', ${qty}, ${unit}, ${round2(qty * unit)}, 'Joint stock received', ${str(payload.supplier).slice(0, 80)},
            ${str(payload.note).slice(0, 300)}, ${pctx.s.userId}, ${at}, ${txnNo(at)}, ${who(ctx)}, ${str(p.name)}, ${payer}, ${at_})`;
  // the product's cost becomes the average of what is on the shelf and what came in
  const had = Math.max(0, num(p.stock)), old = num(p.cost_price);
  const avg = had > 0 && old > 0 ? round2((had * old + qty * unit) / (had + qty)) : unit;
  await pctx.tx`update products set cost_price = ${avg}, updated_at = now() where id = ${p.id}`;
  forget(pctx, 'TXN_LOG');
  return { sku: str(p.sku), qty, unit, cost: avg };
  });
  if (ctx.s.role !== 'owner') delete got.cost;   // joint-fix-4: the new average cost is the owners' to see
  return { ...(await erpJoint(ctx, { pool: pool.id })), received: got };
}

/** Goods handed from one partner's shelf to the other's: no sale, no money, only where they are. */
export async function erpJointMove(ctx, payload) {
  payload = payload || {};
  if (payload.how || num(payload.cost) > 0) return erpJointSend(ctx, payload);   // with how it went and what it cost
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  const qty = num(payload.qty), from = str(payload.from), to = str(payload.to), note = str(payload.note).slice(0, 200);
  await ownSide(ctx, pool, from, 'Goods are sent from your own shelf');
  if (!(qty > 0) || qty !== Math.round(qty)) throw new Error('How many? A whole number above 0.');
  if (!pool.partners.some((p) => p.id === from) || !pool.partners.some((p) => p.id === to) || from === to) throw new Error('From which partner to which? Two different ones.');
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  await poolOpenOn(ctx, pool, today, 'its stock cannot be moved');
  const names = {}; pool.partners.forEach((p) => { names[p.id] = p.name; });
  const got = await withPool(ctx, pool, async (pctx) => {
    await lock(pctx, 'stock');
    const p = await poolProduct(pctx, pool, payload.sku);
    const have = await heldBy(pctx, pool, p.id, from);
    if (qty > have) throw new Error(names[from] + ' holds only ' + have + ' of ' + str(p.name) + '. Count first, or move fewer.');
    await moveRows(pctx, pool, p.id, str(p.name), from, to, qty, num(p.cost_price), new Date(), note || ('Moved by ' + who(ctx) + ' (' + str(ctx.s.businessName) + ')'));
    forget(pctx, 'TXN_LOG');
    return { sku: str(p.sku), qty, from: names[from], to: names[to] };
  });
  return { ...(await erpJoint(ctx, { pool: pool.id })), moved: got };
}

/** Counted and found wrong: the difference, valued at cost, is the pool's gain or loss. */
export async function erpJointAdjust(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  const mistake = str(payload.direction).toUpperCase() === 'MISTAKE';
  const qty = num(payload.qty), dir = str(payload.direction).toUpperCase() === 'IN' ? 'IN' : 'OUT', reason = str(payload.reason).slice(0, 200);
  if (!(qty > 0) || qty !== Math.round(qty)) throw new Error('How many? A whole number above 0.');
  if (!reason) throw new Error(mistake ? 'Say what went wrong with the receipt. Your partner sees it.' : 'Say why the count is being corrected. Your partner sees it.');
  const where = str(payload.at) || await sellerId(ctx);   // whose shelf was counted
  if (!pool.partners.some((p) => p.id === where)) throw new Error('Whose shelf? Choose one of the partners.');
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  await poolOpenOn(ctx, pool, today, 'its stock cannot be corrected');
  const sku = await withPool(ctx, pool, async (pctx) => {
  await lock(pctx, 'stock'); await lock(pctx, 'sale');
  const p = await poolProduct(pctx, pool, payload.sku);
  if (dir === 'OUT' && qty > num(p.stock)) throw new Error('Only ' + num(p.stock) + ' of ' + str(p.name) + ' are in the pool.');
  if (mistake) { await undoReceipts(ctx, pctx, pool, p, where, qty, reason); forget(pctx, 'TXN_LOG'); return str(p.sku); }
  const cost = num(p.cost_price), at = new Date();
  await pctx.tx`
    insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note,
                                 created_by, created_at, txn_no, operator, product_name, held_by)
    values (${pool.id}, ${p.id}, ${dir === 'IN' ? 'RETURN' : 'ADJUST'}, ${dir}, ${qty}, ${cost}, ${round2(qty * cost)}, ${reason}, '',
            ${'Joint stock correction by ' + who(ctx) + ' (' + str(ctx.s.businessName) + ')'}, ${pctx.s.userId}, ${at}, ${txnNo(at)}, ${who(ctx)}, ${str(p.name)}, ${where})`;
  forget(pctx, 'TXN_LOG');
  return str(p.sku);
  });
  return { ...(await erpJoint(ctx, { pool: pool.id })), adjusted: { sku, qty, direction: dir } };
}

/**
 * joint-fix-2 (20 Oct 2026): goods received by mistake (typed twice, wrong product, a test). The newest receipts on that
 * shelf are reversed at their own cost and payer: the payer's purchases and the stock value go down, profit is untouched.
 * (Before, the only way was a count correction, which booked a loss for both partners and left the payer credited.)
 */
async function undoReceipts(ctx, pctx, pool, p, where, qty, reason) {
  const names = {}; pool.partners.forEach((x) => { names[x.id] = x.name; });
  const have = await heldBy(pctx, pool, p.id, where);
  if (qty > have) throw new Error((names[where] || 'That shelf') + ' holds only ' + have + ' of ' + str(p.name) + '.');
  const rows = await pctx.tx`
    select r.id, r.txn_no, r.qty, r.unit_price, r.paid_by, (select l.id from stock_lots l where l.movement_id = r.id order by l.seq limit 1) as lot_id,
           coalesce((select sum(u.qty) from stock_movements u where u.business_id = r.business_id and u.kind = 'RECEIVE'
                       and u.direction = 'OUT' and u.reference = 'Undo of ' || r.txn_no), 0) as undone
    from stock_movements r
    where r.business_id = ${pool.id} and r.product_id = ${p.id} and r.kind = 'RECEIVE' and r.direction = 'IN' and r.held_by = ${where}
    order by r.created_at desc, r.seq desc`;
  const open = rows.map((r) => ({ ...r, left: num(r.qty) - num(r.undone) })).filter((r) => r.left > 0);
  const can = open.reduce((a, r) => a + r.left, 0);
  if (qty > can) throw new Error('Only ' + can + ' of ' + str(p.name) + ' were received on ' + (names[where] || 'that') + '\'s shelf and not undone yet.');
  let left = qty, value = 0, k = 0;
  const at = new Date();
  for (const r of open) {
    if (left <= 0) break;
    const n = Math.min(left, r.left), unit = num(r.unit_price);
    await pctx.tx`
      insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note,
                                   created_by, created_at, txn_no, operator, product_name, paid_by, held_by, from_lot)
      values (${pool.id}, ${p.id}, 'RECEIVE', 'OUT', ${n}, ${unit}, ${-round2(n * unit)}, ${'Undo of ' + str(r.txn_no)}, '',
              ${reason + ' - received by mistake, undone by ' + who(ctx) + ' (' + str(ctx.s.businessName) + ')'},
              ${pctx.s.userId}, ${at}, ${txnNo(at) + '-u' + (++k)}, ${who(ctx)}, ${str(p.name)}, ${r.paid_by}, ${where}, ${r.lot_id})`;
    value += n * unit; left -= n;
  }
  // the average cost of what stays
  const stock = num(p.stock), rest = stock - qty;
  if (rest > 0 && num(p.cost_price) > 0) {
    const avg = round2((stock * num(p.cost_price) - value) / rest);
    if (avg > 0) await pctx.tx`update products set cost_price = ${avg}, updated_at = now() where id = ${p.id}`;
  }
}

// ---------------------------------------------------------------- asking for goods and sending them (owner 18 Oct 2026)
const REQ_WORDS = { asked: 'Asked', sent: 'Sent', received: 'Received', declined: 'Declined', cancelled: 'Cancelled' };
async function requestsOf(ctx, pool, me) {
  const names = {}; pool.partners.forEach((p) => { names[p.id] = p.name; });
  const rows = await poolRead(ctx, (t) => t`select * from pool_requests where pool_id = ${pool.id} order by (status in ('asked', 'sent')) desc, created_at desc limit 100`);
  return rows.map((r) => ({
    id: r.id, sku: str(r.sku), name: str(r.product_name), qty: num(r.qty), note: str(r.note), status: r.status, statusLabel: REQ_WORDS[r.status] || r.status,
    askedBy: names[r.asked_by] || 'Partner', askedName: str(r.asked_name), holder: names[r.holder] || '', when: formatDate(new Date(r.created_at), 'd MMM, h:mm a'),
    sentQty: num(r.sent_qty), sentName: str(r.sent_name), sentAt: r.sent_at ? formatDate(new Date(r.sent_at), 'd MMM, h:mm a') : '', how: str(r.how),
    cost: num(r.cost), costPaidBy: names[r.cost_paid_by] || '', answer: str(r.answer), receivedName: str(r.received_name),
    canSend: r.status === 'asked' && r.holder === me, canDecline: r.status === 'asked' && r.holder === me,
    canCancel: r.status === 'asked' && r.asked_by === me, canGot: r.status === 'sent' && r.asked_by === me, mine: r.asked_by === me,
  }));
}
/** The last moves between shelves (who sent what to whom, how, what it cost). */
async function movesOf(ctx, pool) {
  const names = {}; pool.partners.forEach((p) => { names[p.id] = p.name; });
  const rows = await poolRead(ctx, (t) => t`
    select o.product_name, o.qty, o.held_by as src, i.held_by as dst, o.note, o.operator, o.created_at
    from stock_movements o join stock_movements i on i.business_id = o.business_id and i.txn_no = o.txn_no || '-in' and i.kind = 'MOVE' and i.direction = 'IN'
    where o.business_id = ${pool.id} and o.kind = 'MOVE' and o.direction = 'OUT' order by o.created_at desc limit 50`);
  return rows.map((r) => ({ name: str(r.product_name), qty: num(r.qty), from: names[r.src] || '?', to: names[r.dst] || '?', note: str(r.note), by: str(r.operator),
                            when: formatDate(new Date(r.created_at), 'd MMM yyyy') }));
}
export async function erpJointAsk(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  const me = await sellerId(ctx), qty = num(payload.qty);
  if (!(qty > 0) || qty !== Math.round(qty)) throw new Error('How many do you need? A whole number above 0.');
  const asker = poolOwner(ctx, pool) && str(payload.for) ? str(payload.for) : me;
  if (!pool.partners.some((p) => p.id === asker)) throw new Error('For which partner?');
  await withPool(ctx, pool, async (pctx) => {
    const p = await poolProduct(pctx, pool, payload.sku);
    let holder = str(payload.from);
    if (!holder) {   // the partner holding most of it
      let best = -Infinity;
      for (const x of pool.partners) if (x.id !== asker) { const n = await heldBy(pctx, pool, p.id, x.id); if (n > best) { best = n; holder = x.id; } }
    }
    if (!pool.partners.some((x) => x.id === holder) || holder === asker) throw new Error('Ask which partner? Not your own company.');
    await pctx.tx`insert into pool_requests (pool_id, sku, product_name, qty, asked_by, asked_name, holder, note)
                  values (${pool.id}, ${str(p.sku)}, ${str(p.name)}, ${qty}, ${asker}, ${who(ctx) + ' (' + str(ctx.s.businessName) + ')'}, ${holder}, ${str(payload.note).slice(0, 300) || null})`;
  });
  return erpJoint(ctx, { pool: pool.id });
}
/** Send goods to the other partner - for a request, or on its own. Stock moves shelf to shelf at once; a delivery's
 *  cost is written in the joint book as an expense of the one who paid it (shared by the profit rule at month end). */
export async function erpJointSend(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  const me = await sellerId(ctx);
  const names = {}; pool.partners.forEach((p) => { names[p.id] = p.name; });
  let req = null;
  if (str(payload.request)) {
    req = (await poolRead(ctx, (t) => t`select * from pool_requests where pool_id = ${pool.id} and id = ${str(payload.request)}`))[0];
    if (!req) throw new Error('That request is not here.');
    if (req.status !== 'asked') throw new Error('That request is already ' + (REQ_WORDS[req.status] || req.status).toLowerCase() + '.');
  }
  const sku = req ? req.sku : str(payload.sku);
  const to = req ? req.asked_by : str(payload.to);
  const from = str(payload.from) || (req && req.holder) || me;
  const qty = num(payload.qty) || (req ? num(req.qty) : 0);
  const how = str(payload.how) === 'delivered' ? 'delivered' : 'collected';
  const cost = how === 'delivered' ? round2(num(payload.cost)) : 0;
  const paidBy = str(payload.paidBy) || me;
  if (!(qty > 0) || qty !== Math.round(qty)) throw new Error('How many are sent? A whole number above 0.');
  if (!pool.partners.some((p) => p.id === from) || !pool.partners.some((p) => p.id === to) || from === to) throw new Error('From which partner to which? Two different ones.');
  await ownSide(ctx, pool, from, 'Goods are sent from your own shelf');
  if (cost < 0) throw new Error('The transport cost cannot be negative.');
  if (cost > 0) {
    if (!pool.partners.some((p) => p.id === paidBy)) throw new Error('Who paid the transport?');
    await ownSide(ctx, pool, paidBy, 'Who paid the transport');
  }
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  await poolOpenOn(ctx, pool, today, 'its stock cannot be moved');
  const got = await withPool(ctx, pool, async (pctx) => {
    await lock(pctx, 'stock');
    const p = await poolProduct(pctx, pool, sku);
    const have = await heldBy(pctx, pool, p.id, from);
    if (qty > have) throw new Error(names[from] + ' holds only ' + have + ' of ' + str(p.name) + '. Send fewer, or count first.');
    const note = (how === 'delivered' ? 'Delivered' : 'Collected') + ' - sent by ' + who(ctx) + ' (' + str(ctx.s.businessName) + ')' +
                 (cost > 0 ? ', transport ' + cost + ' paid by ' + names[paidBy] : '') + (str(payload.note) ? ' - ' + str(payload.note).slice(0, 150) : '');
    await moveRows(pctx, pool, p.id, str(p.name), from, to, qty, num(p.cost_price), new Date(), note);
    if (cost > 0) {
      await pctx.tx`insert into pool_ledger (pool_id, kind, partner_business_id, amount, entry_date, category, note)
                    values (${pool.id}, 'EXPENSE'::pool_entry_kind, ${paidBy}, ${cost}, ${today}::date, 'Transport',
                            ${('Moving ' + qty + ' x ' + str(p.name) + ' from ' + names[from] + ' to ' + names[to]).slice(0, 300)})`;
    }
    if (req) {
      await pctx.tx`update pool_requests set status = 'sent', sent_qty = ${qty}, sent_name = ${who(ctx) + ' (' + str(ctx.s.businessName) + ')'}, sent_at = now(),
                      how = ${how}, cost = ${cost}, cost_paid_by = ${cost > 0 ? paidBy : null}, answer = ${str(payload.note).slice(0, 300) || null}
                    where id = ${req.id}`;
    }
    forget(pctx, 'TXN_LOG');
    return { sku: str(p.sku), name: str(p.name), qty, from: names[from], to: names[to], how, cost };
  });
  return { ...(await erpJoint(ctx, { pool: pool.id })), moved: got };
}
/** The asker says the goods arrived. */
export async function erpJointGot(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  const me = await sellerId(ctx);
  await withPool(ctx, pool, async (pctx) => {
    const r = (await pctx.tx`select * from pool_requests where pool_id = ${pool.id} and id = ${str(payload.request)}`)[0];
    if (!r) throw new Error('That request is not here.');
    if (r.status !== 'sent') throw new Error('That request is not on its way.');
    if (r.asked_by !== me && !poolOwner(ctx, pool)) throw new Error('The company that asked confirms it.');
    await pctx.tx`update pool_requests set status = 'received', received_name = ${who(ctx) + ' (' + str(ctx.s.businessName) + ')'}, received_at = now() where id = ${r.id}`;
  });
  return erpJoint(ctx, { pool: pool.id });
}
/** Decline (the holder) or cancel (the asker) a request not sent yet. */
export async function erpJointAskAct(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  const me = await sellerId(ctx), action = str(payload.action);
  if (!['decline', 'cancel'].includes(action)) throw new Error('Decline or cancel?');
  await withPool(ctx, pool, async (pctx) => {
    const r = (await pctx.tx`select * from pool_requests where pool_id = ${pool.id} and id = ${str(payload.request)}`)[0];
    if (!r) throw new Error('That request is not here.');
    if (r.status !== 'asked') throw new Error('It is already ' + (REQ_WORDS[r.status] || r.status).toLowerCase() + '.');
    const side = action === 'decline' ? r.holder : r.asked_by;
    if (side !== me && !poolOwner(ctx, pool)) throw new Error(action === 'decline' ? 'The company asked declines it.' : 'The company that asked cancels it.');
    if (action === 'decline' && !str(payload.note)) throw new Error('Say why, so they know.');
    await pctx.tx`update pool_requests set status = ${action === 'decline' ? 'declined' : 'cancelled'}, answer = ${str(payload.note).slice(0, 300) || null} where id = ${r.id}`;
  });
  return erpJoint(ctx, { pool: pool.id });
}

/** Creators (handlers/creatorportal.js): sponsorship rolls leave a pool, or come back when the brand replaces them.
 *  Zero value - no gain, no loss, nothing in the settlement; only the quantity on this company's shelf moves.
 *  joint-fix-2: the month end shows them apart as "lent to brands" (pool_settlement, 133), so Stock at cost is real. */
export async function poolSponsorMove(ctx, { pool: poolId, sku, qty, dir, note }) {
  await needOn(ctx);
  const pool = await poolOf(ctx, poolId);
  needOwner(ctx, pool);
  const n = num(qty), out = dir !== 'IN';
  if (!(n > 0)) throw new Error('How many?');
  await poolOpenOn(ctx, pool, formatDate(ctx.now, 'yyyy-MM-dd'), 'its stock cannot change');
  return withPool(ctx, pool, async (pctx) => {
    await lock(pctx, 'stock'); await lock(pctx, 'sale');
    const p = await poolProduct(pctx, pool, sku);
    if (out && n > num(p.stock)) throw new Error('Only ' + num(p.stock) + ' of ' + str(p.name) + ' are in ' + pool.name + '.');
    const at = new Date();
    await pctx.tx`
      insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note,
                                   created_by, created_at, txn_no, operator, product_name, held_by)
      values (${pool.id}, ${p.id}, ${out ? 'ADJUST' : 'RETURN'}, ${out ? 'OUT' : 'IN'}, ${n}, 0, 0, ${str(note).slice(0, 200)}, '',
              ${(out ? 'Sponsorship rolls taken by ' : 'Sponsorship rolls replaced by the brand, booked by ') + who(ctx) + ' (' + str(ctx.s.businessName) + ')'},
              ${pctx.s.userId}, ${at}, ${txnNo(at)}, ${who(ctx)}, ${str(p.name)}, ${pctx.jointMe || null})`;
    forget(pctx, 'TXN_LOG');
    return { sku: str(p.sku), name: str(p.name), pool: pool.name };
  });
}
/** Creators: the pools this company owns into that hold a SKU, with what is on their shelf. */
export async function poolsWithSku(ctx, sku) {
  if (!(await jointOn(ctx))) return [];
  const out = [];
  for (const pool of await myPools(ctx)) {
    if (!pool.member || ctx.s.role !== 'owner') continue;
    try {
      const r = await withPool(ctx, pool, async (pctx) => (await pctx.tx`select coalesce(ps.stock, 0) as stock from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${pool.id} and lower(btrim(p.sku)) = ${str(sku).toLowerCase()} limit 1`)[0]);
      if (r) out.push({ id: pool.id, name: pool.name, stock: num(r.stock) });
    } catch (_) { /* a pool that cannot be read now is left out */ }
  }
  return out;
}
/** A line in the pool's money book, or striking one out. */
export async function erpJointBook(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  // joint-fix-3: an owner writes their own company's lines only (a cash hand-over: the giver or the receiver), and
  // strikes out only those; the other company's lines are theirs to write
  const me = await sellerId(ctx);
  const mine = (partner, to) => partner === me || (to && to === me);
  if (!str(payload.strike) && !mine(str(payload.partner), str(payload.kind) === 'transfer' ? str(payload.to) : '')) {
    throw new Error('Write only your own company\'s lines (' + str(ctx.s.businessName) + '). The other company writes theirs, so both books agree.');
  }
  await withPool(ctx, pool, async (pctx) => {
    if (str(payload.strike)) {
      const l = (await pctx.tx`select partner_business_id, to_business_id from pool_ledger where pool_id = ${pool.id} and id = ${str(payload.strike)}`)[0];
      if (l && !mine(l.partner_business_id, l.to_business_id)) throw new Error('That line is the other company\'s: ask them to strike it out.');
      await erpPoolEntryRemove(pctx, { id: payload.strike, reason: payload.reason, month: payload.month });
    } else await erpPoolEntryAdd(pctx, payload);
  });
  return erpJoint(ctx, { pool: pool.id, month: payload.month });
}

/** A partner's price tier, a new invite code, the slow-payer days. */
export async function erpJointSettings(ctx, payload) {
  payload = payload || {};
  await needOn(ctx);
  const pool = await poolOf(ctx, payload.pool);
  needOwner(ctx, pool);
  if (payload.slowDays !== undefined) {
    const d = Math.round(num(payload.slowDays));
    if (!(d >= 7 && d <= 180)) throw new Error('Between 7 and 180 days.');
  }
  await withPool(ctx, pool, async (pctx) => {
    if (payload.tier && isId(payload.tier.partner)) await erpPoolTier(pctx, { partner: payload.tier.partner, tier: payload.tier.tier });
    if (payload.invite) await erpPoolInvite(pctx);
    if (payload.slowDays !== undefined) await setConfig(pctx, 'joint_slow_days', String(Math.round(num(payload.slowDays))));
  });
  if (payload.tier) delete ctx.memo.myPools;
  return erpJoint(ctx, { pool: pool.id, month: payload.month });
}

// =====================================================================================
// Selling. The customer's invoice is the seller's own; these make the pool's side of it.
// =====================================================================================

/**
 * Before a sale with joint lines is written: which pool each line comes from,
 * the pools locked (so two companies cannot sell the last piece at once), and
 * what is on their shelves priced for this company.
 *   -> { pools: [pool], recs: { markedSkuLower: { sku, code, name, sell, stock, floor, poolId, joint } } }
 */
export async function prepareJointSale(ctx, items) {
  await needOn(ctx);
  const pools = await myPools(ctx);
  const used = new Map();
  for (const it of items) {
    const sku = str(it.sku), mark = sku.slice(-4).toLowerCase();
    const hit = pools.filter((p) => p.id.replace(/-/g, '').slice(0, 4).toLowerCase() === mark);
    if (hit.length !== 1) throw new Error('Unknown product: ' + cleanSku(sku) + ' (joint stock). Reload the page and add it again.');
    used.set(hit[0].id, hit[0]);
  }
  const list = [...used.values()].sort((a, b) => (a.id < b.id ? -1 : 1));
  const recs = {};
  for (const pool of list) {
    // same database: the pool is locked now, for the whole sale; another database: inside its own write (mirrorJointSale)
    if (!isRemote(ctx)) await lock(inPool(ctx, pool), 'sale');
    for (const p of await shelf(ctx, pool, false)) {
      if (p.status === 'Discontinued') continue;
      const marked = jointSku(p.sku, pool.id);
      recs[marked.toLowerCase()] = { sku: marked, code: p.sku, name: p.name, sell: p.price, stock: p.stock, floor: p.floor, poolId: pool.id, joint: true };
    }
  }
  return { pools: list, recs };
}

/**
 * Nobody sells joint stock below its floor price; the owner may, and it is flagged.
 * `lines` = [{ name, qty, unit, disc, floor }] -> the shortfall in money (0 when none).
 */
export function floorCheck(ctx, lines) {
  let short = 0;
  for (const l of lines) {
    if (!(l.floor > 0) || !(l.qty > 0)) continue;
    const net = (l.qty * l.unit - l.disc) / l.qty;
    if (net >= l.floor - 0.005) continue;
    if (ctx.s.role !== 'owner') {
      throw new Error(l.name + ': ' + (Math.round(net * 100) / 100) + ' each is below the floor price of ' + l.floor +
        ' agreed for joint stock. Only the owner can go below it.');
    }
    short += (l.floor - net) * l.qty;
  }
  return round2(short);
}

/**
 * The pool's own copy of the joint lines of a seller's invoice: pool stock out,
 * pool cost, the pool's invoice number, sold by this company. The customer is
 * not named there - the partner never sees the other's customers.
 *   sale = { invoiceNo, date, lines: [{ poolId, code, qty, unit, disc, total }], shortfall: { poolId: n } }
 */
export async function mirrorJointSale(ctx, joint, sale, createInvoice) {
  const out = [], seller = str(ctx.s.businessName) || 'Partner', me = await sellerId(ctx), remote = isRemote(ctx);
  const day = formatDate(sale.at, 'yyyy-MM-dd');
  for (const pool of joint.pools) {
    const ls = sale.lines.filter((l) => l.poolId === pool.id);
    if (!ls.length) continue;
    await poolOpenOn(ctx, pool, day, 'a joint sale cannot be dated there');
    const total = round2(ls.reduce((a, l) => a + l.total, 0));
    // another database: this is saved at once in the provider's database, marked pending; if this
    // company's own transaction then fails, it is taken out again (onRollback), else confirmed (afterCommit).
    // A crash in between is caught by the nightly check (jointReconcile).
    const res = await withPool(ctx, pool, async (pctx) => {
      const r = await createInvoice(pctx, {
        customer: { name: seller + ' \u00b7 ' + sale.invoiceNo, source: 'Joint' },
        items: ls.map((l) => ({ sku: l.code, qty: l.qty })), payMode: 'none', date: sale.date || '',
        note: 'Joint stock sold by ' + seller + ' on their invoice ' + sale.invoiceNo,
      }, { mirror: { seller: me, lines: ls.map((l) => ({ unit: l.unit, disc: l.disc })) } });
      // whose shelf: the sale took it from the seller's; sold more than the seller held -> moved from the partner first
      for (const l of ls) {
        const pr = (await pctx.tx`select id, name from products where business_id = ${pool.id} and lower(btrim(sku)) = ${str(l.code).toLowerCase()}`)[0];
        if (!pr) continue;
        // the sale row is already written as OUT from the seller's shelf; top the shelf up from before the sale
        const mv = await ensureHeld(pctx, pool, pr.id, str(pr.name), me, 0, 'Moved on sale ' + sale.invoiceNo + ' [' + r.invoiceNo + ']');
        if (mv && mv.length) (sale.moved = sale.moved || []).push({ pool: pool.name, product: str(pr.name), moved: mv });
      }
      await pctx.tx`
        insert into joint_sales (pool_id, seller_business_id, seller_invoice_no, pool_invoice_no, joint_total, below_floor, status)
        values (${pool.id}, ${me}, ${sale.invoiceNo}, ${r.invoiceNo}, ${total}, ${num((sale.shortfall || {})[pool.id])}, ${remote ? 'pending' : 'ok'})`;
      return r;
    });
    if (remote) {
      const poolNo = res.invoiceNo;
      if (ctx.onRollback) ctx.onRollback(() => dropMirror(ctx.deps.control, pool.id, poolNo));
      if (ctx.afterCommit) ctx.afterCommit(() => ctx.deps.control`update joint_sales set status = 'ok' where pool_id = ${pool.id} and pool_invoice_no = ${poolNo}`);
      else await ctx.deps.control`update joint_sales set status = 'ok' where pool_id = ${pool.id} and pool_invoice_no = ${poolNo}`;
    }
    out.push({ pool: pool.id, name: pool.name, invoiceNo: res.invoiceNo, total });
  }
  return out;
}

/** A pool's copy of a sale that never happened (the seller's own save failed): taken out as if never written. */
export async function dropMirror(control, poolId, poolInvoiceNo) {
  await control.begin(async (t) => {
    await t`select set_config('erp.system', 'on', true)`;
    const inv = (await t`select id from invoices where business_id = ${poolId} and invoice_no = ${poolInvoiceNo}`)[0];
    if (inv) {
      await t`delete from stock_movements where business_id = ${poolId} and invoice_id = ${inv.id}`;
      // joint-fix-5: the shelf moves made for that sale too (they carry no invoice id, only its number in the note)
      await t`delete from stock_movements where business_id = ${poolId} and kind = 'MOVE' and note like ${'Moved on sale % [' + poolInvoiceNo + ']'}`;
      await t`delete from payments where business_id = ${poolId} and invoice_no = ${poolInvoiceNo}`;
      await t`delete from invoices where id = ${inv.id}`;
    }
    await t`delete from joint_sales where pool_id = ${poolId} and pool_invoice_no = ${poolInvoiceNo}`;
  });
}

/** A company on its own database joins a pool with the invite code: it gets a stand-in row here. */
async function remoteJoin(ctx, rawCode, displayName) {
  const code = str(rawCode).toUpperCase();
  if (!code) throw new Error('Type the invite code your partner sent.');
  const name = str(displayName) || str(ctx.s.businessName) || 'Partner';
  const pool = await controlTx(ctx, async (t) => {
    const inv = (await t`select code, pool_id, used_at, expires_at from pool_invites where code = ${code} for update`)[0];
    if (!inv || inv.used_at || new Date(inv.expires_at).getTime() < Date.now()) throw new Error('This invite code is invalid, used or expired.');
    let sid = ((await t`select id from businesses where remote_tenant = ${ctx.deps.install.id} and remote_business = ${ctx.biz}`)[0] || {}).id;
    if (!sid) sid = (await t`insert into businesses (name, remote_tenant, remote_business) values (${name.slice(0, 80)}, ${ctx.deps.install.id}, ${ctx.biz}) returning id`)[0].id;
    if ((await t`select 1 from pool_partners where pool_id = ${inv.pool_id} and partner_business_id = ${sid}`).length) throw new Error('This company is already a partner of that joint stock.');
    await t`insert into pool_partners (pool_id, partner_business_id, display_name, price_tier) values (${inv.pool_id}, ${sid}, ${name.slice(0, 80)}, 'retail')`;
    await t`update pool_invites set used_at = now() where code = ${code}`;
    ctx.memo.__sid = sid;
    return (await t`select id, name from businesses where id = ${inv.pool_id}`)[0];
  });
  delete ctx.memo.myPools;
  return { id: pool.id, name: str(pool.name) };
}

/** Joint sales from other databases still waiting for their side (only ever for a moment, or after a crash). */
async function pendingOf(ctx, pool) {
  return (await poolRead(ctx, (t) => t`select count(*)::int as n from joint_sales where pool_id = ${pool.id} and status = 'pending'`))[0].n;
}

/** The joint sales behind one of this company's invoices. */
async function jointOf(ctx, invoiceNo) {
  const me = await sellerId(ctx);
  if (!me) return [];
  return poolRead(ctx, (t) => t`
    select j.pool_id, j.pool_invoice_no, j.joint_total, b.name
    from joint_sales j join businesses b on b.id = j.pool_id
    where j.seller_business_id = ${me} and j.seller_invoice_no = ${str(invoiceNo)}`);
}
export async function hasJoint(ctx, invoiceNo) { return (await jointOf(ctx, invoiceNo)).length > 0; }

/**
 * Money. Whatever real money has come in on the seller's invoice belongs to
 * the pool in the share the joint goods are of the invoice (what is still
 * billed: returns taken off). Adjustments and returns are not money. The
 * difference from what the pool already has is written in the pool as one
 * payment line (method "Joint"), received by this company.
 */
export async function syncJoint(ctx, invoiceNo) {
  // another database: worked out once this company's own save is through, from what it then holds
  if (isRemote(ctx) && ctx.afterCommit) return later(ctx, 'sync:' + invoiceNo, (c) => syncJointNow(c, invoiceNo));
  return syncJointNow(ctx, invoiceNo);
}
async function syncJointNow(ctx, invoiceNo) {
  const links = await jointOf(ctx, invoiceNo);
  if (!links.length) return;
  const inv = (await ctx.tx`select grand_total from invoices where business_id = ${ctx.biz} and invoice_no = ${str(invoiceNo)}`)[0];
  if (!inv) return;
  const pays = await ctx.tx`select amount, method from payments where business_id = ${ctx.biz} and invoice_no = ${str(invoiceNo)}`;
  let money = 0, returned = 0, adjusted = 0;
  for (const p of pays) {
    const m = str(p.method).toLowerCase();
    if (m === 'returned') returned += num(p.amount);
    else if (m === 'adjusted') adjusted += num(p.amount);
    else money += num(p.amount);
  }
  const billed = round2(num(inv.grand_total) - returned), me = await sellerId(ctx);
  // joint-fix-2: a bill closed with a write-off (courier short, a discount after the sale) is closed for the pool too.
  // The write-off is already in the seller's own profit, so the pool gets its whole part, not a share of the money.
  const closed = billed > 0 && money + adjusted >= billed - 0.5;
  for (const link of links) {
    await withPool(ctx, { id: link.pool_id, name: str(link.name) }, async (pctx) => {
      const mp = await pctx.tx`select amount, method from payments where business_id = ${link.pool_id} and invoice_no = ${link.pool_invoice_no}`;
      let had = 0, back = 0;
      for (const p of mp) { if (str(p.method).toLowerCase() === 'returned') back += num(p.amount); else had += num(p.amount); }
      const joint = Math.max(0, round2(num(link.joint_total) - back));
      let want = billed > 0 && joint > 0 ? round2(Math.max(0, money) * joint / billed) : 0;
      if (money >= billed - 0.5 || closed) want = joint;
      want = Math.max(0, Math.min(joint, want));
      const delta = round2(want - had);
      if (Math.abs(delta) >= 0.01) {
        const at = new Date();
        await pctx.tx`
          insert into payments (business_id, payment_no, invoice_no, customer, paid_at, amount, method, note, recorded_by, received_by)
          values (${link.pool_id}, ${'J' + formatDate(at, 'yyMMddHHmmss') + '-' + Math.floor(Math.random() * 9000 + 1000)}, ${link.pool_invoice_no},
                  ${str(ctx.s.businessName) + ' \u00b7 ' + str(invoiceNo)}, ${at}, ${delta}, 'Joint',
                  ${(delta > 0 ? (closed && money < billed - 0.5 ? 'part of the closed bill (the seller covers the write-off) on ' : 'share of money received on ') : 'share of money given back on ') + str(invoiceNo)}, ${who(ctx)}, ${me})`;
        forget(pctx, 'PAYMENTS');
      }
      const got = round2(had + delta + back), due = Math.max(0, round2(num(link.joint_total) - got));
      await pctx.tx`update invoices set advance_paid = ${got}, due_amount = ${due},
                     payment_status = ${due <= 0.5 ? 'Paid' : got > 0 ? 'Partial' : 'Pending'}
                   where business_id = ${link.pool_id} and invoice_no = ${link.pool_invoice_no}`;
      forget(pctx, 'SALES_LOG');
    });
  }
}

/**
 * Goods of a joint line came back to the seller: they go back on the pool's
 * shelf (when good), the pool's sale is reduced by a return note of its own,
 * dated today. `take` = the seller's return lines [{ sku (marked), product, qty, worth, unit, good }].
 */
export async function mirrorJointReturn(ctx, invoiceNo, take, rid, reason, at) {
  const mine = take.filter((t) => JOINT_MARK.test(str(t.sku)));
  if (!mine.length) return;
  if (isRemote(ctx) && ctx.afterCommit) return later(ctx, 'rtn:' + rid, (c) => mirrorJointReturnNow(c, invoiceNo, mine, rid, reason, at));
  return mirrorJointReturnNow(ctx, invoiceNo, mine, rid, reason, at);
}
/** The pool's return note number for a seller's return (joint-fix-5: with the seller's mark; before: rid + '-J'). */
const poolReturnNo = (rid, seller) => rid + '-J' + String(seller || '').replace(/-/g, '').slice(0, 4).toLowerCase();
async function mirrorJointReturnNow(ctx, invoiceNo, mine, rid, reason, at) {
  const links = await jointOf(ctx, invoiceNo), me = await sellerId(ctx);
  const day = formatDate(at, 'yyyy-MM-dd');
  for (const link of links) {
    const mark = '~j' + String(link.pool_id).replace(/-/g, '').slice(0, 4).toLowerCase();
    const ls = mine.filter((t) => str(t.sku).toLowerCase().endsWith(mark));
    if (!ls.length) continue;
    const pool = { id: link.pool_id, name: str(link.name) };
    await poolOpenOn(ctx, pool, day, 'a return cannot be written there');
    await withPool(ctx, pool, async (pctx) => {
      const tx = pctx.tx;
      await lock(pctx, 'sale');
      const head = (await tx`select customer_name, sold_by from invoices where business_id = ${pool.id} and invoice_no = ${link.pool_invoice_no}`)[0];
      if (!head) return;
      // one return note per return of the seller's - written twice (a retry) it is still one
      const prid = poolReturnNo(rid, me);   // joint-fix-5: the seller's mark too - two partners' RTN-<second> can be the same
      if ((await tx`select 1 from invoices where business_id = ${pool.id} and invoice_no = ${prid} limit 1`).length) return;
      const rtn = (await tx`
        insert into invoices (business_id, invoice_no, customer_name, customer_phone, customer_address, source, subtotal, discount, delivery_charge,
                              grand_total, advance_paid, due_amount, payment_method, payment_status, delivery_status, note, created_by, created_at, customer_key, sold_by)
        values (${pool.id}, ${prid}, ${str(head.customer_name)}, '', '', 'Joint', 0, 0, 0, 0, 0, 0, '', 'Paid', '',
                ${'return of ' + link.pool_invoice_no + ' - ' + reason}, ${pctx.s.userId}, ${at}, ${'n:' + str(head.customer_name).toLowerCase()}, ${head.sold_by})
        returning id`)[0].id;
      let value = 0;
      for (let i = 0; i < ls.length; i++) {
        const t = ls[i], code = cleanSku(t.sku);
        const sold = (await tx`
          select l.product_id, l.unit_cost, l.name from invoice_lines l join invoices i on i.id = l.invoice_id
          where i.business_id = ${pool.id} and i.invoice_no = ${link.pool_invoice_no} and lower(btrim(l.sku)) = ${code.toLowerCase()} and l.qty > 0
          order by l.line_no limit 1`)[0];
        if (!sold) continue;
        value += t.worth;
        await tx`
          insert into invoice_lines (business_id, invoice_id, product_id, sku, name, qty, unit_price, discount, line_total, line_no, unit_cost)
          values (${pool.id}, ${rtn}, ${sold.product_id}, ${code}, ${str(sold.name) + (t.good ? ' (returned)' : ' (returned damaged)')},
                  ${t.good ? -t.qty : 0}, ${round2(t.unit)}, 0, ${-t.worth}, ${i + 1}, ${num(sold.unit_cost)})`;
        await tx`
          insert into returns (business_id, return_no, returned_at, invoice_no, sku, product, qty, condition, value, money, customer, reason, recorded_by)
          values (${pool.id}, ${prid}, ${at}, ${link.pool_invoice_no}, ${code}, ${str(sold.name)}, ${t.qty}, ${t.good ? 'good' : 'damaged'}, ${t.worth},
                  'joint sale reduced', ${str(head.customer_name)}, ${reason}, ${who(ctx)})`;
        if (t.good && sold.product_id) {
          await tx`
            insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note, invoice_id,
                                         created_by, created_at, txn_no, operator, product_name, held_by)
            values (${pool.id}, ${sold.product_id}, 'RETURN', 'IN', ${t.qty}, 0, 0, ${'Return: ' + link.pool_invoice_no}, ${str(head.customer_name)},
                    ${prid + ' - ' + reason}, ${rtn}, ${pctx.s.userId}, ${at}, ${txnNo(at)}, ${who(ctx)}, ${str(sold.name)}, ${head.sold_by})`;
        }
      }
      value = round2(value);
      if (value > 0) {
        await tx`
          insert into payments (business_id, payment_no, invoice_no, customer, paid_at, amount, method, note, recorded_by, received_by)
          values (${pool.id}, ${'R' + formatDate(at, 'yyMMddHHmmss') + '-J' + Math.floor(Math.random() * 900 + 100)}, ${link.pool_invoice_no}, ${str(head.customer_name)},
                  ${at}, ${value}, 'Returned', ${'goods returned [return:' + prid + ']'}, ${who(ctx)}, ${me})`;
      }
      forget(pctx, 'SALES_LOG', 'RETURNS', 'TXN_LOG', 'PAYMENTS');
    });
  }
}

// =====================================================================================
// The safety net for joint sales across databases (run by the provider's timers).
// =====================================================================================

/** A context for one remote company's database, as its timer (no person). */
function remoteCtx(td, bizId, name, tx) {
  return { tx, deps: td, biz: bizId, now: new Date(), memo: {}, sql: td.sqlAux || td.sql,
           s: { userId: null, name: 'Timer', role: 'owner', businessName: name, memberships: [] } };
}

/**
 * 1. a joint sale still 'pending' a few minutes later (the partner's server stopped between its two
 *    saves): kept if the partner's invoice is there, taken out if it is not;
 * 2. the pool's share of the money of every joint sale from another database in the last 90 days is
 *    worked out again from the partner's own invoice (a missed after-save step is healed);
 * 3. a return of joint goods the pool has not heard of is written.
 * Returns what it did, for the timer's log.
 */
export async function jointReconcile(deps) {
  const sql = deps.sql, out = { checked: 0, kept: 0, dropped: 0, synced: 0, returns: 0, errors: [] };
  if (!deps.tenantDeps) return out;
  const pend = await sql`
    select js.pool_id, js.pool_invoice_no, js.seller_invoice_no, js.joint_total, b.remote_tenant, b.remote_business
    from joint_sales js join businesses b on b.id = js.seller_business_id
    where js.status = 'pending' and js.created_at < now() - interval '3 minutes' and b.remote_tenant is not null`;
  for (const p of pend) {
    out.checked++;
    try {
      const td = await deps.tenantDeps(p.remote_tenant);
      // joint-fix-5: the number alone is not enough - a failed save does not use it up, so the next (own-goods) sale
      // can carry it. Kept only if that invoice has this pool's joint lines.
      const mark = '~J' + String(p.pool_id).replace(/-/g, '').slice(0, 4);
      const there = await td.sql`select 1 from invoices i join invoice_lines l on l.invoice_id = i.id
                                 where i.business_id = ${p.remote_business} and i.invoice_no = ${p.seller_invoice_no}
                                   and lower(l.sku) like ${'%' + mark.toLowerCase()} limit 1`;
      if (there.length) { await sql`update joint_sales set status = 'ok' where pool_id = ${p.pool_id} and pool_invoice_no = ${p.pool_invoice_no}`; out.kept++; }
      else { await dropMirror(sql, p.pool_id, p.pool_invoice_no); out.dropped++; }
    } catch (e) { out.errors.push(String((e && e.message) || e).slice(0, 200)); }
  }
  const sellers = await sql`
    select distinct b.id, b.name, b.remote_tenant, b.remote_business
    from joint_sales js join businesses b on b.id = js.seller_business_id
    where b.remote_tenant is not null and js.status = 'ok' and js.created_at > now() - interval '90 days'`;
  for (const b of sellers) {
    let td;
    try { td = await deps.tenantDeps(b.remote_tenant); } catch (e) { out.errors.push(str(b.name) + ': ' + String((e && e.message) || e).slice(0, 160)); continue; }
    const links = await sql`select seller_invoice_no, pool_id from joint_sales where seller_business_id = ${b.id} and status = 'ok' and created_at > now() - interval '90 days'`;
    for (const l of links) {
      try {
        await td.sql.begin(async (tx) => {
          const c = remoteCtx(td, b.remote_business, str(b.name), tx);
          const back = await tx`select return_no, sku, product, qty, condition, value, reason, returned_at from returns
                                where business_id = ${b.remote_business} and invoice_no = ${l.seller_invoice_no} and sku ~* '~J[0-9a-f]{4}$'`;
          const byRid = {};
          for (const r of back) (byRid[r.return_no] = byRid[r.return_no] || []).push(r);
          for (const rid of Object.keys(byRid)) {
            const rows = byRid[rid], have = await controlTx(c, (t) => t`select 1 from invoices where business_id = ${l.pool_id}
                                                                          and invoice_no in (${rid + '-J'}, ${poolReturnNo(rid, b.id)}) limit 1`);
            if (have.length) continue;
            await mirrorJointReturnNow(c, l.seller_invoice_no, rows.map((r) => ({ sku: str(r.sku), product: str(r.product), qty: num(r.qty), worth: num(r.value),
              unit: num(r.qty) > 0 ? num(r.value) / num(r.qty) : 0, good: str(r.condition) === 'good' })), rid, str(rows[0].reason) || 'return', new Date(rows[0].returned_at));
            out.returns++;
          }
          await syncJointNow(c, l.seller_invoice_no);
        });
        out.synced++;
      } catch (e) { out.errors.push(str(b.name) + ' ' + l.seller_invoice_no + ': ' + String((e && e.message) || e).slice(0, 160)); }
    }
  }
  return out;
}

/** Platform > Company copies: joint stock on or off for a company running on its own database. */
export async function erpPlatformJointCopy(ctx, payload) {
  if (!(await platformAdmin(ctx))) throw new Error('Your account does not have access to that.');
  const id = str(payload && payload.id), on = !!(payload && payload.on);
  if (!isId(id)) throw new Error('Which company copy?');
  if (!(await ctx.sql`select 1 from erp_tenants where id = ${id}`).length) throw new Error('That company is not on the provider’s server yet.');
  if (!on && (await ctx.sql`select 1 from pool_partners pp join businesses b on b.id = pp.partner_business_id where b.remote_tenant = ${id} limit 1`).length) {
    throw new Error('That company is a partner in a joint stock. Switching it off would hide stock and money two companies own - it stays on while the pool exists.');
  }
  await ctx.sql`update erp_tenants set joint = ${on} where id = ${id}`;
  return { ok: true, id, joint: on };
}

/** {month 'yyyy-MM': this company's share of that month's joint profit} - by the pool's own rule (capital at the start
 *  of the month). Owner 18 Oct 2026: the joint stock's profit goes to the main business. Read on the server for anyone
 *  who sees the profit report; the pool's cost and details stay in the pool. */
export async function jointShareByMonth(ctx, months) {
  const out = {};
  if (!(await jointOn(ctx))) return out;
  const me = await sellerId(ctx);
  const want = new Set(months || []);
  for (const pool of await myPools(ctx)) {
    // one report per pool carries every month: its profit and each partner's ratio at the start of it
    const r = (await poolRead(ctx, (t) => t`select pool_settlement(${pool.id}, null) as r`))[0];
    for (const x of ((r && r.r) || {}).months || []) {
      if (want.size && !want.has(x.month)) continue;
      const share = round2(num(x.profit) * num((x.ratios || {})[me]));
      if (share) out[x.month] = round2((out[x.month] || 0) + share);
    }
  }
  return out;
}

/**
 * This company's part of each joint stock, for its balance sheet (owner 18 Oct 2026). The money and the customer dues
 * of its own joint sales are already in its own cash and dues, so they are taken off here; what it paid into the pool
 * (stock bought, shared costs, cash handed over) and its share of the pool's profit are added:
 *   part = profit share + purchases paid + expenses paid + cash handed over - cash received - joint goods it sold.
 * Above 0: something it owns. Below 0: it owes the joint stock. Capital written in the pool is not cash that left
 * this company, so it is not counted.
 */
export async function jointPosition(ctx) {
  const out = [];
  if (!(await jointOn(ctx))) return out;
  const me = await sellerId(ctx);
  for (const pool of await myPools(ctx)) {
    const r = (await poolRead(ctx, (t) => t`select pool_settlement(${pool.id}, null) as r`))[0];
    const p = ((((r && r.r) || {}).partners) || []).find((x) => x.business_id === me);
    if (!p) continue;
    const part = round2(num(p.profit_share) + num(p.purchases) + num(p.expenses_paid) + num(p.transfers_out) - num(p.transfers_in) - num(p.invoiced));
    out.push({ pool: pool.name, amount: part, profitShare: num(p.profit_share), sold: num(p.invoiced), paidIn: round2(num(p.purchases) + num(p.expenses_paid)) });
  }
  return out;
}

/**
 * Owner 18 Oct 2026: joint stock is received on the SAME Receive page as the company's own stock (same supplier, cost,
 * shipping and costs, same sums). stock.js receiveShipment asks this for the pool side: the pool's products, a new
 * joint product, what is on its shelf, and writing the receipts (paid by this company, on the shelf chosen) with the
 * pool's average cost. The money side (supplier bill, payment, freight) stays in this company's own books.
 */
export async function poolReceiveTarget(ctx, poolId, receivedAt) {
  await needOn(ctx);
  const pool = await poolOf(ctx, poolId);
  const me = await sellerId(ctx);
  const at_ = str(receivedAt) || me;
  if (!pool.partners.some((p) => p.id === at_)) throw new Error('Received at which shop? Choose one of the partners.');
  await poolOpenOn(ctx, pool, formatDate(ctx.now, 'yyyy-MM-dd'), 'stock cannot be received there');
  return {
    pool,
    rows: () => withPool(ctx, pool, (pctx) => pctx.tx`select id, sku, name, category, brand, type, cost_price, weight_g, length_mm, width_mm, height_mm
                                                    from products where business_id = ${pool.id}`),
    onHand: async () => {
      const out = {};
      for (const r of await withPool(ctx, pool, (pctx) => pctx.tx`select p.sku, coalesce(ps.stock, 0) as stock from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${pool.id}`)) out[str(r.sku).toLowerCase()] = num(r.stock);
      return out;
    },
    create: async (d) => {
      const r = await erpJointProduct(ctx, { pool: pool.id, isNew: true, sku: str(d.sku), name: str(d.product_name), category: str(d.category), brand: str(d.brand),
                                            type: str(d.type), color: str(d.color), unit: str(d.unit) || 'Piece', retail: num(d.sell_price), wholesale: num(d.wholesale_price),
                                            floor: num(d.floor_price), cost: num(d.cost_price) });
      const id = await withPool(ctx, pool, async (pctx) => ((await pctx.tx`select id from products where business_id = ${pool.id} and sku = ${r.saved}`)[0] || {}).id);
      return { success: true, sku: r.saved, id };
    },
    receive: (rows, meta) => withPool(ctx, pool, async (pctx) => {
      await lock(pctx, 'stock');
      const at = meta.at || new Date(), out = [];
      for (const r of rows) {
        const p = (await pctx.tx`select p.id, p.name, p.cost_price, coalesce(ps.stock, 0) as stock from products p left join product_stock ps on ps.product_id = p.id
                                 where p.id = ${r.id} and p.business_id = ${pool.id}`)[0];
        if (!p) throw new Error('That product is not in ' + pool.name + '.');
        await pctx.tx`
          insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, supplier, note,
                                       created_by, created_at, txn_no, operator, product_name, paid_by, held_by)
          values (${pool.id}, ${p.id}, 'RECEIVE', 'IN', ${r.qty}, ${r.unit}, ${round2(r.qty * r.unit)}, ${str(meta.reference).slice(0, 120) || 'Joint stock received'},
                  ${str(meta.supplier).slice(0, 80)}, ${str(meta.note).slice(0, 300)}, ${pctx.s.userId}, ${at}, ${txnNo(at)}, ${who(ctx)}, ${str(p.name)}, ${me}, ${at_})`;
        const had = Math.max(0, num(p.stock)), old = num(p.cost_price);
        const avg = r.unit > 0 ? (had > 0 && old > 0 ? round2((had * old + r.qty * r.unit) / (had + r.qty)) : r.unit) : old;
        if (avg !== old) await pctx.tx`update products set cost_price = ${avg}, updated_at = now() where id = ${p.id}`;
        // joint-fix-4: the pool's cost (before and after) is for the owners; staff see what they typed
        out.push({ sku: r.sku, product: str(p.name), qty: r.qty, unitCost: r.unit, ...(ctx.s.role === 'owner' ? { wasCost: old, nowCost: avg, hadStock: had } : {}) });
      }
      forget(pctx, 'TXN_LOG');
      return out;
    }),
  };
}
/** The pool's products in the shape of the company's own catalogue, for the Receive page's product search. Never cost. */
export async function erpJointRecvCatalog(ctx, payload) {
  await needOn(ctx);
  const pool = await poolOf(ctx, payload && payload.pool);
  return (await shelf(ctx, pool, false)).filter((p) => p.status !== 'Discontinued').map((p) => ({
    sku: p.sku, name: p.name, cat: p.category, category: p.category, brand: p.brand, type: p.type, supplierSku: p.supplierSku, color: p.color, unit: p.unit, sell: p.price, stock: p.stock, status: 'Active', joint: true }));
}

export const HANDLERS = { erpJointRecvCatalog, erpJointAsk, erpJointSend, erpJointGot, erpJointAskAct, erpJointMove, erpJoint, erpJointCatalog, erpJointStart, erpJointProduct, erpJointReceive, erpJointAdjust, erpJointBook, erpJointSettings,
                          erpJointAgree, erpJointCard, erpJointStatementPdf, erpPlatformJointCopy };
