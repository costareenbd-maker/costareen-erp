// Stage 1d (docs/PLATFORM-BLUEPRINT.md section 5 and 7): the provider's disclosed, logged compliance view,
// and the company's own view of the provider's connection.
//
// Provider (platform admin):
//   erpComplianceView({id, what, reason, from?, to?})   read-only: stock | invoices | payments | money of one company.
//       Every view is written to that company's own activity log ("Provider (compliance check)") and to the
//       provider's audit list (erp_compliance_log). A reason of at least 10 characters is required.
//   erpComplianceLog()                                  the provider's audit list
// Company (owner, inside its ERP):
//   erpProviderKey()   the provider's connection - verified, what it is for, when last checked - the database
//                      logins (unknown ones flagged) and every compliance check made on this company

const str = (v) => String(v == null ? '' : v).trim();
const WHAT = { stock: 'Stock', invoices: 'Invoices', payments: 'Payments', money: 'Money movements' };
const LIMIT = 1000;
// logins Supabase makes in every project; anything else that can log in is unknown
const KNOWN_LOGINS = new Set(['postgres', 'authenticator', 'pgbouncer', 'supabase_admin', 'supabase_auth_admin', 'supabase_storage_admin',
  'supabase_replication_admin', 'supabase_read_only_user', 'supabase_functions_admin', 'supabase_realtime_admin', 'supabase_etl_admin',
  'dashboard_user', 'pgsodium_keyholder', 'pgsodium_keyiduser', 'pgsodium_keymaker', 'supabase_privileged_role', 'cli_login_postgres']);

async function needAdmin(ctx) {
  const r = await ctx.sql`select 1 from platform_admins where user_id = ${ctx.s.userId}`;
  if (!r.length) throw new Error('Only the platform admin makes compliance checks.');
}
const day = (v, end) => {
  const s = str(v);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  return new Date(s + (end ? 'T23:59:59.999+06:00' : 'T00:00:00+06:00'));
};

