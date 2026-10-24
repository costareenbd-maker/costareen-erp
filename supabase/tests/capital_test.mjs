// Capital screen (build b261002-1321) and the kept dashboard.
import { sql, FIX, owner, mgr, shareholder, makeShareholder, check, done } from './harness.mjs';

const B = FIX.B;
await makeShareholder();
const now = new Date(Date.now() + 6 * 3600e3);
const ym = (d) => d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0');
const thisMonth = ym(now);
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + String(mo).padStart(2, '0'); };
const prev = shift(thisMonth, -1), prev2 = shift(thisMonth, -2);

// ---- roles ----
let r = await mgr('erpCapital', []);
check('manager cannot open Capital', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await shareholder('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'X', pct: 10 }]);
check('shareholder cannot change holders', !r.ok && r.error === 'Your account does not have access to that.', r);
r = await owner('erpCapital', []);
check('empty book', r.ok && r.result.canEdit === true && r.result.holders.length === 0 && r.result.totals.pctFree === 100 &&
  r.result.months.length === 1 && r.result.months[0].current && r.result.thisMonth === thisMonth && r.result.currency === 'BDT', r);

// ---- shareholders ----
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: '', pct: 10 }]);
check('name required', !r.ok && r.error === 'Whose is it? Type the name.', r);
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 0 }]);
check('share must be above 0', !r.ok && r.error === 'The share is a percentage above 0 and up to 100.', r);
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 60, phone: '1712345678', since: prev2, invested: 100000 }]);
check('shareholder added with opening amount', r.ok && r.result.holders.length === 1 && r.result.holders[0].capital === 100000 &&
  r.result.holders[0].phone === '01712345678' && r.result.holders[0].since === prev2 && r.result.entries[0].note === 'Opening amount' &&
  r.result.entries[0].label === 'Money put in', r.result);
const RAH = r.result.holders[0].id;
check('months run from the first shareholder to now', r.result.months.length === 3 && r.result.months[0].month === thisMonth && r.result.months[2].month === prev2, r.result.months);
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'rahman', pct: 10 }]);
check('same name refused', !r.ok && r.error === 'rahman is already on the list.', r);
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Partner', pct: 50 }]);
check('shares cannot pass 100%', !r.ok && r.error === 'That would make 110% in all. The others already hold 60%, so at most 40% is free.', r);
r = await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Partner', pct: 30, private: true, since: prev }]);
check('private shareholder added', r.ok && r.result.holders.length === 2 && r.result.totals.pctGiven === 90 && r.result.totals.pctFree === 10, r.result.totals);
const PAR = r.result.holders.find((h) => h.name === 'Partner').id;
r = await owner('erpCapitalHolderSave', [{ id: RAH, kind: 'shareholder', name: 'Rahman', pct: 65, from: prev2 }]);   // fix-3: from his first month (it never ran at 60)
check('change a share (others 30 + 65 = 95)', r.ok && r.result.holders.find((h) => h.id === RAH).pct === 65 && r.result.holders.find((h) => h.id === RAH).since === prev2, r.result.holders);
r = await owner('erpCapitalHolderSave', [{ id: 'Hnope', kind: 'shareholder', name: 'Ghost', pct: 1 }]);
check('unknown id refused', !r.ok && r.error === 'That person is no longer on the list.', r);

// ---- investors ----
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Salma', returnKind: 'monthly', returnValue: 0 }]);
check('monthly return needs an amount', !r.ok && r.error === 'How much are they paid each month?', r);
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Salma', returnKind: 'percent', returnValue: 150 }]);
check('percent above 100 refused', !r.ok && r.error === 'A monthly return above 100% cannot be right.', r);
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Salma', returnKind: 'monthly', returnValue: 5000, since: prev, invested: 200000 }]);
const SAL = r.ok && r.result.holders.find((h) => h.name === 'Salma');
check('investor: 200000 in, 5000 a month, due for the month that is over; this month still building', SAL && SAL.capital === 200000 && SAL.returnDue === 5000 && SAL.returnOwed === 5000 && SAL.monthlyReturn === 5000 && SAL.returnBuilding > 0 && SAL.returnBuilding <= 5000, SAL);
r = await owner('erpCapitalHolderSave', [{ kind: 'investor', name: 'Kamal', returnKind: 'percent', returnValue: 2, invested: 50000 }]);
const KAM = r.result.holders.find((h) => h.name === 'Kamal');
check('percent investor: 2% of 50000 = 1000 a month, nothing due until the month is over', KAM.monthlyReturn === 1000 && KAM.returnDue === 0 && KAM.returnBuilding > 0 && KAM.returnBuilding < 100, KAM);
check('totals: owners 100000, outside 250000, all 350000', r.result.totals.ownersCapital === 100000 && r.result.totals.outsideCapital === 250000 && r.result.totals.allCapital === 350000 && r.result.totals.returnDue === 5000, r.result.totals);

