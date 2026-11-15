// ERP AI gateway (office VPS) - 22 Oct 2026. The Costareen ERP's "Own server" AI: one OpenAI-style door
// (POST /v1/chat/completions, GET /v1/models) in front of the owner's SUBSCRIPTIONS:
//   claude-opus / claude-sonnet / claude-haiku  -> Claude Code in print mode on the owner's Claude plan (no tools of its
//                                                 own, no sessions, no plugins; one question, one answer)
//   gpt-*                                       -> OpenClaw's powerless `erp` agent on the owner's ChatGPT plan
//                                                 (when the OpenClaw gateway runs; else 503 and the ERP falls back)
// The ERP's own tools (function calling) are passed through: Claude is told the functions and answers either with a
// JSON tool call or with the final answer (ChatGPT the same way: OpenClaw drops passed functions). Photos go to ChatGPT;
// Claude here does not take them (400) and the caller moves on to Gemini.
// Pictures: POST /v1/images/jobs + GET /v1/images/jobs/<id> (gpt-image-2 on the ChatGPT plan, see below).
// Secret: ERP_AI_SECRET in /etc/erp-ai-gateway.env (the ERP's Settings > AI brain > Own server key).
//
// OWNER RULE 4 Nov 2026: "Claude is for me only; everything automatic runs on my ChatGPT subscription". Unless
// ALLOW_CLAUDE=1 is set, nothing here starts Claude: the claude-* names are answered by ChatGPT (opus -> sol, sonnet ->
// terra, haiku -> luna) and a ChatGPT failure goes back as an error, so the ERP moves on to its next AI (Gemini).
import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFileSync, writeFileSync, unlinkSync, mkdirSync, chmodSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const PORT = Number(process.env.PORT || 18800);
const SECRET = process.env.ERP_AI_SECRET || '';
const MAX_PAR = Number(process.env.MAX_PARALLEL || 3);
const CLAUDE = process.env.CLAUDE_BIN || '/usr/bin/claude';
// 1 Nov 2026: the ChatGPT plan (abidur.rahoman2000, Plus) serves the gpt-5.6 tiers only; gpt-5.5 / 5.4 are refused for ChatGPT
// accounts, so the old names are read as gpt-5.6-sol
const MODELS = ['gpt-5.6-sol', 'gpt-5.6-terra', 'gpt-5.6-luna', 'claude-opus', 'claude-sonnet', 'claude-haiku'];
const GPT_ALIAS = { 'gpt-5.5': 'gpt-5.6-sol', 'gpt-5.4': 'gpt-5.6-sol', 'gpt-5.5-pro': 'gpt-5.6-sol', 'gpt-5.4-mini': 'gpt-5.6-luna', 'gpt': 'gpt-5.6-sol' };
const CLAUDE_MODEL = { 'claude-opus': 'opus', 'claude-sonnet': 'sonnet', 'claude-haiku': 'haiku' };
const ALLOW_CLAUDE = process.env.ALLOW_CLAUDE === '1';
const CLAUDE_AS_GPT = { 'claude-opus': 'gpt-5.6-sol', 'claude-sonnet': 'gpt-5.6-terra', 'claude-haiku': 'gpt-5.6-luna' };
// OWNER RULE 15 Nov 2026: "my personal brand runs on Claude; ChatGPT is for the other businesses". A second key,
// PERSONAL_SECRET (/etc/erp-ai-gateway.env), is the personal-brand door (brand bridge, journal bot, PC video editor):
// with it EVERY chat goes to Claude on the owner's Claude plan, photos included, and gpt-* names are read as Claude
// (sol/terra -> sonnet, luna -> haiku). No fallback to ChatGPT: a Claude limit comes back as 429 and the job waits.
// The business key (ERP_AI_SECRET) is unchanged: Claude never answers it unless ALLOW_CLAUDE=1.
const PERSONAL = process.env.PERSONAL_SECRET || '';
const GPT_AS_CLAUDE = { 'gpt-5.6-sol': 'claude-sonnet', 'gpt-5.6-terra': 'claude-sonnet', 'gpt-5.6-luna': 'claude-haiku' };

