// Google Drive copies: connect (OAuth, drive.file), queue, the timer copies, disconnect.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, web, deps, fnDir, files } from './harness.mjs';
const { googleCallback } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'google.js')));
const { runJob } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';

let r = await owner('erpGoogleStart', []);
check('without the system set up for Google: said plainly', !r.ok && /not set up on this system/.test(r.error), r);
deps.google = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec', redirect: 'https://fn.test/erp?google=back', appUrl: 'https://app.test/' };

r = await mgr('erpGoogle', []);
check('Google is the owner\'s matter', !r.ok, r);
r = await owner('erpGoogle', []);
check('not connected yet', r.ok && r.result.configured && !r.result.connected && r.result.waiting === 0, r.result);
r = await owner('erpGoogleStart', []);
const u = r.ok && new URL(r.result.url);
check('the Google address asks for drive.file only, offline, with a state for this business', u && u.hostname === 'accounts.google.com' &&
  u.searchParams.get('scope') === 'https://www.googleapis.com/auth/drive.file openid email' && u.searchParams.get('access_type') === 'offline' &&
  u.searchParams.get('state').startsWith(B + '.') && u.searchParams.get('redirect_uri') === 'https://fn.test/erp?google=back', r);
const state = u.searchParams.get('state');

// a file saved before connecting is not queued
await owner('erpExport', [{ what: 'suppliers' }]);
check('nothing is queued while Google is not connected', (await sql`select count(*)::int n from drive_queue where business_id = ${B}`)[0].n === 0);

// Google sends the owner back
const idToken = 'x.' + Buffer.from(JSON.stringify({ email: 'owner@gmail.test' })).toString('base64url') + '.y';
let tokenCalls = 0;
web.on(/oauth2\.googleapis\.com\/token$/, (url, opts) => {
  tokenCalls++;
  const b = new URLSearchParams(opts.body);
  if (b.get('grant_type') === 'authorization_code') return b.get('code') === 'good' ? { status: 200, body: { refresh_token: 'RT-1', access_token: 'AT-1', id_token: idToken } } : { status: 400, body: { error: 'invalid_grant' } };
  return b.get('refresh_token') === 'RT-1' ? { status: 200, body: { access_token: 'AT-2' } } : { status: 400, body: { error: 'invalid_grant' } };
});
let to = await googleCallback(deps, { state: B + '.' + 'f'.repeat(32), code: 'good' });
check('a forged state is refused', /google=expired/.test(to), to);
to = await googleCallback(deps, { state, code: 'bad' });
check('a bad code: failed, and the state is used up', /google=failed/.test(to), to);
to = await googleCallback(deps, { state, code: 'good' });
check('...the same state cannot be used twice', /google=expired/.test(to), to);
r = await owner('erpGoogleStart', []);
to = await googleCallback(deps, { state: new URL(r.result.url).searchParams.get('state'), code: 'good' });
check('connected: back to the app', to === 'https://app.test/#/settings?google=ok', to);
r = await owner('erpGoogle', []);
check('connected as the Google account', r.result.connected && r.result.email === 'owner@gmail.test', r.result);
const sec = await sql`select value from business_secrets where business_id = ${B} and key = 'GOOGLE_REFRESH'`;
check('the refresh token is kept server-side only', sec[0].value === 'RT-1' && !JSON.stringify(r.result).includes('RT-1'));
r = await owner('erpConnections', []);
if (!r.ok) console.log('CONN ERR', r.error);
check('Connections shows Google green', r.result.google.state === 'on' && /owner@gmail\.test/.test(r.result.google.label), r.result.google);

