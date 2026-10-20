// smart-read-1 (owner 21 Oct 2026, a scanned Polymaker sales contract): what OCR gives - table rows with PCS / USD / NA,
// broken numbers ("30. 000", "1. 75mm", "1, 00kg"), crumbs of other cells ("dee", "y", "ad"), and the document's other text:
// three addresses, the order date, the total, bank details. Only the product lines may come out, with clean names and
// colours; the supplier code is kept on a new product so the next file matches it directly.
import { sql, FIX, mgr, check, done } from './harness.mjs';

const ocr = [
  'polymaker JF Polymers(Suzhou)Co.,Ltd.', 'Sales Contract',
  'Customer: Invoicing Address: Shipping Address:', 'Costareen Costareen Costareen',
  'House 1, Road 2, Block C, Mirpur 10, House 1, Road 2, Block C, Mirpur House 1, Road 2, Block C, Mirpur',
  'Dhaka 1216, Bangladesh 2, Dhaka 1216, Bangladesh 2, Dhaka 1216, Bangladesh', 'Mirpur Mirpur Mirpur', 'Dhaka Dhaka Dhaka', '1216 1216 1216',
  'ORDER# 2000012345', 'Order Date : 07.05.2026',
  'NO. SKU Product Name Quantity Unit Unit Price Currency Amount Customer PO',
  '10 CA19029 Panchroma™ PLA 350.000 PCS 4.20 USD 1,470.00 NA', 'Black/1.75mm/1.00kg',
  '20 CA19030 Panchroma™ PLA 500.000 PCS 4.20 USD 2,100.00 NA', 'White/1.75mm/1.00kg',
  '90 CA19037 Panchroma™ PLA Steel 10.000 PCS 4.20 USD 42.00 NA', 'Grey/1.75mm/1.00kg',
  '200 CA04069 Panchroma™ PLA Matte Cotton 30. 000 PCS 4.20 USD dee y 126.00 NA', 'White/1. 75mm/1, 00kg y ad',
  '210 CA04070 Panchroma™ PLA Matte Fossil 10.000 PCS 4.20 USD 42.00 fF', 'ely Grey/1.75mm/1.00kg',
  '250 PC1002031 Panchroma™ PLA Matte Muted 20.000 PCS 4.20 USD 84.00 NA', 'Terracotta/1.75mm/1.00kg',
  '360 CA03039 Panchroma™ PLA Silk 10.000 PCS 5.35 USD 53.50 NA', 'Gold/1.75mm/1.00kg',
  '420 CA04086 Panchroma™ PLA Gradient 10.000 PCS 5.73 USD 57.30 NA', 'Matte Pastel', 'Rainbow/1.75mm/1.00kg',
  'Total 1,560.000 6,552.00 $',
  'Remark', 'Shipping House 1, Road 2, Block C, Mirpur 10, Dhaka 1216, Bangladesh Mirpur Dhaka Bangladesh', 'Address', 'Incoterm FCA',
  'Payment 100% Pre-Payment', 'Bank Intermediary Bank: Citibank N.A. New York, NY', 'Informat SWIFT BIC: CITIUS33', 'ion Account with Bank: China Construction Bank,Suzhou Branch',
  'SWIFT BIC: PCBCCNBJJSS', 'Beneficiary Account No.: 32214010200220109606', 'Address: No.7-1 Xinggang East Road, Bixi Street,Changshu City, Suzhou Province', 'Tel: 0512-52096516',
  'Buyer Costareen Seller JF Polymers(Suzhou)Co.,Ltd.', 'Phone 0512-52096516',
];
let r = await mgr('erpReceiveMatch', [{ rows: ocr, kind: 'text', reader: 'ocr', supplier: 'JF Polymers', fileName: 'Updated SC_261020_001649.pdf' }]);
const L = r.ok ? r.result.lines : [];
check('only the 8 product lines come out - no address, date, total or bank line', r.ok && L.length === 8 && L.every((l) => /^(CA|PC)\d/.test(l.code)), r.ok ? L.map((l) => [l.code, l.qty, l.text]) : r);
check('the lines keep the order of the document (no shuffling)', L.map((l) => l.code).join(',') === 'CA19029,CA19030,CA19037,CA04069,CA04070,PC1002031,CA03039,CA04086' && L.every((l, i) => l.pos === i + 1), L.map((l) => [l.pos, l.code]));
const by = (c) => L.find((l) => l.code === c) || {};
check('quantities right, including OCR\'s "30. 000"', by('CA19029').qty === 350 && by('CA19030').qty === 500 && by('CA04069').qty === 30 && by('PC1002031').qty === 20, L.map((l) => [l.code, l.qty]));
check('prices in USD', by('CA19029').price === 4.20 && by('CA03039').price === 5.35 && by('CA19029').currency === 'USD', [by('CA19029'), by('CA03039')]);
const names = L.map((l) => l.newProduct && l.newProduct.product_name);
check('clean names: no USD, PCS, NA, mm, kg or OCR crumbs', names.every((n) => n && !/\b(usd|pcs|na|mm|kg|dee|ad|ely|ff)\b/i.test(n) && !/\d/.test(n)), names);
check('smart-read-4: named as the file names them - "Panchroma PLA Black", "Panchroma PLA Matte Cotton White" (brand Polymaker)', by('CA19029').newProduct.product_name === 'Panchroma PLA Black' && by('CA19029').newProduct.brand === 'Polymaker' &&
  by('CA04069').newProduct.product_name === 'Panchroma PLA Matte Cotton White', [by('CA19029').newProduct, by('CA04069').newProduct]);
