// ERP service worker.
//
// The app is online-only by design (no offline sales), so this worker only
// makes it installable and keeps the app shell loading fast. Business data
// always comes live from Supabase and is never cached here.
//
// Bump VERSION when the shell files change, so phones drop the old copy.
var VERSION = 'cz-shell-v4';
var SHELL = [
  '/',
  '/manifest.webmanifest',
  '/icons/icon-192.png',
  '/icons/icon-512.png',
  '/icons/apple-touch-icon.png',
  '/icons/favicon-32.png',
  'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/dist/umd/supabase.js'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }));
  self.skipWaiting();
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; })
                           .map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);

  // Pages: network first so an update shows up immediately; cached copy only
  // when the phone is offline, so the app at least opens and says so.
  if (req.mode === 'navigate') {
    // only the app itself is kept: the public pages (/check, /my) are never the offline copy of the app
    var isApp = url.pathname === '/' || url.pathname === '/index.html';
    e.respondWith(fetch(req).then(function (res) {
      if (isApp) { var copy = res.clone(); caches.open(VERSION).then(function (c) { c.put('/', copy); }); }
      return res;
    }).catch(function () { return isApp ? caches.match('/') : Response.error(); }));
    return;
  }

  // Static shell files only. Anything else (Supabase API, auth) goes straight
  // to the network untouched.
  var isShell = (url.origin === location.origin && SHELL.indexOf(url.pathname) !== -1) ||
                SHELL.indexOf(req.url) !== -1;
  if (isShell) {
    e.respondWith(caches.match(req).then(function (hit) { return hit || fetch(req); }));
  }
});

// alerts-1 (6 Nov 2026): phone alerts from the ERP server (Web Push) - shown even when the app is closed.
self.addEventListener('push', function (e) {
  var d = {};
  try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data ? e.data.text() : '' }; }
  var title = d.title || 'ERP';
  e.waitUntil(self.registration.showNotification(title, {
    body: d.body || '', tag: d.tag || 'erp', renotify: true,
    icon: '/icons/icon-192.png', badge: '/icons/favicon-32.png',
    data: { url: d.url || '/#/inbox' }
  }));
});

self.addEventListener('notificationclick', function (e) {
  e.notification.close();
  var url = new URL((e.notification.data && e.notification.data.url) || '/#/inbox', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(function (list) {
    for (var i = 0; i < list.length; i++) {
      var c = list[i];
      if (new URL(c.url).origin === self.location.origin) { return c.focus().then(function (w) { return w && w.navigate ? w.navigate(url) : w; }).catch(function () {}); }
    }
    return self.clients.openWindow(url);
  }));
});
