// Group 'sales': the Sales screen and everything it opens.
//   erpSales            ERP.js:7485-7608
//   erpRecentInvoices   ERP.js:1069-1148
//   erpInvoicePdf       ERP.js:7437-7478
//   erpReturnPreview    ERP.js:7216-7238   (erpInvoiceLines_ 7177, erpReturnedMap_ 7157)
//   erpReturnGoods      ERP.js:7245-7382   (+ erpReturnNotePdf_ 7404-7434)
//   erpCancelInvoice    ERP.js:7723-7817
//   erpFixInvoice       ERP.js:7627-7701   (+ erpInvoiceCopyPdf_ 9098)
//   erpVoidInvoice      ERP.js:1624-1667
//   makeInvoicePdf      erpInvoiceDocPdf_ / erpInvoiceArtPdf_ / erpInvoiceArtParts_ /
//                       erpInvoiceDocData_ (ERP.js:11103-11502), the designed invoice.
//
// Ported line by line over the SALES_LOG-shaped rows from lib/tabs.js.
// A return writes BOTH the RETURNS rows and an RTN- invoice with negative
// lines, exactly as the sheet appended them to SALES_LOG.
//
// Website parcel numbers (erpWebParcelIds_) are kept in a per-business
// in-memory Map for 10 minutes - the sheet's CacheService entry. An Edge
// Function instance lives for minutes, so the cache is at most as good as
// the original's and never shared between businesses.

import { salesLog, returnsTab, courierLog, forget, asDate, str, SL } from '../lib/tabs.js';
import { formatDate, num, round2, dhakaDayStart } from '../lib/time.js';
import { phone11, custKey } from '../lib/phone.js';
import { roleAtLeast } from '../allow.js';
import { ERP_DELIVERY, isCourier } from './catalog.js';
import {
  paidByOrder, addPayment, syncInvoiceStatus, sameOrder, outstanding, discLeft, lock, who,
} from './money.js';
import {
  getSecret, getConfig, httpFetch, saveFile, findFiles, deleteFile, readFile, renderPdf,
} from '../lib/ext.js';
import { products } from './dashboard.js';
import { assertOpen } from '../lib/period.js';
import { returnSerials, serialsOnInvoice } from './serials.js';

const R2 = (v) => Math.round(v * 100) / 100;

/** ERP_PARCEL_FROM (ERP:6301): new Date(2026, 8, 30) in the script's zone, Asia/Dhaka. */
const ERP_PARCEL_FROM = dhakaDayStart('2026-09-30').getTime();

const isReturnId = (id) => /^RTN-/.test(String(id || ''));

