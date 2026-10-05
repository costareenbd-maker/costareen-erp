// Invoice designs: the owner (or a manager) picks one of several looks for the customer's invoice PDF, its colours and
// font, what is shown (bank accounts, payment QR, signature, notes), the title, a thank-you line and terms, and a
// payment QR of its own. Company details (name, address, phone, logo...) are the same ones the quotations use.
//
//   erpInvoiceDesign()                      the saved design (with defaults), the list of designs, the company details
//   erpInvoiceDesignSave({design})          manager+
//   erpInvoicePreview({design, invoiceNo})  the page as HTML for the live preview (the latest invoice, or a sample)
//   erpInvoiceSamplePdf({design})           a real PDF of the latest invoice in that design (nothing saved)
//   erpInvoiceQrUpload({mime, data})        manager+: a payment QR just for invoices
//
// invoiceDoc(d, p, s, opt, img, now, design) -> { html, footer } is what makeInvoicePdf (sales.js) draws.

import { formatDate, num } from '../lib/time.js';
import { roleAtLeast } from '../allow.js';
import { saveFile, renderPdf } from '../lib/ext.js';
import { docLang, docBangla } from '../lib/doclang.js';

const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const HEX = /^#[0-9a-fA-F]{6}$/;
const str = (v) => String(v == null ? '' : v).trim();

export const TEMPLATES = [
  { id: 'wave', name: 'Wave', about: 'Soft colour waves at the top and bottom (the original look)' },
  { id: 'modern', name: 'Modern', about: 'A solid colour band with the logo, clean cards and a striped table' },
  { id: 'minimal', name: 'Minimal', about: 'Black and white, thin lines, lots of space; colour only on the total' },
  { id: 'classic', name: 'Classic', about: 'A traditional letterhead: centred name, serif type, boxed table, signature' },
  { id: 'bold', name: 'Bold', about: 'A dark header with a big "amount due" box in your colour' },
  { id: 'receipt', name: 'Receipt (80 mm)', about: 'A narrow till receipt for thermal printers' },
];
const FONTS = {
  sans: 'Inter,"Noto Sans Bengali","Noto Sans",Arial,sans-serif',
  serif: 'Georgia,"Noto Serif Bengali","Noto Sans Bengali","Times New Roman",serif',
  rounded: '"Nunito","Segoe UI","Noto Sans Bengali",Arial,sans-serif',
  mono: '"Courier New","Noto Sans Bengali",monospace',
};
const DEFAULTS = { template: 'wave', accent: '', dark: '', font: 'sans', title: 'INVOICE', thanks: '', terms: '', qrId: '', qrLabel: 'Scan to pay',
  show: { banks: true, qr: true, signature: false, phone: true, delivery: true } };

function merge(saved) {
  const s = saved && typeof saved === 'object' ? saved : {};
  const out = { ...DEFAULTS, ...s, show: { ...DEFAULTS.show, ...(s.show && typeof s.show === 'object' ? s.show : {}) } };
  if (!TEMPLATES.some((t) => t.id === out.template)) out.template = 'wave';
  if (!FONTS[out.font]) out.font = 'sans';
  return out;
}
async function readSaved(ctx) {
  const r = await ctx.tx`select value from quote_settings where business_id = ${ctx.biz} and key = 'invoice_design'`;
  let v = r[0] ? r[0].value : null;
  if (typeof v === 'string') { try { v = JSON.parse(v); } catch (_) { v = null; } }
  return v;
}
export async function invoiceDesign(ctx) { return merge(await readSaved(ctx)); }

function clean(x) {
  x = x || {};
  const sh = x.show || {};
  const t = (v, n) => String(v == null ? '' : v).slice(0, n);
  const d = {
    template: TEMPLATES.some((q) => q.id === x.template) ? x.template : 'wave',
    accent: HEX.test(String(x.accent)) ? x.accent : '', dark: HEX.test(String(x.dark)) ? x.dark : '',
    font: FONTS[x.font] ? x.font : 'sans',
    title: t(x.title, 40).trim() || 'INVOICE', thanks: t(x.thanks, 300), terms: t(x.terms, 2000),
    qrId: t(x.qrId, 200), qrLabel: t(x.qrLabel, 60) || 'Scan to pay',
    show: { banks: sh.banks !== false, qr: sh.qr !== false, signature: !!sh.signature, phone: sh.phone !== false, delivery: sh.delivery !== false },
  };
  return d;
}

