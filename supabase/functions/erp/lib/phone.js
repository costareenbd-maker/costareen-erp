// Phone and customer-key rules shared by every screen (spec 03 §0.5).
// Client and server must agree on these exactly.

/** normalizePhone_ (Code:3622): digits; more than 10 keeps the last 10. */
export function normalizePhone(p) {
  const d = String(p == null ? '' : p).replace(/\D/g, '');
  return d.length > 10 ? d.slice(-10) : d;
}

/** formatBdPhone_ (Code:3739). */
export function formatBdPhone(p) {
  const raw = String(p == null ? '' : p).trim();
  const d = raw.replace(/\D/g, '');
  if (d.length === 10 && d[0] === '1') return '0' + d;
  if (d.length === 11 && d.startsWith('01')) return d;
  if (d.length === 13 && d.startsWith('8801')) return '0' + d.slice(3);
  if (d.length === 12 && d.startsWith('881')) return '0' + d.slice(2);
  return raw;
}

/** erpPhone11_ (ERP:10818): blank allowed, otherwise a real BD mobile. */
export function phone11(p) {
  const raw = String(p == null ? '' : p).trim();
  if (!raw) return '';
  const f = formatBdPhone(raw);
  if (!/^01[3-9]\d{8}$/.test(f)) {
    const n = raw.replace(/\D/g, '').length;
    throw new Error('The phone number must be 11 digits starting with 01 - "' + raw +
      '" has ' + n + '. Correct it, or leave it empty.');
  }
  return f;
}

/** erpCustKey_ (ERP:5155): last 10 digits, else 'n:' + lower name. */
export function custKey(phone, name) {
  const d = String(phone == null ? '' : phone).replace(/\D/g, '');
  if (d.length >= 10) return d.slice(-10);
  return 'n:' + String(name == null ? '' : name).trim().toLowerCase();
}
