// Stage N9 (docs/NETWORK-BLUEPRINT.md section 4.3): sell without stock - resellers.
//
// A supplier switches on "Sell through resellers": resellers buy at the shelf price less a percentage. A reseller (any
// business on the platform, stock or none) asks to join; once approved he sees the supplier's shared products with the
// exact reseller price and the suggested selling price, enters his customer and his own price, and places the order.
// The supplier accepts: a normal invoice in ITS books to the reseller's customer at the reseller's prices (cash on
// delivery, stock out, cost fixed), a packing slip in the reseller's name for the parcel, the parcel booked from the
// invoice as usual. The courier collects from the customer for the supplier. Delivered and paid → the reseller's margin
// (his price less the reseller price) is his commission; at month end the supplier pays it (an expense "Reseller
// commission" in its books) and the reseller marks it received. Commission-agent bookkeeping (IFRS 15): the owner of
// the goods books the gross sale and the cost; the reseller books only his commission. The platform holds no money.
//
// Supplier (Market > What I share > Resellers):
//   erpResellerProgramme()                 programme, join requests, resellers, orders in (synced with the invoices), statements
//   erpResellerProgrammeSave({enabled, pct, terms, phone})   owner
//   erpResellerLinkSet({id, status, pct})  approve / decline / pause / resume a reseller
//   erpResellerAccept({id}) / erpResellerDecline({id, reason}) / erpResellerSlip({id}) / erpResellerBook({id, note})
//   erpResellerPay({linkId, month, note})  the month's commission paid → an expense; the statement shows paid
// Reseller (Resell screen):
//   erpResell()                            suppliers, my links with their catalogues, my orders, my statements
//   erpResellJoin({source, business, note}) / erpResellOrder({linkId, customer, items, delivery, note}) / erpResellCancel({id})
//   erpResellReceived({statementId, note}) the commission arrived
// Timer (jobs.js websync): resellerRefresh(ctx) for every supplier with the programme on - catalogue + order states.

import { formatDate, num, round2 } from '../lib/time.js';
import { phone11 } from '../lib/phone.js';
import { roleAtLeast } from '../allow.js';
import { renderPdf, saveFile } from '../lib/ext.js';
import { sourceOf } from './market.js';

const str = (v) => String(v == null ? '' : v).trim();
const when = (d) => (d ? formatDate(new Date(d), 'd MMM yyyy') : '');
const monthOf = (d) => formatDate(new Date(d), 'yyyy-MM');
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const STATUS = { placed: 'Waiting for the supplier', accepted: 'Invoiced, packing', booked: 'Parcel booked', delivered: 'Delivered and paid', returned: 'Returned', cancelled: 'Cancelled', declined: 'Declined by the supplier' };

function me(ctx) { const src = sourceOf(ctx.deps); if (!src) throw new Error('Resellers work only for ERPs run by the provider.'); return { src, biz: ctx.biz }; }
function need(ctx, role, what) { if (!roleAtLeast(ctx.s.role, role)) throw new Error('Only ' + (role === 'owner' ? 'the owner' : 'a manager or the owner') + ' can ' + what + '.'); }
async function profile(ctx) {
  let p = {};
  try { const S = await import('./sales.js'); p = await S.qProfile(ctx); } catch (_) { p = {}; }
  const name = str(p.name) || str(ctx.s.businessName) || 'A business';
  let city = ''; try { city = str((await ctx.tx`select value from business_config where business_id = ${ctx.biz} and key = 'market_city'`)[0]?.value); } catch (_) { city = ''; }
  return { name, phone: str(p.phone), address: str(p.address), city };
}
async function conf(ctx) {
  const rows = await ctx.tx`select key, value from business_config where business_id = ${ctx.biz} and key in ('reseller_on', 'reseller_pct', 'reseller_terms', 'reseller_phone')`;
  const m = {}; for (const r of rows) m[r.key] = str(r.value);
  return { enabled: m.reseller_on === '1', pct: m.reseller_pct === undefined || m.reseller_pct === '' ? 10 : num(m.reseller_pct), terms: m.reseller_terms || '', phone: m.reseller_phone || '' };
}
const priceFor = (sell, pct) => Math.max(0, Math.round(num(sell) * (1 - num(pct) / 100)));
const band = (stock, reorder) => (num(stock) <= 0 ? 'out' : num(stock) <= Math.max(num(reorder), 2) ? 'low' : 'in');
function orderRow(o, side) {
  return { id: o.id, orderNo: str(o.order_no), linkId: o.link_id, status: str(o.status), say: STATUS[str(o.status)] || str(o.status), reason: str(o.reason), customer: str(o.customer_name), phone: str(o.customer_phone), address: str(o.customer_address),
    note: str(o.note), lines: o.lines || [], goods: num(o.goods), cost: num(o.cost), delivery: num(o.delivery), margin: num(o.margin), invoiceNo: str(o.invoice_no), consignment: str(o.consignment), placed: when(o.created_at), delivered: when(o.delivered_at),
    ...(side === 'sup' ? { reseller: str(o.res_name) } : { supplier: str(o.sup_name) }) };
}

