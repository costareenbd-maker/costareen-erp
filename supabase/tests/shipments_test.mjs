// ship-1: the vendor shipment business (kind 'cargo'): bags with round trips, air cargo, carriers, customs, counting.
import { sql, FIX, owner, mgr, sales, check, done } from './harness.mjs';

const B = FIX.B;
// 1. a normal business has no shipment screens
let r = await owner('erpShips', [{}]);
check('not cargo: refused', !r.ok && /shipment business/.test(r.error), r);

await sql`insert into business_config (business_id, key, value) values (${B}, 'business_kind', 'cargo') on conflict (business_id, key) do update set value = 'cargo'`;

// 2. a bag: nickname needed, code numbered
r = await owner('erpShipNew', [{ type: 'bag', from: 'ICN', to: 'DAC' }]);
check('bag needs a nickname', !r.ok && /nickname/.test(r.error), r);
r = await owner('erpShipNew', [{ type: 'bag', nickname: 'নীল বড়', from: 'ICN', to: 'DAC' }]);
check('bag made BG-0001', r.ok && r.result.code === 'BG-0001' && r.result.step === 0 && r.result.place === 'kr', r);
const bag = r.result.id;
r = await owner('erpShipNew', [{ type: 'bag', nickname: 'কালো', from: 'ICN', to: 'ICN' }]);
check('same airport refused', !r.ok, r);

// 3. sealing an empty bag is refused; items added; sales can pack
r = await owner('erpShipStep', [{ id: bag, action: 'seal' }]);
check('empty bag cannot seal', !r.ok && /inside/.test(r.error), r);
r = await sales('erpShipItems', [{ id: bag, add: { name: 'COSRX Snail 96', qty: 24, for: 'Oliareen' } }]);
check('sales adds an item', r.ok && r.result.items.length === 1 && r.result.items[0].qty === 24, r);
r = await owner('erpShipItems', [{ id: bag, add: { name: 'Anua Toner', qty: 18 } }]);
const it2 = r.result.items[1].id;
r = await owner('erpShipItems', [{ id: bag, qty: { itemId: it2, qty: 20 } }]);
check('qty changed', r.ok && r.result.items[1].qty === 20, r);

// 4. hand before carrier refused; seal; carrier with a new person and flight; hand
r = await owner('erpShipStep', [{ id: bag, action: 'seal' }]);
check('sealed', r.ok && r.result.step === 1, r);
r = await owner('erpShipItems', [{ id: bag, add: { name: 'late', qty: 1 } }]);
check('no items after seal', !r.ok && /sealed/.test(r.error), r);
r = await owner('erpShipStep', [{ id: bag, action: 'hand' }]);
check('hand needs a carrier', !r.ok && /carries/.test(r.error), r);
const dep = new Date(Date.now() + 86400e3).toISOString(), land = new Date(Date.now() + 2 * 86400e3).toISOString();
r = await owner('erpShipCarrier', [{ id: bag, person: { name: 'Test Carrier', phone: '+82 10-1111-2222', email: 'bad', waOk: true }, flightNo: 'ke657', departAt: dep, landAt: land }]);
check('bad email refused', !r.ok && /email/.test(r.error), r);
r = await owner('erpShipCarrier', [{ id: bag, person: { name: 'Test Carrier', phone: '+82 10-1111-2222', waOk: true }, flightNo: 'ke657', departAt: land, landAt: dep }]);
check('landing before leaving refused', !r.ok && /after/.test(r.error), r);
r = await owner('erpShipCarrier', [{ id: bag, person: { name: 'Test Carrier', phone: '+82 10-1111-2222', waOk: true }, flightNo: 'ke657', departAt: dep, landAt: land }]);
check('carrier set', r.ok && r.result.carrier && r.result.carrier.name === 'Test Carrier' && r.result.flightNo === 'KE657', r);
const pid = r.result.carrier.id;
r = await owner('erpShipStep', [{ id: bag, action: 'hand' }]);
check('handed', r.ok && r.result.step === 2, r);

// 5. flight times move the step: put the flight in the past -> landed; late after 4 h
await sql`update ships set depart_at = now() - interval '12 hours', land_at = now() - interval '5 hours' where id = ${bag}`;
r = await owner('erpShip', [{ code: 'bg1' }]);
check('found by short code, landed by time, late', r.ok && r.result.step === 4 && r.result.place === 'bd' && r.result.late === true, r);
r = await owner('erpShipFind', [{ q: 'https://bag.costareen.com/t/BG-0001' }]);
check('QR link finds it', r.ok && r.result.code === 'BG-0001', r);
r = await owner('erpShipFind', [{ q: 'নীল বড়' }]);
check('nickname finds it', r.ok && r.result.code === 'BG-0001', r);

