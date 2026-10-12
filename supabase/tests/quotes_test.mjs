// Quotations group (handlers/quotes.js). Run through erp_server_test.py with
// TEST_SCRIPT=quotes_test.mjs.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, makeShareholder, shareholder, check, done, files, fnDir } from './harness.mjs';

const Q = await import(pathToFileURL(path.join(fnDir, 'handlers', 'quotes.js')));
await makeShareholder();
const err = (r) => (r && !r.ok ? r.error : '');

// ---- boot before anything is set: defaults, name from the business ----
let r = await sales('erpQuoteBoot', []);
check('boot works for sales', r.ok, r);
const b0 = r.result;
check('boot: default settings (ERP:9227)', b0.settings.prefix === 'QUO' && b0.settings.validDays === 15 && b0.settings.autoNumber === true &&
  b0.settings.accent === '#dda51c' && b0.settings.dark === '#303030' && b0.settings.version === 0 && b0.settings.fontSize === 'Comfortable', b0.settings);
check('boot: letterhead defaults', b0.letterhead.style === 'Signature' && b0.letterhead.logoSide === 'left' && b0.letterhead.version === 0, b0.letterhead);
check('boot: profile name falls back to the business name', b0.profile.name === 'Costareen' && Array.isArray(b0.profile.banks) && b0.profile.logoId === '', b0.profile);
check('boot: sales cannot settings/snippets', b0.canSettings === false && b0.canSnippets === false && /^\d{4}-\d{2}-\d{2}$/.test(b0.today), b0);
check('boot: empty lists', b0.snippets.length === 0 && b0.savedItems.length === 0, b0);
r = await mgr('erpQuoteBoot', []);
check('boot: manager canSnippets only', r.result.canSnippets === true && r.result.canSettings === false, r.result);
r = await shareholder('erpQuoteBoot', []);
check('boot: shareholder canSettings', r.result.canSettings === true && r.result.canSnippets === true, r.result);

// ---- profile ----
r = await mgr('erpQuoteProfileSave', [{ profile: { name: 'X' } }]);
check('manager refused profile save', err(r) === 'Your account does not have access to that.', r);
r = await shareholder('erpQuoteProfileSave', [{ profile: { name: '  ' } }]);
check('profile: name required', err(r) === 'The business name is required.', r);
r = await shareholder('erpQuoteProfileSave', [{ profile: { name: 'x'.repeat(301) } }]);
check('profile: long name', err(r) === 'Business name is too long (at most 300 characters).', r);
r = await shareholder('erpQuoteProfileSave', [{ profile: { name: ' Costareen Ltd ', address: 'Dhaka', phone: '017', footer: 'Thanks',
  banks: [{ id: 'b1', bank: 'City Bank', name: 'Costareen', number: '123', branch: 'Gulshan' }, { bank: '', number: '' },
          { bank: 'DBBL', number: '999', extra: 'note' }] } }]);
check('profile saved: trimmed name, empty bank dropped, ids kept/minted', r.ok && r.result.name === 'Costareen Ltd' &&
  r.result.banks.length === 2 && r.result.banks[0].id === 'b1' && r.result.banks[1].id.length === 36 && r.result.banks[1].extra === 'note', r);
const bank2 = r.ok ? r.result.banks[1].id : '';

// ---- settings ----
r = await shareholder('erpQuoteSettingsSave', [{ settings: { prefix: 'Q', validDays: 10 }, expectedVersion: 1 }]);
check('settings: version conflict', err(r) === 'CONFLICT: settings were changed by someone else. Reload them first.', r);
r = await shareholder('erpQuoteSettingsSave', [{ settings: { prefix: 'Q T' }, expectedVersion: 0 }]);
check('settings: bad prefix', err(r) === 'Prefix: letters, numbers and - only, up to 15.', r);
r = await shareholder('erpQuoteSettingsSave', [{ settings: { validDays: 400 }, expectedVersion: 0 }]);
check('settings: validDays range', err(r) === 'Validity days must be between 0 and 365.', r);
r = await shareholder('erpQuoteSettingsSave', [{ settings: { prefix: 'CZ', validDays: 10, accent: 'red', mixedTerms: 'Mixed T' }, expectedVersion: 0 }]);
check('settings saved: version 1, kept fields, bad colour -> default', r.ok && r.result.version === 1 && r.result.prefix === 'CZ' &&
  r.result.validDays === 10 && r.result.accent === '#dda51c' && r.result.currency === 'BDT' && r.result.mixedTerms === 'Mixed T', r);
