// Sales commission (FilaDash merge P3; supabase/110_commission.sql).
//
//   commissionFor   what each seller earned month by month (and the month totals the P&L counts as a cost)
//   erpCommission   the screen: the month's sellers, what they sold, earned, were paid; the rules
//   erpCommissionRuleSave / erpCommissionRuleVoid   the owner's rules
//   erpCommissionPay  paying a seller: an expense 'Commission paid to ...' (not counted a second time)

import { str } from '../lib/tabs.js';
import { powerOn, actRole } from '../allow.js';
import { num, round2, formatDate } from '../lib/time.js';

const R = (v) => Math.round(num(v));
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
export const isCommissionPaid = (category, description) => str(category) === 'Commission' && /^Commission paid to /.test(str(description));

async function rules(ctx, withEnded) {
  return ctx.tx`select r.id, r.seller, r.scope, r.match, r.basis, r.pct, r.note, r.at, r.voided_at,
                       to_char(public.dhaka_date(r.at), 'YYYY-MM') as from_m,
                       case when r.voided_at is null then null else to_char(public.dhaka_date(r.voided_at), 'YYYY-MM') end as until_m,
                       coalesce(pe.name, pr.full_name, pr.email, '') as seller_name
                from commission_rules r left join erp_people pe on pe.user_id = r.seller left join profiles pr on pr.id = r.seller
                where r.business_id = ${ctx.biz} and (${!!withEnded} or r.voided_at is null) order by r.at`;
}
// a rule counts from the month it starts; a struck-out rule still counts for the months before it was struck out,
// so a new or removed rule never rewrites months already reported (or closed)
const ruleOn = (r, m) => m >= String(r.from_m) && (!r.until_m || m < String(r.until_m));

const LEVEL = { sku: 3, brand: 2, category: 1, all: 0 };
function ruleFor(rs, seller, line) {
  let best = null, score = -1;
  for (const r of rs) {
    if (r.seller && String(r.seller) !== String(seller)) continue;
    const m = str(r.match).toLowerCase();
    const hit = r.scope === 'all' || (r.scope === 'sku' && m === str(line.sku).toLowerCase()) ||
                (r.scope === 'brand' && m === str(line.brand).toLowerCase()) || (r.scope === 'category' && m === str(line.category).toLowerCase());
    if (!hit) continue;
    const s = LEVEL[r.scope] * 2 + (r.seller ? 1 : 0);
    if (s > score) { score = s; best = r; }
  }
  return best;
}

