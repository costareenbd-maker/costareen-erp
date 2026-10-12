// WooCommerce in one click (easy-1): the approve page link, and the keys WooCommerce sends back.
import { owner, mgr, deps, sql, FIX, check, done } from './harness.mjs';
import { wooKeysCallback } from '../functions/erp/handlers/wooauth.js';

deps.google = { redirect: 'https://fn.example/functions/v1/erp?google=back', appUrl: 'https://erp.example/' };

let r = await mgr('erpWooConnectStart', [{ url: 'shop.example.com' }]);
check('only the owner connects the shop', !r.ok, r);
r = await owner('erpWooConnectStart', [{ url: '' }]);
check('an empty address is asked for', !r.ok && /shop address/.test(r.error), r);
r = await owner('erpWooConnectStart', [{ url: 'shop.example.com/wp-admin' }]);
const u = r.ok ? new URL(r.result.url) : null;
check('the link goes to the shop\'s own approve page', r.ok && u.origin === 'https://shop.example.com' && u.pathname === '/wc-auth/v1/authorize', r);
check('it asks for read and write, sends the keys to this server, comes back to Settings',
  u && u.searchParams.get('scope') === 'read_write' && u.searchParams.get('callback_url') === 'https://fn.example/functions/v1/erp?woo=keys' && /#\/settings\?woo=back$/.test(u.searchParams.get('return_url')), u && u.search);
const uid = u ? u.searchParams.get('user_id') : '';
check('the business and a one-time code ride along', uid.startsWith(FIX.B + '.'), uid);

let c = await wooKeysCallback(deps, { user_id: FIX.B + '.' + '0'.repeat(32), consumer_key: 'ck_' + 'a'.repeat(40), consumer_secret: 'cs_' + 'b'.repeat(40), key_permissions: 'read_write' });
check('a wrong code is refused', c.status === 403, c);
c = await wooKeysCallback(deps, { user_id: uid, consumer_key: 'bad', consumer_secret: 'cs_' + 'b'.repeat(40) });
check('keys that are not WooCommerce keys are refused', c.status === 400, c);
c = await wooKeysCallback(deps, { user_id: uid, consumer_key: 'ck_' + 'a'.repeat(40), consumer_secret: 'cs_' + 'b'.repeat(40), key_permissions: 'read_write' });
check('the real answer is taken', c.status === 200 && c.body.ok, c);
const sec = await sql`select key from business_secrets where business_id = ${FIX.B} and key in ('WOO_KEY','WOO_SECRET') order by key`;
check('both keys are kept as secrets', sec.length === 2, sec);
c = await wooKeysCallback(deps, { user_id: uid, consumer_key: 'ck_' + 'c'.repeat(40), consumer_secret: 'cs_' + 'd'.repeat(40), key_permissions: 'read_write' });
check('the same code twice is refused', c.status === 403, c);
r = await owner('erpConnections', []);
check('the website shows as WooCommerce with keys, live sync still off', r.ok && r.result.website.kind === 'woo' && r.result.website.state === 'ready' && r.result.website.url === 'https://shop.example.com', r.ok && r.result.website);
const other = await sql`select count(*)::int n from business_secrets where business_id = ${FIX.B2} and key like 'WOO%'`;
check('the other business is untouched', other[0].n === 0, other);
await done();
