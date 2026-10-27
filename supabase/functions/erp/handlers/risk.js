// Money that could be lost, and the alerts about it.
//
//   erpRisks()                 the Sales screen's "Unpaid and at risk" box: overdue invoices,
//                              parcels delivered but not paid out, returned parcels whose goods
//                              are not back, website orders not entered
//   erpAlertRules()            the alert rules (on/off, threshold, who sees it, WhatsApp)
//   erpAlertRulesSave({rules}) owner only
//   moneyAlerts(ctx, role)     the money alerts for the bell and for WhatsApp (alerts.js)
//
// Event alerts (a due changed by hand, an invoice cancelled, a sale below cost...)
// look back 48 hours; state alerts (a due crossing 7/30/60 days, a payout late...)
// are true until fixed. Each has a stable key, so WhatsApp says it once.

import { formatDate, num, round2 } from '../lib/time.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { roleAtLeast } from '../allow.js';
import { erpDues } from './money.js';

const str = (v) => String(v == null ? '' : v).trim();
const day = (d) => (d ? formatDate(new Date(d), 'd MMM') : '');
const tk = (n) => '৳' + Math.round(num(n)).toLocaleString('en-US');

/** A due on a cash-on-delivery sale: the courier or rider collects it. */
export const isCodDue = (i) => /^(cod|cash on delivery)/i.test(String((i && i.method) || ''));

export const RULES = {
  due_age:        { label: 'A due turns 7, 30 or 60 days old',                              who: 'shareholder', wa: true,  at: null, unit: '' },
  due_change:     { label: 'A due reduced or increased by hand',                            who: 'owner',       wa: true,  at: null, unit: '' },
  cancel:         { label: 'An invoice cancelled or deleted',                               who: 'owner',       wa: true,  at: null, unit: '' },
  below_cost:     { label: 'A sale below cost',                                             who: 'shareholder', wa: true,  at: null, unit: '' },
  discount:       { label: 'A sale with a big discount',                                    who: 'shareholder', wa: false, at: 15,   unit: '% of the goods or more' },
  cash_short:     { label: 'A money account found short when counted',                      who: 'owner',       wa: true,  at: 0,    unit: 'taka or more short' },
  payout_late:    { label: 'A parcel delivered but Steadfast has not paid it out',          who: 'shareholder', wa: true,  at: 10,   unit: 'days after delivery' },
  return_waiting: { label: 'A parcel came back but its goods are not back on the shelf',    who: 'manager',     wa: true,  at: 3,    unit: 'days' },
  write_off:      { label: 'Stock written off (damage, loss, a count that came out short)', who: 'shareholder', wa: true,  at: 1000, unit: 'taka or more' },
  web_waiting:    { label: 'A website order not entered as an invoice',                     who: 'manager',     wa: false, at: 6,    unit: 'hours' },
  cod_waiting:    { label: 'A cash-on-delivery sale still not collected',                   who: 'shareholder', wa: true,  at: 14,   unit: 'days after the sale' },
};

export async function rulesOf(ctx) {
  let saved = {};
  try { saved = JSON.parse(String(await getConfig(ctx, 'alert_rules', '')) || '{}') || {}; } catch (_) { saved = {}; }
  const out = {};
  for (const k of Object.keys(RULES)) {
    const d = RULES[k], s = saved[k] || {};
    out[k] = { on: s.on === undefined ? true : !!s.on, who: ['owner', 'shareholder', 'manager'].includes(s.who) ? s.who : d.who,
               wa: s.wa === undefined ? d.wa : !!s.wa, at: d.at === null ? null : (s.at === undefined || s.at === null || s.at === '' ? d.at : num(s.at)) };
  }
  return out;
}

export async function erpAlertRules(ctx) {
  const r = await rulesOf(ctx);
  return { rules: Object.keys(RULES).map((k) => ({ id: k, label: RULES[k].label, unit: RULES[k].unit, ...r[k] })), canEdit: ctx.s.role === 'owner' };
}

export async function erpAlertRulesSave(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'shareholder')) throw new Error('Only the owner or a shareholder sets the alerts.');
  const cur = await rulesOf(ctx), out = {};
  const given = (payload && payload.rules) || {};
  for (const k of Object.keys(RULES)) {
    const g = given[k] || {}, c = cur[k];
    const at = RULES[k].at === null ? null : (g.at === undefined || g.at === '' ? c.at : num(g.at));
    if (at !== null && (!(at >= 0) || at > 1e7)) throw new Error(RULES[k].label + ': the number is not right.');
    out[k] = { on: g.on === undefined ? c.on : !!g.on, who: ['owner', 'shareholder', 'manager'].includes(g.who) ? g.who : c.who,
               wa: g.wa === undefined ? c.wa : !!g.wa, at };
  }
  await setConfig(ctx, 'alert_rules', JSON.stringify(out));
  return erpAlertRules(ctx);
}

