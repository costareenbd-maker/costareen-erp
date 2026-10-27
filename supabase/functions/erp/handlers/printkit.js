// Stage N4 (docs/NETWORK-BLUEPRINT.md section 4): the print-business kit - for a business that prints for customers.
//
// Printers (what each costs per hour: wear + electricity + maintenance), opened spools (one unit off the shelf, grams
// drawn per job), print jobs on a board (queued → printing → finishing → ready → delivered; or failed) with the TRUE
// cost of each: filament by the gram from the spool's own cost, machine hours, labour, packaging, extras. A quote
// calculator (adds a failure allowance and the margin) for pricing before the job. The business's own public quote
// link: a customer asks for a print (material, colour, quantity, a link to the file), the shop quotes, the customer
// accepts on his request link, "Make a job".
//
// Signed in: erpPrintKit, erpPrintSettingsSave, erpPrinterSave, erpSpools, erpSpoolOpen, erpSpoolSet, erpPrintCost,
//            erpPrintJobs, erpPrintJob, erpPrintJobSave, erpPrintRequests, erpPrintRequestAnswer, erpPrintRequestJob
// Public (passport.js pubRoute): GET/POST ?pub=printquote&b=<source>:<business>, GET/POST ?pub=printreq&t=<token>

import { formatDate, num, round2 } from '../lib/time.js';
import { phone11, custKey } from '../lib/phone.js';
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig } from '../lib/ext.js';
import { who, lock } from './money.js';
import { products } from './dashboard.js';
import { pubBase, limit, tokenFor } from './passport.js';
import { sourceOf } from './market.js';

const str = (v) => String(v == null ? '' : v).trim();
const day = (d) => (d ? formatDate(new Date(d), 'yyyy-MM-dd') : '');
const when = (d) => (d ? formatDate(new Date(d), 'd MMM, HH:mm') : '');
const STATUS = { queued: 'Queued', printing: 'Printing', finishing: 'Finishing', ready: 'Ready', delivered: 'Delivered', failed: 'Failed', cancelled: 'Cancelled' };
const OPEN = { queued: 1, printing: 1, finishing: 1, ready: 1 };
const enc = new TextEncoder();
const NIL = '00000000-0000-0000-0000-000000000000';
async function sha256hex(s) { const b = await crypto.subtle.digest('SHA-256', enc.encode(s)); return [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, '0')).join(''); }

// ---------------------------------------------------------------- settings (business_config)
const DEF = { kwh: 10, labourHr: 150, failPct: 10, marginPct: 40, pack: 20, quoteOn: false, quoteText: '' };
export async function settings(ctx) {
  const g = async (k, d) => { const v = await getConfig(ctx, 'print_' + k, ''); return v === '' ? d : v; };
  return { kwh: num(await g('kwh', DEF.kwh)), labourHr: num(await g('labour_hr', DEF.labourHr)), failPct: num(await g('fail_pct', DEF.failPct)), marginPct: num(await g('margin_pct', DEF.marginPct)),
    pack: num(await g('pack', DEF.pack)), quoteOn: (await g('quote_on', '0')) === '1', quoteText: str(await g('quote_text', '')) };
}
export async function erpPrintSettingsSave(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner changes the print rates. If you need this, ask the owner to open it for you (Settings > Users).');
  const p = payload || {};
  const n = (v, lo, hi, what) => { const x = num(v); if (!(x >= lo && x <= hi)) throw new Error(what + ' should be between ' + lo + ' and ' + hi + '.'); return x; };
  if (p.kwh !== undefined) await setConfig(ctx, 'print_kwh', String(n(p.kwh, 0, 100, 'Electricity per kWh')));
  if (p.labourHr !== undefined) await setConfig(ctx, 'print_labour_hr', String(n(p.labourHr, 0, 100000, 'Labour per hour')));
  if (p.failPct !== undefined) await setConfig(ctx, 'print_fail_pct', String(n(p.failPct, 0, 100, 'Failure allowance')));
  if (p.marginPct !== undefined) await setConfig(ctx, 'print_margin_pct', String(n(p.marginPct, 0, 500, 'Margin')));
  if (p.pack !== undefined) await setConfig(ctx, 'print_pack', String(n(p.pack, 0, 100000, 'Packaging')));
  if (p.quoteOn !== undefined) await setConfig(ctx, 'print_quote_on', p.quoteOn ? '1' : '0');
  if (p.quoteText !== undefined) await setConfig(ctx, 'print_quote_text', str(p.quoteText).slice(0, 400));
  return settings(ctx);
}

