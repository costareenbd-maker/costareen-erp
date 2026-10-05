// Invoice layout (2026-10-06): at least 5 item rows, PAID / PARTLY PAID / DUE stamp on top, the big amount at the bottom
// (or on top when chosen), logo size and side, the page filled to A4.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { check, done, fnDir } from './harness.mjs';
const D1 = await import(pathToFileURL(path.join(fnDir, 'handlers', 'invoicedesign.js')));
const S = await import(pathToFileURL(path.join(fnDir, 'handlers', 'sales.js')));
const inv = (n, paid, due) => ({ invoiceNo: 'INV-1', head: { customer: 'K', when: new Date('2026-10-06') },
  lines: Array.from({ length: n }, (_, i) => ({ product: 'P' + i, qty: 1, price: 100, gross: 100, total: 100, serials: [] })), gross: 100 * n, itemDisc: 0, invDisc: 0, totalDisc: 0, delivery: 0, grand: 100 * n, paid, due, perLine: false });
const des = (t, x) => ({ template: t, accent: '', dark: '', font: 'sans', title: 'INVOICE', thanks: '', terms: '', qrId: '', qrLabel: 'Scan to pay', bigTop: false, logoSize: 'm', logoSide: 'left', show: { banks: true, qr: true, signature: false, phone: true, delivery: true }, ...(x || {}) });
const p = { name: 'Shop', address: 'Dhaka', phone: '0171', banks: [] }, s = { currency: 'BDT' };
const page = async (t, d, x) => (await D1.invoiceDoc(d, p, s, {}, { logo: 'data:image/png;base64,AA', qr: '' }, new Date(), des(t, x), S.invoiceArtParts)).html;
const count = (h, re) => (h.match(re) || []).length;

for (const t of ['wave', 'modern', 'minimal', 'classic', 'bold']) {
  let h = await page(t, inv(1, 100, 0));
  check(t + ': 1 item gives 5 rows (4 empty)', count(h, /<tr class="blank">/g) === 4, count(h, /<tr class="blank">/g));
  check(t + ': paid -> PAID stamp, Total bar at the bottom', /class="pstamp"[^>]*>PAID</.test(h) && /class="bigb"[\s\S]*?Total<\/span><b>BDT 100</.test(h), t);
  check(t + ': the page is filled to A4', /body\{min-height:\d+mm;display:flex/.test(h), t);
  h = await page(t, inv(7, 0, 700));
  check(t + ': 7 items, no empty rows; DUE stamp; Amount due bar', count(h, /<tr class="blank">/g) === 0 && />DUE</.test(h) && /Amount due<\/span><b>BDT 700</.test(h), t);
  h = await page(t, inv(2, 50, 150));
  check(t + ': part paid -> PARTLY PAID', />PARTLY PAID</.test(h), t);
}
let h = await page('bold', inv(1, 0, 100), { bigTop: true });
check('big amount on top when chosen: no stamp, no bottom bar', !/class="pstamp"/.test(h) && !/class="bigb"/.test(h) && /class="big"/.test(h));
h = await page('modern', inv(1, 0, 100), { logoSize: 'l', logoSide: 'right' });
check('logo large and on the right', /\.lgo\{height:24\.3mm/.test(h) && /\.band\{flex-direction:row-reverse\}/.test(h));
h = (await D1.invoiceDoc(inv(1, 100, 0), p, s, {}, {}, new Date(), des('receipt'), S.invoiceArtParts)).html;
check('the receipt stays short (no A4 fill, no empty rows)', !/min-height/.test(h) && !/class="blank"/.test(h));
await done();
