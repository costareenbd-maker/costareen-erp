// Sales commission (FilaDash merge P3; supabase/110_commission.sql).
//
//   commissionFor   what each seller earned month by month (and the month totals the P&L counts as a cost)
//   erpCommission   the screen: the month's sellers, what they sold, earned, were paid; the rules
//   erpCommissionRuleSave / erpCommissionRuleVoid   the owner's rules
//   erpCommissionPay  paying a seller: an expense 'Commission paid to ...' (not counted a second time)

import { str } from '../lib/tabs.js';
import { num, round2, formatDate } from '../lib/time.js';

const R = (v) => Math.round(num(v));
const isMonth = (m) => /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || ''));
export const isCommissionPaid = (category, description) => str(category) === 'Commission' && /^Commission paid to /.test(str(description));

async function rules(ctx) {
  return ctx.tx`select r.id, r.seller, r.scope, r.match, r.basis, r.pct, r.note, r.at,
                       coalesce(pe.name, pr.full_name, pr.email, '') as seller_name
                from commission_rules r left join erp_people pe on pe.user_id = r.seller left join profiles pr on pr.id = r.seller
                where r.business_id = ${ctx.biz} and r.voided_at is null order by r.at`;
}

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
  const rs = await rules(ctx);
  if (!rs.length || !months.length) return (ctx.memo[key] = out);
  const lines = await ctx.tx`
    select coalesce(o.created_by, i.created_by) as seller, to_char(public.dhaka_date(i.created_at), 'YYYY-MM') as m,
           l.qty, l.line_total, coalesce(l.unit_cost, 0) as unit_cost, coalesce(p.sku, l.sku) as sku, p.category, p.brand,
           coalesce(i.invoice_discount, 0) as inv_disc,
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
    const rule = ruleFor(rs, l.seller, l);
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
  const owner = ctx.s.role === 'owner';
  const now = formatDate(ctx.now, 'yyyy-MM');
  const month = isMonth(payload && payload.month) ? payload.month : now;
  const c = await commissionFor(ctx, [month]);
  const paid = {};
  for (const e of await ctx.tx`select description, amount from expenses where business_id = ${ctx.biz} and month = ${month}
                               and category = 'Commission' and description like 'Commission paid to %' and coalesce(btrim(voided), '') = ''`) {
    const who = str(e.description).replace(/^Commission paid to /, '').replace(/ for \d{4}-\d{2}.*$/, '');
    paid[who] = (paid[who] || 0) + num(e.amount);
  }
  const me = String(ctx.s.userId);
  const sellers = Object.entries(c.bySeller).filter(([id]) => owner || id === me).map(([id, s]) => {
    const x = s.months[month] || { sales: 0, profit: 0, due: 0 };
    return { id, name: s.name, sales: R(x.sales), profit: R(x.profit), earned: R(x.due), paid: R(paid[s.name] || 0), left: R(x.due - (paid[s.name] || 0)) };
  }).sort((a, b) => b.earned - a.earned);
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
  if (ctx.s.role !== 'owner') throw new Error('Only the owner sets commission.');
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
  await ctx.tx`insert into commission_rules (business_id, seller, scope, match, basis, pct, note, by)
               values (${ctx.biz}, ${seller || null}, ${scope}, ${match.slice(0, 120)}, ${basis}, ${pct}, ${str(payload.note).slice(0, 200) || null}, ${str(ctx.s.name) || 'Owner'})`;
  Object.keys(ctx.memo).forEach((k) => { if (k.indexOf('commission:') === 0 || k.indexOf('pnl:') === 0) delete ctx.memo[k]; });
  return erpCommission(ctx, { month: payload.month });
}

export async function erpCommissionRuleVoid(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner sets commission.');
  const r = await ctx.tx`update commission_rules set voided_at = now() where business_id = ${ctx.biz} and id = ${str(payload && payload.id)} and voided_at is null returning id`;
  if (!r.length) throw new Error('That rule is not there.');
  Object.keys(ctx.memo).forEach((k) => { if (k.indexOf('commission:') === 0 || k.indexOf('pnl:') === 0) delete ctx.memo[k]; });
  return erpCommission(ctx, { month: payload && payload.month });
}

/** Pay a seller: an expense row 'Commission paid to NAME for yyyy-MM' (the cost was counted when earned). */
export async function erpCommissionPay(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner pays commission.');
  payload = payload || {};
  const month = isMonth(payload.month) ? payload.month : formatDate(ctx.now, 'yyyy-MM');
  const amount = round2(num(payload.amount));
  if (!(amount > 0)) throw new Error('How much is paid?');
  const c = await erpCommission(ctx, { month });
  const s = c.sellers.find((x) => x.id === str(payload.seller));
  if (!s) throw new Error('That person earned no commission in ' + month + '.');
  if (amount > s.left + 0.5) throw new Error(s.name + ' has ' + s.left + ' left to be paid for ' + month + '.');
  const { erpExpenseAdd } = await import('./expenses.js');
  await erpExpenseAdd(ctx, { amount, description: 'Commission paid to ' + s.name + ' for ' + month, category: 'Commission', month, account: str(payload.account) });
  return erpCommission(ctx, { month });
}

export const HANDLERS = { erpCommission, erpCommissionRuleSave, erpCommissionRuleVoid, erpCommissionPay };
