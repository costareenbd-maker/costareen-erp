// Expenses (ERP.js:6565-7109): fixed, recurring and one-off expenses, the
// month's gross beside them, and the month as an Excel file.
//
// The sheet tabs EXPENSES and EXPENSE_ITEMS are the tables `expenses` and
// `expense_items`; the ids the original minted (E…, F…, R…) are kept in
// expense_no / item_no and are what the page sends back. Nothing is deleted:
// a wrong entry is struck out with a reason (column `voided`).

import { asDate, str } from '../lib/tabs.js';
import { formatDate, num } from '../lib/time.js';
import { getConfig, setConfig, saveFile, deleteFile, fileUrl } from '../lib/ext.js';
import { who } from './money.js';
import { monthGross, monthNet } from './dashboard.js';
import { expenseAccount, cashRules } from './cash.js';
import { returnsFor, isReturnPaid } from './returns.js';
import { assertOpen, lockedThrough } from '../lib/period.js';

/** Each section offers only the categories that belong in it (ERP.js:6573). */
export const ERP_EXP_CATS = {
  fixed: ['Rent', 'Salaries & wages', 'Wi-Fi bill',
    'Software & subscriptions', 'Loan instalment'],
  recurring: ['Utilities', 'SIM card bill', 'Marketing & advertising',
    'Transport & delivery', 'Packaging', 'Bank & platform fees'],
  oneoff: ['Repairs & maintenance', 'Equipment', 'Office supplies',
    'Professional fees', 'Salaries & wages', 'Marketing & advertising',
    'Miscellaneous'],
};

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];

// ------------------------------------------------------------------ months

/** erpMonthOf_: a month as text the sheet can sort, 2026-09 (Dhaka). */
function monthOf(d) { return formatDate(d, 'yyyy-MM'); }

/** erpIsMonth_ */
function isMonth(m) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(m || '')); }

/** erpMonthShift_ */
function monthShift(m, by) {
  let y = Number(m.slice(0, 4)), mo = Number(m.slice(5, 7)) + by;
  while (mo < 1) { mo += 12; y--; }
  while (mo > 12) { mo -= 12; y++; }
  return y + '-' + (mo < 10 ? '0' + mo : '' + mo);
}

/** erpMonthText_ */
function monthText(v) {
  if (v instanceof Date) return isNaN(v.getTime()) ? '' : monthOf(v);
  return String(v || '').trim();
}

/** erpExpNewId_: tag + yyMMddHHmmss + '-' + 3 random digits. */
function newId(tag) {
  return tag + formatDate(new Date(), 'yyMMddHHmmss') + '-' + Math.floor(Math.random() * 900 + 100);
}

// ------------------------------------------------------------------- reads

/** erpExpItems_: every fixed and recurring item ever set up, ended ones included. */
async function expItems(ctx) {
  const v = await ctx.tx`
    select item_no, kind, name, category, amount, from_month, to_month, note, id
    from expense_items where business_id = ${ctx.biz} order by seq`;
  const out = [];
  for (const r of v) {
    const id = str(r.item_no);
    if (!id) continue;
    out.push({ id, kind: str(r.kind) || 'fixed', name: str(r.name),
               category: str(r.category) || 'Miscellaneous', amount: num(r.amount),
               from: monthText(r.from_month), to: monthText(r.to_month),
               note: str(r.note), row: r.id });
  }
  return out;
}

/** erpItemActive_ */
function itemActive(it, month) {
  if (it.from && month < it.from) return false;
  if (it.to && month > it.to) return false;
  return true;
}

function expRow(r) {
  const d = asDate(r.recorded_at);
  return { id: str(r.expense_no),
           when: d ? formatDate(d, 'd MMM, h:mm a') : '',
           ts: d ? d.getTime() : 0,
           kind: str(r.kind),
           category: str(r.category) || 'Miscellaneous',
           description: str(r.description),
           amount: num(r.amount),
           itemId: str(r.item_no),
           by: str(r.recorded_by), receipt: !!str(r.receipt),
           voided: str(r.voided), row: Number(r.seq) };
}

