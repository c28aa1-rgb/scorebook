// Offline cache for the app shell. Bump VERSION whenever any cached file changes.
var VERSION = 'scorebook-v49';
var FILES = [
  './', './index.html', './css/app.css', './js/core.js', './js/db.js', './js/report.js', './js/stats.js', './js/sample.js', './js/schedule.js',
  './js/firebase-config.js', './js/cloud.js', './js/app.js',
  './vendor/firebase/firebase-app-compat.js', './vendor/firebase/firebase-auth-compat.js', './vendor/firebase/firebase-firestore-compat.js',
  './manifest.webmanifest', './icons/tiger.png', './icons/tiger-head-white.png', './icons/favicon-64.png', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png',
  './icons/apple-touch-icon.png',
  // Opponent logos
  './icons/opp/berkeleycarroll.png', './icons/opp/collegiate.png', './icons/opp/dwight.png', './icons/opp/fieldston.png', './icons/opp/friendsseminary.png', './icons/opp/gracechurch.png', './icons/opp/hackley.png', './icons/opp/horacemann.png', './icons/opp/hunter.png', './icons/opp/polyprep.png', './icons/opp/riverdale.png', './icons/opp/ryecountryday.png', './icons/opp/trevorday.png', './icons/opp/trinity.png'
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
