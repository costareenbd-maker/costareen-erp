// What the owner's main screens show, from a given code version on a given database - to compare the live code on
// live data with the new code on the upgraded copy. Read-only calls only. Used by deploy/rehearse_upgrade.py.
//   node compare_reports.mjs <fnDir> <dbUrl> <ownerUserId> <out.json>
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
const deps = {
  sql, sqlAux: connect(postgres, dbUrl, { max: 2 }), control: connect(postgres, dbUrl, { max: 2 }),
  verifyUser: async (h) => (/^Bearer owner:(.+)$/.exec(h) || [])[1] || null,
  fetch: async () => ({ status: 599, ok: false, text: async () => '', json: async () => ({}), headers: { get: () => '' } }),
  storage: { async list() { return []; }, async url() { return ''; }, async read() { return null; }, async save() { return {}; }, async remove() {} },
  renderPdf: async () => new Uint8Array(0), mgmtRetryMs: 0, sfRetryMs: 0,
};
const call = (name, args) => erpCall(deps, { name, args: args || [], authHeader: 'Bearer owner:' + ownerUid });
const month = new Date(Date.now() + 6 * 3600e3).toISOString().slice(0, 7);
const prev = (() => { const d = new Date(month + '-01T00:00:00Z'); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7); })();
const CALLS = [
  ['erpDashboardData', []], ['erpDues', []], ['erpMoney', []], ['erpCashBook', [{}]], ['erpPnl', [{}]],
  ['erpPnlMonth', [{ month }]], ['erpPnlMonth', [{ month: prev }]], ['erpToday', []], ['erpCustomerList', [{}]],
  ['erpCatalog', []], ['erpSuppliers', []], ['erpExpenses', [{}]], ['erpRecentInvoices', [{}]], ['erpCapital', [{}]],
];
const out = {};
for (const [name, args] of CALLS) {
  const key = name + (args[0] && args[0].month ? ':' + args[0].month : '');
  try {
    const r = await call(name, args);
    out[key] = r.ok ? r.result : { error: r.error };
  } catch (e) { out[key] = { error: String((e && e.message) || e) }; }
}
fs.writeFileSync(outFile, JSON.stringify(out));
await sql.end({ timeout: 2 });
process.exit(0);
