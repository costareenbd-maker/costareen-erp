// watch-6 (owner 22 Oct 2026: "yes, let it clear cache and restart the site"): the two safe website repairs the Engine
// may run on a business's own hosting, through the office VPS's SSH key to it. The hosting of each business is set by
// hand in /etc/erp-engine-sites.json on the VPS (never in the ERP, never in git):
//   { "<business id>": { "host": "costareen.com", "ssh": ["-i", "/root/.ssh/key", "-p", "65002", "user@1.2.3.4"],
//                        "wp": "domains/costareen.com/public_html", "user": "u123" } }
//   clear_cache  LiteSpeed page cache + the WordPress object cache (nothing else changes)
//   restart      stops the site's PHP workers (lsphp); the web server starts fresh ones on the next visit; then clear_cache
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';

const FILE = process.env.SITES_FILE || '/etc/erp-engine-sites.json';
export function sites() { try { return JSON.parse(readFileSync(FILE, 'utf8')); } catch (_) { return {}; } }
export function siteOf(biz) { const s = sites()[biz]; return s && Array.isArray(s.ssh) && s.wp && s.user ? s : null; }

function remote(site, cmd, ms) {
  return new Promise((ok) => {
    const p = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', '-o', 'StrictHostKeyChecking=accept-new', ...site.ssh, cmd]);
    let out = '';
    const t = setTimeout(() => p.kill('SIGKILL'), ms || 90000);
    p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
    p.on('close', (code) => { clearTimeout(t); ok({ code, out: out.slice(-1500) }); });
  });
}
const q = (s) => "'" + String(s).replace(/'/g, "'\\''") + "'";

export async function siteAction(biz, act) {
  const site = siteOf(biz);
  if (!site) return { ok: false, text: 'No website hosting is set up for this business on the Engine.' };
  const clear = 'cd ' + q(site.wp) + ' && (wp litespeed-purge all </dev/null >/dev/null 2>&1; r1=$?; wp cache flush </dev/null >/dev/null 2>&1; r2=$?; echo CZ-CLEAR $r1 $r2)';
  if (act === 'clear_cache') {
    const r = await remote(site, clear);
    const m = /CZ-CLEAR (\d+) (\d+)/.exec(r.out);
    return m && (m[1] === '0' || m[2] === '0') ? { ok: true, text: 'Website cache cleared' + (m[1] === '0' ? ' (page cache' + (m[2] === '0' ? ' + WordPress cache)' : ')') : ' (WordPress cache)') + '.' }
      : { ok: false, text: 'Could not clear the cache: ' + (r.out.trim().split('\n').pop() || 'no answer from the hosting') };
  }
  if (act === 'restart') {
    const r = await remote(site, 'pkill -u ' + q(site.user) + ' lsphp; echo CZ-RESTART $?; sleep 3; ' + clear);
    const m = /CZ-RESTART (\d+)/.exec(r.out);
    if (!m) return { ok: false, text: 'Could not reach the hosting to restart the website: ' + (r.out.trim().split('\n').pop() || 'no answer') };
    return { ok: true, text: 'Website restarted (its PHP workers were stopped and start fresh)' + (/CZ-CLEAR/.test(r.out) ? ' and the cache cleared' : '') + '.' };
  }
  return { ok: false, text: 'Unknown website action.' };
}
