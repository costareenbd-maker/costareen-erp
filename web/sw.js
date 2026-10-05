// ERP service worker.
//
// The app is online-only by design (no offline sales), so this worker only
// makes it installable and keeps the app shell loading fast. Business data
// always comes live from Supabase and is never cached here.
//
// Bump VERSION when the shell files change, so phones drop the old copy.
var VERSION = 'cz-shell-v3';
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
