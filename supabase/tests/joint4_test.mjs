// Joint stock across databases: the partner company runs on its OWN database (the bridge); the pool stays
// in the provider's. A second database in the same test server stands in for the partner's Supabase.
// Covers: switch, join, selling (stock, copy, money), a failure halfway (the copy is taken out again),
// returns, the nightly safety net, the month-end sums, privacy both ways.
import { sql, FIX, owner, check, done, deps } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import path from 'node:path';
import fs from 'node:fs';
import { fnDir } from './harness.mjs';
const require = createRequire(path.join(process.env.ERP_NODE_CWD || process.cwd(), 'package.json'));
const postgres = require('postgres');
const { connect } = await import(pathToFileURL(path.join(fnDir, 'db.js')));
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const J = await import(pathToFileURL(path.join(fnDir, 'handlers', 'joint.js')));

// ---- the partner's own database --------------------------------------------------------------------------
await sql.unsafe('create database partnerdb');
const T_URL = process.env.DB_URL.replace(/\/[^/?]+(\?|$)/, '/partnerdb$1');
const raw = postgres(T_URL, { max: 1, onnotice: () => {} });
await raw.unsafe(`
create schema auth;
create table auth.users (id uuid primary key, email text, raw_user_meta_data jsonb);
alter table auth.users add column last_sign_in_at timestamptz;
create table auth.sessions (id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), user_agent text, ip text);
create table auth.mfa_factors (id uuid primary key default gen_random_uuid(), user_id uuid not null, status text);
create function auth.uid() returns uuid language sql stable as $$
  select nullif(nullif(current_setting('request.jwt.claims', true),'')::jsonb->>'sub','')::uuid $$;
grant usage on schema auth to authenticated, anon;
grant execute on function auth.uid() to authenticated, anon;
create function public.gen_random_bytes(n int) returns bytea language sql volatile as $$
  select decode(substr(md5(random()::text) || md5(random()::text), 1, n * 2), 'hex') $$;`);
const SQL_DIR = path.join(fnDir, '..', '..');
for (const f of fs.readdirSync(SQL_DIR).filter((n) => /^\d{3}_.+\.sql$/.test(n)).sort()) {
  const text = fs.readFileSync(path.join(SQL_DIR, f), 'utf8');
  if (/^\s*--\s*control-only/.test(text)) continue;                 // what the installer never copies
  await raw.unsafe(text.replace('create extension if not exists "pgcrypto";', ''));
}
const PU = crypto.randomUUID(), PS = crypto.randomUUID();
await raw`insert into auth.users (id, email, raw_user_meta_data) values (${PU}, 'friend@t.test', ${raw.json({ full_name: 'Friend' })}), (${PS}, 'staff@t.test', ${raw.json({ full_name: 'Staff' })})`;
const TB = (await raw.begin(async (t) => {
  await t`select set_config('request.jwt.claims', ${JSON.stringify({ sub: PU })}, true)`;
  return t`select create_business('Friend Filaments') as id`;
}))[0].id;
await raw`insert into memberships (business_id, user_id, role) values (${TB}, ${PS}, 'sales')`;
await raw`insert into erp_people (user_id, home_business, name, code) values (${PS}, ${TB}, 'Sumi', '444444')`;
await raw`insert into erp_devices (device_id, user_id, status) values ('dev-fsales', ${PS}, 'approved')`;
await raw.end();

// the company copy on the provider's side
const TID = '00000000-0000-4000-8000-0000000000f1';
await sql`insert into erp_installs (id, company, owner_name, owner_email, status, step) values (${TID}, 'Friend Filaments', 'Friend', 'friend@t.test', 'active', 'done')`;
await sql`insert into erp_tenants (id, url, anon_key, secret_enc) values (${TID}, 'https://friend.test', 'ANON', 'sealed')`;
const tsql = connect(postgres, T_URL), tAux = connect(postgres, T_URL, { max: 1 });
const tdeps = { ...deps, sql: tsql, sqlAux: tAux, control: deps.control, install: { id: TID, bridged: true } };
deps.tenantDeps = async (id) => { if (id !== TID) throw new Error('no such company'); return tdeps; };
const friend = (name, args) => erpCall(tdeps, { name, args, authHeader: 'Bearer owner:' + PU });
const fsales = (name, args) => erpCall(tdeps, { name, args, token: { code: '444444', device: 'dev-fsales' } });
const A = FIX.B;
await sql`insert into joint_flags (business_id) values (${A}) on conflict do nothing`;
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const poolStock = async () => Number((await sql`select coalesce(sum(ps.stock), 0) as s from products p left join product_stock ps on ps.product_id = p.id join businesses b on b.id = p.business_id where b.is_pool`)[0].s);