/** erpExpRows_: everything recorded for one month, struck-out rows included. */
async function expRows(ctx, month) {
  const v = await ctx.tx`
    select expense_no, recorded_at, month, kind, category, description, amount, item_no,
           recorded_by, voided, seq, receipt
    from expenses where business_id = ${ctx.biz} and btrim(month) = ${month}
    order by seq`;
  return v.map(expRow);
}

/** erpExpWrite_: append one EXPENSES row. */
async function expWrite(ctx, row) {
  const [id, at, month, kind, category, description, amount, itemId, by, voided, account] = row;
  await assertOpen(ctx, month, 'an expense cannot be written into it');
  await ctx.tx`
    insert into expenses (business_id, expense_no, recorded_at, month, kind, category,
                          description, amount, item_no, recorded_by, voided, account_id)
    values (${ctx.biz}, ${id}, ${at}, ${month}, ${kind}, ${category}, ${description},
            ${amount}, ${itemId || null}, ${by}, ${voided || null}, ${await expenseAccount(ctx, account)})`;
}

async function setVoided(ctx, seq, text) {
  await ctx.tx`update expenses set voided = ${text} where business_id = ${ctx.biz} and seq = ${seq}`;
}

// ----------------------------------------------------------- month's gross

// erpMonthGross_ (ERP.js:6716) lives in dashboard.js (one cost rule for the
// Dashboard, Profit and Expenses screens); re-exported here under the name
// the porting brief asked for.
export { monthGross };

/** The accounts an expense can be paid from (plan A3); empty until the owner has set accounts up. */
async function paidFrom(ctx) {
  try {
    return (await ctx.tx.savepoint(() => ctx.tx`select id, name from money_accounts where business_id = ${ctx.biz} and not archived and kind <> 'courier'
                                               order by sort_order, created_at`)).map((a) => ({ id: a.id, name: str(a.name) }));
  } catch (_) { return []; }
}

// ------------------------------------------------------------------ screen

