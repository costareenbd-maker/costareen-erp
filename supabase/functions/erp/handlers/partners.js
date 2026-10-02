// Partnership: a joint pool owned by two (or more) businesses. Redesign phase 4.
// The rules live in the database (005_partnership.sql); this file only asks.
//
//   A JOINT POOL is a business of its own (is_pool). Each partner's owner is a
//   member of it, so stock, invoices and every other screen work there as
//   usual - switch to it from the business menu.
//
//   erpPartnership({month})   in a pool: the settlement, the money book, invites
//                             in a normal business: its pools, partners, deals
//   erpPool*                  create, invite, join, write in the book, close a month
//   erpPartnerStock           the other side's stock COUNTS (never cost or price)
//   erpPartnerDeal            a sale from the other partner's own stock
//
// Every statement runs as the signed-in person, so row-level security and the
// database functions decide what is allowed; the role table is a first gate.

import { formatDate, num } from '../lib/time.js';
import { setConfig } from '../lib/ext.js';
import { SEED_LISTS } from './settings.js';

const str = (v) => String(v == null ? '' : v).trim();
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
const isDate = (d) => /^\d{4}-\d{2}-\d{2}$/.test(String(d || ''));
const day = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (m) => MONTHS[Number(m.slice(5, 7)) - 1] + ' ' + m.slice(0, 4);
const KINDS = { capital_in: 'CAPITAL_IN', capital_out: 'CAPITAL_OUT', expense: 'EXPENSE', transfer: 'TRANSFER' };
const KIND_WORDS = { CAPITAL_IN: 'Money put in', CAPITAL_OUT: 'Capital taken back', EXPENSE: 'Expense paid', TRANSFER: 'Cash handed over' };
const tierOf = (t) => (str(t).toLowerCase() === 'wholesale' ? 'wholesale' : 'retail');

async function thisBusiness(ctx) {
  const b = (await ctx.tx`select id, name, is_pool from businesses where id = ${ctx.biz}`)[0];
  if (!b) throw new Error('That business was not found.');
  return b;
}
async function needPool(ctx) {
  const b = await thisBusiness(ctx);
  if (!b.is_pool) throw new Error('Switch to the joint pool first - this is done inside the pool.');
  return b;
}

/** The Partnership tab. */
export async function erpPartnership(ctx, payload) {
  payload = payload || {};
  const b = await thisBusiness(ctx);
  const owner = ctx.s.role === 'owner';
  const nowMonth = formatDate(ctx.now, 'yyyy-MM');

  if (b.is_pool) {
    const month = isMonth(payload.month) && payload.month <= nowMonth ? payload.month : nowMonth;
    const first = month + '-01';
    const partners = (await ctx.tx`
      select partner_business_id as id, display_name as name, price_tier as tier
      from pool_partners where pool_id = ${ctx.biz} order by display_name`)
      .map((p) => ({ id: p.id, name: str(p.name), tier: str(p.tier) }));
    const names = {};
    partners.forEach((p) => { names[p.id] = p.name; });

    // a closed month shows the report exactly as it was agreed
    const frozen = (await ctx.tx`select report from pool_settlements where pool_id = ${ctx.biz} and month = ${first}::date`)[0];
    const report = frozen ? frozen.report
      : (await ctx.tx`select pool_settlement(${ctx.biz}, ${first}::date) as r`)[0].r;
    const closed = (await ctx.tx`select to_char(month, 'YYYY-MM') as m from pool_settlements where pool_id = ${ctx.biz} order by month`).map((r) => r.m);
    const lockRow = (await ctx.tx`select to_char(pool_locked_until(${ctx.biz}), 'YYYY-MM-DD') as d`)[0];

    const led = await ctx.tx`
      select id, kind, partner_business_id, to_business_id, amount, entry_date, category, note
      from pool_ledger where pool_id = ${ctx.biz} order by entry_date desc, created_at desc limit 300`;
    const ledger = led.map((l) => {
      const d = formatDate(new Date(l.entry_date), 'yyyy-MM-dd');
      return { id: l.id, kind: str(l.kind).toLowerCase(), label: KIND_WORDS[str(l.kind)] || str(l.kind),
               who: names[l.partner_business_id] || '?', to: l.to_business_id ? (names[l.to_business_id] || '?') : '',
               amount: num(l.amount), when: day(l.entry_date), category: str(l.category), note: str(l.note),
               locked: !!(lockRow && lockRow.d && d < lockRow.d) };
    });
    const invites = owner ? (await ctx.tx`
      select code, expires_at from pool_invites
      where pool_id = ${ctx.biz} and used_at is null and expires_at > now() order by expires_at desc`)
      .map((i) => ({ code: i.code, until: day(i.expires_at) })) : [];
    const me = (await ctx.tx`select my_partner_in(${ctx.biz}) as p`)[0].p;

    return { isPool: true, name: str(b.name), month, label: monthLabel(month), isCurrent: month === nowMonth,
             canEdit: owner, me: me || '', partners, report, ledger, closedMonths: closed, invites,
             today: formatDate(ctx.now, 'yyyy-MM-dd'), currency: 'BDT' };
  }

  const pools = await ctx.tx`
    select pp.pool_id as id, pb.name, pp.price_tier as tier, pp.share_stock,
           (select coalesce(json_agg(x.display_name order by x.display_name), '[]'::json)
              from pool_partners x where x.pool_id = pp.pool_id) as partners
    from pool_partners pp join businesses pb on pb.id = pp.pool_id
    where pp.partner_business_id = ${ctx.biz} order by pb.name`;
  const mine = await ctx.tx`select * from my_partners() where my_business_id = ${ctx.biz}`;
  const partners = [], seen = {}, names = {};
  for (const p of mine) {
    names[p.partner_business_id] = str(p.partner_name);
    if (seen[p.partner_business_id]) continue;
    seen[p.partner_business_id] = true;
    partners.push({ id: p.partner_business_id, name: str(p.partner_name), pool: str(p.pool_name), sharesStock: !!p.shares_stock });
  }
  const deals = (await ctx.tx`
    select * from partner_deals where from_business_id = ${ctx.biz} or to_business_id = ${ctx.biz}
    order by created_at desc limit 200`).map((d) => {
    const owedToMe = d.from_business_id === ctx.biz;
    const other = owedToMe ? d.to_business_id : d.from_business_id;
    return { id: d.id, when: day(d.deal_date), what: str(d.description), qty: num(d.qty), amount: num(d.amount), note: str(d.note),
             owedToMe, other: names[other] || 'Partner', mineToConfirm: !d.confirmed_at && d.created_side !== ctx.biz,
             confirmed: !!d.confirmed_at, settled: !!d.settled_at, settledWhen: day(d.settled_at) };
  });
  return { isPool: false, name: str(b.name), canEdit: owner,
           pools: pools.map((p) => ({ id: p.id, name: str(p.name), tier: str(p.tier), partners: p.partners || [] })),
           sharesStock: pools.length ? pools.every((p) => p.share_stock) : true,
           partners, deals, today: formatDate(ctx.now, 'yyyy-MM-dd'), currency: 'BDT' };
}

