// Offline cache for the app shell. Bump VERSION whenever any cached file changes.
var VERSION = 'scorebook-v15';
var FILES = [
  './', './index.html', './css/app.css', './js/core.js', './js/db.js', './js/report.js', './js/sample.js', './js/app.js',
  './manifest.webmanifest', './icons/icon-192.png', './icons/icon-512.png'
];

// cache: 'reload' skips the browser's HTTP cache (GitHub Pages lets it keep files for 10 minutes),
// so a new version never stores the previous version's files.
self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) {
    return c.addAll(FILES.map(function (f) { return new Request(f, { cache: 'reload' }); }));
  }).then(function () { return self.skipWaiting(); }));
});

// Lets the page show which version it's running.
self.addEventListener('message', function (e) {
  if (e.data === 'version' && e.ports && e.ports[0]) e.ports[0].postMessage(VERSION);
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches['delete'](k); }));
  }).then(function () { return self.clients.claim(); }));
});

// Cache first for same-origin GETs; everything else (e.g. publishing) goes to the network.
self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(function (hit) {
    return hit || fetch(req);
  }));
});