// ---------------------------------------------------------------- printers
function printerRow(r) {
  const wear = num(r.life_hours) > 0 ? num(r.cost) / num(r.life_hours) : 0;
  return { id: r.id, name: str(r.name), model: str(r.model), serial: str(r.serial), boughtAt: day(r.bought_at), cost: num(r.cost), lifeHours: num(r.life_hours), powerW: num(r.power_w),
    maintenanceHr: num(r.maintenance_hr), status: str(r.status), notes: str(r.notes), wearHr: round2(wear) };
}
async function printers(ctx) { return (await ctx.tx`select * from printers where business_id = ${ctx.biz} order by (status = 'active') desc, name`).map(printerRow); }
export async function erpPrinterSave(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner adds or changes printers. If you need this, ask the owner to open it for you (Settings > Users).');
  const p = payload || {};
  const name = str(p.name).slice(0, 60); if (name.length < 2) throw new Error('Give the printer a name (e.g. "A1 left").');
  const life = Math.round(num(p.lifeHours)) || 5000, powerW = Math.round(num(p.powerW)) || 150, cost = round2(num(p.cost)), maint = round2(num(p.maintenanceHr));
  if (life < 100 || life > 100000) throw new Error('Life in hours should be between 100 and 100000.');
  if (powerW < 10 || powerW > 5000) throw new Error('Power should be between 10 and 5000 W.');
  const status = ['active', 'down', 'sold'].includes(p.status) ? p.status : 'active';
  const fields = { name, model: str(p.model).slice(0, 60) || null, serial: str(p.serial).slice(0, 60) || null, bought_at: /^\d{4}-\d{2}-\d{2}$/.test(str(p.boughtAt)) ? str(p.boughtAt) : null, cost, life_hours: life, power_w: powerW, maintenance_hr: maint, status, notes: str(p.notes).slice(0, 500) || null };
  const id = str(p.id);
  if (id) {
    const r = await ctx.tx`update printers set ${ctx.tx(fields)} where id = ${id}::uuid and business_id = ${ctx.biz} returning *`;
    if (!r.length) throw new Error('No such printer.');
    return { printer: printerRow(r[0]), printers: await printers(ctx) };
  }
  const r = await ctx.tx`insert into printers ${ctx.tx({ business_id: ctx.biz, ...fields })} returning *`;
  return { printer: printerRow(r[0]), printers: await printers(ctx) };
}

