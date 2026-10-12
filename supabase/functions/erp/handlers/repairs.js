// Repair / service jobs (plan D2, 041_service_jobs.sql).
//
//   erpJobs({status})                   the jobs: open ones first
//   erpJob({jobNo})                     one job, with what has been paid on it
//   erpJobOpen({customer, item, sku, serial, problem, accessories})
//   erpJobSave({jobNo, status, diagnosis, labour, parts, note})
//   erpJobPay({jobNo, amount, method, account})
//
// Parts leave the shelf when they are put on the job (and come back when
// taken off, or when the job is cancelled). The charge is labour + parts;
// under warranty parts and labour start at 0 and can be typed. Money received
// on a job is a payment like any other (its "invoice" is the job number), so
// it lands in a money account; the month's repair income and the cost of the
// parts go into the profit and loss (dashboard.js serviceFor).

import { formatDate, num, round2 } from '../lib/time.js';
import { phone11, custKey } from '../lib/phone.js';
import { forget, paymentsTab, PAY } from '../lib/tabs.js';
import { roleAtLeast } from '../allow.js';
import { addPayment, who, stamp, lock } from './money.js';
import { products } from './dashboard.js';
import { accountForMethod } from './cash.js';

const str = (v) => String(v == null ? '' : v).trim();
const day = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const STATUS = { received: 'Received', diagnosed: 'Diagnosed', waiting: 'Waiting for parts', repaired: 'Repaired', returned: 'Returned to customer', cancelled: 'Cancelled' };
const OPEN = { received: 1, diagnosed: 1, waiting: 1, repaired: 1 };

async function paidMap(ctx) {
  const out = {};
  for (const p of await paymentsTab(ctx)) {
    const o = str(p[PAY.order_id]);
    if (/^JOB-/.test(o)) out[o] = round2((out[o] || 0) + num(p[PAY.amount]));
  }
  return out;
}
function rowOf(r, paid) {
  const charge = num(r.charge), p = num(paid[str(r.job_no)]);
  return { jobNo: str(r.job_no), customer: str(r.customer), phone: str(r.phone), item: str(r.item), sku: str(r.sku), serial: str(r.serial),
           underWarranty: !!r.under_warranty, warrantyUntil: day(r.warranty_until), problem: str(r.problem), accessories: str(r.accessories),
           status: str(r.status), statusLabel: STATUS[str(r.status)] || str(r.status), open: !!OPEN[str(r.status)],
           diagnosis: str(r.diagnosis), parts: Array.isArray(r.parts) ? r.parts : [], labour: num(r.labour), charge, paid: p, due: Math.max(0, round2(charge - p)),
           received: day(r.received_at), receivedTs: r.received_at ? new Date(r.received_at).getTime() : 0, returned: day(r.returned_at),
           days: Math.max(0, Math.floor(((r.returned_at ? new Date(r.returned_at) : ctx_now()) - new Date(r.received_at)) / 86400e3)),
           note: str(r.note), openedBy: str(r.opened_by) };
}
let NOW = () => new Date();
function ctx_now() { return NOW(); }

async function jobRow(ctx, jobNo) {
  const r = (await ctx.tx`select * from service_jobs where business_id = ${ctx.biz} and job_no = ${str(jobNo).toUpperCase()}`)[0];
  if (!r) throw new Error('No job called ' + str(jobNo) + '.');
  return r;
}

export async function erpJobs(ctx, payload) {
  NOW = () => ctx.now;
  const want = str(payload && payload.status);
  const rows = await ctx.tx`select * from service_jobs where business_id = ${ctx.biz} order by (status in ('received','diagnosed','waiting','repaired')) desc, received_at desc limit 400`;
  const paid = await paidMap(ctx);
  const all = rows.map((r) => rowOf(r, paid));
  const list = want === 'open' ? all.filter((j) => j.open) : want === 'closed' ? all.filter((j) => !j.open) : all;
  const counts = { open: all.filter((j) => j.open).length, closed: all.filter((j) => !j.open).length,
                   owed: round2(all.filter((j) => j.status === 'returned').reduce((a, j) => a + j.due, 0)) };
  return { jobs: list.slice(0, 200), counts, statuses: STATUS, canMoney: roleAtLeast(ctx.s.role, 'manager') };
}

export async function erpJob(ctx, payload) {
  NOW = () => ctx.now;
  const r = await jobRow(ctx, payload && payload.jobNo);
  const paid = await paidMap(ctx);
  const pays = (await paymentsTab(ctx)).filter((p) => str(p[PAY.order_id]) === str(r.job_no))
    .map((p) => ({ id: str(p[PAY.payment_id]), when: day(p[PAY.timestamp]), amount: num(p[PAY.amount]), method: str(p[PAY.method]), by: str(p[PAY.recorded_by]) }));
  return { job: rowOf(r, paid), payments: pays, statuses: STATUS, canMoney: roleAtLeast(ctx.s.role, 'manager') };
}

