// Every feature switched on in the local copy (owner 21 Oct 2026: "make all the features available for him - the joint
// stock is hidden"). Run by local/run.py on EVERY start, so an existing local database gets it too; does nothing twice.
// Demo data only: the second demo company ("Elsewhere") is the joint-stock partner; the products are made up.
//  - joint stock: the provider's switch (joint_flags) on for both demo companies, one demo joint stock between them
//  - "Only me" features need nothing: the local owner is the platform admin, who always sees them
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const here = path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'));
const H = await import(pathToFileURL(path.join(here, '..', 'supabase', 'tests', 'harness.mjs')));
const { owner, sql, FIX, deps } = H;
const { erpCall } = await import(pathToFileURL(path.join(H.fnDir, 'core.js')));
const other = (name, args) => erpCall(deps, { name, args, authHeader: 'Bearer owner:' + FIX.U.other });
const say = (m) => console.log('FEATURES: ' + m);

try {
  await sql`insert into joint_flags (business_id) values (${FIX.B}), (${FIX.B2}) on conflict do nothing`;
  const pools = await sql`select id from businesses where is_pool and id in (select pool_id from pool_partners where partner_business_id = ${FIX.B})`.catch(() => []);
  if (!pools.length) {
    let r = await owner('erpJointStart', [{ action: 'create', name: 'Filament JV (demo)', displayName: 'Demo 3D Shop', tier: 'retail' }]);
    if (!r.ok) throw new Error('create: ' + r.error);
    const pool = r.result.created.id;
    r = await other('erpJointStart', [{ action: 'join', code: r.result.created.code, displayName: 'Elsewhere', tier: 'wholesale' }]);
    if (!r.ok) say('the partner did not join: ' + r.error);
    for (const [sku, name, color, retail, cost, qty] of [['JV-PLA-BLK', 'Nova PLA Black (joint)', 'Black', 1900, 1300, 20], ['JV-PLA-WHT', 'Nova PLA White (joint)', 'White', 1900, 1300, 15]]) {
      const p = await owner('erpJointProduct', [{ pool, isNew: true, sku, name, brand: 'Nova', type: 'PLA', color, retail, wholesale: retail - 150, floor: retail - 250, cost }]);
      if (!p.ok) { say(sku + ': ' + p.error); continue; }
      const g = await owner('erpJointReceive', [{ pool, sku, qty, unitCost: cost, paidBy: FIX.B }]);
      if (!g.ok) say(sku + ' receive: ' + g.error);
    }
    say('joint stock on, demo joint stock "Filament JV (demo)" made');
  } else say('joint stock on');
} catch (e) { say('joint stock skipped: ' + ((e && e.message) || e)); }
await sql.end({ timeout: 2 }).catch(() => {});
process.exit(0);