/** Start a joint pool with this business as its first partner. */
export async function erpPoolCreate(ctx, payload) {
  payload = payload || {};
  const name = str(payload.name);
  if (!name) throw new Error('Give the joint pool a name.');
  if (name.length > 80) throw new Error('That name is too long.');
  for (const m of ctx.s.memberships || []) {
    if (str(m.name).toLowerCase() === name.toLowerCase()) throw new Error('A business called "' + name + '" already exists.');
  }
  const id = (await ctx.tx`select create_pool(${name}, ${ctx.biz}, ${str(payload.displayName) || null}, ${tierOf(payload.tier)}::price_tier) as id`)[0].id;

  // what every new business starts with, so its screens work at once
  const nctx = { ...ctx, biz: id, memo: {} };
  for (const [kind, vals] of Object.entries(SEED_LISTS)) {
    await ctx.tx`delete from lookups where business_id = ${id} and kind = ${kind}`;
    const rows = vals.map((v, i) => ({ business_id: id, kind, value: v, sort_order: i + 1 }));
    await ctx.tx`insert into lookups ${ctx.tx(rows, 'business_id', 'kind', 'value', 'sort_order')}`;
  }
  for (const [k, v] of [['business_name', name], ['currency', 'BDT'], ['default_reorder', '5'], ['default_lead_time', '7']]) {
    await setConfig(nctx, k, v);
  }
  const code = (await ctx.tx`select create_pool_invite(${id}) as c`)[0].c;
  return { ok: true, id, name, code };
}

/** A fresh invite code for the other partner (good for 7 days, used once). */
export async function erpPoolInvite(ctx) {
  await needPool(ctx);
  await ctx.tx`select create_pool_invite(${ctx.biz})`;
  return erpPartnership(ctx, {});
}

/** Join somebody's pool with the code they sent. */
export async function erpPoolJoin(ctx, payload) {
  payload = payload || {};
  const code = str(payload.code).toUpperCase();
  if (!code) throw new Error('Type the invite code your partner sent.');
  const b = await thisBusiness(ctx);
  if (b.is_pool) throw new Error('Switch to your own business first - a pool cannot join a pool.');
  const id = (await ctx.tx`select join_pool(${code}, ${ctx.biz}, ${str(payload.displayName) || null}, ${tierOf(payload.tier)}::price_tier) as id`)[0].id;
  const name = (await ctx.tx`select name from businesses where id = ${id}`)[0];
  return { ok: true, id, name: name ? str(name.name) : '' };
}

