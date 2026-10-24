// fix-2 (24 Oct 2026): the partner's odd-case report, batch 2 - profit and the month lock. Each check is a case from the
// report (H6, H8-H11, H22, M8-M13) that went wrong before and must now come out right.
import { sql, FIX, owner, mgr, makeShareholder, check, done } from './harness.mjs';
await makeShareholder();

const B = FIX.B;
const pad = (n) => String(n).padStart(2, '0');
const now = new Date(Date.now() + 6 * 3600e3);
const month = now.getUTCFullYear() + '-' + pad(now.getUTCMonth() + 1);
const shift = (m, by) => { let y = +m.slice(0, 4), mo = +m.slice(5, 7) + by; while (mo < 1) { mo += 12; y--; } while (mo > 12) { mo -= 12; y++; } return y + '-' + pad(mo); };
const prev = shift(month, -1), prev2 = shift(month, -2), prev3 = shift(month, -3);
const C = { name: 'Odd Case', phone: '01755500022' };
await sql`insert into products (business_id, sku, name, category, brand, type, cost_price, sell_price, status) values
  (${B}, 'F2-PLA', 'Fix PLA', 'Filaments', 'T', 'PLA', 0, 1350, 'Active'),
  (${B}, 'F2-PRN', 'Fix Printer', 'Printers', 'T', 'FDM', 0, 50000, 'Active'),
  (${B}, 'F2-CM', 'Fix Comm', 'Filaments', 'T', 'PLA', 0, 2700, 'Active')`;
for (const [sku, cost] of [['F2-PLA', 1000], ['F2-PRN', 40000], ['F2-CM', 2000]]) {
  const id = (await sql`select id from products where business_id = ${B} and sku = ${sku}`)[0].id;
  await sql`insert into stock_movements (business_id, product_id, kind, direction, qty, unit_price) values (${B}, ${id}, 'RECEIVE', 'IN', 20, ${cost})`;
}
const pnl = async () => (await owner('erpPnl', [{ months: 1 }])).result.months.find((x) => x.month === month);
const sell = (items, more) => owner('erpCreateInvoice', [{ customer: C, items, payMode: 'full', paymentMethod: 'Cash', ...(more || {}) }]);

// ---- H6: a free line does not turn the whole invoice upside down
let p0 = await pnl();
let r = await sell([{ sku: 'F2-PLA', qty: 1 }, { sku: 'F2-PRN', qty: 1, discEach: 50000 }]);
check('(H6) PLA 1350 + a free printer: total 1350', r.ok && Number(r.result.grandTotal ?? 1350) === 1350, r);
const FREE = r.result.invoiceNo;
let p1 = await pnl();
check('(H6) sales +1350, delivery +0, cost +41000 (the printer is a cost given away)',
  p1.sales - p0.sales === 1350 && p1.delivery - p0.delivery === 0 && p1.cost - p0.cost === 41000, [p1.sales - p0.sales, p1.delivery - p0.delivery, p1.cost - p0.cost]);
check('(H6) profit of the invoice: 1350 - 41000 = -39650', (p1.net - p0.net) === -39650, p1.net - p0.net);
r = await owner('erpReturnGoods', [{ invoiceNo: FREE, lines: [{ sku: 'F2-PLA', qty: 1, condition: 'good' }], reason: 'test', money: 'refund', method: 'Cash' }]);
check('(H6) the PLA comes back worth 1350 (not -50,650)', r.ok && Math.round(r.result.value) === 1350, r.result || r);

// ---- H22: no delivery charge below zero
r = await sell([{ sku: 'F2-PLA', qty: 1 }], { deliveryCharge: -600 });
check('(H22) a delivery charge of -600 is refused', !r.ok && /below zero/.test(r.error), r);

// ---- H9: a cancelled sale's delivery charge is not income
p0 = await pnl();
r = await sell([{ sku: 'F2-PLA', qty: 1 }], { deliveryCharge: 120 });
const CX = r.result.invoiceNo;
p1 = await pnl();
check('(H9) the sale brings 120 of delivery', p1.delivery - p0.delivery === 120, p1.delivery - p0.delivery);
r = await owner('erpCancelInvoice', [{ invoiceNo: CX, reason: 'customer changed mind', money: 'refund', method: 'Cash' }]);
const p2 = await pnl();
check('(H9) cancelled: the delivery and the profit are back where they were', r.ok && p2.delivery === p0.delivery && p2.net === p0.net, [r.error, p2.delivery - p0.delivery, p2.net - p0.net]);
r = await owner('erpPnlMonth', [{ month }]);
check('(H9) the month\'s list says the same delivery', r.ok && r.result.totals.delivery === p2.delivery, [r.result && r.result.totals.delivery, p2.delivery]);

