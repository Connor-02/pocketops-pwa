const CACHE_NAME = "pocketops-v4";
const ASSETS = [
    "/",
    "/index.html",
    "/styles.css",
    "/app.js",
    "/db.js",
    "/calculations.js",
    "/import-export.js",
    "/manifest.json",
    "/icons/icon-192.png",
    "/icons/icon-512.png"
];

self.addEventListener("install", (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)).then(() => self.skipWaiting())
    );
});

self.addEventListener("activate", (event) => {
    event.waitUntil(
        caches.keys().then(keys =>
            Promise.all(keys.map(k => (k !== CACHE_NAME ? caches.delete(k) : null)))
        ).then(() => self.clients.claim())
    );
});

self.addEventListener("fetch", (event) => {
    const req = event.request;
    if (req.method !== "GET") return;
    const url = new URL(req.url);

    // Navigation: network first.
    if (req.mode === "navigate") {
        event.respondWith(
            fetch(req).then(res => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then(cache => cache.put("/", copy));
                return res;
            }).catch(() => caches.match("/"))
        );
        return;
    }

    // Same-origin app shell files: network first so updates are visible quickly.
    const isAppShell = url.origin === self.location.origin &&
        (url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".html"));
    if (isAppShell) {
        event.respondWith(
            fetch(req).then(res => {
                const copy = res.clone();
                caches.open(CACHE_NAME).then(cache => cache.put(req, copy));
                return res;
            }).catch(() => caches.match(req))
        );
        return;
    }

    // Other assets: cache first.
    event.respondWith(
        caches.match(req).then(cached => cached || fetch(req))
    );
});