/** erpExpenses (ERP.js:6756): one month, in its three sections, with what was earned beside it. */
export async function erpExpenses(ctx, payload) {
  payload = payload || {};
  const nowMonth = monthOf(ctx.now);
  const month = isMonth(payload.month) ? payload.month : nowMonth;

  // plan A6: a return paid to an investor is not this month's cost; what fell due this month is
  const rows = (await expRows(ctx, month)).filter((r) => !isReturnPaid(r.category, r.description));
  const investorReturns = await returnsFor(ctx, month);
  const items = (await expItems(ctx)).filter((it) => itemActive(it, month));

  const entered = {};
  for (const r of rows) {
    if (r.kind === 'recurring' && r.itemId && !r.voided) entered[r.itemId] = r;
  }
  const paidFixed = {};
  for (const r of rows) {
    if (r.kind === 'fixed' && r.itemId && !r.voided) paidFixed[r.itemId] = r;
  }
  const fixedItems = [], recurringItems = [];
  let missing = 0, fixedUnpaid = 0;
  for (const it of items) {
    if (it.kind === 'recurring') {
      const e = entered[it.id] || null;
      if (!e && month <= nowMonth) missing++;
      recurringItems.push({ id: it.id, no: recurringItems.length + 1, name: it.name,
                            category: it.category, since: it.from,
                            amount: e ? e.amount : null, when: e ? e.when : '' });
    } else {
      const pd = paidFixed[it.id] || null;
      fixedItems.push({ id: it.id, no: fixedItems.length + 1, name: it.name,
                        category: it.category, amount: pd ? pd.amount : it.amount, since: it.from,
                        paid: !!pd, paidWhen: pd ? pd.when : '', paidBy: pd ? pd.by : '' });
      if (!pd && month <= nowMonth) fixedUnpaid += it.amount;
    }
  }

  const sums = { fixed: 0, recurring: 0, oneoff: 0 }, byCat = {}, catOrder = [];
  for (const r of rows) {
    if (r.voided) continue;
    const kind = Object.prototype.hasOwnProperty.call(sums, r.kind) ? r.kind : 'oneoff';
    sums[kind] += r.amount;
    if (!(r.category in byCat)) { byCat[r.category] = 0; catOrder.push(r.category); }
    byCat[r.category] += r.amount;
  }
  if (investorReturns > 0) { if (!('Investor returns' in byCat)) { byCat['Investor returns'] = 0; catOrder.push('Investor returns'); } byCat['Investor returns'] += investorReturns; }
  const cats = catOrder.map((c) => ({ name: c, amount: Math.round(byCat[c]) }));
  cats.sort((a, b) => b.amount - a.amount);

  const all = rows.slice().sort((a, b) => b.ts - a.ts);
  const oneoff = all.filter((x) => x.kind === 'oneoff');

  // plan A2: what the month earned, exactly as the Profitability screen has it
  const g = await monthNet(ctx, month);
  const other = g.delivery + g.courierExtra - g.courierShort - g.courier;
  const total = Math.round(sums.fixed + sums.recurring + sums.oneoff + investorReturns);
  const p = month.split('-');
  return {
    month, label: MONTH_NAMES[Number(p[1]) - 1] + ' ' + p[0],
    isCurrent: month === nowMonth, isFuture: month > nowMonth,
    fixedItems, recurringItems, oneoff,
    all, missing, categories: await expCats(ctx),
    accounts: await paidFrom(ctx), accountDefault: (await cashRules(ctx)).expense || '',
    byCategory: cats,
    fixed: Math.round(sums.fixed), fixedPaid: Math.round(sums.fixed),
    fixedUnpaid: Math.round(fixedUnpaid), recurring: Math.round(sums.recurring),
    oneoffTotal: Math.round(sums.oneoff), total, investorReturns, lockedThrough: await lockedThrough(ctx),
    revenue: g.netSales, goodsCost: g.cost, gross: g.gross,
    delivery: g.delivery, courier: g.courier, courierExtra: g.courierExtra, courierShort: g.courierShort, other,
    net: g.gross + other - total,
    netAfterUnpaid: g.gross + other - total - Math.round(fixedUnpaid),
  };
}

// ------------------------------------------------------------------ writes

/** erpExpenseAdd (ERP.js:6847): a one-off expense in the month being looked at. */
export async function erpExpenseAdd(ctx, payload) {
  payload = payload || {};
  const amount = num(payload.amount);
  if (!(amount > 0)) throw new Error('How much was spent?');
  const what = str(payload.description);
  if (!what) throw new Error('What was it for? A few words is enough.');
  const nowMonth = monthOf(ctx.now);
  const month = isMonth(payload.month) ? payload.month : nowMonth;
  if (month > nowMonth) throw new Error('That month has not begun yet.');

  await expWrite(ctx, [newId('E'), new Date(), month, 'oneoff',
    str(payload.category) || 'Miscellaneous', what,
    Math.round(amount * 100) / 100, '', who(ctx), '', payload.account]);
  return erpExpenses(ctx, { month });
}

