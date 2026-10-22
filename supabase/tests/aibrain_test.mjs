// ai-1 (owner 22 Oct 2026): one AI layer - ChatGPT (OpenAI), Claude (Anthropic), Gemini, or an own OpenAI-compatible server
// (OpenClaw / OmniRoute on the VPS) - chosen per kind of work under Settings > AI brain, the strongest model first, the
// others as fallback; the same powers on each (tools, web search, photos, JSON).
import { sql, FIX, owner, mgr, web, check, done, deps, fnDir } from './harness.mjs';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
const A = await import(pathToFileURL(path.join(fnDir, 'lib', 'ai.js')));
const jobs = await import(pathToFileURL(path.join(fnDir, 'jobs.js')));
const asB = async (fn) => { const rows = await jobs.owners(sql, [FIX.B]); return jobs.asBusiness(deps, rows[0], 'test', fn); };

const seen = { openai: [], anthropic: [], gemini: [], custom: [] };
let fail = {};
web.on(/api\.openai\.com\/v1\/responses/, (url, o) => {
  const b = JSON.parse(o.body); seen.openai.push({ b, h: o.headers });
  if (fail.openai) return { status: 500, body: { error: { message: 'down' } } };
  const toolResult = (b.input || []).some((x) => x.type === 'function_call_output');
  if ((b.tools || []).some((t) => t.name === 'stock_of') && !toolResult) return { body: { output: [{ type: 'function_call', call_id: 'call_1', name: 'stock_of', arguments: '{"sku":"pla-b"}' }], usage: { input_tokens: 10, output_tokens: 5 } } };
  return { body: { output: [{ type: 'message', content: [{ type: 'output_text', text: toolResult ? 'There are 7.' : b.text && b.text.format ? '{"ok":true}' : 'OK from GPT' }] }], usage: { input_tokens: 12, output_tokens: 4 } } };
});
web.on(/api\.anthropic\.com\/v1\/messages/, (url, o) => {
  const b = JSON.parse(o.body); seen.anthropic.push({ b, h: o.headers });
  if (fail.anthropic) return { status: 529, body: { error: { type: 'overloaded_error', message: 'Overloaded' } } };
  return { body: { content: [{ type: 'text', text: 'OK from Claude' }], usage: { input_tokens: 20, output_tokens: 6 } } };
});
let gemNext = null;
web.on(/generativelanguage\.googleapis\.com/, (url, o) => { seen.gemini.push({ url, b: o.body ? JSON.parse(o.body) : null }); const p = gemNext ? gemNext() : [{ text: 'OK from Gemini' }]; return { body: { candidates: [{ content: { parts: p } }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 2 } } }; });
web.on(/my-vps\.test\/v1\/chat\/completions/, (url, o) => { seen.custom.push({ b: JSON.parse(o.body), h: o.headers }); return { body: { choices: [{ message: { content: 'OK from my server' } }], usage: { prompt_tokens: 3, completion_tokens: 2 } } }; });

// ---- nothing set
let r = await owner('erpAiBrain', []); 
check('the AI brain lists ChatGPT, Claude, Gemini and an own server; no key yet', r.ok && r.result.providers.map((p) => p.key).join() === 'openai,anthropic,gemini,custom' && r.result.providers.every((p) => !p.set), r.result && r.result.providers);
r = await mgr('erpAiBrain', []);
check('only the owner chooses the AI', !r.ok, r);

// ---- keys (the platform admin)
r = await owner('erpAiBrainKey', [{ provider: 'openai', key: 'not-a-key' }]);
const admin = !(r.ok === false && /platform admin/.test(r.error));
check('a key that is not an OpenAI key is refused', !r.ok, r);
if (!admin) await sql`insert into platform_admins (user_id, note) values (${FIX.U.owner}, 'test') on conflict do nothing`;
r = await owner('erpAiBrainKey', [{ provider: 'openai', key: 'sk-test-fake-key-0000-ijkl' }]);
check('the ChatGPT key is kept (sealed) and shown only by its last 4', r.ok && r.result.providers.find((p) => p.key === 'openai').set && r.result.providers.find((p) => p.key === 'openai').last4 === 'ijkl', r.result && r.result.providers);
await owner('erpAiBrainKey', [{ provider: 'anthropic', key: 'sk-ant-test-fake-key-0000-abcd' }]);
await owner('erpAiBrainKey', [{ provider: 'custom', key: 'vps-secret', base: 'https://my-vps.test/v1' }]);
const raw = (await sql`select value_enc from erp_provider_secrets where key = 'OPENAI_KEY'`)[0];
check('...never stored in plain text when the server has a sealing key', raw && (!deps.bridgeKey || raw.value_enc.startsWith('v1.')), raw);

