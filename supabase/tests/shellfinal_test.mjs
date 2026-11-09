// final-shell (10 Nov 2026): the shell's server side after the last pass.
//   - erpConfigSet checks every system value (reorder level, lead time, currency, name, webhook) before it is kept
//   - erpTool refuses an unknown job with a plain sentence (not "Unknown action", the page's "old page" signal)
//   - role gates: sales cannot touch settings / tools / users / system check; the other business is untouched
// Run: sh local/onetest.sh supabase/tests/shellfinal_test.mjs
import { sql, FIX, owner, mgr, sales, check, done, makeShareholder, shareholder } from './harness.mjs';

const B = FIX.B, B2 = FIX.B2;
await makeShareholder();
let r;

// ---------------------------------------------------------------- erpConfigSet validation
r = await owner('erpConfigSet', ['default_reorder', 'abc']);
check('reorder level: a word is refused', !r.ok && /whole number of units/.test(r.error), r);
r = await owner('erpConfigSet', ['default_reorder', '-3']);
check('reorder level: negative refused', !r.ok, r);
r = await owner('erpConfigSet', ['default_reorder', ' 12 ']);
check('reorder level: a number is kept, trimmed', r.ok && r.result.value === '12', r);
r = await owner('erpConfigSet', ['default_lead_time', '400']);
check('lead time: over a year refused', !r.ok && /0 to 365/.test(r.error), r);
r = await owner('erpConfigSet', ['default_lead_time', '']);
check('lead time: empty refused (would read as NaN days)', !r.ok, r);
r = await owner('erpConfigSet', ['default_lead_time', '10']);
check('lead time: 10 kept', r.ok && r.result.value === '10', r);
r = await owner('erpConfigSet', ['currency', 'taka']);
check('currency: not a 3-letter code refused', !r.ok && /3-letter/.test(r.error), r);
r = await owner('erpConfigSet', ['currency', 'bdt']);
check('currency: upper-cased', r.ok && r.result.value === 'BDT', r);
r = await owner('erpConfigSet', ['business_name', '   ']);
check('business name: empty refused', !r.ok && /Type the business name/.test(r.error), r);
r = await owner('erpConfigSet', ['business_name', 'x'.repeat(81)]);
check('business name: 81 letters refused', !r.ok && /too long/.test(r.error), r);
r = await owner('erpConfigSet', ['n8n_webhook_url', 'https://hooks.example.com/x']);
check('webhook: a credential, never editable from the settings list', !r.ok && /credential/.test(r.error), r);
r = await owner('erpConfigSet', ['next_invoice_num', '0']);
check('next invoice number: 0 refused', !r.ok, r);

const stored = await sql`select key, value from business_config where business_id = ${B} and key in ('default_reorder', 'default_lead_time', 'currency') order by key`;
check('stored values are the checked ones', JSON.stringify(stored.map((x) => x.key + '=' + x.value)) === '["currency=BDT","default_lead_time=10","default_reorder=12"]', stored);
const other = await sql`select count(*)::int as n from business_config where business_id = ${B2} and key in ('default_reorder', 'default_lead_time')`;
check('the other business is untouched', other[0].n === 0, other);

// ---------------------------------------------------------------- roles
r = await sales('erpConfigSet', ['default_reorder', '3']);
check('sales cannot change system values', !r.ok, r);
r = await mgr('erpConfigSet', ['default_reorder', '3']);
check('manager cannot change system values', !r.ok, r);
r = await shareholder('erpConfigSet', ['default_reorder', '4']);
check('shareholder may', r.ok && r.result.value === '4', r);
r = await sales('erpTool', ['fixPhones']);
check('sales cannot run maintenance', !r.ok, r);
r = await sales('erpUsers', []);
check('sales cannot list users', !r.ok, r);
r = await sales('erpSystemCheck', []);
check('sales cannot run the system check', !r.ok, r);
r = await mgr('erpSystemCheck', []);
check('manager cannot run the system check (money figures inside)', !r.ok, r);

// ---------------------------------------------------------------- erpTool
r = await owner('erpTool', ['noSuchJob']);
check('unknown job: a plain sentence, never "Unknown action"', !r.ok && /no maintenance job called "noSuchJob"/.test(r.error) && !/Unknown action/.test(r.error), r);
r = await owner('erpTool', ['fixPhones']);
check('a known job answers with a sentence', r.ok && typeof r.result === 'string' && r.result.length > 10, r);
r = await owner('erpTool', ['previewReorder']);
check('preview reorder changes nothing and says so', r.ok && /Nothing has been written/.test(r.result), r);

// ---------------------------------------------------------------- system check still works for the owner after the config changes
r = await owner('erpSystemCheck', []);
check('system check runs: checks with id/area/title/status', r.ok && Array.isArray(r.result.checks) && r.result.checks.length >= 10 &&
  r.result.checks.every((c) => c.id && c.area && c.title && /^(pass|warn|fail)$/.test(c.status)), r.ok ? r.result.checks.slice(0, 2) : r);

// ---------------------------------------------------------------- System values: the ERP's own state keys are not settings
await sql`insert into business_config (business_id, key, value) values (${B}, 'watch_now', '1'), (${B}, 'inbox_profile', '{}'), (${B}, 'arena_room', 'x'), (${B}, 'custom_note', 'hello')
          on conflict (business_id, key) do update set value = excluded.value`;
r = await owner('erpSettingsFull', []);
{
  const keys = r.ok ? r.result.config.map((c) => c.key) : [];
  check('internal keys (watch_now, inbox_profile, arena_room) are not listed as settings', r.ok && !keys.includes('watch_now') && !keys.includes('inbox_profile') && !keys.includes('arena_room'), keys);
  check('a plain unknown key still shows', keys.includes('custom_note'), keys);
  check('the 7 system values are all there', ['business_name', 'currency', 'default_reorder', 'default_lead_time', 'next_invoice_num'].every((k) => keys.includes(k)), keys);
}
r = await owner('erpConfigSet', ['watch_now', '0']);
check('an internal key cannot be set from the settings list', !r.ok && /Setting not found/.test(r.error), r);

done();
