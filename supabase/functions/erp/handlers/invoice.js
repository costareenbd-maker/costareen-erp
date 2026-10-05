// New invoice: erpCreateInvoice (ERP:841) + submitInvoiceCore_ (Code:1077)
// + upsertCustomer_ (Code:2148), as one transaction.
//
// The sheet staged the sale into the INVOICE tab and let its formulas total
// it; here the same arithmetic is done directly (spec 03 §1.7 step 8):
//   line total = qty x unit - line discount
//   subtotal   = sum(qty x unit)            discount = sum(line discounts)
//   grand      = subtotal - discount + delivery
//   advance    = what was taken now          due = grand - advance

import { codAllowed } from '../lib/delivery.js';
import { erpCatalog } from './catalog.js';
import { forget } from '../lib/tabs.js';
import { formatDate, num, round2, dhakaDayStart, todayStr, DAY_MS } from '../lib/time.js';
import { phone11, formatBdPhone, custKey, normalizePhone } from '../lib/phone.js';
import { ERP_DISCOUNT_CAP } from '../allow.js';
import {
  erpCustomerAccount, invoiceDiscounts, addPayment, syncInvoiceStatus, applyCredit,
  lock, stamp, who,
} from './money.js';
import { products } from './dashboard.js';
import { assertOpen } from '../lib/period.js';
import { sellSerials } from './serials.js';

/** erpSetInvoiceDate_ + invoiceTimestamp_: the moment the sale is logged at. */
function saleTimestamp(wanted, now) {
  const s = String(wanted || '').trim();
  if (!s) return now;
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) throw new Error('The date must look like 2026-09-27.');
  const probe = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  if (isNaN(probe.getTime()) || probe.getUTCMonth() !== Number(m[2]) - 1) {
    throw new Error('That is not a real date: ' + s);
  }
  const day = dhakaDayStart(s);
  const today = dhakaDayStart(todayStr(now));
  if (day.getTime() > today.getTime()) throw new Error('An invoice cannot be dated in the future.');
  if ((today.getTime() - day.getTime()) / DAY_MS > 3650) {
    throw new Error('That date is more than ten years ago - check it.');
  }
  // keep the time of day from right now, so a day's invoices still sort in entry order
  return new Date(day.getTime() + (now.getTime() - today.getTime()));
}

/** generateTxnId_ */
function txnId(now) {
  return 'TXN-' + formatDate(now, 'yyyyMMdd') + '-' + (Math.floor(Math.random() * 9000) + 1000);
}

/** freshInvoiceNo_: INV-<save date>-<counter, 3+ digits>, bumped past any number already used. */
async function freshInvoiceNo(ctx, now) {
  await ctx.tx`insert into invoice_counters (business_id, next_number, prefix)
               values (${ctx.biz}, 1001, 'INV') on conflict (business_id) do nothing`;
  const c = await ctx.tx`select next_number from invoice_counters
                         where business_id = ${ctx.biz} for update`;
  let n = Number(c[0].next_number) || 1001;
  const day = formatDate(now, 'yyyyMMdd');
  const make = (k) => 'INV-' + day + '-' + String(k).padStart(3, '0');
  for (let tries = 0; tries <= 50; tries++) {
    const used = await ctx.tx`select 1 from invoices where business_id = ${ctx.biz}
                              and invoice_no = ${make(n)} limit 1`;
    if (!used.length) return { no: make(n), n };
    n++;
  }
  throw new Error('Invoice number ' + make(n) + ' is already used and a free one could not be ' +
    'found. Check next_invoice_num in SETTINGS.');
}

