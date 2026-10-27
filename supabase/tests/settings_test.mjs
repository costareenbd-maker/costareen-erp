// Settings group: lists, config, staff + devices, AI keys, tools, self-test,
// backups, businesses. Run through erp_server_test.py with TEST_SCRIPT=settings_test.mjs.
import { createHash } from 'node:crypto';
import { sql, FIX, owner, mgr, sales, call, check, done, files, deps,
         makeShareholder, shareholder } from './harness.mjs';

const B = FIX.B;
const NOT_YET = 'This part is not in the web app yet.';
await makeShareholder();
await sql`insert into products (business_id, sku, name, brand, category) values
          (${B}, 'X-SUN-2', 'Sunlu spare', ' sunlu ', 'Parts')`;

let r;

// ---------------------------------------------------------------- lists
r = await mgr('erpSettingsFull', []);
check('manager: Settings gives the lists only', r.ok && r.result.lists && r.result.config.length === 0, r);
r = await shareholder('erpSettingsFull', []);
check('settings full: lists de-duplicated, all 7 kinds', r.ok && JSON.stringify(r.result.lists.brands) === '["Bambulab","Sunlu"]' &&
  r.result.lists.payment_methods.length === 3 && Array.isArray(r.result.lists.colors), r);
const cfg = r.result.config;
const cf = (k) => cfg.find((c) => c.key === k);
check('config: defaults shown in sheet order', cfg[0].key === 'business_name' && cfg[0].value === 'Costareen' &&
  cf('next_invoice_num').value === '1001' && cf('default_reorder').value === '5' && cfg[0].row === 2 && !cf('cost_rate'), cfg);

r = await owner('erpLookupAdd', ['brands', 'eSUN']);
check('add: sorted case-insensitively', r.ok && JSON.stringify(r.result.values) === '["Bambulab","eSUN","Sunlu"]' && r.result.kind === 'brands', r);
r = await owner('erpLookupAdd', ['brands', 'esun']);
check('add: duplicate refused', !r.ok && r.error === '"esun" is already in that list.', r);
r = await owner('erpLookupAdd', ['brands', '  ']);
check('add: empty refused', !r.ok && r.error === 'Type a value first.', r);
r = await owner('erpLookupAdd', ['nonsense', 'x']);
check('add: unknown list', !r.ok && r.error === 'Unknown list: nonsense', r);
const stored = await sql`select value, sort_order from lookups where business_id = ${B} and kind = 'brands' order by sort_order`;
check('list rewritten whole: case-duplicate gone, order kept', stored.map((x) => x.value).join() === 'Bambulab,eSUN,Sunlu' && stored[2].sort_order === 3, stored);
r = await mgr('erpSettingsLists', []);
check('other screens see the new value', r.ok && r.result.brands.includes('eSUN'), r);
r = await owner('erpLookupAdd', ['payment_methods', 'Nagad']);
r = await sales('erpFormOptions', []);
check('payment method reaches the invoice form', r.ok && r.result.paymentMethods.includes('Nagad'), r);

r = await shareholder('erpLookupUsage', ['brands', 'SUNLU']);
check('usage counts products, trimmed + case-insensitive', r.ok && r.result === 2, r);
r = await shareholder('erpLookupUsage', ['payment_methods', 'Cash']);
check('usage of a payment method is 0', r.ok && r.result === 0, r);
r = await shareholder('erpLookupRemove', ['brands', 'ESUN']);
check('remove', r.ok && JSON.stringify(r.result.values) === '["Bambulab","Sunlu"]', r);
r = await shareholder('erpLookupRemove', ['brands', 'ESUN']);
check('remove: not there', !r.ok && r.error === '"ESUN" is not in that list.', r);
check('products keep their text', (await sql`select count(*)::int n from products where brand ilike '%sunlu%'`)[0].n === 2);