/** erpExpenseRecurringSet (ERP.js:6870): this month's figure for a recurring bill. */
export async function erpExpenseRecurringSet(ctx, payload) {
  payload = payload || {};
  const id = str(payload.itemId);
  const amount = num(payload.amount);
  if (!id) throw new Error('Which bill?');
  if (!(amount > 0)) throw new Error('How much was the bill this month?');
  const nowMonth = monthOf(ctx.now);
  const month = isMonth(payload.month) ? payload.month : nowMonth;
  if (month > nowMonth) throw new Error('That month has not begun yet.');

  let it = null;
  for (const x of await expItems(ctx)) if (x.id === id) it = x;
  if (!it || it.kind !== 'recurring') throw new Error('That recurring bill was not found.');
  if (!itemActive(it, month)) throw new Error(it.name + ' does not apply in that month.');
  await assertOpen(ctx, month, 'its bills cannot be changed');

  for (const r of await expRows(ctx, month)) {
    if (r.itemId === id && !r.voided) {
      await setVoided(ctx, r.row, 'replaced ' + formatDate(new Date(), 'd MMM yy') +
        ' by ' + who(ctx) + ': was ' + r.amount);
    }
  }
  await expWrite(ctx, [newId('E'), new Date(), month, 'recurring', it.category, it.name,
    Math.round(amount * 100) / 100, it.id, who(ctx), '', payload && payload.account]);
  return erpExpenses(ctx, { month });
}

/** erpExpenseFixedPay (ERP.js:6684): a fixed expense has been paid (or was not after all). */
export async function erpExpenseFixedPay(ctx, payload) {
  payload = payload || {};
  const id = str(payload.id);
  const nowMonth = monthOf(ctx.now);
  const month = isMonth(payload.month) ? payload.month : nowMonth;
  if (month > nowMonth) throw new Error('That month has not begun yet.');
  await assertOpen(ctx, month, 'its fixed expenses cannot be changed');
  let it = null;
  for (const x of await expItems(ctx)) if (x.id === id) it = x;
  if (!it || it.kind !== 'fixed' || !itemActive(it, month)) {
    throw new Error('That fixed expense is not on the list for this month.');
  }
  let paid = null;
  for (const r of await expRows(ctx, month)) {
    if (r.kind === 'fixed' && r.itemId === id && !r.voided) paid = r;
  }
  if (payload.undo) {
    if (!paid) throw new Error('It is not marked as paid.');
    await setVoided(ctx, paid.row, 'struck out ' + formatDate(new Date(), 'd MMM yy') +
      ' by ' + who(ctx) + ': marked paid by mistake');
    return erpExpenses(ctx, { month });
  }
  if (paid) throw new Error(it.name + ' is already marked as paid for this month.');
  await expWrite(ctx, [newId('E'), new Date(), month, 'fixed', it.category, it.name, it.amount,
    it.id, who(ctx), '', payload && payload.account]);
  return erpExpenses(ctx, { month });
}

/** erpExpenseVoid (ERP.js:6904, owner): strike an entry out. It is marked, not removed. */
export async function erpExpenseVoid(ctx, payload) {
  const id = str(payload && payload.id);
  const why = str(payload && payload.reason);
  if (!id) throw new Error('Which entry?');
  if (!why) throw new Error('Say why it is being struck out, so the books can be read later.');

  const v = await ctx.tx`select expense_no, month, kind, voided, seq from expenses
                         where business_id = ${ctx.biz} order by seq`;
  if (!v.length) throw new Error('There is nothing recorded yet.');
  for (const r of v) {
    if (str(r.expense_no) !== id) continue;
    if (str(r.voided)) throw new Error('That entry is already struck out.');
    await assertOpen(ctx, monthText(r.month), 'its expenses cannot be struck out');
    if (str(r.kind) === 'fixed') {
      throw new Error('A fixed expense is changed or stopped from its own line, not struck out.');
    }
    await setVoided(ctx, Number(r.seq), 'struck out ' + formatDate(new Date(), 'd MMM yy') +
      ' by ' + who(ctx) + ': ' + why);
    return erpExpenses(ctx, { month: monthText(r.month) });
  }
  throw new Error('That entry was not found.');
}

/** erpStrikePosted_: strike out what a fixed item posted from a month onward. */
async function strikePosted(ctx, itemId, from, why) {
  const v = await ctx.tx`select item_no, kind, month, voided, seq from expenses
                         where business_id = ${ctx.biz} order by seq`;
  for (const r of v) {
    if (str(r.item_no) !== itemId) continue;
    if (str(r.kind) !== 'fixed') continue;
    if (monthText(r.month) < from) continue;
    if (str(r.voided)) continue;
    await setVoided(ctx, Number(r.seq), 'struck out: ' + why);
  }
}