// ---------------------------------------------------------------- shared pieces
function tint(hex, t) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return '#cccccc';
  let out = '#';
  for (let i = 1; i <= 3; i++) { const v = Math.round(parseInt(m[i], 16) + (255 - parseInt(m[i], 16)) * t).toString(16); out += v.length < 2 ? '0' + v : v; }
  return out;
}
function isDark(hex) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(String(hex));
  if (!m) return true;
  return (parseInt(m[1], 16) * 299 + parseInt(m[2], 16) * 587 + parseInt(m[3], 16) * 114) / 1000 < 165;
}
function parts(d, p, s, opt, img, now, D) {
  const accent = HEX.test(String(D.accent)) ? D.accent : HEX.test(String(s.accent)) ? s.accent : '#dda51c';
  const dark = HEX.test(String(D.dark)) ? D.dark : HEX.test(String(s.dark)) ? s.dark : '#303030';
  const cur = String(s.currency || 'BDT');
  const n = (v) => String(Math.round(num(v))).replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  const paidUp = !(d.due > 0.5);
  const banks = D.show.banks ? (p.banks || []).filter((b) => String(b.bank || b.number || '').trim()).slice(0, 3) : [];
  const qr = D.show.qr ? img.qr : '';
  const when = d.head.when ? formatDate(d.head.when, 'd MMMM yyyy') : '';
  const biz = str(p.name);
  const addrLines = String(p.address || '').split(/\n/).map(str).filter(Boolean);
  const contact = [D.show.phone ? p.phone : '', p.email, p.website].map(str).filter(Boolean);
  const rows = d.lines.map((l, i) => {
    const off = Math.max(0, l.gross - l.total);
    const sn = (l.serials || []).length ? '<div class="sn">S/N ' + l.serials.map((x) => esc(x.serial)).join(', ') + (l.serials[0].warrantyUntil ? ' · warranty until ' + esc(l.serials[0].warrantyUntil) : '') + '</div>' : '';
    return { i: i + 1, product: esc(l.product), sn, qty: n(l.qty), price: n(l.price), off: off > 0.5 ? '−' + n(off) : '', total: n(d.perLine ? l.total : l.gross) };
  });
  const sums = [['Subtotal', n(d.gross)]];
  if (d.invDisc > 0.5) { if (d.itemDisc > 0.5) sums.push(['Item discounts', '− ' + n(d.itemDisc)]); sums.push(['Invoice discount', '− ' + n(d.invDisc)]); }
  else if (d.totalDisc > 0.5) sums.push(['Discount', '− ' + n(d.totalDisc)]);
  if (D.show.delivery && d.delivery > 0.5) sums.push(['Delivery', n(d.delivery)]);
  return { accent, dark, cur, n, paidUp, banks, qr, when, biz, addrLines, contact, rows, sums,
    a2: tint(accent, 0.35), a4: tint(accent, 0.84), a5: tint(accent, 0.93), d5: tint(dark, 0.93),
    onAccent: isDark(accent) ? '#ffffff' : dark, onDark: '#ffffff', font: FONTS[D.font] || FONTS.sans,
    title: esc(D.title || 'INVOICE'), thanks: esc(D.thanks || p.footer || 'Thank you for your order.'), terms: esc(D.terms).replace(/\n/g, '<br>'),
    stamp: opt.corrected ? '<div class="stamp">CORRECTED COPY · ' + formatDate(now, 'd MMM yyyy') + '</div>' : '',
    sig: D.show.signature ? (img.sig ? '<img src="' + img.sig + '" style="height:14mm;display:block;margin:0 0 1mm auto">' : '<div style="height:12mm"></div>') +
      '<div style="border-top:0.3mm solid #8a8f98;padding-top:1mm;font-size:9pt">' + esc(p.signer || 'Authorised signature') + (p.designation ? '<br><span style="color:#6b7280">' + esc(p.designation) + '</span>' : '') + '</div>' : '' };
}
const BASE = '*{box-sizing:border-box;-webkit-print-color-adjust:exact;print-color-adjust:exact}html,body{margin:0;padding:0}' +
  '.sn{font-size:8.5pt;color:#555;margin-top:1mm}.r{text-align:right;white-space:nowrap}.c{text-align:center}' +
  'table{border-collapse:collapse}tr{break-inside:avoid}thead{display:table-header-group}.tail{break-inside:avoid}' +
  '.stamp{display:inline-block;border:0.5mm solid #b3261e;color:#b3261e;font-weight:700;font-size:9pt;padding:.8mm 2.5mm;border-radius:1mm;margin-top:2mm}';