let running = 0; const waiting = [];
const slot = () => new Promise((ok) => { if (running < MAX_PAR) { running++; ok(); } else waiting.push(ok); });
const free = () => { const n = waiting.shift(); if (n) n(); else running--; };

const send = (res, code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)); };
const err = (res, code, msg, type) => send(res, code, { error: { message: msg, type: type || 'api_error' } });
const textOf = (c) => (typeof c === 'string' ? c : Array.isArray(c) ? c.filter((p) => p && (p.type === 'text' || p.type === 'input_text')).map((p) => p.text || '').join('\n') : '');
const hasImage = (msgs) => msgs.some((m) => Array.isArray(m.content) && m.content.some((p) => p && /image|file|audio/.test(p.type || '')));

function runClaude(model, system, prompt, ms, env) {
  return new Promise((ok, bad) => {
    const f = '/tmp/erp-ai-sys-' + randomUUID() + '.txt';
    writeFileSync(f, system || 'You are the language engine of a business system. Follow the instructions in the request.');
    const p = spawn(CLAUDE, ['-p', '--output-format', 'json', '--model', model, '--system-prompt-file', f, '--tools', '', '--no-session-persistence',
      '--setting-sources', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}'], { env: env || { ...process.env, HOME: '/root' }, cwd: '/tmp' });
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

function runClaudeBlocks(model, system, blocks, ms, env) {
  return new Promise((ok, bad) => {
    const f = '/tmp/erp-ai-sys-' + randomUUID() + '.txt';
    writeFileSync(f, system || 'Follow the instructions in the request.');
    const p = spawn(CLAUDE, ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--model', model,
      '--system-prompt-file', f, '--tools', '', '--no-session-persistence', '--setting-sources', '', '--strict-mcp-config',
      '--mcp-config', '{"mcpServers":{}}'], { env: env || { ...process.env, HOME: '/root' }, cwd: '/tmp' });
    let out = '', e = '';
    const t = setTimeout(() => { p.kill('SIGKILL'); }, ms);
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { e += d; });
    p.on('close', () => {
      clearTimeout(t); try { unlinkSync(f); } catch (_) { /* gone */ }
      let j = null;
      for (const line of out.split('\n')) { try { const o = JSON.parse(line); if (o.type === 'result') j = o; } catch (_) { /* not json */ } }
      if (!j) return bad(new Error('claude gave no answer: ' + (e || out).slice(-300)));
      if (j.is_error) return bad(new Error('claude: ' + String(j.result || j.subtype).slice(0, 300)));
      ok(j);
    });
    p.stdin.end(JSON.stringify({ type: 'user', message: { role: 'user', content: blocks } }) + '\n');
  });
}
function imageBlocks(msgs) {
  const out = [];
  for (const m of msgs) {
    if (!Array.isArray(m.content)) continue;
    for (const c of m.content) {
      const u = c && c.type === 'image_url' && (c.image_url && c.image_url.url || c.image_url);
      const d = /^data:(image\/(?:jpeg|png|gif|webp));base64,(.+)$/s.exec(String(u || ''));
      if (d) out.push({ type: 'image', source: { type: 'base64', media_type: d[1], data: d[2] } });
    }
  }
  return out;
}
// ---------------------------------------------------------------- personal brand router (owner, 15 Nov 2026)
// Public work (his image: video keep/cut, captions, posts, Remotion) -> Claude first, best model; internal work (inbox,
// ERP, tags, summaries) -> ChatGPT first. Research: G:\bendar-brand\reports\AI model routing for brand.md.
//   public        Claude opus   -> Gemini -> ChatGPT sol
//   public-light  Claude sonnet -> Gemini -> ChatGPT sol      (caption spelling, frame look)
//   internal      ChatGPT terra -> Claude sonnet -> Gemini
//   internal-light ChatGPT luna -> Claude haiku  -> Gemini
// The task comes from the x-ai-task header (or is read from the model name). x-ai-wait: 1 = the job can wait: when no
// Claude account is free a public job gets 429 + retry_at instead of a weaker model. x-ai-private: 1 = never Gemini
// (free-tier inputs may be read by Google). Every answer says who made it: x-erp-ai-engine, x-ai-fallback, served_by.
// Claude accounts (owner's own, any of them may be paid or not at a time) are found by use: the first account in
// /etc/erp-ai-gateway.claude-accounts.json that answers is used; one that says "limit" rests until its reset time, one
// that is logged out / not paid rests 3 h and is tried again. Tokens come from `claude setup-token` (never printed).
const ACC_FILE = process.env.CLAUDE_ACCOUNTS_FILE || '/etc/erp-ai-gateway.claude-accounts.json';
const GEMINI_KEY = process.env.GEMINI_API_KEY || '';
const GEMINI_MODEL = process.env.GEMINI_MODEL || 'gemini-3.8-flash';
const TASKS = {
  public: { claude: 'opus', gpt: 'gpt-5.6-sol', chain: ['claude', 'gemini', 'gpt'] },
  'public-light': { claude: 'sonnet', gpt: 'gpt-5.6-sol', chain: ['claude', 'gemini', 'gpt'] },
  internal: { claude: 'sonnet', gpt: 'gpt-5.6-terra', chain: ['gpt', 'claude', 'gemini'] },
  'internal-light': { claude: 'haiku', gpt: 'gpt-5.6-luna', chain: ['gpt', 'claude', 'gemini'] },
};
const accRest = {};   // account name -> {until, why}
function accounts() {
  try { const a = JSON.parse(readFileSync(ACC_FILE, 'utf8')); if (Array.isArray(a) && a.length) return a; } catch (_) { /* none */ }
  return [{ name: 'root' }];
}
function accEnv(a) {
  const e = { ...process.env, HOME: '/root' };
  delete e.ANTHROPIC_API_KEY;   // with it set, claude -p bills the API instead of the plan
  delete e.CLAUDE_CONFIG_DIR;
  if (a.token) {
    // its own empty settings folder, so root's own login (/root/.claude) is not read instead of the token
    const dir = '/var/lib/erp-ai-gateway/claude-' + String(a.name).replace(/[^a-z0-9_-]/gi, '');
    try { mkdirSync(dir, { recursive: true, mode: 0o700 }); } catch (_) { /* there */ }
    e.CLAUDE_CONFIG_DIR = dir; e.CLAUDE_CODE_OAUTH_TOKEN = a.token;
  } else delete e.CLAUDE_CODE_OAUTH_TOKEN;
  return e;
}
// "limit reached · resets 3pm", "resets 11:30am (Asia/Seoul)", "resets Nov 18, 9am" -> a time; else now + 60 min
function resetAt(msg) {
  const now = Date.now(), txt = String(msg || '');
  const m = /resets?\s+(?:at\s+)?(?:([A-Z][a-z]{2})[a-z]*\s+(\d{1,2}),?\s+(?:at\s+)?)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)/i.exec(txt);
  if (!m) return now + 3600e3;
  // the time is in the zone named in brackets, else the server's (UTC)
  const z = /\(([A-Za-z_]+\/[A-Za-z_]+)\)/.exec(txt);
  let off = 0;
  try { if (z) { const d0 = new Date(now); off = (new Date(d0.toLocaleString('en-US', { timeZone: z[1] })) - new Date(d0.toLocaleString('en-US', { timeZone: 'UTC' }))) / 60000; } } catch (_) { off = 0; }
  const local = new Date(now + off * 60000);   // "wall clock" in that zone, read with UTC getters
  let h = Number(m[3]) % 12; if (/pm/i.test(m[5])) h += 12;
  const d = new Date(Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate(), h, Number(m[4] || 0)));
  if (m[1]) { const mon = 'janfebmaraprmayjunjulaugsepoctnovdec'.indexOf(m[1].toLowerCase().slice(0, 3)) / 3; if (mon >= 0) d.setUTCMonth(mon, Number(m[2])); }
  let t = d.getTime() - off * 60000; if (t <= now) t += 86400e3;
  return Math.min(t + 60e3, now + 8 * 86400e3);
}
async function claudeAny(model, sys, msgs) {
  const imgs = imageBlocks(msgs);
  let soonest = 0, last = '';
  for (const a of accounts()) {
    const r = accRest[a.name];
    if (r && r.until > Date.now()) { soonest = soonest ? Math.min(soonest, r.until) : r.until; continue; }
    try {
      const j = imgs.length ? await runClaudeBlocks(model, sys, [...imgs, { type: 'text', text: transcript(msgs) }], 290000, accEnv(a))
        : await runClaude(model, sys, transcript(msgs), 290000, accEnv(a));
      delete accRest[a.name];
      return { j, acc: a.name };
    } catch (e) {
      last = e.message;
      const until = /limit|usage|quota|rate.?limit|429/i.test(last) ? resetAt(last)
        : /auth|log ?in|401|403|expired|invalid.*(token|key)|subscription|oauth|credit/i.test(last) ? Date.now() + 3 * 3600e3 : 0;
      if (until) { accRest[a.name] = { until, why: last.slice(0, 160) }; soonest = soonest ? Math.min(soonest, until) : until; }
      console.log('claude account ' + a.name + ' failed: ' + last.slice(0, 200));
    }
  }
  const e = new Error('no Claude account free: ' + last.slice(0, 160)); e.retryAt = soonest || Date.now() + 3600e3; throw e;
}
async function gptAsk(body, model) {
  let token = '';
  try { token = JSON.parse(readFileSync('/home/admin/.openclaw/openclaw.json', 'utf8')).gateway.auth.token; } catch (_) { token = ''; }
  const r = await fetch('http://127.0.0.1:18789/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'x-openclaw-model': 'openai/' + model },
    body: JSON.stringify({ ...asText(body), model: 'openclaw/erp', stream: false }), signal: AbortSignal.timeout(170000) });
  const txt = await r.text();
  if (!r.ok) throw new Error('chatgpt ' + r.status + ' ' + txt.slice(0, 160));
  const j = JSON.parse(txt), c = j.choices && j.choices[0] && j.choices[0].message;
  if (!c) throw new Error('chatgpt odd answer');
  return { text: c.content, usage: j.usage || {} };
}
async function geminiAsk(body) {
  if (!GEMINI_KEY) throw new Error('no personal Gemini key');
  const r = await fetch('https://generativelanguage.googleapis.com/v1beta/openai/chat/completions', { method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + GEMINI_KEY },
    body: JSON.stringify({ model: GEMINI_MODEL, messages: asText(body).messages }), signal: AbortSignal.timeout(170000) });
  const txt = await r.text();
  if (!r.ok) throw new Error('gemini ' + r.status + ' ' + txt.slice(0, 160));
  const j = JSON.parse(txt), c = j.choices && j.choices[0] && j.choices[0].message;
  if (!c) throw new Error('gemini odd answer');
  return { text: c.content, usage: j.usage || {} };
}
function taskOf(req, body) {
  const h = String(req.headers['x-ai-task'] || body.task || '').toLowerCase();
  if (TASKS[h]) return h;
  const m = String(body.model || '');
  return m === 'claude-opus' ? 'public' : m === 'claude-sonnet' ? 'public-light' : /luna|haiku/.test(m) ? 'internal-light' : /^gpt|^o\d/.test(m) ? 'internal' : 'public-light';
}
async function personalChat(req, body, res) {
  const msgs = body.messages || [];
  const task = taskOf(req, body), T = TASKS[task];
  const wait = String(req.headers['x-ai-wait'] || '') === '1', priv = String(req.headers['x-ai-private'] || '') === '1';
  const sys = msgs.filter((x) => x.role === 'system').map((x) => textOf(x.content)).join('\n\n') + toolSystem(body.tools) +
    (body.response_format && body.response_format.type === 'json_object' ? '\n\nAnswer with valid JSON only.' : '');
  const why = [];
  for (let i = 0; i < T.chain.length; i++) {
    const step = T.chain[i];
    if (step === 'gemini' && (priv || !GEMINI_KEY)) continue;
    // a public job that may wait does not go below Claude: it is told when to come back
    if (i > 0 && wait && T.chain[0] === 'claude') {
      const r = why.find((w) => w.retryAt);
      res.setHeader('retry-after', String(Math.ceil(((r && r.retryAt) || Date.now() + 3600e3) - Date.now()) / 1000 | 0));
      return send(res, 429, { error: { message: 'Claude is resting; this job waits (' + (why[0] && why[0].msg || '') + ')', type: 'rate_limit', retry_at: new Date((r && r.retryAt) || Date.now() + 3600e3).toISOString() } });
    }
    await slot();
    try {
      let text, usage, by;
      if (step === 'claude') {
        const { j, acc } = await claudeAny(T.claude, sys, msgs);
        const u = j.usage || {};
        text = j.result; by = 'claude:' + T.claude + '@' + acc;
        usage = { prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completion_tokens: u.output_tokens || 0 };
      } else if (step === 'gpt') { ({ text, usage } = await gptAsk(body, T.gpt)); by = 'chatgpt:' + T.gpt; }
      else { ({ text, usage } = await geminiAsk(body)); by = 'gemini:' + GEMINI_MODEL; }
      free();
      const fb = i > 0 ? '1' : '0';
      if (fb === '1') console.log('personal ' + task + ' fell back to ' + by + ' after: ' + why.map((w) => w.msg).join(' | ').slice(0, 300));
      return answer(res, { ...body, model: by }, text, { ...usage, served_by: by, task, fallback: fb === '1' },
        { 'x-erp-ai-engine': by, 'x-ai-fallback': fb, 'x-ai-task': task });
    } catch (e) { free(); why.push({ step, msg: String(e.message).slice(0, 160), retryAt: e.retryAt }); }
  }
  const r = why.find((w) => w.retryAt);
  return send(res, 429, { error: { message: 'no AI free right now: ' + why.map((w) => w.step + ': ' + w.msg).join(' | ').slice(0, 400), type: 'rate_limit', retry_at: r ? new Date(r.retryAt).toISOString() : null } });
}
function accStatus(res) {
  return send(res, 200, { accounts: accounts().map((a) => ({ name: a.name, resting_until: accRest[a.name] && accRest[a.name].until > Date.now() ? new Date(accRest[a.name].until).toISOString() : null, why: accRest[a.name] && accRest[a.name].why || null })), gemini: !!GEMINI_KEY, tasks: TASKS });
}

