// Service worker: ilova internetsiz ham ochilishi uchun fayllarni keshda saqlaydi.
// Avval tarmoqdan olinadi (yangi versiya darhol keladi), internet bo'lmasa — keshdan.

const CACHE = "vocab-v3";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "packs.js",
  "manifest.webmanifest",
  "vendor/lucide.min.js",
  "vendor/jspdf.umd.min.js",
  "icons/icon-192.png",
  "img/evu-elementary.jpg",
  "img/evu-pre-intermediate.jpg",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isFont = (url) => url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com";

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin && !isFont(url)) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok || res.type === "opaque") {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(req, { ignoreSearch: true })) ?? (req.mode === "navigate" ? caches.match("index.html") : Response.error())),
  );
});