// ---------------------------------------------------------------- config
r = await shareholder('erpConfigSet', ['currency', 'BDT ']);
check('config saved', r.ok && r.result.key === 'currency', r);
check('config stored', (await sql`select value from business_config where business_id = ${B} and key = 'currency'`)[0].value === 'BDT ');
r = await shareholder('erpConfigSet', ['website_sync_key', 'x']);
check('credential refused', !r.ok && r.error === 'That value is a credential and is not editable from here.', r);
r = await shareholder('erpConfigSet', ['no_such', 'x']);
check('unknown setting', !r.ok && r.error === 'Setting not found: no_such', r);
r = await shareholder('erpConfigSet', ['', 'x']);
check('no key', !r.ok && r.error === 'Which setting?', r);
r = await shareholder('erpConfigSet', ['next_invoice_num', '2001']);
check('next_invoice_num moves the invoice counter', r.ok &&
  (await sql`select next_number from invoice_counters where business_id = ${B}`)[0].next_number === 2001, r);
r = await shareholder('erpConfigSet', ['next_invoice_num', 'abc']);
check('next_invoice_num must be a number', !r.ok && /whole number/.test(r.error), r);
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'CZ_SYNC_KEY', 'sekret')`;
r = await shareholder('erpSettingsFull', []);
const wk = r.result.config.find((c) => c.key === 'website_sync_key');
check('website key shows as stored privately, value never sent', wk && wk.secret === true && wk.value === '' &&
  !JSON.stringify(r.result).includes('sekret'), r.result.config);
check('saved values come back', r.result.config.find((c) => c.key === 'next_invoice_num').value === '2001');

// ---------------------------------------------------------------- staff + devices
r = await owner('erpAdmin', []);
check('admin bundle: staff, devices, links, people, warning', r.ok && r.result.ok && r.result.staff && r.result.devices &&
  r.result.links && r.result.people && r.result.warning === null, r);
const names = r.result.staff.people.map((p) => p.name);
check('staff lists this business’s people', names.includes('Mehedi') && names.includes('Rina') && names.includes('Shami'), names);
const meh = r.result.staff.people.find((p) => p.name === 'Mehedi');
check('person row shape', meh.role === 'manager' && meh.roleLabel === 'Manager' && meh.code === '111111' &&
  meh.status === 'approved' && meh.devices[0].id === 'dev-mgr' && meh.devices[0].status === 'approved', meh);
check('roles with caps, iAm', r.result.staff.roles.length === 4 && r.result.staff.roles.find((x) => x.id === 'sales').cap === 100 &&
  r.result.staff.iAm === 'owner', r.result.staff);
check('links: every business on the one address', r.result.links.businesses[0].isHome === true &&
  r.result.links.businesses[0].url === 'https://erp.costareen.com' && r.result.links.canAdd === true, r.result.links);
r = await mgr('erpAdmin', []);
check('manager refused admin', !r.ok, r);

r = await owner('erpAddPerson', [{ name: 'Kamal', phone: '01711000000', role: 'sales' }]);
check('owner adds a person: 6-digit code, shown once', r.ok && /^\d{6}$/.test(r.result.code) && r.result.name === 'Kamal' &&
  r.result.role === 'sales' && r.result.people.find((p) => p.name === 'Kamal'), r);
const kamal = r.result;
const m = await sql`select role from memberships where business_id = ${B} and user_id = ${kamal.id}`;
check('membership in this business with that role', m[0] && m[0].role === 'sales', m);
check('auth user created for them', (await sql`select count(*)::int n from auth.users where id = ${kamal.id}`)[0].n === 1);
const K = { code: kamal.code, device: 'dev-k', label: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' };
r = await call('erpHello', [], { token: K });
check('their first device asks', r.result.reason === 'PENDING', r);
r = await shareholder('erpDevices', []);
check('device request listed', r.ok && r.result.pending.length === 1 && r.result.pending[0].id === 'dev-k' &&
  r.result.pending[0].name === 'Kamal' && r.result.pending[0].roleLabel === 'Sales' && r.result.pending[0].label === 'Android · Chrome', r);
r = await shareholder('erpPeople', []);
check('pending counted', r.ok && r.result.pending === 1 && r.result.people.find((p) => p.name === 'Kamal').status === 'pending', r);
r = await shareholder('erpAllowDevice', ['dev-k']);
check('let in', r.ok && r.result.devices.approved.find((d) => d.id === 'dev-k') && r.result.people, r);
r = await call('erpToday', [], { token: K });
check('they can work now', r.ok, r);
r = await call('erpSettingsLists', [], { token: K });
check('…as sales only', !r.ok && /does not have permission/.test(r.error), r);
r = await shareholder('erpRevokeDevice', ['dev-k']);
r = await call('erpToday', [], { token: K });
check('device removed -> refused', !r.ok && r.error === 'This device is no longer allowed. Speak to the owner.', r);
await call('erpHello', [], { token: { ...K, device: 'dev-k2' } });
r = await shareholder('erpDenyDevice', ['dev-k2']);
check('refuse a device', r.ok && r.result.devices.other.find((d) => d.id === 'dev-k2' && d.status === 'denied'), r);
r = await shareholder('erpAllowDevice', ['nope']);
check('unknown device', !r.ok && r.error === 'That device is not in the list.', r);
r = await shareholder('erpResetCode', [{ id: kamal.id, newCode: true }]);
check('reset: new code, devices forgotten', r.ok && r.result.newCode === true && /^\d{6}$/.test(r.result.code) && r.result.code !== kamal.code &&
  (await sql`select count(*)::int n from erp_devices where user_id = ${kamal.id}`)[0].n === 0, r);
const kcode = r.result.code;
r = await shareholder('erpApproveDevice', [kamal.id]);
check('legacy approve with no device', !r.ok && r.error === 'They have not tried their code yet, so there is no device to allow.', r);
await call('erpHello', [], { token: { ...K, code: kcode, device: 'dev-k3' } });
r = await shareholder('erpApproveDevice', [kamal.id]);
check('legacy approve allows the waiting device', r.ok && r.result.people.find((p) => p.name === 'Kamal').devices[0].status === 'approved', r);
r = await shareholder('erpRevokePerson', [kamal.id]);
check('revoke: code blanked, status revoked', r.ok && r.result.people.find((p) => p.name === 'Kamal').code === '' &&
  r.result.people.find((p) => p.name === 'Kamal').status === 'revoked', r);
r = await call('erpToday', [], { token: { ...K, code: kcode, device: 'dev-k3' } });
check('revoked code stops working', !r.ok && r.error === 'That code is not recognised.', r);
r = await shareholder('erpRevokePerson', ['00000000-0000-0000-0000-000000000000']);
check('revoke unknown', !r.ok && r.error === 'That person is not in the list.', r);

r = await shareholder('erpAddPerson', [{ name: 'Big', role: 'shareholder' }]);
check('shareholder cannot add a shareholder', !r.ok && r.error === 'Only the owner can add an owner or a shareholder.', r);
r = await shareholder('erpAddPerson', [{ name: 'Moni', role: 'manager' }]);
check('shareholder adds a manager', r.ok && (await sql`select role from memberships where user_id = ${r.result.id}`)[0].role === 'manager', r);
r = await owner('erpAddPerson', [{ name: '', role: 'sales' }]);
check('name needed', !r.ok && r.error === 'A name is needed.', r);
r = await owner('erpAddPerson', [{ name: 'X', role: 'boss' }]);
check('role needed', !r.ok && r.error === 'Choose a role.', r);
r = await owner('erpAddPerson', [{ name: 'X', role: 'sales', code: '123' }]);
check('chosen code must be 6 digits', !r.ok && r.error === 'A code is six digits, or leave it blank for a new one.', r);
r = await owner('erpAddPerson', [{ name: 'X', role: 'sales', code: '111111' }]);
check('chosen code already in use', !r.ok && r.error === 'That code is already in use. Leave it blank for a new one.', r);
check('a refused add leaves no person behind', (await sql`select count(*)::int n from erp_people where name = 'X'`)[0].n === 0);
r = await owner('erpAddPerson', [{ name: 'Partner', role: 'owner', code: '654321' }]);
check('owner may add an owner with a chosen code', r.ok && r.result.code === '654321', r);
r = await shareholder('erpRevokePerson', [r.result.id]);
check('only the owner can remove an owner', !r.ok && r.error === 'Only the owner can remove an owner.', r);
r = await sales('erpAddPerson', [{ name: 'Z', role: 'sales' }]);
check('sales refused', !r.ok && /does not have permission/.test(r.error), r);

// ---------------------------------------------------------------- AI keys
r = await mgr('erpAiKeys', []);
check('AI keys are not for a manager (a shareholder equals the owner, 27 Oct 2026)', !r.ok, r);
r = await owner('erpAiKeyCreate', [{ name: 'Polok', role: 'manager' }]);
const fresh = r.ok && r.result.fresh;
check('key made: czai_ + 48 hex, shown once', fresh && /^czai_[0-9a-f]{48}$/.test(fresh.key) && fresh.name === 'Polok', r);
const kr = (await sql`select * from erp_ai_keys where business_id = ${B}`)[0];
check('only the sha-256 is stored', kr && kr.hash === createHash('sha256').update(fresh.key).digest('hex') &&
  /^k[0-9a-f]{12}$/.test(kr.id) && kr.role === 'manager' && kr.enabled === true, kr);
check('list shape', r.result.keys[0].roleLabel === 'Manager' && r.result.keys[0].on === true && r.result.keys[0].lastUsed === '' &&
  r.result.roles.length === 4 && r.result.address === 'https://mcp.bendar.duckdns.org/mcp' && r.result.log[0].action === 'key created', r.result);
r = await owner('erpAiKeys', []);
check('key text never listed again', r.ok && !JSON.stringify(r.result).includes(fresh.key), r);
r = await owner('erpAiKeyCreate', [{ name: 'POLOK', role: 'sales' }]);
check('names are unique', !r.ok && r.error === 'There is already a key called POLOK.', r);
r = await owner('erpAiKeyCreate', [{ name: '', role: 'sales' }]);
check('name needed', !r.ok && r.error === 'Give the key a name - who or what will use it.', r);
r = await owner('erpAiKeyCreate', [{ name: 'Q', role: 'god' }]);
check('role needed', !r.ok && r.error === 'Choose what the key may do.', r);
r = await owner('erpAiKeySet', [{ id: kr.id, on: false }]);
check('switch off', r.ok && r.result.keys[0].on === false && r.result.log[0].action === 'key switched off', r);
r = await owner('erpAiKeySet', [{ id: kr.id, remove: true }]);
check('remove', r.ok && r.result.keys.length === 0 && r.result.log[0].action === 'key removed', r);
r = await owner('erpAiKeySet', [{ id: kr.id, on: true }]);
check('gone', !r.ok && r.error === 'That key is no longer there.', r);
await owner('erpAiKeyCreate', [{ name: 'Keeper', role: 'sales' }]);

// ---------------------------------------------------------------- tools
r = await mgr('erpTool', ['refreshStock']);
check('tools need shareholder', !r.ok && /does not have permission/.test(r.error), r);
r = await shareholder('erpTool', ['refreshStock']);
check('refreshStock: honest sentence', r.ok && /^Stock is always up to date now/.test(r.result), r);
for (const a of ['refreshDashboard', 'sortProducts', 'fixInvoiceLayout', 'insertQr']) {
  r = await shareholder('erpTool', [a]);
  check(a + ': a sentence, nothing done', r.ok && typeof r.result === 'string' && r.result.length > 20, r);
}
const before = (await sql`select (select count(*) from business_secrets where business_id = ${B})::int s,
                                 (select count(*) from erp_ai_keys where business_id = ${B})::int k`)[0];
r = await shareholder('erpTool', ['prepareTemplate']);
const after = (await sql`select (select count(*) from business_secrets where business_id = ${B})::int s,
                                (select count(*) from erp_ai_keys where business_id = ${B})::int k`)[0];
check('prepareTemplate wipes NOTHING (keys, secrets kept)', r.ok && /nothing was removed/.test(r.result) &&
  before.s === after.s && before.k === after.k && after.s >= 1 && after.k === 1, [r, before, after]);
r = await owner('erpPrepareTemplate', []);
check('erpPrepareTemplate direct: same, nothing removed', r.ok && r.result.properties === 0 && r.result.triggers === 0 && /nothing was removed/.test(r.result.message), r);
await sql`insert into customers (business_id, name, phone) values (${B}, 'Phoneless', '1712000000')`;
r = await shareholder('erpTool', ['fixPhones']);
check('fixPhones corrects the stored number', r.ok && r.result === '1 phone number(s) corrected.' &&
  (await sql`select phone from customers where name = 'Phoneless'`)[0].phone === '01712000000', r);
r = await shareholder('erpTool', ['fixPhones']);
check('fixPhones again: nothing to do', r.ok && r.result === 'All phone numbers already correct.', r);
for (const a of ['pullOrders', 'previewPush', 'pushStock', 'mergeCustomers', 'fixCustomerPhones', 'previewReorder', 'applyReorder']) {
  r = await shareholder('erpTool', [a]);
  // reaches the other group's export: a sentence, its own error (no fake website here),
  // or "not in the web app yet" while that group is not ported
  check(a + ': delegated (or not in the web app yet)', (r.ok && typeof r.result === 'string') ||
    (!r.ok && (r.error === NOT_YET || !/^Unknown action|access to that/.test(r.error))), r);
  if (!r.ok && r.error === NOT_YET) console.log('  (' + a + ': other group not ported yet)');
}
r = await shareholder('erpTool', ['zzz']);
check('unknown tool', !r.ok && r.error === 'Unknown action: zzz', r);

// ---------------------------------------------------------------- self-test
r = await shareholder('erpSelfTest', []);
check('self-test: 8 sections timed', r.ok && r.result.length === 8 && r.result[0].part === 'dash' &&
  r.result.every((x) => typeof x.ms === 'number'), r);
const catRow = r.ok && r.result.find((x) => x.part === 'catalog');
check('self-test: catalog ok with its rows', catRow && catRow.error === '' && catRow.size === 3, catRow);

// ---------------------------------------------------------------- backups
r = await mgr('erpBackupStatus', []);
check('backups are not for a manager (a shareholder equals the owner, 27 Oct 2026)', !r.ok, r);
r = await owner('erpBackupStatus', []);
check('status before any copy', r.ok && r.result.count === 0 && r.result.lastAt === '' && r.result.lastAgeHours === null &&
  r.result.keep === 14 && r.result.timer === false && Array.isArray(r.result.files), r);
// fifteen older copies already there
for (let i = 1; i <= 15; i++) {
  const d = String(i).padStart(2, '0');
  await deps.storage.save(B, 'backups', `Costareen - backup 2026-01-${d} 0300.json`, new Uint8Array([123, 125]), 'application/json');
}
await deps.storage.save(B, 'backups', 'someone else.json', new Uint8Array([1]), 'application/json');
r = await owner('erpBackupRun', []);
check('backup made, status returned', r.ok && r.result.count === 14 && r.result.lastAt !== '' && r.result.lastAgeHours === 0 &&
  r.result.files.length === 6 && /^Costareen - backup \d{4}-\d{2}-\d{2} \d{4}(\d{2})?\.json$/.test(r.result.files[0].name), r);
const names2 = files.list().filter((k) => k.startsWith(B + '/backups/'));
check('newest 14 kept, oldest removed, other files untouched', names2.length === 15 &&
  !names2.some((k) => k.includes('2026-01-01 0300')) && !names2.some((k) => k.includes('2026-01-02 0300')) &&
  names2.some((k) => k.includes('someone else.json')), names2);
const newest = names2.find((k) => !k.includes('2026-01-') && !k.includes('someone'));
const doc = JSON.parse(new TextDecoder().decode(files.get(newest).bytes));
check('backup holds every table row of this business', doc.business.id === B && doc.tables.products.length === 3 &&
  doc.tables.invoices.length >= 3 && doc.tables.lookups.length > 0 && doc.tables.customers.length === 2 &&
  !doc.tables.products.find((p) => p.sku === 'X-OTHER'), Object.keys(doc.tables));
check('backup holds no secrets and no codes', !('business_secrets' in doc.tables) && !JSON.stringify(doc).includes('sekret') &&
  !JSON.stringify(doc.tables.erp_people).includes('111111') && doc.tables.erp_people.length >= 3, doc.tables.erp_people);
const log = await sql`select * from erp_backup_log where business_id = ${B}`;
check('backup recorded (by hand)', log.length === 1 && log[0].why === 'by hand' && log[0].made === 1, log);

// ---------------------------------------------------------------- businesses
r = await mgr('erpCreateBusiness', [{ name: 'X' }]);
check('only owner creates a business', !r.ok, r);
r = await owner('erpCreateBusiness', [{ name: 'costareen' }]);
check('name must be new', !r.ok && r.error === 'A business called "costareen" already exists.', r);
r = await owner('erpCreateBusiness', [{ name: '  ' }]);
check('name required', !r.ok && r.error === 'Business name is required.', r);
r = await owner('erpCreateBusiness', [{ name: 'ProtoReen', emails: 'a@b.co, nope' }]);
check('bad email refused', !r.ok && r.error === 'That does not look like an email address: nope', r);
check('a refused create leaves nothing', (await sql`select count(*)::int n from businesses where name = 'ProtoReen'`)[0].n === 0);
const png = Buffer.from('fake-png-bytes').toString('base64');
r = await owner('erpCreateBusiness', [{ name: 'ProtoReen', bank: 'City Bank\nProtoReen Ltd\n1234567\nGulshan',
  logo: { data: png, mime: 'image/png', name: 'l.png' }, qr: { data: png, mime: 'image/png', name: 'q.png' },
  emails: 'Partner@Example.com; second@example.com' }]);
check('created: page shape', r.ok && r.result.ok && r.result.name === 'ProtoReen' && r.result.url === 'https://erp.costareen.com' &&
  Array.isArray(r.result.invited) && Array.isArray(r.result.couldNot) && /partner@example\.com, second@example\.com/.test(r.result.warning), r);
const NB = r.result.id;
r = await owner('erpBusinesses', []);
check('switched to it', r.ok && r.result.active === NB && r.result.businesses.length === 2, r);
r = await owner('erpSettingsFull', []);
check('new business: its own seeded lists and name', r.ok && r.result.lists.payment_methods.join() === 'bKash,Bangla QR,Cash,Bank Transfer,COD' &&
  r.result.lists.categories.length === 6 && r.result.config[0].value === 'ProtoReen' &&
  r.result.config.find((c) => c.key === 'partner_emails').value === 'partner@example.com, second@example.com', r.result);
r = await owner('erpCatalog', []);
check('new business starts empty', r.ok && r.result.length === 0, r);
const prof = (await sql`select value from quote_settings where business_id = ${NB} and key = 'profile'`)[0].value;
const assets = (await sql`select value from quote_settings where business_id = ${NB} and key = 'assets'`)[0].value;
check('profile: logo, QR, bank lines', prof.name === 'ProtoReen' && prof.logoId && prof.qrId && prof.banks[0].bank === 'City Bank' &&
  prof.banks[0].number === '1234567' && prof.banks[0].branch === 'Gulshan' && assets.length === 2 && assets.includes(prof.qrId), prof);
check('files stored under the new business', files.list().filter((k) => k.startsWith(NB + '/assets/')).length === 2);
check('payment QR recorded in its config', (await sql`select value from business_config where business_id = ${NB} and key = 'payment_qr_file_id'`)[0].value === prof.qrId);
r = await owner('erpCreateBusiness', [{ name: 'Plain' }]);
check('plain create: no warning', r.ok && r.result.warning === null, r);
r = await owner('erpSetBusiness', [B]);
check('switch back', r.ok);

r = await owner('erpDeployBusiness', [NB]);
check('deploy: clear sentence, nothing built', !r.ok && /same web address, https:\/\/erp\.costareen\.com/.test(r.error), r);
r = await owner('erpCheckBusinessSheet', ['https://docs.google.com/spreadsheets/d/abc']);
check('check sheet: sentence', r.ok && /nothing to check/.test(r.result.message), r);
r = await owner('erpForgetBusiness', [NB]);
check('forget: sentence, nothing removed', !r.ok && /Nothing was changed/.test(r.error) &&
  (await sql`select count(*)::int n from memberships where business_id = ${NB}`)[0].n === 1, r);
r = await shareholder('erpDeployBusiness', [NB]);
check('deploy owner-only', !r.ok && /does not have permission/.test(r.error), r);

// ---------------------------------------------------------------- bundle part
r = await shareholder('erpBundle', [['settings']]);
check('bundle settings part', r.ok && r.result.settings && r.result.settings.lists && !r.result.errors.settings, r.result && r.result.errors);

await done();