/** { bySeller: { id: { name, months: { m: { sales, profit, due } } } }, byMonth: { m: due } } */
export async function commissionFor(ctx, months) {
  const key = 'commission:' + months.join(',');
  if (ctx.memo[key]) return ctx.memo[key];
  const out = { bySeller: {}, byMonth: {} };
  const rs = await rules(ctx, true);
  if (!rs.length || !months.length) return (ctx.memo[key] = out);
  const lines = await ctx.tx`
    select coalesce(o.seller_id, o.created_by, i.seller_id, i.created_by) as seller, to_char(public.dhaka_date(i.created_at), 'YYYY-MM') as m,
           l.qty, l.line_total, coalesce(l.unit_cost, 0) as unit_cost, coalesce(p.sku, l.sku) as sku, p.category, p.brand,
           -- fix-2 H10: a line's total already has its share of the invoice discount; only a discount left outside the lines
           -- (invoices brought over from the sheet) is still to be spread
           greatest(0, coalesce(i.discount, 0) - greatest(0, (select coalesce(sum(x.qty * x.unit_price), 0) from invoice_lines x where x.invoice_id = i.id and x.qty > 0 and x.line_total >= 0)
                                                          - (select coalesce(sum(x.line_total), 0) from invoice_lines x where x.invoice_id = i.id and x.line_total > 0))) as inv_disc,
           (select sum(x.line_total) from invoice_lines x where x.invoice_id = i.id and x.line_total > 0) as inv_sum
    from invoice_lines l join invoices i on i.id = l.invoice_id
    left join products p on p.id = l.product_id
    left join invoices o on i.invoice_no like 'RTN-%' and o.business_id = i.business_id
                        and o.invoice_no = substring(i.note from 'return of ([^ ]+)')
    where l.business_id = ${ctx.biz} and i.voided_at is null and l.pool_id is null
      and to_char(public.dhaka_date(i.created_at), 'YYYY-MM') = any(${months})`;
  const names = {};
  for (const r of await ctx.tx`select m.user_id, coalesce(pe.name, pr.full_name, pr.email, 'Someone') as n
                               from memberships m left join erp_people pe on pe.user_id = m.user_id left join profiles pr on pr.id = m.user_id
                               where m.business_id = ${ctx.biz}`) names[String(r.user_id)] = str(r.n);
  for (const l of lines) {
    if (!l.seller) continue;
    const total = num(l.line_total), sum = num(l.inv_sum);
    const sales = total > 0 ? total - (sum > 0 ? num(l.inv_disc) * total / sum : 0) : total;
    const profit = sales - num(l.qty) * num(l.unit_cost);
    const rule = ruleFor(rs.filter((r) => ruleOn(r, str(l.m))), l.seller, l);
    if (!rule) continue;
    const due = (rule.basis === 'profit' ? profit : sales) * num(rule.pct) / 100;
    const id = String(l.seller), m = str(l.m);
    const s = out.bySeller[id] = out.bySeller[id] || { name: names[id] || 'Someone', months: {} };
    const x = s.months[m] = s.months[m] || { sales: 0, profit: 0, due: 0 };
    x.sales += sales; x.profit += profit; x.due += due;
    out.byMonth[m] = (out.byMonth[m] || 0) + due;
  }
  for (const m of Object.keys(out.byMonth)) out.byMonth[m] = R(out.byMonth[m]);
  return (ctx.memo[key] = out);
}

/** The month's commission as a cost (0 when there are no rules). */
export async function commissionDue(ctx, month) {
  try { return num((await ctx.tx.savepoint(() => commissionFor(ctx, [month]))).byMonth[month]); } catch (_) { return 0; }
}

export async function erpCommission(ctx, payload) {
  const owner = actRole(ctx.s) === 'owner';
  const now = formatDate(ctx.now, 'yyyy-MM');
  const month = isMonth(payload && payload.month) ? payload.month : now;
  // Q4 (owner's rule, fix-3): a seller's balance runs on from month to month - commission taken back by a return in a
  // later month comes off what they earn next; what was left unpaid stays owed
  const rs0 = await rules(ctx, true);
  let first = month;
  for (const r of rs0) if (str(r.from_m) < first) first = str(r.from_m);
  const months = [];
  for (let m = month, g = 0; m >= first && g < 36; g++) { months.unshift(m); const y = +m.slice(0, 4), mo = +m.slice(5, 7) - 1; m = mo < 1 ? (y - 1) + '-12' : y + '-' + String(mo).padStart(2, '0'); }
  const c = await commissionFor(ctx, months);
  // fix-3 M15: a payment belongs to the person (item_no 'cm:<id>'); old payments without it are matched by name
  const byName = {};
  for (const [id, x] of Object.entries(c.bySeller)) byName[x.name] = id;
  const paid = {};   // id -> month -> amount
  for (const e of await ctx.tx`select description, amount, month, item_no from expenses where business_id = ${ctx.biz} and month <= ${month}
                               and category = 'Commission' and description like 'Commission paid to %' and coalesce(btrim(voided), '') = ''`) {
    const tag = /^cm:(.+)$/.exec(str(e.item_no));
    const id = tag ? tag[1] : byName[str(e.description).replace(/^Commission paid to /, '').replace(/ for \d{4}-\d{2}.*$/, '')];
    if (!id) continue;
    const pm = paid[id] = paid[id] || {};
    pm[str(e.month)] = (pm[str(e.month)] || 0) + num(e.amount);
  }
  const me = String(ctx.s.userId);
  const canProfit = owner || powerOn(ctx.s, 'costs');   // sellers never see cost or profit
  const sellers = Object.entries(c.bySeller).filter(([id]) => owner || id === me).map(([id, s]) => {
    const x = s.months[month] || { sales: 0, profit: 0, due: 0 };
    const pm = paid[id] || {};
    let carried = 0;
    for (const m of months) if (m < month) carried += num((s.months[m] || {}).due) - num(pm[m]);
    const paidNow = num(pm[month]);
    return { id, name: s.name, sales: R(x.sales), profit: canProfit ? R(x.profit) : undefined, earned: R(x.due), paid: R(paidNow),
             carried: R(carried), left: R(carried + x.due - paidNow) };
  }).filter((x) => (c.bySeller[x.id].months[month] !== undefined) || x.paid || x.carried).sort((a, b) => b.earned - a.earned);
  const rs = (await rules(ctx)).map((r) => ({ id: r.id, seller: r.seller ? String(r.seller) : '', sellerName: r.seller ? str(r.seller_name) || 'Someone' : 'Everyone',
    scope: r.scope, match: str(r.match), basis: r.basis, pct: num(r.pct), note: str(r.note), since: formatDate(r.at, 'd MMM yyyy') }));
  let people = [];
  if (owner) people = (await ctx.tx`select m.user_id, coalesce(pe.name, pr.full_name, pr.email, 'Someone') as n, m.role
                                    from memberships m left join erp_people pe on pe.user_id = m.user_id left join profiles pr on pr.id = m.user_id
                                    where m.business_id = ${ctx.biz} and coalesce(m.active, true) order by 2`).map((r) => ({ id: String(r.user_id), name: str(r.n), role: str(r.role) }));
  return { currency: 'BDT', month, thisMonth: now, canEdit: owner, sellers, rules: owner ? rs : rs.filter((r) => !r.seller || r.seller === me), people,
           total: R(c.byMonth[month] || 0) };
}