/** upsertCustomer_ (Code:2148): match on the last 10 digits, else the name. */
async function upsertCustomer(ctx, name, contact, address, amount, productSummary, source) {
  const cleanName = String(name || '').trim();
  const cleanContact = contact ? formatBdPhone(String(contact).trim()) : '';
  const cleanAddress = String(address || '').trim();
  const spend = Number(amount) || 0;
  const lastProduct = String(productSummary || '').trim();
  const src = String(source || '').trim() || 'Walk-in';
  if (!cleanName && !cleanContact) return null;

  const wantKey = normalizePhone(cleanContact);
  const rows = await ctx.tx`select id, name, phone, total_orders, total_spent
                            from customers where business_id = ${ctx.biz} order by seq`;
  const hit = rows.find((r) => {
    const k = normalizePhone(String(r.phone || '').trim());
    return (wantKey && k && k === wantKey) ||
           (!wantKey && cleanName && String(r.name || '').trim().toLowerCase() === cleanName.toLowerCase());
  });
  const key = custKey(cleanContact, cleanName);

  if (!hit) {
    const r = await ctx.tx`
      insert into customers (business_id, customer_no, name, phone, email, address, type,
        total_orders, total_spent, note, last_order_at, last_product, source, status, customer_key)
      values (${ctx.biz}, ${'CUS-' + Date.now()}, ${cleanName}, ${cleanContact}, '', ${cleanAddress},
        'Retail', 1, ${spend}, 'Auto-created from invoice', now(), ${lastProduct}, ${src},
        ${spend >= 50000 ? 'VIP' : 'New'}, ${key})
      returning id`;
    return r[0].id;
  }
  const orders = (Number(hit.total_orders) || 0) + 1;
  const spent = (Number(hit.total_spent) || 0) + spend;
  await ctx.tx`
    -- an invoice never renames a customer, and a sale with no phone never wipes the phone on file
    update customers set name = coalesce(nullif(name, ''), ${cleanName}), phone = coalesce(nullif(${cleanContact}, ''), phone),
      -- a sale with no address (a pickup) must not wipe the address on file
      address = coalesce(nullif(${cleanAddress}, ''), address),
      total_orders = ${orders}, total_spent = ${spent}, last_order_at = now(),
      last_product = ${lastProduct}, source = ${src},
      status = ${spent >= 50000 || orders >= 5 ? 'VIP' : 'Returning'},
      customer_key = case when ${cleanContact} <> '' then ${key} else customer_key end, updated_at = now()
    where id = ${hit.id}`;
  return hit.id;
}

/**
 * The whole save. opts.webEntry = a website order: priced by the website,
 * so the role's discount cap and the strict 11-digit phone rule do not apply.
 */
