// BloodLink service worker.
//
// - Pages (HTML): network first, so people always get the latest content;
//   falls back to the cached copy, then to offline.html.
// - CSS / JS / images / icons / fonts: served from cache instantly and
//   refreshed in the background (stale-while-revalidate).
// - API calls, non-GET requests, video and the location lookup are never
//   cached: they always go to the network.
//
// Bump VERSION whenever you deploy changes so installed apps pick them up.

const VERSION = "v5";
const PRECACHE = `bloodlink-precache-${VERSION}`;
const RUNTIME = `bloodlink-runtime-${VERSION}`;

const APP_SHELL = [
  "./",
  "index.html",
  "donate.html",
  "thanks.html",
  "login.html",
  "donor-login.html",
  "js/config.js",
  "js/pages/donor-login.js",
  "dashboard.html",
  "new-request.html",
  "request.html",
  "admin.html",
  "offline.html",
  "manifest.webmanifest",
  "css/styles.css",
  "css/admin.css",
  "js/pwa.js",
  "js/motion.js",
  "js/api.js",
  "js/auth.js",
  "js/constants.js",
  "js/ui.js",
  "js/mock.js",
  "js/mock-donations.js",
  "js/analytics.js",
  "js/report-export.js",
  "js/donor-export.js",
  "js/pages/thanks.js",
  "js/pages/admin.js",
  "js/pages/dashboard.js",
  "js/pages/donate.js",
  "js/pages/login.js",
  "js/pages/new-request.js",
  "js/pages/request.js",
  "assets/icons/icon-192.png",
  "assets/icons/icon-512.png",
  "assets/icons/maskable-192.png",
  "assets/icons/maskable-512.png",
  "assets/icons/apple-touch-icon.png",
  "assets/icons/favicon-32.png",
  "assets/img/hero-poster.jpg",
  "assets/img/donor.jpg",
  "assets/img/hospital.jpg",
  "assets/img/step-hospital.jpg",
  "assets/img/step-match.jpg",
  "assets/img/step-register.jpg",
];

// Third-party static files (fonts, icon fonts, chart library) worth caching.
const CACHEABLE_HOSTS = [
  "fonts.googleapis.com",
  "fonts.gstatic.com",
  "cdn.jsdelivr.net",
  "cdnjs.cloudflare.com",
];

const STATIC_DESTINATIONS = ["style", "script", "image", "font", "manifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(PRECACHE).then((cache) =>
      // Add one by one so a single missing file doesn't break the install.
      Promise.all(
        APP_SHELL.map((url) =>
          cache.add(new Request(url, { cache: "reload" })).catch((err) =>
            console.warn("[sw] could not precache", url, err)
          )
        )
      )
    )
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keep = [PRECACHE, RUNTIME];
      const names = await caches.keys();
      await Promise.all(
        names.filter((n) => n.startsWith("bloodlink-") && !keep.includes(n)).map((n) => caches.delete(n))
      );
      if (self.registration.navigationPreload) await self.registration.navigationPreload.enable();
      await self.clients.claim();
    })()
  );
});

// The page asks the waiting worker to take over when the user taps "Update".
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;

  // Page navigations.
  if (req.mode === "navigate") {
    event.respondWith(networkFirstPage(event));
    return;
  }

  // Never cache video (range requests) or anything that isn't a static file
  // (e.g. API JSON from the Flask backend, the location lookup).
  if (req.destination === "video" || req.destination === "audio") return;
  if (!STATIC_DESTINATIONS.includes(req.destination)) return;

  if (sameOrigin || CACHEABLE_HOSTS.includes(url.hostname)) {
    event.respondWith(staleWhileRevalidate(event));
  }
});

async function networkFirstPage(event) {
  const req = event.request;
  try {
    const preload = await event.preloadResponse;
    const res = preload || (await fetch(req));
    if (res && res.ok) {
      const cache = await caches.open(RUNTIME);
      cache.put(stripQuery(req.url), res.clone());
    }
    return res;
  } catch {
    const cached =
      (await caches.match(req, { ignoreSearch: true })) ||
      (await caches.match(stripQuery(req.url), { ignoreSearch: true }));
    if (cached) return cached;
    // "/" → index.html
    if (new URL(req.url).pathname.endsWith("/")) {
      const index = await caches.match("index.html", { ignoreSearch: true });
      if (index) return index;
    }
    return (await caches.match("offline.html")) || Response.error();
  }
}

async function staleWhileRevalidate(event) {
  const req = event.request;
  const cache = await caches.open(RUNTIME);
  const cached = await caches.match(req);
  const network = fetch(req)
    .then((res) => {
      // Opaque (cross-origin no-cors) responses have status 0; still cacheable.
      if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone());
      return res;
    })
    .catch(() => undefined);

  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return (await network) || Response.error();
}

function stripQuery(u) {
  const url = new URL(u);
  url.search = "";
  url.hash = "";
  return url.href;
}