// ---- H10: the invoice discount is taken off the commission once
await owner('erpCommissionRuleSave', [{ scope: 'all', basis: 'sales', pct: 10 }]);
const comm = async () => (await owner('erpCommission', [{ month }])).result.total;
const c0 = await comm();
r = await sell([{ sku: 'F2-CM', qty: 1 }], { invoiceDiscount: 200 });
const CM = r.result.invoiceNo;
const c1 = await comm();
check('(H10) 2700 - 200 = 2500 sold: 10% = 250 (not 230)', c1 - c0 === 250, c1 - c0);
r = await owner('erpReturnGoods', [{ invoiceNo: CM, lines: [{ sku: 'F2-CM', qty: 1, condition: 'good' }], reason: 'test', money: 'refund', method: 'Cash' }]);
check('(H10) all of it back: the commission is back to where it was (not -20)', r.ok && (await comm()) === c0, (await comm()) - c0);

// ---- H11: commission paid stays a cost when its rule is struck out the same month
r = await sell([{ sku: 'F2-CM', qty: 1 }]);
const earned = await comm();
r = await owner('erpCommission', [{ month }]);
const me = r.result.sellers[0];
r = await owner('erpCommissionPay', [{ seller: me.id, amount: me.left, month }]);
check('(H11) the seller is paid what is left', r.ok, r);
const rid = (await sql`select id from commission_rules where business_id = ${B} and voided_at is null`)[0].id;
r = await owner('erpCommissionRuleVoid', [{ id: rid, month }]);
check('(H11) the rule is struck out, but this month still carries the commission that was paid', r.ok && (await comm()) === earned, [r.error, await comm(), earned]);

// ---- M8: two cash-ups at the same moment do not book the shortfall twice
await owner('erpCashSetup', [{ accounts: [{ name: 'Cash', kind: 'cash' }, { name: 'Bank', kind: 'bank' }] }]);
const book = await owner('erpCashBook', [{}]);
const cash = book.result.accounts.find((a) => a.name === 'Cash');
const [u1, u2] = await Promise.all([owner('erpCashUp', [{ account: cash.id, counted: cash.balance - 50, note: 'short' }]),
                                    owner('erpCashUp', [{ account: cash.id, counted: cash.balance - 50, note: 'short' }])]);
const after = (await owner('erpCashBook', [{}])).result.accounts.find((a) => a.name === 'Cash').balance;
check('(M8) two cash-ups of the same 50 short: the book goes down 50, not 100', u1.ok && u2.ok && Math.round(after) === Math.round(cash.balance - 50), [u1.error, u2.error, after - cash.balance]);

// ---- M9: after a full return and refund, "Increase the due" has nothing to take back
r = await sell([{ sku: 'F2-PLA', qty: 1 }]);
const RT = r.result.invoiceNo;
await owner('erpReturnGoods', [{ invoiceNo: RT, lines: [{ sku: 'F2-PLA', qty: 1, condition: 'good' }], reason: 'test', money: 'refund', method: 'Cash' }]);
r = await owner('erpSettleDue', [{ orderId: RT, amount: 1350, reason: 'increase', note: 'by mistake' }]);
check('(M9) "Increase the due" on a fully returned and refunded sale is refused', !r.ok, r);

// ---- M13: a voided invoice is kept as a copy
r = await sell([{ sku: 'F2-PLA', qty: 1 }], { payMode: 'none' });
const VD = r.result.invoiceNo;
r = await owner('erpVoidInvoice', [VD]);
const kept = await sql`select invoice_no, jsonb_array_length(lines) as n, jsonb_array_length(movements) as m from voided_invoices where business_id = ${B}`;
check('(M13) the voided invoice is kept: its head, its line and its stock movement', r.ok && kept.length === 1 && kept[0].invoice_no === VD && kept[0].n === 1 && kept[0].m === 1, kept);

