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

// ---- B2: the "cannot be costed" warning counts only rows whose currency has no rate
await sql`delete from currencies where business_id = ${B} and code = 'RMB'`.catch(() => {});
await sql`delete from business_config where business_id = ${B} and key = 'cost_rate'`.catch(() => {});
await sql`insert into currencies (business_id, code, name, rate) values (${B}, 'USD', 'US dollar', 120)
          on conflict do nothing`.catch((e) => console.log('usd:', e.message));
await sql`insert into cost_book (business_id, sort_order, category, brand, type, buy_amount, buy_cur) values
  (${B}, 901, 'NightCat', 'NB', 'Taka row', 500, 'BDT'),
  (${B}, 902, 'NightCat', 'NB', 'Yuan row', 10, 'RMB'),
  (${B}, 903, 'NightCat', 'NB', 'Yuan row 2', 12, 'RMB'),
  (${B}, 904, 'NightCat', 'NB', 'Dollar row', 2, 'USD')`;
{
  const cb = (await owner('erpCostBook', [])).result;
  const row = (t) => cb.rows.find((r) => r.type === t);
  check('B2 a BDT row and a USD row are costed with no RMB rate', row('Taka row').landed > 0 && row('Dollar row').landed > 0, cb.rows.filter((r) => r.category === 'NightCat'));
  check('B2 noRate names RMB with exactly its 2 rows (not "nothing can be costed")', cb.noRate && cb.noRate.RMB === 2 && !cb.noRate.BDT && !cb.noRate.USD, cb.noRate);
  const h = await head(owner, 'costs');
  check('B2 head "Cost book rows priced" = the book\'s own priced count, and says how many wait for a rate', h.rows.v === cb.priced && h.rows.of === cb.rows.length && h.rows.noRate === 2, [h.rows, cb.priced, cb.rows.length]);
  await sql`insert into currencies (business_id, code, name, rate) values (${B}, 'RMB', 'Chinese yuan', 17)`;
  const cb2 = (await owner('erpCostBook', [])).result;
  check('B2 once RMB has a rate nothing waits', !Object.keys(cb2.noRate).length && cb2.rows.find((r) => r.type === 'Yuan row').landed > 0, cb2.noRate);
}

await done();