check('colours are colours: "Steel Grey", "Fossil Grey", "Muted Terracotta", "Gold", a wrapped "Pastel Rainbow"', by('CA19037').newProduct.color === 'Steel Grey' &&
  by('CA04070').newProduct.color === 'Fossil Grey' && /Terracotta/.test(by('PC1002031').newProduct.color) && by('CA03039').newProduct.color === 'Gold' && /Rainbow/.test(by('CA04086').newProduct.color),
  L.map((l) => [l.code, l.newProduct.color]));
check('the type is read (PLA, PLA Matte, PLA Silk) and the supplier code kept for the new product', by('CA04069').newProduct.type === 'PLA Matte' && by('CA03039').newProduct.type === 'PLA Silk' &&
  by('CA19029').newProduct.supplier_sku === 'CA19029', [by('CA04069').newProduct, by('CA03039').newProduct]);
check('the line from the file is shown cleaned, the raw one kept', /Black/.test(by('CA19029').text) && !/USD/.test(by('CA19029').text) && /USD/.test(by('CA19029').raw), by('CA19029'));

// the suggestion form for a new product: the file's brand, type and code - not the shop's most common brand
await mgr('erpSaveProduct', [{ isNew: true, sku: 'bpbb001', product_name: 'Bambulab Pla Basic Black', brand: 'Bambulab', type: 'PLA Basic', color: 'Black', category: 'Filaments', unit: 'Roll', sell_price: 1700, supplier: 'Bambulab Official' }]);
await mgr('erpSaveProduct', [{ isNew: true, sku: 'bpbw002', product_name: 'Bambulab Pla Basic White', brand: 'Bambulab', type: 'PLA Basic', color: 'White', category: 'Filaments', unit: 'Roll', sell_price: 1700, supplier: 'Bambulab Official' }]);
r = await mgr('erpProductSuggest', [{ name: by('CA04069').text, brand: 'Polymaker', colour: 'Cotton White', code: 'CA04069', supplier: 'JF Polymers' }]);
check('suggestion: Polymaker, PLA Matte, Cotton White, supplier JF Polymers, code CA04069 (no Polymaker product yet)', r.ok && r.result.product.brand === 'Polymaker' &&
  r.result.product.type === 'PLA Matte' && r.result.product.color === 'Cotton White' && r.result.product.supplier === 'JF Polymers' && r.result.product.supplier_sku === 'CA04069', r.result && r.result.product);
