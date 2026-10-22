// ai-1 (owner 22 Oct 2026): Settings > AI brain - which AI does which work, and the keys behind them.
//
//   erpAiBrain()                       the providers (key set?), the choice per kind of work, this month's AI use
//   erpAiBrainSet({routes})            owner: the choices (provider + model per task; web search on/off)
//   erpAiBrainKey({provider, key, base})  platform admin: a provider's API key (sealed; never read back)
//   erpAiBrainModels({provider})       the models the key can use, strongest first
//   erpAiBrainTest({provider, model, web})  one small request, so a wrong key / model shows now
// The keys are the provider's (platform) secrets - every company on the platform uses them; a company's own choices
// are its business_config 'ai_routes'. A ChatGPT / Claude chat subscription is not an API key: the ERP needs the
// API keys (platform.openai.com, console.anthropic.com, aistudio.google.com).

import { roleAtLeast } from '../allow.js';
import { platformAdmin } from './platform.js';
import { sealJSON } from '../lib/bridge.js';
import { formatDate } from '../lib/time.js';
import { PROVIDERS, TASKS, providerKeys, routes, saveRoutes, bestModels, ai } from '../lib/ai.js';

const str = (v) => String(v == null ? '' : v).trim();
const ctl = (ctx) => (ctx.deps && ctx.deps.control) || ctx.sql;
const KEY_RE = { openai: /^sk-[A-Za-z0-9_-]{20,300}$/, anthropic: /^sk-ant-[A-Za-z0-9_-]{20,300}$/, gemini: /^[A-Za-z0-9_-]{20,120}$/, custom: /^\S{1,300}$/ };

function owner(ctx) { if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner chooses the AI.'); }

export async function erpAiBrain(ctx) {
  owner(ctx);
  const keys = await providerKeys(ctx), R = await routes(ctx), admin = await platformAdmin(ctx);
  const since = formatDate(new Date(ctx.now.getTime() - 30 * 86400e3), 'yyyy-MM-dd');
  let use = [];
  try {
    use = (await ctx.tx.savepoint((t) => t`select model, count(*)::int as n, coalesce(sum(tokens_in), 0)::bigint as tin, coalesce(sum(tokens_out), 0)::bigint as tout, round(coalesce(sum(cost_bdt), 0)::numeric, 2) as bdt
                        from ai_work where business_id = ${ctx.biz} and at >= ${since} group by model order by 5 desc limit 20`))
      .map((r) => ({ model: str(r.model), n: r.n, tokensIn: Number(r.tin), tokensOut: Number(r.tout), bdt: Number(r.bdt) }));
  } catch (_) { use = []; }
  return {
    providers: Object.keys(PROVIDERS).map((p) => ({ key: p, name: PROVIDERS[p].name, set: !!keys[p] && (p !== 'custom' || !!keys.customBase), last4: keys[p] ? keys[p].slice(-4) : '',
      base: p === 'custom' ? keys.customBase : '', web: PROVIDERS[p].web, vision: PROVIDERS[p].vision, pdf: PROVIDERS[p].pdf, audio: PROVIDERS[p].audio })),
    tasks: Object.keys(TASKS).map((t) => ({ key: t, name: TASKS[t] })), routes: R, canSetKeys: admin, use,
  };
}

export async function erpAiBrainSet(ctx, payload) {
  owner(ctx);
  const p = (payload && payload.routes) || {};
  const one = (x) => {
    const provider = ['auto', 'default', ...Object.keys(PROVIDERS)].includes(str(x && x.provider)) ? str(x.provider) : 'auto';
    const model = str(x && x.model).slice(0, 80) || 'auto';
    if (!/^[A-Za-z0-9._:\/-]+$/.test(model)) throw new Error('A model name is letters, digits, dots and dashes.');
    return { provider, model };
  };
  const out = { default: one(p.default), tasks: {}, web: p.web !== false,
    // ai-1b: the kinds of work tried first on Gemini's free tier (customer chat by default)
    cheap: Array.isArray(p.cheap) ? p.cheap.filter((t) => TASKS[t]) : ['chat'] };
  for (const t of Object.keys(TASKS)) if (t !== 'default' && p.tasks && p.tasks[t]) out.tasks[t] = one(p.tasks[t]);
  await saveRoutes(ctx, out);
  return erpAiBrain(ctx);
}

export async function erpAiBrainKey(ctx, payload) {
  if (!(await platformAdmin(ctx))) throw new Error('Only the platform admin sets the AI keys.');
  const p = payload || {}, provider = str(p.provider);
  if (!PROVIDERS[provider]) throw new Error('Which AI?');
  const key = str(p.key);
  const c = ctl(ctx), name = PROVIDERS[provider].secret;
  const put = async (k, v) => {
    const enc = ctx.deps.bridgeKey ? await sealJSON(ctx.deps.bridgeKey, { v }) : 'v0.' + v;
    await c`insert into erp_provider_secrets (key, value_enc, updated_at, updated_by) values (${k}, ${enc}, now(), ${ctx.s.userId})
             on conflict (key) do update set value_enc = excluded.value_enc, updated_at = now(), updated_by = excluded.updated_by`;
  };
  if (provider === 'custom') {
    const base = str(p.base).replace(/\/+$/, '');
    if (base && !/^https?:\/\/[^\s]+$/.test(base)) throw new Error('The server address is like https://ai.example.com/v1');
    if (base) await put('CUSTOM_AI_BASE', base); else if (p.base !== undefined) await c`delete from erp_provider_secrets where key = 'CUSTOM_AI_BASE'`;
  }
  if (!key) { if (p.remove) await c`delete from erp_provider_secrets where key = ${name}`; }
  else {
    if (!KEY_RE[provider].test(key)) throw new Error('That does not look like a ' + PROVIDERS[provider].name + ' API key.' + (provider === 'openai' ? ' It starts with sk-.' : provider === 'anthropic' ? ' It starts with sk-ant-.' : ''));
    await put(name, key);
  }
  ctx.memo = {};
  return erpAiBrain(ctx);
}

export async function erpAiBrainModels(ctx, payload) {
  owner(ctx);
  const provider = str(payload && payload.provider);
  if (!PROVIDERS[provider]) throw new Error('Which AI?');
  const keys = await providerKeys(ctx);
  if (!keys[provider]) throw new Error('No ' + PROVIDERS[provider].name + ' key is set.');
  ctx.memo = {};
  return { provider, models: (await bestModels(ctx, provider, keys)).slice(0, 40) };
}

export async function erpAiBrainTest(ctx, payload) {
  owner(ctx);
  const p = payload || {}, provider = str(p.provider);
  if (!PROVIDERS[provider]) throw new Error('Which AI?');
  const t0 = Date.now();
  const r = await ai(ctx, { provider, model: str(p.model) || 'auto', purpose: 'test-brain', task: 'default', web: !!p.web, maxTokens: 400,
    messages: [{ role: 'user', content: [{ type: 'text', text: p.web ? 'Search the web: what is today\'s date and one headline from Bangladesh today? Answer in one short line.' : 'Reply with: OK - and your model name.' }] }] });
  return { ok: true, provider: r.provider, model: r.model, text: str(r.text).slice(0, 400), ms: Date.now() - t0 };
}

export const HANDLERS = { erpAiBrain, erpAiBrainSet, erpAiBrainKey, erpAiBrainModels, erpAiBrainTest };
