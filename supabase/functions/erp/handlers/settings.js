// Group 'settings': Settings screen, Tools screen, diagnostics, backups,
// AI keys, staff + devices, and the "businesses" cards
// (ERP.js:1679-1814, 2004-2236, 2398-2540, 3666-3940, 4473-4860,
//  10885-11030, 11560-11720). Spec 04 A4, A5, B4, B13, B16.
//
// Deliberate changes are listed in docs/fixes/settings.md.

import { ERP_ROLES, ERP_DISCOUNT_CAP, normRole, roleAtLeast, actRole } from '../allow.js';
import { lock, who, stamp } from './money.js';
import { LIST_KINDS } from './catalog.js';
import { formatDate, dhakaDayStart } from '../lib/time.js';
import { formatBdPhone } from '../lib/phone.js';
import { setConfig, getSecret, saveFile, findFiles, deleteFile } from '../lib/ext.js';

/** The one web address every business opens from (was: one Apps Script link per sheet). */
export const APP_URL = 'https://erp.costareen.com';
/** This system's own page address (a company's copy has its own). */
const appUrlOf = (ctx) => String((ctx && ctx.deps && ctx.deps.google && ctx.deps.google.appUrl) || APP_URL).replace(/#.*$/, '').replace(/\/+$/, '');
const NOT_YET = 'This part is not in the web app yet.';

// ======================================================================
// SETTINGS - lists and config (ERP.js:2023-2190)
// ======================================================================

// SETTINGS columns A-G
const LOOKUP_KINDS = [...LIST_KINDS.slice(0, 6), 'payment_methods'];
const ERP_LOOKUP_COLS = { categories: 1, brands: 2, types: 3, suppliers: 4, units: 5, colors: 6, payment_methods: 7 };

// Never sent to the browser - credentials, not settings (ERP.js:2041).
const ERP_SECRET_CONFIG = { website_sync_key: true, n8n_webhook_url: true };

// Rows the sheet's SETTINGS I:J always had (Code.js:174-182) that still mean
// something here; shown with their default when nothing has been saved yet.
const CONFIG_ROWS = ['business_name', 'currency', 'default_reorder', 'default_lead_time',
  'n8n_webhook_url', 'invoice_pdf_folder_id', 'next_invoice_num'];
// Kept in business_config by other screens but were never SETTINGS rows
// (COST_PRICES N2:O4) - not listed under "System values".
const NOT_SETTINGS_ROWS = { cost_rate: true, cost_handling: true, cost_min_margin: true };

async function configDefaults(ctx) {
  const b = await ctx.tx`select name from businesses where id = ${ctx.biz}`;
  const c = await ctx.tx`select next_number from invoice_counters where business_id = ${ctx.biz}`;
  return {
    business_name: (b[0] && b[0].name) || '',
    currency: 'BDT',
    default_reorder: '5',
    default_lead_time: '7',
    next_invoice_num: String((c[0] && c[0].next_number) || 1001),
  };
}

/** The config rows in sheet order: [{key, value}] (values not yet hidden). */
async function configRows(ctx) {
  const stored = await ctx.tx`select key, value from business_config
                              where business_id = ${ctx.biz} order by key collate "C"`;
  const have = {};
  stored.forEach((r) => { have[r.key] = r.value == null ? '' : String(r.value); });
  const def = await configDefaults(ctx);
  const out = [];
  for (const k of CONFIG_ROWS) {
    if (k === 'next_invoice_num') { out.push({ key: k, value: def.next_invoice_num }); continue; }
    if (k in have) out.push({ key: k, value: have[k] });
    else if (k in def) out.push({ key: k, value: def[k] });
  }
  // the website key is a secret now; it shows as "stored privately" when set
  if (await getSecret(ctx, 'CZ_SYNC_KEY')) out.push({ key: 'website_sync_key', value: '' });
  for (const r of stored) {
    if (CONFIG_ROWS.includes(r.key) || NOT_SETTINGS_ROWS[r.key] || r.key === 'website_sync_key') continue;
    out.push({ key: r.key, value: have[r.key] });
  }
  return out;
}

/** One list, de-duplicated case-insensitively, in its stored order (erpLookupRead_). */
async function lookupRead(ctx, kind) {
  const rows = await ctx.tx`select value from lookups
                            where business_id = ${ctx.biz} and kind = ${kind}
                            order by sort_order, value collate "C"`;
  const out = [], seen = {};
  for (const r of rows) {
    const v = String(r.value || '').trim();
    if (v && !seen[v.toLowerCase()]) { seen[v.toLowerCase()] = true; out.push(v); }
  }
  return out;
}

/** erpWriteCol_: the whole list is rewritten, so a removed entry leaves no gap. */
async function lookupWrite(ctx, kind, values) {
  await ctx.tx`delete from lookups where business_id = ${ctx.biz} and kind = ${kind}`;
  if (!values.length) return;
  const rows = values.map((v, i) => ({ business_id: ctx.biz, kind, value: v, sort_order: i + 1 }));
  await ctx.tx`insert into lookups ${ctx.tx(rows, 'business_id', 'kind', 'value', 'sort_order')}`;
}

export async function erpSettingsFull(ctx) {
  const lists = {};
  for (const k of LOOKUP_KINDS) lists[k] = await lookupRead(ctx, k);
  // a manager gets the drop-down lists only; the business's own values stay with the owner and shareholders
  if (!roleAtLeast(actRole(ctx.s), 'shareholder')) return { lists, config: [] };
  const config = (await configRows(ctx)).map((c, i) => {
    const secret = !!ERP_SECRET_CONFIG[c.key];
    return { key: c.key, value: secret ? '' : c.value, secret, row: i + 2 };
  });
  return { lists, config };
}

export async function erpLookupAdd(ctx, kind, value) {
  if (!ERP_LOOKUP_COLS[kind]) throw new Error('Unknown list: ' + kind);
  const v = String(value || '').trim();
  if (!v) throw new Error('Type a value first.');
  await lock(ctx, 'settings');
  const cur = await lookupRead(ctx, kind);
  for (const x of cur) {
    if (x.toLowerCase() === v.toLowerCase()) throw new Error('"' + v + '" is already in that list.');
  }
  cur.push(v);
  cur.sort((a, b) => (a.toLowerCase() < b.toLowerCase() ? -1 : 1));
  await lookupWrite(ctx, kind, cur);
  return { ok: true, kind, values: cur };
}

export async function erpLookupRemove(ctx, kind, value) {
  if (!ERP_LOOKUP_COLS[kind]) throw new Error('Unknown list: ' + kind);
  const v = String(value || '').trim().toLowerCase();
  await lock(ctx, 'settings');
  const cur = await lookupRead(ctx, kind);
  const out = cur.filter((x) => x.toLowerCase() !== v);
  if (out.length === cur.length) throw new Error('"' + value + '" is not in that list.');
  await lookupWrite(ctx, kind, out);
  return { ok: true, kind, values: out };
}

/** How many products use a value (PRODUCT_MASTER C..H). Payment methods: 0. */
export async function erpLookupUsage(ctx, kind, value) {
  const field = { categories: 'category', brands: 'brand', types: 'type', colors: 'color',
    units: 'unit', suppliers: 'supplier' }[kind];
  if (!field) return 0;
  const v = String(value || '').trim().toLowerCase();
  const r = await ctx.tx`select count(*)::int as n from products
                         where business_id = ${ctx.biz}
                           and lower(btrim(coalesce(${ctx.tx(field)}, ''))) = ${v}`;
  return r[0].n;
}

export async function erpConfigSet(ctx, key, value) {
  const k = String(key || '').trim();
  if (!k) throw new Error('Which setting?');
  if (ERP_SECRET_CONFIG[k]) throw new Error('That value is a credential and is not editable from here.');
  await lock(ctx, 'settings');
  const rows = await configRows(ctx);
  if (!rows.find((r) => r.key === k)) throw new Error('Setting not found: ' + k);
  if (k === 'next_invoice_num') {
    // the counter the invoice screen numbers from (invoice_counters)
    const n = Number(String(value ?? '').trim());
    if (!Number.isInteger(n) || n < 1) throw new Error('next_invoice_num must be a whole number, e.g. 1001.');
    await ctx.tx`insert into invoice_counters (business_id, next_number) values (${ctx.biz}, ${n})
                 on conflict (business_id) do update set next_number = excluded.next_number`;
  }
  await setConfig(ctx, k, value);
  return { ok: true, key: k, value };
}

// ======================================================================
// PEOPLE AND DEVICES (ERP.js:4473-4600, 4795-4860)
// ======================================================================

const roleLabel = (r) => (ERP_ROLES[normRole(r)] || {}).label || '?';
const when = (d) => (d ? formatDate(d, 'd MMM, HH:mm') : '');

/** People of this business: added here, or holding a role here (RLS shows only those we may see). */
async function peopleRows(ctx) {
  return ctx.tx`
    select p.user_id, p.name, p.phone, p.code, p.status, p.last_used, p.note, p.created_at,
           p.home_business, m.role
    from erp_people p
    left join memberships m on m.user_id = p.user_id and m.business_id = ${ctx.biz}
    where p.home_business = ${ctx.biz} or m.business_id is not null
    order by p.created_at, p.user_id`;
}

async function deviceRows(ctx, userIds) {
  if (!userIds.length) return [];
  return ctx.tx`select * from erp_devices where user_id = any(${userIds})
                order by requested_at, id`;
}

/** A person's overall state, as ERP_USERS.device_status read. */
function personStatus(p, devs) {
  if (String(p.status) === 'revoked') return 'revoked';
  if (devs.some((d) => d.status === 'pending')) return 'pending';
  if (devs.some((d) => d.status === 'approved')) return 'approved';
  if (devs.length) return String(devs[devs.length - 1].status || '').toLowerCase();
  return 'no device yet';
}

export async function erpPeople(ctx) {
  const ppl = await peopleRows(ctx);
  const devs = await deviceRows(ctx, ppl.map((p) => p.user_id));
  const out = [];
  let pending = 0;
  for (const p of ppl) {
    const mine = devs.filter((d) => d.user_id === p.user_id);
    const status = personStatus(p, mine);
    if (status === 'pending') pending++;
    out.push({
      id: p.user_id,
      name: String(p.name || ''),
      phone: String(p.phone || ''),
      role: normRole(p.role),
      roleLabel: roleLabel(p.role),
      code: String(p.code || ''),
      status,
      devices: mine.map((d) => ({
        id: String(d.device_id), label: String(d.label || 'Unknown device'),
        status: String(d.status || '').toLowerCase(), lastUsed: when(d.last_used),
      })),
      lastUsed: when(p.last_used),
      note: String(p.note || ''),
    });
  }
  return {
    people: out,
    pending,
    roles: Object.keys(ERP_ROLES).map((r) => ({ id: r, label: ERP_ROLES[r].label, cap: ERP_DISCOUNT_CAP[r] })),
    iAm: ctx.s.role || 'owner',
  };
}

export async function erpDevices(ctx) {
  const ppl = await peopleRows(ctx);
  const byId = {};
  ppl.forEach((p) => { byId[p.user_id] = p; });
  const pending = [], approved = [], other = [];
  for (const d of await deviceRows(ctx, ppl.map((p) => p.user_id))) {
    const u = byId[d.user_id] || {};
    const row = {
      id: String(d.device_id),
      userId: String(d.user_id),
      name: String(u.name || 'unknown'),
      phone: String(u.phone || ''),
      role: normRole(u.role),
      roleLabel: roleLabel(u.role),
      label: String(d.label || 'Unknown device'),
      status: String(d.status || '').toLowerCase(),
      requested: when(d.requested_at),
      lastUsed: when(d.last_used),
    };
    if (row.status === 'pending') pending.push(row);
    else if (row.status === 'approved') approved.push(row);
    else other.push(row);
  }
  pending.reverse();
  return { pending, approved, other };
}

/** A new six-digit code nobody holds (erpNewCode_). Taken codes are found by the unique index. */
function randomCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function setCodeFresh(ctx, userId) {
  for (let tries = 0; tries < 200; tries++) {
    const c = randomCode();
    try {
      await ctx.tx.savepoint((sp) => sp`update erp_people set code = ${c} where user_id = ${userId}`);
      return c;
    } catch (e) {
      if (e && e.code === '23505') continue;
      throw e;
    }
  }
  throw new Error('Could not make a new code. Try again.');
}

export async function erpAddPerson(ctx, payload) {
  payload = payload || {};
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('A name is needed.');
  const role = String(payload.role || '').trim().toLowerCase();
  if (!ERP_ROLES[role]) throw new Error('Choose a role.');
  // only an owner may create another owner or a shareholder
  if (roleAtLeast(role, 'shareholder') && ctx.s.role !== 'owner') {
    throw new Error('Only the owner can add an owner or a shareholder.');
  }
  const wanted = String(payload.code || '').replace(/\D/g, '');
  if (wanted && wanted.length !== 6) throw new Error('A code is six digits, or leave it blank for a new one.');

  const userId = await ctx.deps.createAuthUser(name);
  const personNo = 'U' + stamp(ctx.now);
  await ctx.tx`insert into erp_people (user_id, home_business, person_no, name, phone, code, status)
               values (${userId}, ${ctx.biz}, ${personNo}, ${name},
                       ${String(payload.phone || '').trim()}, null, 'active')`;
  let code;
  if (wanted) {
    try {
      await ctx.tx.savepoint((sp) => sp`update erp_people set code = ${wanted} where user_id = ${userId}`);
    } catch (e) {
      if (e && e.code === '23505') throw new Error('That code is already in use. Leave it blank for a new one.');
      throw e;
    }
    code = wanted;
  } else {
    code = await setCodeFresh(ctx, userId);
  }
  await ctx.tx`select erp_add_member(${ctx.biz}, ${userId}, ${role}::member_role)`;
  return { ok: true, id: userId, name, role, code, people: (await erpPeople(ctx)).people };
}

async function findPerson(ctx, id) {
  const ppl = await peopleRows(ctx);
  const hit = ppl.find((p) => String(p.user_id) === String(id || '').trim());
  if (!hit) throw new Error('That person is not in the list.');
  return hit;
}

/** Legacy one-device approve (wired in the page, not rendered): allows their newest waiting device. */
export async function erpApproveDevice(ctx, id) {
  const p = await findPerson(ctx, id);
  const devs = await ctx.tx`select id, status from erp_devices where user_id = ${p.user_id}
                            order by requested_at desc, id`;
  if (!devs.length) {
    throw new Error('They have not tried their code yet, so there is no device to allow.');
  }
  const d = devs.find((x) => x.status === 'pending') || devs[0];
  await ctx.tx`update erp_devices set status = 'approved', decided_at = now() where id = ${d.id}`;
  await ctx.tx`update erp_people set note = '' where user_id = ${p.user_id}`;
  return { ok: true, people: (await erpPeople(ctx)).people };
}

/** Let someone move to a new phone: forget their devices (and optionally give a new code). */
export async function erpResetCode(ctx, payload) {
  const p = await findPerson(ctx, payload && payload.id);
  const newCode = !!(payload && payload.newCode);
  await ctx.tx`delete from erp_devices where user_id = ${p.user_id}`;
  await ctx.tx`update erp_people set failed = 0, locked_until = null where user_id = ${p.user_id}`;
  let code = String(p.code || '');
  if (newCode) code = await setCodeFresh(ctx, p.user_id);
  return { ok: true, code, newCode, people: (await erpPeople(ctx)).people };
}

export async function erpRevokePerson(ctx, id) {
  const p = await findPerson(ctx, id);
  if (normRole(p.role) === 'owner' && ctx.s.role !== 'owner') {
    throw new Error('Only the owner can remove an owner.');
  }
  const r = await ctx.tx`update erp_people set status = 'revoked', code = null
                         where user_id = ${p.user_id} returning user_id`;
  if (!r.length) throw new Error('That person is not in the list.');
  return { ok: true, people: (await erpPeople(ctx)).people };
}

/**
 * erpDevDecide_. The same device id can belong to two people (a shop
 * tablet); the row that is waiting for this decision is the one changed.
 */
async function devDecide(ctx, deviceId, status) {
  const ppl = await peopleRows(ctx);
  const ids = ppl.map((p) => p.user_id);
  const rows = ids.length
    ? await ctx.tx`select id, status from erp_devices
                   where device_id = ${String(deviceId || '')} and user_id = any(${ids})
                   order by requested_at desc, id`
    : [];
  if (!rows.length) throw new Error('That device is not in the list.');
  const prefer = status === 'revoked' ? 'approved' : 'pending';
  const d = rows.find((x) => x.status === prefer) || rows[0];
  await ctx.tx`update erp_devices set status = ${status}, decided_at = now() where id = ${d.id}`;
  return { ok: true, devices: await erpDevices(ctx), people: (await erpPeople(ctx)).people };
}

export const erpAllowDevice = (ctx, id) => devDecide(ctx, id, 'approved');
export const erpDenyDevice = (ctx, id) => devDecide(ctx, id, 'denied');
export const erpRevokeDevice = (ctx, id) => devDecide(ctx, id, 'revoked');

// ======================================================================
// BUSINESSES AND LINKS (ERP.js:2398-2540, 3666-3940)
// ======================================================================

const ONE_LINK = 'Every business now opens from the same web address, ' + APP_URL +
  ' - choose it in the business list at the top. There is no separate link to build, ' +
  'so nothing was changed.';

export async function erpBusinessLinks(ctx) {
  const list = ctx.s.memberships.map((m) => ({
    id: m.business_id, name: m.name, url: appUrlOf(ctx), isHome: m.business_id === ctx.biz,
  }));
  return { businesses: list, canAdd: roleAtLeast(ctx.s.role, 'owner') };
}

/** Who can open a business: its members (was: the sheet's Drive owner/editors/viewers). */
export async function erpBusinessPeople(ctx, id) {
  const bid = String(id || ctx.biz);
  const hit = ctx.s.memberships.find((m) => m.business_id === bid);
  if (!hit) throw new Error('That business is not in the list.');
  const rows = await ctx.tx`
    select m.user_id, m.role, p.name
    from memberships m left join erp_people p on p.user_id = m.user_id
    where m.business_id = ${bid}
    order by m.created_at`;
  return {
    id: bid,
    name: hit.name,
    people: rows.map((r) => ({
      email: r.user_id === ctx.s.userId ? ctx.s.name : String(r.name || r.user_id),
      role: normRole(r.role) === 'owner' ? 'owner' : roleLabel(r.role),
      removable: normRole(r.role) !== 'owner',
    })),
  };
}

/**
 * The sheet ERP warned when it ran as its owner (everyone would see every
 * business). Here every person only ever sees the businesses they belong to.
 */
export async function erpAccessWarning() { return null; }

export async function erpAdmin(ctx) {
  const out = { ok: true };
  const part = async (key, fn) => {
    try { out[key] = await ctx.tx.savepoint(() => fn()); }
    catch (e) { out[key + 'Error'] = String((e && e.message) || e); }
  };
  await part('staff', () => erpPeople(ctx));
  await part('devices', () => erpDevices(ctx));
  await part('links', () => erpBusinessLinks(ctx));
  await part('people', () => erpBusinessPeople(ctx, ctx.biz));
  try { out.warning = await erpAccessWarning(ctx); } catch (_) { out.warning = null; }
  return out;
}

/** erpEmails_ */
function emailList(raw) {
  const parts = String(raw || '').split(/[\s,;]+/);
  const out = [], seen = {};
  for (const p of parts) {
    const e = p.trim().toLowerCase();
    if (!e) continue;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error('That does not look like an email address: ' + p);
    if (!seen[e]) { seen[e] = true; out.push(e); }
  }
  return out;
}

function decodeImage(f) {
  if (!f || !f.data) return null;
  let bytes;
  try {
    const bin = atob(String(f.data));
    bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  } catch (_) { return null; }               // erpBlob_: an unreadable image is skipped
  if (bytes.length > 2 * 1024 * 1024) throw new Error('That image is over 2 MB. Please use a smaller one.');
  const mime = /^image\/[\w.+-]+$/.test(String(f.mime || '')) ? String(f.mime) : 'image/png';
  return { bytes, mime };
}

// setupSettings_ (Code.js:146-185): what a new business's lists start with
export const SEED_LISTS = {
  categories: ['Filaments', 'Printers', 'Accessories', 'Parts', 'Consumables', 'Tools'],
  brands: ['Sunlu', 'Bambulab', 'Creality', 'eSUN', 'Polymaker', 'BIQU', 'Jamg He'],
  types: ['PLA+', 'PLA', 'PETG', 'TPU', 'ABS', 'ASA', 'Silk PLA+', 'PLA Wood', 'Standard Resin', 'Nylon', 'PC', 'HIPS'],
  suppliers: ['Sunlu Direct', 'AliExpress', 'Bambulab Official', 'Local Dealer'],
  units: ['Roll', 'Piece', 'Set', 'Bottle', 'Kg', 'Meter'],
  colors: ['Black', 'White', 'Red', 'Blue', 'Grey', 'Gold', 'Silver', 'Transparent', 'Green', 'Yellow', 'Orange', 'Pink'],
  payment_methods: ['bKash', 'Bangla QR', 'Cash', 'Bank Transfer', 'COD'],
};

/**
 * erpCreateBusiness: a new, empty business of the owner's, with its own
 * lists, logo, payment QR and bank details; switched to straight away.
 * payload: { name, bank, logo:{data,mime,name}, qr:{data,mime,name}, emails? }
 */
export async function erpCreateBusiness(ctx, payload) {
  payload = payload || {};
  if (!roleAtLeast(ctx.s.role, 'owner')) throw new Error('Only the owner can add a business.');
  const name = String(payload.name || '').trim();
  if (!name) throw new Error('Business name is required.');
  for (const m of ctx.s.memberships) {
    if (String(m.name || '').toLowerCase() === name.toLowerCase()) {
      throw new Error('A business called "' + name + '" already exists.');
    }
  }
  const emails = emailList(payload.emails || payload.email || '');
  const logo = decodeImage(payload.logo);
  const qr = decodeImage(payload.qr);

  const made = await ctx.tx`select create_business(${name}) as id`;
  const id = made[0].id;
  const nctx = { ...ctx, biz: id, memo: {} };

  // lists (create_business seeds its own starter kinds; the ERP reads these)
  for (const [kind, vals] of Object.entries(SEED_LISTS)) {
    await ctx.tx`delete from lookups where business_id = ${id} and kind = ${kind}`;
    const rows = vals.map((v, i) => ({ business_id: id, kind, value: v, sort_order: i + 1 }));
    await ctx.tx`insert into lookups ${ctx.tx(rows, 'business_id', 'kind', 'value', 'sort_order')}`;
  }
  // erpSetIdentity_: its own name; nothing of this business's carried over
  const cur = /^[A-Za-z]{3}$/.test(String(payload.currency || '').trim()) ? String(payload.currency).trim().toUpperCase() : 'BDT';
  for (const [k, v] of [['business_name', name], ['currency', cur], ['default_reorder', '5'],
    ['default_lead_time', '7'], ['payment_qr_file_id', '']]) {
    await setConfig(nctx, k, v);
  }

  // logo, QR and bank details: the business's own profile (what invoices,
  // quotations and the menu read)
  const stampMs = ctx.now.getTime();
  const logoFile = logo ? await saveFile(nctx, 'assets', 'logo_' + stampMs, logo.bytes, logo.mime) : null;
  const qrFile = qr ? await saveFile(nctx, 'assets', 'qr_' + stampMs, qr.bytes, qr.mime) : null;
  const bankText = String(payload.bank || '').trim();
  const lines = bankText ? bankText.split(/\r?\n/).map((s) => s.trim()).slice(0, 10) : [];
  const banks = lines.length ? [{
    id: 'b' + stampMs, bank: lines[0] || '', name: lines[1] || '', number: lines[2] || '',
    branch: lines[3] || '', extra: lines.slice(4).join('\n'),
  }] : [];
  const profile = {
    name, address: '', email: '', phone: '', website: '', footer: '', signer: '', designation: '',
    logoId: logoFile ? logoFile.id : '', signatureId: '', qrId: qrFile ? qrFile.id : '',
    banks, logoTrimId: '',
  };
  const assets = [logoFile, qrFile].filter(Boolean).map((f) => f.id);
  await ctx.tx`insert into quote_settings (business_id, key, value) values
               (${id}, 'profile', ${ctx.tx.json(profile)}), (${id}, 'assets', ${ctx.tx.json(assets)})
               on conflict (business_id, key) do update set value = excluded.value`;
  if (qrFile) await setConfig(nctx, 'payment_qr_file_id', qrFile.id);
  if (bankText) await ctx.tx`update businesses set bank_details = ${bankText} where id = ${id}`;

  // partners: written down, not let in (no Drive sharing here - see fixes)
  let warning = null;
  if (emails.length) {
    await setConfig(nctx, 'partner_emails', emails.join(', '));
    warning = 'Nobody was given access automatically. ' + emails.join(', ') +
      ' ' + (emails.length > 1 ? 'are' : 'is') + ' written down for this business. To let ' +
      'them in, switch to it and add each person under Staff - ' +
      'each gets their own code, and they will see this business only.';
  }

  // switch to it (was: the user property cz_active_business)
  await ctx.tx`insert into erp_prefs (user_id, active_business) values (${ctx.s.userId}, ${id})
               on conflict (user_id) do update set active_business = excluded.active_business`;

  return { ok: true, id, name, url: appUrlOf(ctx), invited: [], couldNot: [], warning };
}

/** Sheet-only: every business shares one web address (see fixes). */
export async function erpDeployBusiness(ctx, id) {
  if (!String(id || '').trim()) throw new Error('Which business?');
  throw new Error(ONE_LINK);
}

export async function erpCheckBusinessSheet(ctx) {
  return {
    ok: true, name: '', url: appUrlOf(ctx),
    message: 'There are no business sheets any more. Each business keeps its own records, ' +
      'and nobody sees a business they were not added to - so there is nothing to check.',
  };
}

const PREPARE_SAY = 'Nothing to prepare: in the web app every new business starts empty, ' +
  'so nothing was removed. Stored keys, timers and images were left exactly as they were.';

/** FIX: the original wiped every script property and trigger (ERP.js:2205). This changes nothing. */
export async function erpPrepareTemplate() {
  return { ok: true, sheet: '', images: 0, properties: 0, triggers: 0, message: PREPARE_SAY };
}

export async function erpForgetBusiness(ctx, id) {
  if (!String(id || '').trim()) throw new Error('That business is not in the list.');
  throw new Error('Businesses are not kept in a list of sheets any more, so there is nothing to ' +
    'forget. A business shows in the switcher only for the people added to it. Nothing was changed.');
}

// ======================================================================
// TOOLS (ERP.js:1702-1814)
// ======================================================================

/** Another group's export, or "not in the web app yet". */
async function other(file, name) {
  let m = null;
  try { m = await import(file); } catch (_) { m = null; }
  const fn = m && m[name];
  if (typeof fn !== 'function') throw new Error(NOT_YET);
  return fn;
}

export async function erpTool(ctx, action) {
  const a = String(action || '').trim();

  if (a === 'refreshStock') {
    return 'Stock is always up to date now - it is worked out from the stock movements ' +
      'every time it is shown, so there was nothing to recalculate.';
  }
  if (a === 'refreshDashboard') {
    return 'The dashboard is worked out fresh every time it opens; there is no dashboard tab to refresh.';
  }
  if (a === 'sortProducts') {
    return 'There is no product sheet to sort any more - every screen lists the products in order by itself. Nothing was changed.';
  }
  if (a === 'fixPhones') {
    let fixed = 0;
    for (const r of await ctx.tx`select id, phone from customers where business_id = ${ctx.biz}`) {
      const cur = String(r.phone == null ? '' : r.phone).trim();
      if (!cur) continue;
      const nxt = formatBdPhone(cur);
      if (nxt !== cur) { await ctx.tx`update customers set phone = ${nxt} where id = ${r.id}`; fixed++; }
    }
    for (const r of await ctx.tx`select id, customer_phone from invoices where business_id = ${ctx.biz}`) {
      const cur = String(r.customer_phone == null ? '' : r.customer_phone).trim();
      if (!cur) continue;
      const nxt = formatBdPhone(cur);
      if (nxt !== cur) { await ctx.tx`update invoices set customer_phone = ${nxt} where id = ${r.id}`; fixed++; }
    }
    return fixed ? (fixed + ' phone number(s) corrected.') : 'All phone numbers already correct.';
  }
  if (a === 'previewPush') {
    const push = await other('./weborders.js', 'pushStockToWebsite');
    const p = await push(ctx, 'dry');
    if (!p || p.ok === false) throw new Error('Preview failed: ' + ((p && p.error) || 'unknown'));
    return 'Preview only, nothing changed. Sent ' + p.sent + ' products · would change ' +
      p.changed_count + ' · already correct ' + p.unchanged +
      ' · not found on the website ' + p.missing_count + '.' +
      (p.changes && p.changes.length ? '\n' + p.changes.map((x) => (x.name || x.sku) + ': ' + (x.from == null ? 'not tracked' : x.from) + ' → ' + x.to).join('\n') : '');
  }
  if (a === 'pushStock') {
    const push = await other('./weborders.js', 'pushStockToWebsite');
    const r = await push(ctx, 'apply');
    if (!r || r.ok === false) throw new Error('Push failed: ' + ((r && r.error) || 'unknown'));
    return 'Website stock updated. Sent ' + r.sent + ' · updated ' + r.changed_count +
      ' · already correct ' + r.unchanged + ' · not found ' + r.missing_count + '.';
  }
  if (a === 'pullOrders') {
    const pull = await other('./weborders.js', 'pullWebOrders');
    const o = await pull(ctx);
    if (!o || !o.ok) throw new Error('Pull failed: ' + ((o && o.error) || 'unknown'));
    return 'Checked ' + o.fetched + ' order line(s), added ' + o.added + ' new row(s).';
  }
  if (a === 'fixInvoiceLayout') {
    return 'Invoices are now made from a fixed design, so there is no invoice sheet whose layout could break. Nothing was changed.';
  }
  if (a === 'insertQr') {
    return 'There is no invoice sheet to place the QR on any more. Each invoice takes the payment QR ' +
      'from this business’s own profile when it is made. Nothing was changed.';
  }
  if (a === 'prepareTemplate') return PREPARE_SAY;
  if (a === 'mergeCustomers') {
    const merge = await other('./customers.js', 'mergeCustomers');
    const mr = await merge(ctx, true);
    return 'Merged ' + mr.groups + ' duplicated customer(s), removed ' + mr.removed +
      ' extra row(s). The removed rows were copied to ' + mr.backup + ' first.';
  }
  if (a === 'fixCustomerPhones') {
    const fix = await other('./customers.js', 'fixCustomerPhones');
    const fp = await fix(ctx);
    return fp.fixed ? (fp.fixed + ' phone number(s) given back their leading 0.')
      : 'Every stored phone number already looks right.';
  }
  if (a === 'previewReorder') {
    const apply = await other('./stock.js', 'applyReorderLevels');
    const pv = await apply(ctx, false);
    return pv.changed + ' product(s) would change (' + pv.raised + ' raised, ' +
      pv.lowered + ' lowered). Nothing has been written.';
  }
  if (a === 'applyReorder') {
    const apply = await other('./stock.js', 'applyReorderLevels');
    const ap = await apply(ctx, true);
    return 'Reorder levels recalculated from sales: ' + ap.changed + ' changed (' +
      ap.raised + ' raised, ' + ap.lowered + ' lowered).';
  }
  throw new Error('Unknown action: ' + a);
}

/** Timing and error report for every section (ERP.js:2004). */
export async function erpSelfTest(ctx) {
  const { HANDLERS } = await import('./index.js');
  const parts = ['dash', 'catalog', 'lists', 'options', 'customers', 'invoices', 'history', 'weborders'];
  const b = await HANDLERS.erpBundle(ctx, parts);
  return parts.map((k) => {
    const v = b[k];
    return { part: k, ms: b.took[k], error: b.errors[k] || '',
      size: v == null ? 0 : (v.length !== undefined ? v.length : 1) };
  });
}

// ======================================================================
// BACKUPS (ERP.js:10885-11030)
// ======================================================================

const BK_KEEP = 14;
const BK_PART = ' - backup ';

/** Every row this business owns, as one JSON document. */
async function exportBusiness(ctx) {
  const tables = await ctx.tx`
    select c.table_name as t
    from information_schema.columns c
    join information_schema.tables t on t.table_schema = c.table_schema and t.table_name = c.table_name
    where c.table_schema = 'public' and c.column_name = 'business_id' and t.table_type = 'BASE TABLE'
    order by c.table_name`;
  const out = {};
  out.businesses = await ctx.tx`select * from businesses where id = ${ctx.biz}`;
  for (const { t } of tables) {
    if (t === 'business_secrets') continue;               // never in a file
    out[t] = await ctx.tx`select * from ${ctx.tx(t)} where business_id = ${ctx.biz}`;
  }
  // staff, without their codes (a code is a key to the shop)
  out.erp_people = await ctx.tx`select user_id, home_business, person_no, name, phone, status,
                                       last_used, created_at, note
                                from erp_people where home_business = ${ctx.biz}`;
  const ids = out.erp_people.map((p) => p.user_id);
  out.erp_devices = ids.length ? await ctx.tx`select * from erp_devices where user_id = any(${ids})` : [];
  return out;
}

/**
 * erpBackupNow_: one JSON copy of the business, newest 14 kept.
 * Exported for the nightly job (why = 'night').
 */
export async function backupNow(ctx, why) {
  const got = await ctx.tx`select pg_try_advisory_xact_lock(hashtext(${ctx.biz + ':backup'})) as ok`;
  if (!got[0].ok) return { ok: false, busy: true };
  const b = await ctx.tx`select name from businesses where id = ${ctx.biz}`;
  const bizName = (b[0] && b[0].name) || ctx.s.businessName || 'Business';
  // seconds too when made by hand, so a copy made in the same minute never overwrites another
  let fileName = bizName + BK_PART + formatDate(ctx.now, why === 'night' ? 'yyyy-MM-dd HHmm' : 'yyyy-MM-dd HHmmss') + '.json';
  if (why !== 'night') {
    // never on top of another copy made in the same second (a restore copies today first)
    const taken = new Set((await findFiles(ctx, 'backups', BK_PART)).map((f) => f.name));
    for (let k = 1; taken.has(fileName) && k < 60; k++) fileName = bizName + BK_PART + formatDate(new Date(ctx.now.getTime() + k * 1000), 'yyyy-MM-dd HHmmss') + '.json';
  }
  const made = [], failed = [];
  try {
    const doc = { business: { id: ctx.biz, name: bizName }, made_at: ctx.now.toISOString(),
      why: String(why || ''), tables: await exportBusiness(ctx) };
    const bytes = new TextEncoder().encode(JSON.stringify(doc));
    await saveFile(ctx, 'backups', fileName, bytes, 'application/json');
    made.push(fileName);
  } catch (e) {
    failed.push(bizName + ': ' + ((e && e.message) || e));
  }
  // older copies beyond the newest fourteen are removed
  let binned = 0;
  const all = (await findFiles(ctx, 'backups', BK_PART)).filter((f) => isBackupName(f.name));
  all.sort((x, y) => (backupTime(y.name) || 0) - (backupTime(x.name) || 0));
  for (let i = BK_KEEP; i < all.length; i++) { await deleteFile(ctx, 'backups', all[i].name); binned++; }
  if (made.length) {
    await ctx.tx`insert into erp_backup_log (business_id, at, why, made, failed, file_name)
                 values (${ctx.biz}, ${ctx.now}, ${String(why || '')}, ${made.length},
                         ${ctx.tx.json(failed)}, ${fileName})`;
  }
  return { ok: made.length > 0, made, failed, binned };
}

const BK_RE = / - backup (\d{4}-\d{2}-\d{2}) (\d{2})(\d{2})(\d{2})?\.json$/;
function isBackupName(n) { return BK_RE.test(String(n || '')); }
function backupTime(n) {
  const m = BK_RE.exec(String(n || ''));
  if (!m) return null;
  return dhakaDayStart(m[1]).getTime() + Number(m[2]) * 3600e3 + Number(m[3]) * 60e3 + Number(m[4] || 0) * 1e3;
}

export async function erpBackupStatus(ctx) {
  const lastRows = await ctx.tx`select at, why, failed from erp_backup_log
                                where business_id = ${ctx.biz} and made > 0
                                order by at desc, id desc limit 1`;
  const last = lastRows[0] || null;
  const night = await ctx.tx`select at from erp_backup_log
                             where business_id = ${ctx.biz} and made > 0 and why = 'night'
                             order by at desc limit 1`;
  const nowMs = ctx.now.getTime();
  const timer = !!(night[0] && nowMs - new Date(night[0].at).getTime() <= 36 * 3600e3);
  const list = (await findFiles(ctx, 'backups', BK_PART)).filter((f) => isBackupName(f.name))
    .map((f) => ({ name: f.name, at: backupTime(f.name), url: f.url }));
  list.sort((x, y) => y.at - x.at);
  const lastAt = last ? new Date(last.at).getTime() : 0;
  return {
    timer,
    keep: BK_KEEP,
    count: list.length,
    folderUrl: '',
    links: null,
    lastAt: lastAt ? formatDate(new Date(lastAt), 'd MMM yyyy, h:mm a') : '',
    lastAgeHours: lastAt ? Math.round((nowMs - lastAt) / 360000) / 10 : null,
    lastFailed: (last && Array.isArray(last.failed)) ? last.failed : [],
    files: list.slice(0, 6).map((x) => ({ name: x.name, when: formatDate(new Date(x.at), 'd MMM, h:mm a'), url: x.url })),
  };
}

export async function erpBackupRun(ctx) {
  const r = await backupNow(ctx, 'by hand');
  if (r.busy) throw new Error('A backup is already running. Try again in a minute.');
  if (!r.ok) throw new Error('The backup could not be made: ' + (r.failed || []).join('; '));
  return erpBackupStatus(ctx);
}

// ======================================================================
// AI ACCESS - the keys (ERP.js:11600-11720)
// ======================================================================

export const ERP_AI_MCP_URL = 'https://mcp.bendar.duckdns.org/mcp';

function hex(bytes) { return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join(''); }
function randomHex(n) {
  const b = new Uint8Array(Math.ceil(n / 2));
  globalThis.crypto.getRandomValues(b);
  return hex(b).slice(0, n);
}
/** erpAiHash_: SHA-256 of the key text, lower-case hex. */
export async function aiHash(text) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return hex(new Uint8Array(d));
}