export async function erpCommissionRuleSave(ctx, payload) {
  if (actRole(ctx.s) !== 'owner') throw new Error('Only the owner sets commission.');
  payload = payload || {};
  const scope = str(payload.scope) || 'all', basis = str(payload.basis) || 'sales';
  if (!LEVEL.hasOwnProperty(scope)) throw new Error('On everything, a category, a brand or one product?');
  if (basis !== 'sales' && basis !== 'profit') throw new Error('A % of the sales or of the profit?');
  const pct = Math.round(num(payload.pct) * 1000) / 1000;
  if (!(pct > 0 && pct <= 100)) throw new Error('The commission is a percentage above 0 and up to 100.');
  const match = scope === 'all' ? '' : str(payload.match);
  if (scope !== 'all' && !match) throw new Error('Which ' + (scope === 'sku' ? 'product' : scope) + '?');
  const seller = str(payload.seller);
  if (seller && !(await ctx.tx`select 1 from memberships where business_id = ${ctx.biz} and user_id = ${seller}`).length) throw new Error('That person does not work here.');
  // from this month, or from an earlier month that is still open (the owner agreed it then)
  const nowM = formatDate(ctx.now, 'yyyy-MM');
  const since = isMonth(payload.since) && payload.since < nowM ? payload.since : nowM;
  if (since < nowM) {
    const { assertOpen } = await import('../lib/period.js');
    await assertOpen(ctx, since, 'a commission rule cannot start there');
  }
  const at = since < nowM ? since + '-01T00:00:00+06:00' : null;
  await ctx.tx`insert into commission_rules (business_id, seller, scope, match, basis, pct, note, by, at)
               values (${ctx.biz}, ${seller || null}, ${scope}, ${match.slice(0, 120)}, ${basis}, ${pct}, ${str(payload.note).slice(0, 200) || null}, ${str(ctx.s.name) || 'Owner'},
                       coalesce(${at}::timestamptz, now()))`;
  Object.keys(ctx.memo).forEach((k) => { if (k.indexOf('commission:') === 0 || k.indexOf('pnl:') === 0) delete ctx.memo[k]; });
  return erpCommission(ctx, { month: payload.month });
}