function itemsTable(P, d, cls) {
  return '<table class="items ' + (cls || '') + '"><thead><tr><th class="c" style="width:10mm">#</th><th>Item</th><th class="c" style="width:15mm">Qty</th><th class="r" style="width:24mm">Price</th>' +
    (d.perLine ? '<th class="r" style="width:22mm">Discount</th>' : '') + '<th class="r" style="width:28mm">Total</th></tr></thead><tbody>' +
    P.rows.map((r) => '<tr><td class="c">' + r.i + '</td><td>' + r.product + r.sn + '</td><td class="c">' + r.qty + '</td><td class="r">' + r.price + '</td>' +
      (d.perLine ? '<td class="r">' + r.off + '</td>' : '') + '<td class="r">' + r.total + '</td></tr>').join('') + '</tbody></table>';
}
function sumRows(P, d) {
  return P.sums.map((x) => '<tr><td>' + x[0] + '</td><td class="r">' + x[1] + '</td></tr>').join('') +
    '<tr class="tot"><td>Total</td><td class="r">' + esc(P.cur) + ' ' + P.n(d.grand) + '</td></tr>' +
    '<tr><td>Paid</td><td class="r">' + P.n(d.paid) + '</td></tr>' +
    (P.paidUp ? '<tr class="ok"><td>Due</td><td class="r">Nothing due</td></tr>' : '<tr class="due"><td>Due</td><td class="r">' + esc(P.cur) + ' ' + P.n(d.due) + '</td></tr>');
}
function payBlock(P, D) {
  if (!P.banks.length && !P.qr) return '';
  return '<div class="pay">' + (P.banks.length ? '<div><div class="h">Payment details</div>' + P.banks.map((b) =>
      '<div class="bank"><b>' + esc(b.bank || 'Bank') + '</b><br>' + (b.name ? esc(b.name) + '<br>' : '') + 'A/C <b>' + esc(b.number || '—') + '</b>' +
      (b.branch ? '<br><span class="muted">' + esc(b.branch) + '</span>' : '') + (b.extra ? '<br><span class="muted">' + esc(b.extra) + '</span>' : '') + '</div>').join('') + '</div>' : '') +
    (P.qr ? '<div class="qr"><img src="' + P.qr + '"><div>' + esc(D.qrLabel || 'Scan to pay') + '</div></div>' : '') + '</div>';
}
function billTo(d) {
  return '<div class="h">Bill to</div><div class="cust">' + esc(d.head.customer || 'Walk-in customer') + '</div>' + (d.head.phone ? '<div>' + esc(d.head.phone) + '</div>' : '') +
    (str(d.head.address) ? '<div class="muted">' + esc(d.head.address).replace(/\n/g, '<br>') + '</div>' : '');
}
function meta(P, d) {
  return '<div class="kv"><span>Invoice no.</span><b>' + esc(d.invoiceNo) + '</b><span>Date</span><b>' + esc(P.when) + '</b>' +
    (d.head.method ? '<span>Payment</span><b>' + esc(d.head.method) + '</b>' : '') + (d.head.source ? '<span>Delivery</span><b>' + esc(d.head.source) + '</b>' : '') + '</div>';
}
const doc = (css, body) => '<!doctype html><html><head><meta charset="utf-8"><style>' + BASE + css + '</style></head><body>' + body + '</body></html>';
const simpleFooter = (P, bg, fg) => '<div style="-webkit-print-color-adjust:exact;print-color-adjust:exact;width:100%;font-family:Inter,Arial,sans-serif;font-size:8pt;color:' + fg +
  ';background:' + bg + ';padding:3mm 14mm;display:flex;justify-content:space-between;gap:6mm;margin:0">' +
  '<span>' + esc(P.biz) + '</span><span>' + esc(P.contact.join('  ·  ')) + '</span><span>' + esc(P.addrLines.join(', ')) + '</span></div>';