/** erpHtml_: & < > only, as the original. */
function esc(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** generateTxnId_ */
function txnId(now) {
  return 'TXN-' + formatDate(now, 'yyyyMMdd') + '-' + (Math.floor(Math.random() * 9000) + 1000);
}

/** The original swallowed errors here; in Postgres a failed statement needs a savepoint. */
async function quietly(ctx, fn) {
  try { return await ctx.tx.savepoint(fn); } catch (_) { return null; }
}

// ------------------------------------------------------------------ readers

/** erpSfBooked_ (ERP:6047): every parcel booked or set aside, by invoice (last row wins). */
async function sfBooked(ctx) {
  const out = {};
  for (const v of await courierLog(ctx)) {
    const inv = str(v[1]);
    if (!inv) continue;
    out[inv] = { consignment: str(v[2]), cod: num(v[6]), when: asDate(v[0]), customer: str(v[3]),
                 byHand: /\[by hand\]/.test(String(v[9] || '')), row: v[10] };
  }
  return out;
}

/** erpReturnedMap_ (ERP:7157): everything already returned, by invoice then sku. */
async function returnedMap(ctx) {
  const map = {};
  for (const v of await returnsTab(ctx)) {
    const inv = str(v[2]);
    if (!inv) continue;
    const m = map[inv] || (map[inv] = { qty: 0, value: 0, bySku: {}, ids: [], cancelled: false });
    if (/^Invoice cancelled/.test(String(v[10] || ''))) m.cancelled = true;
    const sku = str(v[3]).toLowerCase();
    m.qty += num(v[5]);
    m.value += num(v[7]);
    m.bySku[sku] = (m.bySku[sku] || 0) + num(v[5]);
    const rid = str(v[0]);
    if (m.ids.indexOf(rid) < 0) m.ids.push(rid);
  }
  return map;
}

/** erpInvoiceLines_ (ERP:7177): the invoice as sold, with what each unit really cost. */
async function invoiceLines(ctx, invoiceNo) {
  const rows = await salesLog(ctx);
  if (!rows.length) return null;
  const lines = {}, order = [];
  let sum = 0, disc = 0, gross = 0, head = null;
  for (const r of rows) {
    if (str(r[SL.order_id]) !== invoiceNo) continue;
    if (!head) {
      head = { customer: str(r[SL.customer_name]), phone: str(r[SL.customer_contact]),
               address: str(r[SL.customer_address]), method: r[SL.payment_method],
               source: r[SL.customer_source], when: asDate(r[SL.timestamp]) };
    }
    const sku = str(r[SL.sku]);
    const key = sku.toLowerCase();
    if (!lines[key]) {
      lines[key] = { sku, product: str(r[SL.product_name]), qty: 0, total: 0 };
      order.push(key);
    }
    lines[key].qty += num(r[SL.quantity]);
    lines[key].total += num(r[SL.total]);
    sum += num(r[SL.total]);
    if (num(r[SL.total]) > 0) gross += num(r[SL.quantity]) * num(r[SL.unit_price]);
    disc = Math.max(disc, num(r[SL.discount]));
  }
  if (!head) return null;
  disc = discLeft(disc, gross, sum);
  const out = [];
  for (const k of order) {
    const L = lines[k];
    const share = (sum > 0 && disc > 0) ? disc * (L.total / sum) : 0;
    L.unit = L.qty > 0 ? (L.total - share) / L.qty : 0;
    out.push(L);
  }
  return { head, lines: out };
}

// ------------------------------------------------------- website parcel ids

const WEB_CIDS = new Map();      // business id -> { at, map }
const WEB_CIDS_MS = 600 * 1000;

/** For tests: forget the website parcel numbers. */
export function forgetWebParcelIds() { WEB_CIDS.clear(); }

/** czFetch_ (Code:3852): the website sync bridge; throws on anything but 200. */
async function czFetch(ctx, method, path) {
  const key = await getSecret(ctx, 'CZ_SYNC_KEY');
  if (!key) throw new Error('No website sync key is set.');
  const base = await getConfig(ctx, 'website_api', 'https://costareen.com/wp-json/cz/v1');
  const r = await httpFetch(ctx, String(base || 'https://costareen.com/wp-json/cz/v1').replace(/\/+$/, '') + path,
    { method, headers: { 'x-cz-key': key } });
  if (r.code !== 200) throw new Error('Website returned HTTP ' + r.code + ': ' + String(r.text || '').substring(0, 300));
  if (r.json === null) throw new Error('The website did not answer with JSON.');
  return r.json;
}

/** erpWebParcelIds_ (ERP:4255): parcel numbers the website holds, by website order number. */
async function webParcelIds(ctx, rows) {
  let any = false;
  for (const r of rows) if (r.fromSite && !r.consignment) any = true;
  if (!any) return {};
  const hit = WEB_CIDS.get(ctx.biz);
  if (hit && Date.now() - hit.at < WEB_CIDS_MS) return hit.map;
  const r = await czFetch(ctx, 'GET', '/cod?days=45&limit=200');
  const map = {};
  const list = (r && r.orders) || [];
  for (const o of list) {
    if (o && o.consignment) map[String(o.order_no)] = String(o.consignment);
  }
  WEB_CIDS.set(ctx.biz, { at: Date.now(), map });
  return map;
}

// ------------------------------------------------------------------ lists

/** erpRecentInvoices (ERP:1069): the courier's work, newest first. */
export async function erpRecentInvoices(ctx, limit) {
  const sl = await salesLog(ctx);
  const agg = {}, keys = [];
  for (const r of sl) {
    const id = str(r[SL.order_id]);
    if (!id) continue;
    const dt = asDate(r[SL.timestamp]);
    if (!agg[id]) {
      agg[id] = { id, ts: dt ? dt.getTime() : 0,
                  date: dt ? formatDate(dt, 'd MMM yyyy') : '',
                  customer: str(r[SL.customer_name]),
                  phone: str(r[SL.customer_contact]),
                  lines: 0, units: 0, total: 0,
                  method: str(r[SL.payment_method]),
                  status: str(r[SL.payment_status]),
                  source: str(r[SL.customer_source]),
                  note: str(r[SL.notes]) };
      keys.push(id);
    }
    agg[id].lines++;
    agg[id].units += num(r[SL.quantity]);
    agg[id].total += num(r[SL.total]);
  }
  let out = keys.map((k) => agg[k]);
  out.sort((a, b) => b.ts - a.ts);
  let booked = {};
  try { booked = await sfBooked(ctx); } catch (_) { /* as original */ }
  out = out.filter((x) => {
    if (isReturnId(x.id)) return false;
    return isCourier(x.source) || /^WEB-/.test(x.note) || !!booked[x.id];
  });
  out = out.slice(0, limit || 40);

  for (const o of out) {
    o.total = Math.round(o.total);
    const b = booked[o.id];
    o.consignment = b ? b.consignment : '';
    o.handled = !!b;
    o.byHand = !!(b && b.byHand);
    const src = o.source.toLowerCase();
    const fromSite = src === 'website' || src === 'website order' || /^WEB-/.test(o.note);
    const newEnough = o.ts >= ERP_PARCEL_FROM;
    o.postable = newEnough && !b && !fromSite && isCourier(src);
    o.canSend = newEnough && !b && !fromSite;
    o.fromSite = fromSite;
    delete o.ts;
  }

  let webIds = {};
  try { webIds = await webParcelIds(ctx, out); } catch (_) { /* as original */ }
  for (const o of out) {
    if (!o.fromSite || o.consignment) continue;
    const m = /WEB-(\S+)/.exec(o.note);
    if (m && webIds[m[1]]) { o.consignment = webIds[m[1]]; o.webBooked = true; }
  }
  return out;
}

/** erpSales (ERP:7485): every sale, newest first. */
export async function erpSales(ctx, payload) {
  payload = payload || {};
  const q = String(payload.q || '').trim().toLowerCase();
  const filter = String(payload.filter || 'all');
  // all: every matching invoice, for the list view (redesign look 2), which pages itself
  const limit = payload.all ? 1e9 : Math.min(300, Math.max(20, Math.round(num(payload.limit)) || 100));
  // paging (redesign phase 2): skip this many matching invoices first
  const offset = Math.max(0, Math.round(num(payload.offset)) || 0);

  const sl = await salesLog(ctx);
  const agg = {}, order = [];
  for (const r of sl) {
    const id = str(r[SL.order_id]);
    if (!id || isReturnId(id)) continue;
    let o = agg[id];
    if (!o) {
      const dt = asDate(r[SL.timestamp]);
      o = agg[id] = { id, ts: dt ? dt.getTime() : 0,
                      date: dt ? formatDate(dt, 'd MMM yyyy') : '',
                      customer: str(r[SL.customer_name]),
                      phone: str(r[SL.customer_contact]),
                      units: 0, lines: 0, sum: 0, grand: 0, onSheet: 0,
                      method: str(r[SL.payment_method]),
                      delivery: str(r[SL.customer_source]),
                      address: str(r[SL.customer_address]),
                      note: str(r[SL.notes]) };
      order.push(o);
    }
    o.lines++;
    o.units += num(r[SL.quantity]);
    o.sum += num(r[SL.total]);
    o.grand = Math.max(o.grand, num(r[SL.grand_total]));
    o.onSheet = Math.max(o.onSheet, num(r[SL.advance_paid]));
    if (str(r[SL.payment_status]).toLowerCase() === 'paid') o.settled = true;
  }

  const same = sameOrder(sl), group = {};
  for (const o of order) {
    const hd = same[o.id] || o.id;
    const G = group[hd] || (group[hd] = { ids: [], settled: false, onSheet: 0 });
    G.ids.push(o.id);
    if (o.settled) G.settled = true;
    G.onSheet = Math.max(G.onSheet, o.onSheet);
  }

  let paid = {}, back = {}, booked = {};
  try { paid = await paidByOrder(ctx); } catch (_) { /* as original */ }
  try { back = await returnedMap(ctx); } catch (_) { /* as original */ }
  try { booked = await sfBooked(ctx); } catch (_) { /* as original */ }

  order.sort((a, b) => b.ts - a.ts);
  const rows = [], toSend = [], totals = { sold: 0, returned: 0, due: 0 };
  let matched = 0, waiting = 0;
  for (const r of order) {
    const b = booked[r.id] || null;
    const fromSite = /^WEB-/.test(r.note);
    const postable = !b && !fromSite && isCourier(r.delivery) && r.ts >= ERP_PARCEL_FROM;
    const grand = r.grand || r.sum;
    const head = same[r.id] || r.id, grp = group[head];
    let got = 0;
    for (const gid of grp.ids) got += paid[gid] || 0;
    got = Math.max(got, grp.onSheet);
    const due = (grp.settled || head !== r.id) ? 0 : Math.max(0, R2(grand - got));
    if (postable) {
      waiting++;
      toSend.push({ id: r.id, date: r.date, customer: r.customer, phone: r.phone,
                    address: r.address, total: Math.round(grand), collect: Math.round(due) });
    }
    if (q && (r.id + ' ' + r.customer + ' ' + r.phone).toLowerCase().indexOf(q) < 0) continue;
    const rb = back[r.id] || null;
    const retVal = rb ? Math.round(rb.value) : 0;
    if (filter === 'due' && !(due > 0.5)) continue;
    if (filter === 'returned' && !rb) continue;
    if (filter === 'tosend' && !postable) continue;
    if (filter === 'sent' && !(b || fromSite)) continue;
    matched++;
    totals.sold += grand; totals.returned += retVal; totals.due += due;
    if (matched <= offset || rows.length >= limit) continue;
    rows.push({ id: r.id, ts: r.ts, date: r.date, customer: r.customer, phone: r.phone,
                units: r.units, total: Math.round(grand),
                returned: retVal, returnedQty: rb ? rb.qty : 0,
                net: (rb && rb.cancelled) ? 0 : Math.round(grand - retVal),
                due: Math.round(due), delivery: r.delivery, method: r.method,
                allBack: !!(rb && rb.qty >= r.units && r.units > 0),
                cancelled: !!(rb && rb.cancelled),
                address: r.address,
                consignment: b ? b.consignment : '',
                handled: !!b, byHand: !!(b && b.byHand),
                canSend: postable,
                courier: isCourier(r.delivery),
                fromSite });
  }

  if (!payload.all) try {
    const need = rows.filter((x) => x.fromSite && !x.consignment);
    if (need.length) {
      const ids = await webParcelIds(ctx, need.map(() => ({ fromSite: true, consignment: '' })));
      const noteOf = {};
      for (const o of order) noteOf[o.id] = o.note;
      need.forEach((x) => {
        const m = /WEB-(\S+)/.exec(noteOf[x.id] || '');
        if (m && ids[m[1]]) x.consignment = ids[m[1]];
      });
    }
  } catch (_) { /* as original */ }

  toSend.reverse();
  return { rows, matched, shown: rows.length, offset, limit, waiting, toSend,
           totals: { sold: Math.round(totals.sold), returned: Math.round(totals.returned),
                     due: Math.round(totals.due) } };
}

// ------------------------------------------------------------------- returns

/** erpReturnPreview (ERP:7216) */
export async function erpReturnPreview(ctx, payload) {
  const invoiceNo = String((payload && payload.invoiceNo) || '').trim();
  if (!invoiceNo) throw new Error('Which invoice?');
  if (isReturnId(invoiceNo)) throw new Error('That is a return, not a sale.');
  const inv = await invoiceLines(ctx, invoiceNo);
  if (!inv) throw new Error('No invoice called ' + invoiceNo + '.');
  const back = (await returnedMap(ctx))[invoiceNo] || { bySku: {}, value: 0, qty: 0 };
  const money = (await outstanding(ctx, invoiceNo)) || { grand: 0, paid: 0, owed: 0 };
  const role = ctx.s.role;
  const lines = inv.lines.map((L) => {
    const done = back.bySku[L.sku.toLowerCase()] || 0;
    return { sku: L.sku, product: L.product, sold: L.qty, returned: done,
             left: Math.max(0, L.qty - done), unit: R2(L.unit) };
  });
  return { invoiceNo, customer: inv.head.customer, phone: inv.head.phone,
           lines, grand: money.grand, paid: money.paid, owed: money.owed,
           returnedValue: Math.round(back.value),
           canRefund: roleAtLeast(role, 'shareholder'),
           hasAccount: custKey(inv.head.phone, inv.head.customer) !== 'n:' };
}

async function productIdOf(ctx, sku) {
  const r = await ctx.tx`select id from products where business_id = ${ctx.biz}
                         and lower(btrim(sku)) = ${String(sku || '').trim().toLowerCase()} limit 1`;
  return r[0] ? r[0].id : null;
}

/** erpReturnGoods (ERP:7245). opts.inCancel = called by erpCancelInvoice, which holds the lock. */
async function returnGoods(ctx, payload, opts = {}) {
  payload = payload || {};
  const role = ctx.s.role;
  if (!roleAtLeast(role, 'manager')) throw new Error('Your account cannot take returns.');
  const invoiceNo = String(payload.invoiceNo || '').trim();
  if (!invoiceNo) throw new Error('Which invoice?');
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('Say why it came back, so the books can be read later.');
  const asked = payload.lines || [];

  if (!opts.inCancel) await lock(ctx, 'sale');
  const inv = await invoiceLines(ctx, invoiceNo);
  if (!inv) throw new Error('No invoice called ' + invoiceNo + '.');
  const back = (await returnedMap(ctx))[invoiceNo] || { bySku: {} };
  const bySku = {};
  for (const L of inv.lines) bySku[L.sku.toLowerCase()] = L;

  // ---- what is coming back, checked against what was sold
  const take = [];
  let value = 0;
  for (const a of asked) {
    const qty = Math.round(num(a && a.qty));
    if (!(qty > 0)) continue;
    const key = String(a.sku || '').trim().toLowerCase();
    const L = bySku[key];
    if (!L) throw new Error(a.sku + ' is not on invoice ' + invoiceNo + '.');
    const left = L.qty - (back.bySku[key] || 0);
    if (qty > left) {
      throw new Error('Only ' + left + ' of ' + L.product + ' can still come back on ' +
                      invoiceNo + ' (' + L.qty + ' sold, ' + (back.bySku[key] || 0) +
                      ' already returned).');
    }
    const worth = R2(L.unit * qty);
    take.push({ sku: L.sku, product: L.product, qty, worth, unit: L.unit,
                good: String(a.condition || 'good') !== 'damaged' });
    value += worth;
  }
  if (!take.length) throw new Error('Enter how many came back.');
  value = R2(value);

  // ---- the money, decided before anything is written
  const before = (await outstanding(ctx, invoiceNo)) || { owed: 0, paid: 0, grand: 0 };
  const offDue = Math.min(value, before.owed);
  let excess = R2(value - offDue);
  const money = String(payload.money || 'due');
  const ckey = custKey(inv.head.phone, inv.head.customer);
  if (excess > 0.5) {
    if (money !== 'refund' && money !== 'advance') {
      throw new Error('The customer has already paid ' + Math.round(excess) +
                      ' for these goods. Choose: refund it, or keep it as advance.');
    }
    if (money === 'refund' && !roleAtLeast(role, 'shareholder')) {
      throw new Error('Only the owner or a shareholder can hand money back. ' +
                      'Keep it as advance, or ask them.');
    }
    if (money === 'advance' && (!ckey || ckey === 'n:')) {
      throw new Error('An advance needs a customer name or phone to be kept against. ' +
                      'This sale has neither - refund it instead.');
    }
  } else { excess = 0; }

  const now = new Date();
  const st = formatDate(now, 'yyMMddHHmmss');
  let rid = 'RTN-' + st;
  // two returns in the same second would share an id; the table needs it unique
  for (let k = 2; (await ctx.tx`select 1 from invoices where business_id = ${ctx.biz}
                                and invoice_no = ${rid} limit 1`).length; k++) rid = 'RTN-' + st + '-' + k;
  const by = who(ctx);
  const moneyWord = excess > 0 ? (money === 'refund' ? 'refunded ' + excess : 'advance ' + excess)
                               : 'due reduced';

  // plan D1: the numbered units come back to the shelf (or are marked damaged)
  await returnSerials(ctx, invoiceNo, take, asked);

  // ---- 1. the record of the return itself (RETURNS)
  for (const t of take) {
    await ctx.tx`
      insert into returns (business_id, return_no, returned_at, invoice_no, sku, product, qty,
                           condition, value, money, customer, reason, recorded_by)
      values (${ctx.biz}, ${rid}, ${now}, ${invoiceNo}, ${t.sku}, ${t.product}, ${t.qty},
              ${t.good ? 'good' : 'damaged'}, ${t.worth}, ${moneyWord}, ${inv.head.customer},
              ${reason}, ${by})`;
  }

  // ---- 3. the sale reports: an RTN- invoice with negative lines, dated today
  const head = await ctx.tx`
    insert into invoices (business_id, invoice_no, customer_name, customer_phone, customer_address,
      source, subtotal, discount, delivery_charge, grand_total, advance_paid, due_amount,
      payment_method, payment_status, delivery_status, note, created_by, created_at, customer_key)
    values (${ctx.biz}, ${rid}, ${inv.head.customer}, ${inv.head.phone}, '',
      ${inv.head.source == null ? '' : String(inv.head.source)}, 0, 0, 0, 0, 0, 0,
      ${inv.head.method == null ? '' : String(inv.head.method)}, 'Paid', '',
      ${'return of ' + invoiceNo + ' - ' + reason}, ${ctx.s.userId}, ${now},
      ${custKey(inv.head.phone, inv.head.customer)})
    returning id`;
  const rtnId = head[0].id;

  // ---- 2. stock: only what can be sold again goes back (TXN_LOG RETURN IN)
  let restocked = 0;
  for (let s = 0; s < take.length; s++) {
    const t = take[s];
    const pid = await productIdOf(ctx, t.sku);
    const sold = await ctx.tx`
      select l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id
      where i.business_id = ${ctx.biz} and i.invoice_no = ${invoiceNo}
        and lower(btrim(l.sku)) = ${String(t.sku).trim().toLowerCase()} and l.qty > 0
      order by l.line_no limit 1`;
    let costThen = sold[0] && num(sold[0].unit_cost) > 0 ? num(sold[0].unit_cost) : 0;
    if (!costThen) { const pc = (await products(ctx)).bySku[String(t.sku).trim().toLowerCase()]; costThen = pc && pc.cost > 0 ? pc.cost : 0; }
    await ctx.tx`
      insert into invoice_lines (business_id, invoice_id, product_id, sku, name, qty, unit_price,
                                 discount, line_total, line_no, unit_cost)
      values (${ctx.biz}, ${rtnId}, ${pid}, ${t.sku},
              ${t.product + (t.good ? ' (returned)' : ' (returned damaged)')},
              ${t.good ? -t.qty : 0}, ${R2(t.unit)}, 0, ${-t.worth}, ${s + 1}, ${costThen})`;
    if (!t.good) continue;
    if (pid) {
      await ctx.tx`
        insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total,
                                     reference, supplier, note, invoice_id, created_by, created_at,
                                     txn_no, operator, product_name)
        values (${ctx.biz}, ${pid}, 'RETURN', 'IN', ${t.qty}, 0, 0, ${'Return: ' + invoiceNo},
                ${inv.head.customer}, ${rid + ' - ' + reason}, ${rtnId}, ${ctx.s.userId}, ${now},
                ${txnId(now)}, ${by}, ${t.product})`;
    }
    restocked += t.qty;
  }
  forget(ctx, 'SALES_LOG', 'RETURNS', 'TXN_LOG');

  // ---- 4. the money (PAYMENTS)
  await addPayment(ctx, { id: 'R' + st, order: invoiceNo, customer: inv.head.customer, at: now,
                          amount: value, method: 'Returned', note: 'goods returned [return:' + rid + ']', by });
  if (excess > 0 && money === 'refund') {
    await addPayment(ctx, { id: 'R' + st + '-o', order: invoiceNo, customer: inv.head.customer, at: now,
                            amount: -excess, method: String(payload.method || 'Cash'),
                            note: 'refund paid out [return:' + rid + ']', by });
  } else if (excess > 0) {
    await addPayment(ctx, { id: 'R' + st + '-m', order: invoiceNo, customer: inv.head.customer, at: now,
                            amount: -excess, method: 'Advance', note: 'moved to advance [return:' + rid + ']', by });
    await addPayment(ctx, { id: 'R' + st + '-a', order: '', customer: inv.head.customer || inv.head.phone,
                            key: ckey, at: now, amount: excess, method: 'Advance',
                            note: 'from return of ' + invoiceNo + ' [advance] [acct:' + ckey + ']', by });
  }
  await quietly(ctx, () => syncInvoiceStatus(ctx, invoiceNo));

  // ---- 5. a paper for the customer
  let note = { url: '', id: '', name: '' };
  try {
    note = await returnNotePdf(ctx, rid, invoiceNo, inv.head, take, value, offDue, excess, money, reason, now);
  } catch (_) { /* as original */ }

  return { ok: true, returnId: rid, invoiceNo, value,
           units: take.reduce((n, t) => n + t.qty, 0),
           restocked, dueReduced: Math.round(offDue),
           refund: money === 'refund' ? excess : 0,
           advance: money === 'advance' ? excess : 0,
           pdfUrl: note.url, pdfId: note.id, pdfName: note.name };
}

export async function erpReturnGoods(ctx, payload) {
  return returnGoods(ctx, payload);
}

/** erpReturnNotePdf_ (ERP:7404): a one-page return note beside the invoices. */
async function returnNotePdf(ctx, rid, invoiceNo, head, take, value, offDue, excess, money, reason, now) {
  const biz = (ctx.s && ctx.s.businessName) || '';
  const rows = take.map((t) =>
    '<tr><td>' + esc(t.product) + '<br><small>' + esc(t.sku) + '</small></td>' +
    '<td align="right">' + t.qty + '</td><td>' + (t.good ? 'good' : 'damaged') + '</td>' +
    '<td align="right">' + Math.round(t.worth) + '</td></tr>').join('');
  const html = '<html><body style="font-family:Arial,sans-serif;font-size:12px;color:#111">' +
    '<h2 style="margin:0">' + esc(biz) + '</h2>' +
    '<h3 style="margin:4px 0 12px">Return note ' + esc(rid) + '</h3>' +
    '<p>Against invoice <b>' + esc(invoiceNo) + '</b><br>' +
    'Date: ' + formatDate(now, 'd MMM yyyy, h:mm a') + '<br>' +
    'Customer: ' + esc(head.customer) + (head.phone ? ' · ' + esc(head.phone) : '') + '<br>' +
    'Reason: ' + esc(reason) + '</p>' +
    '<table width="100%" cellpadding="6" cellspacing="0" border="1" style="border-collapse:collapse">' +
    '<tr style="background:#eee"><th align="left">Product</th><th align="right">Qty</th>' +
    '<th align="left">Condition</th><th align="right">Value</th></tr>' + rows +
    '<tr><td colspan="3" align="right"><b>Total returned</b></td><td align="right"><b>' +
    Math.round(value) + '</b></td></tr></table>' +
    '<p>' + (offDue > 0 ? 'Taken off what was owed: <b>' + Math.round(offDue) + '</b><br>' : '') +
    (excess > 0 ? (money === 'refund' ? 'Refunded to the customer: <b>' : 'Kept as advance for the next order: <b>') +
      Math.round(excess) + '</b>' : '') + '</p>' +
    '</body></html>';
  const name = 'Return_' + rid + '_' + invoiceNo + '.pdf';
  const bytes = await renderPdf(ctx, html, {});
  const f = await saveFile(ctx, 'invoices', name, bytes, 'application/pdf');
  return { url: f.url, id: f.id, name };
}

// ------------------------------------------------------------------- cancel

/** erpCancelInvoice (ERP:7723): the whole sale comes back, recorded like any return. */
export async function erpCancelInvoice(ctx, payload) {
  payload = payload || {};
  const role = ctx.s.role;
  if (!roleAtLeast(role, 'manager')) throw new Error('Your account cannot cancel a sale.');
  const invoiceNo = String(payload.invoiceNo || '').trim();
  if (!invoiceNo) throw new Error('Which invoice?');
  const reason = String(payload.reason || '').trim();
  if (!reason) throw new Error('Say why the sale is being cancelled.');

  await lock(ctx, 'sale');
  const inv = await invoiceLines(ctx, invoiceNo);
  if (!inv) throw new Error('No invoice called ' + invoiceNo + '.');
  if ((await returnedMap(ctx))[invoiceNo]) {
    throw new Error(invoiceNo + ' already has goods returned against it. Return the rest ' +
                    'with the Return button instead of cancelling.');
  }
  let booked = null;
  try { booked = (await sfBooked(ctx))[invoiceNo] || null; } catch (_) { /* as original */ }
  if (booked && booked.consignment) {
    throw new Error('A parcel (' + booked.consignment + ') is already booked with Steadfast for ' +
                    invoiceNo + '. Cancel it with Steadfast first; when it comes back, take it in ' +
                    'with Return.');
  }

  const before = (await outstanding(ctx, invoiceNo)) || { grand: 0, paid: 0, owed: 0 };
  let goods = 0;
  inv.lines.forEach((L) => { goods += L.unit * L.qty; });
  goods = R2(goods);
  const delivery = Math.max(0, R2(before.grand - goods));
  const paid = R2(before.paid);

  const money = String(payload.money || '');
  const ckey = custKey(inv.head.phone, inv.head.customer);
  if (paid > 0.5) {
    if (money !== 'refund' && money !== 'advance') {
      throw new Error('The customer paid ' + Math.round(paid) + ' for this sale. Choose: refund it, ' +
                      'or keep it as advance.');
    }
    if (money === 'refund' && !roleAtLeast(role, 'shareholder')) {
      throw new Error('Only the owner or a shareholder can hand money back. Keep it as advance, or ask them.');
    }
    if (money === 'advance' && (!ckey || ckey === 'n:')) {
      throw new Error('An advance needs a customer name or phone. This sale has neither - refund it instead.');
    }
  }

  // 1. every product comes back, through the same road as any return
  const res = await returnGoods(ctx, {
    invoiceNo,
    lines: inv.lines.map((L) => ({ sku: L.sku, qty: L.qty,
                                   condition: payload.condition === 'damaged' ? 'damaged' : 'good' })),
    money: paid > delivery + 0.5 ? money : 'due',
    method: payload.method, reason: 'Invoice cancelled - ' + reason,
  }, { inCancel: true });

  // 2. the delivery charge: nothing was delivered, so nothing is owed for it
  const now = new Date(), by = who(ctx);
  const st = formatDate(now, 'yyMMddHHmmss');
  let back2 = 0;
  if (delivery > 0) {
    await addPayment(ctx, { id: 'X' + st, order: invoiceNo, customer: inv.head.customer, at: now,
                            amount: delivery, method: 'Adjusted',
                            note: 'delivery charge cancelled [cancel:' + invoiceNo + ']', by });
    back2 = R2(Math.min(paid, delivery));
    if (back2 > 0) {
      if (money === 'refund') {
        await addPayment(ctx, { id: 'X' + st + '-o', order: invoiceNo, customer: inv.head.customer, at: now,
                                amount: -back2, method: String(payload.method || 'Cash'),
                                note: 'refund of delivery charge [cancel:' + invoiceNo + ']', by });
      } else {
        await addPayment(ctx, { id: 'X' + st + '-m', order: invoiceNo, customer: inv.head.customer, at: now,
                                amount: -back2, method: 'Advance',
                                note: 'delivery charge moved to advance [cancel:' + invoiceNo + ']', by });
        await addPayment(ctx, { id: 'X' + st + '-a', order: '', customer: inv.head.customer || inv.head.phone,
                                key: ckey, at: now, amount: back2, method: 'Advance',
                                note: 'from cancelled ' + invoiceNo + ' [advance] [acct:' + ckey + ']', by });
      }
    }
  }
  await quietly(ctx, () => syncInvoiceStatus(ctx, invoiceNo));
  await ctx.tx`update invoices set cancelled_at = ${now}
               where business_id = ${ctx.biz} and invoice_no = ${invoiceNo}`;
  forget(ctx, 'SALES_LOG');

  const givenBack = R2((res.refund || 0) + (res.advance || 0) + back2);
  return { ok: true, invoiceNo, returnId: res.returnId, units: res.units,
           restocked: res.restocked, goods, delivery, paid,
           refund: money === 'refund' ? givenBack : 0,
           advance: money === 'advance' ? givenBack : 0,
           pdfUrl: res.pdfUrl };
}

// ---------------------------------------------------------------------- fix

/** erpFixInvoice (ERP:7627): who it is for, where it goes, how. Never money or stock. */
export async function erpFixInvoice(ctx, payload) {
  payload = payload || {};
  if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Your account cannot change a saved sale.');
  const invoiceNo = String(payload.invoiceNo || '').trim();
  if (!invoiceNo) throw new Error('Which invoice?');

  await lock(ctx, 'sale');
  const rows = await salesLog(ctx);
  const first = rows.find((r) => str(r[SL.order_id]) === invoiceNo);
  if (!first) throw new Error('No invoice called ' + invoiceNo + '.');

  // field -> [SALES_LOG column, label, invoices column]
  const fields = { name: [SL.customer_name, 'customer', 'customer_name'],
                   phone: [SL.customer_contact, 'phone', 'customer_phone'],
                   address: [SL.customer_address, 'address', 'customer_address'],
                   delivery: [SL.customer_source, 'delivery', 'source'] };
  const changes = [];
  for (const f of Object.keys(fields)) {
    if (payload[f] === undefined || payload[f] === null) continue;
    let now = String(payload[f]).trim();
    const was = str(first[fields[f][0]]);
    if (now === was) continue;
    if (f === 'phone') now = phone11(now);
    if (f === 'name' && !now) throw new Error('A sale needs a customer name.');
    if (f === 'delivery' && ERP_DELIVERY.indexOf(now) < 0) {
      throw new Error('"' + now + '" is not one of the delivery methods.');
    }
    changes.push({ label: fields[f][1], col: fields[f][2], was, now, key: f });
  }
  if (!changes.length) return { ok: true, invoiceNo, changed: 0 };

  let booked = null;
  try { booked = (await sfBooked(ctx))[invoiceNo] || null; } catch (_) { /* as original */ }
  let warn = '';
  if (booked && booked.consignment) {
    for (const c of changes) {
      if (c.key === 'delivery') {
        throw new Error('A parcel (' + booked.consignment + ') is already booked for this sale, ' +
                        'so how it is delivered can no longer be changed.');
      }
    }
    warn = 'The parcel ' + booked.consignment + ' was booked with the old details. ' +
           'Tell Steadfast about the change yourself - this does not reach them.';
  }

  const stampAt = new Date(), by = who(ctx);
  const set = {};
  for (const c of changes) set[c.col] = c.now;
  await ctx.tx`update invoices set ${ctx.tx(set)} where business_id = ${ctx.biz} and invoice_no = ${invoiceNo}`;
  // the invoice's customer key follows its name and phone
  await ctx.tx`update invoices set customer_key = case
                 when length(regexp_replace(coalesce(customer_phone, ''), '[^0-9]', '', 'g')) >= 10
                   then right(regexp_replace(customer_phone, '[^0-9]', '', 'g'), 10)
                 else 'n:' || lower(btrim(coalesce(customer_name, ''))) end
               where business_id = ${ctx.biz} and invoice_no = ${invoiceNo}`;
  for (const c of changes) {
    await ctx.tx`insert into invoice_fixes (business_id, fixed_at, invoice_no, field, was, now, fixed_by)
                 values (${ctx.biz}, ${stampAt}, ${invoiceNo}, ${c.label}, ${c.was}, ${c.now}, ${by})`;
  }
  forget(ctx, 'SALES_LOG');

  let copy = null;
  try { copy = await makeInvoicePdf(ctx, invoiceNo, { corrected: true }); } catch (_) { /* as original */ }
  return { ok: true, invoiceNo, changed: changes.length, warning: warn,
           pdfUrl: copy ? copy.url : '',
           fields: changes.map((x) => x.label) };
}

// --------------------------------------------------------------------- void

/** erpVoidInvoice (ERP:1624): remove the invoice and its stock movements. Owner only. */
export async function erpVoidInvoice(ctx, invoiceNo) {
  const no = String(invoiceNo || '').trim();
  if (!no) throw new Error('Type the invoice number to void.');
  await lock(ctx, 'sale');
  const lines = await ctx.tx`
    select l.qty, l.line_total from invoice_lines l join invoices i on i.id = l.invoice_id
    where i.business_id = ${ctx.biz} and i.invoice_no = ${no}`;
  const inv = await ctx.tx`select id from invoices where business_id = ${ctx.biz} and invoice_no = ${no}`;
  const sold = (await salesLog(ctx)).find((r) => str(r[SL.order_id]) === no);
  if (sold && asDate(sold[SL.timestamp])) await assertOpen(ctx, asDate(sold[SL.timestamp]), 'its sales cannot be removed. Cancel the invoice instead: that takes the goods back today');
  const txn = await ctx.tx`select id from stock_movements where business_id = ${ctx.biz}
                           and (btrim(reference) = ${'Invoice: ' + no} or btrim(reference) = ${no})`;
  if (!lines.length && !txn.length) throw new Error('Nothing found for invoice ' + no + '.');
  let units = 0, value = 0;
  for (const l of lines) { units += num(l.qty); value += num(l.line_total); }
  if (inv.length) await ctx.tx`delete from invoices where id = any(${inv.map((r) => r.id)})`;
  if (txn.length) await ctx.tx`delete from stock_movements where id = any(${txn.map((r) => r.id)})`;
  forget(ctx, 'SALES_LOG', 'TXN_LOG');
  return { ok: true, invoiceNo: no, salesLines: lines.length, txnLines: txn.length,
           units, value: Math.round(value) };
}

// ---------------------------------------------------------------- the PDF

/** erpInvoicePdf (ERP:7437): the saved PDF of an invoice, and its return notes. */
export async function erpInvoicePdf(ctx, payload) {
  const invoiceNo = String((payload && payload.invoiceNo) || '').trim();
  if (!invoiceNo) throw new Error('Which invoice?');
  if (!ctx.deps || !ctx.deps.storage) return { found: false, why: 'No invoice folder is set up for this business.' };

  const f = (await findFiles(ctx, 'invoices', 'Invoice_' + invoiceNo))[0] || null;
  const notes = (await findFiles(ctx, 'invoices', invoiceNo))
    .filter((n) => n.name.indexOf('Return_') >= 0)
    .map((n) => ({ name: n.name, url: n.url, id: n.id }));
  if (!f) {
    let made = null;
    try { made = await makeInvoicePdf(ctx, invoiceNo, {}); } catch (_) { /* as original */ }
    if (made) return { found: true, url: made.url, id: made.id, name: made.name, notes, made: true };
    return { found: false, why: 'No PDF was saved for ' + invoiceNo + '.', notes };
  }
  // A copy saved before the invoice was redesigned (Drive description not
  // "designed 2"; here: the invoice is not marked pdf_designed) is drawn again.
  let plain = false;
  try {
    const r = await ctx.tx`select pdf_designed from invoices where business_id = ${ctx.biz}
                           and invoice_no = ${invoiceNo} limit 1`;
    plain = !!(r[0] && !r[0].pdf_designed);
  } catch (_) { /* as original */ }
  if (plain) {
    let again = null;
    try { again = await makeInvoicePdf(ctx, invoiceNo, { corrected: /_corrected_/.test(f.name) }); } catch (_) { /* as original */ }
    if (again) {
      if (again.name !== f.name) { try { await deleteFile(ctx, 'invoices', f.name); } catch (_) { /* bin */ } }
      return { found: true, url: again.url, id: again.id, name: again.name, notes, made: true };
    }
  }
  return { found: true, url: f.url, id: f.id, name: f.name, notes };
}

/** erpInvoiceDocData_ (ERP:11119): everything the page says, from the sales log. */
async function invoiceDocData(ctx, invoiceNo) {
  const sl = await salesLog(ctx);
  const lines = [];
  let head = null, disc = 0, delivery = 0, grand = 0, note = '';
  for (const r of sl) {
    if (str(r[SL.order_id]) !== invoiceNo) continue;
    if (!head) {
      head = { customer: str(r[SL.customer_name]), phone: str(r[SL.customer_contact]),
               address: str(r[SL.customer_address]), when: asDate(r[SL.timestamp]),
               method: str(r[SL.payment_method]), source: str(r[SL.customer_source]) };
    }
    const qty = num(r[SL.quantity]), total = num(r[SL.total]);
    let price = num(r[SL.unit_price]);
    if (!(price > 0) && qty > 0) price = total / qty;
    lines.push({ sku: str(r[SL.sku]), product: str(r[SL.product_name]), qty, price, total,
                 gross: qty * price, serials: [] });
    disc = Math.max(disc, num(r[SL.discount]));
    delivery = Math.max(delivery, num(r[SL.delivery_charge]));
    grand = Math.max(grand, num(r[SL.grand_total]));
    if (!note) note = String(r[SL.notes] || '');
  }
  if (!head) return null;
  const sn = await serialsOnInvoice(ctx, invoiceNo);
  lines.forEach((l) => { l.serials = sn[l.sku.toLowerCase()] || []; });
  let gross = 0, sum = 0;
  lines.forEach((l) => { gross += l.gross; sum += l.total; });
  const inside = Math.max(0, gross - sum);
  const totalDisc = R2(inside + discLeft(disc, gross, sum));
  let itemDisc = totalDisc, invDisc = 0;
  const m = /\[discount: items (\d+) \+ invoice (\d+)\]/.exec(note);
  if (m && Math.abs(Number(m[1]) + Number(m[2]) - totalDisc) <= 1) { itemDisc = Number(m[1]); invDisc = Number(m[2]); }
  if (!(grand > 0)) grand = gross - totalDisc + delivery;
  if (!(delivery > 0) && grand - (gross - totalDisc) > 0.5) delivery = grand - (gross - totalDisc);
  const perLine = totalDisc > 0.5 && invDisc === 0 && inside > 0.5;
  const money = (await outstanding(ctx, invoiceNo)) || { paid: 0, owed: 0 };
  return { invoiceNo, head, lines, gross: R2(gross), itemDisc, invDisc,
           totalDisc, delivery: R2(delivery), grand: R2(grand),
           paid: money.paid, due: money.owed, perLine };
}

/** QUOTE_SETTINGS key -> parsed value (the quotes group writes these). */
async function quoteSetting(ctx, key) {
  const r = await ctx.tx`select value from quote_settings where business_id = ${ctx.biz} and key = ${key}`;
  let v = r[0] ? r[0].value : null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { /* as is */ } }
  return v && typeof v === 'object' ? v : {};
}