// ---------------------------------------------------------------- spools
function spoolRow(r) { return { id: r.id, sku: str(r.sku), name: str(r.name), netG: num(r.net_g), remainingG: num(r.remaining_g), cost: num(r.cost), costPerG: num(r.net_g) > 0 ? num(r.cost) / num(r.net_g) : 0, opened: when(r.opened_at), finished: when(r.finished_at), note: str(r.note) }; }
export async function erpSpools(ctx) {
  const rows = await ctx.tx`select * from filament_spools where business_id = ${ctx.biz} order by (finished_at is null) desc, opened_at desc limit 200`;
  const open = rows.filter((r) => !r.finished_at).map(spoolRow), finished = rows.filter((r) => r.finished_at).map(spoolRow).slice(0, 50);
  return { open, finished, filaments: await filaments(ctx) };
}
/** The filament products on the shelf (category "Filaments"), with their cost. */
async function filaments(ctx, inStockOnly) {
  const { bySku } = await products(ctx);
  const rows = await ctx.tx`select p.sku, p.name, p.type, p.color, coalesce(ps.stock, 0) as stock from products p left join product_stock ps on ps.product_id = p.id
                            where p.business_id = ${ctx.biz} and p.category ilike '%filament%' and coalesce(p.status, 'Active') <> 'Discontinued' order by p.name`;
  return rows.filter((r) => !inStockOnly || num(r.stock) > 0).map((r) => ({ sku: str(r.sku), name: str(r.name), type: str(r.type), colour: str(r.color), stock: num(r.stock), cost: num((bySku[str(r.sku).toLowerCase()] || {}).cost) }));
}
export async function erpSpoolOpen(ctx, payload) {
  const p = payload || {};
  const sku = str(p.sku); if (!sku) throw new Error('Which filament?');
  const netG = num(p.netG) > 0 ? round2(num(p.netG)) : 1000;
  if (netG < 50 || netG > 20000) throw new Error('Grams per spool should be between 50 and 20000.');
  await lock(ctx, 'stock');
  const pr = (await ctx.tx`select p.id, p.sku, p.name, coalesce(ps.stock, 0) as stock from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${ctx.biz} and lower(btrim(p.sku)) = ${sku.toLowerCase()}`)[0];
  if (!pr) throw new Error('Unknown product: ' + sku);
  if (num(pr.stock) < 1) throw new Error(str(pr.name) + ' is not on the shelf (stock ' + num(pr.stock) + '). Receive it first.');
  const { bySku } = await products(ctx);
  const cost = round2(num((bySku[sku.toLowerCase()] || {}).cost));
  const txn = 'TXN-' + formatDate(ctx.now, 'yyyyMMdd') + '-' + Math.floor(Math.random() * 9000 + 1000);
  await ctx.tx`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total, reference, note, created_by, created_at, txn_no, operator, product_name)
               values (${ctx.biz}, ${pr.id}, 'ADJUST', 'OUT', 1, ${cost}, ${cost}, 'Opened for printing', ${'spool opened for print jobs' + (str(p.note) ? ' - ' + str(p.note).slice(0, 120) : '')}, ${ctx.s.userId}, ${ctx.now}, ${txn}, ${who(ctx)}, ${str(pr.name)})`;
  const r = (await ctx.tx`insert into filament_spools (business_id, product_id, sku, name, net_g, remaining_g, cost, txn_no, note) values (${ctx.biz}, ${pr.id}, ${str(pr.sku)}, ${str(pr.name)}, ${netG}, ${netG}, ${cost}, ${txn}, ${str(p.note).slice(0, 200) || null}) returning *`)[0];
  delete ctx.memo.catalog; delete ctx.memo.dashProducts;
  const { forget } = await import('../lib/tabs.js'); forget(ctx, 'TXN_LOG');
  return { spool: spoolRow(r), ...(await erpSpools(ctx)) };
}
export async function erpSpoolSet(ctx, payload) {
  const p = payload || {};
  const r = (await ctx.tx`select * from filament_spools where id = ${str(p.id)}::uuid and business_id = ${ctx.biz}`)[0];
  if (!r) throw new Error('No such spool.');
  let remaining = num(r.remaining_g);
  if (p.remainingG !== undefined && p.remainingG !== '') { remaining = round2(num(p.remainingG)); if (remaining < 0 || remaining > num(r.net_g)) throw new Error('Remaining grams should be between 0 and ' + num(r.net_g) + '.'); }
  const finished = p.finished === true || remaining <= 0;
  await ctx.tx`update filament_spools set remaining_g = ${remaining}, finished_at = ${finished ? (r.finished_at || ctx.now) : null} where id = ${r.id}`;
  return erpSpools(ctx);
}
/** Draw grams from a spool; a spool that runs out is finished (remaining stays 0, the shortfall is noted). */
async function drawGrams(ctx, spoolId, grams, jobNo) {
  if (!spoolId || !grams) return;             // negative grams = a correction giving grams back
  const r = (await ctx.tx`select * from filament_spools where id = ${spoolId} and business_id = ${ctx.biz} for update`)[0];
  if (!r) return;
  const left = num(r.remaining_g) - grams;
  await ctx.tx`update filament_spools set remaining_g = ${Math.max(0, round2(left))}, finished_at = ${left <= 0 ? (r.finished_at || ctx.now) : null},
                 note = ${left < 0 ? (str(r.note) ? str(r.note) + ' · ' : '') + 'ran ' + round2(-left) + ' g short on ' + jobNo : r.note} where id = ${r.id}`;
}