export async function erpJobOpen(ctx, payload) {
  payload = payload || {};
  NOW = () => ctx.now;
  const c = payload.customer || {};
  let name = str(c.name).slice(0, 120), phone = str(c.phone), item = str(payload.item).slice(0, 200);
  const serial = str(payload.serial).replace(/\s+/g, '').toUpperCase().slice(0, 60), problem = str(payload.problem).slice(0, 2000);
  if (!problem) throw new Error('What is wrong with it? A few words is enough.');
  let sku = str(payload.sku), underWarranty = false, warrantyUntil = null;
  // a serial this system sold: the machine, the buyer and the warranty are known
  if (serial) {
    const s = (await ctx.tx`select s.*, p.name from serials s join products p on p.id = s.product_id
                            where s.business_id = ${ctx.biz} and upper(s.serial) = ${serial} order by s.sold_at desc nulls last limit 1`)[0];
    if (s) {
      if (!item) item = str(s.name);
      if (!sku) sku = str(s.sku);
      if (!name && str(s.customer)) name = str(s.customer);
      if (s.warranty_until) {
        warrantyUntil = s.warranty_until;
        underWarranty = formatDate(ctx.now, 'yyyy-MM-dd') <= formatDate(new Date(s.warranty_until), 'yyyy-MM-dd');
      }
    }
  }
  if (payload.underWarranty === true || payload.underWarranty === false) underWarranty = payload.underWarranty;
  if (!item) throw new Error('What came in? Name the machine or item.');
  if (!name) throw new Error('Whose is it? Type the customer\u2019s name.');
  if (phone) phone = phone11(phone);
  await lock(ctx, 'jobs');
  const today = formatDate(ctx.now, 'yyMMdd');
  const n = (await ctx.tx`select count(*)::int n from service_jobs where business_id = ${ctx.biz} and job_no like ${'JOB-' + today + '-%'}`)[0].n + 1;
  const jobNo = 'JOB-' + today + '-' + String(n).padStart(2, '0');
  await ctx.tx`insert into service_jobs (business_id, job_no, customer, phone, customer_key, item, sku, serial, under_warranty, warranty_until, problem, accessories, opened_by)
               values (${ctx.biz}, ${jobNo}, ${name}, ${phone}, ${custKey(phone, name) || null}, ${item}, ${sku || null}, ${serial || null}, ${underWarranty}, ${warrantyUntil},
                       ${problem}, ${str(payload.accessories).slice(0, 300) || null}, ${who(ctx)})`;
  // the Printer Passport register: "a repair came in" (the job number stays private)
  if (serial) { try { const P = await import('./passport.js'); await P.passportRepair(ctx, serial, jobNo, 'received'); } catch (e) { console.error('passport repair', e); } }
  return erpJob(ctx, { jobNo });
}

/** Parts on the job: what is on it now against what was, and the shelf moves by the difference. */
async function setParts(ctx, r, wanted) {
  const { bySku } = await products(ctx);
  const was = {}; (Array.isArray(r.parts) ? r.parts : []).forEach((p) => { was[str(p.sku).toLowerCase()] = p; });
  const out = [], now = {};
  for (const w of Array.isArray(wanted) ? wanted : []) {
    const k = str(w.sku).toLowerCase(), qty = Math.round(num(w.qty));
    if (!k || !(qty > 0)) continue;
    if (now[k]) { now[k].qty += qty; continue; }
    const p = bySku[k];
    if (!p) throw new Error('Unknown part: ' + str(w.sku));
    const prev = was[k];
    const price = w.price === '' || w.price === null || w.price === undefined ? (prev ? num(prev.price) : (r.under_warranty ? 0 : num(p.sell))) : round2(num(w.price));
    now[k] = { sku: p.sku, name: p.name, qty, price, cost: prev ? num(prev.cost) : round2(num(p.cost)) };
  }
  const stock = {};
  for (const s of await ctx.tx`select p.sku, coalesce(ps.stock, 0) as stock from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${ctx.biz}`) stock[str(s.sku).toLowerCase()] = num(s.stock);
  const ids = {};
  for (const p of await ctx.tx`select id, sku from products where business_id = ${ctx.biz}`) ids[str(p.sku).toLowerCase()] = p.id;
  const keys = new Set(Object.keys(was).concat(Object.keys(now)));
  for (const k of keys) {
    const before = was[k] ? num(was[k].qty) : 0, after = now[k] ? now[k].qty : 0, diff = after - before;
    if (!diff) continue;
    const name = (now[k] || was[k]).name, cost = (now[k] || was[k]).cost;
    if (diff > 0 && (stock[k] || 0) < diff) throw new Error('Not enough ' + name + ' on the shelf: ' + (stock[k] || 0) + ' there, ' + diff + ' more needed.');
    await ctx.tx`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, note, created_by, created_at, txn_no, operator, product_name)
                 values (${ctx.biz}, ${ids[k]}, 'ADJUST', ${diff > 0 ? 'OUT' : 'IN'}, ${Math.abs(diff)}, ${cost}, ${round2(cost * Math.abs(diff))},
                         ${'Job: ' + str(r.job_no)}, ${diff > 0 ? 'used on repair job ' + str(r.job_no) : 'taken off repair job ' + str(r.job_no)},
                         ${ctx.s.userId}, ${new Date()}, ${'TXN-' + formatDate(new Date(), 'yyyyMMdd') + '-' + Math.floor(Math.random() * 9000 + 1000)}, ${who(ctx)}, ${name})`;
  }
  forget(ctx, 'TXN_LOG'); delete ctx.memo.catalog;
  for (const k of Object.keys(now)) out.push(now[k]);
  return out;
}

