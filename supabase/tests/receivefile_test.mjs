// Receive stock from a file (handlers/receivefile.js): a Bambu order sheet without brand or SKU, a Polymaker
// proforma with supplier codes, the text of a packing-list PDF with wrapped names, a photo-table of a Sunlu price
// list; matching by words, by our SKU, by a remembered alias; new products suggested, never guessed.
import { randomBytes } from 'node:crypto';
import { sql, FIX, owner, mgr, sales, check, done, deps, web } from './harness.mjs';

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

// 7. a photo through the provider's AI reader: not set up -> a plain refusal that says the device reading stands
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png-bytes').toString('base64');
r = await mgr('erpReceiveRead', [{ image: PNG, hint: 'PLA+ Black 250 48', supplier: 'Sunlu Direct' }]);
check('no key on this server: refused, with what to do', !r.ok && /not set up/.test(r.error), r);
deps.geminiKey = 'test-key';
web.on(/generativelanguage\.googleapis\.com/, (url, opts) => {
  const body = JSON.parse(opts.body);
  const parts = body.contents[0].parts;
  const hasImage = parts.some((x) => x.inline_data && x.inline_data.mime_type === 'image/png'), hasHint = /PLA\+ Black 250 48/.test(parts[0].text);
  if (!hasImage || !hasHint) return { status: 400, body: { error: 'bad request' } };
  return { status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify([
    { code: '', name: 'PLA+ Black', qty: 250, price: 48, currency: 'RMB' }, { code: '', name: 'PETG Black', qty: 40, price: 37, currency: 'RMB' },
    { code: '', name: 'TPU-95A Grey', qty: 5, price: 86, currency: 'RMB' }, { code: '', name: 'Total', qty: 0, price: 0, currency: '' }]) }] } }] } };
});
r = await mgr('erpReceiveRead', [{ image: PNG, hint: 'PLA+ Black 250 48', supplier: 'Sunlu Direct' }]);
check('the AI reader\u2019s lines are matched like a file: PLA+ Black -> Sunlu pla+, PETG -> Sunlu petg, TPU new; the total line dropped', r.ok && r.result.reader === 'gemini' && r.result.lines.length === 3 && r.result.lines[0].sku === 'sp+b002' && r.result.lines[1].sku === 'spegb040' && r.result.lines[2].isNew && r.result.currency === 'RMB' && r.result.readsLeft === 39, r.ok ? r.result.lines.map((l) => l.text + ' -> ' + l.sku) : r);
r = await mgr('erpReceiveRead', [{ image: 'data:text/plain;base64,QUJD' }]);
check('not a photo: refused', !r.ok, r);
r = await sales('erpReceiveRead', [{ image: PNG }]);
check('sales staff cannot', !r.ok, r);
await sql`update business_config set value = '40' where business_id = ${FIX.B} and key like 'ai_reads:%'`;
r = await mgr('erpReceiveRead', [{ image: PNG }]);
check('the day\u2019s allowance protects the provider\u2019s quota', !r.ok && /allowance/.test(r.error), r);
web.on(/generativelanguage\.googleapis\.com/, () => ({ status: 429, body: { error: 'quota' } }));
await sql`update business_config set value = '1' where business_id = ${FIX.B} and key like 'ai_reads:%'`;
r = await mgr('erpReceiveRead', [{ image: PNG }]);
check('Google busy: a plain sentence', !r.ok && /busy/.test(r.error), r);
deps.geminiKey = '';

// 8. spool or refill: the same colour twice in the catalogue - the row's wording decides; transparent and wood are colours
for (const [n, b, c, s2] of [['Sunlu Pla+2.0 Refill Black', 'Sunlu', 'Black', 'sp+2.0refillb124'], ['Sunlu Pla+ Transparent', 'Sunlu', 'Transparent', 'sp+tp013'], ['Sunlu Pla Wood Wood', 'Sunlu', 'Wood', 'spww032'], ['Sunlu Pla Wood Maple Wood', 'Sunlu', 'Maple Wood', 'spwmw033']]) { const q = await add(n, b, c, s2); check('fixture ' + s2, q.ok, q); }
r = await mgr('erpReceiveMatch', [{ rows: [['Type', 'Color', 'Order List', 'Unit Price'], ['PLA+', 'Black', 250, 48], ['PLA+2.0ï¼disklessï¼', 'Black', 50, 48], ['PLA+', 'Transparent', 30, 48], ['PLA wood', 'Wood', 10, 68], ['PLA wood', 'Maple Wood', 10, 68]], supplier: 'Sunlu' }]);
const V = r.ok ? r.result.lines.map((l) => l.sku) : r;
check('PLA+ Black -> the spool; PLA+2.0 (diskless) Black -> the refill; Transparent, Wood and Maple Wood each to their own', r.ok && V[0] === 'sp+b002' && V[1] === 'sp+2.0refillb124' && V[2] === 'sp+tp013' && V[3] === 'spww032' && V[4] === 'spwmw033', V);

// 9. the provider sets the key from the ERP: stored (sealed) and used before the server's own; a test call; removal
r = await mgr('erpAiReader', []);
check('not the provider: refused', !r.ok, r);
await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
deps.geminiKey = ''; deps.bridgeKey = randomBytes(32).toString('base64');   // live: ERP_BRIDGE_KEY seals the stored key
r = await owner('erpAiReader', []);
check('nothing set anywhere', r.ok && r.result.set === false && r.result.source === 'none', r);
r = await owner('erpAiReaderSet', [{ key: 'short' }]);
check('a key that does not look like one is refused', !r.ok, r);
r = await owner('erpAiReaderSet', [{ key: 'AIzaSy_test_key_1234567890abcdefXYZ' }]);
check('stored: set, source stored, only the last 4 shown', r.ok && r.result.set && r.result.source === 'stored' && r.result.last4 === 'fXYZ' && r.result.updated, r);
const row = (await sql`select value_enc from erp_provider_secrets where key = 'GEMINI_KEY'`)[0];
check('the key is not stored in clear', row && !/AIzaSy_test_key/.test(row.value_enc), row);
web.on(/generativelanguage\.googleapis\.com/, (url) => (/key=AIzaSy_test_key_1234567890abcdefXYZ/.test(url) ? { status: 200, body: { candidates: [{ content: { parts: [{ text: 'OK' }] } }] } } : { status: 403, body: { error: 'bad key' } }));
r = await owner('erpAiReaderTest', []);
check('the test call uses the stored key', r.ok && r.result.ok && r.result.source === 'stored', r);
r = await owner('erpAiReaderSet', [{ key: '' }]);
check('removed: back to nothing', r.ok && r.result.set === false, r);
deps.geminiKey = 'server-env-key-abcdefghijklmnop';
r = await owner('erpAiReader', []);
check('the server’s own key shows as source server', r.ok && r.result.set && r.result.source === 'server', r);
r = await owner('erpAiReaderTest', []);
check('the server key is refused by the fake Google: a plain sentence', !r.ok && /refused the key/.test(r.error), r);
deps.geminiKey = '';
await done();