// ---------------------------------------------------------------- the cost
/** The true cost of a job and the price to quote: { material, machine, labour, pack, extra, total, failAllowance, suggested }. */
export async function costOf(ctx, p, S, extra) {
  const printer = p.printerId ? (await ctx.tx`select * from printers where id = ${p.printerId}::uuid and business_id = ${ctx.biz}`)[0] : null;
  let perG = 0, materialName = str(p.material);
  if (p.spoolId) {
    const s = (await ctx.tx`select * from filament_spools where id = ${p.spoolId}::uuid and business_id = ${ctx.biz}`)[0];
    if (s) { perG = num(s.net_g) > 0 ? num(s.cost) / num(s.net_g) : 0; materialName = materialName || str(s.name); }
  } else if (str(p.sku)) {
    const { bySku } = await products(ctx);
    const pr = bySku[str(p.sku).toLowerCase()];
    if (pr) { perG = num(pr.cost) / (num(p.netG) > 0 ? num(p.netG) : 1000); materialName = materialName || str(pr.name); }
  }
  const grams = Math.max(0, num(p.grams)), hours = Math.max(0, num(p.hours)), labourMin = Math.max(0, num(p.labourMin));
  const hourly = printer ? (num(printer.life_hours) > 0 ? num(printer.cost) / num(printer.life_hours) : 0) + num(printer.power_w) / 1000 * S.kwh + num(printer.maintenance_hr) : 0;
  const material = round2(grams * perG), machine = round2(hours * hourly), labour = round2(labourMin / 60 * S.labourHr), pack = round2(S.pack), ex = round2(num(extra));
  const base = round2(material + machine + labour + pack + ex);
  const failAllowance = round2((material + machine) * S.failPct / 100);
  const suggested = Math.ceil((base + failAllowance) * (1 + S.marginPct / 100) / 5) * 5;
  return { material, machine, labour, pack, extra: ex, total: base, failAllowance, suggested, perG: round2(perG * 100) / 100, hourly: round2(hourly), materialName, printerName: printer ? str(printer.name) : '' };
}
export async function erpPrintCost(ctx, payload) {
  const p = payload || {};
  return costOf(ctx, { printerId: str(p.printerId), spoolId: str(p.spoolId), sku: str(p.sku), netG: p.netG, grams: p.grams, hours: p.hours, labourMin: p.labourMin, material: p.material }, await settings(ctx), p.extraCost);
}

