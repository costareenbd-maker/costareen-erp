// Group 'customers': the Customers screen, a customer's statement, due
// reminders, the legacy single-invoice payment, and the customer clean-up
// tools. Ported line by line from ERP.js 1405-1502, 2622-2735, 1718-1738,
// 4912-4958, 8916-9070 (+ upsertCustomer_ Code:2148 for the create path).
// Deliberate differences are listed in docs/fixes/customers.md.

import { salesLog, paymentsTab, forget, asDate, str, SL, PAY } from '../lib/tabs.js';
import { formatDate, num, round2, DAY_MS } from '../lib/time.js';
import { normalizePhone, formatBdPhone, phone11, custKey } from '../lib/phone.js';
import { saveFile, deleteFile, renderPdf } from '../lib/ext.js';
import { sameOrder, paidByOrder, addPayment, syncInvoiceStatus, erpDues, lock, stamp, who } from './money.js';

/** CUSTOMERS rows with their write-order number (the sheet row the page edits by). */
async function customerRows(ctx) {
  return ctx.tx`
    select id, seq, customer_no, name, phone, email, address, type, total_orders, total_spent,
           created_at, note, last_order_at, last_product, source, status, customer_key
    from customers where business_id = ${ctx.biz}
    order by seq`;
}

// ------------------------------------------------------------ erpCustomers

/** erpCustomers (ERP:1405): every customer, with what they actually bought. */
export async function erpCustomers(ctx) {
  const now = ctx.now;

  // ---- what each customer has actually bought, from the sales log
  const sl = await salesLog(ctx);
  const agg = {};
  for (const row of sl) {
    const oid = str(row[SL.order_id]);
    if (!oid) continue;
    let key = normalizePhone(row[SL.customer_contact]);
    if (!key) key = 'n:' + str(row[SL.customer_name]).toLowerCase();
    if (!key || key === 'n:') continue;
    let a = agg[key];
    if (!a) a = agg[key] = { units: 0, spent: 0, orders: {}, last: null };
    a.units += num(row[SL.quantity]);
    a.spent += num(row[SL.total]);
    if (!/^RTN-/.test(oid)) a.orders[oid] = 1;
    const dt = asDate(row[SL.timestamp]);
    if (dt && (!a.last || dt.getTime() > a.last.getTime())) a.last = dt;
  }

  const out = [];
  for (const c of await customerRows(ctx)) {
    const phone = str(c.phone);
    const name = str(c.name);
    const k = normalizePhone(phone) || ('n:' + name.toLowerCase());
    const a2 = agg[k];

    const lastDt = a2 ? a2.last : asDate(c.last_order_at);
    let days = null;
    if (lastDt) {
      days = Math.floor((now.getTime() - lastDt.getTime()) / DAY_MS);
      if (days < 0) days = 0;
    }
    out.push({
      row: Number(c.seq),
      id: str(c.customer_no),
      name,
      phone,
      email: str(c.email),
      address: str(c.address),
      type: str(c.type),
      orders: a2 ? Object.keys(a2.orders).length : num(c.total_orders),
      units: a2 ? Math.round(a2.units) : 0,
      spent: a2 ? Math.round(a2.spent) : Math.round(num(c.total_spent)),
      lastOrder: lastDt ? formatDate(lastDt, 'd MMM yyyy') : '',
      daysSince: days,
      source: str(c.source),
      status: str(c.status),
    });
  }
  out.sort((a, b) => b.spent - a.spent);
  return out;
}

// -------------------------------------------------------- erpCustomerList

const isMobile = (p) => /^01\d{9}$/.test(formatBdPhone(p));   // same rule as the page's hasMobile()

/**
 * The Customers screen, a page at a time (redesign phase 6). The search, the
 * filters and the sort are done here, so the browser is sent 100 rows and
 * not every customer the business has ever had.
 *   { q, lapse: ''|'30'..'365'|'never', orders: ''|'once'|'repeat',
 *     contact: ''|'phone'|'walkin', sort: 'spent'|'units'|'lapsed'|'recent', offset, limit }
 */