// 6. counting needs "in hand"; receive; count with a mismatch; finish
r = await owner('erpShipCheck', [{ id: bag, counts: {} }]);
check('count before receive refused', !r.ok, r);
r = await sales('erpShipStep', [{ id: bag, action: 'receive' }]);
check('received by sales', r.ok && r.result.step === 5 && r.result.late === false, r);
const [i1, i2] = r.result.items.map((i) => i.id);
r = await owner('erpShipCheck', [{ id: bag, counts: { [i1]: 24 }, finish: true }]);
check('finish needs every line', !r.ok && /every line/.test(r.error), r);
r = await owner('erpShipCheck', [{ id: bag, counts: { [i1]: 24, [i2]: 19 }, finish: true }]);
check('counted, done, mismatch logged', r.ok && r.result.step === 6 && r.result.events.some((e) => /do not match/.test(e.what)), r);

// 7. money: sales cannot, manager can; customs null / 0 / amount
r = await sales('erpShipMoney', [{ id: bag, feeAmt: 90000, feeCur: 'KRW' }]);
check('sales cannot write money', !r.ok, r);
r = await mgr('erpShipMoney', [{ id: bag, feeAmt: 90000, feeCur: 'KRW', customs: 0 }]);
check('fee + customs 0', r.ok && r.result.fee.amt === 90000 && r.result.customs.amt === 0, r);
r = await owner('erpShipMoney', [{ id: bag, customs: 4500, customsBy: 'carrier' }]);
check('customs paid by carrier', r.ok && r.result.customs.amt === 4500 && r.result.customs.by === 'carrier', r);
r = await owner('erpShipMoney', [{ id: bag, customs: -5 }]);
check('negative customs refused', !r.ok, r);

// 8. return trip: same code, ports swapped, trip 2; the board shows the newest trip
r = await owner('erpShipReturn', [{ id: bag }]);
check('return trip', r.ok && r.result.code === 'BG-0001' && r.result.tripNo === 2 && r.result.from === 'DAC' && r.result.to === 'ICN' && r.result.step === 0, r);
r = await owner('erpShipReturn', [{ id: bag }]);
check('second return refused', !r.ok, r);
r = await owner('erpShips', [{}]);
check('board: one row for the bag, trip 2', r.ok && r.result.ships.filter((s) => s.code === 'BG-0001').length === 1 && r.result.ships[0].tripNo === 2, r);

// 9. air cargo: AC code, AWB search, steps in order
r = await owner('erpShipNew', [{ type: 'air', from: 'ICN', to: 'DAC', forwarder: 'Hanjin', awb: '180-4471 2203', cartons: 3, weightKg: 42 }]);
check('air made AC-0001', r.ok && r.result.code === 'AC-0001' && r.result.type === 'air', r);
const air = r.result.id;
r = await owner('erpShipFind', [{ q: '18044712203' }]);
check('AWB finds it', r.ok && r.result.code === 'AC-0001', r);
r = await owner('erpShipCarrier', [{ id: air, personId: pid }]);
check('air has no carrier', !r.ok, r);
r = await owner('erpShipStep', [{ id: air, action: 'pickup' }]);
check('steps in order', !r.ok && /order/.test(r.error), r);
for (const a of ['book', 'pickup', 'fly', 'customs', 'receive']) r = await owner('erpShipStep', [{ id: air, action: a }]);
check('air reached in hand', r.ok && r.result.step === 5, r);
r = await owner('erpShipAir', [{ id: air, trackUrl: 'http://x' }]);
check('tracking link must be https', !r.ok, r);

// 10. carrier profile: trips and what they got (fee KRW + customs paid back BDT)
r = await owner('erpShipPerson', [{ id: pid }]);
check('profile money', r.ok && r.result.trips.length === 1 && r.result.total.KRW === 90000 && r.result.total.BDT === 4500 && r.result.pays.length === 2, r);
r = await owner('erpShipPeople', []);
check('people list', r.ok && r.result.people.length === 1 && r.result.people[0].trips === 1, r);
r = await owner('erpShipPersonSave', [{ id: pid, name: 'Test Carrier', phone: '+82 10-1111-2222', note: 'monthly', photo: 'javascript:x' }]);
check('bad photo refused', !r.ok, r);
r = await owner('erpShipPersonSave', [{ id: pid, name: 'Test Carrier', city: 'Ansan', note: 'monthly' }]);
check('person saved', r.ok && r.result.city === 'Ansan' && r.result.note === 'monthly', r);

// 11. the other business sees nothing
const other = await sql`select count(*)::int as n from ships where business_id = ${FIX.B2}`;
check('other business untouched', other[0].n === 0, other);

await done();
