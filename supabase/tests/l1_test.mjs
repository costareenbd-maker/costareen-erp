// Each person's screen language is kept with their login.
import { sql, owner, mgr, sales, check, done, pdfs } from './harness.mjs';
let r = await owner('erpSetLang', ['fr']);
check('only English or Bangla', !r.ok, r);
r = await owner('erpSetLang', ['bn']);
check('Bangla saved', r.ok && r.result.lang === 'bn', r);
r = await owner('erpBusinesses', []);
check('...and handed back with the business list', r.ok && r.result.lang === 'bn', r.result && r.result.lang);
r = await mgr('erpBusinesses', []);
check('another person keeps their own (none yet)', r.ok && r.result.lang === '', r.result && r.result.lang);
await owner('erpSetLang', ['en']);
r = await owner('erpBusinesses', []);
check('back to English', r.result.lang === 'en');

// what the customer receives: the business's choice
r = await sales('erpDocLang', ['bn']);
check('only the owner sets the customer documents language', !r.ok, r);
r = await owner('erpDocLang', ['bn']);
check('Bangla documents set', r.ok && r.result.lang === 'bn', r);
const before = pdfs.length;
r = await owner('erpCreateInvoice', [{ customer: { name: 'Doc Buyer', phone: '01711000777' }, items: [{ sku: 'FIL-SUN-PLA-BLA-001', qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
const html = pdfs.length > before ? String(pdfs[pdfs.length - 1].html || pdfs[pdfs.length - 1]) : '';
check('the invoice PDF prints Bangla labels, the product name as typed', r.ok && html.includes('>ইনভয়েস<') && html.includes('সাবটোটাল') && html.includes('Sunlu'), html.slice(0, 200));
await owner('erpDocLang', ['en']);
await done();