function toolSystem(tools) {
  if (!tools || !tools.length) return '';
  const list = tools.map((t) => { const f = t.function || t; return '- ' + f.name + ': ' + (f.description || '') + '\n  parameters: ' + JSON.stringify(f.parameters || {}); }).join('\n');
  return '\n\n# Functions of the business system\nThese are the tools the instructions above speak of. You may call ONE of these functions to get data or act. To call one, reply with ONLY this JSON and nothing else:\n' +
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
  const u = j.usage || {};
  answer(res, body, j.result, { prompt_tokens: (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0), completion_tokens: u.output_tokens || 0 });
}

// a text reply -> an OpenAI answer; with functions offered, a {"tool_call": ...} in it becomes a real tool call
function answer(res, body, reply, usage, headers) {
  let text = String(reply || '').trim(), toolCalls = null;
  const t = text.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/, '').trim();
  // the call may come alone or after a sentence ("let me check... {"tool_call": ...}"): the JSON from its last opening on
  const at = body.tools && body.tools.length ? t.lastIndexOf('{"tool_call"') : -1;
  if (at >= 0) {
    try { const c = JSON.parse(t.slice(at)).tool_call; if (c && c.name) { toolCalls = [{ id: 'call_' + randomUUID().slice(0, 12), type: 'function', function: { name: c.name, arguments: JSON.stringify(c.arguments || {}) } }]; text = ''; } } catch (_) { /* a normal answer */ }
  }
  res.writeHead(200, { 'content-type': 'application/json', ...(headers || {}) });
  res.end(JSON.stringify({ id: 'chatcmpl-' + randomUUID(), object: 'chat.completion', created: Math.floor(Date.now() / 1000), model: body.model,
    choices: [{ index: 0, message: { role: 'assistant', content: toolCalls ? null : text, ...(toolCalls ? { tool_calls: toolCalls } : {}) }, finish_reason: toolCalls ? 'tool_calls' : 'stop' }],
    usage }));
}

