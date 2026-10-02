// The lock date of the books (plan A6). Closing a month under Capital closes
// it for everything: nothing can be dated into it, and nothing dated in it
// can be changed or struck out, until the owner reopens it. Everything up to
// the latest closed month is locked, whether or not each earlier month was
// closed one by one.

import { monthStr } from './time.js';

const NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export const monthLabel = (m) => NAMES[Number(String(m).slice(5, 7)) - 1] + ' ' + String(m).slice(0, 4);

/** 'yyyy-MM' of the latest closed month, or ''. */
export async function lockedThrough(ctx) {
  if (ctx.memo.lockedThrough === undefined) {
    let m = '';
    try {
      const r = await ctx.tx.savepoint(() => ctx.tx`select public.books_locked_through(${ctx.biz}) as m`);
      m = String((r[0] && r[0].m) || '');
    } catch (_) { m = ''; }
    ctx.memo.lockedThrough = m;
  }
  return ctx.memo.lockedThrough;
}

/**
 * Refuse a write that lands in a closed month.
 * `when` is a Date or a 'yyyy-MM' month; `what` finishes the sentence "... so <what>."
 */
export async function assertOpen(ctx, when, what) {
  const lock = await lockedThrough(ctx);
  if (!lock || !when) return;
  const month = when instanceof Date ? monthStr(when) : String(when).slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month) || month > lock) return;
  throw new Error(monthLabel(month) + ' is closed' + (month < lock ? ' (the books are closed up to ' + monthLabel(lock) + ')' : '') +
                  ', so ' + (what || 'nothing can be changed there') + '. Date it in an open month, or the owner can reopen the month under Capital.');
}
