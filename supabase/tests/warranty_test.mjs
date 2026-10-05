// Stage N0: warranty rules by category and brand, new products take them by themselves, many products at once.
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001', A1 = 'PRT-BAM-A1-001';
const prod = async (sku) => (await sql`select serialised, warranty_months, warranty_transferable from products where business_id = ${FIX.B} and sku = ${sku}`)[0];

// 1. refusals and the empty start
let r = await sales('erpWarrantyRuleSave', [{ category: 'Printers', serialised: true, warrantyMonths: 12 }]);
check('sales staff cannot set rules', !r.ok && /manager/.test(r.error), r);
r = await sales('erpWarrantyRules', []);
check('anyone sees the rules screen: none yet, the lists, the counts', r.ok && r.result.rules.length === 0 && r.result.categories.includes('Printers') && r.result.brands.includes('Sunlu') && r.result.products === 2 && r.result.serialised === 0 && /\/check$/.test(r.result.checkUrl) && !r.result.canEdit, r);
r = await mgr('erpWarrantyRuleSave', [{ category: '', brand: '', serialised: true, warrantyMonths: 12 }]);
check('a rule needs a category or a brand', !r.ok, r);
r = await mgr('erpWarrantyRuleSave', [{ category: 'Printers', warrantyMonths: 500 }]);
check('months 0 to 120', !r.ok && /0 to 120/.test(r.error), r);

// 2. a category rule, applied to what exists
r = await mgr('erpWarrantyRuleSave', [{ category: 'Printers', serialised: true, warrantyMonths: 12, apply: true }]);
check('manager saves "Printers: by serial, 12 months" and applies it', r.ok && r.result.applied === 1 && r.result.rules.length === 1 && r.result.saved.warrantyMonths === 12, r);
let p = await prod(A1);
check('the printer is now sold by serial number with 12 months', p.serialised === true && Number(p.warranty_months) === 12 && p.warranty_transferable === true, p);
check('the filament is untouched', (await prod(PLA)).serialised === false);

// 3. a brand rule, not applied yet; saving the same rule again updates it
r = await mgr('erpWarrantyRuleSave', [{ brand: 'Sunlu', serialised: false, warrantyMonths: 6, transferable: false }]);
check('a brand-only rule', r.ok && r.result.rules.length === 2 && r.result.applied === 0, r);
r = await mgr('erpWarrantyRuleSave', [{ brand: 'sunlu', serialised: false, warrantyMonths: 9 }]);
check('the same brand (any case) updates the rule instead of adding one', r.ok && r.result.rules.length === 2 && r.result.rules.find((x) => x.brand === 'Sunlu').warrantyMonths === 9, r.result.rules);

// 4. new products take the rule of their kind by themselves
r = await mgr('erpSaveProduct', [{ isNew: true, product_name: 'Bambu P1S', category: 'Printers', brand: 'Bambulab', sell_price: 90000, cost_price: 70000 }]);
check('a new printer is made', r.ok, r);
const p1s = (await sql`select serialised, warranty_months from products where business_id = ${FIX.B} and name = 'Bambu P1S'`)[0];
check('...and is sold by serial number with 12 months, nobody typed it', p1s && p1s.serialised === true && Number(p1s.warranty_months) === 12, p1s);
r = await mgr('erpSaveProduct', [{ isNew: true, product_name: 'Sunlu PETG Blue', category: 'Filaments', brand: 'Sunlu', sell_price: 1500, cost_price: 1000 }]);
const petg = (await sql`select serialised, warranty_months, warranty_transferable from products where business_id = ${FIX.B} and name = 'Sunlu PETG Blue'`)[0];
check('a new Sunlu filament takes the brand rule: no serials, 9 months', petg && petg.serialised === false && Number(petg.warranty_months) === 9, petg);
r = await mgr('erpSaveProduct', [{ isNew: true, product_name: 'Nozzle 0.4', category: 'Accessories', brand: 'Generic', sell_price: 300, cost_price: 100 }]);
const noz = (await sql`select serialised, warranty_months from products where business_id = ${FIX.B} and name = 'Nozzle 0.4'`)[0];
check('no rule for its kind: a new product stays as before', noz && noz.serialised === false && noz.warranty_months === null, noz);
// the more specific rule wins
r = await mgr('erpWarrantyRuleSave', [{ category: 'Printers', brand: 'Bambulab', serialised: true, warrantyMonths: 24 }]);
r = await mgr('erpSaveProduct', [{ isNew: true, product_name: 'Bambu X1C', category: 'Printers', brand: 'Bambulab', sell_price: 150000, cost_price: 120000 }]);
const x1 = (await sql`select warranty_months from products where business_id = ${FIX.B} and name = 'Bambu X1C'`)[0];
check('category + brand beats category alone', x1 && Number(x1.warranty_months) === 24, x1);

// 5. apply a rule by its id, remove a rule
r = await mgr('erpWarrantyRules', []);
const sun = r.result.rules.find((x) => x.brand === 'Sunlu' && !x.category);
r = await mgr('erpWarrantyRuleApply', [{ id: sun.id }]);
check('apply the Sunlu rule now: both Sunlu products', r.ok && r.result.applied === 2, r);
check('...the PLA got it', Number((await prod(PLA)).warranty_months) === 9 && (await prod(PLA)).warranty_transferable === true);
r = await sales('erpWarrantyRuleRemove', [{ id: sun.id }]);
check('sales staff cannot remove a rule', !r.ok, r);
r = await mgr('erpWarrantyRuleRemove', [{ id: sun.id }]);
check('removed', r.ok && !r.result.rules.some((x) => x.id === sun.id), r);
r = await mgr('erpWarrantyRuleRemove', [{ id: sun.id }]);
check('removing twice is refused', !r.ok, r);

// 6. many products at once
r = await sales('erpSerialBulkSet', [{ skus: [PLA, A1], serialised: true, warrantyMonths: 3 }]);
check('sales staff cannot bulk-set', !r.ok, r);
r = await mgr('erpSerialBulkSet', [{ skus: [PLA, A1, 'NOPE'], serialised: true, warrantyMonths: 3, transferable: false }]);
check('two of three ticked products changed (the unknown one skipped)', r.ok && r.result.changed === 2, r);
p = await prod(PLA);
check('...the PLA is now by serial, 3 months, not transferable', p.serialised === true && Number(p.warranty_months) === 3 && p.warranty_transferable === false, p);
r = await mgr('erpSerialBulkSet', [{ skus: [], serialised: true }]);
check('nothing ticked is refused', !r.ok, r);

// 7. the other business is untouched
const other = (await sql`select serialised, warranty_months from products where business_id = ${FIX.B2} and sku = 'X-OTHER'`)[0];
check('the other business: no serials, no warranty', other.serialised === false && other.warranty_months === null, other);
check('...and no rules', (await sql`select count(*)::int n from warranty_rules where business_id = ${FIX.B2}`)[0].n === 0);
await done();
