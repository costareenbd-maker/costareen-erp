// After IMPORT_DIR import: the ported functions run over the real data.
import { owner, check, done, FIX, sql } from './harness.mjs';
let r = await owner('erpCatalog', []);
check('catalog over imported data', r.ok && r.result.length > 100, r.error);
if (r.ok) console.log('  products', r.result.length, 'out', r.result.filter(p => p.state === 'out').length, 'low', r.result.filter(p => p.state === 'low').length);
r = await owner('erpDues', []);
check('dues over imported data', r.ok, r.error);
if (r.ok) console.log('  dues total', r.result.total, 'invoices', r.result.count, 'customers', r.result.customers.length, 'oldest', r.result.oldestDays);
const t = await sql`select count(*)::int n, sum(grand_total)::float g from invoices where business_id = ${FIX.IMP} and invoice_no not like 'RTN-%'`;
console.log('  invoices', t[0].n, 'grand total sum', t[0].g);
await done();