export async function createInvoice(ctx, payload, opts = {}) {
  if (!payload || !payload.customer) throw new Error('Nothing to save.');
  let name = String(payload.customer.name || '').trim();
  if (!name) throw new Error('Customer name is required.');
  const items = (payload.items || []).filter((it) => it && String(it.sku || '').trim() && num(it.qty) > 0);
  if (!items.length) throw new Error('Add at least one product.');

  await lock(ctx, 'sale');
  const now = new Date();
  const ts = saleTimestamp(payload.date, now);
  await assertOpen(ctx, ts instanceof Date ? ts : new Date(ts), 'a sale cannot be dated there');

  // live stock, before anything is written
  delete ctx.memo.catalog;
  const bySku = {};
  // the pool's copy of a partner's sale reads its shelf as it is (no price list of a person: there may be no login here)
  const shelfNow = opts.mirror
    ? (await ctx.tx`select p.sku, p.name, coalesce(ps.stock, 0) as stock, p.sell_price from products p left join product_stock ps on ps.product_id = p.id
                    where p.business_id = ${ctx.biz}`).map((r) => ({ sku: String(r.sku || '').trim(), name: String(r.name || ''), stock: num(r.stock), sell: num(r.sell_price) }))
    : await erpCatalog(ctx);
  for (const p of shelfNow) bySku[p.sku.toLowerCase()] = p;
  // joint stock: lines that come from a pool this company co-owns (their code carries the pool).
  // The pools are locked and their shelves read here; the pool's own copy of the sale is made below.
  const J = await import('./joint.js');
  const jointItems = opts.mirror ? [] : items.filter((it) => J.JOINT_MARK.test(String(it.sku).trim()));
  const joint = jointItems.length ? await J.prepareJointSale(ctx, jointItems) : null;
  if (joint) Object.assign(bySku, joint.recs);
  const seen = {};
  for (const it of items) {
    const sk = String(it.sku).trim(), rec = bySku[sk.toLowerCase()];
    if (!rec) throw new Error('Unknown product: ' + sk);
    seen[sk.toLowerCase()] = (seen[sk.toLowerCase()] || 0) + num(it.qty);
    if (seen[sk.toLowerCase()] > rec.stock) {
      throw new Error('Not enough stock for ' + rec.name + ': ' + rec.stock + ' in stock, ' +
        seen[sk.toLowerCase()] + ' requested.');
    }
  }

  // discounts: so much off each piece, and so much off the whole
  // the pool's copy of a partner company's sale takes its prices and discounts as they were given to the customer
  const DSC = opts.mirror
    ? { line: opts.mirror.lines.map((l) => round2(num(l.disc))), itemDisc: opts.mirror.lines.reduce((a, l) => a + num(l.disc), 0), invDisc: 0, sub: 0 }
    : invoiceDiscounts(items, bySku, num(payload.invoiceDiscount));
  if (!opts.webEntry && !opts.mirror) {
    const cap = ctx.s.discountCap ?? ERP_DISCOUNT_CAP[ctx.s.role] ?? 0;
    if (cap < 100 && DSC.itemDisc + DSC.invDisc > DSC.sub * cap / 100 + 0.5) {
      throw new Error('This discount is ' + (Math.round((DSC.itemDisc + DSC.invDisc) / DSC.sub * 1000) / 10) +
        '% of the goods. Your limit is ' + cap + '% - ask a manager or the owner to save this sale.');
    }
  }
  const phoneIn = opts.partnerDeal || opts.mirror ? ''
                : opts.webEntry ? formatBdPhone(String(payload.customer.phone || '').trim())
                                : phone11(payload.customer.phone);
  const address = String(payload.customer.address || '').trim();
  const source = String(payload.customer.source || '').trim() || 'Walk-in';
  // one phone = one customer: a phone already on the list keeps its saved name, whatever was typed
  // (the name is changed on the customer's own page, and then on every invoice of theirs)
  if (phoneIn) {
    const want = normalizePhone(phoneIn);
    const known = want ? (await ctx.tx`select name, phone from customers where business_id = ${ctx.biz} and coalesce(phone, '') <> '' order by seq`)
      .find((r) => normalizePhone(String(r.phone || '')) === want) : null;
    if (known && String(known.name || '').trim()) name = String(known.name).trim();
  }

  // the lines, priced as the invoice sheet's VLOOKUP priced them
  const lines = [];
  for (let i = 0; i < items.length; i++) {
    const rec = bySku[String(items[i].sku).trim().toLowerCase()];
    if (rec.joint) {   // a joint line: priced for this company by the pool, no product of its own here
      const jq = num(items[i].qty), jd = DSC.line[i];
      lines.push({ productId: null, sku: rec.sku, name: rec.name, qty: jq, unit: num(rec.sell), disc: jd, total: Math.max(0, jq * num(rec.sell) - jd),
                   poolId: rec.poolId, code: rec.code, floor: num(rec.floor) });
      continue;
    }
    const pr = opts.mirror
      ? await ctx.tx`select id, name, sell_price as price from products where business_id = ${ctx.biz} and lower(btrim(sku)) = ${rec.sku.toLowerCase()} limit 1`
      : await ctx.tx`select id, name, sale_price_for(${ctx.biz}, id) as price
                     from products where business_id = ${ctx.biz}
                       and lower(btrim(sku)) = ${rec.sku.toLowerCase()} limit 1`;
    // a sale to a partner company goes at the price the two agreed (plan B3)
    const unit = opts.mirror ? num(opts.mirror.lines[i].unit)
               : opts.partnerDeal && opts.unitPrice > 0 ? opts.unitPrice : (num(pr[0].price) || num(rec.sell));
    const qty = num(items[i].qty);
    const disc = DSC.line[i];
    lines.push({ productId: pr[0].id, sku: rec.sku, name: rec.name || pr[0].name, qty, unit,
                 disc, total: Math.max(0, qty * unit - disc) });
  }
  // nobody sells joint stock under its floor price (the owner may: it is flagged for the partner)
  const shortfall = {};
  if (joint) for (const pool of joint.pools) shortfall[pool.id] = J.floorCheck(ctx, lines.filter((l) => l.poolId === pool.id));
  const sub = lines.reduce((a, l) => a + l.qty * l.unit, 0);
  const discount = lines.reduce((a, l) => a + l.disc, 0);
  const delivery = num(payload.deliveryCharge);
  const grand = round2(sub - discount + delivery);

  // How it is paid (owner's rule, tidy-1): paid now / cash on delivery / part paid / due.
  // What was paid decides the status - never the button.
  let mode = String(payload.payMode || '').toLowerCase();
  if (!mode) mode = /^paid$/i.test(String(payload.paymentStatus || '')) ? 'full' : num(payload.advancePaid) > 0 ? 'part' : 'none';
  if (['full', 'cod', 'part', 'none'].indexOf(mode) < 0) throw new Error('How was it paid?');
  const isCod = (m) => /^cod\b|cash on delivery/i.test(String(m || '').trim());
  let method = String(payload.paymentMethod || '').trim();
  let took = mode === 'full' ? grand : mode === 'none' ? 0 : Math.max(0, Math.min(num(payload.paidNow !== undefined && payload.paidNow !== '' ? payload.paidNow : payload.advancePaid), grand));
  if (mode === 'part' && took <= 0) mode = 'none';
  if (mode === 'part' && took >= grand) mode = 'full';
  let payMethod = method;
  if (mode === 'cod') {
    if (!opts.webEntry && !(await codAllowed(ctx, source))) throw new Error('Cash on delivery needs a courier or a rider - "' + (source || 'this delivery') + '" is a pickup. Choose Paid now, Part paid or Due.');
    payMethod = String(payload.advanceMethod || '').trim();
    if (took > 0 && (!payMethod || isCod(payMethod))) throw new Error('How was the advance paid? (bKash, Cash, Bank...)');
    method = 'COD';
  } else if (mode === 'full' || mode === 'part') {
    if (!method) method = 'Cash';
    if (isCod(method)) throw new Error('Cash on delivery is its own choice: choose "Cash on delivery", not COD as the method.');
    payMethod = method;
  } else {
    method = '';   // nothing paid: no method
  }
  const advance = took;
  const status = took >= grand - 0.5 ? 'Paid' : took > 0 ? 'Partial' : 'Pending';

  // what they owed before this sale, read before it exists
  let priorBalance = 0;
  if (!opts.mirror) try {
    priorBalance = (await erpCustomerAccount(ctx, { phone: String(payload.customer.phone || ''), name })).balance;
  } catch (_) { /* as original */ }

  let noteText = String(payload.note || '');
  if (DSC.invDisc > 0) {
    noteText = (noteText || 'Invoice submission') + ' [discount: items ' + Math.round(DSC.itemDisc) +
      ' + invoice ' + Math.round(DSC.invDisc) + ']';
  }

  const { no: invoiceNo, n } = await freshInvoiceNo(ctx, now);
  const key = custKey(phoneIn, name);

  const inv = await ctx.tx`
    insert into invoices (business_id, invoice_no, customer_name, customer_phone, customer_address,
      source, subtotal, discount, delivery_charge, grand_total, advance_paid, due_amount,
      payment_method, payment_status, delivery_status, note, created_by, created_at,
      item_discount, invoice_discount, customer_key, web_order_no, sold_by)
    values (${ctx.biz}, ${invoiceNo}, ${name}, ${phoneIn}, ${address}, ${source}, ${round2(sub)},
      ${round2(discount)}, ${delivery}, ${grand}, ${round2(advance)}, ${round2(grand - advance)},
      ${method}, ${status}, 'Processing', ${noteText || 'Invoice submission'}, ${ctx.s.userId}, ${ts},
      ${round2(DSC.itemDisc)}, ${DSC.invDisc}, ${key}, ${opts.webOrderNo || null}, ${opts.mirror ? opts.mirror.seller : null})
    returning id`;
  const invoiceId = inv[0].id;

  // plan A1: each line keeps what the product costs today - its own cost, or the price book's
  // where it has none - so later price changes cannot rewrite this sale's profit
  const costs = (await products(ctx)).bySku;
  const costNow = (sku) => { const p = costs[String(sku).trim().toLowerCase()]; return p && p.cost > 0 ? p.cost : 0; };
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    if (l.poolId) {
      // a joint line: the goods are the pool's, so the stock moves there. Here its cost is what it
      // was sold for - the money is held for the pool, and this company's own profit is not touched.
      await ctx.tx`
        insert into invoice_lines (business_id, invoice_id, product_id, sku, name, qty, unit_price,
                                   discount, line_total, line_no, unit_cost, pool_id)
        values (${ctx.biz}, ${invoiceId}, ${null}, ${l.sku}, ${l.name}, ${l.qty}, ${l.unit},
                ${l.disc}, ${l.total}, ${i + 1}, ${l.qty > 0 ? round2(l.total / l.qty) : 0}, ${l.poolId})`;
      continue;
    }
    await ctx.tx`
      insert into invoice_lines (business_id, invoice_id, product_id, sku, name, qty, unit_price,
                                 discount, line_total, line_no, unit_cost)
      values (${ctx.biz}, ${invoiceId}, ${l.productId}, ${l.sku}, ${l.name}, ${l.qty}, ${l.unit},
              ${l.disc}, ${l.total}, ${i + 1}, ${costNow(l.sku)})`;
    await ctx.tx`
      insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price, total,
                                   reference, invoice_id, created_by, created_at, txn_no, operator, product_name)
      values (${ctx.biz}, ${l.productId}, 'SALE', 'OUT', ${l.qty}, ${l.unit}, ${l.total},
              ${'Invoice: ' + invoiceNo}, ${invoiceId}, ${ctx.s.userId}, ${ts}, ${txnId(now)},
              ${who(ctx)}, ${l.name})`;
  }

  // plan D1: which units went out, and the warranty each one carries from today
  const soldSerials = opts.mirror ? [] : await sellSerials(ctx, invoiceNo, name, key, ts instanceof Date ? ts : now, items.filter((it) => !J.JOINT_MARK.test(String(it.sku).trim())), bySku, opts);

  const customerId = opts.mirror ? null : await upsertCustomer(ctx, name, phoneIn, address, grand,
    lines.map((l) => l.name).join(', '), source);
  if (customerId) await ctx.tx`update invoices set customer_id = ${customerId} where id = ${invoiceId}`;

  await ctx.tx`update invoice_counters set next_number = ${n + 1} where business_id = ${ctx.biz}`;
  forget(ctx, 'SALES_LOG', 'CUSTOMERS', 'TXN_LOG');

  // the pool's side of the joint lines - before any money is written, so the money finds it
  const jointMade = joint ? await J.mirrorJointSale(ctx, joint, { invoiceNo, date: payload.date, at: ts instanceof Date ? ts : now,
                                                                 lines: lines.filter((l) => l.poolId), shortfall }, createInvoice) : [];
  if (opts.mirror) return { ok: true, invoiceNo, invoiceId, grandTotal: grand };

  // money taken at the counter is money received
  if (took > 0) {
    await addPayment(ctx, { id: 'P' + stamp(), order: invoiceNo, customer: name,
      amount: Math.min(took, grand), method: payMethod,
      note: took >= grand ? 'paid in full at the till' : 'advance' });
    await syncInvoiceStatus(ctx, invoiceNo);
  }

  // credit taken for goods that had not arrived is spent here, and only here
  let creditUsed = 0;
  const ckey = custKey(String(payload.customer.phone || ''), name);
  const owing = Math.max(0, grand - took);
  if (owing > 0 && ckey && ckey !== 'n:') {
    creditUsed = await applyCredit(ctx, ckey, name, invoiceNo, owing);
    if (creditUsed > 0) await syncInvoiceStatus(ctx, invoiceNo);
  }
  const thisDue = Math.max(0, round2(grand - took - creditUsed));

  // The customer's copy. If drawing it fails the sale still stands (as in the
  // original) - Sales draws it the first time someone opens it.
  let pdf = null;
  try {
    const { makeInvoicePdf } = await import('./sales.js');
    pdf = await ctx.tx.savepoint(() => makeInvoicePdf(ctx, invoiceNo, {}));
  } catch (_) { pdf = null; }

  return { serials: soldSerials, ok: true, invoiceNo, invoiceId,
    pdfUrl: (pdf && pdf.url) || '',
    items: lines.length, grandTotal: grand, paidNow: took, creditUsed,
    pdfId: (pdf && pdf.id) || '', pdfName: (pdf && pdf.name) || 'Invoice_' + invoiceNo + '.pdf',
    source: String((payload.customer && payload.customer.source) || ''),
    thisDue, priorBalance, totalOwed: round2(priorBalance + thisDue),
    joint: jointMade.map((j) => ({ pool: j.pool, name: j.name, total: j.total })),
  };
}