export async function erpComplianceView(ctx, payload) {
  await needAdmin(ctx);
  const p = payload || {};
  const id = str(p.id), what = str(p.what), reason = str(p.reason).slice(0, 300);
  if (!WHAT[what]) throw new Error('Choose what to view: stock, invoices, payments or money movements.');
  if (reason.length < 10) throw new Error('Write the reason for this check (at least 10 characters). The company sees it in its activity log.');
  const ins = (await ctx.sql`select i.company from erp_installs i join erp_tenants t on t.id = i.id where i.id::text = ${id}`)[0];
  if (!ins) throw new Error('That company is not on the provider’s server.');
  if (!ctx.deps.tenantDeps) throw new Error('This server does not run company ERPs.');
  const db = (await ctx.deps.tenantDeps(id, { any: true })).sql;   // a switched-off company can be checked too
  const from = day(p.from) || new Date(Date.now() - 90 * 86400e3), to = day(p.to, true) || new Date();
  let columns, rows;
  if (what === 'stock') {
    columns = ['Business', 'SKU', 'Product', 'Category', 'In stock', 'Sell price', 'Cost price', 'Status'];
    rows = (await db`select b.name, p.sku, p.name as product_name, p.category, coalesce(ps.stock, 0) as stock, p.sell_price, p.cost_price, p.status
                     from products p join businesses b on b.id = p.business_id left join product_stock ps on ps.product_id = p.id
                     order by b.name, p.name limit ${LIMIT + 1}`).map((r) => [r.name, r.sku, r.product_name, r.category, Number(r.stock), Number(r.sell_price), Number(r.cost_price), r.status]);
  } else if (what === 'invoices') {
    columns = ['Business', 'Invoice', 'Date', 'Customer', 'Phone', 'Total', 'Paid', 'Due', 'Status', 'Voided'];
    rows = (await db`select b.name, i.invoice_no, i.created_at, i.customer_name, i.customer_phone, i.grand_total, i.advance_paid, i.due_amount, i.payment_status, i.voided_at
                     from invoices i join businesses b on b.id = i.business_id where i.created_at between ${from} and ${to}
                     order by i.created_at desc limit ${LIMIT + 1}`).map((r) => [r.name, r.invoice_no, r.created_at, r.customer_name, r.customer_phone, Number(r.grand_total), Number(r.advance_paid), Number(r.due_amount), r.payment_status, r.voided_at ? 'voided' : '']);
  } else if (what === 'payments') {
    columns = ['Business', 'Payment', 'Date', 'Invoice', 'Customer', 'Amount', 'Method', 'Note', 'Recorded by'];
    rows = (await db`select b.name, y.payment_no, y.paid_at, y.invoice_no, y.customer, y.amount, y.method, y.note, y.recorded_by
                     from payments y join businesses b on b.id = y.business_id where y.paid_at between ${from} and ${to}
                     order by y.paid_at desc limit ${LIMIT + 1}`).map((r) => [r.name, r.payment_no, r.paid_at, r.invoice_no, r.customer, Number(r.amount), r.method, r.note, r.recorded_by]);
  } else {
    // money in (payments), money out (expenses), and moves between accounts (transfers, corrections), in one list
    columns = ['Business', 'Date', 'Kind', 'Amount', 'Account / method', 'Note', 'By', 'Struck out'];
    const pay = await db`select b.name, y.paid_at as at, 'Payment in' as kind, y.amount, coalesce(y.method, '') as acc, coalesce(y.invoice_no, '') || ' ' || coalesce(y.customer, '') as note, y.recorded_by as by, '' as voided
                         from payments y join businesses b on b.id = y.business_id where y.paid_at between ${from} and ${to}`;
    const exp = await db`select b.name, e.recorded_at as at, 'Expense out' as kind, -e.amount as amount, coalesce(e.category, '') as acc, coalesce(e.description, '') as note, e.recorded_by as by, coalesce(e.voided, '') as voided
                         from expenses e join businesses b on b.id = e.business_id where e.recorded_at between ${from} and ${to}`;
    let mv = [];
    try {
      mv = await db`select b.name, m.at, case when m.kind = 'transfer' then 'Transfer' else 'Correction' end as kind, m.amount, a.name as acc, coalesce(m.note, '') as note, m.by, coalesce(m.voided, '') as voided
                    from money_moves m join businesses b on b.id = m.business_id join money_accounts a on a.id = m.account_id where m.at between ${from} and ${to}`;
    } catch (_) { mv = []; }
    rows = [...pay, ...exp, ...mv].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, LIMIT + 1)
      .map((r) => [r.name, r.at, r.kind, Number(r.amount), r.acc, str(r.note), r.by, r.voided]);
  }
  const truncated = rows.length > LIMIT; if (truncated) rows = rows.slice(0, LIMIT);
  // written where the company reads it, and in the provider's own list
  const detail = WHAT[what] + (what === 'stock' ? '' : ' (' + from.toISOString().slice(0, 10) + ' to ' + to.toISOString().slice(0, 10) + ')') + ' - reason: ' + reason;
  for (const b of await db`select id from businesses`) {
    await db`insert into erp_activity (business_id, who, role, action, detail) values (${b.id}, 'Provider (compliance check)', 'provider', 'compliance-view', ${detail})`;
  }
  await ctx.sql`insert into erp_compliance_log (install_id, what, reason, viewer, viewer_name, rows, period_from, period_to)
                values (${id}, ${what}, ${reason}, ${ctx.s.userId}, ${str(ctx.s.name)}, ${rows.length}, ${what === 'stock' ? null : from}, ${what === 'stock' ? null : to})`;
  return { company: ins.company, what, label: WHAT[what], columns, rows, truncated, logged: true };
}

export async function erpComplianceLog(ctx) {
  await needAdmin(ctx);
  return { items: await ctx.sql`select l.id, l.at, l.what, l.reason, l.viewer_name, l.rows, i.company
                                 from erp_compliance_log l left join erp_installs i on i.id = l.install_id order by l.at desc limit 100` };
}

/** The company's Security page: the provider's connection, the database logins, and the provider's checks. */
export async function erpProviderKey(ctx) {
  const ins = ctx.deps && ctx.deps.install;
  if (!ins || !ins.bridged) return { bridged: false };
  let logins = [];
  try {
    logins = (await ctx.sql`select rolname from pg_roles where rolcanlogin order by rolname`)
      .map((r) => ({ name: r.rolname, known: KNOWN_LOGINS.has(r.rolname) || /^supabase_|^pgsodium/.test(r.rolname) }));
  } catch (_) { logins = []; }
  const checks = (await ctx.tx`select detail, at from erp_activity where business_id = ${ctx.biz} and action = 'compliance-view' order by at desc limit 50`)
    .map((r) => ({ at: r.at, detail: str(r.detail) }));
  return {
    bridged: true, verified: true, fingerprint: str(ctx.deps.providerFingerprint),
    uses: ['Runs this ERP for you (your data stays in your own Supabase account)', 'Installs updates', 'Checks for illegal use when needed - every check is listed below, with its reason'],
    logins, unknown: logins.filter((l) => !l.known).length, checks,
  };
}

export const HANDLERS = { erpComplianceView, erpComplianceLog, erpProviderKey };
