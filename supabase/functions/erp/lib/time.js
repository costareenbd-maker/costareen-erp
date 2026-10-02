// Dates the way the sheet ERP printed them: Asia/Dhaka (UTC+6, no daylight
// saving), Utilities.formatDate patterns.

export const TZ = 'Asia/Dhaka';
const OFFSET_MS = 6 * 3600 * 1000;
export const DAY_MS = 86400000;

const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const MONTH = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOWL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function pad(n, w) { return String(n).padStart(w, '0'); }

/** Utilities.formatDate(d, 'Asia/Dhaka', pattern). Quoted text 'like this' is kept. */
export function formatDate(d, pattern) {
  if (d == null) return '';
  const t = (d instanceof Date ? d : new Date(d)).getTime();
  if (!isFinite(t)) return '';
  const z = new Date(t + OFFSET_MS);              // read with UTC getters
  const Y = z.getUTCFullYear(), M = z.getUTCMonth(), D = z.getUTCDate();
  const h = z.getUTCHours(), m = z.getUTCMinutes(), s = z.getUTCSeconds(), w = z.getUTCDay();
  const tok = {
    yyyy: String(Y), yy: pad(Y % 100, 2),
    MMMM: MONTH[M], MMM: MON[M], MM: pad(M + 1, 2), M: String(M + 1),
    dd: pad(D, 2), d: String(D),
    HH: pad(h, 2), H: String(h),
    hh: pad(h % 12 || 12, 2), h: String(h % 12 || 12),
    mm: pad(m, 2), ss: pad(s, 2),
    a: h < 12 ? 'AM' : 'PM',
    EEEE: DOWL[w], EEE: DOW[w],
  };
  let out = '';
  for (let i = 0; i < pattern.length;) {
    if (pattern[i] === "'") {
      const j = pattern.indexOf("'", i + 1);
      out += pattern.slice(i + 1, j < 0 ? undefined : j);
      i = j < 0 ? pattern.length : j + 1;
      continue;
    }
    let hit = '';
    for (const k of ['yyyy', 'MMMM', 'EEEE', 'MMM', 'EEE', 'yy', 'MM', 'dd', 'HH', 'hh', 'mm', 'ss', 'M', 'd', 'H', 'h', 'a']) {
      if (pattern.startsWith(k, i)) { hit = k; break; }
    }
    if (hit) { out += tok[hit]; i += hit.length; } else { out += pattern[i]; i++; }
  }
  return out;
}

/** Today in Dhaka, yyyy-MM-dd. */
export function todayStr(now = new Date()) { return formatDate(now, 'yyyy-MM-dd'); }

/** Current month in Dhaka, yyyy-MM. */
export function monthStr(now = new Date()) { return formatDate(now, 'yyyy-MM'); }

/** Midnight at the start of a Dhaka calendar day 'yyyy-MM-dd', as a Date. */
export function dhakaDayStart(ymd) {
  const [y, m, d] = String(ymd).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d) - OFFSET_MS);
}

/** erpNum_: blanks and junk become 0. */
export function num(v) {
  if (v === null || v === undefined || v === '') return 0;
  const n = Number(v);
  return isFinite(n) ? n : 0;
}

export function round2(n) { return Math.round((Number(n) || 0) * 100) / 100; }