// ---- the owner relies on ChatGPT: with no choice made, ChatGPT answers, the strongest model first
let x = await asB((ctx) => A.ai(ctx, { purpose: 'social', system: 'Be brief.', messages: [{ role: 'user', content: [{ type: 'text', text: 'Hi' }] }] }));
check('auto: ChatGPT answers first', x.provider === 'openai' && x.text === 'OK from GPT' && seen.openai[0].b.model === 'gpt-5.1' && seen.openai[0].b.instructions === 'Be brief.', { x, m: seen.openai[0] && seen.openai[0].b.model });
check('...with its key as a bearer token', /^Bearer sk-test/.test(seen.openai[0].h.authorization), seen.openai[0].h);

// web search, a photo and JSON on ChatGPT
x = await asB((ctx) => A.ai(ctx, { purpose: 'leads-find', web: true, json: true, messages: [{ role: 'user', content: [{ type: 'text', text: 'Find' }, { type: 'image', mime: 'image/png', data: 'AAAA' }] }] }));
const ob = seen.openai[seen.openai.length - 1].b;
check('ChatGPT gets the web search tool and the photo', ob.tools.some((t) => t.type === 'web_search') && ob.input[0].content.some((c) => c.type === 'input_image' && /^data:image\/png;base64,AAAA$/.test(c.image_url)), ob);

// tools: a round trip
x = await asB((ctx) => A.aiTools(ctx, { purpose: 'assistant', system: 's', messages: [{ role: 'user', content: [{ type: 'text', text: 'How many black?' }] }],
  tools: [{ name: 'stock_of', description: 'stock', parameters: { type: 'OBJECT', properties: { sku: { type: 'STRING' } } } }], run: async (n, a) => ({ sku: a.sku, stock: 7 }) }));
const tb = seen.openai[seen.openai.length - 1].b;
check('tools: the ERP function is called and its answer goes back to the AI', x.text === 'There are 7.' && x.calls[0].name === 'stock_of' && x.calls[0].args.sku === 'pla-b' &&
  tb.input.some((i) => i.type === 'function_call_output' && /"stock":7/.test(i.output)) && tb.tools[0].parameters.properties.sku.type === 'string', { x, tb: tb.input });

// ---- the owner switches: Claude for the Inbox, his own server for writing
r = await owner('erpAiBrainSet', [{ routes: { default: { provider: 'auto', model: 'auto' }, tasks: { chat: { provider: 'anthropic', model: 'claude-opus-5-5' }, write: { provider: 'custom', model: 'gpt-5' } } } }]);
check('choices are kept per kind of work', r.ok && r.result.routes.tasks.chat.provider === 'anthropic' && r.result.routes.tasks.write.provider === 'custom', r.result && r.result.routes);
x = await asB((ctx) => A.ai(ctx, { purpose: 'reply', system: 'You sell filament.', web: true, messages: [{ role: 'user', content: [{ type: 'text', text: 'dam koto?' }] }] }));
const cb = seen.anthropic[seen.anthropic.length - 1];
check('Inbox work goes to Claude, the chosen model, with web search and the system prompt', x.provider === 'anthropic' && cb.b.model === 'claude-opus-5-5' && cb.b.system === 'You sell filament.' &&
  cb.b.tools.some((t) => t.type === 'web_search_20250305') && cb.h['x-api-key'].startsWith('sk-ant-'), cb.b);
x = await asB((ctx) => A.ai(ctx, { purpose: 'social', messages: [{ role: 'user', content: [{ type: 'text', text: 'caption' }] }] }));
check('writing goes to the own server (OpenClaw / OmniRoute on the VPS) at its address', x.provider === 'custom' && x.text === 'OK from my server' && seen.custom[0].b.model === 'gpt-5' && seen.custom[0].h.authorization === 'Bearer vps-secret', seen.custom[0]);

// ---- fallback: Claude overloaded -> the next one with a key answers; the business keeps working
fail.anthropic = true;
x = await asB((ctx) => A.ai(ctx, { purpose: 'reply', messages: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] }));
check('Claude down: ChatGPT answers instead', x.provider === 'openai' && x.text === 'OK from GPT', x);
fail.anthropic = false;

// ---- every call is logged with the provider and the model
const w = await sql`select model, tokens_in from ai_work where business_id = ${FIX.B} order by at`;
check('every AI call is written to the AI cost log with provider:model', w.some((r) => r.model === 'openai:gpt-5.1') && w.some((r) => r.model === 'anthropic:claude-opus-5-5') && w.some((r) => r.model === 'custom:gpt-5'), w);