// ---- the switch for a company copy ----------------------------------------------------------------------
let r = await friend('erpHello', []);
check('copy: joint off at first', r.ok && r.result.joint === false, r);
r = await friend('erpJoint', [{}]);
check('...page off', r.ok && r.result.on === false, r);
r = await friend('erpPlatformJointCopy', [{ id: TID, on: true }]);
check('a company copy cannot switch itself on', !r.ok, r);
r = await owner('erpPlatformJointCopy', [{ id: TID, on: true }]);
check('the provider switches it on (Platform > Company copies)', r.ok && r.result.joint === true, r);
r = await owner('erpInstalls', []);
check('...and sees it in the list', r.ok && r.result.installs.find((i) => i.id === TID).joint === true, r.ok);
r = await friend('erpHello', []);
check('copy: joint on', r.ok && r.result.joint === true, r);

// ---- set-up: Costareen starts, the friend joins from his own database ----------------------------------------
r = await owner('erpJointStart', [{ action: 'create', name: 'Polymaker JV', displayName: 'Costareen' }]);
const POOL = r.result.created.id, CODE = r.result.created.code;
r = await friend('erpJointStart', [{ action: 'create', name: 'Mine' }]);
check('a company on its own database does not start a pool (asks for a code)', !r.ok && /invite code/.test(r.error), r);
r = await friend('erpJointStart', [{ action: 'join', code: 'NOPE' }]);
check('bad code refused', !r.ok && /invalid, used or expired/.test(r.error), r);
r = await friend('erpJointStart', [{ action: 'join', code: CODE }]);
check('the friend joins from his own database', r.ok && r.result.joined.id === POOL && r.result.joined.name === 'Polymaker JV', r);
const SH = (await sql`select id, name from businesses where remote_tenant = ${TID} and remote_business = ${TB}`)[0];
check('a stand-in row stands for him in the provider\'s database (no login, no members)', !!SH && SH.name === 'Friend Filaments' &&
  (await sql`select count(*)::int as n from memberships where business_id = ${SH.id}`)[0].n === 0, SH);
r = await friend('erpJointStart', [{ action: 'join', code: CODE }]);
check('a code works once', !r.ok, r);
r = await friend('erpJoint', [{}]);
check('his page: the pool, both partners, the book (he is an owner of it)', r.ok && r.result.pools.length === 1 && r.result.pools[0].partners.length === 2 &&
  r.result.money === true && r.result.remote === true && r.result.book.me === SH.id, r.result);
r = await fsales('erpJoint', [{}]);
check('his sales staff have no page', !r.ok, r);