export async function erpCommissionRuleVoid(ctx, payload) {
  if (actRole(ctx.s) !== 'owner') throw new Error('Only the owner sets commission.');
  // fix-2 H11: commission already paid this month stays a cost of this month - the rule then ends with the month
  const nowM = formatDate(ctx.now, 'yyyy-MM');
  const paidNow = (await ctx.tx`select 1 from expenses where business_id = ${ctx.biz} and month = ${nowM} and category = 'Commission'
                                and description like 'Commission paid to %' and coalesce(btrim(voided), '') = '' limit 1`).length > 0;
  const y = Number(nowM.slice(0, 4)), mo = Number(nowM.slice(5, 7));
  const nextM = (mo === 12 ? y + 1 : y) + '-' + String(mo === 12 ? 1 : mo + 1).padStart(2, '0');
  const endAt = paidNow ? nextM + '-01T00:00:00+06:00' : null;
  const r = await ctx.tx`update commission_rules set voided_at = coalesce(${endAt}::timestamptz, now()) where business_id = ${ctx.biz} and id = ${str(payload && payload.id)} and voided_at is null returning id`;
  if (!r.length) throw new Error('That rule is not there.');
  Object.keys(ctx.memo).forEach((k) => { if (k.indexOf('commission:') === 0 || k.indexOf('pnl:') === 0) delete ctx.memo[k]; });
  return erpCommission(ctx, { month: payload && payload.month });
}