// OpenClaw's HTTP door drops the caller's functions, so they go in as text the same way as for Claude: the function list
// in the system message, earlier calls and results as plain turns (photos stay where they are)
function asText(body) {
  const msgs = body.messages || [];
  const rf = body.response_format || {}, schema = rf.type === 'json_schema' && rf.json_schema && rf.json_schema.schema;
  // a strict JSON schema (the Skin Advisor's) is dropped by OpenClaw too: it goes in as words, every key required
  const sys = msgs.filter((m) => m.role === 'system').map((m) => textOf(m.content)).join('\n\n') + toolSystem(body.tools) +
    (schema ? '\n\nAnswer with ONE JSON object only (no words before or after it) that matches this JSON Schema exactly - every key present, null only where the schema allows it:\n' + JSON.stringify(schema)
      : rf.type === 'json_object' ? '\n\nAnswer with valid JSON only.' : '');
  const out = sys ? [{ role: 'system', content: sys }] : [];
  for (const m of msgs) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') { out.push({ role: 'user', content: 'FUNCTION RESULT (' + (m.name || m.tool_call_id || '') + '):\n' + textOf(m.content) }); continue; }
    if (m.role === 'assistant') {
      const calls = (m.tool_calls || []).map((c) => 'I called function ' + c.function.name + ' with ' + (c.function.arguments || '{}'));
      out.push({ role: 'assistant', content: [textOf(m.content)].concat(calls).filter(Boolean).join('\n') || '(no text)' });
      continue;
    }
    out.push({ role: 'user', content: m.content });
  }
  const { tools, tool_choice, response_format, parallel_tool_calls, ...rest } = body;
  return { ...rest, messages: out };
}