export async function erpJobSave(ctx, payload) {
  payload = payload || {};
  NOW = () => ctx.now;
  await lock(ctx, 'jobs');
  const r = await jobRow(ctx, payload.jobNo);
  if (str(r.status) === 'cancelled') throw new Error('That job was cancelled.');
  let status = str(payload.status) || str(r.status);
  if (!STATUS[status]) throw new Error('Unknown status.');
  if (str(r.status) === 'returned' && status !== 'returned' && !roleAtLeast(ctx.s.role, 'manager')) throw new Error('A returned job is reopened by a manager.');
  let parts = Array.isArray(r.parts) ? r.parts : [];
  if (status === 'cancelled') {
    if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager cancels a job.');
    parts = await setParts(ctx, r, []);                 // every part back on the shelf
  } else if (payload.parts !== undefined) {
    parts = await setParts(ctx, r, payload.parts);
  }
  const labour = payload.labour === undefined ? num(r.labour) : round2(num(payload.labour));
  if (labour < 0) throw new Error('Labour cannot be below 0.');
  const charge = status === 'cancelled' ? 0 : round2(labour + parts.reduce((a, p) => a + num(p.qty) * num(p.price), 0));
  const diagnosis = payload.diagnosis === undefined ? r.diagnosis : str(payload.diagnosis).slice(0, 2000);
  const note = payload.note === undefined ? r.note : str(payload.note).slice(0, 1000);
  await ctx.tx`update service_jobs set status = ${status}, diagnosis = ${diagnosis}, parts = ${ctx.tx.json(parts)}, labour = ${labour}, charge = ${charge}, note = ${note},
                 returned_at = ${status === 'returned' ? (r.returned_at || new Date()) : null}, updated_at = now() where id = ${r.id}`;
  if (status === 'returned' && str(r.status) !== 'returned' && str(r.serial)) { try { const P = await import('./passport.js'); await P.passportRepair(ctx, r.serial, r.job_no, 'returned'); } catch (e) { console.error('passport repair', e); } }
  return erpJob(ctx, { jobNo: r.job_no });
}

export async function erpJobPay(ctx, payload) {
  payload = payload || {};
  NOW = () => ctx.now;
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Your account cannot record payments.');
  const r = await jobRow(ctx, payload.jobNo);
  const amount = round2(num(payload.amount));
  if (!(amount > 0)) throw new Error('How much was received?');
  const paid = (await paidMap(ctx))[str(r.job_no)] || 0;
  const due = round2(num(r.charge) - paid);
  if (amount > due + 0.5) throw new Error('Only ' + due + ' is owed on ' + str(r.job_no) + '.');
  const method = str(payload.method) || 'Cash';
  await addPayment(ctx, { id: 'J' + stamp(), order: str(r.job_no), customer: str(r.customer), at: new Date(), amount, method,
                          account: str(payload.account) || await accountForMethod(ctx, method), note: 'repair job ' + str(r.job_no) + ' [job]' });
  return erpJob(ctx, { jobNo: r.job_no });
}

/** What repairs made in a month, and what the parts cost - for the profit and loss. Jobs count in the month they were returned. */
export async function serviceFor(ctx, month) {
  try {
    const rows = await ctx.tx.savepoint(() => ctx.tx`select charge, parts from service_jobs where business_id = ${ctx.biz} and status = 'returned'
                                                     and to_char(returned_at at time zone 'Asia/Dhaka', 'YYYY-MM') = ${month}`);
    let income = 0, parts = 0;
    for (const r of rows) { income += num(r.charge); for (const p of (Array.isArray(r.parts) ? r.parts : [])) parts += num(p.qty) * num(p.cost); }
    return { income: Math.round(income), parts: Math.round(parts), jobs: rows.length };
  } catch (_) { return { income: 0, parts: 0, jobs: 0 }; }
}

export const HANDLERS = { erpJobs, erpJob, erpJobOpen, erpJobSave, erpJobPay };
