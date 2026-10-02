// The sheet ERP's tabs, as rows in their original column order.
//
// The original functions loop over `sl.getRange(2, 1, last - 1, 20)
// .getValues()` and read `rows[i][16]` for the grand total. Handing the
// ported code the same rows (built from the tables, in the order they were
// written) lets each function be ported line by line instead of re-imagined,
// which is where the original's screens drifted apart from each other.
// Rows are memoised per call; anything that writes calls forget().

// SALES_LOG column indexes (Code:2889)
export const SL = {
  order_id: 0, timestamp: 1, customer_name: 2, customer_contact: 3, customer_address: 4,
  sku: 5, product_name: 6, quantity: 7, unit_price: 8, total: 9, payment_method: 10,
  payment_status: 11, delivery_status: 12, notes: 13, discount: 14, delivery_charge: 15,
  grand_total: 16, advance_paid: 17, due_amount: 18, customer_source: 19,
  // not sheet columns: where the row lives
  invoice_id: 20, line_id: 21,
};

export function forget(ctx, ...names) {
  for (const n of names) delete ctx.memo['tab:' + n];
  if (names.includes('SALES_LOG') || names.includes('TXN_LOG')) delete ctx.memo.catalog;
}

async function memo(ctx, name, load) {
  const k = 'tab:' + name;
  if (!ctx.memo[k]) ctx.memo[k] = await load();
  return ctx.memo[k];
}

/** SALES_LOG: one row per invoice line, return notes (RTN-) included. */
//
// Nearly every screen reads the whole log, and reading it is most of what a
// call costs once there are thousands of invoices. So the rows are kept in
// memory between calls and reused for as long as the log has not changed.
// "Changed" is asked of the database each time, cheaply: how many invoices and
// lines there are, and the newest change to any of them (xmin). A sale, an
// edit, a return or a rolled-back attempt all move that fingerprint, so a kept
// copy can never be served after the books have moved. The rows are frozen:
// a handler that tried to alter them would fail loudly instead of quietly
// changing what the next caller sees.
const KEPT_LOG = new Map();           // business id -> { mark, rows, at }
const KEPT_MAX_ROWS = 150000, KEPT_MAX_BUSINESSES = 20;

async function salesLogMark(ctx) {
  const r = await ctx.tx`
    select (select count(*)::text || ':' || coalesce(max(xmin::text::bigint), 0)::text from invoices where business_id = ${ctx.biz})
        || '|' ||
           (select count(*)::text || ':' || coalesce(max(xmin::text::bigint), 0)::text from invoice_lines where business_id = ${ctx.biz}) as mark`;
  return String(r[0].mark);
}

export function salesLog(ctx) {
  return memo(ctx, 'SALES_LOG', async () => {
    const mark = await salesLogMark(ctx);
    const hit = KEPT_LOG.get(ctx.biz);
    if (hit && hit.mark === mark) { hit.at = Date.now(); return hit.rows; }
    const rows = await ctx.tx`
      select i.invoice_no, i.created_at, i.customer_name, i.customer_phone, i.customer_address,
             l.sku, l.name, l.qty, l.unit_price, l.line_total, i.payment_method, i.payment_status,
             i.delivery_status, i.note, i.discount, i.delivery_charge, i.grand_total,
             i.advance_paid, i.due_amount, i.source, i.id, l.id
      from invoice_lines l join invoices i on i.id = l.invoice_id
      where i.business_id = ${ctx.biz}
      order by i.seq, l.line_no, l.id`.values();
    if (rows.length <= KEPT_MAX_ROWS) {
      for (const r of rows) Object.freeze(r);
      Object.freeze(rows);
      KEPT_LOG.set(ctx.biz, { mark, rows, at: Date.now() });
      if (KEPT_LOG.size > KEPT_MAX_BUSINESSES) {
        let oldest = null;
        for (const [k, v] of KEPT_LOG) if (!oldest || v.at < oldest[1].at) oldest = [k, v];
        if (oldest) KEPT_LOG.delete(oldest[0]);
      }
    }
    return rows;
  });
}

// PAYMENTS (ERP:4882): payment_id, order_id, customer, timestamp, amount, method, note, recorded_by
export const PAY = { payment_id: 0, order_id: 1, customer: 2, timestamp: 3, amount: 4, method: 5, note: 6, recorded_by: 7 };

export function paymentsTab(ctx) {
  return memo(ctx, 'PAYMENTS', () => ctx.tx`
    select payment_no, coalesce(invoice_no, ''), customer, paid_at, amount, method, note, recorded_by
    from payments where business_id = ${ctx.biz}
    order by seq`.values());
}

// CUSTOMERS (Code:326, 1999): 0 customer_id .. 13 customer_status, + 14 row id
export const CU = {
  customer_id: 0, customer_name: 1, contact_number: 2, email: 3, address: 4, customer_type: 5,
  total_orders: 6, total_spent: 7, date_added: 8, notes: 9, last_order_date: 10,
  last_product_bought: 11, customer_source: 12, customer_status: 13, id: 14,
};

export function customersTab(ctx) {
  return memo(ctx, 'CUSTOMERS', () => ctx.tx`
    select customer_no, name, phone, email, address, type, total_orders, total_spent,
           created_at, note, last_order_at, last_product, source, status, id
    from customers where business_id = ${ctx.biz}
    order by seq`.values());
}

// RETURNS (ERP:7139): return_id, returned_at, invoice_no, sku, product, qty, condition, value, money, customer, reason, recorded_by
export function returnsTab(ctx) {
  return memo(ctx, 'RETURNS', () => ctx.tx`
    select return_no, returned_at, invoice_no, sku, product, qty, condition, value, money,
           customer, reason, recorded_by
    from returns where business_id = ${ctx.biz}
    order by seq`.values());
}

// COURIER_LOG (ERP:5929)
export function courierLog(ctx) {
  return memo(ctx, 'COURIER_LOG', () => ctx.tx`
    select booked_at, invoice_no, coalesce(consignment_id, ''), customer, phone, address,
           cod_amount, invoice_total, booked_by, coalesce(note, ''), id
    from courier_log where business_id = ${ctx.biz}
    order by seq`.values());
}

/** erpDate_: Date, or null. */
export function asDate(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v;
  if (typeof v === 'string' && v) { const d = new Date(v); return isNaN(d.getTime()) ? null : d; }
  return null;
}

export function str(v) { return String(v == null ? '' : v).trim(); }
