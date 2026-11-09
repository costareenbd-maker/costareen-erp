// brand-1 (owner 3 Nov 2026): the owner's personal-brand desk as a business of its own in the switch. The work is done
// by open-source tools on his PC (Postiz, a pacer, later Twenty, Chatwoot, Immich ...) behind one small "bridge" that
// is reached through Cloudflare Tunnel. The ERP stays the only face: these calls carry the screen's wishes to the
// bridge and bring the answers back. The office is open while the PC is on; the PC checks in every minute.
//
//   erpBrandDesk()                       online or not, the last check-in, and (when online) today's lines and posts
//   erpBrandDeskPost({networks, content, at?, urgent?})   one post to several networks, through the PC's pacer
//   erpBrandDeskDecide({id, action})     a post that was too late: send | drop
//   erpBrandDeskSetup({key})             owner: the bridge's key (sealed, never shown again); marks the business kind 'brand'
//   erpBrandDeskBoard()                  brand-2: the content board (Kanboard on the PC): Idea -> ... -> Repurposed
//   erpBrandDeskCard({title, description?, tags?, column?})   a new card
//   erpBrandDeskMove({id, column})       a card to another step;  erpBrandDeskDone({id}) a card finished (closed)
//   erpBrandDeskIdeas()                  brand-3: the idea bank (Memos on the PC), newest first
//   erpBrandDeskIdea({content})          a new idea;  erpBrandDeskIdeaToBoard({id}) the idea becomes a card in Idea
//   erpBrandDeskPeople()                 brand-4: people met through the content (Twenty on the PC)
//   erpBrandDeskPerson({name, email?, phone?, job?, audience?, about?, source?})   a new person
//   erpBrandDeskToLeads({id, business})  that person becomes a lead of one of the owner's businesses (its Leads menu)
//   erpBrandDeskVideos({q?})             brand-5: the footage library (Immich on the PC): newest, or found by meaning
//                                        ("me talking in the shop"), with a small preview each
//   erpBrandDeskShorts()                 brand-6: the shorts being made / made (OpenShorts on the PC, local AI)
//   erpBrandDeskMakeShorts({id})         one video -> 9:16 clips with captions; the clips land in the footage library
//   erpBrandDeskHello({biz, url})        the PC: "I am on, here is my address" (owner's machine key, any active business)
//
// Researched first (owner rule "open source first"): Postiz does the posting, the pacer keeps one line per network so
// missed posts never go out in one burst; nothing generic is rebuilt here. Owner-only "Only me" app `branddesk`.
import { roleAtLeast } from '../allow.js';
import { getConfig, setConfig, getSecret, setSecret } from '../lib/ext.js';
import { platformAdmin } from './platform.js';
import { addLead } from './leads.js';
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
  // brand-7: the claim check runs before anything is queued; a 'block' stops the post (warnings only show)
  const hits = ((await bridge(ctx, '/lint', { text: str(p.content) })).hits) || [];
  const blocks = hits.filter((h) => h && h.severity === 'block');
  if (blocks.length) throw new Error('Not sent - the claim check stopped it: ' + blocks.map((h) => str(h.reason) + (h.match ? ' ("' + str(h.match) + '")' : '')).join(' · '));
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

// brand-7: settings live in the brand core database on the Mac; the ERP is the screen and checks every number first
export async function erpBrandDeskSettings(ctx) {
  await gate(ctx);
  return bridge(ctx, '/settings');
}
export async function erpBrandDeskWeights(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, platform = str(p.platform).toLowerCase();
  if (!/^[a-z_]{2,20}$/.test(platform)) throw new Error('Pick a platform.');
  const w = p.weights && typeof p.weights === 'object' ? p.weights : null;
  if (!w || !Object.keys(w).length) throw new Error('Give each topic a share.');
  const clean = {};
  for (const [k, v] of Object.entries(w)) {
    if (!/^[a-z0-9_]{2,40}$/.test(k)) throw new Error('A topic name is not right.');
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 100) throw new Error('Each share is a whole number from 0 to 100.');
    clean[k] = n;
  }
  const sum = Object.values(clean).reduce((a, b) => a + b, 0);
  if (sum !== 100) throw new Error('The shares of ' + platform + ' add up to ' + sum + ', not 100.');
  return bridge(ctx, '/settings/weights', { platform, weights: clean });
}
export async function erpBrandDeskCadence(ctx, payload) {
  await gate(ctx);
  const level = str(payload && payload.level);
  if (!['start', 'scale'].includes(level)) throw new Error('Choose start or scale.');
  return bridge(ctx, '/settings/cadence', { level });
}
export async function erpBrandDeskLint(ctx, payload) {
  await gate(ctx);
  const text = str(payload && payload.text);
  if (!text) return { hits: [] };
  if (text.length > 63000) throw new Error('The text is too long.');
  return bridge(ctx, '/lint', { text });
}

