// Website orders and the courier report (ERP.js:1507-1612, 1900-1925,
// 5759-5900, 10641-10744, 11505-11528) and the website sync itself
// (Code.js:3852-4001): pull new orders, push stock.
//
// The WEB_ORDERS tab (one row per order LINE) is web_orders (one per order)
// + web_order_lines; webOrdersTab() hands the ported code the same rows in
// the same column order, so each function reads like the original.

import { salesLog, asDate, str, forget, SL } from '../lib/tabs.js';
import { formatDate, num, dhakaDayStart, DAY_MS } from '../lib/time.js';
import { formatBdPhone } from '../lib/phone.js';
import { getSecret, getConfig, httpFetch } from '../lib/ext.js';
import { erpCatalog } from './catalog.js';
import { createInvoice } from './invoice.js';
import { lock, who } from './money.js';

export const WEBSITE_API = 'https://costareen.com/wp-json/cz/v1';
const LOOKBACK_DAYS = 7;

// WEB_ORDERS columns (Code.js:3873) + where the row lives
export const WO = {
  pulled_at: 0, order_date: 1, order_no: 2, status: 3, sku: 4, product: 5, qty: 6,
  line_total: 7, customer: 8, phone: 9, address: 10, payment: 11, order_total: 12,
  entered_in_sheet: 13, manager_note: 14,
  order_id: 15, line_id: 16,
};

/** WEB_ORDERS as rows, in the order they were pulled. */
export async function webOrdersTab(ctx) {
  const k = 'tab:WEB_ORDERS';
  if (!ctx.memo[k]) {
    ctx.memo[k] = await ctx.tx`
      select l.pulled_at, coalesce(o.order_date_text, ''), o.order_no,
             coalesce(l.status, o.status, ''), l.sku, l.product_name, l.qty, l.line_total,
             o.customer_name, o.customer_phone, o.customer_address, o.payment, o.order_total,
             case when l.entered then 'Yes' else 'No' end, coalesce(o.manager_note, ''),
             o.id, l.id
      from web_order_lines l join web_orders o on o.id = l.web_order_id
      where l.business_id = ${ctx.biz}
      order by l.seq`.values();
  }
  return ctx.memo[k];
}

/** Tick lines (and so their orders) as entered in the books. */
async function markEntered(ctx, lineIds, invoiceId) {
  if (!lineIds.length) return;
  await ctx.tx`update web_order_lines set entered = true
               where business_id = ${ctx.biz} and id = any(${lineIds}::uuid[])`;
  await ctx.tx`update web_orders o set entered = true,
                 invoice_id = coalesce(${invoiceId || null}::uuid, o.invoice_id)
               where o.business_id = ${ctx.biz}
                 and o.id in (select web_order_id from web_order_lines where id = any(${lineIds}::uuid[]))`;
  forget(ctx, 'WEB_ORDERS');
}

// ------------------------------------------------------------- the website

/** czFetch_ (Code.js:3852): one call to the website's sync bridge. */
async function czFetch(ctx, method, path, payload) {
  const key = await getSecret(ctx, 'CZ_SYNC_KEY');
  if (!key) throw new Error('Website sync key not set. Run "Setup Website Sync" from the menu first.');
  const base = String((await getConfig(ctx, 'website_api', WEBSITE_API)) || WEBSITE_API).trim().replace(/\/+$/, '');
  const headers = { 'x-cz-key': key };
  if (payload) headers['Content-Type'] = 'application/json';
  const r = await httpFetch(ctx, base + path, { method, headers, body: payload ? JSON.stringify(payload) : undefined });
  if (r.code === 0) throw new Error(r.text);
  if (r.code !== 200) throw new Error('Website returned HTTP ' + r.code + ': ' + r.text.substring(0, 300));
  return JSON.parse(r.text);
}

/**
 * pullWebOrders (Code.js:3905): new website orders into WEB_ORDERS. Re-scans
 * a whole week every time and de-duplicates on order|sku, so a missed run
 * can never lose an order. Returns { ok, fetched, added }.
 */
