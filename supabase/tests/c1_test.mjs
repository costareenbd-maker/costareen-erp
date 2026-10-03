// Settings > Connections: one place for every outside service; the website sync off until switched on.
import { sql, FIX, owner, mgr, makeShareholder, shareholder, check, done, web } from './harness.mjs';
await makeShareholder();

let r = await shareholder('erpConnections', []);
check('connections are the owner\'s', !r.ok, r);
r = await owner('erpConnections', []);
check('every connection with its state', r.ok && ['website', 'courier', 'whatsapp', 'email', 'google', 'ai'].every((k) => r.result[k] && r.result[k].state) &&
  r.result.website.state === 'off' && r.result.website.url === 'https://costareen.com/wp-json/cz/v1' && r.result.email.state === 'warn', r.result);

r = await owner('erpWebsiteSync', [{ on: true }]);
check('the sync cannot be switched on without a key', !r.ok && /keys first/.test(r.error), r);
r = await owner('erpWebsiteSet', [{ url: 'http://insecure.example/x', key: 'abc' }]);
check('the address must be https', !r.ok && /https:\/\//.test(r.error), r);
r = await owner('erpWebsiteSet', [{ url: 'https://shop.example.com/wp-json/cz/v1', key: 'short' }]);
check('a key too short is refused', !r.ok && /sync key/.test(r.error), r);
r = await owner('erpWebsiteSet', [{ url: 'https://shop.example.com/wp-json/cz/v1/', key: 'k-123456789012' }]);
check('saved: key never shown back, sync still off', r.ok && r.result.website.hasKey && r.result.website.state === 'ready' && r.result.website.on === false &&
  r.result.website.url === 'https://shop.example.com/wp-json/cz/v1' && !JSON.stringify(r.result).includes('k-123456789012'), r.result.website);

web.on(/shop\.example\.com\/wp-json\/cz\/v1\/ping$/, (url, opts) => (opts.headers['x-cz-key'] === 'k-123456789012' ? { status: 200, body: { site: 'Shop Example' } } : { status: 401, body: {} }));
r = await owner('erpWebsiteTest', []);
check('test: the website answers with the right key', r.ok && r.result.ok && r.result.reply === 'Shop Example', r);
await owner('erpWebsiteSet', [{ key: 'wrong-key-0000000' }]);
r = await owner('erpWebsiteTest', []);
check('test: a wrong key is said plainly', r.ok && !r.result.ok && /refused the key/.test(r.result.error), r);

r = await owner('erpWebsiteSync', [{ on: true }]);
check('switched on', r.ok && r.result.website.state === 'on' && /Live/.test(r.result.website.label), r.result.website);
const cfg = await sql`select value from business_config where business_id = ${FIX.B} and key = 'website_sync_on'`;
check('...written for the timer', cfg[0] && cfg[0].value === '1', cfg);
r = await owner('erpWebsiteSync', [{ on: false }]);
check('switched off again', r.ok && r.result.website.state === 'ready', r.result.website);
r = await owner('erpWebsiteSet', [{ clearKey: true }]);
check('the key removed: not connected, sync off', r.ok && r.result.website.state === 'off' && !r.result.website.hasKey, r.result.website);
r = await mgr('erpWebsiteSet', [{ key: 'x-123456789012' }]);
check('a manager cannot change it', !r.ok, r);
const o2 = await sql`select count(*)::int n from business_secrets where business_id = ${FIX.B2} and key = 'CZ_SYNC_KEY'`;
check('another business untouched', o2[0].n === 0);
await done();