/**
 * erpExpenseItemSave (ERP.js:6936): set up a fixed or recurring item, or
 * change what a fixed one costs. A change is never an edit: the old amount is
 * closed off at the month before the new one begins.
 */
export async function erpExpenseItemSave(ctx, payload) {
  payload = payload || {};
  const kind = String(payload.kind || 'fixed') === 'recurring' ? 'recurring' : 'fixed';
  const name = str(payload.name);
  const amount = num(payload.amount);
  const nowMonth = monthOf(ctx.now);
  const from = isMonth(payload.fromMonth) ? payload.fromMonth : nowMonth;
  const cat = str(payload.category) || 'Miscellaneous';
  if (!name) throw new Error('What is this expense called?');
  if (kind === 'fixed' && !(amount > 0)) throw new Error('How much is it each month?');

  const list = await expItems(ctx);
  const changing = str(payload.id);

  if (changing) {
    let old = null;
    for (const x of list) if (x.id === changing) old = x;
    if (!old) throw new Error('That item was not found.');
    if (old.kind !== 'fixed') throw new Error('Only a fixed expense has a set amount to change.');
    if (old.from && from <= old.from) {
      // never ran a month at the old figure
      await ctx.tx`update expense_items set amount = ${amount} where id = ${old.row}`;
    } else {
      await ctx.tx`update expense_items set to_month = ${monthShift(from, -1)} where id = ${old.row}`;
      await ctx.tx`
        insert into expense_items (business_id, item_no, kind, name, category, amount,
                                   from_month, to_month, note, set_by)
        values (${ctx.biz}, ${newId('F')}, 'fixed', ${old.name}, ${old.category}, ${amount},
                ${from}, null, ${'was ' + old.amount}, ${who(ctx)})`;
    }
    await strikePosted(ctx, changing, from, 'the amount was changed from ' + from);
  } else {
    for (const d of list) {
      if (d.kind === kind && !d.to && d.name.toLowerCase() === name.toLowerCase()) {
        throw new Error('"' + name + '" is already on the list.');
      }
    }
    const nid = newId(kind === 'fixed' ? 'F' : 'R');
    await ctx.tx`
      insert into expense_items (business_id, item_no, kind, name, category, amount,
                                 from_month, to_month, note, set_by)
      values (${ctx.biz}, ${nid}, ${kind}, ${name}, ${cat}, ${kind === 'fixed' ? amount : null},
              ${from}, null, null, ${who(ctx)})`;
    // a recurring bill may be set up with this month's figure already in hand
    if (kind === 'recurring' && amount > 0 && from <= nowMonth) {
      await expWrite(ctx, [newId('E'), new Date(), from, 'recurring', cat, name,
        Math.round(amount * 100) / 100, nid, who(ctx), '']);
    }
  }
  return erpExpenses(ctx, { month: isMonth(payload.viewMonth) ? payload.viewMonth : from });
}

/** erpExpenseItemEnd (ERP.js:7000): stop an item. Months it already covered are untouched. */
export async function erpExpenseItemEnd(ctx, payload) {
  const id = str(payload && payload.id);
  const nowMonth = monthOf(ctx.now);
  const first = isMonth(payload && payload.fromMonth) ? payload.fromMonth : nowMonth;
  for (const it of await expItems(ctx)) {
    if (it.id !== id) continue;
    await ctx.tx`update expense_items set to_month = ${monthShift(first, -1)} where id = ${it.row}`;
    if (it.kind === 'fixed') await strikePosted(ctx, id, first, 'the expense was stopped from ' + first);
    return erpExpenses(ctx, { month: first });
  }
  throw new Error('That item was not found.');
}

// ------------------------------------------------------------------ export