export async function erpCustomerList(ctx, payload) {
  payload = payload || {};
  const all = await erpCustomers(ctx);
  const q = str(payload.q).toLowerCase(), lapse = str(payload.lapse), orders = str(payload.orders), contact = str(payload.contact);
  const rows = all.filter((c) => {
    if (orders === 'once' && Number(c.orders) !== 1) return false;
    if (orders === 'repeat' && Number(c.orders) < 2) return false;
    if (contact === 'phone' && !isMobile(c.phone)) return false;
    if (contact === 'walkin' && isMobile(c.phone)) return false;
    if (lapse === 'never') { if (c.daysSince !== null) return false; }
    else if (lapse) { if (c.daysSince === null || c.daysSince < Number(lapse)) return false; }
    if (!q) return true;
    return (c.name + ' ' + c.phone + ' ' + c.address).toLowerCase().indexOf(q) !== -1;
  });
  const sort = str(payload.sort) || 'spent';
  rows.sort((a, b) => {
    if (sort === 'units') return (b.units || 0) - (a.units || 0);
    if (sort === 'recent') return (a.daysSince === null ? 1e9 : a.daysSince) - (b.daysSince === null ? 1e9 : b.daysSince);
    if (sort === 'lapsed') return (b.daysSince === null ? -1 : b.daysSince) - (a.daysSince === null ? -1 : a.daysSince);
    return (b.spent || 0) - (a.spent || 0);
  });
  const limit = Math.min(200, Math.max(10, Math.round(num(payload.limit)) || 100));
  const offset = Math.max(0, Math.round(num(payload.offset)) || 0);
  return { rows: rows.slice(offset, offset + limit), matched: rows.length, total: all.length, offset, limit };
}

// ---------------------------------------------------------- erpSaveCustomer

/**
 * erpSaveCustomer (ERP:1470): edit an existing customer, or create one with
 * no order attached. Fixed: creating a customer who already exists no longer
 * counts an order for them, and email/type/status are kept on create.
 */
export async function erpSaveCustomer(ctx, data) {
  data = data || {};
  const name = str(data.name);
  const phone = phone11(data.phone);
  if (!name) throw new Error('Customer name is required.');

  // the original took the one script lock that invoice saving also takes
  await lock(ctx, 'sale');

  if (data.row) {
    const r = Number(data.row);
    const hit = await ctx.tx`select id from customers
                             where business_id = ${ctx.biz} and seq = ${isFinite(r) ? r : -1}`;
    if (!hit.length) throw new Error('That customer is no longer on the list. Reload and try again.');
    // the phone may not be another customer's: one phone = one customer
    const want = normalizePhone(phone);
    if (want) {
      const other = (await ctx.tx`select id, name, phone from customers where business_id = ${ctx.biz} and id <> ${hit[0].id} and coalesce(phone, '') <> ''`)
        .find((c) => normalizePhone(String(c.phone || '')) === want);
      if (other) throw new Error('That phone number already belongs to ' + other.name + '. One phone number is one customer.');
    }
    const before = (await ctx.tx`select name, phone from customers where id = ${hit[0].id}`)[0];
    await ctx.tx`
      update customers set name = ${name}, phone = ${phone}, email = ${String(data.email || '')},
        address = ${String(data.address || '')}, type = ${String(data.type || 'Retail')},
        source = ${String(data.source || 'Walk-in')}, status = ${String(data.status || '')},
        customer_key = ${custKey(phone, name)}, updated_at = now()
      where id = ${hit[0].id}`;
    // the new name goes onto every invoice and payment of this customer (theirs by id, or by their phone)
    if (before && str(before.name) !== name) {
      const oldKey = normalizePhone(before.phone || '');
      const invs = (await ctx.tx`select id, invoice_no, customer_id, customer_phone from invoices where business_id = ${ctx.biz}`)
        .filter((i) => i.customer_id === hit[0].id || (oldKey && normalizePhone(String(i.customer_phone || '')) === oldKey));
      if (invs.length) {
        await ctx.tx`update invoices set customer_name = ${name}, customer_id = ${hit[0].id} where id = any(${invs.map((i) => i.id)}::uuid[])`;
        await ctx.tx`update payments set customer = ${name} where business_id = ${ctx.biz} and invoice_no = any(${invs.map((i) => i.invoice_no)}::text[])`;
      }
      forget(ctx, 'SALES_LOG', 'PAYMENTS');
    }
    forget(ctx, 'CUSTOMERS');
    return { ok: true, updated: true, name };
  }

  // New customer: the same match upsertCustomer_ uses (last 10 digits, else the name)
  const cleanContact = phone ? formatBdPhone(phone) : '';
  const wantKey = normalizePhone(cleanContact);
  const rows = await customerRows(ctx);
  const hit = rows.find((c) => {
    const k = normalizePhone(str(c.phone));
    return (wantKey && k && k === wantKey) ||
           (!wantKey && name && str(c.name).toLowerCase() === name.toLowerCase());
  });
  const address = str(data.address);
  const email = str(data.email);
  if (hit) {
    // already a customer: fill in what was typed, leave their history alone
    await ctx.tx`
      update customers set name = ${name},
        phone = ${cleanContact || str(hit.phone)},
        address = ${address || str(hit.address)},
        email = ${email || str(hit.email)},
        type = ${str(data.type) || str(hit.type) || 'Retail'},
        status = ${str(data.status) || str(hit.status)},
        source = ${str(data.source) || str(hit.source) || 'Walk-in'},
        customer_key = ${custKey(cleanContact || str(hit.phone), name)}, updated_at = now()
      where id = ${hit.id}`;
    forget(ctx, 'CUSTOMERS');
    return { ok: true, updated: true, name };
  }
  await ctx.tx`
    insert into customers (business_id, customer_no, name, phone, email, address, type,
      total_orders, total_spent, note, last_order_at, last_product, source, status, customer_key)
    values (${ctx.biz}, ${'CUS-' + Date.now()}, ${name}, ${cleanContact}, ${email}, ${address},
      ${str(data.type) || 'Retail'}, 0, 0, '', null, '', ${str(data.source) || 'Walk-in'},
      ${str(data.status) || 'New'}, ${custKey(cleanContact, name)})`;
  forget(ctx, 'CUSTOMERS');
  return { ok: true, updated: false, name };
}

