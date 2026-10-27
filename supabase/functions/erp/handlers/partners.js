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
import { createInvoice } from './invoice.js';
import { erpRecordPayment } from './customers.js';
import { roleAtLeast } from '../allow.js';

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
/** Joint stock is switched on per company by the provider (068_joint.sql). */
async function needJoint(ctx) {
  let ok = false;
  try { ok = !!(await ctx.tx.savepoint(() => ctx.tx`select public.joint_enabled(${ctx.biz}) as ok`))[0].ok; } catch (_) { ok = false; }
  if (!ok) throw new Error('Joint stock is not switched on for this company.');
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
  const owner = roleAtLeast(ctx.s.role, 'shareholder');   // 27 Oct 2026: a shareholder edits as the owner
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
      select id, kind, partner_business_id, to_business_id, amount, entry_date, category, note, voided_at, voided_by, void_reason
      from pool_ledger where pool_id = ${ctx.biz} order by entry_date desc, created_at desc limit 300`;
    const ledger = led.map((l) => {
      const d = formatDate(new Date(l.entry_date), 'yyyy-MM-dd');
      return { id: l.id, kind: str(l.kind).toLowerCase(), label: KIND_WORDS[str(l.kind)] || str(l.kind),
               who: names[l.partner_business_id] || '?', to: l.to_business_id ? (names[l.to_business_id] || '?') : '',
               amount: num(l.amount), when: day(l.entry_date), category: str(l.category), note: str(l.note),
               voided: l.voided_at ? 'struck out ' + day(l.voided_at) + ' by ' + (str(l.voided_by) || '?') + ': ' + str(l.void_reason) : '',
               locked: !!(lockRow && lockRow.d && d < lockRow.d) };
    });
    // only the partner who started the pool lets anyone else in: a joined partner cannot bring a third company into your book
    const meNow = ctx.jointMe || (await ctx.tx`select my_partner_in(${ctx.biz}) as p`)[0].p;
    const starter = await poolStarter(ctx);
    const canInvite = owner && !!meNow && meNow === starter;
    const invites = canInvite ? (await ctx.tx`
      select code, expires_at from pool_invites
      where pool_id = ${ctx.biz} and used_at is null and expires_at > now() order by expires_at desc`)
      .map((i) => ({ code: i.code, until: day(i.expires_at) })) : [];
    // joint stock gives the partner (a company on its own database has no login here to look it up by)
    const me = ctx.jointMe || (await ctx.tx`select my_partner_in(${ctx.biz}) as p`)[0].p;

    return { isPool: true, name: str(b.name), month, label: monthLabel(month), isCurrent: month === nowMonth,
             canEdit: owner, me: me || '', partners, report, ledger, closedMonths: closed, invites, canInvite,
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
             sku: str(d.sku), invoiceNo: owedToMe ? str(d.invoice_no) : '', stockMoved: !!str(d.invoice_no),
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
  await needJoint(ctx);
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
/** The partner who started the pool (the first to be in it). */
async function poolStarter(ctx) {
  const r = (await ctx.tx`select partner_business_id from pool_partners where pool_id = ${ctx.biz} order by joined_at, partner_business_id limit 1`)[0];
  return r ? r.partner_business_id : null;
}
export async function erpPoolInvite(ctx) {
  await needPool(ctx);
  const me = ctx.jointMe || (await ctx.tx`select my_partner_in(${ctx.biz}) as p`)[0].p;
  if (!me || me !== await poolStarter(ctx)) throw new Error('Only the partner who started this joint stock can invite another company into it.');
  await ctx.tx`select create_pool_invite(${ctx.biz})`;
  return erpPartnership(ctx, {});
}

/** Join somebody's pool with the code they sent. */
export async function erpPoolJoin(ctx, payload) {
  payload = payload || {};
  await needJoint(ctx);
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

/**
 * Strike a wrong line out of the book, saying why. The line stays, crossed
 * through, for every partner to see (plan A7). A settled month stays as it is.
 */
export async function erpPoolEntryRemove(ctx, payload) {
  await needPool(ctx);
  const id = str(payload && payload.id), why = str(payload && payload.reason).slice(0, 300);
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new Error('Which entry?');
  if (!why) throw new Error('Say why the line is being struck out. Your partner will see it.');
  const was = (await ctx.tx`select voided_at from pool_ledger where pool_id = ${ctx.biz} and id = ${id}`)[0];
  if (!was) throw new Error('That entry was not found.');
  if (was.voided_at) throw new Error('That line is already struck out.');
  const gone = await ctx.tx`update pool_ledger set voided_at = now(), voided_by = ${(ctx.s && ctx.s.name) || 'owner'}, void_reason = ${why}
                            where pool_id = ${ctx.biz} and id = ${id} returning id`;
  if (!gone.length) throw new Error('That entry was not found.');
  return erpPartnership(ctx, { month: payload.month });
}

/** Freeze a finished month: its report, invoices and book lines stop changing. */
export async function erpPoolClose(ctx, payload) {
  await needPool(ctx);
  const month = str(payload && payload.month);
  if (!isMonth(month)) throw new Error('Which month?');
  if (month >= formatDate(ctx.now, 'yyyy-MM')) throw new Error('A month can only be closed after it has ended.');
  const first = month + '-01';
  if ((await ctx.tx`select 1 from pool_settlements where pool_id = ${ctx.biz} and month = ${first}::date`).length) throw new Error('That month is already closed.');
  const me = ctx.jointMe || (await ctx.tx`select my_partner_in(${ctx.biz}) as p`)[0].p;
  if (payload && payload.withdraw) {
    await ctx.tx`delete from pool_month_agreed where pool_id = ${ctx.biz} and month = ${first}::date and partner_business_id = ${me}`;
    return erpPartnership(ctx, { month });
  }
  // joint-fix-3: months are agreed in order, and an agreement is to these exact sums (133: a fingerprint of them)
  const fo = (await ctx.tx`select pool_first_open_month(${ctx.biz}) as m`)[0].m;
  if (fo && formatDate(new Date(fo), 'yyyy-MM') < month) throw new Error('Agree ' + formatDate(new Date(fo), 'MMMM yyyy') + ' first: months are closed in order.');
  const figures = str((await ctx.tx`select pool_settlement(${ctx.biz}, ${first}::date) ->> 'figures' as f`)[0].f);
  // every partner says yes to the same sums; the last yes closes the month
  await ctx.tx`insert into pool_month_agreed (pool_id, month, partner_business_id, agreed_by, agreed_name, figures)
               values (${ctx.biz}, ${first}::date, ${me}, ${ctx.s.userId}, ${(ctx.s && ctx.s.name) || 'owner'}, ${figures})
               on conflict (pool_id, month, partner_business_id) do update
                 set agreed_by = excluded.agreed_by, agreed_name = excluded.agreed_name, figures = excluded.figures, agreed_at = now()`;
  const left = await ctx.tx`select 1 from pool_partners pp where pp.pool_id = ${ctx.biz}
                             and not exists (select 1 from pool_month_agreed a where a.pool_id = pp.pool_id and a.month = ${first}::date
                                             and a.partner_business_id = pp.partner_business_id and a.figures = ${figures})`;
  if (!left.length) await ctx.tx`select close_pool_month(${ctx.biz}, ${first}::date)`;
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

/**
 * One inventory, side by side (plan B2): this business's stock, the joint
 * pools it is in, and each partner's own shelf where they share it.
 * Counts only for anything that is not ours - never a partner's cost or price.
 *   -> { columns: [{ key, kind: mine|pool|partner, name, note }], rows: [{ sku, name, category, brand, color, unit, qty: { key: n } }] }
 */
export async function erpSharedStock(ctx) {
  const b = await thisBusiness(ctx);
  const columns = [{ key: 'mine', kind: b.is_pool ? 'pool' : 'mine', name: str(b.name), note: '' }];
  const rows = {};
  const put = (key, list) => {
    for (const p of list) {
      const id = str(p.sku).toLowerCase() || 'n:' + str(p.name).toLowerCase();
      if (!id || id === 'n:') continue;
      const r = rows[id] || (rows[id] = { sku: str(p.sku), name: str(p.name), category: str(p.category), brand: str(p.brand),
                                          color: str(p.color), unit: str(p.unit), qty: {} });
      r.qty[key] = (r.qty[key] || 0) + num(p.stock);
    }
  };
  const shelf = (biz) => ctx.tx`
    select p.sku, p.name, p.category, p.brand, p.color, p.unit, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${biz} and coalesce(p.status, 'Active') <> 'Discontinued'`;
  put('mine', await shelf(ctx.biz));

  if (!b.is_pool) {
    const pools = await ctx.tx`
      select pp.pool_id as id, coalesce(pb.name, 'Joint pool') as name
      from pool_partners pp left join businesses pb on pb.id = pp.pool_id
      where pp.partner_business_id = ${ctx.biz} order by 2`;
    for (const p of pools) {
      const key = 'pool:' + p.id;
      // row-level security decides: someone who is not a member of the pool reads nothing
      const list = await shelf(p.id);
      const member = (await ctx.tx`select public.is_member(${p.id}) as ok`)[0].ok;
      columns.push({ key, kind: 'pool', name: str(p.name), note: member ? '' : 'only people who are in the pool see its stock' });
      put(key, list);
    }
    const seen = {};
    for (const p of await ctx.tx`select * from my_partners() where my_business_id = ${ctx.biz}`) {
      if (seen[p.partner_business_id]) continue;
      seen[p.partner_business_id] = true;
      const key = 'partner:' + p.partner_business_id;
      const col = { key, kind: 'partner', name: str(p.partner_name), note: '' };
      if (!p.shares_stock) col.note = 'does not share their stock';
      else {
        try { put(key, await ctx.tx.savepoint(() => ctx.tx`select * from partner_stock(${p.partner_business_id})`)); }
        catch (_) { col.note = 'does not share their stock'; }
      }
      columns.push(col);
    }
  }
  const list = Object.values(rows).sort((x, y) => (x.category + x.brand + x.name).localeCompare(y.category + y.brand + y.name));
  return { columns, rows: list.slice(0, 5000), shared: columns.length > 1, isPool: !!b.is_pool };
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
 *   {action:'record', partner, side:'theirs'|'mine', description, amount, qty, date, note, sku}
 *   {action:'confirm'|'paid'|'cancel', id, method}
 *
 * Plan B3: with a product code (sku) the stock owner's books carry the deal as
 * a real invoice to the partner at the agreed price - stock out, cost, revenue
 * and a due. It is made the moment the stock owner acts: when they record the
 * deal themselves, or when they confirm the other side's request. "Paid" then
 * receives the money on that invoice.
 */
async function dealInvoice(ctx, deal) {
  const other = (await ctx.tx`select partner_name from my_partners() where my_business_id = ${ctx.biz} and partner_business_id = ${deal.to_business_id} limit 1`)[0];
  const qty = num(deal.qty) > 0 ? num(deal.qty) : 1;
  const res = await createInvoice(ctx, {
    customer: { name: (other ? str(other.partner_name) : 'Partner') + ' (partner)', phone: '', source: 'Partner' },
    items: [{ sku: str(deal.sku), qty }], payMode: 'none',
    note: 'Sold by partner: ' + str(deal.description),
  }, { partnerDeal: true, unitPrice: Math.round(num(deal.amount) / qty * 100) / 100 });
  await ctx.tx`select partner_deal_note(${deal.id}, ${null}, ${res.invoiceNo})`;
  return res.invoiceNo;
}
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
    const sku = str(payload.sku);
    if (sku && qty !== Math.round(qty)) throw new Error('With a product code the quantity is a whole number.');
    if (sku && from === ctx.biz) {
      const mine = await ctx.tx`select 1 from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${sku.toLowerCase()} limit 1`;
      if (!mine.length) throw new Error('There is no product with the code ' + sku + ' in your stock.');
    }
    const deal = (await ctx.tx`select * from record_partner_deal(${from}, ${to}, ${what}, ${amount}, ${qty},
                 ${isDate(payload.date) ? payload.date : null}::date, ${str(payload.note).slice(0, 300) || null})`)[0];
    if (sku) {
      await ctx.tx`select partner_deal_note(${deal.id}, ${sku}, ${null})`;
      // my own stock went out: it leaves my books now
      if (from === ctx.biz) await dealInvoice(ctx, { ...deal, sku });
    }
  } else {
    const id = str(payload.id);
    if (!id) throw new Error('Which deal?');
    const deal = /^[0-9a-f-]{36}$/i.test(id) ? (await ctx.tx`select * from partner_deals where id = ${id}`)[0] : null;
    if (!deal) throw new Error('That deal was not found.');
    if (action === 'confirm') {
      await ctx.tx`select confirm_partner_deal(${id})`;
      // it was my stock they sold: confirming takes it off my shelf
      if (str(deal.sku) && !str(deal.invoice_no) && deal.from_business_id === ctx.biz) await dealInvoice(ctx, deal);
    } else if (action === 'paid') {
      await ctx.tx`select settle_partner_deal(${id})`;
      if (str(deal.invoice_no) && deal.from_business_id === ctx.biz) {
        try {
          // fix-5 L8: part may already be paid on the invoice itself - "Paid" takes in what is left
          const { outstanding } = await import('./money.js');
          const o = await outstanding(ctx, str(deal.invoice_no));
          const left = o ? Math.round(num(o.owed) * 100) / 100 : num(deal.amount);
          if (left > 0.004) await ctx.tx.savepoint(() => erpRecordPayment(ctx, { orderId: str(deal.invoice_no), amount: left, method: str(payload.method) || 'Cash' }));
        } catch (e) {
          if (!/already settled/.test(String(e && e.message))) throw e;      // paid on the invoice itself beforehand: fine
        }
      }
    } else if (action === 'cancel') {
      if (str(deal.invoice_no)) {
        throw new Error('The stock has already left on invoice ' + (deal.from_business_id === ctx.biz ? str(deal.invoice_no) : 'of the other company') +
                        '. Cancel that invoice first (the goods come back), then withdraw this.');
      }
      await ctx.tx`select cancel_partner_deal(${id})`;
    }
    else throw new Error('Unknown action.');
  }
  return erpPartnership(ctx, {});
}

export const HANDLERS = { erpPartnership, erpPoolCreate, erpPoolInvite, erpPoolJoin, erpSharedStock, erpPoolEntryAdd, erpPoolEntryRemove,
                          erpPoolClose, erpPoolTier, erpPoolShare, erpPartnerStock, erpPartnerDeal };
