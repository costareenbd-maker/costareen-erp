// night-books (6 Nov 2026): Wave 1 money bugs B1-B8. Made-up figures only.
// Run: TEST_SCRIPT=books_test.mjs ... erp_server_test.py
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
const head = async (who, view) => { const x = await who('erpFdHead', [{ view }]); return x.ok ? Object.fromEntries(x.result.cards.map((c) => [c.key, c])) : x; };

// ---- B1: the Suppliers head card is the list's own sum (opening balances in, advances not netted)
await sql`insert into suppliers (business_id, name, opening_owed) values (${B}, 'Night Sup A', 1000), (${B}, 'Night Sup B', 0)`;
await sql`insert into supplier_bills (business_id, supplier, amount) values (${B}, 'Night Sup A', 5000), (${B}, 'Night Sup B', 1000)`;
await sql`insert into supplier_payments (business_id, supplier, amount) values (${B}, 'Night Sup A', 2000), (${B}, 'Night Sup B', 3000)`;
{
  const list = (await owner('erpSuppliers', [])).result;
  const h = await head(owner, 'suppliers');
  check('B1 list: A owes 4000 (1000 opening + 5000 - 2000), B paid 2000 ahead', list.suppliers.find((s) => s.name === 'Night Sup A').owed === 4000
    && list.suppliers.find((s) => s.name === 'Night Sup B').owed === -2000, list.suppliers);
  check('B1 head card "We owe suppliers" equals the list total (not bills - payments = 1000)', h.owed && h.owed.v === Math.round(list.owedTotal) && h.owed.v === 4000, [h.owed, list.owedTotal]);
  check('B1 head card carries what was paid ahead apart', h.owed.ahead === 2000, h.owed);
}

await done();