// ------------------------------------------------------------- statement

/** erpCustomerStatement (ERP:8916): everything between the shop and one customer. */
export async function erpCustomerStatement(ctx, payload) {
  payload = payload || {};
  const key = custKey(String(payload.phone || ''), String(payload.name || ''));
  if (!key || key === 'n:') throw new Error('Whose statement?');
  const days = Math.min(3650, Math.max(7, Math.round(num(payload.days)) || 90));
  const nowMs = ctx.now.getTime();
  const from = new Date(nowMs - days * DAY_MS);

  const sl = await salesLog(ctx);
  const inv = {};
  let name = '', phone = '';
  // the same reading of the sales log as the dues list, so the two can never disagree
  const same = sameOrder(sl);
  for (const row of sl) {
    const rawId = str(row[SL.order_id]);
    if (!rawId || /^RTN-/.test(rawId)) continue;
    if (custKey(String(row[SL.customer_contact] || ''), String(row[SL.customer_name] || '')) !== key) continue;
    const id = same[rawId] || rawId;               // an old split sale is one sale
    const o = inv[id] || (inv[id] = { id, when: asDate(row[SL.timestamp]), grand: 0, onSheet: 0, units: 0, settled: false });
    o.grand = Math.max(o.grand, num(row[SL.grand_total]));
    o.onSheet = Math.max(o.onSheet, num(row[SL.advance_paid]));
    o.units += Math.max(0, num(row[SL.quantity]));
    if (str(row[SL.payment_status]).toLowerCase() === 'paid') o.settled = true;
    name = str(row[SL.customer_name]) || name;
    phone = str(row[SL.customer_contact]) || phone;
  }

  const entries = [];
  for (const k of Object.keys(inv)) {
    entries.push({ when: inv[k].when, text: 'Invoice ' + k + ' (' + inv[k].units + ' item' + (inv[k].units === 1 ? '' : 's') + ')',
                   ref: k, debit: inv[k].grand, credit: 0 });
  }
  const ledger = {};
  let advance = 0;
  for (const v of await paymentsTab(ctx)) {
    let oid = str(v[PAY.order_id]);
    const amt = num(v[PAY.amount]), method = String(v[PAY.method] || '');
    const note = String(v[PAY.note] || '');
    oid = same[oid] || oid;
    if (!oid) {                                   // money held on the account, not on an invoice
      const m = /\[acct:([^\]]+)\]/.exec(note);
      if (m && m[1] === key) advance += amt;
      continue;
    }
    if (!inv[oid] || !amt) continue;
    ledger[oid] = (ledger[oid] || 0) + amt;
    const label = method === 'Returned' ? 'Goods returned'
      // the 29 Sep clean-up: money that had been paid but never marked
      : method === 'Adjusted' && /cutover/i.test(String(v[PAY.recorded_by] || '')) ? 'Paid – records brought up to date'
      : method === 'Adjusted' ? 'Adjustment'
      : method === 'Advance' ? (amt > 0 ? 'Paid from advance' : 'Moved to advance')
      : method === 'Undone' ? 'Payment taken back'
      : amt > 0 ? 'Payment – ' + method : 'Refund – ' + method;
    entries.push({ when: asDate(v[PAY.timestamp]), text: label, ref: oid,
                   debit: amt < 0 ? -amt : 0, credit: amt > 0 ? amt : 0 });
  }
  // what the sheet itself recorded as paid, where the ledger has less
  for (const k2 of Object.keys(inv)) {
    // a sale marked Paid was paid in full, whatever the ledger holds; otherwise what the sheet says was received
    const gotOnSheet = inv[k2].settled ? inv[k2].grand : inv[k2].onSheet;
    const extra = gotOnSheet - Math.max(ledger[k2] || 0, 0);
    if (extra > 0.5) entries.push({ when: inv[k2].when, text: 'Paid at the time of sale', ref: k2, debit: 0, credit: extra });
  }
  entries.sort((a, b) => {
    const x = a.when ? a.when.getTime() : 0, y = b.when ? b.when.getTime() : 0;
    return x - y || (b.debit - a.debit);
  });

  let opening = 0, bal = 0, totalDebit = 0, totalCredit = 0;
  const rows = [];
  for (const e of entries) {
    bal = Math.round((bal + e.debit - e.credit) * 100) / 100;
    if (e.when && e.when.getTime() < from.getTime()) { opening = bal; continue; }
    totalDebit += e.debit; totalCredit += e.credit;
    rows.push({ date: e.when ? formatDate(e.when, 'd MMM yyyy') : '', text: e.text, ref: e.ref,
                debit: Math.round(e.debit), credit: Math.round(e.credit), balance: Math.round(bal) });
  }
  const open = [];
  for (const k3 of Object.keys(inv)) {
    const owed = inv[k3].settled ? 0 : Math.round(inv[k3].grand - Math.max(ledger[k3] || 0, inv[k3].onSheet));
    if (owed > 0) {
      open.push({ id: k3, owed, date: inv[k3].when ? formatDate(inv[k3].when, 'd MMM yyyy') : '',
                  days: inv[k3].when ? Math.floor((nowMs - inv[k3].when.getTime()) / DAY_MS) : 0 });
    }
  }
  open.sort((a, b) => b.days - a.days);
  const biz = str(ctx.s && ctx.s.businessName);
  return { business: biz, customer: name || String(payload.name || ''), phone: phone || String(payload.phone || ''),
           from: formatDate(from, 'd MMM yyyy'), to: formatDate(ctx.now, 'd MMM yyyy'),
           days, opening: Math.round(opening), rows, closing: Math.round(bal),
           totalDebit: Math.round(totalDebit), totalCredit: Math.round(totalCredit),
           advance: Math.round(advance), open };
}

