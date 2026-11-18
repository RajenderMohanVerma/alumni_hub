/* ==========================================================================
   Alumni Hub - sw.js (service worker)
   --------------------------------------------------------------------------
   A service worker is a small script the browser runs in the background.
   It makes Alumni Hub installable (PWA) and fast: it caches the static
   files (CSS, JS, images, manifest) so repeat visits load instantly.

   Strategy (kept deliberately simple):
     - Static assets  -> CACHE-FIRST: serve from the cache, fetch and
       update the cache in the background.
     - Pages (HTML)   -> NETWORK-FIRST: always try the live page first
       (pages contain personal data like dashboards, so a stale cached
       page must never be shown when the network works). Only when the
       network fails do we fall back to whatever is in the cache.
     - Other requests (POST forms, the auth service on :5001, ...) are
       not touched at all.

   The cache name carries a version ("v1"): when this file changes,
   bump the version and old caches are deleted on activation.
   ========================================================================== */

var CACHE_NAME = "alumni-hub-v1";

// Files cached as soon as the worker installs
var PRECACHE_URLS = [
  "/css/style.css",
  "/js/main.js",
  "/images/default-avatar.svg",
  "/images/icon-192.png",
  "/manifest.json"
];

// Install: fill the cache, then take over without waiting for old tabs
self.addEventListener("install", function (event) {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(function (cache) { return cache.addAll(PRECACHE_URLS); })
      .then(function () { return self.skipWaiting(); })
  );
});

// Activate: delete caches from older versions of this worker
self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (names) {
      return Promise.all(names.map(function (name) {
        return name === CACHE_NAME ? null : caches.delete(name);
      }));
    }).then(function () { return self.clients.claim(); })
  );
});

// Fetch: apply the strategy described in the header comment
self.addEventListener("fetch", function (event) {
  var request = event.request;

  // Only GET requests, and only on our own origin
  if (request.method !== "GET") return;
  var url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  var isStatic =
    url.pathname.indexOf("/css/") === 0 ||
    url.pathname.indexOf("/js/") === 0 ||
    url.pathname.indexOf("/images/") === 0 ||
    url.pathname === "/manifest.json";

  if (isStatic) {
    // CACHE-FIRST for static files
    event.respondWith(
      caches.match(request).then(function (cached) {
        var network = fetch(request).then(function (response) {
          if (response && response.status === 200) {
            var copy = response.clone();
            caches.open(CACHE_NAME).then(function (cache) {
              cache.put(request, copy);
            });
          }
          return response;
        }).catch(function () { return cached; });
        return cached || network;
      })
    );
    return;
  }

  if (request.mode === "navigate") {
    // NETWORK-FIRST for pages: fresh content whenever possible
    event.respondWith(
      fetch(request).catch(function () {
        return caches.match(request).then(function (cached) {
          return cached || caches.match("/");
        });
      })
    );
  }
  // Everything else (API-like GETs, uploads, ...) goes to the network
  // untouched - the browser handles it as if we were not here.
});