// ------------------------------------------------------------------ what is at risk now
async function soft(ctx, fn, dflt) { try { return await ctx.tx.savepoint(fn); } catch (_) { return dflt; } }

async function payoutLate(ctx, days) {
  return soft(ctx, async () => (await ctx.tx`
    select p.invoice_no, p.customer, p.amount, p.paid_at, (regexp_match(p.note, '[[]sf:([^]]+)[]]'))[1] as cid
    from payments p
    where p.business_id = ${ctx.biz} and p.method = 'COD (Steadfast)' and p.note like 'delivered%'
      and p.paid_at < now() - make_interval(days => ${Math.max(0, Math.round(days))})
      and not exists (select 1 from courier_payout_lines l where l.business_id = p.business_id
                      and l.consignment_id = (regexp_match(p.note, '[[]sf:([^]]+)[]]'))[1])
    order by p.paid_at limit 100`).map((r) => ({ invoice: str(r.invoice_no), customer: str(r.customer), amount: num(r.amount),
      consignment: str(r.cid), since: day(r.paid_at), days: Math.floor((Date.now() - new Date(r.paid_at).getTime()) / 86400e3) })), []);
}

async function returnWaiting(ctx, days) {
  return soft(ctx, async () => {
    const rows = await ctx.tx`select at, came_back, part from delivery_checks where business_id = ${ctx.biz} and at > now() - interval '45 days' order by at`;
    const first = {};
    for (const r of rows) for (const inv of (str(r.came_back) + ',' + str(r.part)).split(',').map(str).filter(Boolean)) if (!first[inv]) first[inv] = new Date(r.at);
    const ids = Object.keys(first);
    if (!ids.length) return [];
    const back = new Set((await ctx.tx`select distinct invoice_no from returns where business_id = ${ctx.biz} and invoice_no = any(${ids})`).map((r) => str(r.invoice_no)));
    const info = {};
    for (const i of await ctx.tx`select invoice_no, customer_name, grand_total, cancelled_at from invoices where business_id = ${ctx.biz} and invoice_no = any(${ids})`) info[str(i.invoice_no)] = i;
    const out = [];
    for (const inv of ids) {
      const i = info[inv];
      if (back.has(inv) || !i || i.cancelled_at) continue;
      const d = Math.floor((Date.now() - first[inv].getTime()) / 86400e3);
      if (d < days) continue;
      out.push({ invoice: inv, customer: str(i.customer_name), amount: num(i.grand_total), since: day(first[inv]), days: d });
    }
    return out.sort((a, b) => b.days - a.days);
  }, []);
}

async function webWaiting(ctx, hours) {
  return soft(ctx, async () => (await ctx.tx`
    select order_no, customer_name, order_total, coalesce(order_date, pulled_at) as at from web_orders
    where business_id = ${ctx.biz} and not entered and coalesce(order_date, pulled_at) > now() - interval '14 days'
      and coalesce(order_date, pulled_at) < now() - make_interval(hours => ${Math.max(0, Math.round(hours))})
    order by 4 limit 100`).map((r) => ({ order: str(r.order_no), customer: str(r.customer_name), amount: num(r.order_total), since: day(r.at),
      hours: Math.floor((Date.now() - new Date(r.at).getTime()) / 3600e3) })), []);
}

export async function erpRisks(ctx) {
  const rules = await rulesOf(ctx);
  const d = await erpDues(ctx);
  // cash on delivery is owed by the courier until it is collected, not by the customer
  const cod = d.invoices.filter((i) => isCodDue(i)), all = d.invoices.filter((i) => !isCodDue(i)), inv = all.filter((i) => i.days >= 7);
  const late = await payoutLate(ctx, rules.payout_late.at);
  const ret = await returnWaiting(ctx, rules.return_waiting.at);
  const web = await webWaiting(ctx, rules.web_waiting.at);
  const sum = (l) => round2(l.reduce((a, x) => a + num(x.due !== undefined ? x.due : x.amount), 0));
  return {
    totals: { owed: Math.round(d.total), over7: sum(inv), over30: sum(inv.filter((i) => i.days >= 30)), over60: sum(inv.filter((i) => i.days >= 60)),
              payoutLate: sum(late), returnWaiting: sum(ret), webWaiting: sum(web), withCourier: sum(cod), codLate: sum(cod.filter((i) => i.days >= rules.cod_waiting.at)) },
    withCourier: cod.slice(0, 80).map((i) => ({ invoice: i.id, customer: i.customer, phone: i.phone, due: Math.round(i.due), days: i.days, when: i.when, late: i.days >= rules.cod_waiting.at })),
    overdue: all.slice(0, 80).map((i) => ({ invoice: i.id, customer: i.customer, phone: i.phone, due: Math.round(i.due), days: i.days, when: i.when })),
    overdueCount: all.length, over7Count: inv.length, payoutLate: late, returnWaiting: ret, webWaiting: web,
    rules: { payoutDays: rules.payout_late.at, returnDays: rules.return_waiting.at, webHours: rules.web_waiting.at, codDays: rules.cod_waiting.at },
  };
}