// ---------------------------------------------------------------- the designs
function modern(d, p, s, opt, img, now, D) {
  const P = parts(d, p, s, opt, img, now, D);
  const css = '@page{size:A4;margin:12mm 0 16mm 0}@page :first{margin-top:0}body{font-family:' + P.font + ';font-size:10.2pt;color:#1f2430;line-height:1.45}' +
    '.band{background:' + P.accent + ';color:' + P.onAccent + ';padding:9mm 14mm 8mm;display:flex;justify-content:space-between;align-items:center}' +
    '.band .lg{display:flex;align-items:center;gap:5mm}.band img{height:18mm;background:#fff;border-radius:2mm;padding:1.5mm}' +
    '.band .nm{font-size:15pt;font-weight:800}.band .ad{font-size:8.5pt;opacity:.9}.band .tt{font-size:28pt;font-weight:800;letter-spacing:2pt;text-align:right}' +
    '.wrap{padding:6mm 14mm 0}.cards{display:flex;gap:5mm}.card{flex:1;background:' + P.a5 + ';border-radius:2.5mm;padding:4mm 5mm}' +
    '.h{font-size:8pt;text-transform:uppercase;letter-spacing:1pt;color:' + P.dark + ';font-weight:800;margin-bottom:1.5mm}.cust{font-size:12pt;font-weight:800}.muted{color:#6b7280}' +
    '.kv{display:grid;grid-template-columns:24mm auto;row-gap:1mm}.kv span{color:#6b7280}' +
    'table.items{width:100%;margin-top:6mm}table.items th{background:' + P.dark + ';color:#fff;font-size:9pt;padding:2.2mm 3mm;text-align:left}table.items th.r{text-align:right}' +
    'table.items td{padding:2mm 3mm;border-bottom:0.3mm solid #e5e7eb}table.items tbody tr:nth-child(even) td{background:' + P.d5 + '}' +
    '.end{display:flex;justify-content:space-between;gap:8mm;margin-top:5mm}.sum{width:70mm;flex:0 0 70mm}.sum td{padding:1.6mm 3mm}' +
    '.sum tr.tot td{background:' + P.accent + ';color:' + P.onAccent + ';font-weight:800;font-size:11pt;border-radius:0}.sum tr.due td{color:#b3261e;font-weight:800}.sum tr.ok td{color:#1e7d46;font-weight:700}' +
    '.pay{display:flex;gap:6mm;font-size:9pt}.bank{margin-bottom:2mm}.qr{text-align:center;font-size:8pt}.qr img{width:26mm;height:26mm;border:0.3mm solid #e5e7eb;padding:1mm}' +
    '.note{margin-top:6mm;padding-top:3mm;border-top:0.3mm solid #e5e7eb;font-size:9.5pt}.terms{margin-top:2mm;font-size:8.5pt;color:#6b7280}.sig{width:60mm;margin:8mm 0 0 auto;text-align:right}';
  const body = '<div class="band"><div class="lg">' + (img.logo ? '<img src="' + img.logo + '">' : '') + '<div><div class="nm">' + esc(P.biz) + '</div><div class="ad">' + esc(P.addrLines.join(', ')) + '</div><div class="ad">' + esc(P.contact.join(' · ')) + '</div></div></div>' +
    '<div><div class="tt">' + P.title + '</div>' + P.stamp + '</div></div>' +
    '<div class="wrap"><div class="cards"><div class="card">' + billTo(d) + '</div><div class="card">' + meta(P, d) + '</div></div>' + itemsTable(P, d) +
    '<div class="tail"><div class="end">' + payBlock(P, D) + '<table class="sum">' + sumRows(P, d) + '</table></div>' +
    '<div class="note">' + P.thanks + (P.terms ? '<div class="terms">' + P.terms + '</div>' : '') + '</div>' + (P.sig ? '<div class="sig">' + P.sig + '</div>' : '') + '</div></div>';
  return { html: doc(css, body), footer: simpleFooter(P, P.dark, '#ffffff') };
}
function minimal(d, p, s, opt, img, now, D) {
  const P = parts(d, p, s, opt, img, now, D);
  const css = '@page{size:A4;margin:16mm 0 16mm 0}body{font-family:' + P.font + ';font-size:10pt;color:#111;line-height:1.5}.wrap{padding:0 18mm}' +
    '.top{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:0.3mm solid #111;padding-bottom:5mm}.top img{height:14mm;margin-bottom:2mm}' +
    '.nm{font-size:13pt;font-weight:700}.muted{color:#6b7280}.tt{font-size:12pt;letter-spacing:5pt;text-transform:uppercase;font-weight:600;text-align:right}' +
    '.two{display:flex;justify-content:space-between;gap:10mm;margin-top:6mm}.h{font-size:8pt;letter-spacing:2pt;text-transform:uppercase;color:#6b7280;margin-bottom:1mm}.cust{font-weight:700}' +
    '.kv{display:grid;grid-template-columns:24mm auto;row-gap:.8mm;text-align:left}.kv span{color:#6b7280}' +
    'table.items{width:100%;margin-top:8mm}table.items th{font-size:8pt;letter-spacing:1.5pt;text-transform:uppercase;color:#6b7280;font-weight:500;text-align:left;padding:2mm 0;border-bottom:0.3mm solid #111}' +
    'table.items th.r{text-align:right}table.items td{padding:2.4mm 0;border-bottom:0.2mm solid #e5e7eb}' +
    '.end{display:flex;justify-content:space-between;gap:10mm;margin-top:6mm}.sum{width:66mm;flex:0 0 66mm}.sum td{padding:1.2mm 0}' +
    '.sum tr.tot td{border-top:0.4mm solid ' + P.accent + ';border-bottom:0.4mm solid ' + P.accent + ';font-weight:700;font-size:11.5pt;padding:2mm 0}.sum tr.due td{font-weight:700}.sum tr.ok td{color:#6b7280}' +
    '.pay{display:flex;gap:6mm;font-size:9pt}.bank{margin-bottom:2mm}.qr{text-align:center;font-size:8pt}.qr img{width:24mm;height:24mm}' +
    '.note{margin-top:10mm;font-size:9.5pt}.terms{margin-top:2mm;font-size:8.5pt;color:#6b7280}.sig{width:58mm;margin:10mm 0 0 auto;text-align:right}';
  const body = '<div class="wrap"><div class="top"><div>' + (img.logo ? '<img src="' + img.logo + '"><br>' : '') + '<span class="nm">' + esc(P.biz) + '</span><div class="muted">' +
    P.addrLines.map(esc).join('<br>') + '</div><div class="muted">' + esc(P.contact.join(' · ')) + '</div></div><div><div class="tt">' + P.title + '</div>' + P.stamp + '</div></div>' +
    '<div class="two"><div>' + billTo(d) + '</div><div>' + meta(P, d) + '</div></div>' + itemsTable(P, d) +
    '<div class="tail"><div class="end">' + payBlock(P, D) + '<table class="sum">' + sumRows(P, d) + '</table></div>' +
    '<div class="note">' + P.thanks + (P.terms ? '<div class="terms">' + P.terms + '</div>' : '') + '</div>' + (P.sig ? '<div class="sig">' + P.sig + '</div>' : '') + '</div></div>';
  return { html: doc(css, body), footer: '<div style="width:100%;font-family:Arial,sans-serif;font-size:7.5pt;color:#9ca3af;text-align:center;margin:0">' + esc(P.biz) + (P.contact.length ? '  ·  ' + esc(P.contact.join('  ·  ')) : '') + '</div>' };
}
function classic(d, p, s, opt, img, now, D) {
  const P = parts(d, p, s, opt, img, now, D);
  const font = D.font === 'sans' ? FONTS.serif : P.font;
  const css = '@page{size:A4;margin:14mm 0 16mm 0}body{font-family:' + font + ';font-size:10.5pt;color:#1a1a1a;line-height:1.45}.wrap{padding:0 16mm}' +
    '.lh{text-align:center;padding-bottom:3mm;border-bottom:0.8mm double ' + P.dark + '}.lh img{height:18mm;margin-bottom:1.5mm}.nm{font-size:20pt;font-weight:700;color:' + P.dark + ';letter-spacing:.5pt}' +
    '.lh .muted{font-size:9pt}.muted{color:#555}.tt{text-align:center;font-size:14pt;letter-spacing:6pt;margin:5mm 0 4mm;color:' + P.accent + ';font-weight:700}' +
    '.two{display:flex;justify-content:space-between;gap:10mm}.h{font-weight:700;font-style:italic;margin-bottom:1mm}.cust{font-weight:700;font-size:11.5pt}' +
    '.kv{display:grid;grid-template-columns:26mm auto;row-gap:.8mm}' +
    'table.items{width:100%;margin-top:6mm}table.items th,table.items td{border:0.3mm solid #444;padding:2mm 2.5mm}table.items th{background:' + P.d5 + ';text-align:left}table.items th.r{text-align:right}' +
    '.end{display:flex;justify-content:space-between;gap:8mm;margin-top:5mm}.sum{width:70mm;flex:0 0 70mm}.sum td{border:0.3mm solid #444;padding:1.5mm 2.5mm}' +
    '.sum tr.tot td{font-weight:700;background:' + P.d5 + '}.sum tr.due td{font-weight:700;color:#8b1a1a}' +
    '.pay{display:flex;gap:6mm;font-size:9.5pt}.bank{margin-bottom:2mm}.qr{text-align:center;font-size:8pt}.qr img{width:25mm;height:25mm;border:0.3mm solid #444;padding:1mm}' +
    '.note{margin-top:6mm;text-align:center;font-style:italic}.terms{margin-top:2mm;font-size:8.5pt;color:#555;text-align:left;font-style:normal}.sig{width:60mm;margin:12mm 0 0 auto;text-align:center}';
  const body = '<div class="wrap"><div class="lh">' + (img.logo ? '<img src="' + img.logo + '"><br>' : '') + '<div class="nm">' + esc(P.biz) + '</div><div class="muted">' +
    esc(P.addrLines.join(', ')) + '</div><div class="muted">' + esc(P.contact.join('  ·  ')) + '</div></div>' +
    '<div class="tt">' + P.title + '</div><div style="text-align:center">' + P.stamp + '</div>' +
    '<div class="two"><div>' + billTo(d) + '</div><div>' + meta(P, d) + '</div></div>' + itemsTable(P, d) +
    '<div class="tail"><div class="end">' + payBlock(P, D) + '<table class="sum">' + sumRows(P, d) + '</table></div>' +
    '<div class="note">' + P.thanks + (P.terms ? '<div class="terms">' + P.terms + '</div>' : '') + '</div>' +
    '<div class="sig">' + (P.sig || '<div style="height:12mm"></div><div style="border-top:0.3mm solid #444;padding-top:1mm;font-size:9pt">Authorised signature</div>') + '</div></div></div>';
  return { html: doc(css, body), footer: '<div style="width:100%;font-family:Georgia,serif;font-size:8pt;color:#555;text-align:center;border-top:0.3mm solid #999;padding-top:2mm;margin:0 16mm">' + esc(P.biz) + ' — ' + esc(P.addrLines.join(', ')) + '</div>' };
}
function bold(d, p, s, opt, img, now, D) {
  const P = parts(d, p, s, opt, img, now, D);
  const css = '@page{size:A4;margin:12mm 0 16mm 0}@page :first{margin-top:0}body{font-family:' + P.font + ';font-size:10.2pt;color:#15171c;line-height:1.45}' +
    '.hd{background:' + P.dark + ';color:#fff;padding:10mm 14mm 9mm;display:flex;justify-content:space-between;align-items:stretch;gap:8mm}' +
    '.hd img{height:16mm;margin-bottom:2mm;background:#fff;border-radius:1.5mm;padding:1mm}.nm{font-size:14pt;font-weight:800}.hd .muted{color:#cbd5e1;font-size:8.5pt}' +
    '.tt{font-size:34pt;font-weight:900;letter-spacing:1pt;line-height:1;margin-top:2mm}.big{background:' + P.accent + ';color:' + P.onAccent + ';border-radius:3mm;padding:5mm 7mm;text-align:right;min-width:62mm}' +
    '.big span{font-size:9pt;text-transform:uppercase;letter-spacing:1.5pt;font-weight:700}.big b{display:block;font-size:22pt;font-weight:900}' +
    '.wrap{padding:6mm 14mm 0}.two{display:flex;justify-content:space-between;gap:10mm}.h{font-size:8pt;text-transform:uppercase;letter-spacing:1.5pt;color:' + P.accent + ';font-weight:900;margin-bottom:1mm}' +
    '.cust{font-size:13pt;font-weight:900}.muted{color:#6b7280}.kv{display:grid;grid-template-columns:24mm auto;row-gap:.8mm}.kv span{color:#6b7280}' +
    'table.items{width:100%;margin-top:6mm}table.items th{background:#15171c;color:#fff;padding:2.4mm 3mm;text-align:left;font-size:9pt}table.items th.r{text-align:right}' +
    'table.items td{padding:2.2mm 3mm;border-bottom:0.5mm solid ' + P.a4 + '}' +
    '.end{display:flex;justify-content:space-between;gap:8mm;margin-top:5mm}.sum{width:70mm;flex:0 0 70mm}.sum td{padding:1.6mm 3mm}' +
    '.sum tr.tot td{background:#15171c;color:#fff;font-weight:900;font-size:11pt}.sum tr.due td{background:' + P.accent + ';color:' + P.onAccent + ';font-weight:900}.sum tr.ok td{color:#1e7d46;font-weight:700}' +
    '.pay{display:flex;gap:6mm;font-size:9pt}.bank{margin-bottom:2mm}.qr{text-align:center;font-size:8pt}.qr img{width:26mm;height:26mm;border:0.6mm solid ' + P.accent + ';padding:1mm}' +
    '.note{margin-top:6mm;font-size:10pt;font-weight:700}.terms{margin-top:2mm;font-size:8.5pt;color:#6b7280;font-weight:400}.sig{width:60mm;margin:8mm 0 0 auto;text-align:right}';
  const body = '<div class="hd"><div>' + (img.logo ? '<img src="' + img.logo + '"><br>' : '') + '<div class="nm">' + esc(P.biz) + '</div><div class="muted">' + esc(P.addrLines.join(', ')) +
    '</div><div class="muted">' + esc(P.contact.join(' · ')) + '</div><div class="tt">' + P.title + '</div>' + P.stamp + '</div>' +
    '<div class="big"><span>' + (P.paidUp ? 'Paid in full' : 'Amount due') + '</span><b>' + esc(P.cur) + ' ' + P.n(P.paidUp ? d.grand : d.due) + '</b><span style="font-weight:400;letter-spacing:0;text-transform:none">' + esc(d.invoiceNo) + ' · ' + esc(P.when) + '</span></div></div>' +
    '<div class="wrap"><div class="two"><div>' + billTo(d) + '</div><div>' + meta(P, d) + '</div></div>' + itemsTable(P, d) +
    '<div class="tail"><div class="end">' + payBlock(P, D) + '<table class="sum">' + sumRows(P, d) + '</table></div>' +
    '<div class="note">' + P.thanks + (P.terms ? '<div class="terms">' + P.terms + '</div>' : '') + '</div>' + (P.sig ? '<div class="sig">' + P.sig + '</div>' : '') + '</div></div>';
  return { html: doc(css, body), footer: simpleFooter(P, P.accent, P.onAccent) };
}
function receipt(d, p, s, opt, img, now, D) {
  const P = parts(d, p, s, opt, img, now, D);
  // the page is as long as the receipt (a thermal roll is cut where it ends)
  const h = Math.round(118 + d.lines.length * 9 + P.sums.length * 5 + (P.qr ? 42 : 0) + (P.terms ? 14 : 0) + (img.logo ? 16 : 0));
  const font = D.font === 'sans' ? FONTS.mono : P.font;
  const css = '@page{size:80mm ' + h + 'mm;margin:4mm 4mm}body{font-family:' + font + ';font-size:8.6pt;color:#000;line-height:1.35}' +
    '.c{text-align:center}.hr{border-top:0.3mm dashed #000;margin:2mm 0}.nm{font-size:11pt;font-weight:700}img.lg{height:12mm;display:block;margin:0 auto 1mm;filter:grayscale(1)}' +
    'table{width:100%}td{padding:.4mm 0;vertical-align:top}.tot td{font-weight:700;font-size:10pt}.qr img{width:30mm;height:30mm;display:block;margin:1mm auto}';
  const body = (img.logo ? '<img class="lg" src="' + img.logo + '">' : '') + '<div class="c nm">' + esc(P.biz) + '</div><div class="c">' + P.addrLines.map(esc).join('<br>') + '</div>' +
    (P.contact.length ? '<div class="c">' + esc(P.contact.join(' · ')) + '</div>' : '') + '<div class="hr"></div>' +
    '<div class="c" style="font-weight:700;letter-spacing:2pt">' + P.title + '</div>' + (P.stamp ? '<div class="c">' + P.stamp + '</div>' : '') +
    '<div>No: ' + esc(d.invoiceNo) + '<br>Date: ' + esc(P.when) + '<br>Customer: ' + esc(d.head.customer || 'Walk-in') + (d.head.phone ? ' (' + esc(d.head.phone) + ')' : '') + '</div><div class="hr"></div>' +
    '<table>' + P.rows.map((r) => '<tr><td colspan="2">' + r.product + r.sn + '</td></tr><tr><td>&nbsp;&nbsp;' + r.qty + ' x ' + r.price + (r.off ? ' (' + r.off + ')' : '') + '</td><td class="r">' + r.total + '</td></tr>').join('') + '</table>' +
    '<div class="hr"></div><table>' + sumRows(P, d) + '</table><div class="hr"></div>' +
    (P.qr ? '<div class="qr c"><img src="' + P.qr + '">' + esc(D.qrLabel || 'Scan to pay') + '</div><div class="hr"></div>' : '') +
    '<div class="c">' + P.thanks + '</div>' + (P.terms ? '<div style="margin-top:1.5mm;font-size:7.5pt">' + P.terms + '</div>' : '');
  return { html: doc(css, body), footer: '' };
}
const DRAW = { modern, minimal, classic, bold, receipt };

