// A joint pool keeps ONE set of books for its costs: the pool's book under
// Partnership, where every line says which partner paid (plan A7). The normal
// Expenses and Capital screens are switched off inside a pool, and the pool's
// profit screens read their expenses from the pool's book.

export async function isPool(ctx) {
  if (ctx.memo.isPool === undefined) {
    let v = false;
    try { v = !!(await ctx.tx.savepoint(() => ctx.tx`select is_pool from businesses where id = ${ctx.biz}`))[0].is_pool; } catch (_) { v = false; }
    ctx.memo.isPool = v;
  }
  return ctx.memo.isPool;
}

/** Refuse a write that belongs in the pool's book. */
export async function notInPool(ctx, what) {
  if (await isPool(ctx)) {
    throw new Error('This is a joint pool: ' + what + ' written in the pool\u2019s book (Capital \u2192 Partnership), where it says which partner paid.');
  }
}

/** The pool's expenses of a month, from its book: [{ category, amount }]. Nothing outside a pool. */
export async function poolExpenses(ctx, month) {
  if (!(await isPool(ctx))) return [];
  const rows = await ctx.tx`select coalesce(nullif(btrim(category), ''), 'Miscellaneous') as category, amount
                            from pool_ledger where pool_id = ${ctx.biz} and kind = 'EXPENSE' and voided_at is null
                              and to_char(entry_date, 'YYYY-MM') = ${month}`;
  return rows.map((r) => ({ category: String(r.category), amount: Number(r.amount) || 0 }));
}