r = await sales('erpQuoteSettingsSave', [{ settings: {}, expectedVersion: 1 }]);
check('sales refused settings', err(r) === 'Your account does not have access to that.', r);

// ---- letterhead ----
r = await shareholder('erpLetterheadSave', [{ letterhead: { style: 'Band', logoSide: 'right', font: 'Comic' }, expectedVersion: 0 }]);
check('letterhead saved', r.ok && r.result.version === 1 && r.result.style === 'Band' && r.result.logoSide === 'right' && r.result.font === 'Arial', r);
r = await shareholder('erpLetterheadSave', [{ letterhead: {}, expectedVersion: 0 }]);
check('letterhead conflict', err(r) === 'CONFLICT: the letterhead was changed by someone else. Reload it first.', r);

// ---- snippets ----
r = await sales('erpQuoteSnippetsSave', [{ snippets: [] }]);
check('sales refused snippets', err(r) === 'Your account does not have access to that.', r);
r = await mgr('erpQuoteSnippetsSave', [{ snippets: [{ title: ' ', text: 'x' }] }]);
check('snippet needs a title', err(r) === 'Every condition needs a title.', r);
r = await mgr('erpQuoteSnippetsSave', [{ snippets: [{ title: ' Warranty ', text: '1 year' }, { id: 's2', title: 'Delivery', text: '3 days' }] }]);
check('snippets saved', r.ok && r.result.length === 2 && r.result[0].title === 'Warranty' && r.result[0].id && r.result[1].id === 's2', r);

// ---- saved items import ----
r = await shareholder('erpQuoteItemsImport', [{ items: [
  { key: 'h2d', name: 'Bambu Lab H2D Combo', description: 'Printer', kind: 'Product', unit: 'unit', historicalRate: 380000, sku: '' },
  { name: 'Design work', kind: 'Service', unit: 'hour', historicalRate: '1500', requiresReview: false },
  { name: '' }] }]);
check('import: 2 added', r.ok && r.result.added === 2 && r.result.updated === 0, r);
r = await shareholder('erpQuoteItemsImport', [{ items: [{ name: 'design WORK ', historicalRate: 2000, kind: 'Service' }] }]);
check('import: same name updates', r.ok && r.result.added === 0 && r.result.updated === 1, r);
r = await sales('erpQuoteBoot', []);
const items = r.result.savedItems;
check('boot: saved items in order, review flag, rate', items.length === 2 && items[0].key === 'h2d' && items[0].historicalRate === 380000 &&
  items[0].review === true && items[1].name === 'design WORK' && items[1].historicalRate === 2000 && items[1].review === true && items[1].unit === 'unit', items);
check('boot: snippets/profile/settings come back', r.result.snippets.length === 2 && r.result.profile.name === 'Costareen Ltd' && r.result.settings.prefix === 'CZ', r.result);

// ---- save a quotation ----
const today = b0.today;
const base = () => ({ id: 'q-1', number: '', kind: 'Mixed', title: 'Printer offer', customer: 'Karim', contact: '', email: '', phone: '',
  address: '', date: '2026-10-02', validUntil: '2026-10-12', currency: 'BDT', items: [
    { id: 'a', name: 'Printer', kind: 'Product', qty: 2, unit: 'unit', rate: 1000.555 },
    { id: 'b', name: 'Setup', kind: 'Service', qty: 1, unit: 'job', rate: 500 }],
  discountType: 'Percent', discount: 10, vat: 5, shipping: 100, advance: 50, terms: 'T', notes: '', showBank: true,
  showSignature: true, useSignature: false, bankIds: [bank2], theme: 'Signature', accent: '#123456', dark: '#000000',
  font: 'Georgia', fontSize: 'Compact', autoNumber: true, status: 'Draft', company: null });

