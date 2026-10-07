// Receive stock from a file (handlers/receivefile.js): a Bambu order sheet without brand or SKU, a Polymaker
// proforma with supplier codes, the text of a packing-list PDF with wrapped names, a photo-table of a Sunlu price
// list; matching by words, by our SKU, by a remembered alias; new products suggested, never guessed.
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const add = (name, brand, color, sku) => mgr('erpSaveProduct', [{ isNew: true, sku, product_name: name, brand, color, category: 'Filaments', unit: 'Roll', sell_price: 1700 }]);
for (const [n, b, c, s] of [['Bambulab Pla Basic Jade White', 'Bambulab', 'Jade White', 'bpbjw055'], ['Bambulab Pla Basic Black', 'Bambulab', 'Black', 'bpbb001'],
                            ['Bambulab Pla Matte Ash Gray', 'Bambulab', 'Ash Gray', 'bpmag088'], ['Bambulab Pla Basic Grey', 'Bambulab', 'Grey', 'bpbg003'],
                            ['Sunlu pla+ Black', 'Sunlu', 'Black', 'sp+b002'], ['Sunlu petg Black', 'Sunlu', 'Black', 'spegb040'], ['Sunlu pla+ Bone White', 'Sunlu', 'Bone White', 'sp+bw011'],
                            ['Sunlu pla+ White', 'Sunlu', 'White', 'sp+w001']]) {
  const r = await add(n, b, c, s); check('fixture product ' + s, r.ok, r);
}

// 1. the Bambu order sheet: Category / Sub-category / Colour / Variant / Diameter / Weight / Order - no brand, no SKU
const bambu = [['Category', 'Sub-category', 'Product Color Name', 'Variant', 'Diameter', 'Weight', 'Order', null],
  ['Filament', 'PLA Basic', 'Jade White', 'Refill', '1.75 mm', '1 kg', 250, 250], ['Filament', 'PLA Basic', 'Black', 'Refill', '1.75 mm', '1 kg', 300, 300],
  ['Filament', 'PLA Matte', 'Ash Grey', 'Refill', '1.75 mm', '1 kg', 5, 5], ['Filament', 'PLA Basic', 'Cobalt Blue', 'Refill', '1.75 mm', '1 kg', 10, 10]];
let r = await sales('erpReceiveMatch', [{ rows: bambu, fileName: 'Aiden拓竹耗材.xlsx' }]);
check('sales staff cannot (receiving is a manager’s job)', !r.ok, r);
r = await mgr('erpReceiveMatch', [{ rows: bambu, fileName: 'Aiden拓竹耗材.xlsx' }]);
check('the brand comes from the file name (拓竹 = Bambu Lab); 3 of 4 lines matched by words', r.ok && r.result.brand === 'bambulab' && r.result.matched === 3 && r.result.unmatched === 1, r.ok ? r.result.lines.map((l) => l.text + ' -> ' + l.sku + ' ' + l.confidence) : r);
const L = r.ok ? r.result.lines : [];
check('Jade White 250 -> bpbjw055; Black 300 -> the Bambu black, not the Sunlu one', L[0].sku === 'bpbjw055' && L[0].qty === 250 && L[1].sku === 'bpbb001' && L[1].qty === 300, L.slice(0, 2));
check('Ash Grey matches Ash Gray', L[2].sku === 'bpmag088', L[2]);
check('Cobalt Blue: no such product -> new, with a sensible name', L[3].isNew && /Bambulab PLA Basic Cobalt Blue/.test(L[3].newProduct.product_name) && L[3].newProduct.brand === 'Bambulab', L[3]);
check('totals', r.result.totalQty === 565, r.result.totalQty);

// 2. the Polymaker proforma: supplier codes, a long name, USD prices - nothing of ours yet, so every line is new
const pi = [[null, 'Proforma Invoice'], [null, 'SeqNum', 'SKU', 'Product Name', 'Quantity', 'Unit Value (USD)', 'Total Values (USD)'],
  [null, 1, 'CA19029', 'polymaker/Panchroma™ PLA/Spool-less/1kg/1.75mm/Black ', 350, 5.5, 1925], [null, 2, 'CA19030', 'polymaker/Panchroma™ PLA/Spool-less/1kg/1.75mm/White', 500, 5.5, 2750]];
