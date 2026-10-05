// A window with row-level security off, inside the caller's own transaction.
//
// Every handler runs as the signed-in person, so the database itself keeps one
// business out of another. A few things have to cross that line on purpose -
// a sales person of a partner company selling from a joint pool they are not
// a member of - and for those the handler does its own checks first and then
// writes here. Keep what runs inside small, and always name the business.
//
// Nested calls are counted, so an inner one does not end the outer one's window.

export async function asSystem(ctx, fn) {
  const t = ctx.tx;
  if (t.__ctl) return fn();          // already the server's own transaction in the provider's database (handlers/joint.js)
  t.__sys = (t.__sys || 0) + 1;
  if (t.__sys === 1) await t`select set_config('role', 'none', true), set_config('erp.system', 'on', true)`;
  try {
    return await fn();
  } finally {
    t.__sys--;
    if (t.__sys === 0) {
      // after a failed statement this cannot run; the rollback puts the role back by itself
      try { await t`select set_config('role', 'authenticated', true), set_config('erp.system', '', true)`; } catch (_) { /* rolled back */ }
    }
  }
}