// ChatGPT through OpenClaw; when the plan's usage window is spent (429), OpenClaw is down or the model is refused, the
// same question goes to Claude (text) so the ERP and the sites keep working - photos are not Claude's here: that error
// goes back and the caller moves on to its next AI (Gemini)
async function openclawChat(body, res) {
  let token = '';
  try { token = JSON.parse(readFileSync('/home/admin/.openclaw/openclaw.json', 'utf8')).gateway.auth.token; } catch (_) { token = ''; }
  const model = GPT_ALIAS[body.model] || body.model;
  const fwd = { ...asText(body), model: 'openclaw/erp', stream: false };
  let why = '';
  try {
    const r = await fetch('http://127.0.0.1:18789/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + token, 'x-openclaw-model': 'openai/' + model },
      body: JSON.stringify(fwd), signal: AbortSignal.timeout(170000) });
    const txt = await r.text();
    if (r.ok) {
      let j = null; try { j = JSON.parse(txt); } catch (_) { j = null; }
      const c = j && j.choices && j.choices[0] && j.choices[0].message;
      if (c) return answer(res, body, c.content, j.usage || {}, { 'x-erp-ai-engine': 'chatgpt:' + model });
      why = 'odd answer: ' + txt.slice(0, 160);
    } else why = r.status + ' ' + txt.slice(0, 200);
  } catch (e) { why = 'openclaw down: ' + String(e && e.message || e).slice(0, 120); }
  if (!ALLOW_CLAUDE || hasImage(body.messages || [])) { console.log('chatgpt failed (no claude fallback): ' + why); return err(res, 503, 'ChatGPT is not available right now (' + why.slice(0, 120) + ').'); }
  console.log('gpt fallback to claude: ' + why);
  res.setHeader('x-erp-ai-engine', 'claude:fallback');
  return claudeChat({ ...body, model: 'claude-opus' }, res);
}