// ---- Gemini-shaped old calls still work, through the router
const G = await import(pathToFileURL(path.join(fnDir, 'lib', 'gemini.js')));
x = await asB((ctx) => G.gemini(ctx, { systemInstruction: { parts: [{ text: 'sys' }] }, contents: [{ role: 'user', parts: [{ text: 'old style' }] }], generationConfig: { temperature: 0.2, responseMimeType: 'application/json' } }, 'digest'));
const ob2 = seen.openai[seen.openai.length - 1].b;
check('an old Gemini-shaped call is answered by the chosen AI (JSON asked, system kept)', /^openai:/.test(x.model) && ob2.instructions.startsWith('sys') && ob2.text && ob2.text.format.type === 'json_object', ob2);

// ---- test button and models
r = await owner('erpAiBrainTest', [{ provider: 'anthropic' }]);
check('the Test button asks one small question of the chosen AI', r.ok && r.result.provider === 'anthropic' && /Claude/.test(r.result.text), r);
r = await owner('erpAiBrainModels', [{ provider: 'gemini' }]);
check('no Gemini key: says so', !r.ok && /No Gemini/.test(r.error), r);

// ---- ai-1b: Gemini's free tier first on customer chat; complex or failed -> the strong AI; free models the last net
await owner('erpAiBrainKey', [{ provider: 'gemini', key: 'gm-test-fake-key-0000-0000-abcd' }]);
await owner('erpAiBrainSet', [{ routes: { default: { provider: 'openai', model: 'auto' }, tasks: {}, cheap: ['chat'] } }]);
const nG = seen.gemini.length, nO = seen.openai.length;
x = await asB((ctx) => A.ai(ctx, { purpose: 'reply', system: 'shop', messages: [{ role: 'user', content: [{ type: 'text', text: 'PLA black ache?' }] }] }));
check('a plain customer question: Gemini\'s free-tier model answers, the paid AI is not called', x.provider === 'gemini' && x.tier === 'cheap' && /gemini-2\.5-flash/.test(seen.gemini[seen.gemini.length - 1].url) && seen.openai.length === nO, { x, url: seen.gemini[seen.gemini.length - 1].url });
x = await asB((ctx) => A.ai(ctx, { purpose: 'reply', system: 'shop', messages: [{ role: 'user', content: [{ type: 'text', text: 'My printer is broken after 2 days, I want a refund' }] }] }));
check('a complaint goes straight to the strong AI (ChatGPT)', x.provider === 'openai' && seen.gemini.length === nG + 1, x);
gemNext = () => [{ text: '[SENIOR]' }];
x = await asB((ctx) => A.ai(ctx, { purpose: 'comment', system: 'shop', messages: [{ role: 'user', content: [{ type: 'text', text: 'which nozzle for CF?' }] }] }));
check('the free model is not sure ([SENIOR]): the strong AI answers', x.provider === 'openai', x);
gemNext = () => [{ functionCall: { name: 'hand_to_senior', args: { reason: 'technical' } } }];
x = await asB((ctx) => A.aiTools(ctx, { purpose: 'reply', system: 'shop', messages: [{ role: 'user', content: [{ type: 'text', text: 'how do I set z offset' }] }], tools: [{ name: 'stock_of', description: 's', parameters: { type: 'OBJECT', properties: {} } }], run: async () => ({}) }));
check('the Inbox agent: the free model hands over (hand_to_senior) and the strong AI answers', x.tier === 'strong' && /handed over: technical/.test(x.escalated) && x.provider === 'openai', x);
gemNext = null;
x = await asB((ctx) => A.ai(ctx, { purpose: 'analyze', messages: [{ role: 'user', content: [{ type: 'text', text: 'summary' }] }] }));
check('other work (not "free first") goes to the main AI', x.provider === 'openai', x);
fail.openai = true; fail.anthropic = true;
x = await asB((ctx) => A.ai(ctx, { purpose: 'analyze', messages: [{ role: 'user', content: [{ type: 'text', text: 'summary' }] }] }));
check('every paid AI down: Gemini\'s free model is the last safety net', x.provider === 'gemini', x);
fail.openai = false; fail.anthropic = false;

// ---- removing a key
r = await owner('erpAiBrainKey', [{ provider: 'openai', key: '', remove: true }]);
check('a key can be removed', r.ok && !r.result.providers.find((p) => p.key === 'openai').set, r.result && r.result.providers);
await done();
