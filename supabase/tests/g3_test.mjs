// The live backup sheet: every list in a Google Sheet, rewritten when it changes.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, check, done, web, deps, fnDir } from './harness.mjs';
const { runJob } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const B = FIX.B;
const PLA = 'FIL-SUN-PLA-BLA-001';
deps.google = { clientId: 'cid.apps.googleusercontent.com', clientSecret: 'sec', redirect: 'https://fn.test/erp?google=back', appUrl: 'https://app.test/' };

// a fake Google: Drive makes folders and the spreadsheet; Sheets keeps tabs and values
const tabs = new Map([['Sheet1', []]]);
let writes = 0, clears = 0;
web.on(/oauth2\.googleapis\.com\/token$/, () => ({ status: 200, body: { access_token: 'AT' } }));
web.on(/googleapis\.com\/drive\/v3\/files/, (url, opts) => { const b = JSON.parse(opts.body); return { status: 200, body: { id: b.mimeType === 'application/vnd.google-apps.spreadsheet' ? 'SHEET1' : 'FOLDER-' + b.name } }; });
web.on(/sheets\.googleapis\.com\/v4\/spreadsheets\/SHEET1\?fields/, () => ({ status: 200, body: { sheets: [...tabs.keys()].map((t, i) => ({ properties: { title: t, sheetId: i } })) } }));
web.on(/sheets\.googleapis\.com\/v4\/spreadsheets\/SHEET1:batchUpdate$/, (url, opts) => {
  for (const q of JSON.parse(opts.body).requests) {
    if (q.addSheet) tabs.set(q.addSheet.properties.title, []);
    if (q.updateSheetProperties) { const old = [...tabs.keys()][q.updateSheetProperties.properties.sheetId]; const v = tabs.get(old); tabs.delete(old); tabs.set(q.updateSheetProperties.properties.title, v); }
  }
  return { status: 200, body: {} };
});
web.on(/sheets\.googleapis\.com\/v4\/spreadsheets\/SHEET1\/values\/.*:clear$/, (url) => { clears++; const t = decodeURIComponent(url.split('/values/')[1].split(':clear')[0]).replace(/^'|'$/g, ''); tabs.set(t, []); return { status: 200, body: {} }; });
web.on(/sheets\.googleapis\.com\/v4\/spreadsheets\/SHEET1\/values\/[^:]+\?valueInputOption=RAW$/, (url, opts) => {
  writes++;
  const range = decodeURIComponent(url.split('/values/')[1].split('?')[0]);
  const m = /^'(.+)'!A(\d+)$/.exec(range);
  const t = m[1], at = Number(m[2]) - 1, cur = tabs.get(t) || [];
  JSON.parse(opts.body).values.forEach((row, i) => { cur[at + i] = row; });
  tabs.set(t, cur);
  return { status: 200, body: {} };
});

let r = await mgr('erpSheet', []);
check('the sheet is the owner\'s', !r.ok, r);
r = await owner('erpSheetCreate', []);
check('Google must be connected first', !r.ok && /Connect Google Drive first/.test(r.error), r);
await sql`insert into business_secrets (business_id, key, value) values (${B}, 'GOOGLE_REFRESH', 'RT') on conflict (business_id, key) do update set value = 'RT'`;
r = await owner('erpSheetCreate', []);
check('made in the business folder, with a "Read me" tab', r.ok && r.result.id === 'SHEET1' && r.result.url === 'https://docs.google.com/spreadsheets/d/SHEET1' &&
  tabs.has('Read me') && !tabs.has('Sheet1'), r.ok ? [...tabs.keys()] : r);
r = await owner('erpSheetCreate', []);
check('only one at a time', !r.ok && /already a backup sheet/.test(r.error), r);

// the timer fills it, ten tabs at a time
r = await runJob(deps, 'sheet');
check('first run writes the lists that have rows, at most ten a run', r.Costareen && r.Costareen.written >= 5 && r.Costareen.written <= 10 && (r.Costareen.written === 10 || r.Costareen.more === false), r);
check('invoices first, every column as a heading row', tabs.has('invoices') && tabs.get('invoices')[0].includes('invoice_no') && tabs.get('invoices').length > 1, [...tabs.keys()]);
for (let i = 0; i < 10; i++) { r = await runJob(deps, 'sheet'); if (!r.Costareen || !r.Costareen.more) break; }
const prodTab = tabs.get('products');
const hdr = prodTab[0], pla = prodTab.find((row) => row[hdr.indexOf('sku')] === PLA);
check('products: numbers stay numbers, codes stay text', pla && typeof pla[hdr.indexOf('sell_price')] === 'number' && typeof pla[hdr.indexOf('sku')] === 'string', pla);
check('secrets and keys never go to the sheet', !tabs.has('business_secrets') && !tabs.has('erp_access_keys') && !tabs.has('erp_ai_keys'), [...tabs.keys()]);
const cust = tabs.get('customers'), ph = cust[0].indexOf('phone'), withZero = cust.slice(1).find((x) => /^0/.test(String(x[ph])));
check('phone numbers keep their leading 0', !withZero || typeof withZero[ph] === 'string', withZero);

// nothing changed: nothing written
let before = writes;
r = await runJob(deps, 'sheet');
check('nothing changed: nothing written', r.Costareen.written === 0 && writes === before, r);

// a sale: the lists it touched are rewritten, the rest left alone
const invBefore = tabs.get('invoices').length;
await owner('erpCreateInvoice', [{ customer: { name: 'Sheet Buyer', phone: '01799100002' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
r = await runJob(deps, 'sheet');
check('a sale rewrites invoices, lines, payments, stock and the customer - not the rest', r.Costareen.written >= 4 && r.Costareen.written <= 8 &&
  tabs.get('invoices').length === invBefore + 1, [r, tabs.get('invoices').length, invBefore]);
// an edit (not a new row) shows too
const no = (await sql`select invoice_no from invoices where business_id = ${B} and customer_name = 'Sheet Buyer'`)[0].invoice_no;
await sql`update invoices set customer_address = 'Changed Road' where business_id = ${B} and invoice_no = ${no}`;
await runJob(deps, 'sheet');
const it = tabs.get('invoices'), row = it.find((x) => x[it[0].indexOf('invoice_no')] === no);
check('a changed row shows changed', row[it[0].indexOf('customer_address')] === 'Changed Road', row);

r = await owner('erpSheet', []);
check('status: link, tabs with row counts, last written', r.ok && r.result.tabs.some((t) => t.name === 'invoices' && t.rows > 0) && !!r.result.last && !r.result.error, r.result);

// Google trouble is shown, not hidden
web.on(/sheets\.googleapis\.com\/v4\/spreadsheets\/SHEET1\?fields/, () => ({ status: 404, body: {} }));
r = await owner('erpSheetSyncNow', []);
check('a deleted sheet is said plainly', r.ok && /deleted in Google/.test(r.result.error), r.result);
r = await owner('erpSheetStop', []);
check('stopped: no sheet, nothing more written', r.ok && !r.result.id, r.result);
before = writes;
await runJob(deps, 'sheet');
check('...the timer leaves it alone', writes === before);
await done();
