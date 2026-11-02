// brand-1 (owner 3 Nov 2026): the owner's personal-brand desk as a business of its own in the switch. The work is done
// by open-source tools on his PC (Postiz, a pacer, later Twenty, Chatwoot, Immich ...) behind one small "bridge" that
// is reached through Cloudflare Tunnel. The ERP stays the only face: these calls carry the screen's wishes to the
// bridge and bring the answers back. The office is open while the PC is on; the PC checks in every minute.
//
//   erpBrandDesk()                       online or not, the last check-in, and (when online) today's lines and posts
//   erpBrandDeskPost({networks, content, at?, urgent?})   one post to several networks, through the PC's pacer
//   erpBrandDeskDecide({id, action})     a post that was too late: send | drop
//   erpBrandDeskSetup({key})             owner: the bridge's key (sealed, never shown again)
//   erpBrandDeskHello({biz, url})        the PC: "I am on, here is my address" (owner's machine key, any active business)
//
// Researched first (owner rule "open source first"): Postiz does the posting, the pacer keeps one line per network so
// missed posts never go out in one burst; nothing generic is rebuilt here. Owner-only "Only me" app `branddesk`.
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig, getSecret, setSecret } from '../lib/ext.js';
import { platformAdmin } from './platform.js';
import { appIsOff } from './apps.js';

const str = (v) => String(v == null ? '' : v).trim();
const ONLINE_MS = 3 * 60e3, BRIDGE_MS = 20000;

async function gate(ctx) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner uses the brand desk.');
  if (!(await platformAdmin(ctx)) && await appIsOff(ctx.deps, ctx.sql, 'branddesk', ctx)) throw new Error('The brand desk is not open on this ERP yet.');
}

async function state(ctx) {
  let s = {}; try { s = JSON.parse(str(await getConfig(ctx, 'brand_bridge', '')) || '{}'); } catch (_) { s = {}; }
  const seen = s.seen ? new Date(s.seen) : null;
  return { url: str(s.url), seen, online: !!(seen && ctx.now - seen < ONLINE_MS) };
}

async function bridge(ctx, path, body) {
  const st = await state(ctx), key = await getSecret(ctx, 'BRAND_BRIDGE_KEY');
  if (!key) throw new Error('The brand desk is not set up yet: paste the bridge key under Set up.');
  if (!st.online || !st.url) throw new Error('Your PC is off, so the brand desk is closed. It opens again when the PC is on.');
  const f = (ctx.deps && ctx.deps.fetch) || fetch;
  let r;
  try {
    r = await f(st.url + path, { method: body ? 'POST' : 'GET', headers: { 'X-Bridge-Key': key, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(BRIDGE_MS) });
  } catch (_) { throw new Error('Your PC did not answer. If it was just switched on, wait a minute and try again.'); }
  const j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error('The PC refused the key: paste the bridge key again under Set up.');
  if (!r.ok) throw new Error(str(j.error) || ('The PC answered ' + r.status + '.'));
  return j;
}

export async function erpBrandDesk(ctx) {
  await gate(ctx);
  const st = await state(ctx), keySet = !!(await getSecret(ctx, 'BRAND_BRIDGE_KEY'));
  const out = { online: st.online, seen: st.seen ? st.seen.toISOString() : null, keySet, today: null, error: '' };
  if (st.online && keySet) { try { out.today = await bridge(ctx, '/today'); } catch (e) { out.error = e.message; } }
  return out;
}

export async function erpBrandDeskPost(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, nets = Array.isArray(p.networks) ? p.networks.filter((n) => n && str(n.id) && str(n.platform)) : [];
  if (!nets.length) throw new Error('Pick at least one network.');
  if (!str(p.content)) throw new Error('Write the post first.');
  if (str(p.content).length > 63000) throw new Error('The post is too long.');
  let at = null;
  if (p.at) { const d = new Date(p.at); if (isNaN(d)) throw new Error('The time is not a date.'); at = d.toISOString(); }
  const r = await bridge(ctx, '/post', { networks: nets.map((n) => ({ id: str(n.id), platform: str(n.platform) })), content: str(p.content), at, urgent: !!p.urgent });
  return { queued: (r.queued || []).length, desk: await erpBrandDesk(ctx) };
}

export async function erpBrandDeskDecide(ctx, payload) {
  await gate(ctx);
  const a = str(payload && payload.action);
  if (!['send', 'drop'].includes(a)) throw new Error('Choose send or drop.');
  await bridge(ctx, '/decide', { id: str(payload.id), action: a });
  return erpBrandDesk(ctx);
}

export async function erpBrandDeskSetup(ctx, payload) {
  await gate(ctx);
  const k = str(payload && payload.key);
  if (k.length < 20) throw new Error('That is not a bridge key (it is a long line of letters and numbers).');
  await setSecret(ctx, 'BRAND_BRIDGE_KEY', k);
  return erpBrandDesk(ctx);
}

// The PC calls this every minute with the owner's machine key. The owner's active business may be another one, so the
// business is named in the call and must be one he owns; the PC proves itself with the bridge key of that business.
export async function erpBrandDeskHello(ctx, payload) {
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner\'s PC checks in.');
  const p = payload || {}, biz = str(p.biz), url = str(p.url);
  const mine = await ctx.tx`select 1 from public.my_business_ids('owner') b(id) where b.id::text = ${biz}`;
  if (!mine.length) throw new Error('That business is not yours.');
  if (!/^https:\/\/[a-z0-9.-]+(\/.*)?$/i.test(url)) throw new Error('The address must start with https://');
  const c2 = { ...ctx, biz };
  if (str(p.key) !== await getSecret(c2, 'BRAND_BRIDGE_KEY') || !str(p.key)) throw new Error('Wrong bridge key.');
  await setConfig(c2, 'brand_bridge', JSON.stringify({ url: url.replace(/\/+$/, ''), seen: ctx.now.toISOString() }));
  return { ok: true };
}

export const HANDLERS = { erpBrandDesk, erpBrandDeskPost, erpBrandDeskDecide, erpBrandDeskSetup, erpBrandDeskHello };