// ---------------------------------------------------------------- the supplier: programme and catalogue
/** The reseller catalogue: the supplier's shared products with the exact reseller price (market_shares, as the market). */
async function catalogRefresh(ctx, src, c) {
  const rows = c.enabled ? await ctx.tx`
      select p.id, p.sku, p.name, p.unit, p.sell_price, p.reorder_level, coalesce(ps.stock, 0) as stock
        from market_shares m join products p on p.id = m.product_id and p.business_id = m.business_id
        left join product_stock ps on ps.product_id = p.id
       where m.business_id = ${ctx.biz} and coalesce(p.status, 'Active') = 'Active' and coalesce(p.sell_price, 0) > 0` : [];
  const list = rows.map((r) => ({ source: src, business_id: ctx.biz, product_id: r.id, sku: str(r.sku), name: str(r.name), unit: str(r.unit) || null, retail: num(r.sell_price), price: priceFor(r.sell_price, c.pct), band: band(r.stock, r.reorder_level), updated_at: new Date() }));
  const ctl = ctx.deps.control;
  await ctl.begin(async (t) => {
    await t`delete from erp_reseller_catalog where source = ${src} and business_id = ${ctx.biz}`;
    if (list.length) await t`insert into erp_reseller_catalog ${t(list, 'source', 'business_id', 'product_id', 'sku', 'name', 'unit', 'retail', 'price', 'band', 'updated_at')}`;
  });
  return list.length;
}
/** Order states follow the supplier's own invoices: parcel booked, delivered and paid, returned, voided. */
async function syncOrders(ctx, src) {
  const ctl = ctx.deps.control;
  // fix-3 M14: a delivered order is watched too - when its goods come back, its commission stops counting
  const open = await ctl`select id, invoice_no, status from erp_reseller_orders where sup_source = ${src} and sup_business = ${ctx.biz} and status in ('accepted', 'booked', 'delivered') and invoice_no is not null`;
  let changed = 0;
  for (const o of open) {
    const inv = (await ctx.tx`select delivery_status, payment_status, voided_at from invoices where business_id = ${ctx.biz} and invoice_no = ${o.invoice_no}`)[0];
    if (!inv) continue;
    const cl = (await ctx.tx`select consignment_id from courier_log where business_id = ${ctx.biz} and invoice_no = ${o.invoice_no} order by booked_at desc limit 1`)[0];
    const ds = str(inv.delivery_status).toLowerCase(), paid = /^paid$/i.test(str(inv.payment_status));
    let next = o.status;
    if (o.status === 'delivered') {
      const back = (await ctx.tx`select coalesce(sum(r.qty), 0) as b, (select coalesce(sum(l.qty), 0) from invoice_lines l join invoices i on i.id = l.invoice_id
                                 where i.business_id = ${ctx.biz} and i.invoice_no = ${o.invoice_no} and l.qty > 0) as s
                                 from returns r where r.business_id = ${ctx.biz} and r.invoice_no = ${o.invoice_no}`)[0];
      if (!(num(back.s) > 0 && num(back.b) >= num(back.s))) continue;
      await ctl`update erp_reseller_orders set status = 'returned', updated_at = now() where id = ${o.id}`;
      changed++;
      continue;
    }
    if (inv.voided_at) next = 'cancelled';
    else if (/return|cancel/.test(ds)) next = 'returned';
    else if (/deliver/.test(ds) && paid) next = 'delivered';
    else if (cl && o.status === 'accepted') next = 'booked';
    if (next === o.status && !(cl && next === 'booked')) continue;
    await ctl`update erp_reseller_orders set status = ${next}, consignment = ${cl ? str(cl.consignment_id) : null}, delivered_at = case when ${next} = 'delivered' then coalesce(delivered_at, now()) else delivered_at end, updated_at = now() where id = ${o.id}`;
    changed++;
  }
  return changed;
}
/** jobs.js (websync) and the supplier's screen: the catalogue and the order states, kept fresh. */
export async function resellerRefresh(ctx) {
  const src = sourceOf(ctx.deps); if (!src) return { skipped: true };
  const c = await conf(ctx);
  const listed = await catalogRefresh(ctx, src, c);
  if (c.enabled) { const p = await profile(ctx); await ctx.deps.control`insert into erp_reseller_programmes (source, business_id, name, city, phone, pct, terms, enabled, updated_at) values (${src}, ${ctx.biz}, ${p.name}, ${p.city || null}, ${c.phone || p.phone || null}, ${c.pct}, ${c.terms || null}, true, now())
    on conflict (source, business_id) do update set name = excluded.name, city = excluded.city, phone = excluded.phone, pct = excluded.pct, terms = excluded.terms, enabled = true, updated_at = now()`; }
  else await ctx.deps.control`update erp_reseller_programmes set enabled = false, updated_at = now() where source = ${src} and business_id = ${ctx.biz}`;
  const synced = await syncOrders(ctx, src);
  return { listed, synced, enabled: c.enabled };
}
async function statements(ctx, src, side) {
  const ctl = ctx.deps.control;
  const col = side === 'sup' ? ctl`sup_source = ${src} and sup_business = ${ctx.biz}` : ctl`res_source = ${src} and res_business = ${ctx.biz}`;
  const sums = await ctl`select link_id, to_char(delivered_at at time zone 'Asia/Dhaka', 'YYYY-MM') as month, count(*)::int as orders, sum(margin)::numeric as margin
                           from erp_reseller_orders where ${col} and status = 'delivered' and delivered_at is not null group by link_id, month`;
  const links = await ctl`select l.*, p.name as sup_pname from erp_reseller_links l left join erp_reseller_programmes p on p.source = l.sup_source and p.business_id = l.sup_business where ${col}`;
  const byLink = {}; for (const l of links) byLink[l.id] = l;
  const paid = await ctl`select s.* from erp_reseller_settlements s join erp_reseller_links l on l.id = s.link_id where ${col}`;
  const out = {};
  for (const s of sums) out[s.link_id + '|' + s.month] = { linkId: s.link_id, month: s.month, orders: num(s.orders), margin: round2(num(s.margin)), paid: 0, status: 'open' };
  for (const p of paid) { const k = p.link_id + '|' + p.month; out[k] = { ...(out[k] || { linkId: p.link_id, month: p.month, orders: 0, margin: 0 }),   // fix-3 M14: what still stands, not what stood when paid
    id: p.id, paid: num(p.paid), paidAt: when(p.paid_at), paidNote: str(p.paid_note), receivedAt: when(p.received_at), status: str(p.status) }; }
  return Object.values(out).map((s) => { const l = byLink[s.linkId] || {}; return { ...s, due: round2(s.margin - s.paid), reseller: str(l.res_name), supplier: str(l.sup_name) || str(l.sup_pname) }; }).sort((a, b) => (b.month > a.month ? 1 : b.month < a.month ? -1 : 0) || (a.reseller > b.reseller ? 1 : -1));
}
export async function erpResellerProgramme(ctx) {
  need(ctx, 'manager', 'see the resellers');
  const { src } = me(ctx), ctl = ctx.deps.control;
  const c = await conf(ctx);
  const fresh = await resellerRefresh(ctx);
  const links = (await ctl`select * from erp_reseller_links where sup_source = ${src} and sup_business = ${ctx.biz} order by (status = 'asked') desc, created_at desc`).map((l) => ({ id: l.id, name: str(l.res_name), city: str(l.res_city), phone: str(l.res_phone), status: str(l.status), pct: l.pct == null ? null : num(l.pct), note: str(l.note), since: when(l.created_at) }));
  const orders = (await ctl`select * from erp_reseller_orders where sup_source = ${src} and sup_business = ${ctx.biz} order by (status = 'placed') desc, created_at desc limit 200`).map((o) => orderRow(o, 'sup'));
  return { programme: { ...c, name: (await profile(ctx)).name, listed: fresh.listed }, links, orders, statements: await statements(ctx, src, 'sup'), waiting: links.filter((l) => l.status === 'asked').length + orders.filter((o) => o.status === 'placed').length };
}
export async function erpResellerProgrammeSave(ctx, payload) {
  need(ctx, 'owner', 'change the reseller programme');
  const p = payload || {};
  const pct = round2(num(p.pct)); if (p.enabled && !(pct >= 0 && pct <= 90)) throw new Error('The reseller discount is a percentage from 0 to 90.');
  const put = async (k, v) => { await ctx.tx`insert into business_config (business_id, key, value) values (${ctx.biz}, ${k}, ${v}) on conflict (business_id, key) do update set value = excluded.value`; };
  await put('reseller_on', p.enabled ? '1' : '0'); await put('reseller_pct', String(pct)); await put('reseller_terms', str(p.terms).slice(0, 600)); await put('reseller_phone', str(p.phone).slice(0, 30));
  const out = await resellerRefresh(ctx);
  if (p.enabled && !out.listed) return { saved: true, listed: 0, hint: 'Nothing for resellers yet: tick products above and share them on the market - resellers see the ticked products.' };
  return { saved: true, listed: out.listed };
}
export async function erpResellerLinkSet(ctx, payload) {
  need(ctx, 'manager', 'answer a reseller');
  const { src } = me(ctx), p = payload || {}, ctl = ctx.deps.control;
  const l = (await ctl`select * from erp_reseller_links where id = ${str(p.id)}::uuid and sup_source = ${src} and sup_business = ${ctx.biz}`)[0];
  if (!l) throw new Error('No such reseller.');
  const status = ['active', 'declined', 'paused'].includes(str(p.status)) ? str(p.status) : null; if (!status) throw new Error('Approve, decline or pause.');
  const pct = p.pct === '' || p.pct == null ? null : round2(num(p.pct)); if (pct != null && !(pct >= 0 && pct <= 90)) throw new Error('The discount is a percentage from 0 to 90.');
  await ctl`update erp_reseller_links set status = ${status}, pct = ${pct}, updated_at = now() where id = ${l.id}`;
  return { status, pct };
}
async function supOrder(ctx, id) {
  const { src } = me(ctx);
  const o = (await ctx.deps.control`select * from erp_reseller_orders where id = ${str(id)}::uuid and sup_source = ${src} and sup_business = ${ctx.biz}`)[0];
  if (!o) throw new Error('No such reseller order.');
  return o;
}
export async function erpResellerAccept(ctx, payload) {
  need(ctx, 'manager', 'accept a reseller order');
  const o = await supOrder(ctx, (payload || {}).id);
  if (o.status !== 'placed') throw new Error('This order is ' + (STATUS[o.status] || o.status).toLowerCase() + '.');
  const lines = o.lines || [];
  const { createInvoice } = await import('./invoice.js');
  // the supplier's own sale to the reseller's customer, at the reseller's prices, cash on delivery to the supplier's courier
  const inv = await createInvoice(ctx, {
    customer: { name: str(o.customer_name), phone: str(o.customer_phone), address: str(o.customer_address), source: 'Reseller' },
    items: lines.map((l) => ({ sku: str(l.sku), qty: num(l.qty) })), deliveryCharge: num(o.delivery), payMode: 'cod',
    note: 'Reseller order ' + str(o.order_no) + ' for ' + str(o.res_name) + ' - reseller price ' + num(o.cost) + ', commission ' + num(o.margin) + (str(o.note) ? ' - ' + str(o.note) : ''),
  }, { resale: { unitPrices: lines.map((l) => num(l.retail)) } });
  await ctx.deps.control`update erp_reseller_orders set status = 'accepted', invoice_no = ${inv.invoiceNo}, updated_at = now() where id = ${o.id}`;
  return { invoiceNo: inv.invoiceNo, total: inv.grandTotal };
}
export async function erpResellerDecline(ctx, payload) {
  need(ctx, 'manager', 'decline a reseller order');
  const p = payload || {}, o = await supOrder(ctx, p.id);
  if (o.status !== 'placed') throw new Error('Only a waiting order can be declined; an invoiced one is handled on its invoice.');
  await ctx.deps.control`update erp_reseller_orders set status = 'declined', reason = ${str(p.reason).slice(0, 300) || null}, updated_at = now() where id = ${o.id}`;
  return { status: 'declined' };
}
/** The packing slip in the reseller's name: what goes in the parcel instead of the supplier's invoice. */
export async function erpResellerSlip(ctx, payload) {
  const o = await supOrder(ctx, (payload || {}).id);
  if (!['accepted', 'booked', 'delivered'].includes(o.status)) throw new Error('The slip is made once the order is invoiced.');
  const l = (await ctx.deps.control`select * from erp_reseller_links where id = ${o.link_id}`)[0] || {};
  const lines = o.lines || [], total = round2(num(o.goods) + num(o.delivery));
  const html = '<!doctype html><html><head><meta charset="utf-8"><style>body{font:14px/1.5 Arial,sans-serif;color:#111;margin:28px}h1{font-size:22px;margin:0}table{width:100%;border-collapse:collapse;margin-top:14px}th,td{padding:7px 6px;border-bottom:1px solid #ddd;text-align:left}td.n,th.n{text-align:right}.mute{color:#666}.box{border:1px solid #ccc;border-radius:8px;padding:10px 12px;margin-top:12px}</style></head><body>' +
    '<h1>' + esc(l.res_name || o.res_name) + '</h1><div class="mute">' + esc([l.res_phone, l.res_address || l.res_city].filter(Boolean).join(' · ')) + '</div>' +
    '<div class="box"><b>Deliver to</b><br>' + esc(o.customer_name) + '<br>' + esc(o.customer_phone) + '<br>' + esc(o.customer_address) + '</div>' +
    '<table><thead><tr><th>Item</th><th class="n">Qty</th><th class="n">Price</th><th class="n">Total</th></tr></thead><tbody>' + lines.map((x) => '<tr><td>' + esc(x.name) + '</td><td class="n">' + num(x.qty) + (x.unit ? ' ' + esc(x.unit) : '') + '</td><td class="n">' + num(x.retail) + '</td><td class="n">' + round2(num(x.retail) * num(x.qty)) + '</td></tr>').join('') +
    (num(o.delivery) ? '<tr><td colspan="3" class="n">Delivery</td><td class="n">' + num(o.delivery) + '</td></tr>' : '') + '<tr><th colspan="3" class="n">Pay on delivery</th><th class="n">৳' + total + '</th></tr></tbody></table>' +
    '<p class="mute">Order ' + esc(o.order_no) + ' · ' + esc(when(o.created_at)) + (str(o.note) ? '<br>' + esc(o.note) : '') + '</p><p>Thank you for buying from ' + esc(l.res_name || o.res_name) + '.</p></body></html>';
  const bytes = await renderPdf(ctx, html, {});
  const f = await saveFile(ctx, 'reseller', str(o.order_no) + '-slip.pdf', bytes, 'application/pdf');
  return { url: f.url, name: str(o.order_no) + '-slip.pdf' };
}
export async function erpResellerBook(ctx, payload) {
  const p = payload || {}, o = await supOrder(ctx, p.id);
  if (o.status !== 'accepted' || !o.invoice_no) throw new Error('Accept the order first - the parcel is booked from its invoice.');
  const { erpBookParcel } = await import('./courier.js');
  const b = await erpBookParcel(ctx, { invoiceNo: o.invoice_no, note: ('For ' + str(o.res_name) + ' - ' + str(o.order_no) + '. ' + str(p.note)).trim() });
  await ctx.deps.control`update erp_reseller_orders set status = 'booked', consignment = ${str(b.consignment)}, updated_at = now() where id = ${o.id}`;
  return { consignment: b.consignment, collect: b.collect };
}
export async function erpResellerPay(ctx, payload) {
  need(ctx, 'owner', 'pay a reseller');
  const { src } = me(ctx), p = payload || {}, ctl = ctx.deps.control;
  const month = str(p.month); if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Which month?');
  const l = (await ctl`select * from erp_reseller_links where id = ${str(p.linkId)}::uuid and sup_source = ${src} and sup_business = ${ctx.biz}`)[0];
  if (!l) throw new Error('No such reseller.');
  const s = (await statements(ctx, src, 'sup')).find((x) => x.linkId === l.id && x.month === month);
  if (!s || !(s.due > 0)) throw new Error('Nothing is due to ' + str(l.res_name) + ' for ' + month + '.');
  const amount = round2(s.due);
  // fix-3 H16: two Pay presses at once: the second waits, reads again and finds nothing due
  await ctx.tx`select pg_advisory_xact_lock(hashtext(${'resellerpay:' + l.id + ':' + month}))`;
  const again = (await statements(ctx, src, 'sup')).find((x) => x.linkId === l.id && x.month === month);
  if (!again || Math.abs(round2(again.due) - amount) > 0.005) throw new Error('This was just paid on another screen. Open the statement again.');
  const { erpExpenseAdd } = await import('./expenses.js');
  await erpExpenseAdd(ctx, { amount, description: 'Reseller commission - ' + str(l.res_name) + ' - ' + month + (str(p.note) ? ' (' + str(p.note).slice(0, 120) + ')' : ''), category: 'Reseller commission', account: p.account });
  await ctl`insert into erp_reseller_settlements (link_id, month, orders, margin, paid, paid_at, paid_note, paid_by, status) values (${l.id}, ${month}, ${s.orders}, ${s.margin}, ${amount}, now(), ${str(p.note).slice(0, 300) || null}, ${str(ctx.s.name)}, 'paid')
            on conflict (link_id, month) do update set orders = excluded.orders, margin = excluded.margin, paid = erp_reseller_settlements.paid + excluded.paid, paid_at = now(), paid_note = excluded.paid_note, paid_by = excluded.paid_by, status = 'paid', updated_at = now()`;
  return { paid: amount, month, reseller: str(l.res_name) };
}