export async function erpCreateInvoice(ctx, payload) {
  // plan B3: "sell from" a joint pool without switching business. The sale is
  // the pool's in every way - its stock, prices, invoice number and books -
  // made by this person as the member of the pool they are.
  const from = String((payload && payload.from) || '').trim();
  let sctx = ctx, soldFrom = '';
  if (from && from !== ctx.biz) {
    const p = await poolCtx(ctx, from);
    sctx = p.ctx; soldFrom = p.name;
  }
  const res = await createInvoice(sctx, payload);
  delete res.invoiceId;
  if (soldFrom) { res.soldFrom = soldFrom; res.soldFromId = from; }
  return res;
}

/** This call, made inside a joint pool the person belongs to. Refused for anything else. */
export async function poolCtx(ctx, poolId) {
  const hit = (ctx.s.memberships || []).find((m) => m.business_id === String(poolId));
  if (!hit || !hit.is_pool) throw new Error('That joint pool is not one you are in. Its own members sell from it.');
  const role = String(hit.role || '').toLowerCase();
  return { name: String(hit.name || 'Joint pool'),
           ctx: { ...ctx, biz: hit.business_id, memo: {}, s: { ...ctx.s, role: ERP_DISCOUNT_CAP[role] !== undefined ? role : ctx.s.role } } };
}

/** The pool's products and prices, for the "sell from" switch on the invoice screen. */
export async function erpPoolCatalog(ctx, payload) {
  const p = await poolCtx(ctx, payload && payload.pool);
  return { pool: p.ctx.biz, name: p.name, products: await erpCatalog(p.ctx) };
}