export async function pullWebOrders(ctx) {
  await lock(ctx, 'website');
  const since = new Date(Date.now() - LOOKBACK_DAYS * DAY_MS);
  const iso = since.toISOString().slice(0, 19);
  const res = await czFetch(ctx, 'GET', '/orders?limit=100&since=' + encodeURIComponent(iso));

  const seen = {};
  for (const r of await webOrdersTab(ctx)) {
    seen[str(r[WO.order_no]) + '|' + str(r[WO.sku])] = true;
  }

  const items = (res && res.items) || [];
  let added = 0;
  const orderIds = {};
  for (const it of items) {
    // fix (docs/fixes/expenses_web.md): a line with no SKU is stored as
    // '(no sku)', so it is looked for under that name too
    const sku = str(it.sku) || '(no sku)';
    const no = str(it.number);
    const key = no + '|' + sku;
    if (seen[key]) continue;
    seen[key] = true;

    let oid = orderIds[no];
    if (!oid) {
      const created = it.created == null ? '' : String(it.created);
      const at = asDate(created);
      const ins = await ctx.tx`
        insert into web_orders (business_id, order_no, order_date, order_date_text, status,
                                customer_name, customer_phone, customer_address, payment, order_total)
        values (${ctx.biz}, ${no}, ${at}, ${created}, ${str(it.status)}, ${str(it.customer)},
                ${formatBdPhone(it.phone)}, ${str(it.address)}, ${str(it.payment)}, ${num(it.total)})
        on conflict (business_id, order_no) do nothing
        returning id`;
      if (ins.length) oid = ins[0].id;
      else {
        const ex = await ctx.tx`select id from web_orders where business_id = ${ctx.biz} and order_no = ${no}`;
        oid = ex[0].id;
      }
      orderIds[no] = oid;
    }
    await ctx.tx`
      insert into web_order_lines (business_id, web_order_id, sku, product_name, qty, line_total, status, entered)
      values (${ctx.biz}, ${oid}, ${it.sku ? String(it.sku) : '(no sku)'}, ${str(it.product)},
              ${num(it.qty)}, ${num(it.line_total)}, ${str(it.status)}, false)`;
    added++;
  }
  forget(ctx, 'WEB_ORDERS');
  return { ok: true, fetched: items.length, added };
}

/** czPendingWebQty_ (Code.js:3950): web-order quantities not yet entered, per SKU. */
async function pendingWebQty(ctx) {
  const pending = {};
  for (const r of await webOrdersTab(ctx)) {
    const sku = str(r[WO.sku]).toLowerCase();
    const qty = Number(r[WO.qty]) || 0;
    const entered = str(r[WO.entered_in_sheet]).toLowerCase();
    if (!sku || sku === '(no sku)' || entered === 'yes') continue;
    pending[sku] = (pending[sku] || 0) + qty;
  }
  return pending;
}

/**
 * pushStockToWebsite (Code.js:3985): every product's stock to the website.
 * qty = max(0, round(stock - web orders not yet entered)) - otherwise this
 * push would undo the deduction WooCommerce already made.
 * mode 'apply' changes the website; anything else is a dry run.
 */
export async function pushStockToWebsite(ctx, mode) {
  await lock(ctx, 'website');
  const pending = await pendingWebQty(ctx);
  const rows = await ctx.tx`
    select p.sku, coalesce(ps.stock, 0) as stock
    from products p left join product_stock ps on ps.product_id = p.id
    where p.business_id = ${ctx.biz}
    order by p.date_added, p.created_at, p.sku`;
  const items = [];
  for (const r of rows) {
    const sku = str(r.sku);
    if (!sku) continue;
    let avail = Number(r.stock);
    if (isNaN(avail)) avail = 0;
    const held = pending[sku.toLowerCase()] || 0;
    items.push({ sku, qty: Math.max(0, Math.round(avail - held)) });
  }
  const res = await czFetch(ctx, 'POST', '/stock', {
    mode: mode === 'apply' ? 'apply' : 'dry',
    zero_policy: 'outofstock',
    items,
  });
  res.ok = true;
  res.sent = items.length;
  return res;
}