// ---------------------------------------------------------------- the reseller
export async function erpResell(ctx) {
  const { src } = me(ctx), ctl = ctx.deps.control;
  const my = await profile(ctx);
  // keep the slip's name and number current on every link of mine
  await ctl`update erp_reseller_links set res_name = ${my.name}, res_city = ${my.city || null}, res_phone = ${my.phone || null}, res_address = ${my.address || null} where res_source = ${src} and res_business = ${ctx.biz} and (res_name is distinct from ${my.name} or res_phone is distinct from ${my.phone || null} or res_address is distinct from ${my.address || null})`;
  const links = await ctl`select * from erp_reseller_links where res_source = ${src} and res_business = ${ctx.biz}`;
  const progs = await ctl`select p.*, (select count(*) from erp_reseller_catalog c where c.source = p.source and c.business_id = p.business_id)::int as products from erp_reseller_programmes p where p.enabled and not (p.source = ${src} and p.business_id = ${ctx.biz}) order by p.name`;
  const linkOf = (s, b) => links.find((l) => l.sup_source === s && l.sup_business === b);
  const suppliers = progs.map((p) => { const l = linkOf(p.source, p.business_id); return { source: p.source, business: p.business_id, name: str(p.name), city: str(p.city), pct: num(p.pct), terms: str(p.terms), products: num(p.products), link: l ? { id: l.id, status: str(l.status), pct: l.pct == null ? num(p.pct) : num(l.pct) } : null }; });
  const catalogues = [];
  for (const l of links.filter((x) => x.status === 'active')) {
    const prog = progs.find((p) => p.source === l.sup_source && p.business_id === l.sup_business);
    const pct = l.pct == null ? (prog ? num(prog.pct) : 0) : num(l.pct);
    const rows = await ctl`select * from erp_reseller_catalog where source = ${l.sup_source} and business_id = ${l.sup_business} order by name`;
    catalogues.push({ linkId: l.id, supplier: str(l.sup_name) || (prog ? str(prog.name) : 'Supplier'), city: str(l.res_city), pct, items: rows.map((r) => ({ productId: r.product_id, name: str(r.name), unit: str(r.unit), retail: num(r.retail), price: l.pct == null ? num(r.price) : priceFor(r.retail, pct), band: str(r.band) })) });
  }
  const orders = (await ctl`select * from erp_reseller_orders where res_source = ${src} and res_business = ${ctx.biz} order by created_at desc limit 200`).map((o) => { const l = links.find((x) => x.id === o.link_id); return orderRow({ ...o, sup_name: l ? l.sup_name : '' }, 'res'); });
  return { me: my, suppliers, catalogues, orders, statements: await statements(ctx, src, 'res'), says: STATUS };
}
export async function erpResellJoin(ctx, payload) {
  need(ctx, 'manager', 'ask a supplier');
  const { src } = me(ctx), p = payload || {}, ctl = ctx.deps.control;
  const prog = (await ctl`select * from erp_reseller_programmes where source = ${str(p.source)} and business_id = ${str(p.business)}::uuid and enabled`)[0];
  if (!prog) throw new Error('That supplier does not sell through resellers right now.');
  if (prog.source === src && prog.business_id === ctx.biz) throw new Error('That is your own business.');
  const my = await profile(ctx);
  const had = (await ctl`select * from erp_reseller_links where sup_source = ${prog.source} and sup_business = ${prog.business_id} and res_source = ${src} and res_business = ${ctx.biz}`)[0];
  if (had && had.status === 'active') throw new Error('You already sell for ' + str(prog.name) + '.');
  if (had && had.status === 'asked') throw new Error('You already asked ' + str(prog.name) + ' - wait for the answer.');
  await ctl`insert into erp_reseller_links (sup_source, sup_business, sup_name, res_source, res_business, res_name, res_city, res_phone, res_address, status, note)
            values (${prog.source}, ${prog.business_id}, ${str(prog.name)}, ${src}, ${ctx.biz}, ${my.name}, ${my.city || null}, ${my.phone || null}, ${my.address || null}, 'asked', ${str(p.note).slice(0, 400) || null})
            on conflict (sup_source, sup_business, res_source, res_business) do update set status = 'asked', note = excluded.note, res_name = excluded.res_name, res_phone = excluded.res_phone, res_address = excluded.res_address, updated_at = now()`;
  return { asked: true, supplier: str(prog.name) };
}
export async function erpResellOrder(ctx, payload) {
  const { src } = me(ctx), p = payload || {}, ctl = ctx.deps.control;
  const l = (await ctl`select * from erp_reseller_links where id = ${str(p.linkId)}::uuid and res_source = ${src} and res_business = ${ctx.biz}`)[0];
  if (!l) throw new Error('Choose a supplier.');
  if (l.status !== 'active') throw new Error(str(l.sup_name) + ' has not approved you' + (l.status === 'paused' ? ' - the link is paused' : '') + '.');
  const c = p.customer || {};
  const name = str(c.name).slice(0, 80); if (name.length < 2) throw new Error('Your customer’s name.');
  let phone = ''; try { phone = phone11(c.phone); } catch (e) { throw new Error('Your customer’s mobile number: ' + e.message); }
  if (!phone) throw new Error('Your customer’s mobile number, for the courier.');
  const address = str(c.address).slice(0, 300); if (address.length < 6) throw new Error('Your customer’s full address, for the courier.');
  const prog = (await ctl`select pct from erp_reseller_programmes where source = ${l.sup_source} and business_id = ${l.sup_business}`)[0];
  const pct = l.pct == null ? num(prog && prog.pct) : num(l.pct);
  const cat = await ctl`select * from erp_reseller_catalog where source = ${l.sup_source} and business_id = ${l.sup_business}`;
  const byId = {}; for (const r of cat) byId[r.product_id] = r;
  const lines = [];
  for (const it of (p.items || [])) {
    const r = byId[str(it.productId)]; if (!r) continue;
    const qty = Math.round(num(it.qty)); if (!(qty > 0)) continue;
    if (r.band === 'out') throw new Error(str(r.name) + ' is out of stock at the supplier right now.');
    const price = l.pct == null ? num(r.price) : priceFor(r.retail, pct);
    const retail = round2(num(it.price)); if (!(retail > 0)) throw new Error('Your price for ' + str(r.name) + '.');
    if (retail < price) throw new Error('Your price for ' + str(r.name) + ' (' + retail + ') is below the reseller price (' + price + ').');
    lines.push({ productId: r.product_id, sku: str(r.sku), name: str(r.name), unit: str(r.unit), qty, price, retail });
  }
  if (!lines.length) throw new Error('Add at least one product with a quantity.');
  const delivery = round2(num(p.delivery)); if (delivery < 0) throw new Error('Delivery cannot be negative.');
  const goods = round2(lines.reduce((a, x) => a + x.retail * x.qty, 0)), cost = round2(lines.reduce((a, x) => a + x.price * x.qty, 0));
  const no = 'RS-' + formatDate(new Date(), 'yyMMdd') + '-' + Math.random().toString(36).slice(2, 6).toUpperCase();
  const o = (await ctl`insert into erp_reseller_orders (order_no, link_id, sup_source, sup_business, res_source, res_business, res_name, customer_name, customer_phone, customer_address, note, lines, goods, cost, delivery, margin, status)
    values (${no}, ${l.id}, ${l.sup_source}, ${l.sup_business}, ${src}, ${ctx.biz}, ${str(l.res_name)}, ${name}, ${phone}, ${address}, ${str(p.note).slice(0, 500) || null}, ${ctl.json(lines)}, ${goods}, ${cost}, ${delivery}, ${round2(goods - cost)}, 'placed') returning *`)[0];
  return { order: orderRow({ ...o, sup_name: l.sup_name }, 'res') };
}
export async function erpResellCancel(ctx, payload) {
  const { src } = me(ctx), ctl = ctx.deps.control;
  const o = (await ctl`select * from erp_reseller_orders where id = ${str((payload || {}).id)}::uuid and res_source = ${src} and res_business = ${ctx.biz}`)[0];
  if (!o) throw new Error('No such order.');
  if (o.status !== 'placed') throw new Error('The supplier has already taken this order - ask the supplier.');
  await ctl`update erp_reseller_orders set status = 'cancelled', updated_at = now() where id = ${o.id}`;
  return { status: 'cancelled' };
}
export async function erpResellReceived(ctx, payload) {
  need(ctx, 'owner', 'confirm a commission');
  const { src } = me(ctx), p = payload || {}, ctl = ctx.deps.control;
  const s = (await ctl`select s.* from erp_reseller_settlements s join erp_reseller_links l on l.id = s.link_id where s.id = ${str(p.statementId)}::uuid and l.res_source = ${src} and l.res_business = ${ctx.biz}`)[0];
  if (!s) throw new Error('No such statement.');
  if (s.status !== 'paid') throw new Error('The supplier has not marked this paid yet.');
  await ctl`update erp_reseller_settlements set status = 'received', received_at = now(), received_note = ${str(p.note).slice(0, 300) || null}, updated_at = now() where id = ${s.id}`;
  return { received: num(s.paid) };
}
export const HANDLERS = { erpResellerProgramme, erpResellerProgrammeSave, erpResellerLinkSet, erpResellerAccept, erpResellerDecline, erpResellerSlip, erpResellerBook, erpResellerPay, erpResell, erpResellJoin, erpResellOrder, erpResellCancel, erpResellReceived };