/** The invoice page in the chosen design. 'wave' is the original drawing (sales.js invoiceArtParts), with the options applied. */
export async function invoiceDoc(d, p, s, opt, img, now, D, waveArt) {
  D = D || merge(null);
  if (DRAW[D.template]) return DRAW[D.template](d, p, s, opt || {}, img || {}, now || new Date(), D);
  const p2 = { ...p, banks: D.show.banks ? p.banks : [], footer: D.thanks || p.footer, phone: D.show.phone ? p.phone : '' };
  const s2 = { ...s, accent: HEX.test(String(D.accent)) ? D.accent : s.accent, dark: HEX.test(String(D.dark)) ? D.dark : s.dark };
  const img2 = { ...img, qr: D.show.qr ? img.qr : '' };
  const out = waveArt(d, p2, s2, opt || {}, img2, now || new Date());
  let html = out.html.replace('>INVOICE</div>', '>' + esc(D.title || 'INVOICE') + '</div>').replace('<b>Bangla QR</b><br><span class="muted">any bank app, bKash,<br>Nagad or Rocket</span>', '<b>' + esc(D.qrLabel || 'Scan to pay') + '</b>');
  if (D.font !== 'sans') html = html.replace('body{font-family:Inter,"Noto Sans Bengali","Noto Sans",Arial,sans-serif;', 'body{font-family:' + FONTS[D.font] + ';');
  if (D.show.delivery === false) html = html.replace(/<tr><td>Delivery<\/td><td>[^<]*<\/td><\/tr>/, '');
  const extra = (D.terms ? '<div style="margin-top:1.5mm;font-size:9pt;color:#5d6672">' + esc(D.terms).replace(/\n/g, '<br>') + '</div>' : '') +
    (D.show.signature ? '<div style="width:60mm;margin:8mm 0 0 auto;text-align:right">' + (img.sig ? '<img src="' + img.sig + '" style="height:14mm;display:block;margin:0 0 1mm auto">' : '<div style="height:12mm"></div>') +
      '<div style="border-top:0.3mm solid #8a8f98;padding-top:1mm;font-size:9pt">' + esc(p.signer || 'Authorised signature') + '</div></div>' : '');
  if (extra) html = html.replace('</body>', '<div style="padding:0 16mm">' + extra + '</div></body>');
  return { html, footer: out.footer };
}

