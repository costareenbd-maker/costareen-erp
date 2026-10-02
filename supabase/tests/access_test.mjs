// Access by private link: with the sign-in screen off, only a key opens the door.
import { sql, FIX, owner, mgr, check, done, deps, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const { keyHash, newKey } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
const live = { ...deps, linkOnly: true };                     // as the deployed function runs
const call = (name, args, token, ip) => erpCall(live, { name, args, token, ip, authHeader: '' });
const PLA = 'FIL-SUN-PLA-BLA-001';

// the first key is put in by hand, as on the live system
const K1 = newKey();
await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(K1)}, ${FIX.U.owner}, 'Rahman phone')`;
check('a key is long and safe to paste', /^[A-Za-z0-9_-]{43}$/.test(K1), K1.length);
check('only its hash is stored', !(JSON.stringify(await sql`select * from erp_access_keys`)).includes(K1));

// ---- nothing but a key gets in
let r = await call('erpHello', [], {});
check('no key: told it is private, nothing else', r.ok && r.result.ok === false && r.result.reason === 'NO_KEY' && /private system/.test(r.result.message), r);
r = await call('erpCatalog', [], {});
check('no key: no data', !r.ok && /private system/.test(r.error), r);
r = await call('erpCatalog', [], { code: '111111', device: 'dev-mgr' });
check('a staff code no longer opens anything', !r.ok && /private system/.test(r.error), r);
r = await erpCall(live, { name: 'erpCatalog', args: [], token: {}, authHeader: 'Bearer owner:' + FIX.U.owner });
check('an owner session no longer opens anything', !r.ok && /private system/.test(r.error), r);
r = await call('erpCatalog', [], { key: 'x'.repeat(43) }, '10.9.9.9');
check('a wrong key is refused', !r.ok && /does not work any more/.test(r.error), r);
r = await call('erpCatalog', [], { key: "' or 1=1 --" }, '10.9.9.9');
check('rubbish is refused', !r.ok, r);

// ---- the key opens the business, as its owner
r = await call('erpHello', [], { key: K1, device: 'd1', label: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' }, '10.0.0.5');
check('the key signs in as owner, named by its label', r.ok && r.result.ok && r.result.role === 'owner' && r.result.name === 'Rahman phone' && r.result.link === true, r);
r = await call('erpCatalog', [], { key: K1 });
check('...and reads the catalog', r.ok && r.result.some((p) => p.sku === PLA), r);
r = await call('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }], { key: K1, label: 'Mozilla/5.0 (Linux; Android 14) Chrome/120' });
check('...and saves an invoice', r.ok && !!r.result.invoiceNo, r);
r = await call('erpSecurity', [{}], { key: K1 });
check('activity names the link and the device', r.ok && r.result.activity.some((a) => a.what === 'Saved an invoice' && a.who === 'Rahman phone' && a.device === 'Access link · Android · Chrome'), r.result && r.result.activity.slice(0, 3));
r = await erpCall(live, { name: 'erpCatalog', args: [], token: { key: K1 } });
check('another business stays closed to it', r.ok && !r.result.some((p) => p.sku === 'X-OTHER'), r);

// ---- making and switching off links
r = await call('erpAccessKeyNew', [{ label: '' }], { key: K1 });
check('a link needs a name', !r.ok && /Who or what is this link for/.test(r.error), r);
r = await call('erpAccessKeyNew', [{ label: 'Shop phone' }], { key: K1 });
const K2 = r.ok && r.result.fresh.key;
check('a new link: key shown once', r.ok && /^[A-Za-z0-9_-]{43}$/.test(K2) && r.result.keys.length === 2 && !JSON.stringify(r.result.keys).includes(K2), r.result && r.result.keys);
r = await call('erpAccessKeys', [], { key: K1 });
check('the list never holds a key, and marks the one in use', r.ok && !JSON.stringify(r).includes(K1) && !JSON.stringify(r).includes(K2) &&
  r.result.keys.find((k) => k.label === 'Rahman phone').current === true && r.result.keys.find((k) => k.label === 'Shop phone').current === false, r.result);
r = await call('erpHello', [], { key: K2 });
check('the new link works', r.ok && r.result.ok && r.result.name === 'Shop phone', r);
const log = await sql`select action, detail from erp_activity`;
check('no key in the activity log', !JSON.stringify(log).includes(K2) && !JSON.stringify(log).includes(K1) && log.some((l) => l.action === 'erpAccessKeyNew'), log.slice(-3));
const id1 = (await call('erpAccessKeys', [], { key: K1 })).result.keys.find((k) => k.current).id;
const id2 = (await call('erpAccessKeys', [], { key: K1 })).result.keys.find((k) => !k.current).id;
r = await call('erpAccessKeyRevoke', [{ id: id1 }], { key: K1 });
check('the link in use cannot switch itself off', !r.ok && /the link this device is using/.test(r.error), r);
r = await call('erpAccessKeyRevoke', [{ id: id2 }], { key: K1 });
check('a link switched off', r.ok && r.result.keys.find((k) => k.id === id2).revoked === true, r.result);
r = await call('erpCatalog', [], { key: K2 });
check('...stops working at once', !r.ok && /does not work any more/.test(r.error), r);
r = await call('erpAccessKeyRevoke', [{ id: id2 }], { key: K1 });
check('...and cannot be switched off twice', !r.ok, r);

// ---- guessing is limited by internet address
for (let i = 0; i < 20; i++) await call('erpHello', [], { key: 'y'.repeat(43) }, '10.6.6.6');
r = await call('erpCatalog', [], { key: K1 }, '10.6.6.6');
check('twenty wrong keys lock that address out', !r.ok && /Too many wrong codes/.test(r.error), r);
r = await call('erpCatalog', [], { key: K1 }, '10.0.0.5');
check('...and nobody else', r.ok, r);

// ---- the test harness itself (sign-in not switched off) is unchanged
r = await mgr('erpCatalog', []);
check('without linkOnly the old doors still work (tests only)', r.ok);
r = await owner('erpAccessKeys', []);
check('...and an owner session can list links', r.ok && r.result.keys.length === 2, r);

await done();