// ---------------------------------------------------------------- jobs
function jobRow(r, pr, sp) {
  return { id: r.id, jobNo: str(r.job_no), title: str(r.title), customer: str(r.customer), phone: str(r.phone), invoiceNo: str(r.invoice_no), requestId: r.request_id || null,
    printerId: r.printer_id || null, printer: pr ? str(pr.name) : '', spoolId: r.spool_id || null, spool: sp ? str(sp.name) + ' (' + num(sp.remaining_g) + ' g left)' : '', sku: str(r.sku), material: str(r.material),
    plannedG: num(r.planned_g), actualG: num(r.actual_g), failedG: num(r.failed_g), plannedH: num(r.planned_h), actualH: num(r.actual_h), labourMin: num(r.labour_min), extraCost: num(r.extra_cost), price: num(r.price),
    cost: { material: num(r.cost_material), machine: num(r.cost_machine), labour: num(r.cost_labour), pack: num(r.cost_pack), total: num(r.cost_total) }, profit: round2(num(r.price) - num(r.cost_total)),
    status: str(r.status), statusLabel: STATUS[str(r.status)] || str(r.status), open: !!OPEN[str(r.status)], queued: when(r.queued_at), started: when(r.started_at), done: when(r.done_at), delivered: when(r.delivered_at),
    fileName: str(r.file_name), notes: str(r.notes), by: str(r.created_by) };
}
async function jobList(ctx, where) {
  const rows = await ctx.tx`select j.*, p.name as printer_name, s.name as spool_name, s.remaining_g as spool_left from print_jobs j left join printers p on p.id = j.printer_id left join filament_spools s on s.id = j.spool_id
                            where j.business_id = ${ctx.biz} ${where} order by (j.status in ('queued','printing','finishing','ready')) desc, j.queued_at desc limit 400`;
  return rows.map((r) => jobRow(r, r.printer_name ? { name: r.printer_name } : null, r.spool_name ? { name: r.spool_name, remaining_g: r.spool_left } : null));
}
export async function erpPrintJobs(ctx, payload) {
  const want = str(payload && payload.status);
  const all = await jobList(ctx, ctx.tx``);
  const counts = {}; for (const j of all) counts[j.status] = (counts[j.status] || 0) + 1;
  const list = want ? all.filter((j) => j.status === want) : all.filter((j) => j.open || (j.done && Date.now() - new Date(j.done_at || 0).getTime() < 30 * 86400e3) || all.indexOf(j) < 60);
  return { jobs: list.slice(0, 200), counts, statuses: STATUS };
}
export async function erpPrintJob(ctx, payload) {
  const list = await jobList(ctx, ctx.tx`and j.job_no = ${str(payload && payload.jobNo).toUpperCase()}`);
  if (!list.length) throw new Error('No job called ' + str(payload && payload.jobNo) + '.');
  return { job: list[0], statuses: STATUS };
}
export async function erpPrintKit(ctx) {
  const S = await settings(ctx);
  const quoteUrl = quoteUrlOf(ctx);
  const newReq = (await ctx.tx`select count(*)::int as n from print_requests where business_id = ${ctx.biz} and status in ('new', 'accepted')`)[0].n;
  return { settings: S, printers: await printers(ctx), ...(await erpSpools(ctx)), ...(await erpPrintJobs(ctx, {})), quoteUrl, newRequests: num(newReq), canManage: roleAtLeast(ctx.s.role, 'manager') };
}
export async function erpPrintJobSave(ctx, payload) {
  const p = payload || {};
  await lock(ctx, 'printjobs');
  const S = await settings(ctx);
  let r = null;
  if (str(p.jobNo)) {
    r = (await ctx.tx`select * from print_jobs where business_id = ${ctx.biz} and job_no = ${str(p.jobNo).toUpperCase()} for update`)[0];
    if (!r) throw new Error('No job called ' + str(p.jobNo) + '.');
  }
  const f = {};
  const take = (k, col, fn) => { if (p[k] !== undefined) f[col] = fn ? fn(p[k]) : p[k]; };
  take('title', 'title', (v) => str(v).slice(0, 120));
  if (f.title !== undefined && f.title.length < 2) throw new Error('What is being printed? Give the job a title.');
  if (!r && f.title === undefined) throw new Error('What is being printed? Give the job a title.');
  take('customer', 'customer', (v) => str(v).slice(0, 80) || null);
  if (p.phone !== undefined) f.phone = phone11(p.phone) || null;
  if (f.customer !== undefined || f.phone !== undefined) f.customer_key = custKey(f.phone !== undefined ? f.phone : r && r.phone, f.customer !== undefined ? f.customer : r && r.customer) || null;
  take('invoiceNo', 'invoice_no', (v) => str(v).slice(0, 40) || null);
  take('printerId', 'printer_id', (v) => str(v) || null);
  take('spoolId', 'spool_id', (v) => str(v) || null);
  take('sku', 'sku', (v) => str(v).slice(0, 60) || null);
  take('material', 'material', (v) => str(v).slice(0, 60) || null);
  for (const [k, col] of [['plannedG', 'planned_g'], ['actualG', 'actual_g'], ['failedG', 'failed_g'], ['plannedH', 'planned_h'], ['actualH', 'actual_h'], ['extraCost', 'extra_cost'], ['price', 'price']]) {
    if (p[k] !== undefined) { const v = round2(num(p[k])); if (v < 0) throw new Error('A number below zero? ' + k); f[col] = v; }
  }
  if (p.labourMin !== undefined) f.labour_min = Math.max(0, Math.round(num(p.labourMin)));
  take('fileName', 'file_name', (v) => str(v).slice(0, 120) || null);
  take('notes', 'notes', (v) => str(v).slice(0, 2000) || null);
  if (f.printer_id) { const ok = await ctx.tx`select 1 from printers where id = ${f.printer_id}::uuid and business_id = ${ctx.biz}`; if (!ok.length) throw new Error('No such printer.'); }
  if (f.spool_id) { const sp = (await ctx.tx`select * from filament_spools where id = ${f.spool_id}::uuid and business_id = ${ctx.biz}`)[0]; if (!sp) throw new Error('No such spool.'); if (!f.sku && !(r && r.sku)) f.sku = str(sp.sku); if (!f.material && !(r && r.material)) f.material = str(sp.name); }
  // status: where the job goes next
  const was = r ? str(r.status) : '';
  let status = str(p.status) || was || 'queued';
  if (!STATUS[status]) throw new Error('Unknown status.');
  if (was === 'delivered' && status !== 'delivered' && !roleAtLeast(ctx.s.role, 'manager')) throw new Error('A delivered job is reopened by a manager.');
  const merged = { ...(r || {}), ...f, status };
  if (status === 'printing' && !merged.started_at) f.started_at = ctx.now;
  if (['finishing', 'ready', 'failed'].includes(status) && !merged.done_at) f.done_at = ctx.now;
  if (status === 'delivered') { if (!merged.done_at) f.done_at = ctx.now; if (!merged.delivered_at) f.delivered_at = ctx.now; }
  if (status === 'queued') { f.started_at = null; f.done_at = null; f.delivered_at = null; }
  // the true cost: from the actual grams and hours once the print is over, from the plan before
  const over = ['finishing', 'ready', 'delivered', 'failed'].includes(status);
  const grams = over ? num(merged.actual_g) + num(merged.failed_g) : num(merged.planned_g), hours = over ? (num(merged.actual_h) || num(merged.planned_h)) : num(merged.planned_h);
  const c = await costOf(ctx, { printerId: merged.printer_id, spoolId: merged.spool_id, sku: merged.sku, grams, hours, labourMin: merged.labour_min, material: merged.material }, S, merged.extra_cost);
  Object.assign(f, { cost_material: c.material, cost_machine: c.machine, cost_labour: c.labour, cost_pack: c.pack, cost_total: c.total, status, updated_at: ctx.now });
  // grams leave the spool once, when the print is over (the difference if the numbers are corrected later)
  const drawnBefore = r && ['finishing', 'ready', 'delivered', 'failed'].includes(was) ? num(r.actual_g) + num(r.failed_g) : 0;
  const drawNow = over ? grams : 0;
  if (merged.spool_id && drawNow !== drawnBefore) await drawGrams(ctx, merged.spool_id, drawNow - drawnBefore, merged.job_no || 'new job');
  if (r) {
    await ctx.tx`update print_jobs set ${ctx.tx(f)} where id = ${r.id}`;
    // Stage N7: a job that came from the public board is done when it is delivered
    if (status === 'delivered' && was !== 'delivered' && r.request_id) { try { await (await import('./printboard.js')).boardDone(ctx, r.request_id, r.job_no); } catch (e) { console.error('board done', e); } }
    return erpPrintJob(ctx, { jobNo: r.job_no });
  }
  const today = formatDate(ctx.now, 'yyMMdd');
  const n = (await ctx.tx`select count(*)::int n from print_jobs where business_id = ${ctx.biz} and job_no like ${'PJ-' + today + '-%'}`)[0].n + 1;
  const jobNo = 'PJ-' + today + '-' + String(n).padStart(2, '0');
  await ctx.tx`insert into print_jobs ${ctx.tx({ business_id: ctx.biz, job_no: jobNo, created_by: who(ctx), request_id: str(p.requestId) || null, ...f })}`;
  return erpPrintJob(ctx, { jobNo });
}