// ------------------------------------------------------------- the screen

async function webOrders(ctx) {
  const wo = await webOrdersTab(ctx);
  const agg = {}, order = [];
  for (let i = 0; i < wo.length; i++) {
    const no = str(wo[i][WO.order_no]);
    if (!no) continue;
    const entered = str(wo[i][WO.entered_in_sheet]).toLowerCase() === 'yes';
    if (!agg[no]) {
      agg[no] = {
        no,
        date: String(wo[i][WO.order_date] || '').slice(0, 16),
        status: str(wo[i][WO.status]),
        customer: str(wo[i][WO.customer]),
        phone: str(wo[i][WO.phone]),
        address: str(wo[i][WO.address]),
        payment: str(wo[i][WO.payment]),
        orderTotal: num(wo[i][WO.order_total]),
        entered,
        lines: [],
        orderId: wo[i][WO.order_id],
      };
      order.push(no);
    }
    if (entered) agg[no].entered = true;
    agg[no].lines.push({
      sku: str(wo[i][WO.sku]),
      product: str(wo[i][WO.product]),
      qty: num(wo[i][WO.qty]),
      lineTotal: num(wo[i][WO.line_total]),
      row: i + 2,
      lineId: wo[i][WO.line_id],
    });
  }
  const out = order.map((k) => agg[k]);
  out.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  return out;
}

/** erpWebOrders (ERP.js:1507): website orders grouped per order number, newest first. */
export async function erpWebOrders(ctx) {
  return (await webOrders(ctx)).map((o) => {
    const { orderId, ...rest } = o;
    return { ...rest, lines: o.lines.map(({ lineId, ...l }) => l) };
  });
}

/** erpWebPayment_ (ERP.js:5759): what the website's payment words mean here. */
export function webPayment(raw) {
  const t = String(raw || '').toLowerCase();
  if (/cash on delivery|\bcod\b/.test(t)) return { method: 'COD', status: 'Pending' };
  if (/eps|card|visa|master|amex|nagad qr|bangla ?qr|online/.test(t)) return { method: 'Bangla QR', status: 'Paid' };
  if (/bkash/.test(t)) return { method: 'bKash', status: 'Pending' };
  if (/rocket|nagad/.test(t)) return { method: String(raw || '').trim(), status: 'Pending' };
  if (/bank/.test(t)) return { method: 'Bank Transfer', status: 'Pending' };
  if (/cash/.test(t)) return { method: 'Cash', status: 'Paid' };
  return { method: String(raw || '').trim() || 'Cash', status: 'Pending' };
}

/**
 * erpEnterWebOrder (ERP.js:1550): a website order becomes a real invoice -
 * stock deducted exactly as for a counter sale. The order is only ticked
 * once that succeeded.
 */
