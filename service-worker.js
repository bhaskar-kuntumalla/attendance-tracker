// ============================================================
// service-worker.js — Attendance Tracker PWA
//
// Strategy:
//  - Precache static "app shell" (HTML/CSS/JS/icons/manifest)
//    including timetable & period-settings pages.
//  - Supabase API calls, auth requests, and third-party CDNs
//    (supabase-js, Google Fonts, Tesseract CDN) are NEVER intercepted/cached.
//  - Static same-origin assets use "network-first, fall back to
//    cache" so a new deploy is picked up immediately when online.
// ============================================================

const CACHE_VERSION = "v3";
const CACHE_NAME = `attendance-tracker-${CACHE_VERSION}`;

// Everything needed to render the app shell offline.
const APP_SHELL = [
  "./",
  "./index.html",
  "./how-it-works.html",
  "./login.html",
  "./signup.html",
  "./dashboard.html",
  "./timetable.html",
  "./period-settings.html",
  "./subjects.html",
  "./attendance.html",
  "./analytics.html",
  "./profile.html",
  "./manifest.json",
  "./css/style.css",
  "./css/responsive.css",
  "./css/landing.css",
  "./css/auth.css",
  "./css/dashboard.css",
  "./css/timetable.css",
  "./css/period-settings.css",
  "./css/subjects.css",
  "./css/attendance.css",
  "./css/analytics.css",
  "./css/profile.css",
  "./js/supabase.js",
  "./js/auth.js",
  "./js/nav.js",
  "./js/landing.js",
  "./js/utils.js",
  "./js/data.js",
  "./js/ocr.js",
  "./js/timetable-parser.js",
  "./js/timetable.js",
  "./js/periods.js",
  "./js/dashboard.js",
  "./js/subjects.js",
  "./js/attendance.js",
  "./js/analytics.js",
  "./js/profile.js",
  "./js/pwa.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
];

// Requests matching any of these should NEVER be touched by the
// service worker — always go straight to the network.
function isNetworkOnly(url) {
  return (
    url.hostname.includes("supabase.co") || // Supabase API + Auth
    url.hostname.includes("supabase.io") ||
    url.hostname.includes("jsdelivr.net") || // CDN bundles (supabase-js, Tesseract.js)
    url.hostname.includes("unpkg.com") ||
    url.hostname.includes("fonts.googleapis.com") ||
    url.hostname.includes("fonts.gstatic.com")
  );
}

/* ---------------- install ---------------- */
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE_NAME)
      .then((cache) => cache.addAll(APP_SHELL))
      .catch((err) => console.warn("[SW] Precache failed:", err))
  );
});

/* ---------------- activate ---------------- */
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(
          names
            .filter((name) => name !== CACHE_NAME)
            .map((name) => caches.delete(name))
        )
      )
      .then(() => self.clients.claim())
  );
});

/* ---------------- message ---------------- */
self.addEventListener("message", (event) => {
  if (event.data === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

/* ---------------- fetch ---------------- */
self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (isNetworkOnly(url)) return;
  if (url.origin !== self.location.origin) return;

  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
          return response;
        })
        .catch(
          () =>
            caches.match(request).then((cached) => cached) ||
            caches.match("./index.html")
        )
    );
    return;
  }

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request))
  );
});