// ---------------------------------------------------------------- handlers
async function imagesFor(ctx, p, D) {
  const { docImg } = await import('./sales.js');
  return { logo: (await docImg(ctx, p.logoTrimId)) || (await docImg(ctx, p.logoId)), qr: await docImg(ctx, D.qrId || p.qrId), sig: D.show.signature ? await docImg(ctx, p.signatureId) : '' };
}
const SAMPLE = () => ({ invoiceNo: 'INV-SAMPLE-001', head: { customer: 'Karim Ahmed', phone: '01712345678', address: 'House 12, Road 5, Dhanmondi, Dhaka', when: new Date(), method: 'bKash', source: 'Pathao' },
  lines: [{ product: 'Sample product A', qty: 2, price: 1350, gross: 2700, total: 2700, serials: [] }, { product: 'Sample product B', qty: 1, price: 52000, gross: 52000, total: 52000, serials: [] }],
  gross: 54700, itemDisc: 0, invDisc: 0, totalDisc: 700, delivery: 120, grand: 54120, paid: 20000, due: 34120, perLine: false });
async function pageFor(ctx, D, invoiceNo) {
  const S = await import('./sales.js');
  let no = str(invoiceNo);
  if (!no) { const r = await ctx.tx`select invoice_no from invoices where business_id = ${ctx.biz} and invoice_no not like 'RTN-%' order by created_at desc limit 1`; no = r[0] ? r[0].invoice_no : ''; }
  const d = (no && await S.invoiceDocData(ctx, no)) || SAMPLE();
  const p = await S.qProfile(ctx), s = await S.qSettings(ctx);
  if (!str(p.name)) p.name = (ctx.s && ctx.s.businessName) || '';
  const parts2 = await invoiceDoc(d, p, s, {}, await imagesFor(ctx, p, D), new Date(), D, S.invoiceArtParts);
  if ((await docLang(ctx)) === 'bn') { parts2.html = docBangla(parts2.html); parts2.footer = docBangla(parts2.footer); }
  return { ...parts2, invoiceNo: d.invoiceNo, sample: d.invoiceNo === 'INV-SAMPLE-001' };
}
function needManager(ctx) { if (!roleAtLeast(ctx.s.role, 'manager')) throw new Error('Only a manager or the owner changes the invoice design.'); }