export async function erpEnterWebOrder(ctx, orderNo) {
  const no = str(orderNo);
  if (!no) throw new Error('Which order?');

  let order = null;
  for (const o of await webOrders(ctx)) if (o.no === no) { order = o; break; }
  if (!order) throw new Error('Order ' + no + ' not found.');
  if (order.entered) throw new Error('Order ' + no + ' is already entered.');

  // the website's own line totals decide the discount
  const by = {};
  for (const p of await erpCatalog(ctx)) by[p.sku.toLowerCase()] = p;
  const items = [], unknown = [];
  for (const ln of order.lines) {
    const rec = by[ln.sku.toLowerCase()];
    if (!rec) { unknown.push(ln.sku); continue; }
    const listTotal = rec.sell * ln.qty;
    const disc = Math.max(0, Math.round(listTotal - ln.lineTotal));
    items.push({ sku: rec.sku, qty: ln.qty, discount: disc });
  }
  if (unknown.length) {
    throw new Error('These SKUs are not in PRODUCT_MASTER: ' + unknown.join(', ') +
      '. Add them first, then enter the order.');
  }
  if (!items.length) throw new Error('Order ' + no + ' has no usable lines.');

  let itemsTotal = 0;
  for (const l of order.lines) itemsTotal += num(l.lineTotal);

  const pay = webPayment(order.payment);
  const res = await createInvoice(ctx, {
    customer: { name: order.customer, phone: order.phone, address: order.address, source: 'Website order' },
    items,
    // delivery, and the cash handling fee on a COD order
    deliveryCharge: Math.max(0, Math.round((num(order.orderTotal) - itemsTotal) * 100) / 100),
    advancePaid: 0,
    paymentMethod: pay.method,
    paymentStatus: pay.status,
    note: 'WEB-' + no,
  }, { webEntry: true, webOrderNo: no });

  await markEntered(ctx, order.lines.map((l) => l.lineId), res.invoiceId);

  // the PDF, when the sales group's builder exists (as the original, a
  // failed PDF does not undo the sale)
  let pdfUrl = res.pdfUrl || '';
  try {
    const m = await import('./sales.js');
    if (typeof m.makeInvoicePdf === 'function') {
      const f = await ctx.tx.savepoint(() => m.makeInvoicePdf(ctx, res.invoiceNo, {}));
      if (f && f.url) pdfUrl = f.url;
    }
  } catch (_) { /* not in the web app yet, or it failed silently as before */ }

  return { ok: true, invoiceNo: res.invoiceNo, pdfUrl, orderNo: no };
}

/**
 * erpMarkWebOrderEntered (ERP.js:1900): an order recorded by hand - ticked
 * off without an invoice or a stock movement.
 */
export async function erpMarkWebOrderEntered(ctx, orderNo) {
  const no = str(orderNo);
  if (!no) throw new Error('Which order?');
  await lock(ctx, 'website');
  forget(ctx, 'WEB_ORDERS');
  const rows = await webOrdersTab(ctx);
  if (!rows.length) throw new Error('No website orders found.');
  const ids = rows.filter((r) => str(r[WO.order_no]) === no).map((r) => r[WO.line_id]);
  if (!ids.length) throw new Error('Order ' + no + ' not found.');
  await markEntered(ctx, ids, null);
  return { ok: true, orderNo: no, rows: ids.length };
}

// ------------------------------------------------------ linking by hand

/** erpPhone10_ (ERP.js:10641) */
function phone10(v) {
  const d = String(v == null ? '' : v).replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : '';
}

/** `new Date('yyyy-MM-ddT00:00:00')` in the script's time zone (Asia/Dhaka). */
function dayStart(text) {
  const s = String(text || '').slice(0, 10);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return 0;
  const probe = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (probe.getUTCMonth() !== Number(m[2]) - 1 || probe.getUTCDate() !== Number(m[3])) return 0;
  return dhakaDayStart(s).getTime();
}

/**
 * erpLinkGuess_ (ERP.js:10652): invoices that could be the hand-made twin of
 * a website order - same phone, not tied yet, from two days before the order
 * to two weeks after. Nearest first, at most 5.
 */
export function linkGuess(loose, phone, date) {
  const p = phone10(phone);
  if (!p) return [];
  const at = dayStart(date);
  const got = [];
  for (const id of Object.keys(loose)) {
    const x = loose[id];
    if (x.linked || x.phone !== p) continue;
    if (at && x.at && (x.at < at - 2 * DAY_MS || x.at > at + 14 * DAY_MS)) continue;
    got.push({ id: x.id, when: x.when, customer: x.customer, total: Math.round(x.total),
               gap: Math.abs((x.at || 0) - at) });
  }
  got.sort((a, b) => a.gap - b.gap);
  return got.slice(0, 5).map((x) => ({ id: x.id, when: x.when, customer: x.customer, total: x.total }));
}

