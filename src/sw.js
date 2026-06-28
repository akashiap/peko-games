const VERSION = "v25";
const CACHE = `gamehiroba-${VERSION}`;

const PRECACHE = [
  "./",
  "./index.html",
  "./style.css",
  "./manifest.webmanifest",
  "./img/bg_01.png",
  "./img/okame_card.png",
  "./icon/icon-192.png",
  "./icon/icon-512.png",
  "./icon/icon-512-maskable.png",
  "./icon/apple-touch-icon.png",
  "./games/reversi/index.html",
  "./games/reversi/style.css",
  "./games/reversi/script.js",
  "./games/gomoku/index.html",
  "./games/gomoku/style.css",
  "./games/gomoku/script.js",
  "./games/memory/index.html",
  "./games/memory/style.css",
  "./games/memory/script.js",
  "./games/sugoroku/index.html",
  "./games/sugoroku/style.css",
  "./games/sugoroku/script.js",
  "./games/pinball/index.html",
  "./games/pinball/style.css",
  "./games/pinball/script.js",
  "./games/slot/index.html",
  "./games/slot/style.css",
  "./games/slot/script.js",
  "./games/poker/index.html",
  "./games/poker/style.css",
  "./games/poker/script.js",
  "./games/roulette/index.html",
  "./games/roulette/style.css",
  "./games/roulette/script.js",
  "./games/okameran/index.html",
  "./games/okameran/style.css",
  "./games/okameran/script.js",
  "./games/okameran/img/okame.svg",
  "./games/okameran/img/okame_title.png"
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) =>
      Promise.all(
        PRECACHE.map((url) =>
          cache.add(url).catch((err) => console.warn("precache miss", url, err))
        )
      )
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  event.respondWith(
    caches.match(req).then((hit) => {
      if (hit) return hit;
      return fetch(req).then((res) => {
        if (res && res.ok && new URL(req.url).origin === self.location.origin) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      }).catch(() => caches.match("./index.html"));
    })
  );
});