/** erpQProfile_ (ERP:9211) */
async function qProfile(ctx) {
  const p = { ...(await quoteSetting(ctx, 'profile')) };
  if (!p.name) {
    try { p.name = str(await getConfig(ctx, 'business_name', '')); } catch (_) { /* as original */ }
  }
  return { name: p.name || '', address: p.address || '', email: p.email || '', phone: p.phone || '',
           website: p.website || '', footer: p.footer || '', signer: p.signer || '',
           designation: p.designation || '', logoId: p.logoId || '', signatureId: p.signatureId || '',
           qrId: p.qrId || '', banks: p.banks || [], logoTrimId: p.logoTrimId || '' };
}

const ERP_Q_DEFAULTS = { version: 0, prefix: 'QUO', currency: 'BDT', validDays: 15, autoNumber: true,
  theme: 'Signature', accent: '#dda51c', dark: '#303030', font: 'Arial', fontSize: 'Comfortable',
  productTerms: '', serviceTerms: '', mixedTerms: '' };

/** erpQSettings_ (ERP:9231) */
async function qSettings(ctx) {
  const s = await quoteSetting(ctx, 'settings'), out = {};
  for (const k of Object.keys(ERP_Q_DEFAULTS)) {
    out[k] = Object.prototype.hasOwnProperty.call(s, k) ? s[k] : ERP_Q_DEFAULTS[k];
  }
  return out;
}

