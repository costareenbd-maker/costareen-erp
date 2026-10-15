// Which invoices the "Owed by customers" card counts that the dues list does not (run on a COPY by rehearse_upgrade.py).
//   node diag_dues.mjs <fnDir> <dbUrl> <ownerUserId> <out.json>
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
const [fnDir, dbUrl, ownerUid, outFile] = process.argv.slice(2);
const require = createRequire(path.join(process.env.ERP_NODE_CWD || process.cwd(), 'package.json'));
const postgres = require('postgres');
const { connect } = await import(pathToFileURL(path.join(fnDir, 'db.js')));
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const sql = connect(postgres, dbUrl);
const deps = { sql, sqlAux: connect(postgres, dbUrl, { max: 2 }), control: connect(postgres, dbUrl, { max: 2 }),
  verifyUser: async (h) => (/^Bearer owner:(.+)$/.exec(h) || [])[1] || null, fetch: async () => ({ status: 599, ok: false, text: async () => '' }),
  storage: { async list() { return []; }, async url() { return ''; }, async read() { return null; } }, renderPdf: async () => new Uint8Array(0) };
const dash = await import(pathToFileURL(path.join(fnDir, 'handlers', 'dashboard.js')));
// run owedMap inside a real call context: borrow erpCall's ctx by a tiny handler injected through the same path
const handlers = (await import(pathToFileURL(path.join(fnDir, 'handlers', 'index.js'))));
const H = handlers.HANDLERS || handlers.default || handlers;
H.__diagOwed = async (ctx) => ({ owed: await dash.owedMap(ctx) });
const allow = await import(pathToFileURL(path.join(fnDir, 'allow.js')));
allow.ERP_ALLOW.__diagOwed = 'owner';
const call = (name, args) => erpCall(deps, { name, args: args || [], authHeader: 'Bearer owner:' + ownerUid });
const dues = await call('erpDues', []);
const owed = await call('__diagOwed', []);
const out = { duesOk: dues.ok, duesErr: dues.error, owedOk: owed.ok, owedErr: owed.error };
if (dues.ok && owed.ok) {
  const listed = {}; for (const i of dues.result.invoices) listed[i.id] = i.due;
  const extra = Object.entries(owed.result.owed).filter(([k, v]) => v > 0.5 && !(k in listed));
  out.duesTotal = dues.result.total; out.cardTotal = Object.values(owed.result.owed).filter((v) => v > 0.5).reduce((a, b) => a + b, 0);
  out.extraCount = extra.length; out.extraTotal = extra.reduce((a, [, v]) => a + v, 0);
  const ids = extra.map(([k]) => k);
  const rows = ids.length ? await sql`select invoice_no, created_at::date::text d, grand_total, advance_paid, due_amount, payment_status, paid_outside, source, voided_at is not null as voided,
      (select coalesce(sum(amount),0) from payments p where p.business_id = i.business_id and p.invoice_no = i.invoice_no) as payments
      from invoices i where invoice_no = any(${ids})` : [];
  out.sample = rows.slice(0, 15);
  out.byStatus = {}; for (const r of rows) { const k = r.payment_status + (Number(r.paid_outside) > 0 ? ' +paid_outside' : '') + (r.voided ? ' VOIDED' : ''); out.byStatus[k] = (out.byStatus[k] || 0) + 1; }
  out.notInInvoices = ids.filter((x) => !rows.some((r) => r.invoice_no === x)).slice(0, 20);
}
fs.writeFileSync(outFile, JSON.stringify(out, null, 1));
process.exit(0);
