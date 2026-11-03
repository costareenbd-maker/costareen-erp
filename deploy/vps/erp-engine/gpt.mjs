// gpt-1 (owner 4 Nov 2026): "Claude is for me only; the Engine runs on my ChatGPT subscription". One Engine job on
// ChatGPT, through the ERP AI gateway on this VPS (127.0.0.1:18800 -> OpenClaw -> the owner's ChatGPT plan).
// Claude Code gave the job its tools by itself; here this file is the loop: ask the model, run the ONE function it
// asks for, give the result back, until it answers (at most MAX_TURNS). The functions:
//   - the ERP's functions handed out with the job (erpEngineTool: reads, and propose_* kept as proposals for his Yes)
//   - web_search (DuckDuckGo's plain HTML page) and web_fetch (a page as text)
//   - read_skill: the full text of one of the job's switched-on skills (their names and summaries are in the prompt)
//   - website_clear_cache / website_restart for the Watchdog, as before
// No shell, no files: a skill's code is never run.
import { siteAction, siteOf } from './site.mjs';

const AI_URL = process.env.AI_URL || 'http://127.0.0.1:18800/v1/chat/completions';
const AI_KEY = process.env.AI_KEY || '';
const MAX_TURNS = Number(process.env.MAX_TURNS || 14);
const strip = (h) => String(h).replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<noscript[\s\S]*?<\/noscript>/gi, ' ')
  .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"')
  .replace(/\s+/g, ' ').trim();