r = await mgr('erpReceiveMatch', [{ rows: pi, supplier: 'JF Polymers' }]);
check('codes, quantities and USD prices read; both lines new (no Polymaker in stock)', r.ok && r.result.lines.length === 2 && r.result.lines[0].code === 'CA19029' && r.result.lines[0].qty === 350 && r.result.lines[0].price === 5.5 && r.result.currency === 'USD' && r.result.unmatched === 2 && r.result.totalPrice === 4675, r.ok ? r.result : r);
check('the new product is named Polymaker PLA Black, not the whole supplier string', /^Polymaker PLA Black$/.test(r.result.lines[0].newProduct.product_name), r.result.lines[0].newProduct);

// 3. the owner adds Polymaker black and teaches the code; the next file matches at once
r = await add('Polymaker Panchroma PLA Black', 'Polymaker', 'Black', 'pmpb001'); check('polymaker product', r.ok, r);
r = await mgr('erpReceiveLearn', [{ pairs: [{ alias: 'CA19029', sku: 'pmpb001' }], supplier: 'JF Polymers' }]);
check('the alias is remembered', r.ok && r.result.saved === 1, r);
r = await mgr('erpReceiveMatch', [{ rows: pi, supplier: 'JF Polymers' }]);
check('CA19029 -> pmpb001 by memory; White by words would be the same brand but no white product -> new', r.ok && r.result.lines[0].sku === 'pmpb001' && r.result.lines[0].how === 'remembered' && r.result.lines[1].isNew, r.result.lines);
const other = await sql`select count(*)::int n from product_aliases where business_id = ${FIX.B2}`;
check('the other business learned nothing', other[0].n === 0, other);

// 4. the packing-list PDF as lines of text: a code, a name wrapped over lines, then a numbers line with the qty
const pdf = ['Packing List', 'SKU PRODUCT QTY MINPACK N.W(kg) G.W(kg) HS CODE',
  '2000042985 NA CA19029 Panchroma ™ PLA', 'Black/1.75mm/1.00', 'kg', '300.000 300.000 300.000 372.000 39169090', '00',
  '2000042985 NA CA19031 Panchroma ™ PLA', 'Grey/1.75mm/1.00k', 'g', '50.000 50.000 50.000 62.000 39169090', '00', 'Total1,170.00', 'Page: 3/3'];
r = await mgr('erpReceiveMatch', [{ rows: pdf, kind: 'text', supplier: 'JF Polymers' }]);
check('two records out of the wrapped text, with codes and quantities', r.ok && r.result.lines.length === 2 && r.result.lines[0].code === 'CA19029' && r.result.lines[0].qty === 300 && r.result.lines[1].code === 'CA19031' && r.result.lines[1].qty === 50, r.ok ? r.result.lines : r);
check('the remembered code matches; the other is new "Polymaker PLA Grey"', r.result.lines[0].sku === 'pmpb001' && r.result.lines[1].isNew && /Polymaker PLA Grey/.test(r.result.lines[1].newProduct.product_name), r.result.lines);

// 5. the photo-table (typed out): Type / Colour / Chinese / packet / qty / price, supplier Sunlu
const photo = [['Type', 'Color', '颜色', 'packet', 'Order List', 'Unit Price', 'Total Price'],
  ['PETG', 'Black', '黑色', '1 KG', 40, 37, 1480], ['PLA+', 'Black', '黑色', '1 KG', 250, 48, 12000], ['PLA+2.0（diskless）', 'White', '白色', '1 KG', 100, 48, 4800],
  ['PLA+', 'Bone White', '骨白', '1 KG', 60, 48, 2880], ['TPU-95A', 'Grey', '灰色', '1 KG', 5, 86, 430], ['合计', '', '', '', 1410, '', 68365]];
r = await mgr('erpReceiveMatch', [{ rows: photo, supplier: 'Sunlu Direct' }]);
const P = r.ok ? r.result.lines : [];
check('PETG Black -> Sunlu petg; PLA+ Black -> Sunlu pla+ (not the Bambu black); PLA+2.0 White -> Sunlu pla+ White; Bone White exact', r.ok && P[0].sku === 'spegb040' && P[1].sku === 'sp+b002' && P[2].sku === 'sp+w001' && P[3].sku === 'sp+bw011', P.map((l) => l.text + ' -> ' + l.sku));
check('TPU Grey: new "Sunlu TPU Grey"; the total line is skipped', P.length === 5 && P[4].isNew && /Sunlu TPU Grey/.test(P[4].newProduct.product_name), P[4]);
check('quantities and prices', P[1].qty === 250 && P[1].price === 48 && r.result.totalQty === 455, r.result);

// 6. an unreadable file
r = await mgr('erpReceiveMatch', [{ rows: [['hello'], ['world']] }]);
check('no product lines: a plain refusal', !r.ok && /No product lines/.test(r.error), r);
await done();
