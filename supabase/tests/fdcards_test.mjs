// The dashboard's extra cards (erpFdCards): every figure from the handler that gives it on its own screen, locked
// for people who may not open that screen, one failing card never breaks the others, nothing is written.
import { sql, FIX, owner, sales, mgr, check, done } from './harness.mjs';

const ALL = ['cashInHand', 'supplierDue', 'supplierAhead', 'preordersOpen', 'depositsHeld', 'followupsDue', 'deadStock', 'bestRoi', 'commissionDue',
  'holdingMonth', 'onTheWater', 'shipmentProfit', 'investorReturns', 'ownersCapital', 'webPending', 'returnsMonth', 'deliveryIncome', 'courierFees',
  'repairsIncome', 'netMargin', 'newCustomers'];
const before = (await sql`select (select count(*) from invoices) + (select count(*) from payments) + (select count(*) from expenses) as n`)[0].n;
let r = await owner('erpFdCards', [{ ids: ALL.concat(['nope', '<x>']), months: 3 }]);
check('the owner gets every card asked for', r.ok && ALL.every((id) => r.result.cards[id]) && !r.result.cards.nope, r.ok ? Object.keys(r.result.cards) : r);
const errs = ALL.filter((id) => r.result.cards[id].error);
check('no card fails', !errs.length, errs.map((id) => id + ': ' + r.result.cards[id].error));
check('no card is locked for the owner', ALL.every((id) => !r.result.cards[id].locked), ALL.filter((id) => r.result.cards[id].locked));
check('the list names every card for the picker', r.result.list.length === ALL.length, r.result.list.length);
const cb = await owner('erpCashBook', [{}]);
check('money in hand = the Money screen', r.result.cards.cashInHand.v === Math.round(cb.result.inHand || 0), [r.result.cards.cashInHand.v, cb.result.inHand]);
const pre = await owner('erpPreorders', [{}]);
check('deposits held = the Pre-orders screen', r.result.cards.depositsHeld.v === pre.result.totals.held, [r.result.cards.depositsHeld.v, pre.result.totals.held]);

r = await sales('erpFdCards', [{ ids: ALL }]);
const open = ALL.filter((id) => !r.result.cards[id].locked && r.result.cards[id].money);
check('sales staff: money cards from screens they cannot open are locked (no figure sent)', r.ok && ['cashInHand', 'supplierDue', 'investorReturns', 'ownersCapital', 'returnsMonth', 'netMargin']
  .every((id) => r.result.cards[id].locked && r.result.cards[id].v === undefined), r.result.cards);
check('...the picker marks them locked too', r.result.list.filter((x) => x.locked).length >= 6, r.result.list);
r = await mgr('erpFdCards', [{ ids: ['preordersOpen', 'followupsDue'] }]);
check('a manager gets the cards of their screens', r.ok && !r.result.cards.preordersOpen.locked && !r.result.cards.followupsDue.locked, r.result.cards);
const after = (await sql`select (select count(*) from invoices) + (select count(*) from payments) + (select count(*) from expenses) as n`)[0].n;
check('nothing was written', String(before) === String(after), [before, after]);
await done();
