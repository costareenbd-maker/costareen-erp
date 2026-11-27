// ship-1/ship-2: the vendor shipment business (kind 'cargo'). One shipment = one traveller on one flight with any
// number of our bags + loose things; bags keep code + QR for life; travellers keep a permanent keyword (C-0001).
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
let r = await owner('erpShips', [{}]);
check('not cargo: refused', !r.ok && /shipment business/.test(r.error), r);
await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'cargo') on conflict (business_id, key) do update set value = 'cargo'`;

// 1. a traveller gets a permanent keyword
r = await owner('erpShipPersonSave', [{ name: 'Test Carrier', phone: '+82 10-1111-2222', waOk: true }]);
check('traveller C-0001', r.ok && r.result.code === 'C-0001', r);
const pid = r.result.id;
r = await owner('erpShipPersonSave', [{ name: 'Second', phone: '+880 1712-000111', email: 'bad' }]);
check('bad email refused', !r.ok && /email/.test(r.error), r);

// 2. a shipment for him; two bags (one new, one made first); loose items in hand + own bag
r = await owner('erpShipNew', [{ type: 'trip', from: 'ICN', to: 'ICN' }]);
check('same airport refused', !r.ok, r);
r = await owner('erpShipNew', [{ type: 'trip', from: 'ICN', to: 'DAC', personId: pid }]);
check('shipment TR-0001 with traveller', r.ok && r.result.code === 'TR-0001' && r.result.carrier && r.result.carrier.code === 'C-0001', r);
const tr = r.result.id;
r = await owner('erpShipBagNew', [{ nickname: '' }]);
check('bag needs a nickname', !r.ok && /nickname/.test(r.error), r);
r = await owner('erpShipBagNew', [{ nickname: 'Blue big' }]);
check('bag BG-0001, body 1', r.ok && r.result.code === 'BG-0001' && r.result.bodyNo === 1, r);
const bag1 = r.result.id;
r = await sales('erpShipBagAdd', [{ id: tr, bagId: bag1 }]);
check('sales puts the bag in', r.ok && r.result.bags.length === 1, r);
r = await owner('erpShipBagAdd', [{ id: tr, nickname: 'Black trolley' }]);
check('second bag made on the spot BG-0002', r.ok && r.result.bags.length === 2 && r.result.bags[1].code === 'BG-0002', r);
const bag2 = r.result.bags[1].id;
r = await owner('erpShipItems', [{ id: tr, add: { name: 'Snail essence', qty: 24, place: 'bag' } }]);
check('bag item needs a bag', !r.ok && /Which bag/.test(r.error), r);
r = await owner('erpShipItems', [{ id: tr, add: { name: 'Snail essence', qty: 24, place: 'bag', bagId: bag1, for: 'Oliareen' } }]);
r = await owner('erpShipItems', [{ id: tr, add: { name: 'Toner', qty: 18, place: 'bag', bagId: bag2 } }]);
r = await owner('erpShipItems', [{ id: tr, add: { name: 'iPhone 16', qty: 1, place: 'hand' } }]);
r = await owner('erpShipItems', [{ id: tr, add: { name: 'Sun cream', qty: 6, place: 'own' } }]);
check('items by place', r.ok && r.result.items.length === 4 && r.result.items.filter((i) => i.place === 'hand').length === 1 && r.result.items.filter((i) => i.place === 'own').length === 1, r);
r = await owner('erpShipBagRemove', [{ id: tr, bagId: bag2 }]);
check('bag with items cannot come out', !r.ok, r);

// 3. a bag cannot be in two open shipments
r = await owner('erpShipNew', [{ type: 'trip', from: 'ICN', to: 'DAC' }]);
const tr2 = r.result.id;
r = await owner('erpShipBagAdd', [{ id: tr2, bagId: bag1 }]);
check('bag busy elsewhere refused', !r.ok && /already in shipment TR-0001/.test(r.error), r);

// 4. scanning: bag QR, traveller keyword, phone -> the open shipment
r = await owner('erpShipFind', [{ q: 'https://erp.example.com/#/ship/BG-0002' }]);
check('bag QR -> its shipment', r.ok && r.result.kind === 'trip' && r.result.code === 'TR-0001' && r.result.bag === 'BG-0002', r);
r = await owner('erpShipFind', [{ q: 'c-1' }]);
check('keyword -> his shipment', r.ok && r.result.kind === 'trip' && r.result.code === 'TR-0001', r);
r = await owner('erpShipFind', [{ q: '01011112222' }]);
check('phone -> his shipment', r.ok && r.result.code === 'TR-0001', r);
r = await owner('erpShipFind', [{ q: 'black trolley' }]);
check('bag nickname -> shipment', r.ok && r.result.code === 'TR-0001', r);

// 5. seal, flight, hand, time moves it, receive by keyword scan, count, done
r = await owner('erpShipStep', [{ id: tr, action: 'hand' }]);
check('steps in order', !r.ok && /order/.test(r.error), r);
r = await owner('erpShipStep', [{ id: tr, action: 'seal' }]);
check('sealed', r.ok && r.result.step === 1, r);
r = await owner('erpShipBagAdd', [{ id: tr, nickname: 'late bag' }]);
check('no bag after seal', !r.ok && /sealed/.test(r.error), r);
const dep = new Date(Date.now() + 86400e3).toISOString(), land = new Date(Date.now() + 2 * 86400e3).toISOString();
r = await owner('erpShipCarrier', [{ id: tr, personId: pid, flightNo: 'ke657', departAt: land, landAt: dep }]);
check('landing before leaving refused', !r.ok && /after/.test(r.error), r);
r = await owner('erpShipCarrier', [{ id: tr, personId: pid, flightNo: 'ke657', departAt: dep, landAt: land }]);
check('flight set', r.ok && r.result.flightNo === 'KE657', r);
r = await owner('erpShipStep', [{ id: tr, action: 'hand' }]);
check('handed', r.ok && r.result.step === 2, r);
await sql`update ships set depart_at = now() - interval '12 hours', land_at = now() - interval '5 hours' where id = ${tr}`;
r = await owner('erpShip', [{ code: 'tr1' }]);
check('landed by time, late', r.ok && r.result.step === 4 && r.result.place === 'bd' && r.result.late === true, r);
r = await sales('erpShipStep', [{ id: tr, action: 'receive', via: 'C-0001' }]);
check('received by sales (keyword scan)', r.ok && r.result.step === 5 && r.result.late === false && r.result.events.some((e) => /scan C-0001/.test(e.what)), r);
const counts = {}; r.result.items.forEach((i) => { counts[i.id] = i.qty; });
const first = r.result.items[0].id; counts[first] = 23;
r = await owner('erpShipCheck', [{ id: tr, counts, finish: true }]);
check('counted, mismatch logged', r.ok && r.result.step === 6 && r.result.events.some((e) => /do not match/.test(e.what)), r);

// 6. money
r = await sales('erpShipMoney', [{ id: tr, feeAmt: 90000, feeCur: 'KRW' }]);
check('sales cannot write money', !r.ok, r);
r = await mgr('erpShipMoney', [{ id: tr, feeAmt: 90000, feeCur: 'KRW', customs: 4500, customsBy: 'carrier' }]);
check('fee + customs', r.ok && r.result.fee.amt === 90000 && r.result.customs.amt === 4500, r);
r = await owner('erpShipMoney', [{ id: tr, customs: -5 }]);
check('negative customs refused', !r.ok, r);
r = await owner('erpShipPerson', [{ id: pid }]);
check('traveller profile money', r.ok && r.result.code === 'C-0001' && r.result.total.KRW === 90000 && r.result.total.BDT === 4500 && r.result.trips.length === 1, r);
check('traveller profile counts bags and pieces', r.ok && r.result.bags >= 1 && r.result.pcs > 0 && r.result.trips[0].bags === r.result.bags, r.result && { bags: r.result.bags, pcs: r.result.pcs });
r = await owner('erpShipPeople', []);
check('traveller list counts bags', r.ok && r.result.people.some((p) => p.id === pid && p.bags >= 1 && p.pcs > 0), r.ok && r.result.people.map((p) => [p.id, p.bags]));

// 7. bag replaced: same code, bag number 2, history; QR unchanged (code is the QR)
r = await owner('erpShipBagReplace', [{ id: bag1, reason: '' }]);
check('replace needs a reason', !r.ok, r);
r = await sales('erpShipBagReplace', [{ id: bag1, reason: 'torn' }]);
check('sales cannot replace', !r.ok, r);
r = await owner('erpShipBagReplace', [{ id: bag1, reason: 'torn', nickname: 'Blue big (new)' }]);
check('bag 2, same code, history', r.ok && r.result.code === 'BG-0001' && r.result.bodyNo === 2 && r.result.changes.length === 1 && r.result.trips[0].bodyNo === 1, r);

// 8. the way back takes the same bags, airports swapped; then the bags open it
r = await owner('erpShipReturn', [{ id: tr }]);
check('way back TR-0003 with both bags', r.ok && r.result.code === 'TR-0003' && r.result.from === 'DAC' && r.result.bags.length === 2 && r.result.bags.find((b) => b.code === 'BG-0001').bodyNo === 2, r);
r = await owner('erpShipFind', [{ q: 'BG-0001' }]);
check('bag now opens the way back', r.ok && r.result.code === 'TR-0003', r);
r = await owner('erpShipBags', []);
check('bag list', r.ok && r.result.bags.length === 2 && r.result.bags[0].openTrip === 'TR-0003', r);

// 9. air cargo
r = await owner('erpShipNew', [{ type: 'air', from: 'ICN', to: 'DAC', forwarder: 'Hanjin', awb: '180-4471 2203', cartons: 3, weightKg: 42 }]);
check('air AC-0001', r.ok && r.result.code === 'AC-0001' && r.result.type === 'air', r);
const air = r.result.id;
r = await owner('erpShipBagAdd', [{ id: air, nickname: 'x' }]);
check('no bags in air cargo', !r.ok, r);
r = await owner('erpShipItems', [{ id: air, add: { name: 'A1 mini', qty: 4 } }]);
check('cargo item', r.ok && r.result.items[0].place === 'cargo', r);
r = await owner('erpShipFind', [{ q: '18044712203' }]);
check('AWB finds it', r.ok && r.result.code === 'AC-0001', r);
for (const a of ['book', 'pickup', 'fly', 'customs', 'receive']) r = await owner('erpShipStep', [{ id: air, action: a }]);
check('air reached in hand', r.ok && r.result.step === 5, r);

// 10. two open shipments for one traveller: the keyword asks which
await owner('erpShipCarrier', [{ id: tr2, personId: pid, flightNo: 'OZ1' }]);
await owner('erpShipCarrier', [{ id: (await owner('erpShip', [{ code: 'TR-0003' }])).result.id, personId: pid }]);
r = await owner('erpShipFind', [{ q: 'C-0001' }]);
check('keyword with two open -> choices', r.ok && r.result.kind === 'person' && r.result.choices.length === 2, r);

const other = await sql`select count(*)::int as n from ships where business_id = ${FIX.B2}`;
check('other business untouched', other[0].n === 0, other);
await done();