function b64(bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

function sniff(b) {
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b.length > 6 && b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
      b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return '';
}

/** erpDocImg_ (ERP:11103, asItIs): one of this business's own images as a data: address, or ''. */
async function docImg(ctx, id) {
  id = String(id || '');
  if (!id) return '';
  try {
    const raw = await readFile(ctx, 'assets', id);
    if (!raw) return '';
    const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(raw);
    const type = sniff(bytes);
    if (!type) return '';
    return 'data:' + type + ';base64,' + b64(bytes);
  } catch (_) { return ''; }
}

/** erpTint_ */
function tint(hex, t) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return '#cccccc';
  let out = '#';
  for (let i = 1; i <= 3; i++) {
    const v = Math.round(parseInt(m[i], 16) + (255 - parseInt(m[i], 16)) * t).toString(16);
    out += v.length < 2 ? '0' + v : v;
  }
  return out;
}

/** erpIsDark_ */
function isDark(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return true;
  return (parseInt(m[1], 16) * 299 + parseInt(m[2], 16) * 587 + parseInt(m[3], 16) * 114) / 1000 < 165;
}

/** erpInvoiceArtParts_ (ERP:11300): the designed page and its foot, as HTML. */
export function invoiceArtParts(d, p, s, opt, img, now = new Date()) {
  opt = opt || {}; img = img || {};
  const accent = /^#[0-9a-fA-F]{6}$/.test(String(s.accent)) ? s.accent : '#dda51c';
  const dark = /^#[0-9a-fA-F]{6}$/.test(String(s.dark)) ? s.dark : '#303030';
  const cur = String(s.currency || 'BDT');
  const h = esc;
  const n = (v) => String(Math.round(num(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const a1 = accent, a2 = tint(accent, 0.35), a3 = tint(accent, 0.62), a4 = tint(accent, 0.84), a5 = tint(accent, 0.93);
  const d2 = tint(dark, 0.25), d5 = tint(dark, 0.93);
  const onAccent = isDark(accent) ? '#ffffff' : dark;
  const biz = String(p.name || '').trim();
  const when = d.head.when ? formatDate(d.head.when, 'd MMMM yyyy') : '';
  const paidUp = !(d.due > 0.5);
  const banks = (p.banks || []).filter((b) => String(b.bank || b.number || '').trim()).slice(0, 3);

  const css =
    '@page{size:A4;margin:13mm 0 31mm 0}@page :first{margin-top:0}' +
    '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}' +
    'html,body{margin:0;padding:0}' +
    'body{font-family:Inter,"Noto Sans Bengali","Noto Sans",Arial,sans-serif;font-size:10.5pt;color:#22262e;line-height:1.45}' +
    '.top{position:relative;height:43mm;overflow:hidden}' +
    '.top svg{position:absolute;left:0;top:0;width:100%;height:100%}' +
    '.logo{position:absolute;left:16mm;top:8mm;height:27mm}' +
    '.ttl{position:absolute;top:11mm;font-size:38pt;font-weight:300;letter-spacing:1.5pt;color:#101318;line-height:1}' +
    '.brand{position:absolute;top:27.5mm;font-size:11.5pt;font-weight:700;color:' + dark + '}' +
    '.owed{position:absolute;right:16mm;top:12mm;text-align:right;color:' + onAccent + '}' +
    '.owed b{display:block;font-size:22pt;font-weight:600;line-height:1.1}.owed span{font-size:13pt;font-weight:400}' +
    '.wrap{padding:0 16mm}' +
    '.two{display:flex;justify-content:space-between;gap:10mm}' +
    '.kv{display:grid;grid-template-columns:27mm auto;row-gap:1mm;font-size:10pt}.kv b{font-weight:700}' +
    '.h{font-weight:700;font-size:10.5pt;margin-bottom:1.5mm}' +
    '.muted{color:#5d6672}' +
    '.right{text-align:right}' +
    'table.items{width:100%;border-collapse:collapse;margin-top:4mm}' +
    'table.items th{font-size:9.5pt;font-weight:700;text-align:left;padding:1.8mm 3mm;border:0.3mm solid #b9bec6;background:#ffffff}' +
    'table.items td{font-size:10pt;padding:1.5mm 3mm;border:0.3mm solid #c9cdd4;vertical-align:top;background:rgba(255,255,255,.72)}' +
    'table.items tr{break-inside:avoid}' +
    'table.items thead{display:table-header-group}' +
    '.c{text-align:center}.r{text-align:right;white-space:nowrap}' +
    '.tail{break-inside:avoid}.end{display:flex;justify-content:space-between;gap:10mm;margin-top:4mm}' +
    '.sum{width:66mm;border-collapse:collapse;flex:0 0 66mm;align-self:flex-start}' +
    '.sum td{padding:1.35mm 2.8mm;border:0.3mm solid #b9bec6;font-size:9.5pt}' +
    '.sum td:first-child{background:' + d2 + ';color:#fff;font-weight:600;width:33mm;white-space:nowrap}' +
    '.sum td:last-child{background:' + d5 + ';text-align:right}' +
    '.sum tr.tot td:first-child{background:' + dark + '}.sum tr.tot td:last-child{font-weight:700;font-size:10.5pt;background:' + a4 + '}' +
    '.sum tr.due td:first-child{background:#b3261e}.sum tr.due td:last-child{color:#b3261e;font-weight:700;font-size:10.5pt;background:#fdeceb}' +
    '.sum tr.ok td:first-child{background:#1e7d46}.sum tr.ok td:last-child{color:#1e7d46;font-weight:700;background:#e8f5ec}' +
    '.pay{flex:1;min-width:0;font-size:9.5pt;display:flex;gap:6mm;align-items:flex-start}' +
    '.bank{display:grid;grid-template-columns:21mm auto;row-gap:.5mm;margin-bottom:2.5mm}.bank .bn{grid-column:1/-1;font-weight:700;font-size:10pt}' +
    '.qr{text-align:center;font-size:8pt;flex:0 0 auto}.qr img{display:block;width:25mm;height:25mm;border:0.3mm solid #c9cdd4;padding:1mm;background:#fff;margin:0 auto 1mm}' +
    '.note{margin-top:3mm;font-size:9pt;color:#5d6672}' +
    '.stamp{display:inline-block;border:0.5mm solid #b3261e;color:#b3261e;font-weight:700;font-size:9pt;padding:.8mm 2.5mm;border-radius:1mm;margin-top:2mm}';

  const topArt = '<svg viewBox="0 0 210 43" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M0 0H210V30C180 44 150 20 118 27C100 31 88 22 70 0Z" fill="' + a5 + '"/>' +
    '<path d="M70 0H210V40C196 44 182 36 166 30C146 22 132 30 114 22C98 15 88 6 70 0Z" fill="' + a4 + '"/>' +
    '<path d="M96 0H210V36C198 30 190 18 172 17C150 16 142 26 124 18C112 13 106 4 96 0Z" fill="' + a3 + '"/>' +
    '<path d="M128 0H210V30C202 34 192 30 184 24C172 15 160 20 148 13C139 8 134 3 128 0Z" fill="' + a2 + '"/>' +
    '<path d="M126 0H210V33C202 35 192 32 182 30C166 27 150 27 141 17C136 11 131 5 126 0Z" fill="' + a1 + '"/></svg>';

  let body = '<div class="top">' + topArt +
    (img.logo ? '<img class="logo" src="' + img.logo + '">' : '') +
    '<div class="ttl" style="left:' + (img.logo ? '50mm' : '16mm') + '">INVOICE</div>' +
    '<div class="brand" style="left:' + (img.logo ? '50.5mm' : '16mm') + '">' + h(biz) + '</div>' +
    '<div class="owed"><b>' + h(cur) + ' ' + n(paidUp ? d.grand : d.due) + '</b><span>' + (paidUp ? 'Paid in full' : 'Total due') + '</span></div></div>' +

    '<div class="wrap"><div class="two"><div class="kv">' +
      '<b>Invoice no.</b><span>' + h(d.invoiceNo) + '</span>' +
      '<b>Date</b><span>' + h(when) + '</span>' +
      (d.head.method ? '<b>Payment</b><span>' + h(d.head.method) + '</span>' : '') +
      (d.head.source ? '<b>Delivery</b><span>' + h(d.head.source) + '</span>' : '') + '</div>' +
    '<div class="right" style="max-width:86mm"><div class="h">From</div><div>' + h(biz) + '</div>' +
      '<div class="muted" style="font-size:9.5pt">' + (p.address ? h(p.address).replace(/\n/g, '<br>') : '') + '</div>' +
      (opt.corrected ? '<div class="stamp">CORRECTED COPY · ' + formatDate(now, 'd MMM yyyy') + '</div>' : '') + '</div></div>' +

    '<div class="two" style="margin-top:4mm"><div><div class="h">Bill To</div>' +
      '<div style="font-size:12pt;font-weight:700">' + h(d.head.customer || 'Walk-in customer') + '</div>' +
      (d.head.phone ? '<div>' + h(d.head.phone) + '</div>' : '') + '</div>' +
    (String(d.head.address || '').trim() ? '<div class="right" style="max-width:86mm"><div class="h">Deliver To</div><div>' + h(d.head.address).replace(/\n/g, '<br>') + '</div></div>' : '') + '</div>' +

    '<table class="items"><thead><tr><th class="c" style="width:11mm">#</th><th>Item Description</th><th class="c" style="width:15mm">Qty</th><th class="r" style="width:24mm">Price</th>' +
      (d.perLine ? '<th class="r" style="width:24mm">Discount</th>' : '') + '<th class="r" style="width:28mm">Total</th></tr></thead><tbody>' +
    d.lines.map((l, li) => {
      const off = Math.max(0, l.gross - l.total);
      const sn = (l.serials || []).length ? '<div style="font-size:8.5pt;color:#555;margin-top:1mm">S/N ' + l.serials.map((x) => h(x.serial)).join(', ') +
        (l.serials[0].warrantyUntil ? ' · warranty until ' + h(l.serials[0].warrantyUntil) : '') + '</div>' : '';
      return '<tr><td class="c">' + (li + 1) + '</td><td>' + h(l.product) + sn + '</td><td class="c">' + n(l.qty) + '</td>' +
        '<td class="r">' + n(l.price) + '</td>' + (d.perLine ? '<td class="r">' + (off > 0.5 ? '−' + n(off) : '') + '</td>' : '') +
        '<td class="r">' + n(d.perLine ? l.total : l.gross) + '</td></tr>';
    }).join('') + '</tbody></table>' +

    '<div class="tail"><div class="end"><div class="pay">';
  if (banks.length || img.qr) {
    body += '<div><div class="h">Payment Details</div>' + banks.map((b) =>
      '<div class="bank"><span class="bn">' + h(b.bank || 'Bank') + '</span>' +
        '<span class="muted">A/C name</span><span>' + (h(b.name) || '—') + '</span>' +
        '<span class="muted">A/C number</span><span><b>' + (h(b.number) || '—') + '</b></span>' +
        (b.branch ? '<span class="muted">Branch</span><span>' + h(b.branch) + '</span>' : '') +
        (b.extra ? '<span class="muted">Note</span><span>' + h(b.extra) + '</span>' : '') + '</div>').join('') + '</div>' +
    (img.qr ? '<div class="qr"><img src="' + img.qr + '"><b>Bangla QR</b><br><span class="muted">any bank app, bKash,<br>Nagad or Rocket</span></div>' : '');
  }
  body += '</div><table class="sum">' +
    '<tr><td>Subtotal</td><td>' + n(d.gross) + '</td></tr>' +
    (d.invDisc > 0.5 ? (d.itemDisc > 0.5 ? '<tr><td>Item discounts</td><td>− ' + n(d.itemDisc) + '</td></tr>' : '') + '<tr><td>Invoice discount</td><td>− ' + n(d.invDisc) + '</td></tr>'
                     : (d.totalDisc > 0.5 ? '<tr><td>Discount</td><td>− ' + n(d.totalDisc) + '</td></tr>' : '')) +
    (d.delivery > 0.5 ? '<tr><td>Delivery</td><td>' + n(d.delivery) + '</td></tr>' : '') +
    '<tr class="tot"><td>Total</td><td>' + h(cur) + ' ' + n(d.grand) + '</td></tr>' +
    '<tr><td>Paid</td><td>' + n(d.paid) + '</td></tr>' +
    (paidUp ? '<tr class="ok"><td>Due</td><td>Nothing due</td></tr>' : '<tr class="due"><td>Due</td><td>' + h(cur) + ' ' + n(d.due) + '</td></tr>') +
    '</table></div>' +
    '<div class="note">' + h(p.footer || 'Thank you for your order.') + '</div></div></div>';

  const html = '<!doctype html><html><head><meta charset="utf-8"><style>' + css + '</style></head><body>' + body + '</body></html>';

  const ico = (path) => '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#ffffff" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" style="flex:0 0 auto">' + path + '</svg>';
  const cell = (icon, lines) => {
    lines = lines.filter((x) => String(x || '').trim());
    return lines.length ? '<div style="display:flex;align-items:center;gap:7px">' + icon + '<div>' + lines.map((x) => h(x)).join('<br>') + '</div></div>' : '';
  };
  const addr = String(p.address || '').split(/\n/);
  const footer = '<div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;width:100%;height:31mm;position:relative;margin:0;font-family:Inter,\'Noto Sans\',Arial,sans-serif;font-size:8.5pt;font-weight:600;color:#ffffff;line-height:1.5">' +
    '<svg viewBox="0 0 210 31" preserveAspectRatio="none" xmlns="http://www.w3.org/2000/svg" style="position:absolute;left:0;top:0;width:100%;height:100%">' +
    '<path d="M0 8C20 2 38 8 60 6C88 3 104 10 132 7C160 4 184 0 210 4V31H0Z" fill="' + a4 + '"/>' +
    '<path d="M0 11C26 5 44 12 70 9C98 6 118 13 146 10C172 7 192 5 210 8V31H0Z" fill="' + a2 + '"/>' +
    '<path d="M0 14C30 9 52 15 82 12C112 9 136 16 164 13C184 11 198 10 210 11V31H0Z" fill="' + dark + '"/></svg>' +
    '<div style="position:absolute;left:16mm;right:16mm;bottom:3.5mm;display:flex;justify-content:space-between;align-items:center;gap:8mm">' +
    cell(ico('<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8.1 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2z"/>'), String(p.phone || '').split(/\s*[,/]\s*/).slice(0, 2)) +
    cell(ico('<circle cx="12" cy="12" r="10"/><path d="M2 12h20M12 2a15 15 0 0 1 0 20M12 2a15 15 0 0 0 0 20"/>'), [p.email, p.website]) +
    cell(ico('<path d="M21 10c0 7-9 13-9 13S3 17 3 10a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>'), [addr[0], addr.slice(1).join(', ')]) +
    '</div></div>';
  return { html, footer };
}

/**
 * erpInvoiceDocPdf_ (ERP:11480): draw the designed invoice and save it beside
 * the others. Returns { id, url, name } or null when there is no such invoice.
 * opts.corrected -> Invoice_<no>_corrected_yyMMdd-HHmm.pdf with the red stamp.
 */
export async function makeInvoicePdf(ctx, invoiceNo, opts = {}) {
  opts = opts || {};
  invoiceNo = String(invoiceNo || '').trim();
  const now = new Date();
  const name = 'Invoice_' + invoiceNo + (opts.corrected ? '_corrected_' + formatDate(now, 'yyMMdd-HHmm') : '') + '.pdf';
  const d = await invoiceDocData(ctx, invoiceNo);
  if (!d) return null;
  const p = await qProfile(ctx), s = await qSettings(ctx);
  if (!String(p.name || '').trim()) p.name = (ctx.s && ctx.s.businessName) || '';
  const img = { logo: (await docImg(ctx, p.logoTrimId)) || (await docImg(ctx, p.logoId)),
                qr: await docImg(ctx, p.qrId) };
  const parts = invoiceArtParts(d, p, s, opts, img, now);
  const bytes = await renderPdf(ctx, parts.html, { footer: parts.footer });
  const f = await saveFile(ctx, 'invoices', name, bytes, 'application/pdf');
  await quietly(ctx, () => ctx.tx`update invoices set pdf_path = ${f.id || name}, pdf_url = ${f.url},
                                   pdf_designed = true
                                   where business_id = ${ctx.biz} and invoice_no = ${invoiceNo}`);
  return { id: f.id, url: f.url, name };
}

export const HANDLERS = {
  erpSales,
  erpRecentInvoices,
  erpInvoicePdf,
  erpReturnPreview,
  erpReturnGoods,
  erpCancelInvoice,
  erpFixInvoice,
  erpVoidInvoice,
};