/** One line in the pool's money book. */
export async function erpPoolEntryAdd(ctx, payload) {
  payload = payload || {};
  await needPool(ctx);
  const kind = KINDS[str(payload.kind).toLowerCase()];
  if (!kind) throw new Error('What kind of entry is it?');
  const amount = Math.round(num(payload.amount) * 100) / 100;
  if (!(amount > 0)) throw new Error('How much? Type an amount above 0.');
  const who = str(payload.partner);
  if (!who) throw new Error('Which partner?');
  const to = kind === 'TRANSFER' ? str(payload.to) : '';
  if (kind === 'TRANSFER' && !to) throw new Error('Who received the cash?');
  if (kind === 'TRANSFER' && to === who) throw new Error('The cash has to go to the other partner.');
  const today = formatDate(ctx.now, 'yyyy-MM-dd');
  const date = isDate(payload.date) ? payload.date : today;
  if (date > today) throw new Error('That date has not come yet.');
  await ctx.tx`
    insert into pool_ledger (pool_id, kind, partner_business_id, to_business_id, amount, entry_date, category, note)
    values (${ctx.biz}, ${kind}::pool_entry_kind, ${who}, ${to || null}, ${amount}, ${date}::date,
            ${kind === 'EXPENSE' ? (str(payload.category) || 'Miscellaneous') : null}, ${str(payload.note).slice(0, 300) || null})`;
  return erpPartnership(ctx, { month: payload.month });
}

/** Take a wrong line out of the book. A settled month stays as it is. */
export async function erpPoolEntryRemove(ctx, payload) {
  await needPool(ctx);
  const id = str(payload && payload.id);
  if (!id) throw new Error('Which entry?');
  const gone = await ctx.tx`delete from pool_ledger where pool_id = ${ctx.biz} and id = ${id} returning id`;
  if (!gone.length) throw new Error('That entry was not found.');
  return erpPartnership(ctx, { month: payload.month });
}

/** Freeze a finished month: its report, invoices and book lines stop changing. */
export async function erpPoolClose(ctx, payload) {
  await needPool(ctx);
  const month = str(payload && payload.month);
  if (!isMonth(month)) throw new Error('Which month?');
  await ctx.tx`select close_pool_month(${ctx.biz}, ${month + '-01'}::date)`;
  return erpPartnership(ctx, { month });
}

/** A partner sells at retail or at wholesale from the pool. */
export async function erpPoolTier(ctx, payload) {
  await needPool(ctx);
  await ctx.tx`select set_partner_tier(${ctx.biz}, ${str(payload && payload.partner)}, ${tierOf(payload && payload.tier)}::price_tier)`;
  delete ctx.memo.catalog;
  return erpPartnership(ctx, { month: payload.month });
}

/** Let partners see this business's stock counts, or stop. */
export async function erpPoolShare(ctx, payload) {
  await ctx.tx`select set_share_stock(${ctx.biz}, ${!!(payload && payload.share)})`;
  return erpPartnership(ctx, {});
}

/** The other side's shelf: names and counts only. */
export async function erpPartnerStock(ctx, payload) {
  const partner = str(payload && payload.partner);
  if (!partner) throw new Error('Which partner?');
  const rows = await ctx.tx`select * from partner_stock(${partner})`;
  return { partner, products: rows.map((r) => ({ sku: str(r.sku), name: str(r.name), category: str(r.category), brand: str(r.brand),
                                                 color: str(r.color), unit: str(r.unit), stock: num(r.stock), state: str(r.state) })) };
}

/**
 * A sale from the other partner's own stock - a debt between the two
 * companies at the price agreed for that deal.
 *   {action:'record', partner, side:'theirs'|'mine', description, amount, qty, date, note}
 *   {action:'confirm'|'paid'|'cancel', id}
 */
export async function erpPartnerDeal(ctx, payload) {
  payload = payload || {};
  const action = str(payload.action);
  if (action === 'record') {
    const partner = str(payload.partner);
    if (!partner) throw new Error('Which partner?');
    const what = str(payload.description);
    if (!what) throw new Error('What was sold? A few words is enough.');
    const amount = Math.round(num(payload.amount) * 100) / 100;
    if (!(amount > 0)) throw new Error('What price was agreed? Type an amount above 0.');
    const qty = num(payload.qty) > 0 ? num(payload.qty) : 1;
    // "theirs": I sold their stock, I owe them. "mine": they sold mine, they owe me.
    const from = payload.side === 'mine' ? ctx.biz : partner;
    const to = payload.side === 'mine' ? partner : ctx.biz;
    await ctx.tx`select record_partner_deal(${from}, ${to}, ${what}, ${amount}, ${qty},
                 ${isDate(payload.date) ? payload.date : null}::date, ${str(payload.note).slice(0, 300) || null})`;
  } else {
    const id = str(payload.id);
    if (!id) throw new Error('Which deal?');
    if (action === 'confirm') await ctx.tx`select confirm_partner_deal(${id})`;
    else if (action === 'paid') await ctx.tx`select settle_partner_deal(${id})`;
    else if (action === 'cancel') await ctx.tx`select cancel_partner_deal(${id})`;
    else throw new Error('Unknown action.');
  }
  return erpPartnership(ctx, {});
}

export const HANDLERS = { erpPartnership, erpPoolCreate, erpPoolInvite, erpPoolJoin, erpPoolEntryAdd, erpPoolEntryRemove,
                          erpPoolClose, erpPoolTier, erpPoolShare, erpPartnerStock, erpPartnerDeal };