/** The invoices of SALES_LOG (return notes left out), and which website order each is tied to. */
async function looseInvoices(ctx) {
  const mine = {}, loose = {};
  for (const r of await salesLog(ctx)) {
    const m = /WEB-(\S+)/.exec(String(r[SL.notes] || ''));
    const inv = str(r[SL.order_id]);
    if (m) mine[m[1]] = inv;
    if (!inv || /^RTN-/.test(inv)) continue;
    if (!loose[inv]) {
      const ts = asDate(r[SL.timestamp]);
      loose[inv] = { id: inv, at: ts ? ts.getTime() : 0,
                     when: ts ? formatDate(ts, 'yyyy-MM-dd') : '',
                     customer: str(r[SL.customer_name]),
                     phone: phone10(r[SL.customer_contact]), total: 0, linked: false };
    }
    loose[inv].total = Math.max(loose[inv].total, num(r[SL.grand_total]));
    if (m) loose[inv].linked = true;
  }
  return { mine, loose };
}

/** erpWebOrderInvoices (ERP.js:11505): which invoice an "already entered" order is. */
export async function erpWebOrderInvoices(ctx, payload) {
  const no = str(payload && payload.orderNo);
  if (!no) throw new Error('Which order?');
  let order = null;
  for (const o of await webOrders(ctx)) if (o.no === no) { order = o; break; }
  if (!order) throw new Error('Order ' + no + ' not found.');
  let linked = '';
  for (const r of await salesLog(ctx)) {
    const inv = str(r[SL.order_id]);
    if (!inv || /^RTN-/.test(inv)) continue;
    const m = /WEB-(\S+)/.exec(String(r[SL.notes] || ''));
    if (m && m[1] === no) linked = inv;
  }
  const { loose } = await looseInvoices(ctx);
  return { orderNo: no, customer: order.customer, phone: order.phone, total: order.orderTotal, linked,
           suggest: linked ? [] : linkGuess(loose, order.phone, order.date) };
}

/**
 * erpLinkWebOrder (ERP.js:10682): tie a website order to an invoice typed by
 * hand - WEB-<order> at the front of the invoice's note, and nothing else.
 * One order, one invoice. Logged with the other invoice fixes.
 */
export async function erpLinkWebOrder(ctx, payload) {
  payload = payload || {};
  const no = str(payload.orderNo);
  const invoiceNo = str(payload.invoiceNo);
  if (!no) throw new Error('Which website order?');
  if (!invoiceNo) throw new Error('Which invoice?');
  if (/\s/.test(no)) throw new Error('That order number is not valid.');

  await lock(ctx, 'sale');
  forget(ctx, 'SALES_LOG');
  const rows = await salesLog(ctx);
  if (!rows.length) throw new Error('No invoice called ' + invoiceNo + '.');
  const at = [];
  for (let i = 0; i < rows.length; i++) {
    const id = str(rows[i][SL.order_id]);
    const m = /WEB-(\S+)/.exec(String(rows[i][SL.notes] || ''));
    if (m && m[1] === no && id !== invoiceNo) {
      throw new Error('Website order ' + no + ' is already tied to ' + id + '.');
    }
    if (id === invoiceNo) {
      if (m && m[1] !== no) throw new Error(invoiceNo + ' is already tied to website order ' + m[1] + '.');
      at.push(i);
    }
  }
  if (!at.length) throw new Error('No invoice called ' + invoiceNo + '.');

  const by = who(ctx);
  let logged = false;
  const done = {};
  for (const a of at) {
    const was = str(rows[a][SL.notes]);
    if (/WEB-\S+/.test(was)) continue;
    const now = 'WEB-' + no + (was ? ' ' + was : '');
    const invId = rows[a][SL.invoice_id];
    if (!done[invId]) {
      done[invId] = true;
      await ctx.tx`update invoices set note = ${now}, web_order_no = ${no}
                   where business_id = ${ctx.biz} and id = ${invId}`;
    }
    if (!logged) {
      logged = true;
      await ctx.tx`insert into invoice_fixes (business_id, fixed_at, invoice_no, field, was, now, fixed_by)
                   values (${ctx.biz}, now(), ${invoiceNo}, 'website order', ${was}, ${now}, ${by})`;
    }
  }
  forget(ctx, 'SALES_LOG');

  // the order is spoken for now, so it must not be offered for entry again
  forget(ctx, 'WEB_ORDERS');
  const ids = (await webOrdersTab(ctx))
    .filter((r) => str(r[WO.order_no]) === no && str(r[WO.entered_in_sheet]).toLowerCase() !== 'yes')
    .map((r) => r[WO.line_id]);
  const invRow = rows[at[0]][SL.invoice_id];
  await markEntered(ctx, ids, invRow);
  return { ok: true, orderNo: no, invoiceNo, rows: at.length, already: !logged };
}