// ---------------------------------------------------------------- quote requests (the inbox)
function reqRow(r) {
  return { id: r.id, reqNo: str(r.req_no), name: str(r.name), phone: str(r.phone), email: str(r.email), material: str(r.material), colour: str(r.colour), qty: num(r.qty), notes: str(r.notes), link: str(r.link),
    status: str(r.status), price: r.price == null ? null : num(r.price), quoteNote: str(r.quote_note), jobNo: str(r.job_no), sent: when(r.created_at), quoted: when(r.quoted_at), answered: when(r.answered_at) };
}
function quoteUrlOf(ctx) {
  const src = sourceOf(ctx.deps);
  return src ? pubBase(ctx.deps).check.replace(/check$/, '') + 'quote?b=' + encodeURIComponent(src + ':' + ctx.biz) : '';
}
export async function erpPrintRequests(ctx) {
  const rows = await ctx.tx`select * from print_requests where business_id = ${ctx.biz} order by (status in ('new', 'accepted')) desc, created_at desc limit 200`;
  return { requests: rows.map(reqRow), quoteUrl: quoteUrlOf(ctx) };
}
export async function erpPrintRequestAnswer(ctx, payload) {
  const p = payload || {};
  const r = (await ctx.tx`select * from print_requests where id = ${str(p.id)}::uuid and business_id = ${ctx.biz}`)[0];
  if (!r) throw new Error('No such request.');
  if (p.decline) { await ctx.tx`update print_requests set status = 'declined', quote_note = ${str(p.note).slice(0, 500) || null}, quoted_at = now() where id = ${r.id}`; return { status: 'declined' }; }
  const price = round2(num(p.price)); if (!(price > 0)) throw new Error('What is the price?');
  await ctx.tx`update print_requests set status = 'quoted', price = ${price}, quote_note = ${str(p.note).slice(0, 500) || null}, quoted_at = now() where id = ${r.id}`;
  return { status: 'quoted', price };
}
export async function erpPrintRequestJob(ctx, payload) {
  const p = payload || {};
  const r = (await ctx.tx`select * from print_requests where id = ${str(p.id)}::uuid and business_id = ${ctx.biz}`)[0];
  if (!r) throw new Error('No such request.');
  if (r.job_no) throw new Error('This request is already job ' + str(r.job_no) + '.');
  const out = await erpPrintJobSave(ctx, { title: str(p.title) || (num(r.qty) + ' × ' + (str(r.material) || 'print') + ' for ' + str(r.name)), customer: r.name, phone: r.phone, printerId: str(p.printerId), spoolId: str(p.spoolId), sku: str(p.sku),
    material: str(r.material) + (str(r.colour) ? ' ' + str(r.colour) : ''), plannedG: p.plannedG, plannedH: p.plannedH, price: r.price == null ? 0 : num(r.price), notes: ['Request ' + str(r.req_no), str(r.notes), str(r.link) ? 'File: ' + str(r.link) : ''].filter(Boolean).join('\n'), requestId: r.id });
  await ctx.tx`update print_requests set status = 'job', job_no = ${out.job.jobNo}, answered_at = coalesce(answered_at, now()) where id = ${r.id}`;
  return out;
}