// brand-8: nothing is posted from a draft until the owner approves it here; the bridge checks the claims again
const DRAFT_PLATFORMS = ['linkedin', 'facebook', 'instagram', 'youtube', 'threads', 'tiktok'];
export async function erpBrandDeskDrafts(ctx) {
  await gate(ctx);
  return bridge(ctx, '/drafts');
}
export async function erpBrandDeskMakeDrafts(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = p.idea_id == null || p.idea_id === '' ? null : parseInt(p.idea_id, 10), text = str(p.text);
  if (id === null && !text) throw new Error('Pick an idea or write one.');
  if (id !== null && !(id > 0)) throw new Error('Pick an idea.');
  if (text.length > 2000) throw new Error('Keep the idea under 2000 letters; the AI writes the rest.');
  const plats = (Array.isArray(p.platforms) ? p.platforms : []).map((x) => str(x).toLowerCase()).filter((x) => DRAFT_PLATFORMS.includes(x));
  const body = { platforms: [...new Set(plats)].slice(0, 4) };
  if (id !== null) body.idea_id = id; else { body.text = text; if (/^[a-z0-9_]{2,40}$/.test(str(p.topic))) body.topic = str(p.topic); }
  return bridge(ctx, '/drafts/make', body);
}
export async function erpBrandDeskDraftDecide(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, id = parseInt(p.id, 10), action = str(p.action);
  if (!(id > 0)) throw new Error('Pick a draft.');
  if (!['approve', 'reject', 'manual'].includes(action)) throw new Error('Approve or reject.');
  if (action === 'reject') return bridge(ctx, '/drafts/decide', { id, action, note: str(p.note).slice(0, 500) });
  // brand-9: posted by hand (Facebook profile, or an account not connected): no account, the record is kept
  if (action === 'manual') {
    const link = str(p.url);
    if (link && !/^https:\/\/[^\s]{4,490}$/i.test(link)) throw new Error('The link must start with https://');
    const m = { id, action };
    if (str(p.body)) m.body = str(p.body).slice(0, 63000);
    if (link) m.url = link;
    return bridge(ctx, '/drafts/decide', m);
  }
  const nets = Array.isArray(p.networks) ? p.networks.filter((n) => n && str(n.id) && str(n.platform)).map((n) => ({ id: str(n.id), platform: str(n.platform) })) : [];
  if (!nets.length) throw new Error('Pick the account it goes to.');
  const text = str(p.body);
  if (text.length > 63000) throw new Error('The post is too long.');
  let at = null;
  if (p.at) { const d = new Date(p.at); if (isNaN(d)) throw new Error('The time is not a date.'); at = d.toISOString(); }
  const out = { id, action, networks: nets, at };
  if (text) out.body = text;
  return bridge(ctx, '/drafts/decide', out);
}

export const PILLARS = ['story', 'lesson', 'behind the scenes', 'market', 'announcement'];
export const AUDIENCES = ['customer', 'supplier', 'brand'];
const num = (v) => { const n = parseInt(v, 10); if (!(n > 0)) throw new Error('Pick a card.'); return n; };

export async function erpBrandDeskBoard(ctx) {
  await gate(ctx);
  return { board: await bridge(ctx, '/board'), pillars: PILLARS, audiences: AUDIENCES };
}
export async function erpBrandDeskCard(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, title = str(p.title);
  if (!title) throw new Error('Give the card a title.');
  if (title.length > 200) throw new Error('The title is too long (200 letters at most).');
  const tags = (Array.isArray(p.tags) ? p.tags : []).map((t) => str(t).toLowerCase().slice(0, 40)).filter(Boolean).slice(0, 8);
  const body = { title, description: str(p.description).slice(0, 5000), tags };
  if (p.column) body.column = num(p.column);
  return { board: await bridge(ctx, '/board/card', body), pillars: PILLARS, audiences: AUDIENCES };
}
export async function erpBrandDeskMove(ctx, payload) {
  await gate(ctx);
  return { board: await bridge(ctx, '/board/move', { id: num(payload && payload.id), column: num(payload && payload.column) }), pillars: PILLARS, audiences: AUDIENCES };
}
export async function erpBrandDeskDone(ctx, payload) {
  await gate(ctx);
  return { board: await bridge(ctx, '/board/done', { id: num(payload && payload.id) }), pillars: PILLARS, audiences: AUDIENCES };
}

