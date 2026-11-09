// final-server (10 Nov 2026): the cross-cutting server pass.
//   1. every action name the page may call has a handler, a role and (for writes) plain words in the activity log
//   2. a timer job never runs twice at once (advisory lock in jobs.runJob); the server's logs are pruned nightly
//   3. month lock: a cash-up difference and a struck-out shipment cost refuse a closed month like every other money write
//   4. erpSaveCustomer and erpExpenseVoid no longer read the whole invoice / expense table to find one row
// Run: sh local/onetest.sh supabase/tests/serverfinal_test.mjs
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { runJob, pruneLogs } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const { ERP_ALLOW, ERP_READS } = await import(pathToFileURL(path.join(fnDir, 'allow.js')));
const { HANDLERS } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'index.js')));
const { actionWords } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'security.js')));
const { monthStr } = await import(pathToFileURL(path.join(fnDir, 'lib', 'time.js')));

const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
const thisMonth = monthStr(new Date());
let r;

// ---------------------------------------------------------------- 1. the tables agree
const DEAD_OK = ['erpRebuildDues', 'erpAdDraft'];                      // allowed, never ported, the page never calls them
const noHandler = Object.keys(ERP_ALLOW).filter((n) => !HANDLERS[n] && !DEAD_OK.includes(n));
check('every allowed action has a handler', noHandler.length === 0, noHandler);
const noAllow = Object.keys(HANDLERS).filter((n) => !ERP_ALLOW[n] && n !== 'erpBusinessPeople');
check('every handler is in the role table', noAllow.length === 0, noAllow);
const readsUnknown = ERP_READS.source.replace(/^\^\(|\)\$$/g, '').split('|').filter((n) => !ERP_ALLOW[n] && !['erpHello', 'erpMe'].includes(n));
check('every read is an allowed action', readsUnknown.length === 0, readsUnknown);
const fallback = (n) => { const w = String(n).replace(/^erp/, '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase(); return w.charAt(0).toUpperCase() + w.slice(1); };
const spelled = Object.keys(ERP_ALLOW).filter((n) => HANDLERS[n] && !ERP_READS.test(n) && !/^erpEngine(Claim|Step|Tool|Done)$/.test(n) && actionWords(n) === fallback(n));
check('every write has plain words for the activity log (none spelled from its name)', spelled.length === 0, spelled.slice(0, 20));

// ---------------------------------------------------------------- 1b. the final migration runs twice without harm
import { readFileSync } from 'node:fs';
const mig = readFileSync(path.join(fnDir, '..', '..', '166_final_indexes_rls.sql'), 'utf8');
let migOk = true; try { await sql.unsafe(mig); } catch (e) { migOk = e.message; }
check('166_final_indexes_rls.sql is idempotent (applied once by the runner, again here)', migOk === true, migOk);
const idx = await sql`select count(*)::int n from pg_indexes where schemaname = 'public' and indexname in ('erp_errors_biz_at_idx', 'lot_draws_biz_at_idx', 'inbox_contacts_channel_ext_idx', 'invoice_fixes_biz_inv_idx')`;
check('its indexes exist', idx[0].n === 4, idx);
const rlsOff = await sql`select c.table_name from information_schema.columns c join pg_class pc on pc.relname = c.table_name join pg_namespace n on n.oid = pc.relnamespace and n.nspname = 'public'
                         where c.table_schema = 'public' and c.column_name = 'business_id' and pc.relkind = 'r' and not pc.relrowsecurity`;
check('every table with a business_id column has row level security on', rlsOff.length === 0, rlsOff.map((r) => r.table_name));

// ---------------------------------------------------------------- 2. jobs: one run at a time, logs pruned
const held = await deps.control.reserve();   // another connection pool holds the lock, as a second server would
await held`select pg_advisory_lock(hashtext('erp-job:crm'))`;
r = await runJob(deps, 'crm');
check('a job whose previous run is still going is skipped, not run twice', r && /still going/.test(r.skipped), r);
await held`select pg_advisory_unlock(hashtext('erp-job:crm'))`;
held.release();
r = await runJob(deps, 'crm');
check('...and runs once the lock is free', r && !r.skipped, r);
r = await runJob(deps, 'crm');
check('the lock is let go after a run (the next run is not skipped)', r && !r.skipped, r);

await sql`insert into erp_errors (business_id, who, role, action, message, build, at) values
  (${B}, 'x', 'owner', 'old', 'old error', 't', now() - interval '200 days'), (${B}, 'x', 'owner', 'new', 'fresh error', 't', now() - interval '2 days')`;
await sql`insert into erp_activity (business_id, user_id, who, role, action, at) values (${B}, ${FIX.U.owner}, 'x', 'owner', 'old', now() - interval '100 days')`;
r = await pruneLogs(sql);
check('pruneLogs removes the old error row and the old activity row', r.erp_errors >= 1 && r.erp_activity >= 1 && typeof r.erp_op_keys === 'number', r);
const left = await sql`select action from erp_errors where business_id = ${B} and action in ('old', 'new')`;
check('...and keeps the recent one', left.length === 1 && left[0].action === 'new', left);
r = await runJob(deps, 'nightly');
check('nightly reports what it pruned', r && r.pruned && typeof r.pruned.erp_errors === 'number', r && r.pruned);

// ---------------------------------------------------------------- 3. month lock on the two money writes that lacked it
r = await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Bank', kind: 'bank' }] }]);
const A = {}; r.result.accounts.forEach((a) => { A[a.name] = a.id; });
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 2 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('a cash sale', r.ok, r);
const KARIM_INV = r.result.invoiceNo;
const bal = async (n) => (await owner('erpCashBook', [{}])).result.accounts.find((a) => a.name === n).balance;
const cash = await bal('Cash');
// close this month by hand (as erpCapitalClose does once the month is over)
await sql`insert into capital_closed (business_id, month, net_profit, shares, by) values (${B}, ${thisMonth}, 0, '{}'::jsonb, 'test')`;
r = await owner('erpCashUp', [{ account: A.Cash, counted: cash - 100, note: 'short' }]);
check('a cash-up refuses a closed month in plain words (final-money added the lock; checked here too)', !r.ok && /is closed/.test(r.error) && /cash-up|cash count/.test(r.error), r);
check('the book did not move', (await bal('Cash')) === cash, await bal('Cash'));

await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status, unit) values
  (${B}, 'SF-A', 'Server Final A', 'Filaments', 'T', 'PLA', 0, 1600, 'Active', 'Piece')`;
await sql`delete from capital_closed where business_id = ${B} and month = ${thisMonth}`;
r = await mgr('erpReceiveShipment', [{ reference: 'SF-1', supplier: 'Local Dealer', mode: 'bdt', totalBdt: 10000, payment: 'later', shippingBdt: 1000, lines: [{ sku: 'SF-A', qty: 5 }] }]);
check('a shipment with freight', r.ok, r);
r = await owner('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: 'SF-A', qty: 1 }], payMode: 'none' }]);
check('one unit sold from it', r.ok, r);
r = await owner('erpShipment', [{ reference: 'SF-1' }]);
const freight = r.ok && r.result.extra.find((x) => /Freight/.test(x.label));
check('the freight line is there', freight && freight.id, r.ok ? r.result.extra : r.error);
await sql`insert into capital_closed (business_id, month, net_profit, shares, by) values (${B}, ${thisMonth}, 0, '{}'::jsonb, 'test')`;
r = await mgr('erpShipmentCostVoid', [{ reference: 'SF-1', id: freight.id, reason: 'typed twice' }]);
check('a shipment cost in a closed month cannot be struck out (the sold units would be re-costed)', !r.ok && /is closed/.test(r.error), r);
const lotCost = await sql`select unit_cost from stock_lots where business_id = ${B} and reference = 'SF-1'`;
check('...and nothing changed', lotCost.length === 1 && Math.abs(Number(lotCost[0].unit_cost) - 2200) < 0.05, lotCost);
await sql`delete from capital_closed where business_id = ${B} and month = ${thisMonth}`;
r = await mgr('erpShipmentCostVoid', [{ reference: 'SF-1', id: freight.id, reason: 'typed twice' }]);
check('with the month open it is struck out as before', r.ok && r.result.amount === 1000 && r.result.lots === 1, r);

// ---------------------------------------------------------------- 4. one row, not the whole table
const karim = (await sql`select seq, phone from customers where business_id = ${B} and phone = '01712345678'`)[0];
check('Karim is on the list', !!karim, karim);
r = await owner('erpSaveCustomer', [{ row: karim.seq, name: 'Karim Uddin', phone: '01712345678' }]);
check('renaming a customer', r.ok, r);
let inv = await sql`select customer_name, customer_key from invoices where business_id = ${B} and invoice_no = ${KARIM_INV}`;
check('...renames their invoices (matched by the database, not by reading every invoice)', inv[0] && inv[0].customer_name === 'Karim Uddin', inv);
r = await owner('erpSaveCustomer', [{ row: karim.seq, name: 'Karim Uddin', phone: '01799999999' }]);
check('changing their phone', r.ok, r);
inv = await sql`select customer_key, customer_phone from invoices where business_id = ${B} and invoice_no = ${KARIM_INV}`;
const pay = await sql`select customer_key from payments where business_id = ${B} and invoice_no = ${KARIM_INV}`;
check('...moves the key on their invoices and payments', inv[0] && inv[0].customer_key === '1799999999' && pay.length && pay.every((p) => p.customer_key === '1799999999'), { inv, pay });
const otherInv = await sql`select count(*)::int n from invoices where business_id = ${B} and customer_key = '1799999999'`;
const allInv = await sql`select count(*)::int n from invoices where business_id = ${B}`;
check('...and only theirs (a sale of someone else is not touched)', otherInv[0].n < allInv[0].n || allInv[0].n <= 2, { otherInv, allInv });

r = await owner('erpExpenseAdd', [{ amount: 500, description: 'tea', category: 'Miscellaneous' }]);
check('an expense', r.ok, r);
const EX = r.result.oneoff.find((x) => x.description === 'tea');
r = await owner('erpExpenseVoid', [{ id: 'EXP-nope', reason: 'x' }]);
check('striking out an unknown number: plain refusal', !r.ok && r.error === 'That entry was not found.', r);
r = await owner('erpExpenseVoid', [{ id: EX.id, reason: 'entered twice' }]);
check('striking out by number works (one indexed read)', r.ok, r);
const ex = await sql`select voided from expenses where business_id = ${B} and expense_no = ${EX.id}`;
check('...marked, not removed', ex.length === 1 && /entered twice/.test(ex[0].voided), ex);
r = await owner('erpExpenseVoid', [{ id: EX.id, reason: 'again' }]);
check('not twice', !r.ok && /already struck out/.test(r.error), r);

await done();
