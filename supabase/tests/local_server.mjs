// Local stand-in for the `erp` Edge Function: same erpCall, Node http,
// throwaway database. For trying the real page on this computer only.
import http from 'node:http';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

const require = createRequire(path.join(process.env.ERP_NODE_CWD || process.cwd(), 'package.json'));
const postgres = require('postgres');
const fnDir = path.join(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..', 'functions', 'erp');
const { connect } = await import(pathToFileURL(path.join(fnDir, 'db.js')));
const { erpCall } = await import(pathToFileURL(path.join(fnDir, 'core.js')));
const { shopDoor } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'shop.js')));
const { asBusiness, owners } = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const { installRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'installer.js')));
const { signinRoute } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'signin.js')));

const sql = connect(postgres, process.env.DB_URL);
// fake storage / PDF / outside world from the test harness (nothing leaves this computer)
const H = await import('./harness.mjs');
const deps = { ...H.deps, sql, control: sql, sqlAux: connect(postgres, process.env.DB_URL, { max: 2 }), verifyUser: async () => null };   // owner email sign-in is not simulated
const PORT = Number(process.env.PORT || 8794);
deps.hookBase = 'http://localhost:' + PORT + '/';
if (process.env.LINK_ONLY) {
  // as deployed: no sign-in, a private link. One is made for the fixture owner and printed.
  const { keyHash, newKey } = await import(pathToFileURL(path.join(fnDir, 'handlers', 'access.js')));
  const key = newKey();
  await sql`insert into erp_access_keys (key_hash, user_id, label) values (${await keyHash(key)}, ${JSON.parse(process.env.FIX).U.owner}, 'Local trial')`;
  deps.linkOnly = true;
  // locally the owner is also a platform admin, so the Platform screen can be tried
  try { await sql`insert into platform_admins (user_id, note) values (${JSON.parse(process.env.FIX).U.owner}, 'local') on conflict do nothing`; } catch (_) { /* before 043 */ }
  console.log('LINK http://localhost:8793/index-local.html#k=' + key);
}

http.createServer(async (req, res) => {
  const h = {
    'Access-Control-Allow-Origin': req.headers.origin || '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-erp-session, x-region',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
  if (req.method === 'OPTIONS') { res.writeHead(200, h); return res.end('ok'); }
  let raw = '';
  for await (const c of req) raw += c;
  // the open door for any website (handlers/shop.js), as index.ts does
  { const sm = /[?&]signin=(check|forgot)/.exec(req.url);
    if (sm && req.method === 'POST') { let b = {}; try { b = JSON.parse(raw || '{}'); } catch (_) {} const out = await signinRoute(deps, sm[1], b); res.writeHead(200, h); return res.end(JSON.stringify(out)); } }
  if (/[?&](install|control)=/.test(req.url)) {
    const r = await installRoute(deps, new Request('http://localhost:' + PORT + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? raw : undefined }));
    res.writeHead(r.status, h); return res.end(JSON.stringify(r.body));
  }
  if (/[?&]shop=/.test(req.url)) {
    const r = await shopDoor(deps, asBusiness, owners, new Request('http://localhost:' + PORT + req.url, { method: req.method, headers: req.headers, body: req.method === 'POST' ? raw : undefined }));
    res.writeHead(r.status, h); return res.end(JSON.stringify(r.body));
  }
  let body = {};
  try { body = JSON.parse(raw || '{}'); } catch (_) { /* empty */ }
  // local trial only: let every waiting device in
  if (process.env.AUTO_APPROVE) await sql`update erp_devices set status = 'approved' where status = 'pending'`;
  const out = await erpCall(deps, { name: body.name, args: body.args, token: body.token, authHeader: req.headers['x-erp-session'] || '' });
  res.writeHead(200, h);
  res.end(JSON.stringify(out));
}).listen(PORT, () => console.log('erp local server on', PORT));