const ideaId = (v) => { const s = str(v); if (!/^[A-Za-z0-9_-]{4,64}$/.test(s)) throw new Error('Pick an idea.'); return s; };
export async function erpBrandDeskIdeas(ctx) {
  await gate(ctx);
  return bridge(ctx, '/ideas');
}
export async function erpBrandDeskIdea(ctx, payload) {
  await gate(ctx);
  const c = str(payload && payload.content);
  if (!c) throw new Error('Write the idea first.');
  if (c.length > 8000) throw new Error('The idea is too long.');
  return bridge(ctx, '/ideas', { content: c });
}
export async function erpBrandDeskIdeaToBoard(ctx, payload) {
  await gate(ctx);
  return bridge(ctx, '/ideas/board', { id: ideaId(payload && payload.id) });
}

export async function erpBrandDeskPeople(ctx) {
  await gate(ctx);
  return { ...(await bridge(ctx, '/people')), audiences: AUDIENCES, businesses: await leadTargets(ctx) };
}
export async function erpBrandDeskPerson(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, name = str(p.name);
  if (!name) throw new Error('Write the name.');
  if (p.email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(str(p.email))) throw new Error('That e-mail does not look right.');
  const body = { name: name.slice(0, 200), email: str(p.email).slice(0, 200), phone: str(p.phone).slice(0, 40), job: str(p.job).slice(0, 200),
    audience: AUDIENCES.includes(str(p.audience)) ? str(p.audience) : '', about: str(p.about).toLowerCase().slice(0, 40), source: str(p.source).slice(0, 500) };
  return { ...(await bridge(ctx, '/people', body)), audiences: AUDIENCES, businesses: await leadTargets(ctx) };
}
// the owner's businesses a person can be handed to: every one he owns except brand desks and joint pools
async function leadTargets(ctx) {
  const rows = await ctx.tx`select b.id, b.name from businesses b where b.id in (select public.my_business_ids('owner'))
                            and coalesce(b.is_pool, false) = false
                            and not exists (select 1 from business_config c where c.business_id = b.id and c.key = 'business_kind' and c.value = 'brand')
                            order by b.name`;
  return rows.map((r) => ({ id: String(r.id), name: r.name }));
}
export async function erpBrandDeskToLeads(ctx, payload) {
  await gate(ctx);
  const p = payload || {}, target = str(p.business);
  if (!(await leadTargets(ctx)).some((b) => b.id === target)) throw new Error('Pick one of your businesses.');
  const list = (await bridge(ctx, '/people')).people || [], who = list.find((x) => x.id === str(p.id));
  if (!who) throw new Error('That person is not on the list any more.');
  const r = await addLead({ ...ctx, biz: target, memo: {} }, {
    kind: who.audience === 'customer' ? 'customer' : 'supplier', name: who.name, email: who.email, phone: who.phone,
    want: who.job, ref: 'branddesk:' + who.id, note: 'From the brand desk' + (who.source ? ' - came from: ' + who.source : '') + (who.audience === 'brand' ? ' (a brand)' : ''),
  });
  return { added: r.added, business: target };
}

export async function erpBrandDeskVideos(ctx, payload) {
  await gate(ctx);
  const q = str(payload && payload.q).slice(0, 200);
  return bridge(ctx, '/videos' + (q ? '?q=' + encodeURIComponent(q) : ''));
}

export async function erpBrandDeskShorts(ctx) {
  await gate(ctx);
  return bridge(ctx, '/shorts');
}
export async function erpBrandDeskMakeShorts(ctx, payload) {
  await gate(ctx);
  const id = str(payload && payload.id);
  if (!/^[0-9a-f-]{20,64}$/i.test(id)) throw new Error('Pick a video.');
  return bridge(ctx, '/shorts', { id });
}

export async function erpBrandDeskSetup(ctx, payload) {
  await gate(ctx);
  const k = str(payload && payload.key);
  if (k.length < 20) throw new Error('That is not a bridge key (it is a long line of letters and numbers).');
  await setSecret(ctx, 'BRAND_BRIDGE_KEY', k);
  await setConfig(ctx, 'business_kind', 'brand');   // brand-2: this business now shows the brand menu only
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

export const HANDLERS = { erpBrandDesk, erpBrandDeskDrafts, erpBrandDeskMakeDrafts, erpBrandDeskDraftDecide, erpBrandDeskSettings, erpBrandDeskWeights, erpBrandDeskCadence, erpBrandDeskLint, erpBrandDeskShorts, erpBrandDeskMakeShorts, erpBrandDeskVideos, erpBrandDeskPeople, erpBrandDeskPerson, erpBrandDeskToLeads, erpBrandDeskIdeas, erpBrandDeskIdea, erpBrandDeskIdeaToBoard, erpBrandDeskBoard, erpBrandDeskCard, erpBrandDeskMove, erpBrandDeskDone, erpBrandDeskPost, erpBrandDeskDecide, erpBrandDeskSetup, erpBrandDeskHello };
