// Invoice designs: several looks, options, a payment QR of its own; the invoice PDF follows the chosen design.
import { sql, FIX, owner, mgr, sales, check, done, pdfs } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001';
const lastHtml = () => (pdfs[pdfs.length - 1] || {}).html || '';

// a company profile with a bank account, as the quotations keep it
let r = await owner('erpQuoteProfileSave', [{ profile: { name: 'Costareen', address: 'Shop 4, Multiplan\nDhaka', phone: '01700000000', email: 'hi@shop.test', footer: 'Thanks from the shop',
  banks: [{ bank: 'City Bank', name: 'Costareen', number: '1234567' }] } }]);
check('company details saved (shared with quotations)', r.ok, r);

// 1. defaults: the original look
r = await sales('erpInvoiceDesign', []);
check('sales staff can see the design', r.ok && r.result.design.template === 'wave' && r.result.templates.length === 6 && !r.result.canEdit, r.ok ? r.result.templates.map((t) => t.id) : r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01712345678' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full' }]);
check('an invoice is made', r.ok, r);
const inv1 = r.result.invoiceNo;
let h = lastHtml();
check('no design chosen: the original wave look', /<svg viewBox="0 0 210 43"/.test(h) && />INVOICE<\/div>/.test(h) && /City Bank/.test(h), h.slice(0, 120));

// 2. refusals
r = await sales('erpInvoiceDesignSave', [{ design: { template: 'modern' } }]);
check('sales staff cannot change it', !r.ok && /manager/.test(r.error), r);

// 3. every design draws the invoice (preview of a real invoice)
for (const t of ['wave', 'modern', 'minimal', 'classic', 'bold', 'receipt']) {
  r = await sales('erpInvoicePreview', [{ design: { template: t }, invoiceNo: inv1 }]);
  check('preview: ' + t, r.ok && r.result.html.includes(inv1) && r.result.html.includes('Karim') && r.result.html.includes('Costareen'), r.ok ? r.result.html.length : r);
}
r = await sales('erpInvoicePreview', [{ design: { template: 'receipt' }, invoiceNo: inv1 }]);
check('the receipt is 80 mm wide', /@page\{size:80mm \d+mm/.test(r.result.html));

// 4. options
r = await mgr('erpInvoiceDesignSave', [{ design: { template: 'modern', accent: '#0ea5e9', dark: '#0f172a', title: 'CASH MEMO', thanks: 'Come again!', terms: 'No return after 7 days.', show: { banks: false, signature: true } } }]);
check('manager saves a design', r.ok && r.result.design.template === 'modern' && r.result.design.show.banks === false && r.result.design.show.qr === true, r);
r = await mgr('erpCreateInvoice', [{ customer: { name: 'Rahim', phone: '01811111111' }, items: [{ sku: PLA, qty: 1 }], payMode: 'none' }]);
h = lastHtml();
check('the next invoice PDF uses it', r.ok && /class="band"/.test(h) && /CASH MEMO/.test(h) && /#0ea5e9/.test(h), h.slice(0, 160));
check('...its thank-you line and terms', /Come again!/.test(h) && /No return after 7 days\./.test(h));
check('...bank accounts hidden, signature line shown', !/City Bank/.test(h) && /Authorised signature/.test(h));
check('...the amount due shown', /Due<\/td><td class="r">BDT/.test(h), h.match(/Due<\/td>[^<]*<td[^>]*>[^<]*/));

// 5. a payment QR just for invoices
const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
r = await sales('erpInvoiceQrUpload', [{ mime: 'image/png', data: png }]);
check('sales staff cannot upload the QR', !r.ok, r);
r = await mgr('erpInvoiceQrUpload', [{ mime: 'image/png', data: png }]);
check('manager uploads a payment QR', r.ok && r.result.design.qrId, r);
r = await sales('erpInvoicePreview', [{ invoiceNo: inv1 }]);
check('the saved design (with the QR) is what the preview shows', r.ok && /data:image\/png;base64/.test(r.result.html) && /Scan to pay/.test(r.result.html) && /CASH MEMO/.test(r.result.html), r.ok ? r.result.html.length : r);

// 6. wave with options: the title, terms and the QR caption change, the look stays
r = await mgr('erpInvoiceDesignSave', [{ design: { template: 'wave', title: 'BILL', terms: 'Warranty as per maker.', qrLabel: 'bKash QR', show: { delivery: false } } }]);
r = await sales('erpInvoicePreview', [{ invoiceNo: inv1 }]);
check('wave with a new title, terms and QR caption', r.ok && /<svg viewBox="0 0 210 43"/.test(r.result.html) && />BILL<\/div>/.test(r.result.html) && /Warranty as per maker\./.test(r.result.html), r.ok ? '' : r);

// 7. nothing yet: a sample invoice
await sql`delete from quote_settings where business_id = ${FIX.B2}`;
r = await owner('erpSetBusiness', [FIX.B2]);
// (the owner is not in B2 - so the sample check runs in B with no invoice number given: the latest invoice is used)
r = await sales('erpInvoicePreview', [{ design: { template: 'classic' } }]);
check('no number given: the latest invoice is shown', r.ok && r.result.invoiceNo && !r.result.sample, r.ok ? r.result.invoiceNo : r);
r = await mgr('erpInvoiceDesignSave', [{ design: { template: 'nope', accent: 'red', font: 'comic' } }]);
check('unknown values fall back safely', r.ok && r.result.design.template === 'wave' && r.result.design.accent === '' && r.result.design.font === 'sans', r);
await done();