r = await mgr('erpSaveProduct', [{ isNew: true, sku: 'pmpmcw001', product_name: 'Polymaker PLA Matte Cotton White', brand: 'Polymaker', type: 'PLA Matte', color: 'Cotton White', category: 'Filaments', unit: 'Roll', supplier_sku: 'CA04069' }]);
check('the new product keeps the supplier code', r.ok && (await sql`select supplier_sku from products where business_id = ${FIX.B} and sku = 'pmpmcw001'`)[0].supplier_sku === 'CA04069', r);
r = await mgr('erpReceiveMatch', [{ rows: ocr, kind: 'text', reader: 'ocr', supplier: 'JF Polymers' }]);
const cw = r.ok && r.result.lines.find((l) => l.code === 'CA04069');
check('the next file: CA04069 matches it by the supplier code at once', cw && cw.sku === 'pmpmcw001' && cw.how === 'supplier code', cw);

// smart-read-2: what the page's OCR (mode 4) really gave for that contract - codes misread, the heading of every page
// between rows, "1.75mn", a rule glued to a word, an amount where the unit price was
const ocr2 = [
  'Co polymaker JF Polymers (Suzhou) Co. , Ltd. Su', '� Sales Contraci. �%', 'Order Date : 07. 05. 2026',
  '10 CA19029 Panchroma™ PLA 350. 000 PCS 4. 20] USD 1, 470. 00 NA', 'Black/1. 75mm/1. 00kg',
  '20 CA19030 Panchroma™ PLA 500. 000 PCS 4.20] USD 2, 100. 00 NA', 'White/1. 75mm/1, 00kg',
  '190 CA04060 Panchroma™ PLA Marble 10. 000 PCS 4. 96] USD 49. 60 NA', 'Limestone/1. 75mm/1. 00kg',
  'Co polymaker JF Polymers (Suzhou) Co. , Ltd. Ap', 'J Sales Contraci�, �4',
  '200] CA04069 JPanchroma� PLA Matte Cotton] 30.000 | Pcs 4.20] USD 172.fig4 (=', 'White/1, 75mm/1. 00kg yp! ak',
  '230 | ca04076 |Panchroma� PLA Matte Pastel] 20.000 | Pcs USD 84.00 NA', 'Peanut/1. 75nm/1. 00kg',
  '350 | CAQ4071 | Panchroma� PLA Matte Army | 10.000 | Pcs 4.20] USD 42. 00 NA', 'Dark Green/1. 75nm/1. 00kg',
  '420 | caoios6 | Panchroma� PLA Gradient | 10.000 | Pcs 5.73] USD 57. 30 NA', 'Matte Pastel', 'Rainbow/1. 75mn/1. 00kg',
  '540 | PC1002025 Panchroma� PLA Matte 10. 000 PCS 4. 20] USD 42. 00 NA', '[Raspberry Blue/1. 75mm/1. 00kg|',
  '1,560.00[ [TT 962.00 sf', 'Remark', 'Beneficiary Account No. : 00000000000000000000', 'Tel: 0512-00000000',
];
r = await mgr('erpReceiveMatch', [{ rows: ocr2, kind: 'text', reader: 'ocr', supplier: 'JF Polymers' }]);
const L2 = r.ok ? r.result.lines : [];
check('mode-4 OCR: every product, in order, codes put right (CAQ4071 -> CA04071, caoios6 -> CA04086 is out of reach but kept as a code)',
  r.ok && L2.map((l) => l.code).slice(0, 6).join(',') === 'CA19029,CA19030,CA04060,CA04069,CA04076,CA04071' && L2.length === 8, L2.map((l) => [l.pos, l.code, l.qty]));
check('the page heading is not glued to the product before it; no "1.75mn" or "jPanchroma" left in a name',
  L2.every((l) => !/polymers|contrac|ltd|1\.75|mn\b/i.test(l.text)) && L2.every((l) => !/jPanchroma/.test(l.text)), L2.map((l) => l.text));
