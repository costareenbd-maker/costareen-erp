// Stage N2: a buyer whose seller is outside the system registers the printer himself, sends the seller a confirm
// link, the seller answers through a Lite record; the owner can withdraw; the platform admin can moderate.
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import { sql, FIX, owner, mgr, sales, check, done, deps, fnDir, files } from './harness.mjs';
const { pubRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'passport.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
const R = { asBusiness, owners, tenantDeps: null };
let N = 0;
const get = async (q, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'GET', headers: { 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) } }), R)).body;
const post = async (q, body, ip) => (await pubRoute(deps, new Request('https://ctl.test/erp?' + q, { method: 'POST', headers: { 'content-type': 'application/json', 'x-forwarded-for': ip || ('198.51.100.' + (++N % 250)) }, body: JSON.stringify(body) }), R)).body;
const PNG = Buffer.concat([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'), Buffer.alloc(300)]).toString('base64');
const good = (o) => ({ serial: 'OUT-SIDE-0001', product: 'Creality Ender-3 V3 SE', brand: 'Creality', boughtMonth: '2026-08', warrantyMonths: 6, sellerName: 'Mirpur 3D Shop', sellerPhone: '01811111111', sellerCity: 'Dhaka',
  buyerName: 'Sumon', buyerPhone: '01712345678', consent: true, proofs: [{ kind: 'invoice', data: PNG }, { kind: 'sticker', data: 'data:image/png;base64,' + PNG }], ...(o || {}) });
const proofFiles = () => files.list().filter((k) => k.startsWith('public/passports/'));
const A1 = 'PRT-BAM-A1-001';

// 1. refusals
let r = await post('pub=register', good({ consent: false }));
check('no consent, no registration', !r.ok && /consent/i.test(r.error), r);
r = await post('pub=register', good({ proofs: [] }));
check('a photo is needed', !r.ok && /photo/i.test(r.error), r);
r = await post('pub=register', good({ proofs: [{ kind: 'invoice', data: Buffer.alloc(400).toString('base64') }] }));
check('a file that is not an image is refused', !r.ok && /not a JPEG/i.test(r.error), r);
r = await post('pub=register', good({ serial: 'AB' }));
check('a serial that is too short', !r.ok && /serial/i.test(r.error), r);
r = await post('pub=register', good({ buyerPhone: '12345' }));
check('the buyer needs a real mobile number', !r.ok && /mobile/i.test(r.error), r);
r = await post('pub=register', good({ boughtMonth: '2099-01' }));
check('a month in the future is refused', !r.ok && /future/i.test(r.error), r);
r = await post('pub=register', good({ sellerPhone: '' }));
check('the seller’s number may be left out (the link can still be copied)', r.ok && r.whatsapp === '' && /confirm\?t=/.test(r.confirmUrl), r);
await post('pub=owner', { t: r.ownerUrl.split('o=')[1], action: 'withdraw' });

// 2. the registration
r = await post('pub=register', good());
check('registered: declared, an owner link, a confirm link, a WhatsApp link to the seller', r.ok && r.level === 'declared' && /\/check\?o=[A-Za-z0-9_-]{16,}$/.test(r.ownerUrl) && /\/confirm\?t=[A-Za-z0-9_-]{16,}$/.test(r.confirmUrl) && /wa\.me\/8801811111111/.test(r.whatsapp) && /confirm%3Ft%3D/.test(r.whatsapp) && /check\?s=OUT-SIDE-0001$/.test(r.checkUrl), r);
const OWNER = r.ownerUrl.split('o=')[1], CONFIRM = r.confirmUrl.split('t=')[1], ID = r.id;
check('two proof photos on file', proofFiles().length === 2 && proofFiles().every((k) => k.startsWith('public/passports/' + ID + '/')), proofFiles());
r = await get('pub=check&s=out side 0001');
let c = r.records && r.records[0];
check('the public check: declared, grey, "Supplier · Dhaka", the month, the warranty, the proof count, not disputed', r.ok && r.found && r.records.length === 1 && c.level === 'declared' && c.seller === 'Supplier · Dhaka' && !c.named && c.soldMonth === 'Aug 2026' && c.warrantyUntil === '2027-02-01' && c.warrantyState === 'active' && c.proofs === 2 && c.answer === '' && !c.disputed && c.events.some((e) => e.kind === 'declared'), c);
check('...and nothing about the buyer or the declared seller’s name', !JSON.stringify(r).includes('Sumon') && !JSON.stringify(r).includes('01712345678') && !JSON.stringify(r).includes('Mirpur 3D Shop'), r);
r = await post('pub=register', good());
check('the same serial cannot be declared twice', !r.ok && /already registered by its owner/i.test(r.error), r);

// 3. a serial the seller’s ERP already wrote cannot be declared
await mgr('erpSerialSetup', [{ sku: A1, serialised: true, warrantyMonths: 12 }]);
await mgr('erpSerialsAdd', [{ sku: A1, serials: ['BL-A1-0009', 'OUT-SIDE-0003'] }]);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Karim', phone: '01700000000' }, items: [{ sku: A1, qty: 1, serials: ['BL-A1-0009'] }], payMode: 'full' }]);
check('a verified sale exists', r.ok, r);
r = await post('pub=register', good({ serial: 'BL-A1-0009' }));
check('a verified serial: "already registered by its seller"', !r.ok && /already registered by its seller/i.test(r.error), r);

// 4. the owner’s view
r = await get('pub=owner&t=' + OWNER);
check('the owner sees his registration, the seller he named, his photos, the links to send again', r.ok && r.serial === 'OUT-SIDE-0001' && r.level === 'declared' && r.seller.name === 'Mirpur 3D Shop' && r.proofs.length === 2 && r.proofs.every((p) => /^https:\/\/files\.test\//.test(p.url)) && r.confirmUrl.endsWith(CONFIRM) && /wa\.me/.test(r.whatsapp) && !r.confirmedBy, r);
r = await get('pub=owner&t=' + OWNER.slice(0, 8) + 'XXXXXXXXXXXXXXXXXXXXXXXX');
check('a wrong owner link is refused', !r.ok, r);

// 5. the seller’s view
r = await get('pub=confirm&t=' + CONFIRM);
check('the seller sees the claim: product, serial, month, warranty, the buyer’s name and the end of his number, the photos', r.ok && r.product === 'Creality Ender-3 V3 SE' && r.serial === 'OUT-SIDE-0001' && r.boughtMonth === '2026-08' && r.warrantyMonths === 6 && r.buyer.name === 'Sumon' && r.buyer.phoneTail === '…5678' && r.proofs.length === 2 && r.answer === '' && !r.lite, r);
check('...not the buyer’s full number', !JSON.stringify(r).includes('01712345678'));
r = await get('pub=confirm&t=short');
check('a broken confirm link is refused', !r.ok, r);
r = await post('pub=confirm', { t: CONFIRM, answer: 'confirm', shop: { name: 'M', phone: '01811111111' } });
check('the shop needs a name', !r.ok && /name/i.test(r.error), r);
r = await post('pub=confirm', { t: CONFIRM, answer: 'confirm', shop: { name: 'Mirpur 3D Shop', phone: '0181' } });
check('...and a real mobile number', !r.ok && /mobile/i.test(r.error), r);

// 6. "Not ours"
r = await post('pub=confirm', { t: CONFIRM, answer: 'reject', shop: { name: 'Mirpur 3D Shop', phone: '01811111111', city: 'Dhaka' } });
check('rejected: recorded, the Lite record exists, the passport stays grey', r.ok && r.answer === 'rejected' && (await sql`select count(*)::int n from erp_lite_sellers`)[0].n === 1, r);
r = await get('pub=check&s=OUT-SIDE-0001');
check('the check says declared, answer rejected', r.records[0].level === 'declared' && r.records[0].answer === 'rejected' && r.records[0].events.some((e) => e.kind === 'rejected'), r.records[0]);

// 7. Confirm
r = await post('pub=confirm', { t: CONFIRM, answer: 'confirm', shop: { name: 'Mirpur 3D Shop', phone: '01811111111', city: 'Dhaka', email: 'shop@example.com', showName: true } });
check('confirmed: green, the seller gets his own page link', r.ok && r.answer === 'confirmed' && r.shop.name === 'Mirpur 3D Shop' && /\/lite\?t=[A-Za-z0-9_-]{16,}$/.test(r.liteUrl), r);
const LITE = r.liteUrl.split('t=')[1];
r = await get('pub=check&s=OUT-SIDE-0001');
c = r.records[0];
check('the check: confirmed by the seller, named, not disputed', c.level === 'confirmed' && c.seller === 'Mirpur 3D Shop' && c.named && c.answer === 'confirmed' && !c.disputed && c.events.some((e) => e.kind === 'confirmed'), c);
check('the seller’s count is 1', (await sql`select confirms from erp_lite_sellers where phone = '01811111111'`)[0].confirms === 1);
r = await get('pub=owner&t=' + OWNER);
check('the owner sees who confirmed', r.ok && r.level === 'confirmed' && r.confirmedBy && r.confirmedBy.name === 'Mirpur 3D Shop', r);

// 8. Correct
r = await post('pub=confirm', { t: CONFIRM, answer: 'correct', shop: { name: 'Mirpur 3D Shop', phone: '01811111111' }, boughtMonth: '2026-07', warrantyMonths: 12 });
check('corrected: the month and the warranty follow the seller', r.ok && r.answer === 'corrected' && r.warrantyUntil === '2027-07-01', r);
r = await get('pub=check&s=OUT-SIDE-0001');
check('the check shows the corrected sale', r.records[0].soldMonth === 'Jul 2026' && r.records[0].warrantyUntil === '2027-07-01' && r.records[0].answer === 'corrected', r.records[0]);
check('...the count stays 1', (await sql`select confirms from erp_lite_sellers where phone = '01811111111'`)[0].confirms === 1);

// 9. a second registration confirmed under the same number: the shop keeps its first name
r = await post('pub=register', good({ serial: 'OUT-SIDE-0002', buyerName: 'Rina', buyerPhone: '01799999999' }), '198.51.100.2');
const CONFIRM2 = r.confirmUrl.split('t=')[1], OWNER2 = r.ownerUrl.split('o=')[1];
r = await post('pub=confirm', { t: CONFIRM2, answer: 'confirm', shop: { name: 'Totally Other Name', phone: '01811111111', showName: false } });
check('a stranger cannot rename the shop; the name switch is theirs', r.ok && r.shop.name === 'Mirpur 3D Shop', r);
r = await get('pub=check&s=OUT-SIDE-0002');
check('name hidden: "Supplier · Dhaka" though confirmed', r.records[0].level === 'confirmed' && r.records[0].seller === 'Supplier · Dhaka' && !r.records[0].named, r.records[0]);
check('the count is 2', (await sql`select confirms from erp_lite_sellers where phone = '01811111111'`)[0].confirms === 2);

// 10. the Lite seller’s page
r = await get('pub=lite&t=' + LITE);
check('the seller’s page: the shop, both units with the buyer’s name, a check link and a QR each', r.ok && r.shop.name === 'Mirpur 3D Shop' && r.shop.phone === '01811111111' && r.shop.confirms === 2 && r.units.length === 2 && r.units.every((u) => u.checkUrl && u.qr && u.buyerName) && r.units.some((u) => u.buyerName === 'Rina'), r);
r = await post('pub=lite', { t: LITE, showName: true, city: 'Mirpur, Dhaka', email: '' });
check('the seller changes city and shows the name again', r.ok && r.saved, r);
r = await get('pub=check&s=OUT-SIDE-0002');
check('...the register follows', r.records[0].seller === 'Mirpur 3D Shop' && r.records[0].city === 'Mirpur, Dhaka', r.records[0]);
r = await get('pub=lite&t=' + LITE.slice(0, 8) + 'XXXXXXXXXXXXXXXXXXXXXXXX');
check('a wrong page link is refused', !r.ok, r);

// 11. the platform admin
r = await mgr('erpPlatformRegister', []);
check('a manager is not the platform admin', !r.ok, r);
r = await owner('erpPlatformRegister', []);
check('the admin sees the registrations with proof links and the Lite sellers', r.ok && r.result.registrations.length === 2 && r.result.sellers.length === 1 && r.result.counts.confirmed === 2 && r.result.registrations.every((x) => x.proofs.length === 2) && r.result.registrations.some((x) => x.buyer === 'Rina'), r.ok ? r.result.counts : r);
const LITE_ID = r.result.sellers[0].id;
r = await owner('erpPlatformLiteBlock', [{ id: LITE_ID, on: true }]);
r = await get('pub=lite&t=' + LITE);
check('a blocked seller’s page is closed', !r.ok, r);
r = await post('pub=register', good({ serial: 'OUT-SIDE-0004', buyerPhone: '01788888888' }), '198.51.100.3');
const CONFIRM4 = r.confirmUrl.split('t=')[1];
r = await post('pub=confirm', { t: CONFIRM4, answer: 'confirm', shop: { name: 'Mirpur 3D Shop', phone: '01811111111' } });
check('...and cannot confirm', !r.ok && /cannot confirm/i.test(r.error), r);
await owner('erpPlatformLiteBlock', [{ id: LITE_ID, on: false }]);
r = await owner('erpPlatformRegisterRemove', [{ id: (await sql`select id from erp_passports where serial_norm = 'OUTSIDE0002'`)[0].id }]);
check('the admin removes a registration: record and photos gone, the count falls', r.ok && (await get('pub=check&s=OUT-SIDE-0002')).found === false && !proofFiles().some((k) => k.includes('OUTSIDE0002')) && (await sql`select confirms from erp_lite_sellers where phone = '01811111111'`)[0].confirms === 1, r);
r = await get('pub=owner&t=' + OWNER2);
check('...its owner link is dead', !r.ok, r);

// 12. the owner withdraws (consent taken back)
const before = proofFiles().length;
r = await post('pub=owner', { t: OWNER, action: 'withdraw' });
check('withdrawn: the record and the photos are gone, the seller’s count falls', r.ok && r.removed && (await get('pub=check&s=OUT-SIDE-0001')).found === false && proofFiles().length === before - 2 && (await sql`select confirms from erp_lite_sellers where phone = '01811111111'`)[0].confirms === 0, r);
r = await get('pub=owner&t=' + OWNER);
check('...and the owner link is dead', !r.ok, r);

// 13. a declaration first, the seller’s ERP later: the verified record comes first and there is no dispute
r = await post('pub=register', good({ serial: 'OUT-SIDE-0003', buyerPhone: '01777777777' }), '198.51.100.4');
check('declared', r.ok, r);
r = await sales('erpCreateInvoice', [{ customer: { name: 'Sumon', phone: '01777777777' }, items: [{ sku: A1, qty: 1, serials: ['OUT-SIDE-0003'] }], payMode: 'full' }]);
check('the seller’s ERP sells the same serial', r.ok, r);
r = await get('pub=check&s=OUT-SIDE-0003');
check('two records: verified first, then declared; not disputed', r.records.length === 2 && r.records[0].level === 'verified' && r.records[1].level === 'declared' && r.records.every((x) => !x.disputed), r.records.map((x) => x.level));

// 14. a flood from one address is slowed down
let last = null;
for (let i = 0; i < 6; i++) last = await post('pub=register', good({ consent: false }), '203.0.113.9');
check('the sixth registration attempt from one address in an hour is refused', !last.ok && /Too many/.test(last.error), last);
await done();