r = await sales('erpQuoteSave', [{ quote: { ...base(), date: '2026-02-30' }, expectedVersion: 0, saveKey: 'k0' }]);
check('bad date', err(r) === 'Issue date is not a real calendar date.', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), validUntil: '2026-10-01' }, expectedVersion: 0, saveKey: 'k0' }]);
check('validUntil before date', err(r) === 'Validity date must be on or after the issue date.', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), discount: 150 }, expectedVersion: 0, saveKey: 'k0' }]);
check('percent > 100', err(r) === 'Discount cannot exceed 100%.', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), vat: 101 }, expectedVersion: 0, saveKey: 'k0' }]);
check('VAT range', err(r) === 'VAT must be between 0 and 100.', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), items: Array.from({ length: 151 }, () => ({ name: 'x', qty: 1, rate: 1 })) }, expectedVersion: 0, saveKey: 'k0' }]);
check('151 items', err(r) === 'A quotation can hold at most 150 items.', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), title: 'x'.repeat(301) }, expectedVersion: 0, saveKey: 'k0' }]);
check('title too long', err(r) === 'Title is too long (at most 300 characters).', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), status: 'Ready', title: '', items: [] }, expectedVersion: 0, saveKey: 'k0' }]);
check('Ready needs readiness', err(r) === 'Project title is required. Add at least one item.', r);
r = await sales('erpQuoteSave', [{ quote: null }]);
check('nothing to save', err(r) === 'Nothing to save.', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), items: Array.from({ length: 150 }, () => ({ name: 'x', qty: 1, rate: 1, description: 'd'.repeat(1200) })), terms: 't'.repeat(12000) }, expectedVersion: 0, saveKey: 'big' }]);
check('150 items x 1200 chars is not "too large" (180k < 360k)', r.ok, err(r));
r = await sales('erpQuoteSave', [{ quote: { ...base(), id: 'q-big', items: Array.from({ length: 150 }, () => ({ name: 'x', qty: 1, rate: 1, description: '\u0001'.repeat(1200) })) }, expectedVersion: 0, saveKey: 'big2' }]);
check('over 8 x 45000 chars of JSON -> too large', err(r) === 'This quotation is too large to save.', r);
await sql`delete from quotations where business_id = ${FIX.B}`;
await sql`delete from quote_settings where business_id = ${FIX.B} and key like 'seq:%'`;

r = await sales('erpQuoteSave', [{ quote: base(), expectedVersion: 0, saveKey: 'k1' }]);
check('saved: version 1, auto number CZ-2026-00001', r.ok && r.result.quote.version === 1 && r.result.quote.number === 'CZ-2026-00001', r);
const t = r.ok && r.result.quote.totals;
// lines: R(2*1000.555)=2001.11, 500 -> 2501.11; disc 250.11; tax R(2251*0.05)=112.55; total 2251+112.55+100=2463.55; adv 1231.78; bal 1231.77
check('totals worked out on the server', t && t.subtotal === 2501.11 && t.discount === 250.11 && t.tax === 112.55 &&
  t.total === 2463.55 && t.advance === 1231.78 && t.balance === 1231.77, t);
const q1 = r.result.quote;
check('company snapshot: chosen bank only, takenAt', q1.company && q1.company.name === 'Costareen Ltd' && q1.company.banks.length === 1 &&
  q1.company.banks[0].id === bank2 && q1.company.takenAt, q1.company);
check('item amount + createdAt', q1.items[0].amount === 2001.11 && q1.createdAt && q1.createdAt === q1.updatedAt, q1);
let row = (await sql`select * from quotations where business_id = ${FIX.B} and id = 'q-1'`)[0];
check('row columns', row && row.reference === 'CZ-2026-00001' && row.version === 1 && row.total === 2463.55 && row.status === 'Draft' &&
  row.created_by === 'Rina' && row.save_key === 'k1' && row.doc.number === 'CZ-2026-00001' && !('version' in row.doc), row);

r = await sales('erpQuoteSave', [{ quote: { ...base(), title: 'changed' }, expectedVersion: 0, saveKey: 'k1' }]);
check('same saveKey -> repeated, nothing saved twice', r.ok && r.result.repeated === true && r.result.quote.version === 1 && r.result.quote.title === 'Printer offer', r);
r = await mgr('erpQuoteSave', [{ quote: { ...base(), title: 'changed' }, expectedVersion: 0, saveKey: 'k2' }]);
check('stale version -> CONFLICT naming the last saver', err(r) === 'CONFLICT: this quotation was changed by someone else (Rina) after you opened it. Your copy is kept here - reopen it to see theirs.', r);
await shareholder('erpQuoteProfileSave', [{ profile: { name: 'Renamed Co' } }]);
r = await mgr('erpQuoteSave', [{ quote: { ...base(), number: 'HAND-1', autoNumber: false, title: 'changed', status: 'Ready', createdAt: 'x' }, expectedVersion: 1, saveKey: 'k3' }]);
check('second save: number kept, company kept, createdAt kept, version 2', r.ok && r.result.quote.version === 2 && r.result.quote.number === 'CZ-2026-00001' &&
  r.result.quote.company.name === 'Costareen Ltd' && r.result.quote.createdAt === q1.createdAt && r.result.quote.status === 'Ready', r);
