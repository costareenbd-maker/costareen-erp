// ship-8: keeps the traveller's page on the phone so it opens at the arrival airport with no network.
// The page, its fonts, icons and the small QR maker are kept; the data (his details, the shipment) is kept by the page
// itself in localStorage. Network first for the page (so updates arrive), cache when offline.
const V = 'cp-v7';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon-192.png', './icon-512.png',
  '../fonts/NotoSansBengali-Regular.ttf', '../fonts/NotoSansBengali-Bold.ttf', '../fonts/Comfortaa-Bold.ttf', '../fonts/Inter-latin-var.woff2'];
const QR = 'https://cdn.jsdelivr.net/npm/qrcode-generator@1.4.4/qrcode.js';

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(V).then(async (c) => {
    await c.addAll(SHELL);
    try { const r = await fetch(QR, { mode: 'cors' }); if (r.ok) await c.put(QR, r); } catch (_) { /* drawn later, or the code is shown as text */ }
  }).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('cp-') && k !== V).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET') return;
  if (u.search.indexOf('inbox=portal') >= 0) return;            // the data: always live; the page keeps its own copy
  if (u.href === QR) { e.respondWith(caches.match(QR).then((hit) => hit || fetch(e.request))); return; }
  if (u.origin !== self.location.origin) return;
  const page = e.request.mode === 'navigate';
  if (page) {                                                    // network first, 6 s, then the kept page
    e.respondWith(Promise.race([fetch(e.request), new Promise((_, no) => setTimeout(no, 6000))])
      .then((r) => { const cp = r.clone(); caches.open(V).then((c) => c.put('./index.html', cp)); return r; })
      .catch(() => caches.match('./index.html')));
    return;
  }
  e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((r) => {
    if (r.ok && /\/(c|fonts)\//.test(u.pathname)) { const cp = r.clone(); caches.open(V).then((c) => c.put(e.request, cp)); }
    return r;
  })));
});
