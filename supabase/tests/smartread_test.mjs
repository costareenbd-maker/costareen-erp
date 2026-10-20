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
check('the lines keep the document's order (no shuffling)', L.map((l) => l.code).join(',') === 'CA19029,CA19030,CA19037,CA04069,CA04070,PC1002031,CA03039,CA04086' && L.every((l, i) => l.pos === i + 1), L.map((l) => [l.pos, l.code]));
const by = (c) => L.find((l) => l.code === c) || {};
check('quantities right, including OCR\'s "30. 000"', by('CA19029').qty === 350 && by('CA19030').qty === 500 && by('CA04069').qty === 30 && by('PC1002031').qty === 20, L.map((l) => [l.code, l.qty]));
check('prices in USD', by('CA19029').price === 4.20 && by('CA03039').price === 5.35 && by('CA19029').currency === 'USD', [by('CA19029'), by('CA03039')]);
const names = L.map((l) => l.newProduct && l.newProduct.product_name);
check('clean names: no USD, PCS, NA, mm, kg or OCR crumbs', names.every((n) => n && !/\b(usd|pcs|na|mm|kg|dee|ad|ely|ff)\b/i.test(n) && !/\d/.test(n)), names);
check('Black -> "Polymaker PLA Black"; Matte Cotton White -> "Polymaker PLA Matte Cotton White"', by('CA19029').newProduct.product_name === 'Polymaker PLA Black' &&
  by('CA04069').newProduct.product_name === 'Polymaker PLA Matte Cotton White', [by('CA19029').newProduct, by('CA04069').newProduct]);
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

// pf-plus-1: a new colour from the product form's "+" (no trip to Settings > Lists)
r = await mgr('erpListAddValue', [{ kind: 'colors', value: '  Cotton   White ' }]);
check('the "+" adds "Cotton White" to the colours and says what it added', r.ok && r.result.added === 'Cotton White' && r.result.colors.includes('Cotton White'), r.result && r.result.colors);
r = await mgr('erpListAddValue', [{ kind: 'colors', value: 'cotton white' }]);
check('...once only, whatever the case', r.ok && r.result.colors.filter((c) => c.toLowerCase() === 'cotton white').length === 1, r.result && r.result.colors);
r = await mgr('erpListAddValue', [{ kind: 'secrets', value: 'x' }]);
check('only the product lists', !r.ok && /Which list/.test(r.error), r);

await done();
