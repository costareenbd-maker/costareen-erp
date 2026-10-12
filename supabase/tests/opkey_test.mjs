// A save sent twice (the page gave up waiting, the person pressed Save again) is saved once.
import { owner, sql, FIX, check, done } from './harness.mjs';
const PLA = 'FIL-SUN-PLA-BLA-001';
const count = async () => (await sql`select count(*)::int n from invoices where business_id = ${FIX.B}`)[0].n;
const stock = async () => (await sql`select coalesce(ps.stock,0)::float s from products p left join product_stock ps on ps.product_id = p.id where p.business_id = ${FIX.B} and p.sku = ${PLA}`)[0].s;
const sale = (key) => owner('erpCreateInvoice', [{ customer: { name: 'Twice Buyer', phone: '01799200001' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash', opKey: key }]);

const n0 = await count(), s0 = await stock();
let a = await sale('key-aaaaaaaa-1');
let b = await sale('key-aaaaaaaa-1');
check('the same key twice: one invoice', a.ok && b.ok && (await count()) === n0 + 1, [a.ok, b.ok, await count(), n0]);
check('...the second answer is the first one again', b.result.invoiceNo === a.result.invoiceNo && b.replayed === true, b);
check('...and stock went down once', (await stock()) === s0 - 1, [await stock(), s0]);
let c = await sale('key-bbbbbbbb-2');
check('a new key: a new invoice', c.ok && c.result.invoiceNo !== a.result.invoiceNo && (await count()) === n0 + 2, c);
let d = await owner('erpCreateInvoice', [{ customer: { name: 'No Key', phone: '01799200002' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash' }]);
check('no key at all: saved as always', d.ok && (await count()) === n0 + 3, d);
let e = await owner('erpCreateInvoice', [{ customer: { name: 'Bad', phone: '01799200003' }, items: [{ sku: 'NOPE', qty: 1 }], payMode: 'full', opKey: 'key-cccccccc-3' }]);
let f = await owner('erpCreateInvoice', [{ customer: { name: 'Bad', phone: '01799200003' }, items: [{ sku: PLA, qty: 1 }], payMode: 'full', paymentMethod: 'Cash', opKey: 'key-cccccccc-3' }]);
check('a failed save does not use up its key', !e.ok && f.ok, [e.error, f.ok]);
await done();