const UA = { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130 Safari/537.36' };

async function webSearch(q) {
  const r = await fetch('https://html.duckduckgo.com/html/?q=' + encodeURIComponent(q), { headers: UA, signal: AbortSignal.timeout(20000) });
  const h = await r.text(), out = [];
  const re = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a[^>]+class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
  let m;
  while ((m = re.exec(h)) && out.length < 8) {
    let url = m[1];
    const u = url.match(/[?&]uddg=([^&]+)/); if (u) url = decodeURIComponent(u[1]);
    out.push({ title: strip(m[2]), url, snippet: strip(m[3]) });
  }
  return out.length ? out : { note: 'No results (or the search page refused). Try other words.' };
}
async function webFetch(url) {
  if (!/^https?:\/\//i.test(String(url))) return { error: 'Give a full http(s) address.' };
  const r = await fetch(url, { headers: UA, redirect: 'follow', signal: AbortSignal.timeout(30000) });
  const t = strip(await r.text());
  return { status: r.status, text: t.slice(0, 20000) + (t.length > 20000 ? ' ... (cut)' : '') };
}

const fn = (name, description, properties, required) => ({ type: 'function', function: { name, description, parameters: { type: 'object', properties, required: required || [] } } });
const lower = (s) => {   // the ERP's tool list is written in Gemini's style (OBJECT, STRING)
  if (Array.isArray(s)) return s.map(lower);
  if (!s || typeof s !== 'object') return s;
  const o = {};
  for (const [k, v] of Object.entries(s)) o[k] = k === 'type' && typeof v === 'string' ? v.toLowerCase() : lower(v);
  return o;
};

/** One job on ChatGPT; resolves with the same shape as the Claude run: {ok, text, error, busy, skills, tokens}. */
export async function runGpt({ model, system, ask, job, tools, skills, biz, agent, erpTool, erpCall, onStep }) {
  const skillText = {};
  for (const s of skills || []) {
    const files = s.files || {}, main = Object.keys(files).find((k) => /skill\.md$/i.test(k)) || Object.keys(files)[0];
    skillText[s.slug] = Object.entries(files).sort(([a], [b]) => (a === main ? -1 : b === main ? 1 : 0)).map(([k, v]) => '## ' + k + '\n' + String(v)).join('\n\n').slice(0, 40000);
  }
  const site = agent === 'watchdog' && siteOf(biz);
  const list = [
    ...(tools || []).map((t) => fn(t.name, t.description + (/^propose_/.test(t.name) ? ' Nothing is written now: the owner confirms it in the ERP.' : ''), lower((t.parameters || {}).properties || {}), (t.parameters || {}).required)),
    fn('web_search', 'Search the web. Gives titles, links and snippets.', { query: { type: 'string' } }, ['query']),
    fn('web_fetch', 'Read one web page as text (first 20,000 letters).', { url: { type: 'string' } }, ['url']),
    ...(Object.keys(skillText).length ? [fn('read_skill', 'Read the full text of one of your skills before you follow it.', { slug: { type: 'string', enum: Object.keys(skillText) } }, ['slug'])] : []),
    ...(site ? [fn('website_clear_cache', 'Clear the website\'s page cache (old prices / stock, broken look, after a fix). Give why.', { why: { type: 'string' } }, ['why']),
      fn('website_restart', 'Restart the website and clear its cache - when pages are down, very slow or erroring. Give why.', { why: { type: 'string' } }, ['why'])] : []),
  ];
  const skillList = (skills || []).map((s) => '- ' + s.slug + (s.summary || s.description ? ': ' + String(s.summary || s.description).slice(0, 200) : '')).join('\n');
  const sys = system.replace(/mcp__erp__\.\.\./g, 'the ERP functions').replace(/WebSearch and WebFetch/g, 'web_search and web_fetch').replace(/load it with the Skill tool first/g, 'read it with read_skill first') +
    (skillList ? '\n\nYour skills (read one with read_skill when it fits):\n' + skillList : '') +
    '\n\nCall at most one function at a time. When you have what you need, write the final answer.';
  const msgs = [{ role: 'system', content: sys }, { role: 'user', content: ask }];
  const used = new Set(); let tokens = 0;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    let r, j;
    try {
      r = await fetch(AI_URL, { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + AI_KEY },
        body: JSON.stringify({ model, messages: msgs, tools: list }), signal: AbortSignal.timeout(200000) });
      j = await r.json().catch(() => null);
    } catch (e) { return { ok: false, text: '', error: 'The AI gateway did not answer: ' + String(e.message || e).slice(0, 200), busy: true, skills: [...used], tokens }; }
    if (!r.ok || !j || !j.choices) {
      const why = String((j && j.error && j.error.message) || ('HTTP ' + r.status)).slice(0, 400);
      return { ok: false, text: '', error: why, busy: /usage limit|rate.?limit|429|not available|busy|overloaded/i.test(why) || r.status >= 500, skills: [...used], tokens };
    }
    const u = j.usage || {}; tokens += (u.prompt_tokens || 0) + (u.completion_tokens || 0);
    const m = j.choices[0].message || {}, call = (m.tool_calls || [])[0];
    if (!call) {
      const text = String(m.content || '').trim();
      return { ok: !!text, text, error: text ? '' : 'ChatGPT gave an empty answer.', busy: false, skills: [...used], tokens };
    }
    const name = call.function.name; let args = {};
    try { args = JSON.parse(call.function.arguments || '{}'); } catch (_) { args = {}; }
    let out;
    try {
      if (name === 'web_search') { onStep('Searched the web: ' + String(args.query || '').slice(0, 160)); out = await webSearch(String(args.query || '')); }
      else if (name === 'web_fetch') { onStep('Read ' + String(args.url || '').slice(0, 160)); out = await webFetch(String(args.url || '')); }
      else if (name === 'read_skill') { const k = String(args.slug || ''); used.add(k); onStep('Used the skill ' + k); out = skillText[k] || { error: 'No such skill.' }; }
      else if (site && (name === 'website_clear_cache' || name === 'website_restart')) {
        const act = name === 'website_restart' ? 'restart' : 'clear_cache';
        out = await siteAction(biz, act);
        try { await erpCall('erpWatchSiteAction', { biz, action: act, ok: out.ok, text: out.text, why: String(args.why || ''), auto: true }); } catch (_) { /* the report is extra */ }
      } else {
        onStep('ERP: ' + name.replace(/_/g, ' ') + (Object.keys(args).length ? ' ' + JSON.stringify(args).slice(0, 120) : ''));
        out = await erpTool(name, args);
      }
    } catch (e) { out = { error: String(e.message || e).slice(0, 300) }; }
    const text = typeof out === 'string' ? out : JSON.stringify(out);
    msgs.push({ role: 'assistant', content: m.content || '', tool_calls: [call] });
    msgs.push({ role: 'tool', tool_call_id: call.id || name, name, content: text.length > 30000 ? text.slice(0, 30000) + '... (cut)' : text });
  }
  return { ok: false, text: '', error: 'Stopped after ' + MAX_TURNS + ' steps without a final answer.', busy: false, skills: [...used], tokens };
}