// ---- the book ----
r = await owner('erpCapitalEntryAdd', [{ holder: SAL.id, type: 'profit', amount: 100 }]);
check('profit to an investor refused', !r.ok && r.error === 'Profit is paid to a shareholder. An investor is paid a return.', r);
r = await owner('erpCapitalEntryAdd', [{ holder: RAH, type: 'ret', amount: 100 }]);
check('return to a shareholder refused', !r.ok && r.error === 'A return is paid to an investor. A shareholder is paid profit.', r);
r = await owner('erpCapitalEntryAdd', [{ holder: RAH, type: 'withdraw', amount: 100001 }]);
check('cannot take back more than is in', !r.ok && r.error === 'Rahman has 100000 in the business. More than that cannot be taken back.', r);
r = await owner('erpCapitalEntryAdd', [{ holder: RAH, type: 'invest', amount: 5, date: '2999-01-01' }]);
check('future date refused', !r.ok && r.error === 'That date has not come yet.', r);
r = await owner('erpCapitalEntryAdd', [{ holder: '', type: 'invest', amount: 5 }]);
check('needs a person', !r.ok && r.error === 'Whose money is it? Choose the person.', r);
r = await owner('erpCapitalEntryAdd', [{ holder: SAL.id, type: 'ret', amount: 5000, method: 'bKash', note: 'first month' }]);
check('return paid: owed drops to 0', r.ok && r.result.holders.find((h) => h.id === SAL.id).returnOwed === 0 && r.result.totals.returnPaid === 5000, r.result && r.result.totals);
let ex = await sql`select * from expenses where business_id = ${B} and category = 'Investor returns'`;
check('paying a return is not a second expense (the month it fell due in carries it)', ex.length === 0, ex);
const retEntry = r.result.entries.find((e) => e.type === 'ret');
r = await owner('erpCapitalEntryVoid', [{ id: retEntry.id, reason: '' }]);
check('strike out needs a reason', !r.ok && r.error === 'Say why it is being struck out, so the book can be read later.', r);
r = await owner('erpCapitalEntryVoid', [{ id: retEntry.id, reason: 'typed twice' }]);
check('struck out: owed back to 5000, line kept', r.ok && r.result.holders.find((h) => h.id === SAL.id).returnOwed === 5000 &&
  /^struck out .* by .*: typed twice$/.test(r.result.entries.find((e) => e.id === retEntry.id).voided), r.result && r.result.entries[0]);
r = await owner('erpCapitalEntryVoid', [{ id: retEntry.id, reason: 'again' }]);
check('already struck out', !r.ok && r.error === 'That line is already struck out.', r);

// ---- months: profit shared by the agreed shares ----
r = await owner('erpCapital', []);
const before = r.result;
const mPrev = before.months.find((m) => m.month === prev), mPrev2 = before.months.find((m) => m.month === prev2), mNow = before.months.find((m) => m.current);
const rah = before.holders.find((h) => h.id === RAH), par = before.holders.find((h) => h.id === PAR);
check('earned = each open month net x share (Rahman in all 3, Partner from last month)',
  rah.earned === Math.round((mPrev2.net + mPrev.net + mNow.net) * 0.65) && par.earned === Math.round((mPrev.net + mNow.net) * 0.30), { rah, par, months: before.months });
