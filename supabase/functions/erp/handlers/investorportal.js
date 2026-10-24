// The investor's own page (FilaDash merge P3; supabase/112_investor_links.sql, web/investor.html).
//
//   erpInvestorLink       owner: a new link + 8-digit code for one investor (the old one stops working)
//   erpInvestorLinkOff    owner: switch the investor's link off
//   route                 ?pub=investor : GET says whose page it is (no figures); POST with the code gives the statement
//
// Only hashes of the secret and the code are kept. Five wrong codes lock the link for 15 minutes; one address is limited
// to 60 tries an hour. Works for the business that runs this server (company copies keep their own investors there).

import { str } from '../lib/tabs.js';
import { num, formatDate } from '../lib/time.js';
import { limit } from './passport.js';
import { investorReturns } from './returns.js';
import { erpLotFunding } from './lots.js';

const enc = new TextEncoder();
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }
function secret(n) {
  const a = new Uint8Array(n); crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function code8() { const a = new Uint32Array(2); crypto.getRandomValues(a); return String(10000000 + (a[0] % 90000000)); }
const R = (v) => Math.round(num(v));

async function holder(ctx, no) {
  return (await ctx.tx`select holder_no, name, kind, return_kind, return_value, since_month, ended_month from capital_holders
                       where business_id = ${ctx.biz} and holder_no = ${no}`)[0];
}

export async function erpInvestorLink(ctx, payload) {
  {
    const h = (await ctx.tx`select kind, name from capital_holders where business_id = ${ctx.biz} and holder_no = ${String((payload && payload.holder) || '')}`)[0];
    if (h && String(h.kind) !== 'investor') throw new Error(String(h.name) + ' is a shareholder: the investor page shows an investor\u2019s money and returns, so it is not made for a shareholder.');   // fix-5 L7
  }
  if (ctx.s.role !== 'owner') throw new Error('Only the owner makes an investor’s page.');
  const h = await holder(ctx, str(payload && payload.holder));
  if (!h) throw new Error('Choose someone from Capital.');
  const token = secret(18), code = code8();
  await ctx.tx`update investor_links set revoked_at = now() where business_id = ${ctx.biz} and holder_no = ${h.holder_no} and revoked_at is null`;
  await ctx.tx`insert into investor_links (business_id, holder_no, token_hash, code_hash, made_by)
               values (${ctx.biz}, ${h.holder_no}, ${await sha256hex(token)}, ${await sha256hex(h.holder_no + ':' + code)}, ${str(ctx.s.name) || 'Owner'})`;
  const base = str((ctx.deps && ctx.deps.google && ctx.deps.google.appUrl) || (ctx.deps && ctx.deps.installEnv && ctx.deps.installEnv.appUrl)) || 'https://erp.costareen.com/';
  const app = base.endsWith('/') ? base : base + '/';
  const api = str(payload && payload.api);
  const url = app + 'investor.html?t=' + token + (/^https:\/\/[a-z0-9.-]+\/functions\/v1\/erp$/.test(api) || /^http:\/\/localhost:\d+\/$/.test(api) ? '&api=' + encodeURIComponent(api) : '');
  return { ok: true, holder: h.holder_no, name: str(h.name), url, code, note: 'Give the code separately (by phone). It is shown only now.' };
}

export async function erpInvestorLinkOff(ctx, payload) {
  if (ctx.s.role !== 'owner') throw new Error('Only the owner changes an investor’s page.');
  const r = await ctx.tx`update investor_links set revoked_at = now() where business_id = ${ctx.biz} and holder_no = ${str(payload && payload.holder)} and revoked_at is null returning id`;
  return { ok: true, off: r.length };
}

/** What the investor sees: their own money, returns and shipments - nothing about anyone else. */
async function statement(ctx, no) {
  const h = await holder(ctx, no);
  if (!h) throw new Error('This page is no longer available.');
  const book = await ctx.tx`select on_date, recorded_at, type, amount, method, note from capital_book
                            where business_id = ${ctx.biz} and holder_no = ${no} and coalesce(btrim(voided), '') = '' order by coalesce(on_date, recorded_at)`;
  let capital = 0, paid = 0;
  const lines = book.map((b) => {
    const t = str(b.type), a = num(b.amount);
    if (t === 'invest') capital += a; else if (t === 'withdraw') capital -= a; else if (t === 'ret' || t === 'profit') paid += a;
    return { date: formatDate(new Date(b.on_date || b.recorded_at), 'd MMM yyyy'), what: { invest: 'Money put in', withdraw: 'Money taken back', ret: 'Return paid', profit: 'Profit paid' }[t] || t, amount: R(a), note: str(b.note) };
  }).reverse();
  const now = formatDate(ctx.now, 'yyyy-MM');
  const mine = (await investorReturns(ctx)).byHolder[no] || {};
  const months = Object.keys(mine).sort().reverse().map((m) => ({ month: m, earned: R(mine[m]), running: m === now }));
  let due = 0, building = 0;
  for (const m of Object.keys(mine)) { if (m < now) due += num(mine[m]); else building += num(mine[m]); }
  let shipments = [];
  if (str(h.return_kind) === 'lot') shipments = (await erpLotFunding(ctx, {})).funding.filter((f) => f.holder === no)
    .map((f) => ({ reference: f.reference, share: f.pct, funded: f.funded, unitsFunded: f.unitsFunded, soldUnits: f.soldUnits, recovered: f.recovered, profit: f.profit, holding: f.holding, earned: f.earned }));
  const biz = (await ctx.tx`select name from businesses where id = ${ctx.biz}`)[0];
  const terms = str(h.return_kind) === 'lot' ? num(h.return_value) + '% of the profit on the part of each shipment you funded'
    : str(h.return_kind) === 'percent' ? num(h.return_value) + '% of your money each month'
    : str(h.return_kind) === 'monthly' ? 'BDT ' + R(h.return_value) + ' each month' : 'no fixed return';
  return { business: str(biz && biz.name), name: str(h.name), terms, since: str(h.since_month), currency: 'BDT',
           capital: R(capital), earnedDue: R(due), building: R(building), paid: R(paid), owed: R(due - paid),
           months, shipments, lines, asOf: formatDate(ctx.now, 'd MMM yyyy, h:mm a') };
}

export async function route(deps, R0, method, params, body, ip) {
  const t = str(params.get('t') || (body && body.t));
  if (!/^[A-Za-z0-9_-]{20,40}$/.test(t)) throw new Error('This link is not complete.');
  await limit(deps, ip, 'investor', 60);
  const l = (await deps.sql`select l.id, l.business_id, l.holder_no, l.code_hash, l.revoked_at, l.failed, l.locked_until, h.name, b.name as biz
                            from investor_links l join capital_holders h on h.business_id = l.business_id and h.holder_no = l.holder_no
                            join businesses b on b.id = l.business_id where l.token_hash = ${await sha256hex(t)}`)[0];
  if (!l || l.revoked_at) throw new Error('This link is not known or has been switched off. Ask for a new one.');
  if (method === 'GET') return { business: str(l.biz), name: str(l.name).split(' ')[0], needCode: true };
  if (l.locked_until && new Date(l.locked_until) > new Date()) throw new Error('Too many wrong codes. Try again in 15 minutes.');
  // fix-3 M17: every try is counted BEFORE the code is checked, one at a time - many tries at once cannot slip past the lock
  const tryNo = (await deps.sql`update investor_links set failed = case when locked_until <= now() then 1 else failed + 1 end, locked_until = case when locked_until <= now() then null else locked_until end where id = ${l.id} and (locked_until is null or locked_until <= now()) returning failed`)[0];
  if (!tryNo || num(tryNo.failed) > 5) {
    await deps.sql`update investor_links set locked_until = greatest(coalesce(locked_until, now()), now() + interval '15 minutes') where id = ${l.id} and failed > 5`;
    throw new Error('Too many wrong codes. Try again in 15 minutes.');
  }
  const code = str(body && body.code).replace(/\D/g, '');
  if (code.length !== 8 || (await sha256hex(l.holder_no + ':' + code)) !== l.code_hash) {
    await deps.sql`update investor_links set locked_until = case when failed >= 5 then now() + interval '15 minutes' else locked_until end where id = ${l.id}`;
    throw new Error('That code is not right.');
  }
  await deps.sql`update investor_links set failed = 0, last_seen = now() where id = ${l.id} and locked_until is null`;
  await deps.sql`update investor_links set last_seen = now() where id = ${l.id}`;
  const rows = await R0.owners(deps.sql, [l.business_id]);
  if (!rows.length) throw new Error('This page is not available right now.');
  const out = await R0.asBusiness(deps, { ...rows[0], who: 'Investor page' }, 'pub:investor', (ctx) => statement(ctx, l.holder_no));
  if (out && out.error) throw new Error(out.error);
  return out;
}

export const HANDLERS = { erpInvestorLink, erpInvestorLinkOff };