async function aiLog(ctx, name, role, action, result) {
  await ctx.tx`insert into erp_ai_log (business_id, key_name, role, action, result, detail)
               values (${ctx.biz}, ${String(name || '')}, ${String(role || '')}, ${String(action || '')},
                       ${String(result || '').slice(0, 300)}, '')`;
}

export async function erpAiKeys(ctx) {
  const rows = await ctx.tx`select * from erp_ai_keys where business_id = ${ctx.biz}
                            order by created_at, id`;
  const keys = rows.map((k) => ({
    id: k.id, name: k.name, role: normRole(k.role), roleLabel: roleLabel(k.role), on: !!k.enabled,
    created: k.created_at ? formatDate(k.created_at, 'd MMM yyyy') : '',
    lastUsed: k.last_used ? formatDate(k.last_used, 'd MMM, h:mm a') : '',
  }));
  const log = (await ctx.tx`select at, key_name, action, result from erp_ai_log
                            where business_id = ${ctx.biz} order by at desc, id desc limit 25`)
    .map((l) => ({ when: l.at ? formatDate(l.at, 'd MMM, h:mm a') : '', key: String(l.key_name || ''),
      action: String(l.action || ''), result: String(l.result || '') }));
  const roles = Object.keys(ERP_ROLES).map((r) => ({ id: r, label: ERP_ROLES[r].label }));
  return { keys, log, roles, address: ERP_AI_MCP_URL };
}