// ------------------------------------------------------------ the courier

/** ERP_COURIER_WORDS (ERP.js:5799) */
const ERP_COURIER_WORDS = {
  delivered:         { label: 'Delivered',        tone: 'ok',   collected: true },
  partial_delivered: { label: 'Part delivered',   tone: 'warn', collected: true },
  in_review:         { label: 'With the courier', tone: 'info', collected: false },
  pending:           { label: 'Waiting pickup',   tone: 'info', collected: false },
  hold:              { label: 'On hold',          tone: 'warn', collected: false },
  cancelled:         { label: 'Cancelled',        tone: 'bad',  collected: false },
  returned:          { label: 'Came back',        tone: 'bad',  collected: false },
  unknown:           { label: 'Courier says unknown', tone: 'warn', collected: false },
};

/**
 * erpCourier (ERP.js:5817): website orders of the last few weeks with what
 * the courier says, read through the website's bridge. Read only.
 */
export async function erpCourier(ctx, payload) {
  payload = payload || {};
  const days = num(payload.days) > 0 ? Math.round(num(payload.days)) : 30;

  let res;
  try {
    res = await czFetch(ctx, 'GET', '/cod?days=' + days + '&limit=200', null);
  } catch (e) {
    throw new Error('Could not reach the website: ' + (e && e.message ? e.message : e));
  }
  const orders = (res && res.orders) || [];

  const { mine, loose } = await looseInvoices(ctx);

  const ticked = {};
  for (const w of await webOrdersTab(ctx)) {
    if (str(w[WO.entered_in_sheet]).toLowerCase() === 'yes') ticked[str(w[WO.order_no])] = true;
  }

  const out = [];
  let collected = 0, waiting = 0, lost = 0;
  for (const o of orders) {
    const word = String(o.courier || '').toLowerCase();
    const known = Object.prototype.hasOwnProperty.call(ERP_COURIER_WORDS, word) ? ERP_COURIER_WORDS[word] : null;
    const cod = num(o.cod_amount);
    const isCod = /cash on delivery|\bcod\b/i.test(String(o.method || ''));

    if (known && known.collected) collected += cod;
    else if (word === 'cancelled' || word === 'returned') lost += cod;
    else if (o.consignment) waiting += cod;

    const ono = String(o.order_no || '');
    out.push({
      orderNo: ono,
      when: String(o.date || '').slice(0, 10),
      customer: str(o.customer),
      phone: String(o.phone || ''),
      method: String(o.method || ''),
      isCod,
      total: Math.round(num(o.total)),
      cod: Math.round(cod),
      consignment: String(o.consignment || ''),
      courier: word,
      courierLabel: known ? known.label : (word ? word : 'Not booked'),
      tone: known ? known.tone : (o.consignment ? 'warn' : 'info'),
      collected: !!(known && known.collected),
      invoiceNo: mine[ono] || '',
      handled: !mine[ono] && !!ticked[ono],
      suggest: mine[ono] ? [] : linkGuess(loose, o.phone, o.date),
    });
  }

  return {
    days, count: out.length, orders: out,
    collected: Math.round(collected),
    waiting: Math.round(waiting),
    lost: Math.round(lost),
    generatedAt: formatDate(new Date(), 'd MMM yy, h:mm a'),
  };
}

export const HANDLERS = {
  erpWebOrders,
  erpEnterWebOrder,
  erpMarkWebOrderEntered,
  erpWebOrderInvoices,
  erpLinkWebOrder,
  erpCourier,
};