// ---------------------------------------------------------------- public: the quote link
const reqToken = (deps, id) => tokenFor(deps, 'public', NIL, 'printreq|' + id);
async function tenantOf(deps, R, b) {
  const m = /^([A-Za-z0-9_-]+):([0-9a-f-]{36})$/i.exec(str(b));
  if (!m) throw new Error('This quote link is not complete.');
  let d = deps;
  if (m[1] !== 'self') { if (!R || !R.tenantDeps) throw new Error('This page is not available right now.'); d = await R.tenantDeps(m[1]); }
  const rows = await R.owners(d.sql, [m[2]]);
  if (!rows.length) throw new Error('This shop is not available right now.');
  return { d, row: rows[0], biz: m[2] };
}
/** fn(ctx) as the business's owner; an error inside comes back as a thrown error. */
async function runAs(d, R, row, label, fn) {
  const out = await R.asBusiness(d, row, label, fn);
  if (out && out.error) throw new Error(out.error);
  return out;
}
export async function quoteView(deps, R, b, ip) {
  await limit(deps, ip, 'printquote', 60);
  const { d, row } = await tenantOf(deps, R, b);
  return runAs(d, R, row, 'pub:quote', async (ctx) => {
    const S = await settings(ctx);
    if (!S.quoteOn) throw new Error('This shop is not taking print requests right now.');
    const materials = {};
    for (const p of await filaments(ctx, true)) { const k = p.type || p.name.split(' ').slice(0, 2).join(' '); (materials[k] = materials[k] || new Set()).add(p.colour); }
    const Q = await import('./sales.js'); const prof = await Q.qProfile(ctx);
    return { shop: { name: str(prof.name) || str(ctx.s.businessName), phone: str(prof.phone), address: str(prof.address) }, text: S.quoteText,
      materials: Object.keys(materials).sort().map((k) => ({ name: k, colours: [...materials[k]].filter(Boolean).sort() })) };
  });
}
export async function quoteSend(deps, R, body, ip) {
  await limit(deps, ip, 'printquote_post', 5);
  const b = body || {};
  const { d, row, biz } = await tenantOf(deps, R, b.b);
  const name = str(b.name).slice(0, 60); if (name.length < 2) throw new Error('Your name.');
  let phone = ''; try { phone = phone11(b.phone); } catch (e) { throw new Error('Your mobile number: ' + e.message); }
  if (!phone) throw new Error('Your mobile number, so the shop can reach you.');
  const email = str(b.email).slice(0, 80).toLowerCase(); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('That e-mail address does not look right.');
  const qty = Math.max(1, Math.min(10000, Math.round(num(b.qty)) || 1));
  const notes = str(b.notes).slice(0, 1500), link = str(b.link).slice(0, 400);
  if (notes.length < 5 && !link) throw new Error('Describe what you want printed, or give a link to the file.');
  if (b.consent !== true) throw new Error('Tick the line: the shop keeps your name and number to answer this request.');
  const out = await runAs(d, R, row, 'pub:quote', async (ctx) => {
    const S = await settings(ctx);
    if (!S.quoteOn) throw new Error('This shop is not taking print requests right now.');
    await lock(ctx, 'printreq');
    const today = formatDate(ctx.now, 'yyMMdd');
    const n = (await ctx.tx`select count(*)::int n from print_requests where business_id = ${ctx.biz} and req_no like ${'PR-' + today + '-%'}`)[0].n + 1;
    const reqNo = 'PR-' + today + '-' + String(n).padStart(2, '0');
    const id = (await ctx.tx`insert into print_requests (business_id, req_no, name, phone, email, material, colour, qty, notes, link, consent)
                              values (${ctx.biz}, ${reqNo}, ${name}, ${phone}, ${email || null}, ${str(b.material).slice(0, 60) || null}, ${str(b.colour).slice(0, 40) || null}, ${qty}, ${notes || null}, ${link || null},
                                      ${ctx.tx.json({ at: new Date().toISOString(), ip: str(ip) })}) returning id`)[0].id;
    const token = await reqToken(deps, id);
    await ctx.tx`update print_requests set token_hash = ${await sha256hex(token)} where id = ${id}`;
    const Q = await import('./sales.js'); const prof = await Q.qProfile(ctx);
    return { reqNo, token, shopPhone: str(prof.phone) };
  });
  const base = pubBase(deps).check.replace(/check$/, '');
  const wa = str(out.shopPhone).replace(/[^0-9]/g, '');
  return { reqNo: out.reqNo, requestUrl: base + 'quote?t=' + out.token + '&b=' + encodeURIComponent(str(b.b)), whatsapp: wa ? 'https://wa.me/' + (wa.startsWith('0') ? '88' + wa : wa) + '?text=' + encodeURIComponent('Print request ' + out.reqNo + ' - I will send the file here.') : '', biz };
}
export async function requestView(deps, R, params, ip) {
  await limit(deps, ip, 'printreq', 60);
  const t = str(params.get('t')), b = params.get('b');
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This link is not complete.');
  const { d, row } = await tenantOf(deps, R, b);
  const h = await sha256hex(t);
  return runAs(d, R, row, 'pub:req', async (ctx) => {
    const r = (await ctx.tx`select * from print_requests where business_id = ${ctx.biz} and token_hash = ${h}`)[0];
    if (!r) throw new Error('This request link is not known.');
    const Q = await import('./sales.js'); const prof = await Q.qProfile(ctx);
    const x = reqRow(r); delete x.id; delete x.email;
    return { ...x, shop: { name: str(prof.name) || str(ctx.s.businessName), phone: str(prof.phone) } };
  });
}
export async function requestAnswer(deps, R, body, ip) {
  await limit(deps, ip, 'printreq', 60);
  const b = body || {}, t = str(b.t);
  if (!/^[A-Za-z0-9_-]{16,32}$/.test(t)) throw new Error('This link is not complete.');
  const { d, row } = await tenantOf(deps, R, b.b);
  const h = await sha256hex(t);
  const action = b.action === 'accept' ? 'accepted' : b.action === 'decline' ? 'declined' : '';
  if (!action) throw new Error('Accept or decline.');
  return runAs(d, R, row, 'pub:req', async (ctx) => {
    const r = (await ctx.tx`select * from print_requests where business_id = ${ctx.biz} and token_hash = ${h}`)[0];
    if (!r) throw new Error('This request link is not known.');
    if (r.status !== 'quoted') throw new Error('There is no open quote to answer on this request.');
    await ctx.tx`update print_requests set status = ${action}, answered_at = now() where id = ${r.id}`;
    return { status: action };
  });
}
/** passport.js pubRoute hands the quote routes here. */
export async function route(deps, R, what, method, params, body, ip) {
  if (what === 'printquote') return method === 'POST' ? quoteSend(deps, R, body, ip) : quoteView(deps, R, params.get('b'), ip);
  if (what === 'printreq') return method === 'POST' ? requestAnswer(deps, R, body, ip) : requestView(deps, R, params, ip);
  return null;
}

export const HANDLERS = { erpPrintKit, erpPrintSettingsSave, erpPrinterSave, erpSpools, erpSpoolOpen, erpSpoolSet, erpPrintCost, erpPrintJobs, erpPrintJob, erpPrintJobSave, erpPrintRequests, erpPrintRequestAnswer, erpPrintRequestJob };