/** Pay a seller: an expense row 'Commission paid to NAME for yyyy-MM' (the cost was counted when earned). */
export async function erpCommissionPay(ctx, payload) {
  if (actRole(ctx.s) !== 'owner') throw new Error('Only the owner pays commission.');
  payload = payload || {};
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${'commpay:' + ctx.biz}))`;
  const month = isMonth(payload.month) ? payload.month : formatDate(ctx.now, 'yyyy-MM');
  const amount = round2(num(payload.amount));
  if (!(amount > 0)) throw new Error('How much is paid?');
  const c = await erpCommission(ctx, { month });
  const s = c.sellers.find((x) => x.id === str(payload.seller));
  if (!s) throw new Error('That person earned no commission in ' + month + '.');
  if (amount > s.left + 0.5) throw new Error(s.name + ' has ' + Math.max(0, s.left) + ' left to be paid' + (s.carried < -0.5 ? ' (' + Math.round(-s.carried) + ' taken back by returns comes off first)' : '') + ' for ' + month + '.');
  const { erpExpenseAdd } = await import('./expenses.js');
  const desc = 'Commission paid to ' + s.name + ' for ' + month;
  await erpExpenseAdd(ctx, { amount, description: desc, category: 'Commission', month, account: str(payload.account) });
  await ctx.tx`update expenses set item_no = ${'cm:' + s.id} where id = (select id from expenses where business_id = ${ctx.biz} and category = 'Commission'
               and description = ${desc} and item_no is null and coalesce(btrim(voided), '') = '' order by recorded_at desc limit 1)`;   // fix-3 M15
  return erpCommission(ctx, { month });
}

/** Who can be named the seller on a sale (active members), the person asking first. */
export async function erpSellers(ctx) {
  const rows = await ctx.tx`select m.user_id, coalesce(pe.name, pr.full_name, pr.email, 'Someone') as n, m.role
                            from memberships m left join erp_people pe on pe.user_id = m.user_id left join profiles pr on pr.id = m.user_id
                            where m.business_id = ${ctx.biz} and coalesce(m.active, true) order by 2`;
  const me = String(ctx.s.userId);
  const list = rows.map((r) => ({ id: String(r.user_id), name: str(r.n), role: str(r.role), me: String(r.user_id) === me }));
  list.sort((a, b) => (b.me ? 1 : 0) - (a.me ? 1 : 0));
  return { sellers: list, canChoose: false };   // a sale is always the signed-in person's (owner 14 Oct 2026)
}

/** Who sold what in a month, sale by sale (owner 14 Oct 2026: "the system should know who sold how many items"): each
 *  invoice of the month with its seller (the person who made it), units, sales after discounts and the commission it
 *  earned under the rules. The owner sees everyone; anyone else only their own sales. No cost or profit is returned. */
export async function erpCommissionSales(ctx, payload) {
  payload = payload || {};
  const owner = actRole(ctx.s) === 'owner', me = String(ctx.s.userId);
  const month = isMonth(payload.month) ? payload.month : formatDate(ctx.now, 'yyyy-MM');
  const rs = await rules(ctx, true);
  const rows = await ctx.tx`
    select coalesce(o.seller_id, o.created_by, i.seller_id, i.created_by) as seller, i.invoice_no, i.customer_name, i.created_at,
           l.qty, l.line_total, coalesce(l.unit_cost, 0) as unit_cost, coalesce(p.sku, l.sku) as sku, p.category, p.brand,
           -- fix-2 H10: a line's total already has its share of the invoice discount; only a discount left outside the lines
           -- (invoices brought over from the sheet) is still to be spread
           greatest(0, coalesce(i.discount, 0) - greatest(0, (select coalesce(sum(x.qty * x.unit_price), 0) from invoice_lines x where x.invoice_id = i.id and x.qty > 0 and x.line_total >= 0)
                                                          - (select coalesce(sum(x.line_total), 0) from invoice_lines x where x.invoice_id = i.id and x.line_total > 0))) as inv_disc,
           (select sum(x.line_total) from invoice_lines x where x.invoice_id = i.id and x.line_total > 0) as inv_sum
    from invoice_lines l join invoices i on i.id = l.invoice_id
    left join products p on p.id = l.product_id
    left join invoices o on i.invoice_no like 'RTN-%' and o.business_id = i.business_id
                        and o.invoice_no = substring(i.note from 'return of ([^ ]+)')
    where l.business_id = ${ctx.biz} and i.voided_at is null and l.pool_id is null
      and to_char(public.dhaka_date(i.created_at), 'YYYY-MM') = ${month}
    order by i.created_at desc`;
  const names = {};
  for (const r of await ctx.tx`select m.user_id, coalesce(pe.name, pr.full_name, pr.email, 'Someone') as n
                               from memberships m left join erp_people pe on pe.user_id = m.user_id left join profiles pr on pr.id = m.user_id
                               where m.business_id = ${ctx.biz}`) names[String(r.user_id)] = str(r.n);
  const by = {}, order = [];
  for (const l of rows) {
    const seller = l.seller ? String(l.seller) : '';
    if (!owner && seller !== me) continue;
    const total = num(l.line_total), sum = num(l.inv_sum);
    const sales = total > 0 ? total - (sum > 0 ? num(l.inv_disc) * total / sum : 0) : total;
    const profit = sales - num(l.qty) * num(l.unit_cost);
    const m = formatDate(l.created_at, 'yyyy-MM');
    const rule = ruleFor(rs.filter((r) => ruleOn(r, m)), seller, l);
    const due = rule ? (rule.basis === 'profit' ? profit : sales) * num(rule.pct) / 100 : 0;
    const k = str(l.invoice_no);
    if (!by[k]) { by[k] = { invoiceNo: k, date: formatDate(l.created_at, 'd MMM, h:mm a'), customer: str(l.customer_name), sellerId: seller, seller: seller ? (names[seller] || 'Someone') : 'Unknown seller', units: 0, sales: 0, commission: 0 }; order.push(k); }
    by[k].units += num(l.qty); by[k].sales += sales; by[k].commission += due;
  }
  const sales = order.map((k) => ({ ...by[k], units: Math.round(by[k].units * 100) / 100, sales: R(by[k].sales), commission: R(by[k].commission) }));
  const sellers = {};
  for (const x of sales) { const s = sellers[x.sellerId] || (sellers[x.sellerId] = { id: x.sellerId, name: x.seller, invoices: 0, units: 0, sales: 0, commission: 0 }); s.invoices++; s.units += x.units; s.sales += x.sales; s.commission += x.commission; }
  return { month, sales, sellers: Object.values(sellers).sort((a, b) => b.sales - a.sales), all: owner };
}

export const HANDLERS = { erpCommissionSales, erpSellers, erpCommission, erpCommissionRuleSave, erpCommissionRuleVoid, erpCommissionPay };