/** erpHtml_ (ERP:7399) */
function h(s) {
  return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** erpStatementPdf (ERP:9013): the statement as a PDF, saved beside the invoices. */
export async function erpStatementPdf(ctx, payload) {
  const s = await erpCustomerStatement(ctx, payload);
  const html = '<html><body style="font-family:Arial,sans-serif;font-size:11px;color:#111">' +
    '<h2 style="margin:0">' + h(s.business) + '</h2><h3 style="margin:4px 0 10px">Statement of account</h3>' +
    '<p><b>' + h(s.customer) + '</b>' + (s.phone ? ' &middot; ' + h(s.phone) : '') + '<br>' + h(s.from) + ' to ' + h(s.to) + '</p>' +
    '<table width="100%" cellpadding="5" cellspacing="0" border="1" style="border-collapse:collapse">' +
    '<tr style="background:#eee"><th align="left">Date</th><th align="left">Details</th><th align="right">Charged</th>' +
    '<th align="right">Paid</th><th align="right">Balance</th></tr>' +
    '<tr><td></td><td>Balance brought forward</td><td></td><td></td><td align="right">' + s.opening + '</td></tr>' +
    s.rows.map((r) => '<tr><td>' + h(r.date) + '</td><td>' + h(r.text) + (r.ref && r.text.indexOf(r.ref) < 0 ? ' &middot; ' + h(r.ref) : '') +
        '</td><td align="right">' + (r.debit || '') + '</td><td align="right">' + (r.credit || '') + '</td><td align="right">' + r.balance + '</td></tr>').join('') +
    '<tr><td colspan="4" align="right"><b>Balance due</b></td><td align="right"><b>' + s.closing + '</b></td></tr></table>' +
    (s.advance > 0 ? '<p>Advance held for you: <b>' + s.advance + '</b></p>' : '') +
    (s.open.length ? '<p>Unpaid invoices: ' + s.open.map((o) => h(o.id) + ' (' + o.owed + ')').join(', ') + '</p>' : '') +
    '</body></html>';
  const name = 'Statement_' + String(s.customer || s.phone).replace(/[^\w\-]+/g, '_') + '_' +
               formatDate(ctx.now, 'yyyy-MM-dd') + '.pdf';
  const bytes = await renderPdf(ctx, html);
  await deleteFile(ctx, 'invoices', name);          // same-day statement is replaced
  const f = await saveFile(ctx, 'invoices', name, bytes, 'application/pdf');
  return { url: f.url, id: f.id, name };
}

// --------------------------------------------------------------- reminders

/** erpDueReminded (ERP:9054): write down that a reminder was sent. */
export async function erpDueReminded(ctx, payload) {
  payload = payload || {};
  const key = custKey(String(payload.phone || ''), String(payload.name || ''));
  if (!key || key === 'n:') throw new Error('Whose reminder?');
  await ctx.tx`
    insert into due_reminders (business_id, reminded_at, customer_key, customer, phone, due, reminded_by)
    values (${ctx.biz}, ${ctx.now}, ${key}, ${String(payload.name || '')}, ${String(payload.phone || '')},
            ${Math.round(num(payload.due))}, ${who(ctx)})`;
  return { ok: true };
}

// ------------------------------------------------------- legacy payment

/** erpRecordPayment (ERP:4912): money received against one invoice. */
export async function erpRecordPayment(ctx, payload) {
  const oid = str(payload && payload.orderId);
  if (!oid) throw new Error('Which invoice?');
  const amount = num(payload && payload.amount);
  if (!(amount > 0)) throw new Error('How much was received?');

  const rows = await salesLog(ctx);
  let grand = 0, customer = '', found = false;
  for (const r of rows) {
    if (str(r[SL.order_id]) !== oid) continue;
    found = true;
    grand = Math.max(grand, num(r[SL.grand_total]));
    if (!customer) customer = str(r[SL.customer_name]);
  }
  if (!found) throw new Error('No invoice called ' + oid + '.');

  const already = (await paidByOrder(ctx))[oid] || 0;
  const owed = round2(grand - already);
  if (owed <= 0) throw new Error('That invoice is already settled.');
  if (amount > owed + 0.5) {
    throw new Error('That is more than is owed. ' + oid + ' has ' + owed.toFixed(0) + ' outstanding.');
  }

  await lock(ctx, 'payments');
  await addPayment(ctx, {
    id: 'P' + stamp(ctx.now), order: oid, customer, at: new Date(), amount,
    method: String((payload && payload.method) || 'Cash'),
    note: String((payload && payload.note) || ''),
  });
  await syncInvoiceStatus(ctx, oid);
  return { ok: true, orderId: oid, received: amount,
           stillOwed: round2(owed - amount), dues: await erpDues(ctx) };
}

// ------------------------------------------------------------ Tools screen

/**
 * erpMergeCustomers (ERP:2622): merge customer rows that are the same person
 * (same last 10 digits). The oldest row wins and gains the best name /
 * address / email and the summed order counts; the rest are copied to
 * customers_duplicates_backup, then deleted. apply=false changes nothing.
 */
export async function mergeCustomers(ctx, apply) {
  const data = await customerRows(ctx);
  if (data.length < 2) return { ok: true, groups: 0, removed: 0, applied: false };

  const groups = {};
  for (const c of data) {
    const key = normalizePhone(c.phone);
    if (!key) continue;                       // no usable phone: left alone
    if (!groups[key]) groups[key] = [];
    groups[key].push(c);                      // already in sheet (write) order
  }
  const dupKeys = [];
  for (const k in groups) if (groups[k].length > 1) dupKeys.push(k);

  if (!apply) {
    const preview = [];
    for (let p = 0; p < dupKeys.length && p < 15; p++) {
      const rowsP = groups[dupKeys[p]];
      preview.push({ phone: dupKeys[p], name: str(rowsP[0].name), copies: rowsP.length });
    }
    let extra = 0;
    for (const k of dupKeys) extra += groups[k].length - 1;
    return { ok: true, applied: false, groups: dupKeys.length, removed: extra, preview };
  }

  let removed = 0, merged = 0;
  for (const k of dupKeys) {
    const rows = groups[k];
    const keep = rows[0];
    const kv = { name: keep.name, address: keep.address, email: keep.email,
                 orders: num(keep.total_orders), spent: num(keep.total_spent) };
    for (let r = 1; r < rows.length; r++) {
      const row = rows[r];
      // best name / address / email: keep the longest non-empty one
      if (str(row.name).length > str(kv.name).length) kv.name = row.name;
      if (str(row.address).length > str(kv.address).length) kv.address = row.address;
      if (!str(kv.email) && str(row.email)) kv.email = row.email;
      kv.orders += num(row.total_orders);
      kv.spent += num(row.total_spent);

      // archive first, then move anything pointing at it, then remove it
      await ctx.tx`
        insert into customers_duplicates_backup (business_id, original_id, merged_into, customer_no, name,
          phone, email, address, type, total_orders, total_spent, date_added, note, last_order_at,
          last_product, source, status, customer_key, backed_up_by)
        values (${ctx.biz}, ${row.id}, ${keep.id}, ${row.customer_no}, ${row.name}, ${row.phone}, ${row.email},
          ${row.address}, ${row.type}, ${row.total_orders}, ${row.total_spent}, ${row.created_at}, ${row.note},
          ${row.last_order_at}, ${row.last_product}, ${row.source}, ${row.status}, ${row.customer_key}, ${who(ctx)})`;
      await ctx.tx`update invoices set customer_id = ${keep.id}
                   where business_id = ${ctx.biz} and customer_id = ${row.id}`;
      await ctx.tx`delete from customers where id = ${row.id} and business_id = ${ctx.biz}`;
      removed++;
    }
    // always store the phone in the readable 0-prefixed form
    await ctx.tx`
      update customers set name = ${kv.name}, address = ${kv.address}, email = ${kv.email},
        total_orders = ${kv.orders}, total_spent = ${kv.spent},
        phone = ${formatBdPhone(str(keep.phone))}, updated_at = now()
      where id = ${keep.id}`;
    merged++;
  }
  forget(ctx, 'CUSTOMERS');
  return { ok: true, applied: true, groups: merged, removed, backup: 'CUSTOMERS_DUPLICATES_BACKUP' };
}

export async function erpMergeCustomers(ctx, apply) { return mergeCustomers(ctx, apply); }

/** erpFixCustomerPhones (ERP:2718): put the leading 0 back on every stored number. */
export async function fixCustomerPhones(ctx) {
  let n = 0;
  for (const c of await customerRows(ctx)) {
    const cur = str(c.phone);
    if (!cur) continue;
    const nxt = formatBdPhone(cur);
    if (nxt !== cur) {
      await ctx.tx`update customers set phone = ${nxt}, updated_at = now() where id = ${c.id}`;
      n++;
    }
  }
  if (n) forget(ctx, 'CUSTOMERS');
  return { ok: true, fixed: n };
}

/**
 * erpTool('fixPhones') (ERP:1718): formatBdPhone_ over CUSTOMERS.contact_number
 * and SALES_LOG.customer_contact. Counts like the sheet did: one per
 * customer row and one per SALES_LOG row (invoice line) changed.
 * Returns the sentence the Tools screen shows.
 */
export async function fixPhones(ctx) {
  let fixed = (await fixCustomerPhones(ctx)).fixed;
  const inv = await ctx.tx`
    select i.id, i.customer_phone,
           (select count(*)::int from invoice_lines l where l.invoice_id = i.id) as lines
    from invoices i where i.business_id = ${ctx.biz}`;
  let touched = false;
  for (const r of inv) {
    const cur = str(r.customer_phone);
    if (!cur) continue;
    const nxt = formatBdPhone(cur);
    if (nxt === cur) continue;
    await ctx.tx`update invoices set customer_phone = ${nxt} where id = ${r.id}`;
    fixed += Math.max(1, Number(r.lines) || 0);
    touched = true;
  }
  if (touched) forget(ctx, 'SALES_LOG');
  return fixed ? (fixed + ' phone number(s) corrected.') : 'All phone numbers already correct.';
}

export const HANDLERS = {
  erpCustomers,
  erpCustomerList,
  erpSaveCustomer,
  erpCustomerStatement,
  erpStatementPdf,
  erpDueReminded,
  erpRecordPayment,
  erpMergeCustomers,
};
