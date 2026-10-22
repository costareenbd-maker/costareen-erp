// ERP AI gateway (office VPS) - 22 Oct 2026. The Costareen ERP's "Own server" AI: one OpenAI-style door
// (POST /v1/chat/completions, GET /v1/models) in front of the owner's SUBSCRIPTIONS:
//   claude-opus / claude-sonnet / claude-haiku  -> Claude Code in print mode on the owner's Claude plan (no tools of its
//                                                 own, no sessions, no plugins; one question, one answer)
//   gpt-*                                       -> OpenClaw's powerless `erp` agent on the owner's ChatGPT plan
//                                                 (when the OpenClaw gateway runs; else 503 and the ERP falls back)
// The ERP's own tools (function calling) are passed through: Claude is told the functions and answers either with a
// JSON tool call or with the final answer. Photos are not taken (400): the ERP sends those to Gemini instead.
// Secret: ERP_AI_SECRET in /etc/erp-ai-gateway.env (the ERP's Settings > AI brain > Own server key).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 18800);
const SECRET = process.env.ERP_AI_SECRET || '';
const MAX_PAR = Number(process.env.MAX_PARALLEL || 3);
const CLAUDE = process.env.CLAUDE_BIN || '/usr/bin/claude';
const MODELS = ['claude-opus', 'claude-sonnet', 'claude-haiku', 'gpt-5.5', 'gpt-5.4'];
const CLAUDE_MODEL = { 'claude-opus': 'opus', 'claude-sonnet': 'sonnet', 'claude-haiku': 'haiku' };

let running = 0; const waiting = [];
const slot = () => new Promise((ok) => { if (running < MAX_PAR) { running++; ok(); } else waiting.push(ok); });
const free = () => { const n = waiting.shift(); if (n) n(); else running--; };

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const err = (res, code, msg, type) => send(res, code, { error: { message: msg, type: type || 'api_error' } });
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p && (p.type === 'text' || p.type === 'input_text')).map((p) => p.text || '').join('\n') : '');
const hasImage = (msgs) => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p && /image|file|audio/.test(p.type || '')));

function runClaude(model, system, prompt, ms) {
  return new Promise((ok, bad) => {
    const f = '/tmp/erp-ai-sys-' + randomUUID() + '.txt';
    writeFileSync(f, system || 'You are the language engine of a business system. Follow the instructions in the request.');
    const p = spawn(CLAUDE, ['-p', '--output-format', 'json', '--model', model, '--system-prompt-file', f, '--tools', '', '--no-session-persistence',
      '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], { env: { ...process.env, HOME: '/root' }, cwd: '/tmp' });
    let out = '', e = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); }, ms);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { e += d; });
    p.on('close', () => {
      clearTimeout(t); try { unlinkSync(f); } catch (_) { /* gone */ }
      let j = null; try { j = JSON.parse(out); } catch (_) { j = null; }
      if (!j) return bad(new Error('claude gave no answer: ' + (e || out).slice(0, 300)));
      if (j.is_error) return bad(new Error('claude: ' + String(j.result || j.subtype).slice(0, 300)));
      ok(j);
    });
    p.stdin.end(prompt);
  });
}

function toolSystem(tools) {
  if (!tools || !tools.length) return '';
  const list = tools.map((t) => { const f = t.function || t; return '- ' + f.name + ': ' + (f.description || '') + '\n  parameters: ' + JSON.stringify(f.parameters || {}); }).join('\n');
  return '\n\n# Functions of the business system\nYou may call ONE of these functions to get data or act. To call one, reply with ONLY this JSON and nothing else:\n' +
    '{"tool_call": {"name": "<function name>", "arguments": { ... }}}\nWhen you have what you need, reply with the final answer as normal text (never wrapped in tool_call JSON).\n' + list;
}
function transcript(msgs) {
  const lines = [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') { lines.push('FUNCTION RESULT (' + (m.name || m.tool_call_id || '') + '):\n' + textOf(m.content)); continue; }
    if (m.role === 'assistant' && m.tool_calls && m.tool_calls.length) {
      for (const c of m.tool_calls) lines.push('ASSISTANT called function ' + c.function.name + ' with ' + (c.function.arguments || '{}'));
      if (textOf(m.content)) lines.push('ASSISTANT: ' + textOf(m.content));
      continue;
    }
    lines.push((m.role === 'assistant' ? 'ASSISTANT: ' : 'USER: ') + textOf(m.content));
  }
  return lines.join('\n\n') + '\n\nReply now as the ASSISTANT (only the reply itself).';
}