r = await mgr('erpQuoteSave', [{ quote: { ...base(), title: 'again' }, expectedVersion: 2, saveKey: 'k4', refreshIdentity: true }]);
check('refreshIdentity takes today\'s profile (all banks: none now)', r.ok && r.result.quote.company.name === 'Renamed Co' && r.result.quote.company.banks.length === 0, r);
row = (await sql`select * from quotations where business_id = ${FIX.B} and id = 'q-1'`)[0];
check('updated_by changes, created_by kept', row.created_by === 'Rina' && row.updated_by === 'Mehedi' && row.version === 3, row);

// hand-typed references
r = await sales('erpQuoteSave', [{ quote: { ...base(), id: 'q-2', number: 'cz-2026-00001', autoNumber: false }, expectedVersion: 0, saveKey: 'h1' }]);
check('hand-typed duplicate refused (case-insensitive)', err(r) === 'The reference cz-2026-00001 is already used by another quotation.', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), id: 'q-2', number: 'CZ-2026-00002', autoNumber: false, date: '2025-05-01', validUntil: '2025-05-05' }, expectedVersion: 0, saveKey: 'h2' }]);
check('hand-typed unique accepted', r.ok && r.result.quote.number === 'CZ-2026-00002', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), id: 'q-3', date: '2026-11-05', validUntil: '2026-11-05' }, expectedVersion: 0, saveKey: 'a3' }]);
check('auto number skips a hand-typed one (CZ-2026-00002 taken)', r.ok && r.result.quote.number === 'CZ-2026-00003', r);
r = await sales('erpQuoteSave', [{ quote: { ...base(), id: 'q-4', date: '2027-01-05', validUntil: '2027-01-05' }, expectedVersion: 0, saveKey: 'a4' }]);
check('year = issue year; counter per prefix, not per year', r.ok && r.result.quote.number === 'CZ-2027-00004', r);
const seq = (await sql`select value from quote_settings where business_id = ${FIX.B} and key = 'seq:CZ'`)[0];
check('counter stored under seq:CZ', seq && seq.value === 4, seq);

// ---- list / get / duplicate ----
r = await sales('erpQuoteList', [{ search: '', status: 'All', offset: 0 }]);
check('list: counts and newest change first', r.ok && r.result.counts.total === 4 && r.result.counts.draft === 4 && r.result.counts.ready === 0 &&
  r.result.rows[0].id === 'q-4' && r.result.matched === 4 && r.result.offset === 0, r.result);
const lr = r.result.rows.find((x) => x.id === 'q-1');
check('list row shape', lr && lr.reference === 'CZ-2026-00001' && lr.version === 3 && lr.total === 2463.55 && lr.issueDate === '2026-10-02' &&
  /^\d{4}-\d{2}-\d{2}T/.test(lr.createdAt) && lr.createdBy === 'Rina' && lr.currency === 'BDT' && lr.kind === 'Mixed', lr);
r = await sales('erpQuoteList', [{ search: '00002', status: 'All' }]);
check('list search by reference', r.result.rows.length === 1 && r.result.rows[0].id === 'q-2' && r.result.matched === 1, r.result);
r = await sales('erpQuoteList', [{ status: 'Ready' }]);
check('list status filter', r.result.rows.length === 0 && r.result.counts.total === 4, r.result);

r = await sales('erpQuoteGet', [{ id: 'q-1' }]);
check('get: doc with row version', r.ok && r.result.version === 3 && r.result.title === 'again' && r.result.totals.total === 2463.55, r);
r = await sales('erpQuoteGet', [{ id: 'nope' }]);
check('get: unknown', err(r) === 'No such quotation.', r);
r = await sales('erpQuoteDuplicate', [{ id: 'q-1' }]);
check('duplicate: fresh copy', r.ok && r.result.id !== 'q-1' && r.result.number === '' && r.result.version === 0 && r.result.status === 'Draft' &&
  r.result.company === null && !('totals' in r.result) && r.result.date === today && r.result.autoNumber === true &&
  r.result.validUntil === new Date(Date.parse(today + 'T12:00:00Z') + 10 * 864e5).toISOString().slice(0, 10) && r.result.items.length === 2, r);

// another business sees none of it
const other = await sql`select count(*)::int as n from quotations where business_id = ${FIX.B2}`;
check('nothing written to another business', other[0].n === 0);