check('an amount where the unit price was (84.00 for 20) is turned back into 4.20', (L2.find((l) => l.code === 'CA04076') || {}).price === 4.20, L2.find((l) => l.code === 'CA04076'));

// smart-read-3: the top of the document, read where it is clear
const head = ['Co polymaker JF Polymers (Suzhou) Co. , Ltd. Su', 'Customer: Invoicing Address: Shipping Address:', 'Costareen Costareen Costareen',
  'ORDER# 2000012345', 'Order Date : 07. 05. 2026', '10 CA19029 Panchroma™ PLA 350. 000 PCS 4. 20] USD 1, 470. 00 NA', 'Black/1. 75mm/1. 00kg',
  'Incoterm FCA', 'Address: No. 7-1 Xinggang East Road, Bixi Street, Changshu City, Suzhou Province', 'Seller JF Polymers (Suzhou) Co. , Ltd.'];
r = await mgr('erpReceiveMatch', [{ rows: head, kind: 'text', reader: 'ocr' }]);
const dc = r.ok ? r.result.doc : {};
check('the document\'s top: supplier, order number, date, imported (from Suzhou, FCA), currency', r.ok && /^JF Polymers \(Suzhou\) Co\., Ltd/.test(dc.supplier) &&
  dc.reference === '2000012345' && /order/i.test(dc.refLabel) && dc.date === '07.05.2026' && dc.imported === true && dc.origin === 'Suzhou' && dc.currency === 'USD', dc);
r = await mgr('erpReceiveMatch', [{ rows: [['Item', 'Qty', 'Price'], ['Sunlu PLA+ Black', 10, 1500]], kind: 'grid' }]);
check('nothing clear in the file: the boxes stay empty (no guess)', r.ok && r.result.doc.supplier === '' && r.result.doc.reference === '' && r.result.doc.date === '' && r.result.doc.imported === null, r.result && r.result.doc);
r = await mgr('erpProductSuggest', [{ name: 'Panchroma PLA Matte Wood Brown', brand: 'Polymaker', colour: 'Wood Brown', code: 'cao4077', price: 4.20, currency: 'USD', rate: 122 }]);
check('the supplier\'s code is the new SKU (OCR\'s "cao4077" put right), cost = 4.20 USD x 122', r.ok && r.result.product.sku === 'CA04077' && r.result.product.cost_price === 512, r.result && r.result.product);
r = await mgr('erpProductSuggest', [{ name: 'Panchroma PLA Matte Wood Brown', brand: 'Polymaker', colour: 'Wood Brown', code: 'CA04077', price: 4.20, currency: 'USD' }]);
check('no rate yet: the cost is left empty, not guessed', r.ok && r.result.product.cost_price === 0, r.result && r.result.product);

// joint-read-1: a sheet with Quantity AND Amount columns - the amount is money, not the count; the Currency column is read
r = await mgr('erpReceiveMatch', [{ rows: [['JF Polymers (Suzhou) Co. Ltd.'], ['NO', 'SKU', 'Product Name', 'Quantity', 'Unit', 'Unit Price', 'Currency', 'Amount'],
  [10, 'CA19029', 'Polymaker Panchroma PLA Black 1.75mm 1kg', 350, 'PCS', 4.20, 'USD', 1470], [20, 'CA19030', 'Polymaker Panchroma PLA White 1.75mm 1kg', 500, 'PCS', 4.20, 'USD', 2100]], kind: 'grid' }]);
const G = r.ok ? r.result.lines : [];
check('Quantity and Amount both in the sheet: 350 and 500 rolls (not 1,470 / 2,100), at 4.20 USD', r.ok && G.length === 2 && G[0].qty === 350 && G[1].qty === 500 &&
  G[0].price === 4.20 && G[0].currency === 'USD' && !/pcs|usd/i.test(G[0].text), G.map((l) => [l.code, l.qty, l.price, l.currency, l.text]));