// ---- the month lock: H8, M10, M11, M12
await owner('erpCapitalHolderSave', [{ kind: 'shareholder', name: 'Rahman', pct: 100, since: prev3 }]);
const RAH = (await owner('erpCapital', [])).result.holders.find((h) => h.name === 'Rahman').id;
r = await owner('erpExpenseItemSave', [{ kind: 'fixed', name: 'Shop rent', amount: 10000, fromMonth: prev, category: 'Rent' }]);
const rent = (await sql`select item_no from expense_items where business_id = ${B} and name = 'Shop rent'`)[0].item_no;
r = await owner('erpExpenseFixedPay', [{ id: rent, month: prev }]);
check('rent paid for last month', r.ok, r);
await sql`insert into capital_book (business_id, entry_no, recorded_at, on_date, holder_no, type, amount, month, by) values (${B}, 'C-F2', now(), ${prev + '-20T12:00:00+06:00'}, ${RAH}, 'profit', 1000, ${prev}, 'Owner')`;   // a loss month: written straight in (fix-3 M16 caps payouts)
await sql`insert into payments (business_id, payment_no, invoice_no, customer, paid_at, amount, method, account_id)
          values (${B}, 'P-OLD', '', 'x', ${prev + '-10T12:00:00+06:00'}, 500, 'Cash', ${cash.id})`;
r = await owner('erpCapitalClose', [{ month: prev3 }]);
check('first close: ' + prev3, r.ok, r);
r = await owner('erpCapitalClose', [{ month: prev }]);
check('(M10) closing ' + prev + ' while ' + prev2 + ' is open is refused: months close in order', !r.ok && /in order/.test(r.error), r);
r = await owner('erpCapitalClose', [{ month: prev2 }]);
r = await owner('erpCapitalClose', [{ month: prev }]);
check('in order: both close', r.ok, r);
r = await owner('erpExpenseItemEnd', [{ id: rent, fromMonth: prev }]);
check('(H8) stopping the rent from the closed month is refused (its paid rent would be struck out)', !r.ok && /closed/.test(r.error), r);
const rentRow = await sql`select voided from expenses where business_id = ${B} and item_no = ${rent} and month = ${prev}`;
check('(H8) the closed month\'s rent stays', rentRow.length === 1 && !rentRow[0].voided, rentRow);
r = await owner('erpExpenseItemSave', [{ id: rent, kind: 'fixed', name: 'Shop rent', amount: 12000, fromMonth: prev }]);
check('(H8) changing its amount from the closed month is refused too', !r.ok && /closed/.test(r.error), r);
r = await owner('erpExpenseItemEnd', [{ id: rent, fromMonth: month }]);
check('(H8) stopping it from this month is fine', r.ok, r);
r = await owner('erpCashAccountSave', [{ name: 'Old safe', kind: 'cash', opening: 99999, openingDate: prev + '-01' }]);
check('(M11) a new account with an opening balance inside a closed month is refused', !r.ok && /closed/.test(r.error), r);
r = await owner('erpCashAccountSave', [{ name: 'Old safe', kind: 'cash', opening: 99999, openingDate: month + '-01' }]);
check('(M11) ...dated in the open month it is fine', r.ok, r);
r = await owner('erpCashAccountSave', [{ id: cash.id, name: 'Cash', kind: 'cash', opening: 99999 }]);
check('(M11) giving Cash an opening balance from the start (closed months) is refused', !r.ok && /closed/.test(r.error), r);
const bank = book.result.accounts.find((a) => a.name === 'Bank');
const old = (await sql`select id from payments where business_id = ${B} and payment_no = 'P-OLD'`)[0].id;
r = await owner('erpCashReassign', [{ src: 'payment', id: old, account: bank.id }]);
const stays = (await sql`select account_id from payments where id = ${old}`)[0].account_id;
check('(M11) moving a closed month\'s payment to another account is refused (and nothing moves)', !r.ok && /closed/.test(r.error) && stays === cash.id, [r.error, stays]);
r = await owner('erpCapitalReopen', [{ month: prev, reason: 'a bill came late' }]);
check('(M12) reopening a month whose profit was handed over is asked first', !r.ok && /^CONFIRM: 1000 /.test(r.error), r);
r = await owner('erpCapitalReopen', [{ month: prev, reason: 'a bill came late', again: true }]);
const rec = await sql`select month, reason, paid_out::float as p, closed_by from capital_reopens where business_id = ${B}`;
check('(M12) reopened, and the closing is kept on record with the reason', r.ok && rec.length === 1 && rec[0].month === prev && rec[0].reason === 'a bill came late' && rec[0].p === 1000, rec);

const other = await sql`select count(*)::int as n from voided_invoices where business_id = ${FIX.B2}`;
check('the other business is untouched', other[0].n === 0, other);
await done();
