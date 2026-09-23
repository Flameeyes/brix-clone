// Network first, so updates show up right away; the cache makes the game
// playable offline once it has been opened.
const CACHE = 'brix-v1';
const FILES = [
  './',
  'index.html',
  'style.css',
  'manifest.webmanifest',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'src/main.js',
  'src/game.js',
  'src/board.js',
  'src/levels.js',
  'src/render.js',
  'src/palette.js',
  'src/sound.js',
  'src/hiscores.js',
  'data/LEVELS',
  'data/BLOCKS',
  'data/FONT',
  'data/BRIX.PIC',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        const copy = response.clone();
        void caches.open(CACHE).then((cache) => cache.put(event.request, copy));
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => cached ?? Response.error())),
  );
});