// ---- images ----
const png = Buffer.from('fake-png-bytes').toString('base64');
r = await mgr('erpQuoteAssetUpload', [{ kind: 'logo', mime: 'image/png', data: png }]);
check('manager refused upload', err(r) === 'Your account does not have access to that.', r);
r = await shareholder('erpQuoteAssetUpload', [{ kind: 'logo', mime: 'image/gif', data: png }]);
check('mime refused', err(r) === 'Use a PNG, JPEG or WebP image.', r);
r = await shareholder('erpQuoteAssetUpload', [{ kind: 'logo', mime: 'image/png', data: Buffer.alloc(1024 * 1024 + 1).toString('base64') }]);
check('over 1 MB refused', err(r) === 'The image is over 1 MB. Use a smaller one.', r);
r = await shareholder('erpQuoteAssetUpload', [{ kind: 'logo', mime: 'image/png', data: png }]);
check('logo uploaded to assets/logo_<ms>.png', r.ok && /^assets\/logo_\d+\.png$/.test(r.result.id) && r.result.profile.logoId === r.result.id &&
  r.result.profile.logoTrimId === '' && files.list().includes(FIX.B + '/' + r.result.id), r);
const logoId = r.result.id;
r = await owner('erpQuoteAssetUpload', [{ kind: 'logoTrim', mime: 'image/png', data: png }]);
check('trimmed logo recorded', r.ok && r.result.profile.logoTrimId === r.result.id && r.result.profile.logoId === logoId, r);
r = await owner('erpQuoteAssetUpload', [{ kind: 'qr', mime: 'image/jpeg', data: png }]);
check('qr as .jpg', r.ok && /^assets\/qr_\d+\.jpg$/.test(r.result.id) && r.result.profile.qrId === r.result.id, r);
const qrId = r.result.id;
const known = (await sql`select value from quote_settings where business_id = ${FIX.B} and key = 'assets'`)[0].value;
check('allow-list holds the three ids', known.length === 3 && known[0] === logoId, known);

r = await sales('erpQuoteAsset', [{ id: logoId }]);
check('asset as data URL', r.ok && r.result.data === 'data:image/png;base64,' + png, r);
r = await sales('erpQuoteAsset', [{ id: qrId }]);
check('jpeg asset mime', r.ok && r.result.data.startsWith('data:image/jpeg;base64,'), r);
r = await sales('erpQuoteAsset', [{ id: 'assets/someone-else.png' }]);
check('unknown asset refused', err(r) === 'That image does not belong to this business.', r);
r = await sales('erpQuoteAsset', [{}]);
check('no id -> empty', r.ok && r.result.data === '', r);

r = await sales('erpBrandLogo', [{ have: '' }]);
check('brand logo: data + trim', r.ok && r.result.id === logoId && r.result.data === 'data:image/png;base64,' + png && r.result.trim === true, r);
r = await sales('erpBrandLogo', [{ have: logoId }]);
check('brand logo: browser has it -> data null', r.ok && r.result.id === logoId && r.result.data === null && r.result.trim === true, r);

// shared exports for the invoice PDF
{
  const ctxOf = async () => {
    // a minimal ctx over the privileged connection, enough for the exports
    return { tx: sql, sql, biz: FIX.B, s: { role: 'owner', businessName: 'Costareen' }, memo: {}, now: new Date(),
             deps: { storage: { read: async (b, f, n) => (files.get(`${b}/${f}/${n}`) || {}).bytes || null } } };
  };
  const c = await ctxOf();
  const prof = await Q.quoteProfile(c);
  const look = await Q.quoteLook(c);
  check('quoteProfile export', prof.name === 'Renamed Co' && prof.logoId === logoId && prof.qrId === qrId && Array.isArray(prof.banks), prof);
  check('quoteLook export', look.accent === '#dda51c' && look.dark === '#303030' && look.currency === 'BDT' && look.prefix === 'CZ', look);
  check('assetDataUrl: own image / foreign id', (await Q.assetDataUrl(c, logoId)).startsWith('data:image/png') && (await Q.assetDataUrl(c, 'assets/x.png')) === '');
}

r = await mgr('erpBrandLogoClear', []);
check('manager refused logo clear', err(r) === 'Your account does not have access to that.', r);
r = await shareholder('erpBrandLogoClear', []);
check('logo cleared', r.ok && r.result.ok === true && r.result.profile.logoId === '' && r.result.profile.logoTrimId === '' && r.result.profile.qrId === qrId, r);
r = await sales('erpBrandLogo', [{ have: logoId }]);
check('no logo -> empty', r.ok && r.result.id === '' && r.result.data === '', r);

// profile save keeps uploaded images unless cleared
r = await shareholder('erpQuoteProfileSave', [{ profile: { name: 'Renamed Co', clearQr: true } }]);
check('profile: clearQr', r.ok && r.result.qrId === '' && r.result.logoId === '', r);

await done();
