// The ERP's functions for one Engine job, as an MCP server (stdio, newline-delimited JSON-RPC) that Claude Code starts
// for the job (runner.mjs writes its mcp.json). The tools are the ones the ERP handed out with the job
// (erpEngineClaim: the chat assistant's reads + propose_*); each call goes to erpEngineTool, which runs it as the
// owner and keeps any write as a proposal for his Yes.
import { readFileSync } from 'node:fs';

const ERP_URL = process.env.ERP_URL, KEY = process.env.ERP_ENGINE_KEY, JOB = process.env.JOB_ID, RUNNER = process.env.RUNNER_NAME || 'office-vps';
const lower = (s) => {   // the ERP's tool list is written in Gemini's style (OBJECT, STRING): JSON Schema wants lower case
  if (Array.isArray(s)) return s.map(lower);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : lower(v);
  return o;
};
const TOOLS = JSON.parse(readFileSync(process.env.TOOLS_FILE, 'utf8')).map((t) => ({
  name: t.name,
  description: t.description + (/^propose_/.test(t.name) ? ' Nothing is written now: the owner confirms it in the ERP.' : ''),
  inputSchema: lower(t.parameters || { type: 'object', properties: {} }),
}));

async function erpTool(tool, args) {
  const r = await fetch(ERP_URL, { method: 'POST', headers: { 'content-type': 'application/json', 'x-region': 'ap-southeast-1' },
    body: JSON.stringify({ name: 'erpEngineTool', args: [{ id: JOB, tool, args }], token: { key: KEY, device: 'engine-' + RUNNER, label: 'Engine' } }), signal: AbortSignal.timeout(90000) });
  const j = await r.json().catch(() => ({ ok: false, error: 'HTTP ' + r.status }));
  if (!j.ok) throw new Error(j.error || 'ERP error');
  return j.result;
}

const send = (m) => process.stdout.write(JSON.stringify(m) + '\n');
async function handle(m) {
  const reply = (result) => send({ jsonrpc: '2.0', id: m.id, result });
  if (m.method === 'initialize') return reply({ protocolVersion: (m.params && m.params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'erp', version: '1.0' } });
  if (m.method === 'tools/list') return reply({ tools: TOOLS });
  if (m.method === 'ping') return reply({});
  if (m.method === 'tools/call') {
    const name = m.params && m.params.name;
    try {
      const out = await erpTool(name, (m.params && m.params.arguments) || {});
      const text = JSON.stringify(out);
      return reply({ content: [{ type: 'text', text: text.length > 60000 ? text.slice(0, 60000) + '... (cut)' : text }], isError: !!(out && out.error) });
    } catch (e) { return reply({ content: [{ type: 'text', text: 'Error: ' + String(e.message || e) }], isError: true }); }
  }
  if (m.id !== undefined) send({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'Method not found' } });
}

let buf = '';
process.stdin.on('data', (d) => {
  buf += d; let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!line) continue;
    let m; try { m = JSON.parse(line); } catch (_) { continue; }
    handle(m);
  }
});