r = await owner('erpCapitalClose', [{ month: thisMonth }]);
check('this month cannot be closed', !r.ok && r.error === 'A month can be closed once it is over.', r);
r = await owner('erpCapitalClose', [{ month: 'x' }]);
check('which month?', !r.ok && r.error === 'Which month?', r);
r = await owner('erpCapitalClose', [{ month: prev }]);
check('a month cannot be closed while part of the profit has no owner', !r.ok && /add up to 95%, not 100%/.test(r.error), r);
await owner('erpCapitalHolderSave', [{ id: RAH, kind: 'shareholder', name: 'Rahman', pct: 70, from: prev }]);   // fix-3: from last month on
r = await owner('erpCapitalClose', [{ month: prev }]);
check('last month closed, same net kept', r.ok && r.result.months.find((m) => m.month === prev).closed && r.result.months.find((m) => m.month === prev).net === mPrev.net, r.result && r.result.months);
r = await owner('erpCapitalClose', [{ month: prev }]);
check('already closed', !r.ok && r.error === 'That month is already closed.', r);
const cl = await sql`select shares from capital_closed where business_id = ${B} and month = ${prev}`;
check('closed month keeps the shares as they stood', cl[0].shares[RAH] === 70 && cl[0].shares[PAR] === 30, cl);
r = await owner('erpCapitalHolderSave', [{ id: RAH, kind: 'shareholder', name: 'Rahman', pct: 50 }]);
const rah2 = r.result.holders.find((h) => h.id === RAH);
check('a later share change does not rewrite the closed month',
  rah2.earned === Math.round(mPrev.net * 0.70 + (mPrev2.net + mNow.net) * 0.50), { rah2, mPrev, mPrev2, mNow });

// ---- leaving and coming back ----
r = await owner('erpCapitalHolderEnd', [{ id: PAR }]);
check('has left: share is free again', r.ok && r.result.totals.pctGiven === 50 && r.result.holders.find((h) => h.id === PAR).ended === prev, r.result && r.result.totals);
await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Third', pct: 40 }]);
r = await owner('erpCapitalHolderEnd', [{ id: PAR, undo: true }]);
check('coming back cannot pass 100%', !r.ok && r.error === 'Bringing them back would make 120% in all. Lower a share first.', r);
r = await owner('erpCapital', []);
check('the refused return changed nothing', r.result.holders.find((h) => h.id === PAR).ended === prev);

// ---- private holders: counted, not listed ----
await owner('erpCapitalHolderSave', [{ id: PAR, kind: 'shareholder', name: 'Partner', pct: 30, private: true }]);
await owner('erpCapitalEntryAdd', [{ holder: PAR, type: 'invest', amount: 7000 }]);
const full = (await owner('erpCapital', [])).result;
r = await shareholder('erpCapital', []);
check('shareholder: private person hidden, told one is not listed', r.ok && r.result.canEdit === false && r.result.hidden === 1 &&
  !r.result.holders.find((h) => h.id === PAR) && !r.result.entries.find((e) => e.holder === PAR), r.result && r.result.holders.map((h) => h.name));
check('...but the totals still include them', r.result.totals.ownersCapital === full.totals.ownersCapital && full.totals.ownersCapital === 107000, [r.result.totals, full.totals]);
const other = await sql`select count(*)::int n from capital_holders where business_id = ${FIX.B2}`;
check('nothing written to another business', other[0].n === 0);

// ---- the dashboard, kept ready ----
await sql`delete from erp_dash_cache`;
r = await owner('erpBundle', [['dash']]);
check('first open: worked out, not a saved copy', r.ok && r.result.dash && !r.result.dash.saved, r.result && r.result.errors);
r = await owner('erpBundle', [['dash']]);
check('second open: the saved copy, marked', r.ok && r.result.dash.saved === true, r.result && r.result.dash && r.result.dash.saved);
r = await owner('erpBundle', [['dash'], { fresh: true }]);
check('fresh asked for: worked out again', r.ok && !r.result.dash.saved);
r = await mgr('erpBundle', [['dash']]);
check('staff never get the owner\'s saved copy', r.ok && !r.result.dash.saved && r.result.dash.hideProfit === true && !('profit' in r.result.dash), r.result && Object.keys(r.result.dash || {}));
r = await mgr('erpBundle', [['dash']]);
check('staff get their own saved copy, still without money', r.result.dash.saved === true && r.result.dash.hideProfit === true && !('profit' in r.result.dash));
await owner('erpSetTheme', ['dark']);
r = await owner('erpBundle', [['dash']]);
check('a read-only call keeps the saved copy', r.result.dash.saved === true);
await owner('erpCapitalEntryAdd', [{ holder: RAH, type: 'invest', amount: 1 }]);
r = await owner('erpBundle', [['dash']]);
check('anything that changes the books throws it away', !r.result.dash.saved);
await sql`update erp_dash_cache set day = '2000-01-01'`;
r = await owner('erpBundle', [['dash']]);
check('yesterday\'s copy is never shown', !r.result.dash.saved);

await done();
