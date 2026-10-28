// scan-all-1 + colour-guard-1 (owner 28 Oct 2026): one scan of the supplier's invoice fills every step of Receive -
// supplier (put to the name already in Suppliers), reference, date, money, where from, how it travels, weight, shipping -
// and the lines; and four blue shades that read almost alike: only the exact colour is taken by itself, every other
// wording is a choice with all the shades laid out.
import { sql, FIX, mgr, check, done, deps, web } from './harness.mjs';

const B = FIX.B;
await sql`insert into suppliers (business_id, name, currency, country) values (${B}, 'Shenzhen Sunlu Technology Co., Ltd', 'RMB', 'China')`.catch(() => {});
await sql`insert into products (business_id, sku, name, category, brand, type, color, cost_price, sell_price, status) values
  (${B}, 'BL-BLUE', 'Sunlu PETG Blue', 'Filaments', 'Sunlu', 'PETG', 'Blue', 900, 1500, 'Active'),
  (${B}, 'BL-NAVY', 'Sunlu PETG Navy Blue', 'Filaments', 'Sunlu', 'PETG', 'Navy Blue', 900, 1500, 'Active'),
  (${B}, 'BL-LIGHT', 'Sunlu PETG Light Blue', 'Filaments', 'Sunlu', 'PETG', 'Light Blue', 900, 1500, 'Active'),
  (${B}, 'BL-ICE', 'Sunlu PETG Ice Blue', 'Filaments', 'Sunlu', 'PETG', 'Ice Blue', 900, 1500, 'Active')`;

const JPG = 'data:image/jpeg;base64,' + Buffer.from('fake-jpeg-bytes').toString('base64');
deps.geminiKey = 'test-key';
let asked = '';
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  asked = JSON.parse(opts.body).contents[0].parts[0].text;
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify({
    header: { supplier: 'SHENZHEN SUNLU TECHNOLOGY CO., LTD.', reference: 'SL-PI-20261020', ref_label: 'PI No.', date: '2026-10-20', currency: 'USD',
              goods_total: 1240.5, origin_country: 'China', transport: 'sea', weight_kg: 312, shipping_cost: 0, shipping_currency: '' },
    lines: [
      { code: '', name: 'PETG Navy Blue 1.75mm 1kg', qty: 40, price: 4.1, currency: 'USD' },
      { code: '', name: 'PETG Sky Blue 1.75mm 1kg', qty: 20, price: 4.1, currency: 'USD' },
      { code: '', name: 'PETG Blue 1.75mm 1kg', qty: 30, price: 4.1, currency: 'USD' },
    ] }) }] } }] } };
});
let r = await mgr('erpReceiveRead', [{ image: JPG, hint: '', fileName: 'invoice.jpg' }]);
const D = r.ok ? r.result.doc : {};
check('the AI is asked for the header and the lines in one read', /"header"/.test(asked) && /goods_total/.test(asked) && /never guess/.test(asked), asked.slice(0, 120));
check('the supplier is put to the name already in Suppliers', r.ok && D.supplier === 'Shenzhen Sunlu Technology Co., Ltd' && D.supplierKnown === true && r.result.supplier === D.supplier, D);
check('reference, its label and the date come from the invoice', D.reference === 'SL-PI-20261020' && D.refLabel === 'PI No.' && D.date === '2026-10-20', D);
check('money: USD, goods total 1240.5', D.currency === 'USD' && D.docTotal === 1240.5, D);
check('where from and how: China, imported, by sea, 312 kg', D.origin === 'China' && D.imported === true && D.transport === 'sea' && D.weightKg === 312, D);
check('nothing invented: no shipping cost printed -> 0', D.shippingCost === 0 && D.ai === true, D);
const L = r.ok ? r.result.lines : [];
const line = (t) => L.find((l) => l.text.includes(t)) || {};
check('Navy Blue: the exact colour -> taken by itself', line('Navy').sku === 'BL-NAVY' && line('Navy').confidence >= 0.9, line('Navy'));
check('plain Blue: the exact colour -> taken by itself', line('PETG Blue').sku === 'BL-BLUE' && line('PETG Blue').confidence >= 0.9, line('PETG Blue'));
const sky = line('Sky');
check('Sky Blue: no such shade -> never taken by itself (below 0.9 or no match)', !sky.sku || sky.confidence < 0.9, sky);
check('...and every blue of that brand and type is laid out to choose from', ['BL-BLUE', 'BL-NAVY', 'BL-LIGHT', 'BL-ICE'].every((s) => (sky.candidates || []).some((c) => c.sku === s)), sky.candidates);

// an old-style answer (a bare list) still works; the header falls back to what the device read
web.on(/generativelanguage\.googleapis\.com/, () => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify([{ code: '', name: 'PETG Ice Blue', qty: 5, price: 0, currency: '' }]) }] } }] } }));
r = await mgr('erpReceiveRead', [{ image: JPG, hint: 'Invoice No. INV-7781\nDate: 21.10.2026\nPETG Ice Blue 5', fileName: 'x.jpg' }]);
check('a bare list from the AI: lines read, the header from the device’s text', r.ok && r.result.lines[0].sku === 'BL-ICE' && r.result.doc.reference === 'INV-7781' && r.result.doc.ai === false, r.ok ? r.result.doc : r);

// a file (no AI) gets the supplier put to the known name too
r = await mgr('erpReceiveMatch', [{ rows: [['Seller: Shenzhen Sunlu Technology Co., Ltd.'], ['Invoice No. SL-77'], ['Product', 'Colour', 'Qty'], ['Sunlu PETG', 'Light Blue', 12]], kind: 'grid', reader: 'file', fileName: 'pl.xlsx' }]);
check('a file: the supplier is put to the known name', r.ok && r.result.doc.supplier === 'Shenzhen Sunlu Technology Co., Ltd' && r.result.doc.supplierKnown, r.ok ? r.result.doc : r);
// a heading with the currency in it ("Unit Price USD") is the price column, and gives the currency
r = await mgr('erpReceiveMatch', [{ rows: [['Product', 'Colour', 'Qty', 'Unit Price USD'], ['Sunlu PETG', 'Navy Blue', 10, 7.5]], kind: 'grid', reader: 'file', fileName: 'p.csv' }]);
check('"Unit Price USD": price 7.5, currency USD', r.ok && r.result.lines[0].price === 7.5 && r.result.lines[0].currency === 'USD', r.ok ? r.result.lines[0] : r);
deps.geminiKey = '';
done();
