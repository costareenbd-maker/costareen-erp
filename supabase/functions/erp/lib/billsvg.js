// The bill of a chat order as an SVG (made into a PNG by deps.svgPng - resvg with Inter + Noto Sans Bengali).
// Pure: no database, no network. The picture the customer gets right after the AI takes an order.

const str = (v) => String(v == null ? '' : v).trim();
const esc = (s) => str(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const tk = (n) => '৳' + Math.round(Number(n) || 0).toLocaleString('en-IN');
function cut(s, n) { s = str(s); return s.length > n ? s.slice(0, n - 1) + '…' : s; }

/** shop: {name, phone, address, colour}; o: {no, date, name, phone, address, items: [{name, qty, price}], delivery, status}. */
export function billSvg(shop, o) {
  const W = 640, P = 36, items = (o.items || []).slice(0, 30);
  const sub = items.reduce((t, x) => t + Number(x.qty || 0) * Number(x.price || 0), 0), total = sub + Number(o.delivery || 0);
  const col = /^#[0-9a-f]{6}$/i.test(str(shop.colour)) ? shop.colour : '#5B5BD6';
  const F = 'font-family="Inter, Noto Sans Bengali, sans-serif"';
  let y = 0;
  const parts = [];
  // head band
  const contact = cut([shop.phone, shop.address].filter(Boolean).join(' · '), 64), band = contact ? 118 : 88;
  parts.push(`<rect x="0" y="0" width="${W}" height="${band}" fill="${col}"/>`);
  parts.push(`<text x="${P}" y="54" ${F} font-size="28" font-weight="700" fill="#fff">${esc(cut(shop.name, 34))}</text>`);
  if (contact) parts.push(`<text x="${P}" y="86" ${F} font-size="16" fill="#fff" fill-opacity=".85">${esc(contact)}</text>`);
  y = band + 42;
  parts.push(`<text x="${P}" y="${y}" ${F} font-size="15" fill="#6b7280">BILL</text>`);
  parts.push(`<text x="${W - P}" y="${y}" ${F} font-size="15" fill="#6b7280" text-anchor="end">${esc(o.date)}</text>`);
  y += 32;
  parts.push(`<text x="${P}" y="${y}" ${F} font-size="24" font-weight="700" fill="#111827">${esc(o.no)}</text>`);
  y += 34;
  parts.push(`<text x="${P}" y="${y}" ${F} font-size="17" font-weight="700" fill="#111827">${esc(cut(o.name, 40))}${o.phone ? '  ·  ' + esc(o.phone) : ''}</text>`);
  // the address over up to two lines
  const addr = str(o.address);
  const a1 = addr.slice(0, 58), a2 = addr.length > 58 ? cut(addr.slice(58), 58) : '';
  y += 26; parts.push(`<text x="${P}" y="${y}" ${F} font-size="15" fill="#4b5563">${esc(a1)}</text>`);
  if (a2) { y += 22; parts.push(`<text x="${P}" y="${y}" ${F} font-size="15" fill="#4b5563">${esc(a2)}</text>`); }
  y += 28; parts.push(`<line x1="${P}" y1="${y}" x2="${W - P}" y2="${y}" stroke="#e5e7eb" stroke-width="2"/>`);
  for (const x of items) {
    y += 34;
    parts.push(`<text x="${P}" y="${y}" ${F} font-size="16" fill="#111827">${esc(cut(x.name, 40))}</text>`);
    parts.push(`<text x="${W - P}" y="${y}" ${F} font-size="16" font-weight="700" fill="#111827" text-anchor="end">${esc(tk(Number(x.qty) * Number(x.price)))}</text>`);
    y += 20;
    parts.push(`<text x="${P}" y="${y}" ${F} font-size="13" fill="#6b7280">${esc(x.qty + ' × ' + tk(x.price))}</text>`);
  }
  y += 20; parts.push(`<line x1="${P}" y1="${y}" x2="${W - P}" y2="${y}" stroke="#e5e7eb" stroke-width="2"/>`);
  const row = (label, val, big) => {
    y += big ? 40 : 30;
    parts.push(`<text x="${P}" y="${y}" ${F} font-size="${big ? 20 : 16}" ${big ? 'font-weight="700" fill="#111827"' : 'fill="#4b5563"'}>${esc(label)}</text>`);
    parts.push(`<text x="${W - P}" y="${y}" ${F} font-size="${big ? 22 : 16}" font-weight="700" fill="${big ? col : '#111827'}" text-anchor="end">${esc(val)}</text>`);
  };
  row('Subtotal', tk(sub));
  row('Delivery', tk(o.delivery));
  row('Total', tk(total), true);
  y += 34;
  parts.push(`<rect x="${P}" y="${y - 22}" width="${W - 2 * P}" height="36" rx="10" fill="${col}" fill-opacity=".1"/>`);
  parts.push(`<text x="${W / 2}" y="${y + 2}" ${F} font-size="15" font-weight="700" fill="${col}" text-anchor="middle">${esc(o.payNote || 'Cash on delivery — pay when the parcel arrives')}</text>`);
  y += 44;
  const H = y + 10;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><rect width="${W}" height="${H}" fill="#ffffff"/>${parts.join('')}</svg>`;
}