// ---------------------------------------------------------------- pictures (owner 1 Nov 2026: ad photos on the ChatGPT plan)
// OpenClaw's `infer image generate|edit` with gpt-image-2 on the ChatGPT login. A picture takes 40-90 s, longer than the
// ERP should wait, so it is a job: POST /v1/images/jobs {prompt, image?: data URL (the product's photo), size, quality,
// upload: {url, contentType}} -> {id}; the picture is PUT to the ERP's file store (a signed Supabase upload address only);
// GET /v1/images/jobs/<id> -> {state: queued|working|done|failed, error, bytes, revisedPrompt}. One picture at a time.
const OPENCLAW = process.env.OPENCLAW_BIN || '/home/admin/.npm-global/bin/openclaw';
const IMG_DIR = '/tmp/erp-img';
const STORE_RE = /^https:\/\/([a-z0-9-]+\.supabase\.co|erp-api\.costareen\.com)\/storage\/v1\//;   // 9 Nov 2026: the ERP files moved to the Mac (erp-api.costareen.com)
const imgJobs = new Map(); const imgQueue = []; let imgBusy = false;
const SIZES = ['1024x1024', '1024x1536', '1536x1024'];

function runOpenclaw(args, ms) {
  return new Promise((ok, bad) => {
    const p = spawn('/usr/sbin/runuser', ['-u', 'admin', '--', OPENCLAW, ...args], { cwd: '/home/admin', env: { ...process.env, HOME: '/home/admin', USER: 'admin', PATH: '/home/admin/.npm-global/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin' } });
    let out = '', e = '';
    const t = setTimeout(() => p.kill('SIGKILL'), ms);
    p.on('error', (x) => { clearTimeout(t); bad(new Error('could not start openclaw: ' + x.message)); });
    p.stdout.on('data', (d) => { out += d; });
    p.stderr.on('data', (d) => { e += d; });
    p.on('close', (code) => {
      clearTimeout(t);
      const at = out.indexOf('{');
      let j = null; try { j = at >= 0 ? JSON.parse(out.slice(at)) : null; } catch (_) { j = null; }
      if (code !== 0 || !j) return bad(new Error(((e || out).replace(/\s+/g, ' ').match(/(error|failed|limit|denied)[^.]{0,200}/i) || [(e || out).slice(-200)])[0].trim()));
      ok(j);
    });
  });
}
async function imgWork(job) {
  job.state = 'working'; job.started = Date.now();
  const out = IMG_DIR + '/' + job.id + '.' + job.ext;
  const args = ['infer', 'image', job.input ? 'edit' : 'generate', '--agent', 'main', '--model', 'openai/gpt-image-2', '--json', '--output', out,
    '--size', job.size, '--quality', job.quality, '--output-format', job.ext === 'jpg' ? 'jpeg' : 'png', '--prompt', job.prompt];
  if (job.input) args.push('--file', job.input);
  try {
    const j = await runOpenclaw(args, 240000);
    const o = (j.outputs || [])[0] || {};
    const bytes = readFileSync(o.path || out);
    const r = await fetch(job.upload.url, { method: 'PUT', headers: { 'Content-Type': job.upload.contentType, 'x-upsert': 'true' }, body: bytes });
    if (!r.ok) throw new Error('upload ' + r.status + ' ' + (await r.text()).slice(0, 120));
    Object.assign(job, { state: 'done', bytes: bytes.length, width: o.width || 0, height: o.height || 0, revisedPrompt: String(o.revisedPrompt || '').slice(0, 1500), model: j.model || 'gpt-image-2' });
  } catch (e) {
    Object.assign(job, { state: 'failed', error: String(e && e.message || e).slice(0, 300) });
    console.log('image job failed: ' + job.error);
  } finally {
    for (const f of [out, job.input]) if (f) { try { unlinkSync(f); } catch (_) { /* gone */ } }
    job.input = ''; job.ms = Date.now() - job.started;
  }
}
async function imgPump() {
  if (imgBusy) return;
  imgBusy = true;
  try { while (imgQueue.length) await imgWork(imgQueue.shift()); } finally { imgBusy = false; }
  const old = Date.now() - 2 * 3600e3;
  for (const [id, j] of imgJobs) if (j.created < old) imgJobs.delete(id);
}
function imgStart(body, res) {
  const prompt = String(body.prompt || '').trim().slice(0, 4000);
  if (!prompt) return err(res, 400, 'prompt?', 'invalid_request_error');
  const up = body.upload || {};
  if (!STORE_RE.test(String(up.url || ''))) return err(res, 400, 'nowhere to upload', 'invalid_request_error');
  if (imgQueue.length >= 6) return err(res, 429, 'Too many pictures waiting; try again in a few minutes.');
  const id = randomUUID().replace(/-/g, '');
  mkdirSync(IMG_DIR, { recursive: true, mode: 0o1777 }); chmodSync(IMG_DIR, 0o1777);
  let input = '';
  const m = /^data:image\/(png|jpe?g|webp);base64,(.+)$/s.exec(String(body.image || ''));
  if (m) { input = IMG_DIR + '/' + id + '-in.' + (m[1] === 'jpeg' ? 'jpg' : m[1]); writeFileSync(input, Buffer.from(m[2], 'base64'), { mode: 0o644 }); }
  const job = { id, state: 'queued', created: Date.now(), prompt, input, size: SIZES.includes(body.size) ? body.size : '1024x1024',
    quality: ['low', 'medium', 'high'].includes(body.quality) ? body.quality : 'medium', ext: /png/.test(up.contentType || '') ? 'png' : 'jpg',
    upload: { url: up.url, contentType: /png/.test(up.contentType || '') ? 'image/png' : 'image/jpeg' } };
  imgJobs.set(id, job); imgQueue.push(job); imgPump();
  return send(res, 200, { id, state: 'queued', waiting: imgQueue.length });
}
function imgStatus(id, res) {
  const j = imgJobs.get(id);
  if (!j) return err(res, 404, 'no such job');
  const { input, upload, prompt, ...pub } = j;
  return send(res, 200, pub);
}