async function claudeChat(body, res) {
  const msgs = body.messages || [];
  if (hasImage(msgs)) return err(res, 400, 'This engine does not take photos or files; the ERP sends those to another AI.', 'invalid_request_error');
  const sys = msgs.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n') + toolSystem(body.tools) +
    (body.response_format && body.response_format.type === 'json_object' ? '\n\nAnswer with valid JSON only.' : '');
  await slot();
  let j;
  try { j = await runClaude(CLAUDE_MODEL[body.model] || 'opus', sys, transcript(msgs), 140000); }
  catch (e) { free(); return err(res, /rate|limit|usage/i.test(e.message) ? 429 : 502, e.message); }
  free();
  let text = String(j.result || '').trim(), toolCalls = null;
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  if (body.tools && body.tools.length && /^\{[\s\S]*"tool_call"[\s\S]*\}$/.test(t)) {
    try { const c = JSON.parse(t).tool_call; if (c && c.name) { toolCalls = [{ id: 'call_' + randomUUID().slice(0, 12), type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) } }]; text = ''; } } catch (_) { /* a normal answer */ }
  }
  const u = j.usage || {};
  send(res, 200, { id: 'chatcmpl-' + randomUUID(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content: toolCalls ? null : text, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
    usage: { prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completion_tokens: u.output_tokens || 0 } });
}

async function openclawChat(body, res) {
  let token = '';
  try { token = JSON.parse(readFileSync('/home/admin/.openclaw/openclaw.json', 'utf8')).gateway.auth.token; } catch (_) { token = ''; }
  const fwd = { ...body, model: 'openclaw/erp', stream: false };
  try {
    const r = await fetch('http://127.0.0.1:18789/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'x-openclaw-model': 'openai/' + body.model },
      body: JSON.stringify(fwd), signal: AbortSignal.timeout(140000) });
    const txt = await r.text();
    res.writeHead(r.status, { 'content-type': 'application/json' }); res.end(txt);
  } catch (e) { err(res, 503, 'The ChatGPT engine (OpenClaw) is not running.'); }
}

http.createServer((req, res) => {
  const auth = String(req.headers.authorization || '');
  if (!SECRET || auth !== 'Bearer ' + SECRET) return err(res, 401, 'unauthorized', 'authentication_error');
  const path = req.url.replace(/^\/ai/, '').split('?')[0];
  if (req.method === 'GET' && path === '/v1/models') return send(res, 200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'erp-gateway' })) });
  if (req.method !== 'POST' || path !== '/v1/chat/completions') return err(res, 404, 'not found');
  let raw = '';
  req.on('data', (d) => { raw += d; if (raw.length > 20e6) req.destroy(); });
  req.on('end', () => {
    let body; try { body = JSON.parse(raw); } catch (_) { return err(res, 400, 'bad json', 'invalid_request_error'); }
    const m = String(body.model || 'claude-opus');
    (CLAUDE_MODEL[m] ? claudeChat(body, res) : /^gpt|^o\d/.test(m) ? openclawChat(body, res) : claudeChat({ ...body, model: 'claude-opus' }, res))
      .catch((e) => err(res, 500, String(e && e.message || e)));
  });
}).listen(PORT, '127.0.0.1', () => console.log('erp-ai-gateway on 127.0.0.1:' + PORT));