export async function erpInvoiceDesign(ctx) {
  const S = await import('./sales.js');
  const p = await S.qProfile(ctx), s = await S.qSettings(ctx);
  return { design: await invoiceDesign(ctx), templates: TEMPLATES, fonts: Object.keys(FONTS), quoteColours: { accent: s.accent, dark: s.dark },
    profile: { name: p.name, address: p.address, phone: p.phone, email: p.email, website: p.website, footer: p.footer, signer: p.signer, designation: p.designation,
      hasLogo: !!(p.logoId || p.logoTrimId), hasQr: !!p.qrId, hasSignature: !!p.signatureId, banks: p.banks || [] },
    canEdit: roleAtLeast(ctx.s.role, 'manager'), canCompany: roleAtLeast(ctx.s.role, 'shareholder') };
}
export async function erpInvoiceDesignSave(ctx, payload) {
  needManager(ctx);
  const D = clean(payload && payload.design);
  await ctx.tx`insert into quote_settings (business_id, key, value) values (${ctx.biz}, 'invoice_design', ${JSON.stringify(D)}::text::jsonb)
               on conflict (business_id, key) do update set value = excluded.value`;
  return { design: D };
}
export async function erpInvoicePreview(ctx, payload) {
  const D = payload && payload.design ? clean(payload.design) : await invoiceDesign(ctx);
  return pageFor(ctx, D, payload && payload.invoiceNo);
}
export async function erpInvoiceSamplePdf(ctx, payload) {
  needManager(ctx);
  const D = payload && payload.design ? clean(payload.design) : await invoiceDesign(ctx);
  const pg = await pageFor(ctx, D, payload && payload.invoiceNo);
  const bytes = await renderPdf(ctx, pg.html, { footer: pg.footer });
  let b = ''; if (typeof Buffer !== 'undefined') b = Buffer.from(bytes).toString('base64'); else { for (let i = 0; i < bytes.length; i += 0x8000) b += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); b = btoa(b); }
  return { name: 'Invoice design - ' + D.template + '.pdf', base64: b, size: bytes.length };
}
export async function erpInvoiceQrUpload(ctx, payload) {
  needManager(ctx);
  payload = payload || {};
  const mime = String(payload.mime || '');
  if (!/^image\/(png|jpeg|webp)$/.test(mime)) throw new Error('Use a PNG, JPEG or WebP image.');
  let bytes;
  try { const bin = atob(String(payload.data || '').replace(/^data:[^,]*,/, '')); bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); } catch (_) { throw new Error('That image could not be read.'); }
  if (bytes.length > 1024 * 1024) throw new Error('The image is over 1 MB. Use a smaller one.');
  const f = await saveFile(ctx, 'assets', 'invoiceqr_' + ctx.now.getTime() + '.' + ({ 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' })[mime], bytes, mime);
  const D = await invoiceDesign(ctx); D.qrId = f.id;
  await ctx.tx`insert into quote_settings (business_id, key, value) values (${ctx.biz}, 'invoice_design', ${JSON.stringify(clean(D))}::text::jsonb)
               on conflict (business_id, key) do update set value = excluded.value`;
  return { design: clean(D) };
}

export const HANDLERS = { erpInvoiceDesign, erpInvoiceDesignSave, erpInvoicePreview, erpInvoiceSamplePdf, erpInvoiceQrUpload };