// files saved now are queued; the timer copies them into dated folders
r = await owner('erpCreateInvoice', [{ customer: { name: 'Drive Buyer', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
check('an invoice saved', r.ok, r);
await owner('erpExport', [{ what: 'products' }]);
const q1 = await sql`select folder, name from drive_queue where business_id = ${B} order by id`;
check('its PDF and the Excel export are queued', q1.some((x) => x.folder === 'invoices' && /^Invoice_/.test(x.name)) && q1.some((x) => x.folder === 'exports'), q1);
const made = [], uploads = [];
let fid = 0;
web.on(/googleapis\.com\/drive\/v3\/files/, (url, opts) => { const b = JSON.parse(opts.body); made.push({ name: b.name, parents: b.parents || [], auth: opts.headers.Authorization }); return { status: 200, body: { id: 'F' + (++fid) } }; });
web.on(/googleapis\.com\/upload\/drive\/v3\/files/, (url, opts) => { uploads.push({ type: opts.headers['Content-Type'], size: opts.body.length }); return { status: 200, body: { id: 'U' + uploads.length } }; });
r = await runJob(deps, 'drive');
check('the timer copies them', r.Costareen && r.Costareen.copied === q1.length && r.Costareen.failed === 0, r);
check('...into "ERP - Costareen / Invoices / <month>" and "Excel exports", made once', made[0].name === 'ERP - Costareen' && made.some((m) => m.name === 'Invoices') &&
  made.some((m) => /^\d{4}-\d{2}$/.test(m.name)) && made.some((m) => m.name === 'Excel exports') && made.every((m) => m.auth === 'Bearer AT-2'), made);
check('...as multipart uploads', uploads.length === q1.length && uploads.every((x) => /^multipart\/related; boundary=/.test(x.type) && x.size > 100), uploads);
r = await owner('erpGoogle', []);
check('status: copied, nothing waiting, a link to the folder', r.result.copied === q1.length && r.result.waiting === 0 && r.result.folderUrl === 'https://drive.google.com/drive/folders/F1', r.result);
const before = made.length;
await owner('erpExport', [{ what: 'customers' }]);
await runJob(deps, 'drive');
check('the folders are made once and reused', made.length === before, made.slice(before));

// copy what was there before connecting
r = await owner('erpGoogleCopyAll', []);
check('older files are queued too (once)', r.ok && r.result.queued >= 1, r.result);
r = await owner('erpGoogleCopyAll', []);
check('...not twice', r.ok && r.result.queued === 0, r.result);
await runJob(deps, 'drive');

// Google withdrawn: told plainly, nothing lost (it stays in the queue)
await sql`update business_secrets set value = 'RT-gone' where business_id = ${B} and key = 'GOOGLE_REFRESH'`;
await owner('erpExport', [{ what: 'suppliers' }]);
r = await runJob(deps, 'drive');
const waiting = await sql`select tries, error from drive_queue where business_id = ${B} and done_at is null`;
check('permission removed in Google: the file waits, with the reason', waiting.length === 1 && /Connect Google again/.test(waiting[0].error), waiting);

// a quotation PDF is kept and queued
await sql`update business_secrets set value = 'RT-1' where business_id = ${B} and key = 'GOOGLE_REFRESH'`;
const qid = 'q-' + Date.now();
await sql`insert into quotations (id, business_id, reference, status, title, doc) values (${qid}, ${B}, 'QUO-7', 'Ready', 'T', '{}'::jsonb)`;
r = await sales('erpQuotePdfSave', [{ id: qid, html: '<div class="quote-page">Q</div>' }]);
check('a quotation\'s PDF is kept', r.ok && r.result.name === 'Quotation_QUO-7.pdf' && files.list().some((k) => k.endsWith('/quotes/Quotation_QUO-7.pdf')), r);
check('...and queued for Drive', (await sql`select count(*)::int n from drive_queue where business_id = ${B} and folder = 'quotes'`)[0].n === 1);

// disconnect
let revoked = false;
web.on(/oauth2\.googleapis\.com\/revoke$/, () => { revoked = true; return { status: 200, body: {} }; });
r = await owner('erpGoogleDisconnect', []);
check('disconnected: Google told, nothing waiting, not connected', r.ok && revoked && !r.result.connected && r.result.waiting === 0, r.result);
await owner('erpExport', [{ what: 'suppliers' }]);
check('...and nothing more is queued', (await sql`select count(*)::int n from drive_queue where business_id = ${B} and done_at is null`)[0].n === 0);
const o2 = await sql`select count(*)::int n from drive_queue where business_id = ${FIX.B2}`;
check('another business untouched', o2[0].n === 0);
await done();