/**
 * erpExpenseExport (ERP.js:7020): the month as an Excel file, kept in the
 * 'exports' folder (was Drive's Costareen_Expenses) as well as handed over.
 */
export async function erpExpenseExport(ctx, payload) {
  const e = await erpExpenses(ctx, payload);
  let biz = '';
  try { biz = str(ctx.s && ctx.s.businessName) || str(await getConfig(ctx, 'business_name', '')); } catch (_) { /* as original */ }

  const summary = [
    [biz + ' - expenses', ''], [e.label, ''], ['', ''],
    ['Sold (after discounts)', e.revenue],
    ['The goods cost', e.goodsCost],
    ['Gross profit', e.gross],
    ['Delivery charged to customers', e.delivery],
    ['Courier: delivery + COD fee', -e.courier],
    ['Courier collected more / less', e.courierExtra - e.courierShort], ['', ''],
    ['Fixed expenses', e.fixed],
    ['Recurring expenses', e.recurring],
    ['One-off expenses', e.oneoffTotal],
    ['Total expenses', e.total], ['', ''],
    ['NET PROFIT', e.net], ['', ''], ['By category', ''],
  ];
  for (const c of e.byCategory) summary.push([c.name, c.amount]);
  if (e.missing) {
    summary.push(['', '']);
    summary.push([e.missing + ' recurring bill(s) had no figure entered', '']);
  }
  const rows = [['Recorded', 'Kind', 'Category', 'What for', 'Amount', 'Recorded by', 'Struck out']];
  for (const x of e.all.slice().reverse()) {
    rows.push([x.when, x.kind === 'oneoff' ? 'one-off' : x.kind, x.category,
      x.description, x.amount, x.by, x.voided]);
  }

  const bytes = buildXlsx([
    { name: 'Summary', rows: summary, widthsPx: [280, 130],
      style: (r, c) => (r === 0 && c === 0 ? 'title' : (summary[r] && summary[r][0] === 'NET PROFIT') ? 'bold' : '') },
    { name: 'Entries', rows, frozenRows: 1, style: (r) => (r === 0 ? 'bold' : '') },
  ]);

  const name = (biz || 'Expenses') + ' expenses ' + e.month + '.xlsx';
  await deleteFile(ctx, 'exports', name);             // older same-name copies go
  const file = await saveFile(ctx, 'exports', name, bytes,
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  return { ok: true, name, id: file.id, url: file.url, month: e.month };
}

// --------------------------------------------------- a small .xlsx writer
// Pure JS (Deno and Node): an OOXML workbook in a zip with no compression.

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

/** A zip archive (stored, no compression) of [{ name, data: Uint8Array }]. */
export function zipStore(files, when = new Date()) {
  const enc = new TextEncoder();
  const dosTime = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, when.getFullYear()) - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const parts = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const data = f.data;
    const crc = crc32(data);
    const head = new Uint8Array(30 + name.length);
    const h = new DataView(head.buffer);
    h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint16(6, 0x0800, true);
    h.setUint16(8, 0, true); h.setUint16(10, dosTime, true); h.setUint16(12, dosDate, true);
    h.setUint32(14, crc, true); h.setUint32(18, data.length, true); h.setUint32(22, data.length, true);
    h.setUint16(26, name.length, true); h.setUint16(28, 0, true);
    head.set(name, 30);
    const cd = new Uint8Array(46 + name.length);
    const c = new DataView(cd.buffer);
    c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true);
    c.setUint16(8, 0x0800, true); c.setUint16(10, 0, true); c.setUint16(12, dosTime, true);
    c.setUint16(14, dosDate, true); c.setUint32(16, crc, true); c.setUint32(20, data.length, true);
    c.setUint32(24, data.length, true); c.setUint16(28, name.length, true);
    c.setUint32(42, offset, true);
    cd.set(name, 46);
    parts.push(head, data);
    central.push(cd);
    offset += head.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new Uint8Array(22);
  const e = new DataView(end.buffer);
  e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
  e.setUint32(12, cdSize, true); e.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let at = 0;
  for (const p of all) { out.set(p, at); at += p.length; }
  return out;
}