// ------------------------------------------------------------------ the alerts
/** Money alerts this role may see: [{key, kind, level, title, detail, go, wa}] */
export async function moneyAlerts(ctx, role) {
  const rules = await rulesOf(ctx), out = [];
  const may = (k) => rules[k].on && roleAtLeast(role, rules[k].who);
  const add = (k, a) => out.push({ kind: k, wa: rules[k].wa, level: 'warn', ...a });

  if (may('due_age')) {
    const d = await soft(ctx, () => erpDues(ctx), { invoices: [] });
    for (const b of [60, 30, 7]) {
      const hit = d.invoices.filter((i) => !isCodDue(i) && i.days >= b && i.days < b + 3);
      for (const i of hit) add('due_age', { key: 'due' + b + ':' + i.id, level: b >= 30 ? 'bad' : 'warn', title: i.customer + ' owes ' + tk(i.due) + ' for ' + b + ' days',
        detail: i.id + (i.phone ? ' · ' + i.phone : ''), go: 'sales:' + i.id });
    }
  }
  if (may('cod_waiting')) {
    const d = await soft(ctx, () => erpDues(ctx), { invoices: [] });
    for (const i of d.invoices.filter((x) => isCodDue(x) && x.days >= rules.cod_waiting.at)) {
      add('cod_waiting', { key: 'cod:' + i.id, title: 'Cash on delivery ' + tk(i.due) + ' not collected after ' + i.days + ' days — ' + i.customer,
        detail: i.id + (i.phone ? ' · ' + i.phone : '') + ' · ask the courier or rider', go: 'sales:' + i.id });
    }
  }
  if (may('due_change')) {
    for (const p of await soft(ctx, () => ctx.tx`select payment_no, invoice_no, customer, amount, note, recorded_by, paid_at from payments
                                                  where business_id = ${ctx.biz} and paid_at > now() - interval '48 hours' and note ~ '[[](reduce|increase)[]]'
                                                  order by paid_at desc limit 30`, [])) {
      const up = /\[increase\]/.test(str(p.note));
      add('due_change', { key: 'duechg:' + str(p.payment_no), title: (up ? 'Due increased' : 'Due reduced') + ' by ' + tk(Math.abs(num(p.amount))) + ' — ' + str(p.customer || p.invoice_no),
        detail: str(p.invoice_no) + ' · by ' + (str(p.recorded_by) || '?') + ' · ' + str(p.note).replace(/\s*\[[^\]]*\]/g, '').slice(0, 120), go: 'sales:' + str(p.invoice_no) });
    }
  }
  if (may('cancel')) {
    for (const i of await soft(ctx, () => ctx.tx`select invoice_no, customer_name, grand_total, cancelled_at from invoices
                                                  where business_id = ${ctx.biz} and cancelled_at > now() - interval '48 hours' order by cancelled_at desc limit 30`, [])) {
      add('cancel', { key: 'cancel:' + str(i.invoice_no), title: 'Invoice ' + str(i.invoice_no) + ' cancelled (' + tk(i.grand_total) + ')', detail: str(i.customer_name), go: 'sales:' + str(i.invoice_no) });
    }
    for (const a of await soft(ctx, () => ctx.sql`select id, who, detail, at from erp_activity where business_id = ${ctx.biz} and action = 'erpVoidInvoice'
                                                   and at > now() - interval '48 hours' order by at desc limit 20`, [])) {
      add('cancel', { key: 'void:' + a.id, level: 'bad', title: 'An invoice was deleted', detail: (str(a.detail) || '') + ' · by ' + str(a.who) + ' · ' + formatDate(new Date(a.at), 'd MMM, h:mm a'), go: '' });
    }
  }
  if (may('below_cost') || may('discount')) {
    const rows = await soft(ctx, () => ctx.tx`
      select i.invoice_no, i.customer_name, i.subtotal, i.discount, i.created_by,
             sum(l.line_total) as goods, sum(l.qty * coalesce(l.unit_cost, 0)) filter (where coalesce(l.unit_cost, 0) > 0) as cost,
             sum(l.line_total) filter (where coalesce(l.unit_cost, 0) > 0) as goods_costed,
             sum(l.qty * l.unit_price) as gross
      from invoices i join invoice_lines l on l.invoice_id = i.id
      where i.business_id = ${ctx.biz} and i.created_at > now() - interval '48 hours' and i.invoice_no not like 'RTN-%' and i.cancelled_at is null
      group by i.id order by i.created_at desc limit 200`, []);
    for (const r of rows) {
      const gross = num(r.gross), net = num(r.goods) - num(r.discount);
      const pct = gross > 0 ? Math.round((gross - net) / gross * 100) : 0;
      if (may('below_cost') && num(r.cost) > 0 && num(r.goods_costed) - num(r.discount) < num(r.cost) - 0.5) {
        add('below_cost', { key: 'below:' + str(r.invoice_no), level: 'bad', title: 'Sold below cost: ' + str(r.invoice_no),
          detail: str(r.customer_name) + ' · goods ' + tk(num(r.goods_costed) - num(r.discount)) + ' against cost ' + tk(r.cost), go: 'sales:' + str(r.invoice_no) });
      } else if (may('discount') && pct >= num(rules.discount.at) && gross > 0) {
        add('discount', { key: 'disc:' + str(r.invoice_no), title: pct + '% discount on ' + str(r.invoice_no), detail: str(r.customer_name) + ' · ' + tk(gross - net) + ' off ' + tk(gross), go: 'sales:' + str(r.invoice_no) });
      }
    }
  }
  if (may('cash_short')) {
    for (const m of await soft(ctx, () => ctx.tx`select m.id, m.amount, m.note, m.by, m.at, a.name from money_moves m join money_accounts a on a.id = m.account_id
                                                  where m.business_id = ${ctx.biz} and m.kind = 'adjust' and m.voided is null and m.amount < ${-Math.max(0, num(rules.cash_short.at))}
                                                    and m.at > now() - interval '48 hours' order by m.at desc limit 20`, [])) {
      add('cash_short', { key: 'short:' + m.id, level: 'bad', title: str(m.name) + ' was ' + tk(-num(m.amount)) + ' short when counted', detail: 'by ' + str(m.by) + ' · ' + str(m.note).slice(0, 120), go: 'cash' });
    }
  }
  if (may('payout_late')) {
    for (const p of await payoutLate(ctx, rules.payout_late.at)) {
      add('payout_late', { key: 'payout:' + p.consignment, title: 'Steadfast has not paid out ' + tk(p.amount) + ' for ' + p.invoice, detail: 'delivered ' + p.since + ' (' + p.days + ' days) · consignment ' + p.consignment, go: 'sales:' + p.invoice });
    }
  }
  if (may('return_waiting')) {
    for (const r of await returnWaiting(ctx, rules.return_waiting.at)) {
      add('return_waiting', { key: 'retwait:' + r.invoice, title: 'Parcel ' + r.invoice + ' came back ' + r.days + ' days ago - goods not taken back', detail: r.customer + ' · ' + tk(r.amount) + ' · use Return on the invoice when the parcel is on the shelf', go: 'sales:' + r.invoice });
    }
  }
  if (may('write_off')) {
    for (const m of await soft(ctx, () => ctx.tx`
      select m.id, m.qty, m.note, m.reference, m.operator, m.created_at, p.name,
             m.qty * coalesce(nullif(m.unit_price, 0), p.cost_price, 0) as value
      from stock_movements m join products p on p.id = m.product_id
      where m.business_id = ${ctx.biz} and m.direction = 'OUT' and m.kind in ('ADJUST', 'DAMAGE') and coalesce(m.reference, '') not like 'Job:%'
        and m.created_at > now() - interval '48 hours'
        and m.qty * coalesce(nullif(m.unit_price, 0), p.cost_price, 0) >= ${Math.max(0, num(rules.write_off.at))}
      order by m.created_at desc limit 30`, [])) {
      add('write_off', { key: 'wo:' + m.id, title: num(m.qty) + ' × ' + str(m.name) + ' written off (' + tk(m.value) + ')', detail: 'by ' + str(m.operator) + ' · ' + (str(m.note) || str(m.reference)).slice(0, 120), go: 'stock' });
    }
  }
  if (may('web_waiting')) {
    for (const w of await webWaiting(ctx, rules.web_waiting.at)) {
      add('web_waiting', { key: 'web:' + w.order, title: 'Website order ' + w.order + ' not entered for ' + w.hours + ' hours', detail: w.customer + ' · ' + tk(w.amount), go: 'weborders' });
    }
  }
  return out;
}

export const HANDLERS = { erpRisks, erpAlertRules, erpAlertRulesSave };