export async function erpAiKeyCreate(ctx, payload) {
  payload = payload || {};
  const name = String(payload.name || '').trim().slice(0, 40);
  const role = String(payload.role || '').trim().toLowerCase();
  if (!name) throw new Error('Give the key a name - who or what will use it.');
  if (!ERP_ROLES[role]) throw new Error('Choose what the key may do.');
  await lock(ctx, 'aikeys');
  const list = await ctx.tx`select name from erp_ai_keys where business_id = ${ctx.biz}`;
  if (list.length >= 20) throw new Error('Twenty keys is the limit. Remove one that is no longer used.');
  for (const k of list) {
    if (String(k.name).toLowerCase() === name.toLowerCase()) throw new Error('There is already a key called ' + name + '.');
  }
  const key = 'czai_' + randomHex(48);
  const id = 'k' + randomHex(12);
  await ctx.tx`insert into erp_ai_keys (id, business_id, name, role, hash, enabled, created_at)
               values (${id}, ${ctx.biz}, ${name}, ${role}::member_role, ${await aiHash(key)}, true, ${ctx.now})`;
  await aiLog(ctx, name, role, 'key created', 'by ' + who(ctx));
  const out = await erpAiKeys(ctx);
  out.fresh = { name, key };
  return out;
}

export async function erpAiKeySet(ctx, payload) {
  payload = payload || {};
  const id = String(payload.id || '');
  const r = await ctx.tx`select * from erp_ai_keys where business_id = ${ctx.biz} and id = ${id}`;
  const k = r[0];
  if (!k) throw new Error('That key is no longer there.');
  if (payload.remove) {
    await aiLog(ctx, k.name, k.role, 'key removed', 'by ' + who(ctx));
    await ctx.tx`delete from erp_ai_keys where id = ${k.id}`;
  } else {
    const on = !!payload.on;
    await ctx.tx`update erp_ai_keys set enabled = ${on} where id = ${k.id}`;
    await aiLog(ctx, k.name, k.role, on ? 'key switched on' : 'key switched off', 'by ' + who(ctx));
  }
  return erpAiKeys(ctx);
}

// ======================================================================

export const HANDLERS = {
  erpSettingsFull, erpLookupAdd, erpLookupRemove, erpLookupUsage, erpConfigSet,
  erpAdmin, erpPeople, erpDevices, erpBusinessLinks, erpBusinessPeople, erpAccessWarning,
  erpAddPerson, erpRevokePerson, erpResetCode, erpApproveDevice,
  erpAllowDevice, erpDenyDevice, erpRevokeDevice,
  erpAiKeys, erpAiKeyCreate, erpAiKeySet,
  erpTool, erpSelfTest, erpBackupStatus, erpBackupRun,
  erpCreateBusiness, erpDeployBusiness, erpCheckBusinessSheet, erpPrepareTemplate, erpForgetBusiness,
};