function xmlEsc(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function colName(i) {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

const STYLE_ID = { '': 0, bold: 1, title: 2 };

function sheetXml(sh) {
  const out = ['<?xml version="1.0" encoding="UTF-8" standalone="yes"?>',
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'];
  if (sh.frozenRows) {
    const top = 'A' + (sh.frozenRows + 1);
    out.push('<sheetViews><sheetView workbookViewId="0"><pane ySplit="' + sh.frozenRows +
      '" topLeftCell="' + top + '" activePane="bottomLeft" state="frozen"/>' +
      '<selection pane="bottomLeft" activeCell="' + top + '" sqref="' + top + '"/></sheetView></sheetViews>');
  }
  if (sh.widthsPx) {
    // Excel widths are in characters of the default font (about 7 px each)
    out.push('<cols>' + sh.widthsPx.map((px, i) =>
      '<col min="' + (i + 1) + '" max="' + (i + 1) + '" width="' + (Math.round((px - 5) / 7 * 100 + 0.5) / 100) +
      '" customWidth="1"/>').join('') + '</cols>');
  }
  out.push('<sheetData>');
  sh.rows.forEach((row, r) => {
    const cells = [];
    row.forEach((v, c) => {
      const ref = colName(c) + (r + 1);
      const st = STYLE_ID[(sh.style && sh.style(r, c)) || ''] || 0;
      const s = st ? ' s="' + st + '"' : '';
      if (typeof v === 'number' && isFinite(v)) {
        cells.push('<c r="' + ref + '"' + s + '><v>' + v + '</v></c>');
      } else if (v !== null && v !== undefined && String(v) !== '') {
        cells.push('<c r="' + ref + '"' + s + ' t="inlineStr"><is><t xml:space="preserve">' +
          xmlEsc(v) + '</t></is></c>');
      } else if (st) {
        cells.push('<c r="' + ref + '"' + s + '/>');
      }
    });
    out.push('<row r="' + (r + 1) + '">' + cells.join('') + '</row>');
  });
  out.push('</sheetData></worksheet>');
  return out.join('');
}

/**
 * sheets: [{ name, rows: [[string|number]], widthsPx?, frozenRows?,
 *            style?: (rowIdx, colIdx) => '' | 'bold' | 'title' }]
 * Returns the .xlsx file as a Uint8Array.
 */
export function buildXlsx(sheets) {
  const enc = new TextEncoder();
  const X = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  const files = [];
  const add = (name, text) => files.push({ name, data: enc.encode(text) });
  add('[Content_Types].xml', X +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
    '<Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
    '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
    sheets.map((s, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) +
      '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') +
    '</Types>');
  add('_rels/.rels', X +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
    '</Relationships>');
  add('xl/workbook.xml', X +
    '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" ' +
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
    sheets.map((s, i) => '<sheet name="' + xmlEsc(s.name) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') +
    '</sheets></workbook>');
  add('xl/_rels/workbook.xml.rels', X +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    sheets.map((s, i) => '<Relationship Id="rId' + (i + 1) +
      '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' +
      (i + 1) + '.xml"/>').join('') +
    '<Relationship Id="rId' + (sheets.length + 1) +
    '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '</Relationships>');
  add('xl/styles.xml', X +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<fonts count="3"><font><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="11"/><name val="Calibri"/></font>' +
    '<font><b/><sz val="14"/><name val="Calibri"/></font></fonts>' +
    '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>' +
    '<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="3"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>' +
    '<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>' +
    '<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '</styleSheet>');
  sheets.forEach((s, i) => add('xl/worksheets/sheet' + (i + 1) + '.xml', sheetXml(s)));
  return zipStore(files);
}


// --------------------------------------------- redesign phase 4: own lists

/** The category lists of this business: its own where it has changed them, the standard ones otherwise. */
export async function expCats(ctx) {
  let own = null;
  try { own = JSON.parse(await getConfig(ctx, 'expense_categories', '') || 'null'); } catch (_) { own = null; }
  const out = {};
  for (const k of Object.keys(ERP_EXP_CATS)) {
    out[k] = own && Array.isArray(own[k]) && own[k].length ? own[k].map(str).filter(Boolean) : ERP_EXP_CATS[k].slice();
  }
  return out;
}

/** Add a category to a section's list, or take one off. Entries already written keep their category. */
export async function erpExpenseCategory(ctx, payload) {
  payload = payload || {};
  const kind = str(payload.kind);
  if (!ERP_EXP_CATS[kind]) throw new Error('Which list?');
  const cats = await expCats(ctx);
  const add = str(payload.add), remove = str(payload.remove);
  if (add) {
    if (add.length > 40) throw new Error('Keep the name under 40 letters.');
    if (cats[kind].some((c) => c.toLowerCase() === add.toLowerCase())) throw new Error('"' + add + '" is already in that list.');
    cats[kind].push(add);
  } else if (remove) {
    const left = cats[kind].filter((c) => c.toLowerCase() !== remove.toLowerCase());
    if (left.length === cats[kind].length) throw new Error('"' + remove + '" is not in that list.');
    if (!left.length) throw new Error('A list needs at least one category.');
    cats[kind] = left;
  } else throw new Error('Type a category name first.');
  await setConfig(ctx, 'expense_categories', JSON.stringify(cats));
  return erpExpenses(ctx, { month: payload.month });
}

const RECEIPT_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'application/pdf': 'pdf' };

/** Keep a photo (or PDF) of the receipt with an expense. payload: {id, month, file:{data, mime}} */
export async function erpExpenseReceipt(ctx, payload) {
  payload = payload || {};
  const id = str(payload.id);
  if (!id) throw new Error('Which entry?');
  const row = (await ctx.tx`select seq, month, receipt from expenses where business_id = ${ctx.biz} and expense_no = ${id} limit 1`)[0];
  if (!row) throw new Error('That entry was not found.');
  const f = payload.file || {};
  const ext = RECEIPT_TYPES[str(f.mime)];
  if (!ext) throw new Error('A receipt is a photo (JPG, PNG) or a PDF.');
  let bytes;
  try {
    const bin = atob(String(f.data || ''));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (_) { throw new Error('That file could not be read. Try again.'); }
  if (!bytes.length) throw new Error('That file is empty.');
  if (bytes.length > 3 * 1024 * 1024) throw new Error('That file is over 3 MB. Use a smaller photo.');
  const name = id + '-' + Date.now() + '.' + ext;
  if (str(row.receipt)) await deleteFile(ctx, 'receipts', str(row.receipt));
  await saveFile(ctx, 'receipts', name, bytes, str(f.mime));
  await ctx.tx`update expenses set receipt = ${name} where business_id = ${ctx.biz} and seq = ${row.seq}`;
  return erpExpenses(ctx, { month: monthText(row.month) });
}

/** A link to open the receipt (links expire, so one is made each time). */
export async function erpExpenseReceiptUrl(ctx, payload) {
  const id = str(payload && payload.id);
  const row = (await ctx.tx`select receipt from expenses where business_id = ${ctx.biz} and expense_no = ${id} limit 1`)[0];
  if (!row || !str(row.receipt)) throw new Error('No receipt is kept with that entry.');
  return { url: await fileUrl(ctx, 'receipts', str(row.receipt)) };
}

export const HANDLERS = {
  erpExpenses,
  erpExpenseAdd,
  erpExpenseItemSave,
  erpExpenseItemEnd,
  erpExpenseFixedPay,
  erpExpenseRecurringSet,
  erpExpenseVoid,
  erpExpenseExport,
  erpExpenseCategory, erpExpenseReceipt, erpExpenseReceiptUrl,
};