r = await mgr('erpReceiveMatch', [{ rows: [['Item', 'Amount', 'Price'], ['Sunlu PLA+ Black', 12, 1500]], kind: 'grid' }]);
check('...a sheet whose only count column is "Amount" still reads it as the count', r.ok && r.result.lines[0].qty === 12, r.result && r.result.lines);

// smart-read-4 (owner 21 Oct 2026): the file's totals, a price worked out from the amount, the file's own product name,
// stamp crumbs and one-letter colour slips
const s4 = ['(% poly mo ker JF Polymers (Suzhou) Co. , Ltd. Uz', 'ORDER# 2000012345', 'Order Date : 07. 05. 2026',
  '10 CA19029 Panchroma™ PLA 350. 000 PCS 4. 20] USD 1, 470. 00 NA', 'Black/1. 75mm/1. 00kg',
  '40 CA19032 Panchroma™ PLA 20. 000 PCS 4. 20] USD 84. 00 NA', 'Ref/1. 75mm/1. 00kg',
  '210 CAO4070 Panchroma™ PLA Matte Fossil 10.000 PCS 4.20 USD 42.00 NA', 'Grey/1.75mm/1.00kg SEP',
  '470 PC1002001 Panchroma™ PLA Matte Sky 10.000 PCS USD 42.00 NA', 'Blue/1.75mm/1.00kg She',
  'Total] 390. 000 | 1, 638.00 $ |'];
r = await mgr('erpReceiveMatch', [{ rows: s4, kind: 'text', reader: 'ocr' }]);
const S4 = r.ok ? r.result.lines : [], D4 = r.ok ? r.result.doc : {};
check('smart-read-4: the file\'s own totals are read (390 pcs, 1,638.00)', r.ok && D4.docQty === 390 && D4.docTotal === 1638.00, D4);
check('...the lines add up to them', S4.length === 4 && S4.reduce((a, l) => a + l.qty, 0) === 390, S4.map((l) => [l.code, l.qty]));
check('a line whose unit price was lost gets amount / quantity (42.00 / 10 = 4.20), marked so', S4[3] && S4[3].price === 4.20 && S4[3].priceFrom === 'amount', S4[3]);
check('a new product is named as the file names it: "Panchroma PLA Black" (brand stays Polymaker)', S4[0] && S4[0].newProduct && S4[0].newProduct.product_name === 'Panchroma PLA Black' && S4[0].newProduct.brand === 'Polymaker', S4[0] && S4[0].newProduct);
check('"Ref" read for Red is put right; stamp crumbs (SEP, She) are dropped', S4[1] && S4[1].text === 'Panchroma PLA Red' && S4[2].text === 'Panchroma PLA Matte Fossil Grey' && S4[3].text === 'Panchroma PLA Matte Sky Blue', S4.map((l) => l.text));
r = await mgr('erpProductSuggest', [{ name: 'Panchroma PLA Matte Cotton White', brand: 'Polymaker', colour: 'Matte Cotton White', code: 'CA04069', price: 4.20, currency: 'USD', rate: 122 }]);
check('the suggestion keeps the file\'s name too, brand Polymaker, cost 4.20 x 122', r.ok && r.result.product.product_name === 'Panchroma PLA Matte Cotton White' && r.result.product.brand === 'Polymaker' && r.result.product.cost_price === 512, r.result && r.result.product);

// pf-plus-1: a new colour from the product form's "+" (no trip to Settings > Lists)
r = await mgr('erpListAddValue', [{ kind: 'colors', value: '  Cotton   White ' }]);
check('the "+" adds "Cotton White" to the colours and says what it added', r.ok && r.result.added === 'Cotton White' && r.result.colors.includes('Cotton White'), r.result && r.result.colors);
r = await mgr('erpListAddValue', [{ kind: 'colors', value: 'cotton white' }]);
check('...once only, whatever the case', r.ok && r.result.colors.filter((c) => c.toLowerCase() === 'cotton white').length === 1, r.result && r.result.colors);
r = await mgr('erpListAddValue', [{ kind: 'secrets', value: 'x' }]);
check('only the product lists', !r.ok && /Which list/.test(r.error), r);

await done();
