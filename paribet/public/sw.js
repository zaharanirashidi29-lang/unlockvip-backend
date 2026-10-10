const CACHE = "paribet-app-v4";

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const scope = self.registration.scope;
    const assets = [
      "",
      "styles.css?v=18",
      "app.js?v=31",
      "manifest.webmanifest",
      "download",
      "icons/icon-192.png",
      "icons/icon-512.png"
    ];
    await Promise.all(assets.map((path) => cache.add(new URL(path, scope)).catch(() => {})));
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)));
    await self.clients.claim();
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    await Promise.all(windows.map((client) => {
      if (client.url && client.navigate) return client.navigate(client.url);
      return null;
    }));
  })());
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") self.skipWaiting();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.includes("/api/")) return;

  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok && (url.pathname === "/" || url.pathname.endsWith(".js") || url.pathname.endsWith(".css") || url.pathname.endsWith(".png") || url.pathname.endsWith(".webmanifest") || url.pathname === "/download")) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req))
  );
});