const HANDLER = (req, res) => {
  const auth = String(req.headers.authorization || '');
  const personal = !!PERSONAL && auth === 'Bearer ' + PERSONAL;
  if (!personal && (!SECRET || auth !== 'Bearer ' + SECRET)) return err(res, 401, 'unauthorized', 'authentication_error');
  const path = req.url.replace(/^\/ai/, '').split('?')[0];
  if (personal && req.method === 'GET' && path === '/v1/accounts') return accStatus(res);
  if (req.method === 'GET' && path === '/v1/models') return send(res, 200, { object: 'list', data: MODELS.map((id) => ({ id, object: 'model', owned_by: 'erp-gateway' })) });
  const im = /^\/v1\/images\/jobs\/([0-9a-f]{32})$/.exec(path);
  if (req.method === 'GET' && im) return imgStatus(im[1], res);
  if (req.method !== 'POST' || (path !== '/v1/chat/completions' && path !== '/v1/images/jobs')) return err(res, 404, 'not found');
  let raw = '';
  req.on('data', (d) => { raw += d; if (raw.length > 20e6) req.destroy(); });
  req.on('end', () => {
    let body; try { body = JSON.parse(raw); } catch (_) { return err(res, 400, 'bad json', 'invalid_request_error'); }
    if (path === '/v1/images/jobs') { try { return imgStart(body, res); } catch (e) { return err(res, 500, String(e && e.message || e)); } }
    const m = String(body.model || 'gpt-5.6-terra');
    if (personal) return personalChat(req, body, res).catch((e) => err(res, 500, String(e && e.message || e)));
    const run = !ALLOW_CLAUDE ? openclawChat({ ...body, model: CLAUDE_AS_GPT[m] || (/^gpt|^o\d/.test(m) ? m : 'gpt-5.6-terra') }, res)
      : CLAUDE_MODEL[m] ? claudeChat(body, res) : /^gpt|^o\d/.test(m) ? openclawChat(body, res) : claudeChat({ ...body, model: 'claude-opus' }, res);
    run
      .catch((e) => err(res, 500, String(e && e.message || e)));
  });
};
http.createServer(HANDLER).listen(PORT, '127.0.0.1', () => console.log('erp-ai-gateway on 127.0.0.1:' + PORT));
// 15 Nov 2026: the brand bridge (a container) calls the gateway directly on the docker host address, so long Opus answers
// are not cut at Cloudflare's 100-second limit (HTTP 524). Same keys and rules; only containers on this Mac can reach it.
if (process.env.DOCKER_HOST_IP) http.createServer(HANDLER).listen(PORT, process.env.DOCKER_HOST_IP, () => console.log('erp-ai-gateway also on ' + process.env.DOCKER_HOST_IP + ':' + PORT));