// ---- stock and capital, from both sides ---------------------------------------------------------------------
await owner('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PLA-BLK', name: 'Polymaker PLA Black', retail: 2000, floor: 1700, cost: 1400 }]);
r = await friend('erpJointProduct', [{ pool: POOL, isNew: true, sku: 'PM-PETG-WHT', name: 'Polymaker PETG White', retail: 2400, floor: 2000, cost: 1600 }]);
check('he adds a joint product from his side', r.ok && r.result.stock.length === 2, r);
await owner('erpJointReceive', [{ pool: POOL, sku: 'PM-PLA-BLK', qty: 10, unitCost: 1400, paidBy: A }]);
r = await friend('erpJointReceive', [{ pool: POOL, sku: 'PM-PETG-WHT', qty: 5, unitCost: 1600 }]);
check('he receives stock, paid by him by default', r.ok && (await sql`select paid_by from stock_movements where business_id = ${POOL} and kind = 'RECEIVE' order by created_at desc limit 1`)[0].paid_by === SH.id, r);
await owner('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: A, amount: 14000 }]);
r = await friend('erpJointBook', [{ pool: POOL, kind: 'capital_in', partner: SH.id, amount: 8000 }]);
check('he writes his capital', r.ok && r.result.book.report.to_date.capital === 22000, r.ok ? r.result.book.report.to_date : r);

// ---- his staff sell, on his own invoice, in his own database --------------------------------------------------
r = await fsales('erpJointCatalog', []);
const JS = r.result.products.find((p) => p.code === 'PM-PLA-BLK');
check('his staff see the joint products (no cost)', r.ok && r.result.products.length === 2 && JS.stock === 10 && JSON.stringify(r).indexOf('1400') < 0, r);
r = await fsales('erpCreateInvoice', [{ customer: { name: 'Friend Customer', phone: '01912345678' }, items: [{ sku: JS.sku, qty: 3 }], payMode: 'part', paidNow: 3000, paymentMethod: 'Cash' }]);
check('his staff save the sale', r.ok && r.result.grandTotal === 6000 && r.result.joint.length === 1, r);
const FINV = r.result.invoiceNo;
check('pool stock down 3 (provider\'s database)', await poolStock() === 12, await poolStock());   // 10 PLA + 5 PETG - 3
const fl = await tsql`select l.sku, l.pool_id, l.product_id, l.unit_cost from invoice_lines l join invoices i on i.id = l.invoice_id where i.business_id = ${TB} and i.invoice_no = ${FINV}`;
check('his invoice line: in HIS database, tied to the pool, no profit of his own', fl.length === 1 && fl[0].pool_id === POOL && fl[0].product_id === null && Number(fl[0].unit_cost) === 2000, fl);
const L1 = (await sql`select * from joint_sales where seller_invoice_no = ${FINV} and seller_business_id = ${SH.id}`)[0];
check('the pool\'s copy: confirmed once his save went through', !!L1 && L1.status === 'ok' && Number(L1.joint_total) === 6000, L1);
const M1 = (await sql`select sold_by, customer_name, grand_total from invoices where business_id = ${POOL} and invoice_no = ${L1.pool_invoice_no}`)[0];
check('...sold by his stand-in, no customer named', M1.sold_by === SH.id && M1.customer_name === 'Friend Filaments · ' + FINV && Number(M1.grand_total) === 6000, M1);
const poolMoney = async (no) => (await sql`select coalesce(sum(amount), 0) as s from payments where invoice_no = ${no} and method = 'Joint'`)[0].s * 1;
check('the pool\'s money: his 3000 of 6000, held by him', await poolMoney(L1.pool_invoice_no) === 3000 &&
  (await sql`select received_by from payments where invoice_no = ${L1.pool_invoice_no} and method = 'Joint'`)[0].received_by === SH.id);
r = await friend('erpSettleDue', [{ orderId: FINV, amount: 3000, method: 'bKash' }]);
check('he takes the rest: the pool has it all (worked out after his save)', r.ok && await poolMoney(L1.pool_invoice_no) === 6000, await poolMoney(L1.pool_invoice_no));
check('nothing of his customer reached the provider\'s database', (await sql`select count(*)::int as n from customers where name = 'Friend Customer'`)[0].n === 0 &&
  (await sql`select count(*)::int as n from invoices where customer_name = 'Friend Customer'`)[0].n === 0);
r = await fsales('erpCreateInvoice', [{ customer: { name: 'X', phone: '01912345678' }, items: [{ sku: JS.sku, qty: 1, discEach: 400 }], payMode: 'full' }]);
check('his staff are held to the floor price too', !r.ok && /floor price/.test(r.error), r);
r = await fsales('erpCreateInvoice', [{ customer: { name: 'X', phone: '01912345678' }, items: [{ sku: JS.sku, qty: 50 }], payMode: 'full' }]);
check('not more than the pool has', !r.ok && /Not enough stock/.test(r.error), r);
check('...nothing left behind in the pool', await poolStock() === 12 && (await sql`select count(*)::int as n from joint_sales`)[0].n === 1);

// ---- a failure AFTER the pool's copy was written: it is taken out again ------------------------------------------
const tdb = postgres(T_URL, { max: 1, onnotice: () => {} });
await tdb.unsafe(`create function public.boom() returns trigger language plpgsql as $$ begin raise exception 'disk full (test)'; end $$;
                  create trigger boom before insert on public.payments for each row execute function public.boom();`);
r = await fsales('erpCreateInvoice', [{ customer: { name: 'Y', phone: '01912345678' }, items: [{ sku: JS.sku, qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('his save fails halfway (after the pool\'s copy)', !r.ok && /disk full/.test(r.error), r);
check('...the pool\'s copy is taken out: stock back, no link left', await poolStock() === 12 && (await sql`select count(*)::int as n from joint_sales`)[0].n === 1 &&
  (await sql`select count(*)::int as n from invoices where business_id = ${POOL} and invoice_no not like 'RTN-%'`)[0].n === 1, await poolStock());
await tdb.unsafe('drop trigger boom on public.payments; drop function public.boom();');

// ---- a return on his side --------------------------------------------------------------------------------
r = await friend('erpReturnGoods', [{ invoiceNo: FINV, lines: [{ sku: JS.sku, qty: 1, condition: 'good' }], money: 'advance', reason: 'wrong colour' }]);
check('he takes one back', r.ok && r.result.value === 2000, r);
check('back on the pool\'s shelf; the pool\'s money follows', await poolStock() === 13 && await poolMoney(L1.pool_invoice_no) === 4000 &&
  (await sql`select coalesce(sum(amount), 0) as s from payments where invoice_no = ${L1.pool_invoice_no} and method = 'Returned'`)[0].s * 1 === 2000, await poolStock());

// ---- the month-end sums see him like any partner ----------------------------------------------------------
r = await owner('erpJoint', [{ pool: POOL }]);
let rep = r.result.book.report, ph = rep.partners.find((x) => x.business_id === SH.id);
check('settlement: his sales and money count to him', ph.month_sales === 4000 && ph.collected === 4000 && ph.purchases === 8000 && rep.this_month.revenue === 4000, rep);
check('...and it balances', Math.abs(rep.balance_check) < 0.01, rep.balance_check);
r = await friend('erpJoint', [{ pool: POOL }]);
check('he sees the same sums', r.ok && r.result.book.report.this_month.revenue === 4000 && r.result.sales.length === 1 && r.result.sales[0].mine === true && r.result.sales[0].invoiceNo === FINV, r.ok && r.result.sales);
r = await owner('erpJoint', [{ pool: POOL }]);
check('Costareen sees his sale, not his invoice number or customer', r.result.sales[0].mine === false && r.result.sales[0].invoiceNo === '' && JSON.stringify(r.result).indexOf('Friend Customer') < 0, r.result.sales);
r = await friend('erpJointAgree', [{ pool: POOL, month: r.result.book.month }]);
check('agreeing works from his side (this month: not yet)', !r.ok && /after it has ended/.test(r.error), r);
r = await friend('erpJointStatementPdf', [{ pool: POOL }]);
check('his statement paper', r.ok && /^Joint_Polymaker_JV_/.test(r.result.name), r);
r = await friend('erpJointCard', []);
check('his dashboard card', r.ok && r.result.pools.length === 1, r);

// ---- the nightly safety net ------------------------------------------------------------------------------
await sql`delete from payments where invoice_no = ${L1.pool_invoice_no} and method = 'Joint'`;
let out = await J.jointReconcile(deps);
check('a lost money step is put right', out.synced >= 1 && await poolMoney(L1.pool_invoice_no) === 4000, out);
await sql`update joint_sales set status = 'pending', created_at = now() - interval '10 minutes' where pool_invoice_no = ${L1.pool_invoice_no}`;
out = await J.jointReconcile(deps);
check('a sale left pending whose invoice exists is confirmed', out.kept === 1 && (await sql`select status from joint_sales where pool_invoice_no = ${L1.pool_invoice_no}`)[0].status === 'ok', out);
r = await fsales('erpCreateInvoice', [{ customer: { name: 'Z', phone: '01912345678' }, items: [{ sku: JS.sku, qty: 1 }], payMode: 'none' }]);
const L2 = (await sql`select * from joint_sales where seller_invoice_no = ${r.result.invoiceNo}`)[0];
await tsql`delete from invoices where business_id = ${TB} and invoice_no = ${r.result.invoiceNo}`;   // as if his save had never landed
await sql`update joint_sales set status = 'pending', created_at = now() - interval '10 minutes' where pool_invoice_no = ${L2.pool_invoice_no}`;
const before = await poolStock();
out = await J.jointReconcile(deps);
check('a sale left pending whose invoice is NOT there is taken out, stock back', out.dropped === 1 && await poolStock() === before + 1 &&
  !(await sql`select 1 from joint_sales where pool_invoice_no = ${L2.pool_invoice_no}`).length, out);
await tsql`delete from payments where business_id = ${TB} and invoice_no = ${FINV} and method = 'Returned'`;   // keep his books as they were for the next check
await sql`delete from invoices where invoice_no like 'RTN-%-J' and business_id = ${POOL}`;
out = await J.jointReconcile(deps);
check('a return the pool never heard of is written by the night check', out.returns >= 1 && (await sql`select count(*)::int as n from invoices where invoice_no like 'RTN-%-J'`)[0].n === 1, out);

// ---- the switch stays on while he is in a pool --------------------------------------------------------------
r = await owner('erpPlatformJointCopy', [{ id: TID, on: false }]);
check('a company copy in a pool cannot be switched off', !r.ok && /partner in a joint stock/.test(r.error), r);
check('his database holds nothing of Costareen\'s', (await tsql`select count(*)::int as n from invoices where customer_name ilike '%costareen%'`)[0].n === 0 &&
  (await tsql`select count(*)::int as n from businesses`)[0].n === 1);
await tdb.end(); await tsql.end(); await tAux.end();
await done();
